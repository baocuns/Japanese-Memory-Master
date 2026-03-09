// Popup logic

async function bgSend(message: any): Promise<any> {
  return chrome.runtime.sendMessage(message);
}

document.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("mini-container");
  const openOptionsBtn = document.getElementById("open-options");
  const modeSelect = document.getElementById("pop-quiz-mode") as HTMLSelectElement;
  const intervalInput = document.getElementById("pop-quiz-interval") as HTMLInputElement;
  const saveBtn = document.getElementById("pop-save-settings");
  const countEl = document.getElementById("pop-count");

  if (!container || !openOptionsBtn || !modeSelect || !intervalInput || !saveBtn || !countEl) return;

  openOptionsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage ? chrome.runtime.openOptionsPage() : window.open(chrome.runtime.getURL("options.html"));
  });

  saveBtn.addEventListener("click", async () => {
    try {
      saveBtn.innerText = "Đang lưu...";
      const quizInterval = parseFloat(intervalInput.value);
      const defaultQuizMode = modeSelect.value;
      const r = await bgSend({ action: "SAVE_SETTINGS", quizInterval, defaultQuizMode });
      if (r?.ok) {
        saveBtn.innerText = "Đã lưu!";
        setTimeout(() => { saveBtn.innerText = "Lưu cài đặt"; }, 2000);
      }
    } catch (e) {
      alert("Lỗi lưu cài đặt");
      saveBtn.innerText = "Lưu cài đặt";
    }
  });

  try {
    const st = await bgSend({ action: "AUTH_STATUS" });
    if (!st?.signedIn) {
      container.innerHTML = '<div class="empty">Chưa đăng nhập.<br>Vui lòng đăng nhập để học!</div>';
      return;
    }

    const data = await bgSend({ action: "GET_POPUP_DATA" });
    if (!data?.ok) throw new Error("Lỗi tải dữ liệu");

    // 1. Populate Settings
    if (data.settings) {
      modeSelect.value = data.settings.defaultQuizMode || "vocab_to_meaning";
      intervalInput.value = (data.settings.quizInterval || 10).toString();
    }

    // 2. Populate List
    const allWords: any[] = data.allWords || [];
    countEl.innerText = `${allWords.length} từ`;

    if (allWords.length === 0) {
      container.innerHTML = '<div class="empty">Danh sách trống.<br>Hãy thêm từ vựng hoặc kích hoạt N5!</div>';
      return;
    }

    container.innerHTML = "";
    const displayList = allWords
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
      .slice(0, 50); // Hiển thị 50 từ gần nhất

    for (const item of displayList) {
      const div = document.createElement("div");
      div.className = "mini-item";
      div.innerHTML = `
        <div style="display:flex; justify-content:space-between; width:100%; padding:8px 0; border-bottom:1px solid #f0f0f0; align-items: center;">
          <div style="display:flex; flex-direction:column; gap:2px; flex: 1;">
            <span style="font-weight:bold; color:#333; font-size: 14px;">${escapeHtml(item.front)}</span>
            <span style="font-size:10px; color:#7986cb; font-weight: bold; text-transform: uppercase;">${escapeHtml(item.listId)}</span>
          </div>
          <div style="text-align:right; flex: 1;">
            <div style="font-size: 13px; color: #444;">${escapeHtml(item.back)}</div>
            <span class="mini-score" style="font-size:11px; color:#66bb6a; font-weight: bold;">⭐ ${escapeHtml(String(item.score ?? 0))}</span>
          </div>
        </div>
      `;
      container.appendChild(div);
    }
  } catch (e: any) {
    container.innerHTML = `<div class="empty" style="color:#c00">Lỗi: ${escapeHtml(e?.message || String(e))}</div>`;
  }
});

function escapeHtml(str: string): string {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
