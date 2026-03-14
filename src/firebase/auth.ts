import { AuthData } from "../types";
import { FIREBASE_API_KEY, GOOGLE_OAUTH_CLIENT_ID, assertConfig } from "./config";
import { nowMs, getStoredAuth, storeAuth, clearAuth } from "./storage";
import { makePkcePair, parseUrlParams } from "./pkce";

// ------------------------------
// Chrome Identity helpers
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
// OAuth Conversions
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
// Sign-in strategies
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
// Token Refresh & Auth
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
