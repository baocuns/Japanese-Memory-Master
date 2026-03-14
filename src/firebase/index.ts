// Barrel export — re-export all public APIs from firebase modules

// Config
export { FIREBASE_PROJECT_ID, FIREBASE_API_KEY, GOOGLE_OAUTH_CLIENT_ID } from "./config";

// Auth
export {
    signInWithGoogleInteractive,
    signInWithEmailPassword,
    signUpWithEmailPassword,
    signOutGoogle,
    getAuth,
    getAuthMaybe
} from "./auth";

// Firestore helpers
export { toFirestoreValue, fromFirestoreValue, docToPlain, firestoreFetch } from "./firestore";

// Vocab & App APIs
export {
    getUserSettings,
    setUserSettings,
    listVocab,
    addVocab,
    patchVocab,
    getVocabById,
    deleteVocab,
    listSubscribedLists,
    subscribeToList,
    listSystemProgress,
    patchSystemProgress,
    getSystemProgressById,
    createSystemProgress,
    listSystemVocab
} from "./vocabApi";

// Premium APIs
export {
    listProducts,
    getProductById,
    listEntitlements,
    getEntitlementById,
    validateLicenseKey,
    redeemLicenseKey
} from "./premiumApi";

// Migration
export { migrateFromOldFirestoreCollection, migrateFromChromeSyncIfNeeded } from "./migration";
