import { FIREBASE_PROJECT_ID, FIRESTORE_DB } from "./config";

// ------------------------------
// Firestore REST helpers
// ------------------------------
export function firestoreBaseUrl() {
    return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(FIREBASE_PROJECT_ID)}/databases/${encodeURIComponent(FIRESTORE_DB)}/documents`;
}

export function toFirestoreValue(value: any): any {
    if (value === null || value === undefined) return { nullValue: null };
    if (typeof value === "string") return { stringValue: value };
    if (typeof value === "number") return { doubleValue: value };
    if (typeof value === "boolean") return { booleanValue: value };
    if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
    if (typeof value === "object") {
        const fields: any = {};
        for (const [k, v] of Object.entries(value)) fields[k] = toFirestoreValue(v);
        return { mapValue: { fields } };
    }
    return { stringValue: String(value) };
}

export function fromFirestoreValue(v: any): any {
    if (!v) return null;
    if ("stringValue" in v) return v.stringValue;
    if ("integerValue" in v) return parseInt(v.integerValue, 10);
    if ("doubleValue" in v) return v.doubleValue;
    if ("booleanValue" in v) return v.booleanValue;
    if ("nullValue" in v) return null;
    if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromFirestoreValue);
    if ("mapValue" in v) {
        const fields = v.mapValue.fields || {};
        const obj: any = {};
        for (const [k, fv] of Object.entries(fields)) obj[k] = fromFirestoreValue(fv);
        return obj;
    }
    return null;
}

export function docToPlain(doc: any): any {
    const name = doc.name || "";
    const docId = name.split("/").pop();
    const fields = doc.fields || {};
    const out: any = { id: docId };
    for (const [k, v] of Object.entries(fields)) out[k] = fromFirestoreValue(v);

    // MIGRATION: Support old schema (word/meaning) to new schema (front/back/meta)
    if (out.word && !out.front) {
        out.front = out.word;
        out.meta = out.meta || {};
        out.meta.meaning = out.meaning;
        out.back = out.meaning; // Default back to meaning for old vocab
        out.quizMode = out.quizMode || 'vocab_to_meaning';
    }

    return out;
}

export async function firestoreFetch(path: string, { method = "GET", idToken, body, updateMask }: { method?: string; idToken: string; body?: any; updateMask?: string[] }) {
    const url = new URL(firestoreBaseUrl() + path);
    if (updateMask?.length) {
        for (const field of updateMask) url.searchParams.append("updateMask.fieldPaths", field);
    }

    const resp = await fetch(url.toString(), {
        method,
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined
    });

    if (!resp.ok) throw new Error(`Firestore ${method} failed: ${resp.status}`);
    if (resp.status === 204) return null;
    return resp.json();
}
