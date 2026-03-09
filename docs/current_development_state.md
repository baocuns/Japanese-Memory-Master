# Project Development State: Japanese Memory Master

**Cập nhật lần cuối:** 2026-02-04

Tài liệu này ghi lại trạng thái hiện tại của dự án để AI và Developer có thể tiếp nối công việc một cách liền mạch trong các phiên chat mới.

---

## 🚀 Trạng thái hiện tại
Dự án đã hoàn thành phần lớn **Phase 1** và đang ở giữa **Phase 2** theo kế hoạch `vocabulary_library_plan.md`.

### 1. Kiến trúc hệ thống
*   **Model:** Sử dụng mô hình **Tham chiếu (Referential Model)**. 
    *   Hệ thống không nhân bản toàn bộ từ vựng thư viện vào tài khoản user.
    *   Hệ thống chỉ lưu bản ghi "Đăng ký" (Subscription) và "Tiến độ" (Progress/Score) của từng từ dựa trên ID.
*   **Database:** Firestore (REST API) + Google OAuth 2.0 (Identity Kit).
*   **Frontend:** HTML/CSS/TypeScript (Vite + CRXJS).

### 2. Các tính năng đã hoàn thiện
- ✅ **Đa chế độ Quiz (Quiz Modes):** Support 5 chế độ: `vocab_to_meaning`, `meaning_to_vocab`, `kanji_to_reading`, `reading_to_kanji` và `shuffled` (Ngẫu nhiên). Đã có UI để chọn Mode mặc định toàn hệ thống.
- ✅ **Kho từ vựng hệ thống (Library):** 
    - Đã tích hợp N5 (781 từ) dưới dạng file JSON cục bộ (`src/public/n5_vocabulary.json`).
    - Đã tích hợp N4 (696 từ) dưới dạng file JSON cục bộ (`src/public/n4_vocabulary.json`).
    - Đã tích hợp N3 (1950 từ) dưới dạng file JSON cục bộ (`src/public/n3_vocabulary.json`).
    - Đã tích hợp N2 (1831 từ) dưới dạng file JSON cục bộ (`src/public/n2_vocabulary.json`).
    - Đã tích hợp N1 (3463 từ) dưới dạng file JSON cục bộ (`src/public/n1_vocabulary.json`).
- ✅ **Hệ thống Đăng ký (Subscription):** Logich cho phép user "Kích hoạt N5" từ trang Options.
- ✅ **Logic Quiz thông minh:**
    - Tự động bốc từ từ cả kho cá nhân và kho N5 đã kích hoạt.
    - **Distractor Scoring System:** Hệ thống chấm điểm độ nhiễu cực cao dựa trên: Chung Kanji (+30đ), Tương đồng ngữ nghĩa (+20đ), Cặp Tự/Ngoại động từ (+50đ).
    - **Smart UX:** Modal tự động đóng sau 4 giây khi đã trả lời xong, nhưng nhạy bén với hành vi người dùng:
        - Nếu đang trả lời mà chuột vẫn trong modal => KHÔNG đóng.
        - Chỉ bắt đầu đếm ngược khi chuột rời khỏi modal (`onmouseleave`).
        - Rê chuột ngược lại => Hủy đóng ngay lập tức.
    - **Tags:** Có tag hiển thị từ vựng thuộc list nào (N5, Cá nhân).

### 3. Cấu trúc Firestore (Mới nhất)
- ✅ **Cấu trúc Firestore:**
```javascript
{
  "users": {
    "{uid}": {
      "settings": {
        "main": {
          "interval": 10,
          "premium": false
          "defaultQuizMode": "vocab_to_meaning"
        }
      },
      "customVocab": {
        "{vocabId}": {
          "front": "",
          "back": "",
          "meta": {
            "reading": "",
            "meaning": "",
            "meaningEn": "",
            "meaningVi": "",
            "romaji": "",
            "example": "",
            "audio": ""
          },
          "quizMode": "",
          "score": 0,
          "lastReviewed": "",
          "createdAt": "",
          "updatedAt": ""
        }
      },
      "subscribedLists": {
        "n5": true,
        "n4": false,
        "n3": false,
        "n2": false,
        "n1": false
      },
      "systemProgress": {
        "{vocabId}": {
          "score": 0,
          "lastReviewed": "",
          "updatedAt": ""
        }
      }
    }
  }
}
```
- ✅ **Security Rules:** Người dùng đã cấu hình **Security Rules** tổng quát:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Cấp quyền cho mọi sub-collection bên trong một user (thay vì liệt kê từng cái)
    // Cách này sẽ bao hàm cả vocab, customVocab, settings, subscribedLists, systemProgress
    match /users/{uid}/{any=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }

    // Các Rules khác (nếu cần cho dữ liệu hệ thống dùng chung)
    match /systemVocab/{any=**} {
      allow read: if request.auth != null;
    }
  }
}
```
**Collections:**
*   `/users/{uid}/settings/main`: Cài đặt interval, trạng thái premium.
*   `/users/{uid}/customVocab`: Từ vựng user tự thêm.
*   `/users/{uid}/subscribedLists`: Danh sách danh mục hệ thống đang học.
*   `/users/{uid}/systemProgress`: Lưu điểm (`score`) của các từ từ thư viện hệ thống (ID trùng với ID trong JSON).

---

## 💎 Kế hoạch Kích hoạt Premium

Dự án sẽ hỗ trợ song song 2 cơ chế kích hoạt để tăng tính linh hoạt:

### Hướng A: Hệ thống tự động (Stripe/PayPal)
*   **Vận hành:** Tích hợp cổng thanh toán vào một Landing Page bên ngoài.
*   **Luồng xử lý:** 
    1. Người dùng thanh toán trên web. 
    2. Webhook của cổng thanh toán gọi tới một Firebase Cloud Function (hoặc server riêng). 
    3. Server cập nhật trường `premium: true` trong `/users/{uid}/settings/main` trên Firestore.
    4. Extension tự động nhận diện trạng thái mới ngay lập tức.

### Hướng B: Sử dụng License Key (Thủ công/Phổ biến)
*   **Vận hành:** Bán Key qua các sàn TMĐT (Shopee, FB...). Mỗi key là một chuỗi duy nhất (VD: `JPS-ABCD-1234`).
*   **Cấu trúc dữ liệu:** Một collection `/licenseKeys` trên Firestore lưu danh sách key + trạng thái `isUsed`.
*   **Luồng xử lý:**
    1. Người dùng nhập Key vào giao diện Extension.
    2. Extension gửi request lên Firestore/Cloud Function để "Redeem".
    3. Nếu Key hợp lệ và chưa dùng: Đổi `premium: true` cho User và đánh dấu Key đã sử dụng gắn với UID đó.

---

## 🛠 Hướng dẫn kỹ thuật cho phiên tiếp theo

### Lệnh Build
```powershell
npm run build
```

### Các file quan trọng cần lưu ý:
*   `src/background.ts`: Chứa logic chính về chọn từ (Hybrid Logic) và xử lý tin nhắn.
*   `src/firebaseClient.ts`: Toàn bộ logic giao tiếp Firestore REST và Auth.
*   `src/content.ts`: Logic hiển thị Modal Quiz và các hiệu ứng UX.
*   `src/types.ts`: Định nghĩa các Interface mới nhất (`SystemVocabProgress`, `SubscribedList`).

### Công việc tồn đọng (Next steps):
1.  **Phase 3 (Premium Model):** Triển khai cơ chế License Key hoặc kích hoạt tính năng dựa trên trường `premium` trong settings.
2.  **Mở rộng thư viện:** Thêm N4, N3 và Minna no Nihongo (chỉ cần thêm file JSON vào `src/public` và add nút trong Options).
3.  **Thống kê:** Xây dựng UI hiển thị % hoàn thành bộ N5 dựa trên `systemProgress`.

---

**Ghi chú cho AI:** Khi bắt đầu phiên mới, hãy đọc file này và `docs/vocabulary_library_plan.md` để nắm bắt ngữ cảnh nhanh nhất.
