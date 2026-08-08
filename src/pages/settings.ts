import { store } from "../data/store";
import type { AccessRole, ActorKind, AgentFamily, AISettings, AppState, Employee } from "../data/types";
import { ACCESS_ROLE_LABEL, AGENT_FAMILY_LABEL } from "../data/types";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import { exportHtmlFile, exportJsonFile, exportMarkdownFile } from "../lib/export";
import { canManageUsers } from "../lib/permissions";
import { initTheme } from "../lib/theme";
import { escapeHtml, initMobileNav, toast, updateUserRailFooter } from "../lib/ui";

const __authed = requireAuth();
if (__authed) {
initTheme();
initMobileNav("settings");
bindLogout();

function syncUser() {
  const u = store.get().currentUser;
  updateUserRailFooter(toRailUser(u));
}

function populateSettings() {
  const s = store.get().settings;
  const modelEl = document.getElementById("ai-model") as HTMLInputElement | null;
  const tempEl = document.getElementById("ai-temp") as HTMLInputElement | null;
  const tempValEl = document.getElementById("temp-val");
  const keyEl = document.getElementById("ai-key") as HTMLInputElement | null;
  const endpointEl = document.getElementById("ai-endpoint") as HTMLInputElement | null;
  const personaEl = document.getElementById("ai-persona") as HTMLSelectElement | null;
  const langEl = document.getElementById("ai-lang") as HTMLSelectElement | null;

  const ngEl = document.getElementById("linter-nongoals") as HTMLInputElement | null;
  const metEl = document.getElementById("linter-metrics") as HTMLInputElement | null;
  const stEl = document.getElementById("linter-stories") as HTMLInputElement | null;
  const vagEl = document.getElementById("linter-vague") as HTMLInputElement | null;

  if (modelEl) modelEl.value = s.model;
  if (tempEl) tempEl.value = String(s.temperature);
  if (tempValEl) tempValEl.textContent = String(s.temperature);
  if (keyEl) keyEl.value = s.apiKey || "";
  if (endpointEl) endpointEl.value = s.endpoint || "";
  const localModelEl = document.getElementById("ai-local-model") as HTMLInputElement | null;
  if (localModelEl) localModelEl.value = s.localModelName || "llama3.2";
  if (personaEl) personaEl.value = s.persona;
  if (langEl) langEl.value = s.language;
  syncLocalModelUi();

  if (ngEl) ngEl.checked = s.enableLinters.requireNonGoals;
  if (metEl) metEl.checked = s.enableLinters.requireMetrics;
  if (stEl) stEl.checked = s.enableLinters.requireStoriesAC;
  if (vagEl) vagEl.checked = s.enableLinters.warnVagueTerms;

  const lnEl = document.getElementById("editor-line-numbers") as HTMLInputElement | null;
  const tbEl = document.getElementById("editor-toolbar") as HTMLInputElement | null;
  const modeEl = document.getElementById("editor-default-mode") as HTMLSelectElement | null;
  const hlEl = document.getElementById("editor-semantic-hl") as HTMLInputElement | null;
  const hiEl = document.getElementById("editor-hl-intensity") as HTMLSelectElement | null;
  if (lnEl) lnEl.checked = s.editor?.showLineNumbers !== false;
  if (tbEl) tbEl.checked = s.editor?.showToolbar !== false;
  if (modeEl) modeEl.value = s.editor?.defaultMode ?? "split";
  if (hlEl) hlEl.checked = s.editor?.semanticHighlight !== false;
  if (hiEl) hiEl.value = s.editor?.highlightIntensity === "medium" ? "medium" : "soft";
  const rmEl = document.getElementById("editor-reduce-motion") as HTMLInputElement | null;
  if (rmEl) rmEl.checked = s.editor?.reduceMotion === true;

  renderEmployees();
  syncUser();

  const sampleBtn = document.getElementById("btn-toggle-samples") as HTMLButtonElement | null;
  if (sampleBtn) {
    sampleBtn.textContent = store.get().showSamples ? "一鍵隱藏範例文件" : "一鍵展示範例文件";
  }
}

function renderEmployees() {
  const { employees, currentUser } = store.get();
  const canManage = canManageUsers(currentUser);
  const selectEl = document.getElementById("active-user-select") as HTMLSelectElement | null;
  const listEl = document.getElementById("employee-list-container");
  const addPanel = document.getElementById("add-employee-panel");
  if (addPanel) addPanel.style.opacity = canManage ? "1" : "0.55";
  if (addPanel) addPanel.style.pointerEvents = canManage ? "auto" : "none";

  if (selectEl) {
    selectEl.innerHTML = employees
      .map(
        (e) => `<option value="${e.id}" ${e.id === currentUser.id ? "selected" : ""}>
        ${escapeHtml(e.name)} — ${ACCESS_ROLE_LABEL[e.accessRole]} · ${escapeHtml(e.title)}
      </option>`,
      )
      .join("");

    selectEl.onchange = () => {
      store.setCurrentUser(selectEl.value);
      const updatedUser = store.get().currentUser;
      toast(`已切換身分為「${updatedUser.name}」（${ACCESS_ROLE_LABEL[updatedUser.accessRole]}）`);
      populateSettings();
    };
  }

  if (listEl) {
    listEl.innerHTML = employees
      .map((e) => {
        const isCur = e.id === currentUser.id;
        const kind = e.kind === "agent" ? "Agent" : "人員";
        const family =
          e.kind === "agent" && e.agentFamily
            ? AGENT_FAMILY_LABEL[e.agentFamily]
            : "—";
        const roleOpts = (["admin", "approver", "editor"] as AccessRole[])
          .filter((r) => !(e.kind === "agent" && r === "admin"))
          .map(
            (r) =>
              `<option value="${r}" ${e.accessRole === r ? "selected" : ""}>${ACCESS_ROLE_LABEL[r]}</option>`,
          )
          .join("");
        return `
        <div class="emp-card" style="display:flex;flex-direction:column;gap:10px;padding:12px 14px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm)">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
            <div style="display:flex;align-items:center;gap:10px">
              <div class="avatar" style="width:28px;height:28px;font-size:12px">${escapeHtml(e.avatar || e.name.slice(0, 1))}</div>
              <div>
                <div style="font-weight:600;font-size:13.5px;color:var(--fg)">
                  ${escapeHtml(e.name)}
                  ${isCur ? '<span class="pill pill-approved" style="font-size:10px;margin-left:6px">目前登入</span>' : ""}
                  <span class="pill" style="font-size:10px;margin-left:4px">${kind}</span>
                </div>
                <div style="font-size:12px;color:var(--muted)">${escapeHtml(e.title)} · <span class="mono">${escapeHtml(e.email)}</span></div>
                <div style="font-size:11px;color:var(--muted);margin-top:2px">角色：${ACCESS_ROLE_LABEL[e.accessRole]} · 族系：${escapeHtml(family)}</div>
              </div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              ${
                !isCur
                  ? `<button type="button" class="btn btn-sm btn-ghost btn-switch-emp" data-id="${e.id}">切換登入</button>`
                  : ""
              }
              ${
                canManage && !isCur
                  ? `<button type="button" class="btn btn-sm btn-ghost btn-del-emp" data-id="${e.id}" style="color:var(--muted)">✕ 刪除</button>`
                  : ""
              }
            </div>
          </div>
          ${
            canManage
              ? `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                  <label style="font-size:12px;color:var(--muted)">系統角色
                    <select class="emp-role" data-id="${e.id}" style="margin-left:6px;background:var(--surface);border:1px solid var(--border);color:var(--fg);border-radius:6px;padding:4px 8px">
                      ${roleOpts}
                    </select>
                  </label>
                </div>`
              : ""
          }
        </div>
      `;
      })
      .join("");

    listEl.querySelectorAll(".btn-switch-emp").forEach((btn) => {
      (btn as HTMLButtonElement).onclick = () => {
        store.setCurrentUser((btn as HTMLElement).dataset.id!);
        toast(`已切換至「${store.get().currentUser.name}」`);
        populateSettings();
      };
    });

    listEl.querySelectorAll(".btn-del-emp").forEach((btn) => {
      (btn as HTMLButtonElement).onclick = () => {
        const id = (btn as HTMLElement).dataset.id!;
        const target = employees.find((x) => x.id === id);
        if (target && confirm(`確定刪除「${target.name}」？`)) {
          const r = store.deleteEmployee(id);
          if (!r.ok) toast(r.reason ?? "無法刪除");
          else toast(`已刪除「${target.name}」`);
          populateSettings();
        }
      };
    });

    listEl.querySelectorAll(".emp-role").forEach((sel) => {
      (sel as HTMLSelectElement).onchange = () => {
        const id = (sel as HTMLElement).dataset.id!;
        const accessRole = (sel as HTMLSelectElement).value as AccessRole;
        const r = store.updateEmployee(id, { accessRole });
        if (!r.ok) toast(r.reason ?? "更新失敗");
        else toast("已更新角色");
        populateSettings();
      };
    });
  }
}

document.getElementById("btn-add-employee")?.addEventListener("click", () => {
  if (!canManageUsers(store.get().currentUser)) {
    toast("僅管理員可新增人員／Agent");
    return;
  }
  const nameInput = document.getElementById("new-emp-name") as HTMLInputElement | null;
  const titleInput = document.getElementById("new-emp-role") as HTMLInputElement | null;
  const emailInput = document.getElementById("new-emp-email") as HTMLInputElement | null;
  const kindEl = document.getElementById("new-emp-kind") as HTMLSelectElement | null;
  const accessEl = document.getElementById("new-emp-access") as HTMLSelectElement | null;
  const familyEl = document.getElementById("new-emp-family") as HTMLSelectElement | null;
  const passInput = document.getElementById("new-emp-pass") as HTMLInputElement | null;

  const name = nameInput?.value.trim();
  const title = titleInput?.value.trim() || "成員";
  const email = emailInput?.value.trim() || `${Date.now()}@northwind.io`;
  const kind = (kindEl?.value as ActorKind) || "human";
  const accessRole = (accessEl?.value as AccessRole) || "editor";
  const agentFamily = (familyEl?.value as AgentFamily) || "other";
  const password = passInput?.value.trim() || "demo";

  if (!name) {
    toast("請輸入姓名");
    return;
  }

  const emp: Employee = {
    id: `e_${Date.now()}`,
    name,
    title,
    avatar: name.slice(0, 1),
    email,
    accessRole,
    kind,
    agentFamily: kind === "agent" ? agentFamily : null,
    password,
    isCurrent: false,
    active: true,
  };

  const r = store.addEmployee(emp);
  if (!r.ok) {
    toast(r.reason ?? "新增失敗");
    return;
  }
  toast(`已新增「${name}」（${ACCESS_ROLE_LABEL[accessRole]} · ${kind === "agent" ? "Agent" : "人員"}）`);
  if (nameInput) nameInput.value = "";
  if (titleInput) titleInput.value = "";
  if (emailInput) emailInput.value = "";
  populateSettings();
});

document.getElementById("ai-temp")?.addEventListener("input", (e) => {
  const v = (e.target as HTMLInputElement).value;
  const tempValEl = document.getElementById("temp-val");
  if (tempValEl) tempValEl.textContent = v;
});

function syncLocalModelUi() {
  const model = (document.getElementById("ai-model") as HTMLInputElement | null)?.value;
  const group = document.getElementById("local-model-group");
  if (group) group.style.display = model === "local-smart" ? "" : "none";
}

document.getElementById("ai-model")?.addEventListener("input", () => {
  const model = (document.getElementById("ai-model") as HTMLInputElement).value;
  const endpointEl = document.getElementById("ai-endpoint") as HTMLInputElement | null;
  const keyEl = document.getElementById("ai-key") as HTMLInputElement | null;
  if (model === "local-smart" && endpointEl) {
    if (
      !endpointEl.value ||
      endpointEl.value.includes("generativelanguage") ||
      endpointEl.value.includes("openai.com") ||
      endpointEl.value.includes("anthropic.com")
    ) {
      endpointEl.value = "http://localhost:11434/v1";
    }
    if (keyEl && !keyEl.value.trim()) keyEl.placeholder = "可填 ollama 或任意字";
  }
  if (model.startsWith("gemini") && endpointEl) {
    if (!endpointEl.value || endpointEl.value.includes("11434") || endpointEl.value.includes("openai.com")) {
      endpointEl.value = "https://generativelanguage.googleapis.com/v1beta";
    }
  }
  if (model.startsWith("gpt") && endpointEl) {
    if (!endpointEl.value || endpointEl.value.includes("11434") || endpointEl.value.includes("generativelanguage")) {
      endpointEl.value = "https://api.openai.com/v1";
    }
  }
  if (model.startsWith("claude") && endpointEl) {
    if (!endpointEl.value || endpointEl.value.includes("11434") || endpointEl.value.includes("generativelanguage")) {
      endpointEl.value = "https://api.anthropic.com";
    }
  }
  syncLocalModelUi();
});

function saveSettings() {
  const model = (document.getElementById("ai-model") as HTMLInputElement).value as AISettings["model"];
  const temperature = Number((document.getElementById("ai-temp") as HTMLInputElement).value);
  const apiKey = (document.getElementById("ai-key") as HTMLInputElement).value.trim();
  const endpoint = (document.getElementById("ai-endpoint") as HTMLInputElement).value.trim();
  const localModelName =
    (document.getElementById("ai-local-model") as HTMLInputElement | null)?.value.trim() || "llama3.2";
  const persona = (document.getElementById("ai-persona") as HTMLSelectElement).value as AISettings["persona"];
  const language = (document.getElementById("ai-lang") as HTMLSelectElement).value as AISettings["language"];

  const requireNonGoals = (document.getElementById("linter-nongoals") as HTMLInputElement).checked;
  const requireMetrics = (document.getElementById("linter-metrics") as HTMLInputElement).checked;
  const requireStoriesAC = (document.getElementById("linter-stories") as HTMLInputElement).checked;
  const warnVagueTerms = (document.getElementById("linter-vague") as HTMLInputElement).checked;

  const showLineNumbers = (document.getElementById("editor-line-numbers") as HTMLInputElement).checked;
  const showToolbar = (document.getElementById("editor-toolbar") as HTMLInputElement).checked;
  const defaultMode = (document.getElementById("editor-default-mode") as HTMLSelectElement)
    .value as AISettings["editor"]["defaultMode"];
  const semanticHighlight =
    (document.getElementById("editor-semantic-hl") as HTMLInputElement | null)?.checked !== false;
  const highlightIntensity = (
    (document.getElementById("editor-hl-intensity") as HTMLSelectElement | null)?.value === "medium"
      ? "medium"
      : "soft"
  ) as AISettings["editor"]["highlightIntensity"];
  const reduceMotion =
    (document.getElementById("editor-reduce-motion") as HTMLInputElement | null)?.checked === true;

  store.updateSettings({
    model,
    temperature,
    apiKey: apiKey || (model === "local-smart" ? "ollama" : ""),
    endpoint:
      endpoint ||
      (model === "local-smart" ? "http://localhost:11434/v1" : store.get().settings.endpoint),
    localModelName,
    persona,
    language,
    enableLinters: {
      requireNonGoals,
      requireMetrics,
      requireStoriesAC,
      warnVagueTerms,
    },
    editor: {
      showLineNumbers,
      showToolbar,
      defaultMode,
      semanticHighlight,
      highlightIntensity,
      reduceMotion,
    },
  });

  import("../lib/attention-motion")
    .then((m) => m.syncMotionPreferenceClass())
    .catch(() => {});
}

/**
 * 自動儲存：任何控制項變動就寫入，不需要按儲存。
 * ADHD：「我剛剛存了嗎」是一個不必要的開放迴圈。
 * 300ms debounce —— 拖 range 時不要每一格都寫一次。
 */
let saveTimer = 0;
function autoSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveSettings();
    const note = document.querySelector<HTMLElement>(".set-foot-note");
    if (!note) return;
    note.textContent = "已儲存";
    note.classList.add("is-saved");
    window.setTimeout(() => {
      note.textContent = "變更立即生效，並會自動儲存。";
      note.classList.remove("is-saved");
    }, 1400);
  }, 300);
}

document.getElementById("set-pane")?.addEventListener("change", autoSave);
document.getElementById("set-pane")?.addEventListener("input", (e) => {
  // 文字欄位用 input 太吵，只讓 range 走即時
  if ((e.target as HTMLElement).matches('input[type="range"]')) autoSave();
});

/** 分類切換：一次只顯示一組，不做整頁捲動 */
{
  const pane = document.getElementById("set-pane");
  const showCat = (key: string) => {
    pane?.querySelectorAll<HTMLElement>("[data-cat]").forEach((el) => {
      el.hidden = el.dataset.cat !== key;
    });
    document.querySelectorAll<HTMLButtonElement>("[data-set-cat]").forEach((b) => {
      const on = b.dataset.setCat === key;
      b.classList.toggle("on", on);
      b.setAttribute("aria-current", on ? "true" : "false");
    });
    try {
      localStorage.setItem("anchorline:settings-cat", key);
    } catch {
      /* private mode */
    }
    pane?.scrollTo({ top: 0 });
  };
  document.querySelectorAll<HTMLButtonElement>("[data-set-cat]").forEach((b) => {
    b.addEventListener("click", () => showCat(b.dataset.setCat ?? "general"));
  });
  let initial = "general";
  try {
    initial = localStorage.getItem("anchorline:settings-cat") || "general";
  } catch {
    /* ignore */
  }
  showCat(initial);
}

// 「從端點抓可用模型」：把 datalist 換成端點當下真正支援的清單。
// 寫死清單一定會過期；供應商自己的 /models 不會。
document.getElementById("btn-ai-fetch-models")?.addEventListener("click", async () => {
  const btn = document.getElementById("btn-ai-fetch-models") as HTMLButtonElement;
  const list = document.getElementById("ai-model-options") as HTMLDataListElement | null;
  const out = document.getElementById("ai-test-result");
  // 先把畫面上的金鑰／端點暫存，否則用舊值去問
  store.updateSettings({
    apiKey: (document.getElementById("ai-key") as HTMLInputElement | null)?.value.trim() || store.get().settings.apiKey,
    endpoint: (document.getElementById("ai-endpoint") as HTMLInputElement | null)?.value.trim() || store.get().settings.endpoint,
    model: (document.getElementById("ai-model") as HTMLInputElement | null)?.value.trim() || store.get().settings.model,
  });
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = "抓取中…";
  try {
    const { listModels } = await import("../lib/ai-client");
    const names = await listModels();
    if (list) {
      list.innerHTML = names.map((n) => `<option value="${n}"></option>`).join("");
    }
    if (out) {
      out.textContent = `已更新清單：${names.length} 個模型。點一下模型欄位即可挑選。`;
      out.className = "hint ok";
    }
  } catch (e) {
    if (out) {
      out.textContent = `抓不到清單：${e instanceof Error ? e.message : String(e)}。你仍可直接手打模型 ID。`;
      out.className = "hint bad";
    }
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
});

document.getElementById("btn-ai-test")?.addEventListener("click", async () => {
  const out = document.getElementById("ai-test-result");
  // 先把畫面上的 key 暫存進 store（避免未按儲存就測連線）
  const apiKey = (document.getElementById("ai-key") as HTMLInputElement | null)?.value.trim() ?? "";
  const endpoint = (document.getElementById("ai-endpoint") as HTMLInputElement | null)?.value.trim() ?? "";
  const model = (document.getElementById("ai-model") as HTMLInputElement | null)?.value as AISettings["model"];
  const temperature = Number((document.getElementById("ai-temp") as HTMLInputElement | null)?.value ?? 0.7);
  const localModelName =
    (document.getElementById("ai-local-model") as HTMLInputElement | null)?.value.trim() || "llama3.2";
  store.updateSettings({
    apiKey: apiKey || (model === "local-smart" ? "ollama" : apiKey),
    endpoint:
      endpoint ||
      (model === "local-smart" ? "http://localhost:11434/v1" : endpoint),
    model: model || store.get().settings.model,
    localModelName,
    temperature,
  });
  if (out) out.textContent = "測試中…";
  const { testAiConnection } = await import("../lib/ai-client");
  const r = await testAiConnection();
  if (r.ok) {
    if (out) out.textContent = `成功：${r.sample}`;
    toast("AI 連線測試成功");
  } else {
    if (out) out.textContent = `失敗：${r.reason}`;
    toast(`AI 連線失敗：${r.reason}`);
  }
});

document.getElementById("btn-export-json")?.addEventListener("click", () => {
  exportJsonFile(store.get());
  toast("已匯出 JSON 備份");
});

document.getElementById("btn-export-md")?.addEventListener("click", () => {
  exportMarkdownFile(store.get());
  toast("已匯出 Markdown");
});

document.getElementById("btn-export-html")?.addEventListener("click", () => {
  exportHtmlFile(store.get());
  toast("已匯出 HTML");
});

const fileInput = document.getElementById("file-import") as HTMLInputElement | null;
document.getElementById("btn-import-json")?.addEventListener("click", () => {
  fileInput?.click();
});

fileInput?.addEventListener("change", (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const parsed = JSON.parse(event.target?.result as string) as Partial<AppState> & {
        state?: Partial<AppState>;
      };
      store.importState(parsed.state ?? parsed);
      populateSettings();
      toast("已成功匯入工作區狀態");
    } catch {
      toast("匯入失敗：檔案格式無效");
    }
  };
  reader.readAsText(file);
});

document.getElementById("btn-reset-data")?.addEventListener("click", () => {
  if (confirm("確定要將所有專案與草稿重置為預設範例資料嗎？此操作無法復原。")) {
    store.reset();
    populateSettings();
    toast("已重置為預設範例資料");
  }
});

document.getElementById("btn-toggle-samples")?.addEventListener("click", () => {
  const next = !store.get().showSamples;
  store.setShowSamples(next);
  toast(next ? "已展示範例文件內容" : "已移除範例文件內容");
  populateSettings();
});

document.getElementById("btn-logout")?.addEventListener("click", () => {
  store.logout();
  location.href = "login.html";
});

// kind change toggles family visibility
document.getElementById("new-emp-kind")?.addEventListener("change", () => {
  const kind = (document.getElementById("new-emp-kind") as HTMLSelectElement).value;
  const familyGroup = document.getElementById("family-group");
  const accessEl = document.getElementById("new-emp-access") as HTMLSelectElement | null;
  if (familyGroup) familyGroup.style.display = kind === "agent" ? "" : "none";
  if (accessEl && kind === "agent" && accessEl.value === "admin") accessEl.value = "editor";
});

populateSettings();
store.subscribe(populateSettings);
} // end __authed

