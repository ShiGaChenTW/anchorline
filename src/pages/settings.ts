import { store } from "../data/store";
import type { AccessRole, ActorKind, AgentFamily, AISettings, AppState, Employee } from "../data/types";
import { ACCESS_ROLE_LABEL, AGENT_FAMILY_LABEL } from "../data/types";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import { exportHtmlFile, exportJsonFile, exportMarkdownFile } from "../lib/export";
import { canManageUsers } from "../lib/permissions";
import { initTheme } from "../lib/theme";
import { escapeHtml, initMobileNav, toast, updateUserRailFooter } from "../lib/ui";
import { BUILTIN_PACKS, listDomains } from "../data/domains";
import { authorDomainPack, validate as validatePack } from "../lib/domain-pack-author";
import { chatCompletion, isAiConfigured } from "../lib/ai-client";
import TEMPLATE_MD from "../data/domains/_template.md?raw";
import {
  addUserPack,
  autoRescanEnabled,
  canUseUserDomains,
  clearUserDomains,
  getUserPacks,
  isDirAuthorized,
  pickUserDomainsFolder,
  refreshUserDomains,
  saveUserPackToDisk,
  setAutoRescan,
  userDomainsDir,
} from "../lib/user-domains";

const __authed = requireAuth();
if (__authed) {
initTheme();
initMobileNav("settings");
bindLogout();

function syncUser() {
  const u = store.get().currentUser;
  updateUserRailFooter(toRailUser(u));
}

/** 從 AI 撰寫頁籤讀回設定。找不到欄位時保留原值 —— 頁籤可能還沒渲染。 */
function readAiWriting(): AISettings["aiWriting"] {
  const cur = store.get().settings.aiWriting;
  const g = document.getElementById("aw-global") as HTMLTextAreaElement | null;
  const st = document.getElementById("aw-style") as HTMLTextAreaElement | null;
  const ov = document.getElementById("aw-overwrite") as HTMLInputElement | null;

  const sectionPrompts: Record<string, string> = {};
  document
    .querySelectorAll<HTMLTextAreaElement>("#aw-sections textarea[data-aw-section]")
    .forEach((ta) => {
      const v = ta.value.trim();
      // 只存有內容的 —— 空字串跟「沒設定」是同一件事，不必佔位
      if (v) sectionPrompts[ta.dataset.awSection!] = v;
    });

  return {
    globalInstruction: g ? g.value : cur.globalInstruction,
    styleSample: st ? st.value : cur.styleSample,
    overwriteFilled: ov ? ov.checked : cur.overwriteFilled,
    sectionPrompts: document.getElementById("aw-sections") ? sectionPrompts : cur.sectionPrompts,
  };
}

/**
 * 各章節的 prompt 覆寫。章節清單來自目前的領域包，所以換領域後這裡也會跟著換 ——
 * 舊領域留下的覆寫仍存在 settings 裡，只是不顯示（跟章節正文的孤兒處理一致，不刪）。
 */
function renderAiWritingSections() {
  const host = document.getElementById("aw-sections");
  if (!host) return;
  const { sections, settings } = store.get();
  const saved = settings.aiWriting.sectionPrompts ?? {};

  host.innerHTML = sections
    .map(
      (sec) => `<div class="aw-section">
        <label for="aw-sec-${escapeHtml(sec.id)}">
          ${escapeHtml(sec.n)} · ${escapeHtml(sec.title)}
          ${saved[sec.id] ? '<span class="aw-badge">已覆寫</span>' : ""}
        </label>
        <textarea id="aw-sec-${escapeHtml(sec.id)}" data-aw-section="${escapeHtml(sec.id)}" rows="2"
          placeholder="留空＝用內建 prompt">${escapeHtml(saved[sec.id] ?? "")}</textarea>
      </div>`,
    )
    .join("");
}

function populateSettings() {
  const s = store.get().settings;

  const awG = document.getElementById("aw-global") as HTMLTextAreaElement | null;
  const awS = document.getElementById("aw-style") as HTMLTextAreaElement | null;
  const awO = document.getElementById("aw-overwrite") as HTMLInputElement | null;
  if (awG) awG.value = s.aiWriting.globalInstruction;
  if (awS) awS.value = s.aiWriting.styleSample;
  if (awO) awO.checked = s.aiWriting.overwriteFilled;
  renderAiWritingSections();
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
        // 「角色：X」那一行拿掉了 —— 右邊的下拉本來就寫著同一件事，
        // 同一個事實講兩次只是讓四行文字擠在一起、誰都不突出。
        // 族系只有 Agent 有意義，人員不必佔一行講「族系：—」。
        const meta = [e.title, e.email, e.kind === "agent" ? `族系 ${family}` : ""]
          .filter(Boolean)
          .map((s) => escapeHtml(s))
          .join(" · ");
        return `
        <div class="emp-card">
          <div class="avatar emp-card-avatar">${escapeHtml(e.avatar || e.name.slice(0, 1))}</div>
          <div class="emp-card-name">
            ${escapeHtml(e.name)}
            ${isCur ? '<span class="pill pill-approved">目前登入</span>' : ""}
            <span class="pill">${kind}</span>
          </div>
          <div class="emp-card-meta">${meta}</div>
          <div class="emp-card-controls">
            ${
              canManage
                ? `<label class="emp-card-role">角色
                    <select class="emp-role" data-id="${e.id}" aria-label="${escapeHtml(e.name)} 的系統角色">
                      ${roleOpts}
                    </select>
                  </label>`
                : ""
            }
            ${
              !isCur
                ? `<button type="button" class="btn btn-sm btn-ghost btn-switch-emp" data-id="${e.id}">切換登入</button>`
                : ""
            }
            ${
              canManage && !isCur
                ? `<button type="button" class="btn btn-sm btn-ghost btn-del-emp" data-id="${e.id}">刪除</button>`
                : ""
            }
          </div>
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
    aiWriting: readAiWriting(),
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

// ── 領域包 ───────────────────────────────────────────────────

function renderDomainPacks() {
  const status = document.getElementById("domain-pack-status");
  const list = document.getElementById("domain-pack-list");
  const pick = document.getElementById("btn-pick-domains") as HTMLButtonElement | null;
  if (pick) {
    pick.disabled = !canUseUserDomains();
    pick.title = canUseUserDomains() ? "" : "自訂領域包需要桌面版";
  }

  const dir = userDomainsDir();
  const { errors } = getUserPacks();
  const auto = document.getElementById("domain-auto-rescan") as HTMLInputElement | null;
  if (auto) {
    auto.checked = autoRescanEnabled();
    // 沒指定資料夾就沒有東西可以重掃
    auto.disabled = !dir || !canUseUserDomains();
  }
  if (status) {
    status.textContent = dir
      ? `自訂資料夾：${dir}${errors.length ? `（${errors.length} 個檔解析失敗）` : ""}`
      : "尚未指定自訂資料夾，目前只有內建領域。";
    // 寫入授權在 Rust 端，可能與 localStorage 記的資料夾不同步（App 更新後第一次）。
    // 提前講，比讓人按下去才看到「不能寫入這個位置」好。
    if (dir) {
      void isDirAuthorized().then((ok) => {
        if (!ok && status.textContent?.startsWith("自訂資料夾")) {
          status.textContent += " · ⚠️ 寫入授權需重新確認，第一次存檔時會請你再選一次這個資料夾";
        }
      });
    }
  }

  if (!list) return;
  const rows = listDomains()
    .map(
      (d) =>
        `<div class="domain-pack-row">
           <strong>${escapeHtml(d.displayName)}</strong>
           <code>${escapeHtml(d.name)}</code>
           <span class="tag">${d.custom ? (d.name in BUILTIN_PACKS ? "自訂（覆寫內建）" : "自訂") : "內建"}</span>
         </div>`,
    )
    .join("");
  // 解析失敗要看得到是哪個檔為什麼——默默少一個領域是最難查的那種問題
  const errRows = errors
    .map(
      (e) =>
        `<div class="domain-pack-row domain-pack-row--err"><strong>${escapeHtml(e.file)}</strong><span>${escapeHtml(e.message)}</span></div>`,
    )
    .join("");
  list.innerHTML = rows + errRows;
}

document.getElementById("btn-pick-domains")?.addEventListener("click", async () => {
  const r = await pickUserDomainsFolder();
  if (!r.ok) {
    toast(r.reason);
    return;
  }
  store.refreshDomainPacks();
  renderDomainPacks();
  toast(`已載入 ${r.count} 個自訂領域${r.errors.length ? `（${r.errors.length} 個失敗）` : ""}`);
});

document.getElementById("btn-refresh-domains")?.addEventListener("click", async () => {
  const r = await refreshUserDomains();
  if (!r.ok) {
    toast(r.reason);
    return;
  }
  store.refreshDomainPacks();
  renderDomainPacks();
  toast(`已重新讀取 ${r.count} 個自訂領域`);
});

// ── 用 AI 產生領域包 ──────────────────────────────────────────

function daEl<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function daStatus(msg: string, tone: "" | "err" = "") {
  const el = daEl("da-status");
  if (!el) return;
  el.textContent = msg;
  el.style.color = tone === "err" ? "var(--danger)" : "";
}

function daShow(raw: string) {
  const box = daEl("da-result");
  const ta = daEl<HTMLTextAreaElement>("da-raw");
  if (ta) ta.value = raw;
  if (box) box.hidden = false;
}

/**
 * 存檔。桌面版寫進領域包資料夾（WKWebView 沒有下載管理員，`<a download>`
 * 按下去是靜默無事——不是報錯，所以特別難查）；瀏覽器版走 blob 下載。
 */
async function saveMd(filename: string, text: string) {
  if (canUseUserDomains()) {
    const r = await saveUserPackToDisk(filename, text);
    toast(r.ok ? `已存到 ${r.path}` : `存檔失敗：${r.reason}`);
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function daRun(input: { brief: string; prior?: string; instruction?: string }) {
  if (!isAiConfigured()) {
    daStatus("尚未設定 AI 金鑰。請先在上面「AI 寫作教練模型與金鑰設定」填好並儲存。", "err");
    return;
  }
  const btns = ["da-generate", "da-refine"].map((id) => daEl<HTMLButtonElement>(id));
  btns.forEach((b) => b && (b.disabled = true));
  daStatus("產生中…（會先過解析器驗證，不合格會自動修一次）");
  try {
    const r = await authorDomainPack(input, chatCompletion);
    if (!r.ok) {
      daStatus(`產生失敗：${r.reason}`, "err");
      // 失敗的原文也給出來——多半只要手改一兩行就能用，丟掉太浪費
      if (r.raw) daShow(r.raw);
      return;
    }
    daShow(r.raw);
    daStatus(
      `已產生「${r.pack.displayName}」（${r.pack.sections?.length ?? 0} 個章節）${r.repaired ? " · 第一次驗證未過，已自動修正" : ""}`,
    );
  } finally {
    btns.forEach((b) => b && (b.disabled = false));
  }
}

daEl("da-generate")?.addEventListener("click", () => {
  const brief = daEl<HTMLTextAreaElement>("da-brief")?.value.trim() ?? "";
  if (brief.length < 10) {
    daStatus("描述太短。至少寫出產業、產品類型，以及一條必須守的規矩。", "err");
    return;
  }
  void daRun({ brief });
});

daEl("da-refine")?.addEventListener("click", () => {
  const prior = daEl<HTMLTextAreaElement>("da-raw")?.value ?? "";
  const instruction = daEl<HTMLInputElement>("da-instruction")?.value.trim() ?? "";
  if (!prior.trim()) return;
  void daRun({ brief: daEl<HTMLTextAreaElement>("da-brief")?.value ?? "", prior, instruction });
});

daEl("da-template")?.addEventListener("click", () => {
  void saveMd("domain-pack-template.md", TEMPLATE_MD);
});

daEl("da-download")?.addEventListener("click", () => {
  const raw = daEl<HTMLTextAreaElement>("da-raw")?.value ?? "";
  const v = validatePack(raw);
  void saveMd(v.ok ? `${v.pack.name}.md` : "domain-pack.md", raw);
});

daEl("da-add")?.addEventListener("click", async () => {
  // 手改過的內容要重新驗——textarea 是可編輯的，不能信任上一次的驗證結果
  const raw = daEl<HTMLTextAreaElement>("da-raw")?.value ?? "";
  const v = validatePack(raw);
  if (!v.ok) {
    daStatus(`還不能加入：${v.reason}`, "err");
    return;
  }
  const r = await addUserPack(`${v.pack.name}.md`, raw);
  if (!r.ok) {
    daStatus(r.reason, "err");
    return;
  }
  store.refreshDomainPacks();
  renderDomainPacks();
  toast(
    r.persisted === "disk"
      ? `已寫入領域包資料夾：${v.pack.name}.md`
      : `已加入「${v.pack.displayName}」— 只存在這台瀏覽器，建議下載後放進資料夾`,
  );
});

document.getElementById("domain-auto-rescan")?.addEventListener("change", (e) => {
  const on = (e.target as HTMLInputElement).checked;
  setAutoRescan(on);
  toast(on ? "開 App 時會自動重掃領域包資料夾" : "已關閉自動重掃 — 按「重新讀取」才更新");
});

document.getElementById("btn-clear-domains")?.addEventListener("click", () => {
  if (!confirm("清除自訂領域包？已經選了自訂領域的專案會退回通用，但內容不會被刪除。")) return;
  clearUserDomains();
  store.refreshDomainPacks();
  renderDomainPacks();
  toast("已清除自訂領域包");
});

populateSettings();
renderDomainPacks();
store.subscribe(populateSettings);
} // end __authed

