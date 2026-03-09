/**
 * Script to setup Firestore data for Premium System
 * Run this script to populate entitlements, products, and license keys
 * 
 * Usage:
 * 1. Update FIREBASE_PROJECT_ID and FIREBASE_API_KEY below
 * 2. Run: node scripts/setup-premium-data.js
 */

const FIREBASE_PROJECT_ID = "vocabulary-pulse-learning"; // TODO: Replace with your project ID
const FIREBASE_API_KEY = "AIzaSyARwh9BDWdwE3HL5vVoqdiyFad2pRD2VIg"; // TODO: Replace with your API key

// Sample data
const ENTITLEMENTS = [
    {
        id: "tier_free",
        data: {
            level: 0,
            features: ["access_n5"],
            inherit: null,
            name: "Miễn phí"
        }
    },
    {
        id: "tier_basic",
        data: {
            level: 1,
            features: ["access_n4", "no_ads"],
            inherit: "tier_free",
            name: "Gói Basic"
        }
    },
    {
        id: "tier_pro",
        data: {
            level: 3,
            features: ["access_n3", "access_n2", "access_n1", "audio", "ai_chat"],
            inherit: "tier_basic",
            name: "Gói Pro"
        }
    }
];

const PRODUCTS = [
    {
        id: "pkg_basic_30d",
        data: {
            name: "Gói Basic (1 Tháng)",
            entitlementId: "tier_basic",
            durationDays: 30,
            price: 50000,
            currency: "VND",
            isActive: true
        }
    },
    {
        id: "pkg_basic_90d",
        data: {
            name: "Gói Basic (3 Tháng)",
            entitlementId: "tier_basic",
            durationDays: 90,
            price: 120000,
            currency: "VND",
            isActive: true
        }
    },
    {
        id: "pkg_pro_30d",
        data: {
            name: "Gói Pro (1 Tháng)",
            entitlementId: "tier_pro",
            durationDays: 30,
            price: 100000,
            currency: "VND",
            isActive: true
        }
    },
    {
        id: "pkg_pro_90d",
        data: {
            name: "Gói Pro (3 Tháng)",
            entitlementId: "tier_pro",
            durationDays: 90,
            price: 250000,
            currency: "VND",
            isActive: true
        }
    }
];

const LICENSE_KEYS = [
    {
        id: "TEST-BASIC-001",
        data: {
            productId: "pkg_basic_30d",
            isUsed: false,
            usedBy: null,
            usedAt: null,
            createdAt: new Date().toISOString()
        }
    },
    {
        id: "TEST-BASIC-002",
        data: {
            productId: "pkg_basic_90d",
            isUsed: false,
            usedBy: null,
            usedAt: null,
            createdAt: new Date().toISOString()
        }
    },
    {
        id: "TEST-PRO-001",
        data: {
            productId: "pkg_pro_30d",
            isUsed: false,
            usedBy: null,
            usedAt: null,
            createdAt: new Date().toISOString()
        }
    },
    {
        id: "TEST-PRO-002",
        data: {
            productId: "pkg_pro_90d",
            isUsed: false,
            usedBy: null,
            usedAt: null,
            createdAt: new Date().toISOString()
        }
    }
];

// Helper function to convert to Firestore format
function toFirestoreValue(val) {
    if (val === null) return { nullValue: null };
    if (typeof val === "string") return { stringValue: val };
    if (typeof val === "number") {
        return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
    }
    if (typeof val === "boolean") return { booleanValue: val };
    if (Array.isArray(val)) {
        return { arrayValue: { values: val.map(toFirestoreValue) } };
    }
    if (typeof val === "object") {
        const fields = {};
        for (const [k, v] of Object.entries(val)) {
            fields[k] = toFirestoreValue(v);
        }
        return { mapValue: { fields } };
    }
    return { stringValue: String(val) };
}

// Create document in Firestore
async function createDocument(collection, docId, data) {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${docId}?key=${FIREBASE_API_KEY}`;

    const fields = {};
    for (const [key, value] of Object.entries(data)) {
        fields[key] = toFirestoreValue(value);
    }

    const response = await fetch(url, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ fields })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create ${collection}/${docId}: ${error}`);
    }

    return response.json();
}

// Main setup function
async function setupPremiumData() {
    console.log("🚀 Starting Firestore Premium System setup...\n");

    // Check configuration
    if (FIREBASE_PROJECT_ID === "your-project-id" || FIREBASE_API_KEY === "your-api-key") {
        console.error("❌ ERROR: Please update FIREBASE_PROJECT_ID and FIREBASE_API_KEY in the script!");
        process.exit(1);
    }

    try {
        // Create Entitlements
        console.log("📝 Creating Entitlements...");
        for (const { id, data } of ENTITLEMENTS) {
            await createDocument("entitlements", id, data);
            console.log(`  ✅ Created entitlement: ${id} (${data.name})`);
        }

        // Create Products
        console.log("\n📦 Creating Products...");
        for (const { id, data } of PRODUCTS) {
            await createDocument("products", id, data);
            console.log(`  ✅ Created product: ${id} (${data.name})`);
        }

        // Create License Keys
        console.log("\n🔑 Creating License Keys...");
        for (const { id, data } of LICENSE_KEYS) {
            await createDocument("license_keys", id, data);
            console.log(`  ✅ Created license key: ${id} (${data.productId})`);
        }

        console.log("\n✨ Setup completed successfully!");
        console.log("\n📋 Summary:");
        console.log(`  - ${ENTITLEMENTS.length} entitlements created`);
        console.log(`  - ${PRODUCTS.length} products created`);
        console.log(`  - ${LICENSE_KEYS.length} license keys created`);
        console.log("\n🧪 Test Keys:");
        console.log("  - TEST-BASIC-001 (Basic 30 days)");
        console.log("  - TEST-BASIC-002 (Basic 90 days)");
        console.log("  - TEST-PRO-001 (Pro 30 days)");
        console.log("  - TEST-PRO-002 (Pro 90 days)");

    } catch (error) {
        console.error("\n❌ Setup failed:", error.message);
        process.exit(1);
    }
}

// Run setup
setupPremiumData();
