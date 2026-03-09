# Premium System - Quick Reference

## 🎯 Khái niệm cơ bản

### Entitlement Queue
Danh sách quyền lợi được xếp theo timeline, tự động pause/resume theo priority.

### Priority Levels
- `tier_free`: 0 (mặc định)
- `tier_basic`: 1
- `tier_pro`: 3

### Auto-Cleanup
Items đã hết hạn (`end <= now`) tự động bị xóa khỏi queue.

---

## 🔄 Pause/Resume Logic

**Khi redeem gói có priority cao hơn:**
```
1. Tính unusedTime = totalTime - usedTime
2. Pause gói cũ với unusedTime
3. Insert gói mới vào vị trí hiện tại
4. Resume gói cũ sau khi gói mới hết hạn
```

**Ví dụ:**
```
Day 0: Basic 30d → Queue: [Basic: 0-30]
Day 5: Pro 30d   → Queue: [Pro: 5-35, Basic: 35-60]
                           ↑ active  ↑ paused 25d
```

---

## 🧪 Test Commands

```bash
# Setup Firestore data
node scripts/setup-premium-data.js

# Build extension
npm run build

# Load extension
chrome://extensions → Load unpacked → dist/
```

---

## 🔑 Test Keys

- `TEST-BASIC-001`: Basic 30 days
- `TEST-BASIC-002`: Basic 90 days  
- `TEST-PRO-001`: Pro 30 days
- `TEST-PRO-002`: Pro 90 days

---

## 📊 Queue Structure

```typescript
entitlementQueue: [
  {
    id: "tier_pro",
    start: 1770603476755,  // timestamp
    end: 1773195476755     // timestamp
  },
  {
    id: "tier_basic",
    start: 1773195476755,
    end: 1775787149925
  }
]
```

---

## ✅ Feature Checking

```typescript
// Get active entitlement
const current = EntitlementManager.getCurrentEntitlement(queue);

// Resolve features (with inheritance)
const features = await EntitlementManager.resolveFeatures(
  current?.id || "tier_free",
  getEntitlementById
);

// Check access
const hasAccess = features.includes("access_n3");
```

---

## 🐛 Debug Tips

**Check queue:**
```
Firestore → users/{uid}/settings → entitlementQueue
```

**Calculate duration:**
```javascript
const days = (item.end - item.start) / (24 * 60 * 60 * 1000);
```

**Check active:**
```javascript
const now = Date.now();
const active = queue.find(i => i.start <= now && now < i.end);
```

---

## 🔒 Security Rules

```javascript
// Products & Entitlements: public read, admin write
match /products/{id} {
  allow read: if true;
  allow write: if false;
}

// License Keys: auth read, update for redemption
match /license_keys/{id} {
  allow read, update: if request.auth != null;
}

// User Settings: owner only
match /users/{uid}/settings {
  allow read, write: if request.auth.uid == uid;
}
```

---

## 📁 Key Files

- `src/EntitlementManager.ts` - Core queue logic
- `src/firebaseClient.ts` - Premium APIs
- `src/background.ts` - Feature gating
- `src/options.ts` - UI integration
- `docs/premium_system_complete.md` - Full docs
