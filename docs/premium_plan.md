# Kế hoạch Hệ thống Premium (Entitlement & Product Model)

## 📌 1. Triết lý Thiết kế
Hệ thống áp dụng tư duy quản lý hiện đại học hỏi từ Google Play Billing, tập trung vào sự tách biệt giữa **Sản phẩm thương mại (Product)** và **Quyền lợi kỹ thuật (Entitlement)**.

- **License Key (Product):** Cái user mua (Ví dụ: Key Basic 30 ngày).
- **Entitlement (Quyền):** Cái user nhận được (Ví dụ: Quyền truy cập mức độ Basic).
- **Feature (Chức năng):** Cái code kiểm tra (Ví dụ: `access_n4`, `no_ads`).

---

## 🔑 2. Cấu trúc Firestore

### A. Collection `products` (Danh mục gói bán)
Định nghĩa các SKU (Stock Keeping Unit) mà hệ thống hỗ trợ.

```json
// Document ID: "pkg_basic_30d"
{
  "name": "Gói Basic (1 Tháng)",
  "entitlementId": "tier_basic", // Kích hoạt quyền lợi nào
  "durationDays": 30,
  "price": 50000,
  "isActive": true
}
```

### B. Collection `entitlements` (Định nghĩa Quyền lợi)
Bảng ánh xạ từ cấp độ quyền user sang danh sách tính năng cụ thể (Remote Config).

```json
// Document ID: "tier_free"
{
  "level": 0,
  "features": ["access_n5"],
  "inherit": null
}

// Document ID: "tier_basic"
{
  "level": 1,
  "features": ["access_n4", "no_ads"], 
  "inherit": "tier_free" // Tự động bao gồm features của free
}

// Document ID: "tier_pro"
{
  "level": 3,
  "features": ["access_n3", "access_n2", "access_n1", "audio", "ai_chat"],
  "inherit": "tier_basic"
}
```

### C. Collection `license_keys` (Kho thẻ nạp)
```json
{
  "key": "ABCD-1234-XYZW",
  "productId": "pkg_pro_30d", // Tham chiếu đến Product
  "isUsed": false,
  "usedBy": null,
  "usedAt": null
}
```

---

## ⏳ 3. Logic Hàng Đợi (Entitlement Queue)

Trong User Settings, ta lưu một Queue các quyền lợi (Entitlements) thay vì tên gói.

**User Settings:**
```json
"entitlementQueue": [
  // User từng nạp gói Basic
  { 
    "dId": "tier_basic", 
    "start": 1700000000000, 
    "end": 1702592000000 
  },
  // User nạp đè gói Pro (Chen ngang)
  { 
    "id": "tier_pro", 
    "start": 1700500000000, // Bắt đầu sau Basic 5 ngày
    "end": 1705684000000 
  }
]
```

### Quy tắc Xử lý khi Nạp Key:
1.  Từ `Key` -> Lấy `ProductId`.
2.  Từ `ProductId` -> Lấy `EntitlementId` và `Duration`.
3.  Gọi hàm **Queue Calculaton**:
    *   Lấy mức độ ưu tiên (`level`) của Entitlement mới từ config.
    *   So sánh với Entitlement đang chạy hiện tại.
    *   Thực hiện logic **Cắt & Chèn** (như phiên bản trước): Ưu tiên Level cao chạy trước, Level thấp lùi lại.

---

## 🛡️ 4. Quy trình Kiểm tra Quyền (Client Side)

Khi User thực hiện hành động (Ví dụ: Mở bài học N3):

```typescript
// B1. Xác định Entitlement hiện tại
const currentEntitlementId = getCurrentActiveEntitlement(user.entitlementQueue); // VD: "tier_basic"

// B2. Tải config (đã cache)
const config = await getEntitlementConfig(currentEntitlementId); 
// -> Trả về mảng features đã merge cả kế thừa: ['access_n5', 'access_n4', 'no_ads']

// B3. Kiểm tra Feature
if (config.features.includes('access_n3')) {
  // Cho phép
} else {
  // Chặn & Upsell
}
```

---

## 🛠️ 5. Lộ trình triển khai

### Phase 1: Data Infrastructure
- Cấu hình `products` và `entitlements` trên Firestore.
- Tạo một số Key test.

### Phase 2: Core Logic (SDK)
- Update `types.ts`.
- Viết `EntitlementManager` class: Chịu trách nhiệm tính toán Queue và resolve Feature Flag.
- Update `firebaseClient.ts` để gánh logic nạp thẻ mới.

### Phase 3: UI & Integration
- Update Options Page: Hiển thị Timeline quyền lợi.
- Gắn Feature Flag vào các nút bấm (N4, N3...).
