import { VocabItem } from "./types";
import { escapeHtml, escapeHtmlAttr } from "./utils/html";

const DEFAULT_SETTINGS = { quizInterval: 10 };

async function bgSend(message: any): Promise<any> {
  return chrome.runtime.sendMessage(message);
}

async function refreshAuthUI() {
  const statusEl = document.getElementById("auth-status");
  const detailEl = document.getElementById("auth-detail");
  const btnLogout = document.getElementById("btn-logout") as HTMLButtonElement;
  const loginContainer = document.getElementById("login-container");

  if (!statusEl || !detailEl || !btnLogout || !loginContainer) return;

  const resp = await bgSend({ action: "AUTH_STATUS" });
  if (!resp?.ok) {
    statusEl.textContent = "Lỗi";
    detailEl.textContent = resp?.error || "Unknown";
    btnLogout.style.display = "none";
    loginContainer.style.display = "block";
    return;
  }

  if (!resp.signedIn) {
    statusEl.textContent = "Chưa đăng nhập";
    detailEl.textContent = "Hãy đăng nhập để đồng bộ dữ liệu.";
    btnLogout.style.display = "none";
    loginContainer.style.display = "block";
    return;
  }

  const auth = resp.auth || {};
  statusEl.textContent = "Đã đăng nhập";
  detailEl.textContent = `${auth.profile?.email || "(no email)"} | Provider: ${auth.provider} | uid: ${auth.uid}`;
  btnLogout.style.display = "block";
  loginContainer.style.display = "none";
}

async function loadSettings() {
  const quizIntervalInput = document.getElementById("quiz-interval") as HTMLInputElement;
  const activeLimitInput = document.getElementById("active-limit") as HTMLInputElement;
  const quizModeSelect = document.getElementById("quiz-mode") as HTMLSelectElement;
  if (!quizIntervalInput || !quizModeSelect) return;

  const resp = await bgSend({ action: "GET_SETTINGS" });
  const remote = resp?.ok && resp.settings ? resp.settings : {};
  const settings = { ...DEFAULT_SETTINGS, ...remote };

  quizIntervalInput.value = settings.quizInterval.toString();
  if (activeLimitInput) {
    activeLimitInput.value = (settings.activeWordLimit || 10).toString();
  }
  if (settings.defaultQuizMode) {
    quizModeSelect.value = settings.defaultQuizMode;
  }
}

async function saveSettings() {
  const quizIntervalInput = document.getElementById("quiz-interval") as HTMLInputElement;
  const activeLimitInput = document.getElementById("active-limit") as HTMLInputElement;
  const quizModeSelect = document.getElementById("quiz-mode") as HTMLSelectElement;
  if (!quizIntervalInput || !quizModeSelect) return;

  const interval = parseFloat(quizIntervalInput.value);
  const limit = activeLimitInput ? parseInt(activeLimitInput.value) : 10;
  const defaultQuizMode = quizModeSelect.value;

  if (!Number.isFinite(interval) || interval <= 0) {
    alert("Thời gian phải lớn hơn 0!");
    return;
  }

  if (!Number.isInteger(limit) || limit < 1) {
    alert("Giới hạn từ phải là số nguyên dương!");
    return;
  }

  const resp = await bgSend({
    action: "SAVE_SETTINGS",
    quizInterval: interval,
    activeWordLimit: limit,
    defaultQuizMode: defaultQuizMode
  });
  if (!resp?.ok) {
    alert("Lỗi lưu settings: " + (resp?.error || "unknown"));
    return;
  }
  alert("Đã lưu!");
}

let currentTab = "Cá nhân";

async function loadWords() {
  const container = document.getElementById("word-list");
  const tabsContainer = document.getElementById("tabs-container");
  if (!container || !tabsContainer) return;

  container.innerHTML = `<div class="muted">Đang tải...</div>`;

  const resp = await bgSend({ action: "GET_VOCAB_LIST" });
  if (!resp?.ok) {
    container.innerHTML = `<div style="color:#c00">Lỗi: ${escapeHtml(resp?.error || "unknown")}</div>`;
    return;
  }

  const list: VocabItem[] = resp.vocabList || [];
  if (list.length === 0) {
    container.innerHTML = `<div class="muted">Chưa có từ vựng nào.</div>`;
    return;
  }

  // Group by listId
  const groups: Record<string, VocabItem[]> = { "Cá nhân": [] };
  const allListIds = new Set<string>();
  allListIds.add("Cá nhân");

  for (const item of list) {
    const listId = (item as any).listId || "N/A";
    allListIds.add(listId);
    if (!groups[listId]) groups[listId] = [];
    groups[listId].push(item);
  }

  // Ensure currentTab exists
  if (!allListIds.has(currentTab)) {
    currentTab = "Cá nhân";
  }

  // Render Tabs
  tabsContainer.innerHTML = "";
  Array.from(allListIds).sort().forEach(id => {
    const btn = document.createElement("button");
    btn.className = `tab-btn ${id === currentTab ? 'active' : ''}`;
    // Show count in tab name
    const count = groups[id] ? groups[id].length : 0;
    btn.textContent = `${id} (${count})`;
    btn.onclick = () => {
      currentTab = id;
      loadWords(); // Re-render
    };
    tabsContainer.appendChild(btn);
  });

  // Render List for Current Tab
  container.innerHTML = "";
  const currentList = groups[currentTab] || [];

  if (currentList.length === 0) {
    container.innerHTML = `<div class="muted" style="padding:10px;">Danh sách trống.</div>`;
    return;
  }

  const sorted = currentList
    .slice()
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

  for (const item of sorted) {
    const div = document.createElement("div");
    div.className = "word-item";
    const isSystem = !!(item as any).isSystem;
    const m = item.meta || {};

    // Build meta detail lines
    const metaLines: string[] = [];
    if (m.reading) metaLines.push(`<span style="color:#94a3b8;">📖 <span style="color:#a78bfa;">${escapeHtml(m.reading)}</span></span>`);
    if (m.romaji) metaLines.push(`<span style="color:#94a3b8;">🔤 ${escapeHtml(m.romaji)}</span>`);
    if (m.meaningVi) metaLines.push(`<span style="color:#94a3b8;">🇻🇳 ${escapeHtml(m.meaningVi)}</span>`);
    if (m.meaning && m.meaning !== item.back) metaLines.push(`<span style="color:#94a3b8;">💬 ${escapeHtml(m.meaning)}</span>`);
    if (m.meaningEn) metaLines.push(`<span style="color:#94a3b8;">🇬🇧 ${escapeHtml(m.meaningEn)}</span>`);
    if (m.example) metaLines.push(`<span style="color:#64748b; font-style:italic;">📝 ${escapeHtml(m.example)}</span>`);

    div.innerHTML = `
      <div style="display:flex; justify-content:space-between; width: 100%; align-items:flex-start; gap: 12px;">
        <div style="display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0;">
          <div style="display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;">
            <b style="font-size: 16px; color: #f1f5f9;">${escapeHtml(item.front)}</b>
            ${m.reading ? `<span style="font-size: 12px; color: #a78bfa;">[${escapeHtml(m.reading)}]</span>` : ''}
          </div>
          <div style="font-size: 13px; color: #e2e8f0;">${escapeHtml(item.back)}</div>
          ${metaLines.length > 0 ? `
            <div style="display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 4px; font-size: 11px;">
              ${metaLines.join('')}
            </div>
          ` : ''}
          ${m.example ? `<div style="font-size: 11px; color: #64748b; font-style: italic; margin-top: 4px; padding: 6px 10px; background: rgba(15,23,42,0.5); border-radius: 6px; border-left: 2px solid #334155;">📝 ${escapeHtml(m.example)}</div>` : ''}
          <div style="display: flex; align-items: center; gap: 10px; margin-top: 4px;">
            <span style="font-size:11px; color: #4ade80; font-weight: 600;">⭐ Điểm: ${escapeHtml(String(item.score ?? 0))}</span>
            ${item.lastReviewed ? `<span style="font-size:10px; color: #475569;">Ôn: ${new Date(item.lastReviewed).toLocaleDateString('vi-VN')}</span>` : ''}
          </div>
        </div>
        <div style="flex-shrink: 0;">
          ${!isSystem ? `<button class="delete-btn" data-id="${escapeHtmlAttr(item.id)}">Xóa</button>` : '<span style="font-size: 11px; color: #475569; font-style: italic;">Hệ thống</span>'}
        </div>
      </div>
    `;
    container.appendChild(div);
  }

  document.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", async function (this: HTMLButtonElement) {
      const id = this.getAttribute("data-id");
      if (!id || !confirm("Bạn có chắc muốn xóa?")) return;
      const r = await bgSend({ action: "DELETE_VOCAB", id });
      if (!r?.ok) alert("Lỗi xóa: " + (r?.error || "unknown"));
      await loadWords();
    });
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const btnLoginGoogle = document.getElementById("btn-login-google");
  const btnLoginEmail = document.getElementById("btn-login-email");
  const btnSignupEmail = document.getElementById("btn-signup-email");
  const btnLogout = document.getElementById("btn-logout");
  const btnSaveConfig = document.getElementById("save-config");
  const btnRefresh = document.getElementById("refresh");
  const btnAddWord = document.getElementById("btn-add-word");
  const btnRedeemKey = document.getElementById("btn-redeem-key");

  const emailInput = document.getElementById("login-email") as HTMLInputElement;
  const passwordInput = document.getElementById("login-password") as HTMLInputElement;

  const afterLogin = async (successMsg: string) => {
    await refreshAuthUI();
    await loadSettings();
    await loadWords();
    await refreshSubscriptionsUI();
    await refreshEntitlementUI();
    alert(successMsg);
  };

  if (btnLoginGoogle) {
    btnLoginGoogle.addEventListener("click", async () => {
      try {
        const r = await bgSend({ action: "AUTH_SIGN_IN_GOOGLE" });
        if (!r?.ok) throw new Error(r?.error || "Login fail");
        await afterLogin("Đăng nhập Google thành công!");
      } catch (e: any) {
        alert("Lỗi: " + (e?.message || String(e)));
      }
    });
  }

  if (btnLoginEmail) {
    btnLoginEmail.addEventListener("click", async () => {
      const email = emailInput.value.trim();
      const password = passwordInput.value.trim();
      if (!email || !password) return alert("Vui lòng nhập email và mật khẩu!");
      try {
        const r = await bgSend({ action: "AUTH_SIGN_IN_EMAIL", email, password });
        if (!r?.ok) throw new Error(r?.error || "Login fail");
        await afterLogin("Đăng nhập thành công!");
      } catch (e: any) {
        alert("Lỗi: " + (e?.message || String(e)));
      }
    });
  }

  if (btnSignupEmail) {
    btnSignupEmail.addEventListener("click", async () => {
      const email = emailInput.value.trim();
      const password = passwordInput.value.trim();
      if (!email || !password) return alert("Vui lòng nhập email và mật khẩu!");
      if (password.length < 6) return alert("Mật khẩu phải ít nhất 6 ký tự!");
      try {
        const r = await bgSend({ action: "AUTH_SIGN_UP_EMAIL", email, password });
        if (!r?.ok) throw new Error(r?.error || "Signup fail");
        await afterLogin("Đăng ký thành công!");
      } catch (e: any) {
        alert("Lỗi: " + (e?.message || String(e)));
      }
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener("click", async () => {
      const r = await bgSend({ action: "AUTH_SIGN_OUT" });
      if (!r?.ok) alert("Đăng xuất lỗi: " + (r?.error || "unknown"));
      await refreshAuthUI();
      await refreshSubscriptionsUI();
      const wordList = document.getElementById("word-list");
      if (wordList) wordList.innerHTML = `<div class="muted">Bạn đã đăng xuất.</div>`;
    });
  }

  if (btnSaveConfig) btnSaveConfig.addEventListener("click", saveSettings);
  if (btnRefresh) btnRefresh.addEventListener("click", loadWords);

  if (btnRedeemKey) {
    btnRedeemKey.addEventListener("click", async () => {
      const keyInput = document.getElementById("license-key-input") as HTMLInputElement;
      const msgEl = document.getElementById("redeem-msg");
      if (!keyInput || !msgEl) return;

      const key = keyInput.value.trim();
      if (!key) {
        msgEl.style.color = "#c00";
        msgEl.textContent = "Vui lòng nhập license key!";
        return;
      }

      try {
        msgEl.style.color = "#666";
        msgEl.textContent = "Đang kích hoạt...";
        btnRedeemKey.textContent = "Đang xử lý...";
        btnRedeemKey.setAttribute("disabled", "true");

        const result = await bgSend({ action: "REDEEM_LICENSE_KEY", key });

        if (result?.ok) {
          msgEl.style.color = "#4CAF50";
          msgEl.textContent = result.message || "Kích hoạt thành công!";
          keyInput.value = "";

          // Refresh UI
          await refreshEntitlementUI();
          await refreshSubscriptionsUI();
        } else {
          msgEl.style.color = "#c00";
          msgEl.textContent = result?.error || "Kích hoạt thất bại";
        }
      } catch (e: any) {
        msgEl.style.color = "#c00";
        msgEl.textContent = "Lỗi: " + (e?.message || String(e));
      } finally {
        btnRedeemKey.textContent = "Kích hoạt";
        btnRedeemKey.removeAttribute("disabled");
      }
    });
  }

  /* --- SUBSCRIPTION LOGIC --- */
  const AVAILABLE_LISTS = [
    { id: "N5", name: "JLPT N5", desc: "Sơ cấp 1 (640+ từ)", requiredFeature: null },
    { id: "N4", name: "JLPT N4", desc: "Sơ cấp 2 (690+ từ)", requiredFeature: "access_n4" },
    { id: "N3", name: "JLPT N3", desc: "Trung cấp 1 (1950+ từ)", requiredFeature: "access_n3" },
    { id: "N2", name: "JLPT N2", desc: "Trung cấp 2 (1830+ từ)", requiredFeature: "access_n2" },
    { id: "N1", name: "JLPT N1", desc: "Thượng cấp (3460+ từ)", requiredFeature: "access_n1" }
  ];

  async function refreshEntitlementUI() {
    const timelineEl = document.getElementById("entitlement-timeline");
    if (!timelineEl) return;

    try {
      const result = await bgSend({ action: "GET_ENTITLEMENT_STATUS" });
      if (!result?.ok) {
        timelineEl.innerHTML = '<div class="muted">Không thể tải thông tin quyền lợi</div>';
        return;
      }

      const { current, queue, features } = result;

      if (!current) {
        timelineEl.innerHTML = `
          <div style="padding: 16px; background: #0f172a; border-radius: 10px; border: 1px solid #334155;">
            <div style="color: #f1f5f9;"><b>Gói hiện tại:</b> <span style="color: #94a3b8;">Miễn phí</span></div>
            <div style="margin-top: 6px; font-size: 12px; color: #64748b;">Chỉ có quyền truy cập N5</div>
          </div>
        `;
      } else {
        const startDate = new Date(current.start).toLocaleDateString('vi-VN');
        const endDate = new Date(current.end).toLocaleDateString('vi-VN');

        timelineEl.innerHTML = `
          <div style="padding: 16px; background: linear-gradient(135deg, rgba(59,130,246,0.1), rgba(139,92,246,0.08)); border-radius: 10px; border: 1px solid rgba(59,130,246,0.3);">
            <div style="color: #f1f5f9;"><b>Gói hiện tại:</b> <span style="color: #60a5fa;">${escapeHtml(current.name)}</span></div>
            <div style="margin-top: 6px; font-size: 12px; color: #94a3b8;">
              📅 Từ ${startDate} đến ${endDate}
            </div>
            <div style="margin-top: 6px; font-size: 12px; color: #94a3b8;">
              ✨ <b style="color:#e2e8f0;">Tính năng:</b> ${features.join(', ')}
            </div>
          </div>
        `;

        // Show queue if there are future entitlements
        if (queue && queue.length > 1) {
          const futureItems = queue.filter((item: any) => item.start > Date.now());
          if (futureItems.length > 0) {
            timelineEl.innerHTML += '<div style="margin-top: 14px; color: #f1f5f9; font-weight: 600;">Quyền lợi sắp tới:</div>';
            for (const item of futureItems) {
              const start = new Date(item.start).toLocaleDateString('vi-VN');
              const end = new Date(item.end).toLocaleDateString('vi-VN');
              timelineEl.innerHTML += `
                <div style="padding: 12px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; margin-top: 6px; font-size: 12px; color: #94a3b8;">
                  <span style="color: #e2e8f0; font-weight: 500;">${escapeHtml(item.id)}</span>: ${start} - ${end}
                </div>
              `;
            }
          }
        }
      }
    } catch (e: any) {
      timelineEl.innerHTML = `<div class="muted" style="color: #c00;">Lỗi: ${escapeHtml(e?.message || String(e))}</div>`;
    }
  }

  async function refreshSubscriptionsUI() {
    const container = document.getElementById("subscription-list");
    const msgEl = document.getElementById("import-msg");
    if (!container || !msgEl) return;

    // Load entitlement status to check features
    let userFeatures: string[] = [];
    try {
      const entitlementResp = await bgSend({ action: "GET_ENTITLEMENT_STATUS" });
      if (entitlementResp?.ok) {
        userFeatures = entitlementResp.features || [];
      }
    } catch (e) {
      console.error("Failed to load entitlement status:", e);
    }

    const resp = await bgSend({ action: "GET_SUBSCRIPTIONS" });
    const subs = resp?.ok ? (resp.subscriptions || []) : [];

    container.innerHTML = ""; // Clear loader

    AVAILABLE_LISTS.forEach(lib => {
      const subInfo = subs.find((s: any) => s.id === lib.id);
      const isChecked = subInfo && subInfo.enabled;

      // Feature-based locking: Check if user has required feature
      const isLocked = lib.requiredFeature && !userFeatures.includes(lib.requiredFeature);

      const row = document.createElement("div");
      row.className = "sub-row";

      let statusHtml = "";
      if (isLocked) {
        statusHtml = `
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size: 11px; color: #fbbf24; font-weight: 600; background: rgba(245,158,11,0.12); padding: 4px 10px; border-radius: 20px; border: 1px solid rgba(245,158,11,0.2);">👑 Premium</span>
          </div>
        `;
      } else {
        statusHtml = `
          <label class="toggle-label">
            <span class="toggle-text">${isChecked ? "Đang học" : "Tắt"}</span>
            <input type="checkbox" class="sub-checkbox" data-id="${escapeHtmlAttr(lib.id)}" ${isChecked ? "checked" : ""}>
          </label>
        `;
      }

      row.innerHTML = `
        <div>
          <div style="font-weight: 600; color: #f1f5f9; font-size: 13px;">${escapeHtml(lib.name)}</div>
          <div style="font-size: 11px; color: #64748b; margin-top: 3px;">${escapeHtml(lib.desc)}</div>
        </div>
        ${statusHtml}
      `;

      if (isLocked) {
        row.style.cursor = "not-allowed";
        row.style.opacity = "0.6";
        row.onclick = () => alert("Tính năng này chỉ dành cho tài khoản Premium! Vui lòng kích hoạt license key.");
      }

      container.appendChild(row);
    });

    // Add event listeners to new checkboxes (only for enabled ones)
    document.querySelectorAll(".sub-checkbox").forEach((cb) => {
      cb.addEventListener("click", (e) => e.stopPropagation()); // Prevent row click
      cb.addEventListener("change", async (e) => {
        const target = e.target as HTMLInputElement;
        const listId = target.getAttribute("data-id");
        const enabled = target.checked;

        // Optimistic UI update
        const labelText = target.nextElementSibling;
        if (labelText) labelText.textContent = enabled ? "Đang ... " : "Tắt ...";
        target.disabled = true;

        try {
          const r = await bgSend({ action: "SUBSCRIBE_LIST", listId, enabled });
          if (!r?.ok) throw new Error(r?.error || "Fail");

          await refreshSubscriptionsUI();
        } catch (err: any) {
          alert("Lỗi: " + String(err));
          // Revert visual state
          target.checked = !enabled;
          target.disabled = false;
          if (labelText) labelText.textContent = !enabled ? "Đang học" : "Tắt";
        }
      });
    });

    // Update summary message
    const activeNames = subs
      .filter((s: any) => s.enabled)
      .map((s: any) => s.id)
      .join(", ");

    if (activeNames) {
      msgEl.textContent = `Bạn đang học: ${activeNames}`;
      msgEl.style.color = "#2196F3";
    } else {
      msgEl.textContent = "Bạn chưa chọn danh sách nào.";
      msgEl.style.color = "#666";
    }
  }

  if (btnAddWord) {
    btnAddWord.addEventListener("click", async () => {
      const wordInput = document.getElementById("new-word") as HTMLInputElement;
      const meaningInput = document.getElementById("new-meaning") as HTMLInputElement;
      const readingInput = document.getElementById("new-reading") as HTMLInputElement;
      const romajiInput = document.getElementById("new-romaji") as HTMLInputElement;
      const meaningViInput = document.getElementById("new-meaning-vi") as HTMLInputElement;
      const meaningEnInput = document.getElementById("new-meaning-en") as HTMLInputElement;
      const exampleInput = document.getElementById("new-example") as HTMLInputElement;
      const msgEl = document.getElementById("add-word-msg");

      if (!wordInput || !meaningInput || !msgEl) return;

      const front = wordInput.value.trim();
      const back = meaningInput.value.trim();

      if (!front || !back) {
        msgEl.style.color = "#f87171";
        msgEl.textContent = "Vui lòng nhập đầy đủ từ vựng và nghĩa chính!";
        return;
      }

      // Collect optional meta fields
      const meta: Record<string, string> = { meaning: back };
      if (readingInput?.value.trim()) meta.reading = readingInput.value.trim();
      if (romajiInput?.value.trim()) meta.romaji = romajiInput.value.trim();
      if (meaningViInput?.value.trim()) meta.meaningVi = meaningViInput.value.trim();
      if (meaningEnInput?.value.trim()) meta.meaningEn = meaningEnInput.value.trim();
      if (exampleInput?.value.trim()) meta.example = exampleInput.value.trim();

      try {
        msgEl.style.color = "#94a3b8";
        msgEl.textContent = "Đang thêm...";

        const resp = await bgSend({ action: "ADD_VOCAB", front, back, meta });
        if (!resp?.ok) throw new Error(resp?.error || "ADD_VOCAB failed");

        msgEl.style.color = "#4ade80";
        msgEl.textContent = `✅ Đã thêm: ${front}`;
        wordInput.value = "";
        meaningInput.value = "";
        if (readingInput) readingInput.value = "";
        if (romajiInput) romajiInput.value = "";
        if (meaningViInput) meaningViInput.value = "";
        if (meaningEnInput) meaningEnInput.value = "";
        if (exampleInput) exampleInput.value = "";

        await loadWords();
      } catch (e: any) {
        msgEl.style.color = "#f87171";
        msgEl.textContent = "Lỗi: " + (e?.message || String(e));
      }
    });
  }

  // Sidebar navigation
  const navItems = document.querySelectorAll<HTMLElement>('.nav-item[data-target]');
  const sections = document.querySelectorAll<HTMLElement>('.content-section');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetId = item.getAttribute('data-target');

      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');

      sections.forEach(s => s.classList.remove('active'));
      const target = targetId ? document.getElementById(targetId) : null;
      if (target) {
        target.classList.add('active');
      }
    });
  });

  await refreshAuthUI();

  const s = await bgSend({ action: "AUTH_STATUS" });
  if (s?.ok && s.signedIn) {
    await loadSettings();
    await loadWords();
    await refreshSubscriptionsUI();
    await refreshEntitlementUI();
  }
});
