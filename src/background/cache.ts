import { VocabItem, SubscribedList, SystemVocabProgress } from "../types";
import {
    getAuthMaybe,
    listVocab,
    listSubscribedLists,
    listSystemProgress
} from "../firebase";

const CACHE_KEY = "app_data_cache";
const CACHE_EXPIRY_MS = 1000 * 60 * 60 * 4; // 4 hours

export interface CacheData {
    vocab: VocabItem[];
    subscriptions: SubscribedList[];
    progress: SystemVocabProgress[];
    lastSync: number;
}

export async function getCache(): Promise<CacheData | null> {
    const res = await chrome.storage.local.get(CACHE_KEY);
    const data = res[CACHE_KEY] as CacheData;
    if (!data) return null;
    return data;
}

export async function setCache(data: CacheData) {
    await chrome.storage.local.set({ [CACHE_KEY]: data });
}

export async function syncAndGetCache(force = false): Promise<CacheData | null> {
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

export async function invalidateCache() {
    await chrome.storage.local.remove(CACHE_KEY);
}
