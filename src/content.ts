import { VocabItem } from "./types";
import { escapeHtml, escapeHtmlAttr } from "./utils/html";

chrome.runtime.onMessage.addListener((request) => {
  if (request.action === "OPEN_ADD_MODAL") {
    createAddModal(request.text);
  } else if (request.action === "OPEN_QUIZ_MODAL") {
    createQuizModal(request.wordData, request.wrongOptions, request.quizData);
  }
});

function removeExistingModals() {
  document.getElementById("jp-add-modal")?.remove();
  document.getElementById("jp-quiz-modal")?.remove();
}

// --- MODAL THÊM TỪ ---
function createAddModal(selectedText: string) {
  removeExistingModals();
  const div = document.createElement("div");
  div.id = "jp-add-modal";

  // Use a simple styling that works on most pages
  div.style.all = "initial";
  div.innerHTML = `
    <div style="position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); width:400px; background:white; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,0.3); z-index:999999; font-family:sans-serif; padding:20px; max-height:90vh; overflow-y:auto;">
      <h3 style="margin-top:0; color:#2196F3;">Thêm từ vựng</h3>

      <div style="display:flex; gap:10px; margin-bottom:10px;">
        <div style="flex:1;">
          <label style="display:block; font-size:11px; color:#666; margin-bottom:3px; font-weight:600;">Từ / Kanji *</label>
          <input type="text" id="jp-word" style="width:100%; box-sizing:border-box; padding:8px; border:1px solid #ddd; border-radius:6px; font-size:14px;" value="${escapeHtmlAttr(selectedText)}">
        </div>
        <div style="flex:1;">
          <label style="display:block; font-size:11px; color:#666; margin-bottom:3px; font-weight:600;">Nghĩa chính *</label>
          <input type="text" id="jp-meaning" style="width:100%; box-sizing:border-box; padding:8px; border:1px solid #ddd; border-radius:6px;" placeholder="Nghĩa tiếng Việt...">
        </div>
      </div>

      <div style="display:flex; gap:10px; margin-bottom:10px;">
        <div style="flex:1;">
          <label style="display:block; font-size:11px; color:#666; margin-bottom:3px;">📖 Cách đọc</label>
          <input type="text" id="jp-reading" style="width:100%; box-sizing:border-box; padding:8px; border:1px solid #ddd; border-radius:6px;" placeholder="ひらがな...">
        </div>
        <div style="flex:1;">
          <label style="display:block; font-size:11px; color:#666; margin-bottom:3px;">🔤 Romaji</label>
          <input type="text" id="jp-romaji" style="width:100%; box-sizing:border-box; padding:8px; border:1px solid #ddd; border-radius:6px;" placeholder="romaji...">
        </div>
      </div>

      <div style="display:flex; gap:10px; margin-bottom:10px;">
        <div style="flex:1;">
          <label style="display:block; font-size:11px; color:#666; margin-bottom:3px;">🇻🇳 Nghĩa TV</label>
          <input type="text" id="jp-meaning-vi" style="width:100%; box-sizing:border-box; padding:8px; border:1px solid #ddd; border-radius:6px;" placeholder="Chi tiết...">
        </div>
        <div style="flex:1;">
          <label style="display:block; font-size:11px; color:#666; margin-bottom:3px;">🇬🇧 Nghĩa TA</label>
          <input type="text" id="jp-meaning-en" style="width:100%; box-sizing:border-box; padding:8px; border:1px solid #ddd; border-radius:6px;" placeholder="English...">
        </div>
      </div>

      <div style="margin-bottom:12px;">
        <label style="display:block; font-size:11px; color:#666; margin-bottom:3px;">📝 Câu ví dụ</label>
        <input type="text" id="jp-example" style="width:100%; box-sizing:border-box; padding:8px; border:1px solid #ddd; border-radius:6px;" placeholder="例文...">
      </div>

      <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:16px; padding-top:12px; border-top:1px solid #eee;">
        <button id="jp-btn-cancel" style="background:#eee; border:none; padding:8px 16px; border-radius:6px; cursor:pointer;">Hủy</button>
        <button id="jp-btn-save" style="background:#2196F3; color:white; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-weight:bold;">Lưu</button>
      </div>
    </div>
  `;
  document.body.appendChild(div);

  const cancelBtn = document.getElementById("jp-btn-cancel");
  const saveBtn = document.getElementById("jp-btn-save");

  if (cancelBtn) cancelBtn.onclick = removeExistingModals;

  if (saveBtn) {
    saveBtn.onclick = async () => {
      const wordInput = document.getElementById("jp-word") as HTMLInputElement;
      const meaningInput = document.getElementById("jp-meaning") as HTMLInputElement;
      const readingInput = document.getElementById("jp-reading") as HTMLInputElement;
      const romajiInput = document.getElementById("jp-romaji") as HTMLInputElement;
      const meaningViInput = document.getElementById("jp-meaning-vi") as HTMLInputElement;
      const meaningEnInput = document.getElementById("jp-meaning-en") as HTMLInputElement;
      const exampleInput = document.getElementById("jp-example") as HTMLInputElement;

      const front = wordInput.value.trim();
      const back = meaningInput.value.trim();

      if (!front || !back) return;

      // Collect optional meta fields
      const meta: Record<string, string> = { meaning: back };
      if (readingInput?.value.trim()) meta.reading = readingInput.value.trim();
      if (romajiInput?.value.trim()) meta.romaji = romajiInput.value.trim();
      if (meaningViInput?.value.trim()) meta.meaningVi = meaningViInput.value.trim();
      if (meaningEnInput?.value.trim()) meta.meaningEn = meaningEnInput.value.trim();
      if (exampleInput?.value.trim()) meta.example = exampleInput.value.trim();

      try {
        const resp = await chrome.runtime.sendMessage({
          action: "ADD_VOCAB",
          front,
          back,
          meta
        });
        if (!resp?.ok) throw new Error(resp?.error || "ADD_VOCAB failed");
        alert(`Đã lưu: ${front}`);
        removeExistingModals();
      } catch (e: any) {
        alert("Lỗi lưu: " + (e?.message || String(e)));
      }
    };
  }
}

// --- MODAL QUIZ ---
let autoCloseTimer: any = null;

function createQuizModal(wordData: VocabItem & { listId?: string, isSystem?: boolean }, wrongOptions: string[], quizData?: any) {
  if (document.getElementById("jp-add-modal")) {
    console.log("Quiz bị bỏ qua vì đang mở modal thêm từ vựng.");
    return;
  }

  removeExistingModals();
  if (autoCloseTimer) clearTimeout(autoCloseTimer);

  // Dùng quizData nếu có, không thì fallback về logic cũ (front->back)
  const question = quizData?.question || wordData.front;
  const correctAnswer = quizData?.correctAnswer || wordData.back;
  const modeTitle = quizData?.modeTitle || "Ôn tập nhanh!";
  const listTag = wordData.listId || (wordData.isSystem ? "Hệ thống" : "Cá nhân");

  const options = [correctAnswer, ...(wrongOptions || [])];

  // Shuffle options
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }

  const div = document.createElement("div");
  div.id = "jp-quiz-modal";
  div.style.all = "initial";
  div.innerHTML = `
    <div id="jp-modal-content" style="position:fixed; top:20px; right:20px; width:280px; background:white; border-radius:12px; box-shadow:0 8px 24px rgba(0,0,0,0.2); z-index:999999; font-family:sans-serif; padding:20px; border-top: 4px solid #2196F3; transition: opacity 0.3s;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <span style="font-size:11px; background:#e3f2fd; color:#2196F3; padding:2px 8px; border-radius:10px; font-weight:bold;">${escapeHtml(listTag)}</span>
        <h3 style="margin:0; font-size:14px; color:#2196F3; flex:1; text-align:right;">${escapeHtml(modeTitle)}</h3>
      </div>
      
      <div style="font-size:24px; font-weight:bold; margin:15px 0; text-align:center; color:#333;">${escapeHtml(question)}</div>
      
      <div id="jp-options-container" style="display:flex; flex-direction:column; gap:8px;">
        ${options
      .map(
        (opt) =>
          `<button class="jp-opt-btn" style="padding:10px; border:1px solid #eee; border-radius:8px; background:#f9f9f9; cursor:pointer; text-align:left; transition:all 0.2s;" data-val="${escapeHtmlAttr(opt)}">${escapeHtml(opt)}</button>`
      )
      .join("")}
      </div>

      <div id="jp-meta-container" style="display:none; margin-top:15px; padding-top:15px; border-top:1px solid #eee;">
        <div style="font-weight:bold; color:#4CAF50; margin-bottom:5px;">Đáp án: ${escapeHtml(correctAnswer)}</div>
        <div style="font-size:13px; color:#444; background:#f0f7ff; padding:8px; border-radius:6px; margin-top:5px;">
           <strong style="color:#2196F3;">${escapeHtml(wordData.front)}</strong>: ${escapeHtml(wordData.back)}
           ${wordData.meta?.reading ? `<br><small style="color:#666;">(${escapeHtml(wordData.meta.reading)})</small>` : ''}
        </div>
        ${wordData.meta?.meaning && wordData.meta.meaning !== correctAnswer && wordData.meta.meaning !== wordData.back ? `<div style="font-size:13px; color:#666; margin-top:5px;">Nghĩa khác: ${escapeHtml(wordData.meta.meaning)}</div>` : ''}
        ${wordData.meta?.example ? `<div style="font-size:13px; color:#666; font-style:italic; margin-top:4px;">VD: ${escapeHtml(wordData.meta.example)}</div>` : ''}
        <button id="jp-btn-done" style="width:100%; margin-top:10px; background:#2196F3; color:white; border:none; padding:8px; border-radius:6px; cursor:pointer;">Đóng</button>
      </div>

      <button id="jp-btn-ignore" style="width:100%; margin-top:10px; background:none; border:none; color:#999; font-size:12px; cursor:pointer;">
        Để sau
      </button>
    </div>
  `;
  document.body.appendChild(div);

  let isHovering = false;
  let isAnswered = false;

  const modalContent = document.getElementById("jp-modal-content");
  if (modalContent) {
    modalContent.onmouseenter = () => {
      isHovering = true;
      if (autoCloseTimer) {
        clearTimeout(autoCloseTimer);
        autoCloseTimer = null;
        modalContent.style.opacity = "1";
      }
    };

    modalContent.onmouseleave = () => {
      isHovering = false;
      if (isAnswered && !autoCloseTimer) {
        startAutoClose();
      }
    };
  }

  function startAutoClose() {
    if (autoCloseTimer) clearTimeout(autoCloseTimer);
    autoCloseTimer = setTimeout(() => {
      if (modalContent && !isHovering) {
        modalContent.style.opacity = "0";
        setTimeout(removeExistingModals, 300);
      }
    }, 1000);
  }

  const ignoreBtn = document.getElementById("jp-btn-ignore");
  if (ignoreBtn) ignoreBtn.onclick = removeExistingModals;

  const buttons = Array.from(document.querySelectorAll(".jp-opt-btn")) as HTMLButtonElement[];

  buttons.forEach((btn) => {
    btn.onclick = () => {
      isAnswered = true;
      buttons.forEach((b) => (b.disabled = true));
      const selected = btn.getAttribute("data-val");
      const isCorrect = selected === correctAnswer;

      // Feedback color
      btn.style.background = isCorrect ? "#4CAF50" : "#F44336";
      btn.style.color = "white";
      btn.style.borderColor = "transparent";

      // Highlight correct one if wrong
      if (!isCorrect) {
        buttons.forEach(b => {
          if (b.getAttribute("data-val") === correctAnswer) {
            b.style.border = "2px solid #4CAF50";
            b.style.background = "#e8f5e9";
          }
        });
      }

      // Show meta info
      const metaContainer = document.getElementById("jp-meta-container");
      if (metaContainer) metaContainer.style.display = "block";

      const doneBtn = document.getElementById("jp-btn-done");
      if (doneBtn) doneBtn.onclick = removeExistingModals;

      // --- Tự động đóng sau 4 giây ĐIỀU KIỆN ---
      if (!isHovering) {
        startAutoClose();
      }

      // Send result to background
      chrome.runtime.sendMessage({
        action: "QUIZ_ANSWER",
        id: wordData.id,
        isCorrect,
        wordData // Gửi kèm để background biết là isSystem hay không
      }).catch((e) => console.log("Lỗi cập nhật:", e));
    };
  });
}
