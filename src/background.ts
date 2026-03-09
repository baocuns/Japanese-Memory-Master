import {
  getAuthMaybe,
  getUserSettings,
  setUserSettings,
  listVocab,
  getVocabById,
  patchVocab,
  addVocab,
  deleteVocab,
  migrateFromChromeSyncIfNeeded,
  signInWithGoogleInteractive,
  signInWithEmailPassword,
  signUpWithEmailPassword,
  signOutGoogle,
  listSubscribedLists,
  subscribeToList,
  listSystemProgress,
  patchSystemProgress,
  getSystemProgressById,
  createSystemProgress,
  redeemLicenseKey,
  getEntitlementById
} from "./firebaseClient";
import { QuizMode, VocabItem, SubscribedList, SystemVocabProgress } from "./types";
import { EntitlementManager } from "./EntitlementManager";

const DEFAULT_INTERVAL = 10;
const CACHE_KEY = "app_data_cache";
const CACHE_EXPIRY_MS = 1000 * 60 * 60 * 4; // 4 hours

interface CacheData {
  vocab: VocabItem[];
  subscriptions: SubscribedList[];
  progress: SystemVocabProgress[];
  lastSync: number;
}

// --- CACHE HELPERS ---
async function getCache(): Promise<CacheData | null> {
  const res = await chrome.storage.local.get(CACHE_KEY);
  const data = res[CACHE_KEY] as CacheData;
  if (!data) return null;
  return data;
}

async function setCache(data: CacheData) {
  await chrome.storage.local.set({ [CACHE_KEY]: data });
}

async function syncAndGetCache(force = false): Promise<CacheData | null> {
  const auth = await getAuthMaybe();
  if (!auth) return null;

  const current = await getCache();
  const now = Date.now();

  // If cache is valid and not forced, return it
  if (!force && current && (now - current.lastSync < CACHE_EXPIRY_MS)) {
    return current;
  }

  try {
    const [vocab, subscriptions, progress] = await Promise.all([
      listVocab(),
      listSubscribedLists(),
      listSystemProgress()
    ]);

    const newData: CacheData = {
      vocab,
      subscriptions,
      progress,
      lastSync: now
    };
    await setCache(newData);
    return newData;
  } catch (e) {
    console.log("Sync failed, returning old cache if available", e);
    return current;
  }
}

async function setupAlarm() {
  try {
    const auth = await getAuthMaybe();
    if (!auth) {
      await chrome.alarms.clear("quizAlarm");
      return;
    }

    const settingsDoc = await getUserSettings();
    const interval = settingsDoc?.quizInterval || DEFAULT_INTERVAL;

    await chrome.alarms.clear("quizAlarm");
    chrome.alarms.create("quizAlarm", { periodInMinutes: parseFloat(interval.toString()) });
  } catch (e) {
    console.log("setupAlarm error:", e);
    await chrome.alarms.clear("quizAlarm");
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.create({
    id: "addWord",
    title: "Thêm '%s' vào danh sách học",
    contexts: ["selection"]
  });
  await setupAlarm();
});

chrome.runtime.onStartup.addListener(async () => {
  await setupAlarm();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "addWord" && info.selectionText && tab?.id) {
    chrome.tabs
      .sendMessage(tab.id, { action: "OPEN_ADD_MODAL", text: info.selectionText })
      .catch((err) => console.log("SendMessage failed:", err));
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "quizAlarm") runQuizLogic();
});

const LIBRARY_CACHE: Record<string, any[]> = {};

async function getLibraryContent(listId: string): Promise<any[]> {
  const key = listId.toLowerCase();
  if (LIBRARY_CACHE[key]) return LIBRARY_CACHE[key];
  try {
    const url = chrome.runtime.getURL(`${key}_vocabulary.json`);
    const resp = await fetch(url);
    const data = await resp.json();
    LIBRARY_CACHE[key] = data.vocabulary || [];
    return LIBRARY_CACHE[key];
  } catch (e) {
    console.error(`Failed to load library ${listId}:`, e);
    return [];
  }
}

// --- Hỗ trợ tính toán độ nhiễu của đáp án ---
function calculateDistractorScore(target: any, candidate: any): number {
  let score = 0;

  // 1. Độ tương đồng về mặt chữ (Chung Kanji)
  const targetFront = target.front || "";
  const candFront = candidate.front || "";
  const commonChars = targetFront.split('').filter((char: string) =>
    candFront.includes(char) && char.match(/[\u4e00-\u9faf]/) // Chỉ tính Kanji
  );
  score += commonChars.length * 30;

  // 2. Độ tương đồng về nghĩa (Dựa trên từ khóa)
  const getWords = (item: any) => {
    const m = (item.meta?.meaningVi || item.meta?.meaning || "").toLowerCase();
    return m.split(/[\s,()]+/).filter((w: string) => w.length > 1);
  };
  const targetWords = getWords(target);
  const candWords = getWords(candidate);
  const commonWords = targetWords.filter((w: string) => candWords.includes(w));
  score += commonWords.length * 20;

  // 3. Đặc biệt: Cặp Tự động từ / Ngoại động từ
  const isTrans = (item: any) => (item.meta?.meaningVi || "").includes("ngoại động từ");
  const isIntrans = (item: any) => (item.meta?.meaningVi || "").includes("tự động từ");
  if ((isTrans(target) && isIntrans(candidate)) || (isIntrans(target) && isTrans(candidate))) {
    if (commonChars.length > 0) score += 50;
  }

  // 4. Cùng loại từ (type)
  if (target.meta?.type && target.meta?.type === candidate.meta?.type) {
    score += 10;
  }

  return score;
}

async function runQuizLogic() {
  try {
    // 1. Lấy dữ liệu từ Cache (hoặc sync nếu cần)
    const cache = await syncAndGetCache(false);
    if (!cache) return;

    const customList = cache.vocab || [];
    const subscriptions = cache.subscriptions || [];
    const systemProgress = cache.progress || [];

    // 3. Kết hợp và chọn ứng viên
    let allCandidates: (VocabItem | any)[] = customList.map(v => ({ ...v, listId: "Cá nhân" }));

    // Get user settings for entitlement queue
    const settings = await getUserSettings();
    const entitlementQueue = settings?.entitlementQueue || [];

    for (const sub of subscriptions) {
      if (!sub.enabled) continue;

      // Feature gating: Check if user has access to this library
      const featureMap: Record<string, string> = {
        "N4": "access_n4",
        "N3": "access_n3",
        "N2": "access_n2",
        "N1": "access_n1"
      };

      const requiredFeature = featureMap[sub.id];
      if (requiredFeature) {
        const hasAccess = await EntitlementManager.hasFeature(entitlementQueue, requiredFeature, getEntitlementById);
        if (!hasAccess) {
          console.log(`User does not have access to ${sub.id}, skipping...`);
          continue; // Skip this library
        }
      }

      const library = await getLibraryContent(sub.id);

      // Map library items to include their score from systemProgress
      for (const item of library) {
        const prog = systemProgress.find(p => p.id === item.id);
        allCandidates.push({
          ...item,
          score: prog ? prog.score : 0,
          isSystem: true,
          listId: sub.id
        });
      }
    }

    if (allCandidates.length === 0) return;

    // --- LOGIC CHỌN TỪ THÔNG MINH (Learning / New / Mastered) ---
    const userSettings = await getUserSettings();
    const activeLimit = userSettings?.activeWordLimit || 10;

    // Phân loại từ
    const learning = allCandidates.filter(w => (w.score || 0) > 0 && (w.score || 0) < 5);
    const newWords = allCandidates.filter(w => (w.score || 0) === 0);
    const mastered = allCandidates.filter(w => (w.score || 0) >= 5);

    let finalPool: (VocabItem | any)[] = [];

    // Kịch bản 1: "Ôn tập cũ" (Mastered) - 10% cơ hội (nếu có từ mastered)
    // Hoặc nếu không có từ nào để học (hết từ mới, chưa có từ đang học)
    const shouldReviewMastered = (mastered.length > 0) && (Math.random() < 0.1 || (learning.length === 0 && newWords.length === 0));

    if (shouldReviewMastered) {
      finalPool = mastered;
    } else {
      // Kịch bản 2: "Học từ đang học" (Learning) + "Nạp từ mới" (New)
      finalPool = [...learning];

      // Nếu số từ đang học < Limit -> Nạp thêm từ mới
      if (learning.length < activeLimit && newWords.length > 0) {
        // Shuffle newWords để lấy ngẫu nhiên
        const shuffledNew = newWords.sort(() => 0.5 - Math.random());
        const slotsAvailable = activeLimit - learning.length;
        const toAdd = shuffledNew.slice(0, slotsAvailable);
        finalPool = finalPool.concat(toAdd);
      }

      // Nếu sau khi nạp mà vẫn rỗng (ví dụ: mới dùng app, chưa học gì) -> Lấy đại vài từ mới
      if (finalPool.length === 0 && newWords.length > 0) {
        finalPool = newWords.slice(0, 5);
      }
    }

    // Nếu vẫn rỗng (không có từ nào cả) -> Fallback lấy tất cả
    if (finalPool.length === 0) finalPool = allCandidates.slice(0, 20);

    // Chọn 1 từ từ finalPool
    const wordToQuiz = finalPool[Math.floor(Math.random() * finalPool.length)];

    // Xác định Câu hỏi và Đáp án dựa trên QuizMode
    let question = wordToQuiz.front;
    let correctAnswer = wordToQuiz.back;
    let modeTitle = "Ôn tập nhanh!";

    let mode = wordToQuiz.quizMode || userSettings?.defaultQuizMode || 'vocab_to_meaning';

    if (mode === 'shuffled') {
      const modes: QuizMode[] = ['vocab_to_meaning', 'meaning_to_vocab', 'kanji_to_reading', 'reading_to_kanji'];
      // Lọc bỏ những mode không khả dụng cho từ này (ví dụ từ không có Kanji thì bỏ kanji_to_reading)
      const availableModes = modes.filter(m => {
        if (m === 'kanji_to_reading' || m === 'reading_to_kanji') {
          // Tạm thời check front/back. Sau này check meta.reading nếu dữ liệu chuẩn hóa hơn.
          return wordToQuiz.front !== wordToQuiz.back || (wordToQuiz.meta?.reading && wordToQuiz.meta.reading !== wordToQuiz.front);
        }
        return true;
      });
      mode = availableModes[Math.floor(Math.random() * availableModes.length)];
    }

    if (mode === 'meaning_to_vocab') {
      question = wordToQuiz.meta?.meaningVi || wordToQuiz.meta?.meaning || wordToQuiz.meta?.meaningEn || wordToQuiz.back;
      correctAnswer = wordToQuiz.front;
      modeTitle = "Từ này tiếng Nhật là gì?";
    } else if (mode === 'kanji_to_reading') {
      question = wordToQuiz.front;
      correctAnswer = wordToQuiz.meta?.reading || wordToQuiz.back;
      modeTitle = "Cách đọc của từ này?";
    } else if (mode === 'reading_to_kanji') {
      question = wordToQuiz.meta?.reading || wordToQuiz.back;
      correctAnswer = wordToQuiz.front;
      modeTitle = "Hán tự của từ này?";
    } else {
      question = wordToQuiz.front;
      correctAnswer = wordToQuiz.meta?.meaningVi || wordToQuiz.meta?.meaning || wordToQuiz.meta?.meaningEn || wordToQuiz.back;
      modeTitle = "Nghĩa của từ này?";
    }

    // --- Lấy đáp án sai THÔNG MINH ---
    const otherWords = allCandidates.filter((w) => w.id !== wordToQuiz.id);

    // Tính điểm nhiễu cho từng từ và sắp xếp
    const scoredOtherWords = otherWords.map(w => ({
      word: w,
      distractorScore: calculateDistractorScore(wordToQuiz, w) + Math.random() * 10 // Mix thêm chút ngẫu nhiên
    })).sort((a, b) => b.distractorScore - a.distractorScore);

    const wrongAnswers: string[] = [];
    for (const item of scoredOtherWords) {
      if (wrongAnswers.length >= 3) break;

      const randomWord = item.word;
      let val = "";
      if (mode === 'meaning_to_vocab' || mode === 'reading_to_kanji') {
        val = randomWord.front;
      } else if (mode === 'kanji_to_reading') {
        val = randomWord.meta?.reading || randomWord.back;
      } else {
        val = randomWord.meta?.meaningVi || randomWord.meta?.meaning || randomWord.meta?.meaningEn || randomWord.back;
      }

      if (val && !wrongAnswers.includes(val) && val !== correctAnswer) {
        wrongAnswers.push(val);
      }
    }

    // Fallback constants if needed
    const defaults = ["Cái bàn", "Quyển sách", "Đi ngủ", "Màu đỏ", "Con mèo", "ねこ", "いぬ", "たべる"];
    while (wrongAnswers.length < 3) {
      const r = defaults[Math.floor(Math.random() * defaults.length)];
      if (!wrongAnswers.includes(r) && r !== correctAnswer) wrongAnswers.push(r);
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (activeTab?.id) {
        chrome.tabs
          .sendMessage(activeTab.id, {
            action: "OPEN_QUIZ_MODAL",
            wordData: wordToQuiz,
            quizData: { question, correctAnswer, modeTitle },
            wrongOptions: wrongAnswers
          })
          .catch(() => console.log("Không thể hiện Quiz trên tab này."));
      }
    });
  } catch (e) {
    console.log("runQuizLogic error:", e);
  }
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  (async () => {
    try {
      switch (request.action) {
        case "AUTH_STATUS": {
          const auth = await getAuthMaybe();
          sendResponse({ ok: true, signedIn: !!auth, auth });
          break;
        }

        case "AUTH_SIGN_IN_GOOGLE": {
          const auth = await signInWithGoogleInteractive();
          try {
            await migrateFromChromeSyncIfNeeded();
          } catch (e) {
            console.log("migrate error:", e);
          }
          await setupAlarm();
          sendResponse({ ok: true, auth });
          break;
        }

        case "AUTH_SIGN_OUT": {
          await signOutGoogle();
          await setupAlarm();
          sendResponse({ ok: true });
          break;
        }

        case "AUTH_SIGN_IN_EMAIL": {
          const auth = await signInWithEmailPassword(request.email, request.password);
          try { await migrateFromChromeSyncIfNeeded(); } catch (e) { console.log("migrate error:", e); }
          await setupAlarm();
          sendResponse({ ok: true, auth });
          break;
        }

        case "AUTH_SIGN_UP_EMAIL": {
          const auth = await signUpWithEmailPassword(request.email, request.password);
          try { await migrateFromChromeSyncIfNeeded(); } catch (e) { console.log("migrate error:", e); }
          await setupAlarm();
          sendResponse({ ok: true, auth });
          break;
        }

        case "GET_SETTINGS": {
          const doc = await getUserSettings();
          sendResponse({ ok: true, settings: doc || null });
          break;
        }

        case "SAVE_SETTINGS": {
          const quizInterval = parseFloat(request.quizInterval);
          const activeWordLimit = parseInt(request.activeWordLimit) || 10;
          const defaultQuizMode = request.defaultQuizMode;
          const saved = await setUserSettings({ quizInterval, defaultQuizMode, activeWordLimit });
          await setupAlarm();
          sendResponse({ ok: true, settings: saved });
          break;
        }

        case "GET_POPUP_DATA": {
          const settings = await getUserSettings();
          // Use cache
          const cache = await syncAndGetCache(false);

          const customList = cache?.vocab || [];
          const subscriptions = cache?.subscriptions || [];
          const systemProgress = cache?.progress || [];

          const taggedCustom = customList.map(v => ({ ...v, listId: "Cá nhân" }));

          let allWords: any[] = [...taggedCustom];

          for (const sub of subscriptions) {
            if (!sub.enabled) continue;
            const library = await getLibraryContent(sub.id);
            for (const item of library) {
              const prog = systemProgress.find(p => p.id === item.id);
              if (prog) {
                allWords.push({
                  ...item,
                  score: prog.score,
                  listId: sub.id,
                  updatedAt: prog.updatedAt
                });
              }
            }
          }

          // Lấy 20 từ vừa học gần nhất cho popup
          const displayList = allWords
            .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
            .slice(0, 20);

          sendResponse({
            ok: true,
            settings,
            allWords: displayList,
            totalCustom: customList.length,
            totalSubscribed: subscriptions.filter(s => s.enabled).length
          });
          break;
        }

        case "GET_VOCAB_LIST": {
          // Use cache
          const cache = await syncAndGetCache(false);

          const customList = cache?.vocab || [];
          const subscriptions = cache?.subscriptions || [];
          const systemProgress = cache?.progress || [];

          const taggedCustom = customList.map(v => ({ ...v, listId: "Cá nhân" }));

          let allWords: any[] = [...taggedCustom];
          for (const sub of subscriptions) {
            if (!sub.enabled) continue;
            const library = await getLibraryContent(sub.id);
            for (const item of library) {
              const prog = systemProgress.find(p => p.id === item.id);
              if (prog) {
                allWords.push({
                  ...item,
                  score: prog.score,
                  listId: sub.id,
                  updatedAt: prog.updatedAt,
                  isSystem: true
                });
              }
            }
          }
          sendResponse({ ok: true, vocabList: allWords });
          break;
        }

        case "GET_SUBSCRIPTIONS": {
          const list = await listSubscribedLists();
          sendResponse({ ok: true, subscriptions: list });
          break;
        }

        case "SUBSCRIBE_LIST": {
          const listId = String(request.listId);
          const enabled = request.enabled !== false;
          const created = await subscribeToList(listId, enabled);

          // Update Cache
          const cache = await getCache();
          if (cache) {
            const idx = cache.subscriptions.findIndex(s => s.id === listId);
            if (idx >= 0) {
              cache.subscriptions[idx] = created;
            } else {
              cache.subscriptions.push(created);
            }
            await setCache(cache);
          }

          sendResponse({ ok: true, subscription: created });
          break;
        }

        case "ADD_VOCAB": {
          const front = (request.word || request.front || "").trim();
          const back = (request.meaning || request.back || "").trim();
          if (!front || !back) {
            sendResponse({ ok: false, error: "Thiếu thông tin" });
            break;
          }
          const created = await addVocab({
            front,
            back,
            meta: { meaning: back },
            quizMode: (request.quizMode as QuizMode) || 'vocab_to_meaning'
          });

          // Update Cache
          const cache = await getCache();
          if (cache) {
            cache.vocab.push(created);
            await setCache(cache);
          }

          sendResponse({ ok: true, item: created });
          break;
        }

        case "DELETE_VOCAB": {
          await deleteVocab(String(request.id));

          // Update Cache
          const cache = await getCache();
          if (cache) {
            cache.vocab = cache.vocab.filter(v => v.id !== String(request.id));
            await setCache(cache);
          }

          sendResponse({ ok: true });
          break;
        }

        case "QUIZ_ANSWER": {
          const id = String(request.id);
          const isCorrect = !!request.isCorrect;
          const isSystem = !!request.wordData?.isSystem;

          if (isSystem) {
            const prog = await getSystemProgressById(id);
            const oldScore = prog ? prog.score : 0;
            const newScore = isCorrect ? oldScore + 1 : Math.max(0, oldScore - 2);
            if (prog) {
              await patchSystemProgress(id, { score: newScore });
            } else {
              await createSystemProgress(id, newScore);
            }

            // Update Cache
            const cache = await getCache();
            if (cache) {
              const idx = cache.progress.findIndex(p => p.id === id);
              if (idx >= 0) {
                cache.progress[idx].score = newScore;
                cache.progress[idx].updatedAt = new Date().toISOString();
                await setCache(cache);
              } else {
                cache.progress.push({ id, score: newScore, updatedAt: new Date().toISOString(), lastReviewed: new Date().toISOString() });
                await setCache(cache);
              }
            }
          } else {
            const doc = await getVocabById(id);
            const oldScore = typeof doc.score === "number" ? doc.score : 0;
            const newScore = isCorrect ? oldScore + 1 : Math.max(0, oldScore - 2);
            await patchVocab(id, { score: newScore, lastReviewed: new Date().toISOString() });

            // Update Cache
            const cache = await getCache();
            if (cache) {
              const idx = cache.vocab.findIndex(v => v.id === id);
              if (idx >= 0) {
                cache.vocab[idx].score = newScore;
                cache.vocab[idx].lastReviewed = new Date().toISOString();
                await setCache(cache);
              }
            }
          }
          sendResponse({ ok: true });
          break;
        }

        case "REDEEM_LICENSE_KEY": {
          const key = String(request.key || "").trim();
          if (!key) {
            sendResponse({ ok: false, error: "Vui lòng nhập license key" });
            break;
          }

          const result = await redeemLicenseKey(key);
          if (result.success) {
            // Invalidate cache to force refresh
            await chrome.storage.local.remove(CACHE_KEY);
            sendResponse({ ok: true, message: result.message, entitlementQueue: result.entitlementQueue });
          } else {
            sendResponse({ ok: false, error: result.message });
          }
          break;
        }

        case "GET_ENTITLEMENT_STATUS": {
          const settings = await getUserSettings();
          const queue = settings?.entitlementQueue || [];
          const current = EntitlementManager.getCurrentEntitlement(queue);

          let currentName = "Miễn phí";
          let features: string[] = [];

          if (current) {
            currentName = await EntitlementManager.getEntitlementName(current.id, getEntitlementById);
            features = await EntitlementManager.resolveFeatures(current.id, getEntitlementById);
          } else {
            features = await EntitlementManager.resolveFeatures("tier_free", getEntitlementById);
          }

          sendResponse({
            ok: true,
            current: current ? { ...current, name: currentName } : null,
            queue,
            features
          });
          break;
        }

        default:
          sendResponse({ ok: false, error: `Unknown action: ${request.action}` });
      }
    } catch (e: any) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();
  return true;
});
