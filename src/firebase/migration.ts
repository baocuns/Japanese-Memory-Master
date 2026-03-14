import { QuizMode } from "../types";
import { getAuth } from "./auth";
import { docToPlain, firestoreFetch } from "./firestore";
import { addVocab } from "./vocabApi";

export async function migrateFromOldFirestoreCollection() {
    const auth = await getAuth();
    try {
        // Try to list from OLD path
        const res = await firestoreFetch(`/users/${auth.uid}/vocab?pageSize=1000`, { idToken: auth.idToken });
        const oldDocs = res.documents || [];
        if (oldDocs.length === 0) return { migrated: false };

        console.log(`Đang migrate ${oldDocs.length} từ từ collection cũ...`);
        for (const doc of oldDocs) {
            const item = docToPlain(doc);
            try {
                await addVocab({
                    front: item.front,
                    back: item.back,
                    meta: item.meta || {},
                    quizMode: item.quizMode || 'vocab_to_meaning'
                });
                // Delete from old path after migration
                await firestoreFetch(`/users/${auth.uid}/vocab/${encodeURIComponent(item.id)}`, { method: "DELETE", idToken: auth.idToken });
            } catch (e) {
                console.log("Migration item failed:", e);
            }
        }
        return { migrated: true, count: oldDocs.length };
    } catch (e) {
        // If /vocab doesn't exist or other error, ignore
        return { migrated: false };
    }
}

export async function migrateFromChromeSyncIfNeeded() {
    const MIGRATE_FLAG = "migratedToFirebase_v2";
    const syncRes = await new Promise<any>((resolve) => chrome.storage.sync.get([MIGRATE_FLAG, "vocabList"], resolve));

    // Also try Firestore migration anyway if not marked
    if (!syncRes[MIGRATE_FLAG]) {
        await migrateFromOldFirestoreCollection().catch(console.error);
    }

    if (syncRes[MIGRATE_FLAG]) return { migrated: false };

    const vocabList = syncRes.vocabList || [];
    for (const item of vocabList) {
        if (!item?.word) continue;
        try {
            await addVocab({
                front: item.word,
                back: item.meaning,
                meta: { meaning: item.meaning },
                quizMode: 'vocab_to_meaning' as QuizMode
            });
        } catch (e: any) {
            if (!e?.message?.includes("ALREADY_EXISTS")) throw e;
        }
    }
    await chrome.storage.sync.set({ [MIGRATE_FLAG]: true });
    return { migrated: true, count: vocabList.length };
}
