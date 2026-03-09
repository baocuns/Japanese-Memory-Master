import { VocabItem, UserSettings, AuthData, QuizMode, SystemVocabProgress, SubscribedList } from "./types";
import { EntitlementManager } from "./EntitlementManager";

export const FIREBASE_PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
export const FIREBASE_API_KEY = import.meta.env.VITE_FIREBASE_API_KEY;
export const GOOGLE_OAUTH_CLIENT_ID = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID;

const FIRESTORE_DB = "(default)";
const AUTH_STORAGE_KEY = "fbAuth";

function nowMs(): number {
  return Date.now();
}

function getFromStorageLocal(keys: string[]): Promise<any> {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function setToStorageLocal(obj: any): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

async function getStoredAuth(): Promise<AuthData | null> {
  const res = await getFromStorageLocal([AUTH_STORAGE_KEY]);
  return res[AUTH_STORAGE_KEY] || null;
}

async function storeAuth(auth: AuthData): Promise<void> {
  await setToStorageLocal({ [AUTH_STORAGE_KEY]: auth });
}

async function clearAuth(): Promise<void> {
  await setToStorageLocal({ [AUTH_STORAGE_KEY]: null });
}

function assertConfig() {
  if (!FIREBASE_API_KEY || FIREBASE_API_KEY.includes("YOUR")) {
    throw new Error("Bạn chưa điền VITE_FIREBASE_API_KEY trong file .env");
  }
  if (!FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID.includes("YOUR")) {
    throw new Error("Bạn chưa điền VITE_FIREBASE_PROJECT_ID trong file .env");
  }
  if (
    !GOOGLE_OAUTH_CLIENT_ID ||
    GOOGLE_OAUTH_CLIENT_ID.includes("YOUR")
  ) {
    throw new Error("Bạn chưa điền VITE_GOOGLE_OAUTH_CLIENT_ID trong file .env");
  }
}

// ------------------------------
// 1) Chrome Identity helpers
// ------------------------------
function getChromeAuthToken(interactive: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message));
      if (typeof token !== 'string') return reject(new Error("Không lấy được Google access token."));
      resolve(token);
    });
  });
}

function removeCachedChromeToken(token: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

function launchWebAuthFlow(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirectUrl) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message));
      if (!redirectUrl) return reject(new Error("Không nhận được redirectUrl từ WebAuthFlow."));
      resolve(redirectUrl);
    });
  });
}

// ------------------------------
// 2) PKCE utilities
// ------------------------------
function base64UrlEncode(bytes: Uint8Array): string {
  const bin = String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomBytes(len: number): Uint8Array {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return arr;
}

async function sha256Bytes(str: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
}

async function makePkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64UrlEncode(randomBytes(64));
  const challengeBytes = await sha256Bytes(verifier);
  const challenge = base64UrlEncode(challengeBytes);
  return { verifier, challenge };
}

function parseUrlParams(url: string): Record<string, string> {
  const u = new URL(url);
  const params: Record<string, string> = {};
  u.searchParams.forEach((v, k) => {
    params[k] = v;
  });
  return params;
}

// ------------------------------
// 3) OAuth Conversions
// ------------------------------
async function exchangeAuthCodeToGoogleTokens({ code, codeVerifier, redirectUri }: { code: string; codeVerifier: string; redirectUri: string }) {
  const tokenUrl = "https://oauth2.googleapis.com/token";
  const body = new URLSearchParams({
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier
  });

  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Google token exchange failed: ${resp.status} ${text}`);
  }
  return resp.json();
}

async function exchangeGoogleTokenToFirebase(accessToken: string): Promise<AuthData> {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${encodeURIComponent(FIREBASE_API_KEY)}`;
  const payload = {
    postBody: `access_token=${encodeURIComponent(accessToken)}&providerId=google.com`,
    requestUri: "http://localhost",
    returnSecureToken: true,
    returnIdpCredential: false
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`signInWithIdp failed: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  const expiresInSec = parseInt(data.expiresIn, 10);
  const expiresAtMs = nowMs() + expiresInSec * 1000;

  return {
    uid: data.localId,
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAtMs,
    provider: "google",
    profile: {
      email: data.email || null,
      displayName: data.displayName || null,
      photoUrl: data.photoUrl || null
    }
  };
}

// ------------------------------
// 5) Sign-in strategies
// ------------------------------
export async function signInWithGoogleInteractive(): Promise<AuthData> {
  assertConfig();
  try {
    const accessToken = await getChromeAuthToken(true);
    const auth = await exchangeGoogleTokenToFirebase(accessToken);
    await storeAuth(auth);
    return auth;
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (msg.includes("not supported") || msg.includes("identity api is not available")) {
      return await signInWithGoogle_WebAuthFlow();
    }
    throw e;
  }
}

async function signInWithGoogle_WebAuthFlow(): Promise<AuthData> {
  const redirectUri = chrome.identity.getRedirectURL("oauth2");
  const { verifier, challenge } = await makePkcePair();

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", GOOGLE_OAUTH_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  const redirect = await launchWebAuthFlow(authUrl.toString());
  const params = parseUrlParams(redirect);

  if (params.error) throw new Error(`Google OAuth error: ${params.error}`);
  const code = params.code;
  if (!code) throw new Error("Không nhận được authorization code.");

  const tokens = await exchangeAuthCodeToGoogleTokens({ code, codeVerifier: verifier, redirectUri });
  const auth = await exchangeGoogleTokenToFirebase(tokens.access_token);
  await storeAuth(auth);
  return auth;
}

export async function signInWithEmailPassword(email: string, password: string): Promise<AuthData> {
  assertConfig();
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(FIREBASE_API_KEY)}`;
  const payload = {
    email,
    password,
    returnSecureToken: true
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const errorData = await resp.json();
    throw new Error(errorData.error?.message || "Đăng nhập thất bại.");
  }

  const data = await resp.json();
  const expiresInSec = parseInt(data.expiresIn, 10);
  const expiresAtMs = nowMs() + expiresInSec * 1000;

  const auth: AuthData = {
    uid: data.localId,
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAtMs,
    provider: "password",
    profile: {
      email: data.email || null,
      displayName: data.displayName || null,
      photoUrl: null
    }
  };
  await storeAuth(auth);
  return auth;
}

export async function signUpWithEmailPassword(email: string, password: string): Promise<AuthData> {
  assertConfig();
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(FIREBASE_API_KEY)}`;
  const payload = {
    email,
    password,
    returnSecureToken: true
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const errorData = await resp.json();
    throw new Error(errorData.error?.message || "Đăng ký thất bại.");
  }

  const data = await resp.json();
  const expiresInSec = parseInt(data.expiresIn, 10);
  const expiresAtMs = nowMs() + expiresInSec * 1000;

  const auth: AuthData = {
    uid: data.localId,
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAtMs,
    provider: "password",
    profile: {
      email: data.email || null,
      displayName: data.displayName || null,
      photoUrl: null
    }
  };
  await storeAuth(auth);
  return auth;
}

export async function signOutGoogle(): Promise<boolean> {
  try {
    const token = await getChromeAuthToken(false);
    await removeCachedChromeToken(token);
  } catch (_) { }
  await clearAuth();
  return true;
}

// ------------------------------
// 6) Token Refresh & Auth
// ------------------------------
async function refreshIdToken(refreshToken: string): Promise<AuthData> {
  const url = `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(FIREBASE_API_KEY)}`;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!resp.ok) throw new Error(`Token refresh failed: ${resp.status}`);

  const data = await resp.json();
  const expiresAtMs = nowMs() + parseInt(data.expires_in, 10) * 1000;
  const stored = (await getStoredAuth()) || ({} as any);
  const auth = { ...stored, idToken: data.access_token, refreshToken: data.refresh_token, expiresAtMs };
  await storeAuth(auth);
  return auth;
}

export async function getAuth(): Promise<AuthData> {
  assertConfig();
  const stored = await getStoredAuth();
  if (!stored || !stored.refreshToken) throw new Error("Chưa đăng nhập.");
  const shouldRefresh = !stored.expiresAtMs || stored.expiresAtMs - nowMs() < 60_000;
  if (shouldRefresh) return refreshIdToken(stored.refreshToken);
  return stored;
}

export async function getAuthMaybe(): Promise<AuthData | null> {
  try { return await getAuth(); } catch (_) { return null; }
}

// ------------------------------
// 8) Firestore REST helpers
// ------------------------------
function firestoreBaseUrl() {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(FIREBASE_PROJECT_ID)}/databases/${encodeURIComponent(FIRESTORE_DB)}/documents`;
}

function toFirestoreValue(value: any): any {
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

function fromFirestoreValue(v: any): any {
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

function docToPlain(doc: any): any {
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

async function firestoreFetch(path: string, { method = "GET", idToken, body, updateMask }: { method?: string; idToken: string; body?: any; updateMask?: string[] }) {
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

// ------------------------------
// 9) App APIs
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

/** 
 * PERSONAL VOCABULARY (customVocab)
 */
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

/**
 * SUBSCRIBED LISTS (N5, N4, etc.)
 */
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

/**
 * SYSTEM PROGRESS (Progress on Library items)
 */
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

/**
 * SYSTEM VOCABULARY (Library) - Keeping for reference if we decide to use shared Firestore
 */
export async function listSystemVocab(category: string): Promise<VocabItem[]> {
  const auth = await getAuth();
  const res = await firestoreFetch(`/systemVocab/${category}/vocab?pageSize=1000`, { idToken: auth.idToken });
  return (res.documents || []).map(docToPlain);
}

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

/**
 * PREMIUM SYSTEM APIs
 */

// Products
export async function listProducts(): Promise<any[]> {
  const auth = await getAuth();
  const res = await firestoreFetch(`/products`, { idToken: auth.idToken });
  return (res.documents || []).map(docToPlain);
}

export async function getProductById(id: string): Promise<any | null> {
  const auth = await getAuth();
  try {
    const doc = await firestoreFetch(`/products/${encodeURIComponent(id)}`, { idToken: auth.idToken });
    return docToPlain(doc);
  } catch (_) { return null; }
}

// Entitlements
export async function listEntitlements(): Promise<any[]> {
  const auth = await getAuth();
  const res = await firestoreFetch(`/entitlements`, { idToken: auth.idToken });
  return (res.documents || []).map(docToPlain);
}

export async function getEntitlementById(id: string): Promise<any | null> {
  const auth = await getAuth();
  try {
    const doc = await firestoreFetch(`/entitlements/${encodeURIComponent(id)}`, { idToken: auth.idToken });
    return docToPlain(doc);
  } catch (_) { return null; }
}

// License Keys
export async function validateLicenseKey(key: string): Promise<any | null> {
  const auth = await getAuth();
  try {
    const doc = await firestoreFetch(`/license_keys/${encodeURIComponent(key)}`, { idToken: auth.idToken });
    return docToPlain(doc);
  } catch (_) { return null; }
}

export async function redeemLicenseKey(key: string): Promise<{ success: boolean; message: string; entitlementQueue?: any[] }> {
  const auth = await getAuth();

  // 1. Validate key
  const keyDoc = await validateLicenseKey(key);
  if (!keyDoc) {
    return { success: false, message: "License key không tồn tại" };
  }

  if (keyDoc.isUsed) {
    return { success: false, message: "License key đã được sử dụng" };
  }

  // 2. Get product info
  const product = await getProductById(keyDoc.productId);
  if (!product) {
    return { success: false, message: "Sản phẩm không tồn tại" };
  }

  if (!product.isActive) {
    return { success: false, message: "Sản phẩm không còn khả dụng" };
  }

  // 3. Get current user settings
  const settings = await getUserSettings();
  const currentQueue = settings?.entitlementQueue || [];

  // 4. Add entitlement to queue
  const newQueue = await EntitlementManager.addEntitlementToQueue(
    currentQueue,
    product.entitlementId,
    product.durationDays,
    getEntitlementById
  );

  // 5. Update user settings
  await setUserSettings({ entitlementQueue: newQueue });

  // 6. Mark key as used
  const body = {
    fields: {
      isUsed: toFirestoreValue(true),
      usedBy: toFirestoreValue(auth.uid),
      usedAt: toFirestoreValue(new Date().toISOString())
    }
  };
  await firestoreFetch(`/license_keys/${encodeURIComponent(key)}`, {
    method: "PATCH",
    idToken: auth.idToken,
    body,
    updateMask: ["isUsed", "usedBy", "usedAt"]
  });

  return {
    success: true,
    message: `Kích hoạt thành công gói ${product.name}!`,
    entitlementQueue: newQueue
  };
}

