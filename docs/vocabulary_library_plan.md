# Kế hoạch: Hệ thống Kho Từ Vựng & Premium Model

## 🎯 Mục tiêu

Xây dựng hệ thống kho từ vựng có sẵn (N5, N4, Minna no Nihongo...) để người dùng mới có thể bắt đầu học ngay, đồng thời tối ưu chi phí lưu trữ và xây dựng mô hình premium.

---

## 📊 Trả lời các câu hỏi của bạn

### 1. Có bị tốn chỗ lưu trữ khi nhân bản dữ liệu không?

**Có 2 cách tiếp cận:**

| Cách | Mô tả | Ưu điểm | Nhược điểm |
|------|-------|---------|------------|
| **A. Nhân bản** | Copy từ vựng gốc → user | Đơn giản, user có thể sửa | Tốn storage, đồng bộ khó |
| **B. Tham chiếu** | User chỉ lưu "đang học list X" + tiến độ | Tiết kiệm storage | Phức tạp hơn |

**💡 Đề xuất: Kết hợp cả 2**
- Từ vựng **hệ thống** (N5, N4...): Lưu chung, user chỉ lưu **tiến độ** (score, lastReviewed)
- Từ vựng **tự thêm**: User tự quản lý như hiện tại

---

### 2. Mô hình Premium có hợp lý không?

**Hoàn toàn hợp lý!** Đây là các tính năng có thể phân chia:

| Tính năng | Free | Premium |
|-----------|------|---------|
| Tự thêm từ vựng | ✅ | ✅ |
| Kho N5 (cơ bản) | ✅ 50 từ demo | ✅ Full |
| Kho N4, N3, N2, N1 | ❌ | ✅ |
| Minna no Nihongo | ❌ | ✅ |
| Tạo danh mục riêng | ✅ 1 list | ✅ Không giới hạn |
| Đồng bộ đa thiết bị | ✅ | ✅ |
| Thống kê học tập | ❌ | ✅ |
| Xuất/Nhập dữ liệu | ❌ | ✅ |

---

### 3. Cấu trúc dữ liệu linh hoạt

**Vấn đề**: Bạn muốn hỗ trợ nhiều loại học:
- Kanji → Hiragana (học đọc)
- Từ vựng → Nghĩa tiếng Việt
- Câu → Dịch nghĩa
- v.v.

**💡 Giải pháp: Cấu trúc "Question-Answer" tổng quát**

```javascript
{
  // Thông tin hiển thị khi quiz
  "front": "猫",           // Mặt trước (câu hỏi)
  "back": "ねこ",          // Mặt sau (đáp án đúng)
  
  // Metadata (ẩn khi quiz, hiển thị sau khi trả lời hoặc xem chi tiết)
  "meta": {
    "reading": "ねこ",     // Cách đọc
    "meaning": "Con mèo",  // Nghĩa tiếng Việt
    "example": "猫が好きです", // Câu ví dụ
    "audio": "url_to_audio"   // File audio (nếu có)
  },
  
  // Cài đặt quiz
  "quizMode": "kanji_to_reading", // Loại quiz
  
  // Tiến độ (riêng mỗi user)
  "score": 5,
  "lastReviewed": "2026-02-03T..."
}
```

**Các loại quiz mode:**

| Mode | Front | Back | Mục đích |
|------|-------|------|----------|
| `vocab_to_meaning` | 猫 | Con mèo | Học nghĩa |
| `meaning_to_vocab` | Con mèo | 猫 | Nhớ lại từ |
| `kanji_to_reading` | 猫 | ねこ | Học đọc Kanji |
| `reading_to_kanji` | ねこ | 猫 | Viết Kanji |
| `listening` | 🔊 Audio | 猫 | Nghe hiểu |

---

## 🏗️ Đề xuất cấu trúc Firestore mới

```
Firestore
│
├── 📂 systemVocab (collection) ← READONLY, dùng chung
│   │
│   ├── 📂 N5 (sub-collection)
│   │   ├── 📄 vocab_001: { front: "猫", back: "ねこ", meta: {...} }
│   │   ├── 📄 vocab_002: { front: "犬", back: "いぬ", meta: {...} }
│   │   └── ...
│   │
│   ├── 📂 N4
│   ├── 📂 minna_lesson_01
│   ├── 📂 minna_lesson_02
│   └── ...
│
├── 📂 users (collection)
│   │
│   └── 📄 {uid}
│       │
│       ├── 📂 settings
│       │   └── 📄 main: { quizInterval, premium: true/false, ... }
│       │
│       ├── 📂 customVocab (từ user tự thêm)
│       │   ├── 📄 12345: { front, back, meta, score, ... }
│       │   └── ...
│       │
│       ├── 📂 subscribedLists (danh sách đang học)
│       │   ├── 📄 N5: { enabled: true, addedAt: "..." }
│       │   ├── 📄 minna_lesson_01: { enabled: true }
│       │   └── ...
│       │
│       └── 📂 progress (tiến độ từng từ hệ thống)
│           ├── 📄 N5_vocab_001: { score: 5, lastReviewed: "..." }
│           ├── 📄 N5_vocab_002: { score: 2, lastReviewed: "..." }
│           └── ...
│
└── 📂 premiumUsers (optional, for validation)
    └── 📄 {uid}: { plan: "yearly", expiresAt: "..." }
```

---

## 🧠 Về việc "không kích thích trí nhớ nếu cho quá nhiều thông tin"

Bạn đúng! Nguyên tắc **Active Recall**:
- Chỉ hiển thị `front` (câu hỏi)
- User phải **tự nhớ** `back` (đáp án)
- Sau khi trả lời mới hiển thị thêm `meta` (thông tin bổ sung)

**Flow quiz đề xuất:**
```
1. Hiển thị: "猫" (front only)
2. User chọn đáp án hoặc tự nhớ
3. Hiển thị kết quả + thông tin bổ sung:
   - Đáp án đúng: ねこ
   - Nghĩa: Con mèo
   - Ví dụ: 猫が好きです
```

---

## 🚀 Roadmap đề xuất

### Phase 1: Cấu trúc dữ liệu mới (1-2 tuần)
- [ ] Thiết kế schema Firestore mới
- [ ] Migrate code hiện tại sang cấu trúc `front/back/meta`
- [ ] Hỗ trợ nhiều quiz mode

### Phase 2: Kho từ vựng hệ thống (2-3 tuần)
- [ ] Tạo collection `systemVocab` với N5 cơ bản (50-100 từ demo)
- [ ] UI chọn danh sách để học
- [ ] Lưu progress riêng user

### Phase 3: Premium Model (1-2 tuần)
- [ ] Tích hợp thanh toán (Stripe/PayPal hoặc manual)
- [ ] Giới hạn tính năng theo plan
- [ ] Full N5, N4, Minna no Nihongo content

### Phase 4: Tính năng nâng cao
- [ ] Thống kê học tập (biểu đồ tiến độ)
- [ ] Spaced Repetition nâng cao (thuật toán SM-2)
- [ ] Audio cho từ vựng
- [ ] Xuất/Nhập dữ liệu

---

## ❓ Câu hỏi cần bạn quyết định

1. **Quiz mode mặc định**: Bạn muốn mặc định là `vocab_to_meaning` hay `kanji_to_reading`?

2. **Nguồn dữ liệu N5/N4**: Bạn tự nhập hay có sẵn file JSON/CSV?

3. **Premium pricing**: Bạn nghĩ giá bao nhiêu hợp lý? (monthly/yearly)

4. **Thanh toán**: Tích hợp Stripe, hoặc manual (chuyển khoản)?

5. **Ưu tiên**: Bạn muốn làm Phase nào trước?
