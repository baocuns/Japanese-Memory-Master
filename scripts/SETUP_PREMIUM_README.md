# Setup Premium System Data

This script populates your Firestore database with sample data for the Premium System.

## Prerequisites

- Node.js installed
- Firebase project created
- Firestore enabled in your Firebase project

## Configuration

1. Open `scripts/setup-premium-data.js`
2. Update these constants:
   ```javascript
   const FIREBASE_PROJECT_ID = "your-project-id";
   const FIREBASE_API_KEY = "your-api-key";
   ```

### Where to find these values:

- **Project ID**: Firebase Console → Project Settings → General → Project ID
- **API Key**: Firebase Console → Project Settings → General → Web API Key

## Running the Script

```bash
node scripts/setup-premium-data.js
```

## What Gets Created

### Entitlements (3 tiers)
- `tier_free`: Level 0, access to N5
- `tier_basic`: Level 1, access to N4 + no ads (inherits tier_free)
- `tier_pro`: Level 3, access to N1-N3 + audio + AI chat (inherits tier_basic)

### Products (4 packages)
- `pkg_basic_30d`: Basic 30 days - 50,000 VND
- `pkg_basic_90d`: Basic 90 days - 120,000 VND
- `pkg_pro_30d`: Pro 30 days - 100,000 VND
- `pkg_pro_90d`: Pro 90 days - 250,000 VND

### License Keys (4 test keys)
- `TEST-BASIC-001`: Basic 30 days
- `TEST-BASIC-002`: Basic 90 days
- `TEST-PRO-001`: Pro 30 days
- `TEST-PRO-002`: Pro 90 days

## Testing

After running the script:

1. Build and load your extension
2. Login to the extension
3. Go to Options page
4. Scroll to "🔑 Kích hoạt Premium"
5. Enter one of the test keys (e.g., `TEST-PRO-001`)
6. Click "Kích hoạt"
7. Verify that N1-N4 are now unlocked

## Security Rules

Make sure your Firestore security rules allow reading these collections:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Products and Entitlements are public (read-only)
    match /products/{productId} {
      allow read: if true;
      allow write: if false; // Only admins via console
    }
    
    match /entitlements/{entitlementId} {
      allow read: if true;
      allow write: if false; // Only admins via console
    }
    
    // License keys can be read by authenticated users
    match /license_keys/{keyId} {
      allow read: if request.auth != null;
      allow update: if request.auth != null; // For marking as used
      allow create, delete: if false; // Only admins via console
    }
    
    // User data
    match /users/{uid}/settings {
      allow read, write: if request.auth.uid == uid;
    }
  }
}
```

## Troubleshooting

### Error: "Failed to create..."
- Check that FIREBASE_PROJECT_ID and FIREBASE_API_KEY are correct
- Verify Firestore is enabled in your Firebase project
- Check your internet connection

### Error: "Permission denied"
- Update your Firestore security rules (see above)
- Make sure you're using the correct API key

## Adding More Keys

To generate more license keys, you can:

1. **Manual**: Add entries to the `LICENSE_KEYS` array in the script
2. **Random**: Use a key generator (e.g., `crypto.randomBytes(16).toString('hex')`)
3. **Admin Panel**: Build a separate admin tool (future enhancement)

Example format:
```javascript
{
  id: "CUSTOM-KEY-123",
  data: {
    productId: "pkg_pro_30d",
    isUsed: false,
    usedBy: null,
    usedAt: null,
    createdAt: new Date().toISOString()
  }
}
```
