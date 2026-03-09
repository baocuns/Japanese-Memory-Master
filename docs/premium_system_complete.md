# Premium System - Complete Documentation

## 🎯 Overview

Hệ thống Premium cho phép quản lý quyền lợi người dùng thông qua **Entitlement Queue** với khả năng pause/resume tự động khi có nhiều gói với priority khác nhau.

---

## 📊 Core Concepts

### 1. Product (Sản phẩm)
Định nghĩa gói premium có thể mua/kích hoạt:
```typescript
{
  id: "pkg_pro_30d",
  name: "Gói Pro (1 Tháng)",
  entitlementId: "tier_pro",  // Quyền lợi được cấp
  durationDays: 30,            // Thời hạn
  price: 100000,
  currency: "VND",
  isActive: true
}
```

### 2. Entitlement (Quyền lợi)
Định nghĩa tier với features và priority:
```typescript
{
  id: "tier_pro",
  level: 3,                    // Priority level (cao hơn = ưu tiên hơn)
  features: ["access_n3", "access_n2", "access_n1", "audio", "ai_chat"],
  inherit: "tier_basic",       // Kế thừa features từ tier khác
  name: "Gói Pro"
}
```

**Priority Levels:**
- `tier_free`: level 0
- `tier_basic`: level 1
- `tier_pro`: level 3

### 3. Entitlement Queue
Danh sách các quyền lợi được xếp theo timeline:
```typescript
entitlementQueue: [
  { id: "tier_pro", start: 1770603476755, end: 1773195476755 },
  { id: "tier_basic", start: 1773195476755, end: 1775787149925 }
]
```

---

## 🔄 Pause/Resume Logic

### Nguyên tắc hoạt động

Khi redeem gói mới có **priority cao hơn** gói đang active:
1. ✅ **Pause** gói cũ (đóng băng thời gian chưa dùng)
2. ✅ **Insert** gói mới vào vị trí hiện tại
3. ✅ **Resume** gói cũ sau khi gói mới hết hạn

### Ví dụ chi tiết

**Scenario: Redeem Basic → Pro**
```
Day 0: Redeem Basic 30 days
  Queue: [Basic: day 0-30]
  Active: Basic

Day 5: Redeem Pro 30 days (còn 25 ngày Basic chưa dùng)
  
  Tính toán:
  - usedTime = 5 days (đã dùng)
  - totalTime = 30 days
  - unusedTime = 30 - 5 = 25 days (chưa dùng)
  
  Queue sau khi pause:
  [
    Basic: day 0-5 (đã dùng, sẽ bị xóa vì expired),
    Pro: day 5-35 (active),
    Basic: day 35-60 (paused, 25 ngày còn lại)
  ]
  
  Queue sau filter expired:
  [
    Pro: day 5-35,
    Basic: day 35-60
  ]
  
  Active: Pro

Day 35: Pro hết hạn, Basic tự động resume
  Queue: [Basic: day 35-60]
  Active: Basic (25 ngày còn lại)

Day 60: Tất cả hết hạn
  Queue: []
  Active: tier_free (fallback)
```

### Code Implementation

```typescript
// Tính thời gian chưa dùng
const usedTime = Math.max(0, newStart - item.start);
const totalTime = item.end - item.start;
const unusedTime = totalTime - usedTime;

// Pause nếu còn thời gian chưa dùng
if (unusedTime > 0) {
    result.push({ 
        ...item, 
        start: newEnd,              // Bắt đầu sau khi gói mới hết
        end: newEnd + unusedTime    // Kéo dài đúng thời gian còn lại
    });
}
```

---

## 🧹 Auto-Cleanup (Expired Items)

Queue tự động xóa các items đã hết hạn mỗi khi:
- Redeem license key mới
- Cập nhật queue

```typescript
return result
    .sort((a, b) => a.start - b.start)
    .filter(item => item.end > now);  // Chỉ giữ items chưa hết hạn
```

**Lợi ích:**
- ✅ Queue luôn gọn gàng
- ✅ Tiết kiệm storage
- ✅ Dễ debug

---

## 🔑 License Key Redemption Flow

```
1. User nhập license key
   ↓
2. Validate key (exists, not used, product active)
   ↓
3. Get product info → entitlementId + durationDays
   ↓
4. Get current queue
   ↓
5. EntitlementManager.addEntitlementToQueue()
   ├─ Compare priority levels
   ├─ Pause/Resume logic
   ├─ Filter expired items
   └─ Return new queue
   ↓
6. Update user settings
   ↓
7. Mark key as used
   ↓
8. UI refresh
```

---

## 🎨 Feature Checking

### Cách kiểm tra quyền

```typescript
// 1. Get current active entitlement
const current = EntitlementManager.getCurrentEntitlement(queue);

// 2. Resolve features (including inheritance)
const features = await EntitlementManager.resolveFeatures(
    current?.id || "tier_free",
    getEntitlementById
);

// 3. Check feature
const hasAccess = features.includes("access_n3");
```

### Feature Inheritance

```
tier_free (level 0)
  features: ["access_n5"]
  ↓
tier_basic (level 1)
  features: ["access_n4", "no_ads"]
  inherit: "tier_free"
  → Resolved: ["access_n5", "access_n4", "no_ads"]
  ↓
tier_pro (level 3)
  features: ["access_n3", "access_n2", "access_n1", "audio", "ai_chat"]
  inherit: "tier_basic"
  → Resolved: ["access_n5", "access_n4", "no_ads", "access_n3", "access_n2", "access_n1", "audio", "ai_chat"]
```

---

## 🧪 Testing Guide

### Setup Test Data

1. **Firestore Collections:**
   ```bash
   node scripts/setup-premium-data.js
   ```

2. **Test Keys:**
   - `TEST-BASIC-001`: Basic 30 days
   - `TEST-BASIC-002`: Basic 90 days
   - `TEST-PRO-001`: Pro 30 days
   - `TEST-PRO-002`: Pro 90 days

### Test Scenarios

#### Test 1: Free User
```
Expected:
- N5: Unlocked
- N4, N3, N2, N1: Locked (👑 Premium badge)
```

#### Test 2: Basic User
```
1. Redeem TEST-BASIC-001
2. Check:
   - N5, N4: Unlocked
   - N3, N2, N1: Locked
   - Queue: [Basic: 30 days]
```

#### Test 3: Upgrade Basic → Pro
```
1. Redeem TEST-BASIC-001
2. Wait 5 minutes
3. Redeem TEST-PRO-001
4. Check:
   - All N5-N1: Unlocked
   - Queue: [Pro: 30d, Basic: ~30d paused]
   - Timeline shows Pro active
```

#### Test 4: Stack Multiple Pro
```
1. Redeem TEST-BASIC-002 (90 days)
2. Redeem TEST-PRO-001 (30 days)
3. Redeem TEST-PRO-002 (90 days)
4. Check:
   - Queue: [Pro#1: 30d, Pro#2: 90d, Basic: 90d]
   - Total: 210 days of benefits
```

#### Test 5: Expired Key
```
1. Try to redeem TEST-BASIC-001 again
2. Expected: Error "License key đã được sử dụng"
```

---

## 🐛 Debugging

### Check Queue in Firestore

```
users/{uid}/settings
  └─ entitlementQueue: [
       { id: "tier_pro", start: ..., end: ... },
       { id: "tier_basic", start: ..., end: ... }
     ]
```

### Calculate Duration

```javascript
const durationMs = item.end - item.start;
const durationDays = durationMs / (24 * 60 * 60 * 1000);
console.log(`Duration: ${durationDays} days`);
```

### Check Active Entitlement

```javascript
const now = Date.now();
const active = queue.find(item => item.start <= now && now < item.end);
console.log('Active:', active?.id || 'tier_free');
```

---

## 📝 API Reference

### EntitlementManager Methods

#### `getEntitlementConfig(id, getEntitlementById)`
Load entitlement config từ Firestore với caching.

#### `resolveFeatures(id, getEntitlementById)`
Resolve tất cả features kèm inheritance chain.

#### `getCurrentEntitlement(queue)`
Tìm entitlement đang active từ queue.

#### `hasFeature(queue, featureId, getEntitlementById)`
Kiểm tra quyền truy cập feature.

#### `addEntitlementToQueue(queue, id, days, getEntitlementById)`
Thêm entitlement vào queue với pause/resume logic.

#### `getEntitlementName(id, getEntitlementById)`
Get human-readable name của entitlement.

### Firebase Client APIs

#### `listProducts()`
Lấy danh sách products.

#### `getProductById(id)`
Lấy product theo ID.

#### `validateLicenseKey(key)`
Validate license key.

#### `redeemLicenseKey(key)`
Redeem license key (main flow).

---

## 🔒 Security

### Firestore Rules

```javascript
// Products - public read
match /products/{productId} {
  allow read: if true;
  allow write: if false;  // Only admin via console
}

// Entitlements - public read
match /entitlements/{entitlementId} {
  allow read: if true;
  allow write: if false;
}

// License Keys - authenticated read, update for redemption
match /license_keys/{keyId} {
  allow read: if request.auth != null;
  allow update: if request.auth != null;
  allow create, delete: if false;
}

// User Settings - owner only
match /users/{uid}/settings {
  allow read, write: if request.auth.uid == uid;
}
```

---

## 🚀 Future Enhancements

1. **Payment Integration**
   - Stripe/PayPal webhook
   - Auto-generate license keys

2. **Admin Panel**
   - Manage products
   - Generate keys
   - View redemption stats

3. **Notifications**
   - Email khi sắp hết hạn
   - Push notification

4. **Refund Logic**
   - Revoke license key
   - Remove from queue

5. **Analytics**
   - Track redemption rates
   - Popular products
   - User retention

---

## 📞 Support

Nếu gặp vấn đề:
1. Check Firestore data
2. Check browser console logs
3. Verify license key status
4. Check queue calculation

**Common Issues:**
- "Permission denied" → Update Firestore Rules
- "Key already used" → Reset key in Firestore
- Queue empty → Check if items expired
- Features not unlocked → Reload extension
