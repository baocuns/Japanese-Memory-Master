import { VocabItem, UserSettings, QuizMode, SystemVocabProgress, SubscribedList } from "../types";
import { getAuth } from "./auth";
import { toFirestoreValue, docToPlain, firestoreFetch } from "./firestore";

// ------------------------------
// User Settings
// ------------------------------
export async function getUserSettings(): Promise<UserSettings | null> {
    const auth = await getAuth();
    try {
        const doc = await firestoreFetch(`/users/${auth.uid}/settings/main`, { idToken: auth.idToken });
        return docToPlain(doc);
    } catch (_) { return null; }
}

export async function setUserSettings(settingsObj: Partial<UserSettings>): Promise<UserSettings> {
    const auth = await getAuth();
    const fields = { ...settingsObj, updatedAt: new Date().toISOString() };
    const body = { fields: {} as any };
    for (const [k, v] of Object.entries(fields)) body.fields[k] = toFirestoreValue(v);
    const updateMask = Object.keys(fields);

    const doc = await firestoreFetch(`/users/${auth.uid}/settings/main`, {
        method: "PATCH",
        idToken: auth.idToken,
        body,
        updateMask
    });
    return docToPlain(doc);
}

// ------------------------------
// Personal Vocabulary (customVocab)
// ------------------------------
export async function listVocab(): Promise<VocabItem[]> {
    const auth = await getAuth();
    const res = await firestoreFetch(`/users/${auth.uid}/customVocab?pageSize=1000`, { idToken: auth.idToken });
    return (res.documents || []).map(docToPlain);
}

export async function addVocab({ front, back, meta, quizMode }: Partial<VocabItem>): Promise<VocabItem> {
    const auth = await getAuth();
    const docId = String(Date.now());
    const item: Partial<VocabItem> = {
        front,
        back,
        meta: meta || {},
        quizMode: quizMode || 'vocab_to_meaning' as QuizMode,
        score: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    const body = { fields: {} as any };
    for (const [k, v] of Object.entries(item)) body.fields[k] = toFirestoreValue(v);

    const path = `/users/${auth.uid}/customVocab?documentId=${encodeURIComponent(docId)}`;
    const doc = await firestoreFetch(path, { method: "POST", idToken: auth.idToken, body });
    return docToPlain(doc);
}

export async function patchVocab(id: string, partialObj: Partial<VocabItem>): Promise<VocabItem> {
    const auth = await getAuth();
    const fields = { ...partialObj, updatedAt: new Date().toISOString() };
    const body = { fields: {} as any };
    for (const [k, v] of Object.entries(fields)) body.fields[k] = toFirestoreValue(v);
    const updateMask = Object.keys(fields);

    const doc = await firestoreFetch(`/users/${auth.uid}/customVocab/${encodeURIComponent(id)}`, {
        method: "PATCH",
        idToken: auth.idToken,
        body,
        updateMask
    });
    return docToPlain(doc);
}

export async function getVocabById(id: string): Promise<VocabItem> {
    const auth = await getAuth();
    const doc = await firestoreFetch(`/users/${auth.uid}/customVocab/${encodeURIComponent(id)}`, { idToken: auth.idToken });
    return docToPlain(doc);
}

export async function deleteVocab(id: string): Promise<boolean> {
    const auth = await getAuth();
    await firestoreFetch(`/users/${auth.uid}/customVocab/${encodeURIComponent(id)}`, { method: "DELETE", idToken: auth.idToken });
    return true;
}

// ------------------------------
// Subscribed Lists (N5, N4, etc.)
// ------------------------------
export async function listSubscribedLists(): Promise<SubscribedList[]> {
    const auth = await getAuth();
    const res = await firestoreFetch(`/users/${auth.uid}/subscribedLists`, { idToken: auth.idToken });
    return (res.documents || []).map(docToPlain);
}

export async function subscribeToList(listId: string, enabled: boolean = true): Promise<SubscribedList> {
    const auth = await getAuth();
    const data: Partial<SubscribedList> = {
        enabled,
        addedAt: new Date().toISOString()
    };
    const body = { fields: {} as any };
    for (const [k, v] of Object.entries(data)) body.fields[k] = toFirestoreValue(v);

    const path = `/users/${auth.uid}/subscribedLists/${encodeURIComponent(listId)}`;
    const doc = await firestoreFetch(path, { method: "PATCH", idToken: auth.idToken, body, updateMask: Object.keys(data) });
    return docToPlain(doc);
}

// ------------------------------
// System Progress (Progress on Library items)
// ------------------------------
export async function listSystemProgress(): Promise<SystemVocabProgress[]> {
    const auth = await getAuth();
    const res = await firestoreFetch(`/users/${auth.uid}/systemProgress?pageSize=1000`, { idToken: auth.idToken });
    return (res.documents || []).map(docToPlain);
}

export async function patchSystemProgress(id: string, partialObj: Partial<SystemVocabProgress>): Promise<SystemVocabProgress> {
    const auth = await getAuth();
    const fields = { ...partialObj, updatedAt: new Date().toISOString() };
    const body = { fields: {} as any };
    for (const [k, v] of Object.entries(fields)) body.fields[k] = toFirestoreValue(v);
    const updateMask = Object.keys(fields);

    const doc = await firestoreFetch(`/users/${auth.uid}/systemProgress/${encodeURIComponent(id)}`, {
        method: "PATCH",
        idToken: auth.idToken,
        body,
        updateMask
    });
    return docToPlain(doc);
}

export async function getSystemProgressById(id: string): Promise<SystemVocabProgress | null> {
    const auth = await getAuth();
    try {
        const doc = await firestoreFetch(`/users/${auth.uid}/systemProgress/${encodeURIComponent(id)}`, { idToken: auth.idToken });
        return docToPlain(doc);
    } catch (_) { return null; }
}

export async function createSystemProgress(id: string, score: number): Promise<SystemVocabProgress> {
    const auth = await getAuth();
    const item: Partial<SystemVocabProgress> = {
        score,
        updatedAt: new Date().toISOString()
    };
    const body = { fields: {} as any };
    for (const [k, v] of Object.entries(item)) body.fields[k] = toFirestoreValue(v);

    const path = `/users/${auth.uid}/systemProgress?documentId=${encodeURIComponent(id)}`;
    const doc = await firestoreFetch(path, { method: "POST", idToken: auth.idToken, body });
    return docToPlain(doc);
}

// ------------------------------
// System Vocabulary (Library) - Reference
// ------------------------------
export async function listSystemVocab(category: string): Promise<VocabItem[]> {
    const auth = await getAuth();
    const res = await firestoreFetch(`/systemVocab/${category}/vocab?pageSize=1000`, { idToken: auth.idToken });
    return (res.documents || []).map(docToPlain);
}
