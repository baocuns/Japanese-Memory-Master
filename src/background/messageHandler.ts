import { QuizMode } from "../types";
import {
    getAuthMaybe,
    getUserSettings,
    setUserSettings,
    signInWithGoogleInteractive,
    signInWithEmailPassword,
    signUpWithEmailPassword,
    signOutGoogle,
    migrateFromChromeSyncIfNeeded,
    listSubscribedLists,
    subscribeToList,
    addVocab,
    deleteVocab,
    getVocabById,
    patchVocab,
    getSystemProgressById,
    patchSystemProgress,
    createSystemProgress,
    redeemLicenseKey,
    getEntitlementById
} from "../firebase";
import { EntitlementManager } from "../EntitlementManager";
import { getCache, setCache, syncAndGetCache, invalidateCache } from "./cache";
import { getLibraryContent } from "./quiz";
import { setupAlarm } from "./alarm";

export function registerMessageHandler() {
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
                        const meta = request.meta && typeof request.meta === 'object'
                            ? { meaning: back, ...request.meta }
                            : { meaning: back };
                        const created = await addVocab({
                            front,
                            back,
                            meta,
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
                            await invalidateCache();
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
}
