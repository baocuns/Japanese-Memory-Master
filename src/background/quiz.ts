import { QuizMode, VocabItem } from "../types";
import {
    getUserSettings,
    getEntitlementById
} from "../firebase";
import { EntitlementManager } from "../EntitlementManager";
import { syncAndGetCache } from "./cache";

// --- Library Cache ---
const LIBRARY_CACHE: Record<string, any[]> = {};

export async function getLibraryContent(listId: string): Promise<any[]> {
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

// --- Distractor Scoring ---
export function calculateDistractorScore(target: any, candidate: any): number {
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

// --- Quiz Logic ---
export async function runQuizLogic() {
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

        // --- LOGIC CHỌN TỪ THÔNG MINH (Fixed Active Set) ---
        const userSettings = await getUserSettings();
        const activeLimit = userSettings?.activeWordLimit || 10;

        // Phân loại từ
        const mastered = allCandidates.filter(w => (w.score || 0) >= 5);
        const nonMastered = allCandidates.filter(w => (w.score || 0) < 5);

        let finalPool: (VocabItem | any)[] = [];

        // Kịch bản 1: "Ôn tập cũ" (Mastered) - 10% cơ hội
        // Hoặc nếu không còn từ nào chưa mastered
        const shouldReviewMastered = (mastered.length > 0) && (Math.random() < 0.1 || nonMastered.length === 0);

        if (shouldReviewMastered) {
            finalPool = mastered;
        } else {
            // Kịch bản 2: Fixed Active Set
            // Load active set từ storage
            const ACTIVE_SET_KEY = "active_word_set";
            const stored = await chrome.storage.local.get(ACTIVE_SET_KEY);
            const activeData = stored[ACTIVE_SET_KEY] as { ids: string[]; updatedAt: number } | undefined;
            let activeIds: string[] = activeData?.ids || [];

            // Lọc bỏ từ đã mastered hoặc không còn trong allCandidates
            const candidateIds = new Set(allCandidates.map(w => w.id));
            activeIds = activeIds.filter(id => {
                if (!candidateIds.has(id)) return false;
                const word = allCandidates.find(w => w.id === id);
                return word && (word.score || 0) < 5;
            });

            // Nạp thêm từ mới nếu active set chưa đầy
            if (activeIds.length < activeLimit) {
                const activeIdSet = new Set(activeIds);
                // Lấy từ chưa mastered và chưa có trong active set
                const candidates = nonMastered.filter(w => !activeIdSet.has(w.id));

                // Sắp xếp ưu tiên: từ chưa bao giờ xuất hiện (không có lastReviewed) trước,
                // sau đó đến từ có lastReviewed cũ nhất
                candidates.sort((a, b) => {
                    const aReviewed = a.lastReviewed || "";
                    const bReviewed = b.lastReviewed || "";
                    // Từ chưa review (empty string) lên đầu
                    if (!aReviewed && bReviewed) return -1;
                    if (aReviewed && !bReviewed) return 1;
                    // Cả hai đều chưa review -> giữ thứ tự gốc
                    if (!aReviewed && !bReviewed) return 0;
                    // Cả hai đều đã review -> cũ hơn lên trước
                    return aReviewed.localeCompare(bReviewed);
                });

                const slotsAvailable = activeLimit - activeIds.length;
                const toAdd = candidates.slice(0, slotsAvailable);
                activeIds = activeIds.concat(toAdd.map(w => w.id));
            }

            // Lưu active set vào storage
            await chrome.storage.local.set({
                [ACTIVE_SET_KEY]: { ids: activeIds, updatedAt: Date.now() }
            });

            // Build final pool từ active set
            const activeIdSet = new Set(activeIds);
            finalPool = allCandidates.filter(w => activeIdSet.has(w.id));

            // Fallback: nếu active set rỗng (mới dùng app)
            if (finalPool.length === 0 && nonMastered.length > 0) {
                finalPool = nonMastered.slice(0, 5);
            }
        }

        // Nếu vẫn rỗng -> Fallback lấy tất cả
        if (finalPool.length === 0) finalPool = allCandidates.slice(0, 20);

        // Chọn từ quiz bằng Weighted Random (ưu tiên score thấp)
        // Weight = 1 / (score + 1): score 0 → weight 1.0, score 4 → weight 0.2
        const weights = finalPool.map(w => 1 / ((w.score || 0) + 1));
        const totalWeight = weights.reduce((sum, w) => sum + w, 0);
        let rand = Math.random() * totalWeight;
        let wordToQuiz = finalPool[0];
        for (let i = 0; i < finalPool.length; i++) {
            rand -= weights[i];
            if (rand <= 0) {
                wordToQuiz = finalPool[i];
                break;
            }
        }

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
