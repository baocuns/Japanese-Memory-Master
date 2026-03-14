import { AuthData } from "../types";
import { AUTH_STORAGE_KEY } from "./config";

export function nowMs(): number {
    return Date.now();
}

export function getFromStorageLocal(keys: string[]): Promise<any> {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

export function setToStorageLocal(obj: any): Promise<void> {
    return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

export async function getStoredAuth(): Promise<AuthData | null> {
    const res = await getFromStorageLocal([AUTH_STORAGE_KEY]);
    return res[AUTH_STORAGE_KEY] || null;
}

export async function storeAuth(auth: AuthData): Promise<void> {
    await setToStorageLocal({ [AUTH_STORAGE_KEY]: auth });
}

export async function clearAuth(): Promise<void> {
    await setToStorageLocal({ [AUTH_STORAGE_KEY]: null });
}
