export const FIREBASE_PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
export const FIREBASE_API_KEY = import.meta.env.VITE_FIREBASE_API_KEY;
export const GOOGLE_OAUTH_CLIENT_ID = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID;

export const FIRESTORE_DB = "(default)";
export const AUTH_STORAGE_KEY = "fbAuth";

export function assertConfig() {
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
