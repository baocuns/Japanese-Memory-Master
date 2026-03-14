// ------------------------------
// PKCE utilities
// ------------------------------

export function base64UrlEncode(bytes: Uint8Array): string {
    const bin = String.fromCharCode(...bytes);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function randomBytes(len: number): Uint8Array {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return arr;
}

export async function sha256Bytes(str: string): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return new Uint8Array(digest);
}

export async function makePkcePair(): Promise<{ verifier: string; challenge: string }> {
    const verifier = base64UrlEncode(randomBytes(64));
    const challengeBytes = await sha256Bytes(verifier);
    const challenge = base64UrlEncode(challengeBytes);
    return { verifier, challenge };
}

export function parseUrlParams(url: string): Record<string, string> {
    const u = new URL(url);
    const params: Record<string, string> = {};
    u.searchParams.forEach((v, k) => {
        params[k] = v;
    });
    return params;
}
