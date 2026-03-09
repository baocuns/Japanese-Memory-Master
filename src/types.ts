export interface VocabItem {
    id: string;
    front: string;
    back: string;
    meta: {
        reading?: string;
        meaning?: string;
        meaningEn?: string;
        meaningVi?: string;
        romaji?: string;
        example?: string;
        audio?: string;
    };
    quizMode: string;
    score: number;
    lastReviewed?: string;
    createdAt: string;
    updatedAt: string;
}

export interface UserSettings {
    quizInterval: number;
    activeWordLimit?: number;
    defaultQuizMode?: QuizMode;
    premium: boolean; // Deprecated: Use entitlementQueue instead
    entitlementQueue?: EntitlementQueueItem[];
    updatedAt?: string;
}

// Premium System Types

export interface Product {
    id: string;
    name: string;
    entitlementId: string;
    durationDays: number;
    price: number;
    isActive: boolean;
}

export interface Entitlement {
    id: string;
    level: number;
    features: string[];
    inherit: string | null;
}

export interface LicenseKey {
    key: string;
    productId: string;
    isUsed: boolean;
    usedBy: string | null;
    usedAt: string | null;
}

export interface EntitlementQueueItem {
    id: string; // entitlementId (e.g., "tier_basic")
    start: number; // timestamp ms
    end: number; // timestamp ms
}

export interface AuthData {
    uid: string;
    idToken: string;
    refreshToken: string;
    expiresAtMs: number;
    provider: string;
    profile: {
        email: string | null;
        displayName: string | null;
        photoUrl: string | null;
    };
}

export interface SystemVocabProgress {
    id: string; // The ID from JSON, e.g., "n5_001"
    score: number;
    lastReviewed?: string;
    updatedAt: string;
}

export interface SubscribedList {
    id: string; // e.g., "N5"
    enabled: boolean;
    addedAt: string;
}

export type QuizMode = 'vocab_to_meaning' | 'meaning_to_vocab' | 'kanji_to_reading' | 'reading_to_kanji' | 'shuffled';
