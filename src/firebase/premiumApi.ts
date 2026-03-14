import { EntitlementManager } from "../EntitlementManager";
import { getAuth } from "./auth";
import { toFirestoreValue, docToPlain, firestoreFetch } from "./firestore";
import { getUserSettings, setUserSettings } from "./vocabApi";

// ------------------------------
// Products
// ------------------------------
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

// ------------------------------
// Entitlements
// ------------------------------
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

// ------------------------------
// License Keys
// ------------------------------
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
