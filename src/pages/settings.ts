import { store } from "../data/store";
import type { AccessRole, ActorKind, AgentFamily, AISettings, AppState, Employee } from "../data/types";
import { ACCESS_ROLE_LABEL, AGENT_FAMILY_LABEL } from "../data/types";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import { exportHtmlFile, exportJsonFile, exportMarkdownFile } from "../lib/export";
import { canManageUsers } from "../lib/permissions";
import { applyFontScale, currentFontScale, FONT_SCALES, initTheme } from "../lib/theme";
import { escapeHtml, initMobileNav, toast, updateUserRailFooter } from "../lib/ui";
import { BUILTIN_PACKS, listDomains } from "../data/domains";
import {
  BASE_DOMAIN,
  baseSectionValue,
  baseValue,
  isInherited,
  isSectionInherited,
  sectionKey,
  type InheritableField,
} from "../lib/ai-writing-config";
import { authorDomainPack, validate as validatePack } from "../lib/domain-pack-author";
import { chatCompletion, isAiConfigured } from "../lib/ai-client";
import { suggestWriteProfile } from "../lib/ai-coach";
import {
  clearPromptOverride,
  isPromptOverridden,
  promptDef,
  PROMPTS,
  setPromptOverride,
} from "../lib/prompt-registry";
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

/**
 * 目前正在編輯哪個領域的設定。只存在畫面上 —— 它是「我現在在看什麼」，
 * 不是使用者的偏好，寫進 settings 只會讓兩台機器互相打架。
 */
let awDomain = BASE_DOMAIN;

function awByDomain() {
  return store.get().settings.aiWriting.byDomain;
}

/** 從 AI 撰寫頁籤讀回設定。找不到欄位時保留原值 —— 頁籤可能還沒渲染。 */
function readAiWriting(): AISettings["aiWriting"] {
  const cur = store.get().settings.aiWriting;
  const ov = document.getElementById("aw-overwrite") as HTMLInputElement | null;
  return { ...cur, overwriteFilled: ov ? ov.checked : cur.overwriteFilled };
}

/**
 * 沿用／自訂的滑動開關。通用領域本身不顯示 —— 它是基底，沒有上游可沿用。
 *
 * 開 = 沿用通用。用開關而不是按鈕：這是一個持續存在的**狀態**，
 * 按鈕只表達動作，看一眼分不出「現在是沿用」還是「按了會變沿用」。
 */
function inheritToggleHtml(inherited: boolean, attr: string): string {
  if (awDomain === BASE_DOMAIN) return "";
  // 選項名稱寫在滑塊裡：外掛一段說明文字的話，使用者得先讀字才知道哪邊是哪邊。
  // 左＝自訂、右＝通用，滑塊停在哪邊就是目前狀態。
  return `<label class="aw-seg" title="左＝這個領域自訂，右＝沿用通用版本">
    <input type="checkbox" ${attr} ${inherited ? "checked" : ""}
      aria-label="設定來源：${inherited ? "沿用通用" : "自訂"}" />
    <span class="aw-seg-track">
      <span class="aw-seg-thumb"></span>
      <span class="aw-seg-opt">自訂</span>
      <span class="aw-seg-opt">通用</span>
    </span>
  </label>`;
}

/** 領域下拉 + 兩個可繼承欄位的狀態 */
function renderAiWritingDomain() {
  const sel = document.getElementById("aw-domain") as HTMLSelectElement | null;
  if (!sel) return;
  const opts = listDomains();
  sel.innerHTML = opts
    .map(
      (o) =>
        `<option value="${escapeHtml(o.name)}" ${o.name === awDomain ? "selected" : ""}>${escapeHtml(o.displayName)}${o.name === BASE_DOMAIN ? "（基底）" : ""}</option>`,
    )
    .join("");

  const desc = document.getElementById("aw-domain-desc");
  if (desc) {
    desc.textContent =
      awDomain === BASE_DOMAIN
        ? "通用是所有領域的基底。這裡改的東西，其他領域只要沒自訂就會跟著變。"
        : "每個欄位預設是這個領域自己的（空白）。滑到「通用」才會沿用通用版本。";
  }

  const byDomain = awByDomain();
  for (const field of ["globalInstruction", "styleSample"] as InheritableField[]) {
    const slot = document.querySelector(`.aw-inherit-slot[data-inherit="${field}"]`);
    const preview = document.querySelector(`.aw-base-preview[data-base="${field}"]`) as HTMLElement | null;
    const box = document.getElementById(
      field === "globalInstruction" ? "aw-global" : "aw-style",
    ) as HTMLTextAreaElement | null;
    const inherited = isInherited(byDomain, awDomain, field);
    const baseText = baseValue(byDomain, field);

    if (slot) slot.innerHTML = inheritToggleHtml(inherited, `data-inherit-toggle="${field}"`);
    if (box) {
      // 沿用中就唯讀：可以打字但存不進去的欄位比不能打字更糟
      box.readOnly = inherited;
      box.classList.toggle("is-inherited", inherited);
      box.value = inherited ? "" : (byDomain[awDomain]?.[field as keyof typeof byDomain[string]] as string | undefined ?? "");
      box.placeholder = inherited ? "沿用通用版本（見下方）" : box.dataset.ph || box.placeholder;
    }
    if (preview) {
      preview.hidden = !inherited;
      preview.innerHTML = inherited
        ? `<span class="aw-base-tag">通用版本</span><pre>${escapeHtml(baseText || "（通用也是空的，等於不設定）")}</pre>`
        : "";
    }
  }
}

/**
 * 各章節的 prompt 覆寫。章節清單來自**目前選的領域包**（不是目前專案），
 * 所以在設定頁選支付就會看到支付的 08–10。
 *
 * 領域限定章節（通用沒有的那些）不顯示沿用按鈕 —— 沒有通用版可繼承。
 */
function renderAiWritingSections() {
  const host = document.getElementById("aw-sections");
  if (!host) return;
  const byDomain = awByDomain();
  const sections = store.sectionsForDomain(awDomain);
  const genericIds = new Set(store.sectionsForDomain(BASE_DOMAIN).map((x) => x.id));

  host.innerHTML = sections
    .map((sec) => {
      const inherited = isSectionInherited(byDomain, awDomain, sec.id);
      const own = byDomain[awDomain]?.sectionPrompts?.[sec.id] ?? "";
      const baseText = baseSectionValue(byDomain, sec.id);
      const inheritable = awDomain !== BASE_DOMAIN && genericIds.has(sec.id);
      const btn = inheritable
        ? inheritToggleHtml(inherited, `data-sec-toggle="${escapeHtml(sec.id)}"`)
        : awDomain === BASE_DOMAIN
          ? ""
          : '<span class="aw-seg-static" title="通用領域沒有這一節，所以沒有通用版本可沿用">領域限定章節</span>';
      const shown = inheritable && inherited ? "" : own;
      return `<div class="aw-section">
        <div class="aw-field-head">
          <label for="aw-sec-${escapeHtml(sec.id)}">
            ${escapeHtml(sec.n)} · ${escapeHtml(sec.title)}
            ${shown ? '<span class="aw-badge">已覆寫</span>' : ""}
          </label>
          ${btn}
        </div>
        <textarea id="aw-sec-${escapeHtml(sec.id)}" data-aw-section="${escapeHtml(sec.id)}" rows="2"
          ${inheritable && inherited ? "readonly" : ""}
          class="${inheritable && inherited ? "is-inherited" : ""}"
          placeholder="${inheritable && inherited ? "沿用通用版本（見下方）" : "留空＝用內建 prompt"}">${escapeHtml(shown)}</textarea>
        ${
          inheritable && inherited
            ? `<div class="aw-base-preview"><span class="aw-base-tag">通用版本</span><pre>${escapeHtml(baseText || "（通用沒設定，等於用內建 prompt）")}</pre></div>`
            : ""
        }
      </div>`;
    })
    .join("");
}

/**
 * 綁定領域頁籤的互動。全部走事件委派 —— 這幾塊會整個 innerHTML 重畫，
 * 直接綁在按鈕上的 listener 每次重畫都會消失。
 *
 * 一律不用 window.prompt：Tauri 的 WKWebView 沒有實作 text input panel，
 * prompt 直接回 null，按鈕看起來就像壞掉（上一版的「新增角色」就是這樣）。
 */
function bindAiWritingDomain() {
  const root = document.querySelector('.settings-section[data-cat="aiwrite"]') as HTMLElement | null;
  if (!root || root.dataset.bound === "1") return;
  root.dataset.bound = "1";

  const sel = document.getElementById("aw-domain") as HTMLSelectElement | null;
  sel?.addEventListener("change", () => {
    // 先抓值：下面的存檔會 emit，訂閱者重畫 <option selected> 會把 sel.value 打回原值
    const target = sel.value;
    saveCurrentDomainFields();
    awDomain = target;
    populateSettings();
  });

  root.addEventListener("click", (ev) => {
    if ((ev.target as HTMLElement | null)?.closest("#btn-aw-suggest")) void runProfileSuggestion();
  });

  // 滑塊走 change。右（checked）= 沿用通用，左 = 自訂。
  // 切換只改來源標記，**不動已寫的自訂內容** —— 切過去再切回來，字還在。
  root.addEventListener("change", (ev) => {
    const el = ev.target as HTMLInputElement | null;
    if (!el) return;

    const field = el.dataset.inheritToggle;
    const secId = el.dataset.secToggle;
    if (!field && !secId) return;

    // 切成沿用之前先把畫面上的字存起來，否則這一輪打的內容會被重畫蓋掉
    saveCurrentDomainFields();
    store.setDomainInherit(awDomain, field ?? sectionKey(secId!), el.checked);
    populateSettings();
  });
}

/** 把畫面上的可編輯欄位寫回目前領域（沿用中的欄位不寫，否則會意外變成自訂） */
function saveCurrentDomainFields() {
  const byDomain = awByDomain();
  const g = document.getElementById("aw-global") as HTMLTextAreaElement | null;
  const st = document.getElementById("aw-style") as HTMLTextAreaElement | null;
  if (g && !isInherited(byDomain, awDomain, "globalInstruction")) {
    store.setDomainWriteField(awDomain, "globalInstruction", g.value);
  }
  if (st && !isInherited(byDomain, awDomain, "styleSample")) {
    store.setDomainWriteField(awDomain, "styleSample", st.value);
  }
  document
    .querySelectorAll<HTMLTextAreaElement>("#aw-sections textarea[data-aw-section]")
    .forEach((ta) => {
      const id = ta.dataset.awSection!;
      if (ta.readOnly) return;
      store.setDomainSectionPrompt(awDomain, id, ta.value.trim());
    });
}

/**
 * 讓 AI 產生這個領域的全域指令。
 * 結果**填進欄位讓使用者改**，不直接生效 —— 這是建議不是決定。
 */
async function runProfileSuggestion() {
  const briefEl = document.getElementById("aw-brief") as HTMLInputElement | null;
  const btn = document.getElementById("btn-aw-suggest") as HTMLButtonElement | null;
  const brief = briefEl?.value.trim();
  if (!brief) return void toast("先用一句話說這個領域的 PRD 寫給誰看");
  if (!isAiConfigured()) return void toast("尚未設定 AI 金鑰（設定 → AI 工具）");

  if (btn) {
    btn.disabled = true;
    btn.textContent = "產生中…";
  }
  try {
    const sug = await suggestWriteProfile(brief);
    // 寫進目前領域（自動從「沿用」轉成「自訂」）—— 建議要有落點才有用
    store.setDomainWriteField(awDomain, "globalInstruction", sug.globalInstruction);
    if (sug.styleSample.trim()) {
      store.setDomainWriteField(awDomain, "styleSample", sug.styleSample);
    }
    populateSettings();
    toast("已填入建議 —— 內容可以直接改");
  } catch (e) {
    toast(e instanceof Error ? e.message : "產生失敗");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "產生建議";
    }
  }
}

/**
 * 介面字級選擇器。每個選項用**自己代表的字級**顯示 ——
 * 用同樣大小的字寫「大」「緊湊」等於要使用者先選了才知道結果。
 */
function renderFontScale() {
  const host = document.getElementById("fs-picker");
  if (!host) return;
  const cur = currentFontScale();
  host.innerHTML = FONT_SCALES.map(
    (s) => `<button type="button" class="fs-opt ${s.id === cur ? "is-on" : ""}"
      role="radio" aria-checked="${s.id === cur}" data-fs="${s.id}">
      <span class="fs-sample" style="font-size:${Math.round(13 * s.value)}px">Aa</span>
      <span class="fs-name">${s.label}</span>
      <span class="fs-pct">${Math.round(s.value * 100)}%</span>
    </button>`,
  ).join("");

  if (host.dataset.bound === "1") return;
  host.dataset.bound = "1";
  host.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement | null)?.closest<HTMLElement>("[data-fs]");
    if (!btn) return;
    applyFontScale(btn.dataset.fs);
    renderFontScale();
  });
}

/**
 * 把使用者正在編輯的欄位排除在重畫之外。
 *
 * populateSettings 掛在 store.subscribe 上，所以**任何**一次寫入都會重畫全部欄位。
 * 使用者游標還在裡面的那一個，重畫等於把他打到一半的字換成舊值，游標跳到尾端。
 * 儲存路徑的先讀後寫已經處理了 saveSettings 這一條；這裡擋的是其他任何來源的
 * emit（別的分頁、背景動作、之後才加的功能）。
 */
function skipIfEditing(el: HTMLElement | null): boolean {
  return el !== null && document.activeElement === el;
}

function populateSettings() {
  const s = store.get().settings;
  renderFontScale();

  const awO = document.getElementById("aw-overwrite") as HTMLInputElement | null;
  if (awO) awO.checked = s.aiWriting.overwriteFilled;
  renderAiWritingDomain();
  renderAiWritingSections();
  bindAiWritingDomain();
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

  const providerEl = document.getElementById("ai-provider") as HTMLSelectElement | null;
  if (providerEl && !skipIfEditing(providerEl)) providerEl.value = s.provider ?? "auto";
  if (modelEl && !skipIfEditing(modelEl)) modelEl.value = s.model;
  if (tempEl) tempEl.value = String(s.temperature);
  if (tempValEl) tempValEl.textContent = String(s.temperature);
  if (keyEl && !skipIfEditing(keyEl)) keyEl.value = s.apiKey || "";
  if (endpointEl && !skipIfEditing(endpointEl)) endpointEl.value = s.endpoint || "";
  const localModelEl = document.getElementById("ai-local-model") as HTMLInputElement | null;
  if (localModelEl && !skipIfEditing(localModelEl)) localModelEl.value = s.localModelName || "llama3.2";
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
  const provider = (document.getElementById("ai-provider") as HTMLSelectElement | null)?.value;
  const group = document.getElementById("local-model-group");
  // 選了 Ollama 通路也要看得到本機模型名稱欄位 —— 不是只有 model === local-smart
  // 那條舊捷徑才算「在跑本機」。
  if (group) group.style.display = model === "local-smart" || provider === "ollama" ? "" : "none";
}

/** 各通路的預設端點。使用者仍可覆寫 —— 這是起點，不是鎖。 */
const PROVIDER_ENDPOINT: Record<string, string> = {
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  openrouter: "https://openrouter.ai/api/v1",
  ollama: "http://localhost:11434/v1",
};

/** 我們自己填過的端點才可以自動改掉；使用者手打的自訂端點絕不覆寫。 */
const OURS = Object.values(PROVIDER_ENDPOINT);

function applyProviderDefaults(provider: string) {
  const endpointEl = document.getElementById("ai-endpoint") as HTMLInputElement | null;
  const keyEl = document.getElementById("ai-key") as HTMLInputElement | null;
  const want = PROVIDER_ENDPOINT[provider];
  if (endpointEl && want) {
    const current = endpointEl.value.trim();
    if (!current || OURS.includes(current)) endpointEl.value = want;
  }
  if (provider === "ollama" && keyEl && !keyEl.value.trim()) {
    keyEl.placeholder = "可填 ollama 或任意字";
  }
  syncLocalModelUi();
}

document.getElementById("ai-provider")?.addEventListener("change", () => {
  const provider = (document.getElementById("ai-provider") as HTMLSelectElement).value;
  applyProviderDefaults(provider);
});

document.getElementById("ai-model")?.addEventListener("input", () => {
  // 通路是明示的就別動端點 —— 使用者已經講了要走哪裡，模型 ID 沒有發言權。
  const provider = (document.getElementById("ai-provider") as HTMLSelectElement | null)?.value ?? "auto";
  if (provider !== "auto") {
    syncLocalModelUi();
    return;
  }
  const model = (document.getElementById("ai-model") as HTMLInputElement).value;
  if (model === "local-smart") applyProviderDefaults("ollama");
  else if (model.startsWith("gemini")) applyProviderDefaults("gemini");
  else if (model.startsWith("gpt")) applyProviderDefaults("openai");
  else if (model.startsWith("claude")) applyProviderDefaults("anthropic");
  else if (model.includes("/")) applyProviderDefaults("openrouter"); // vendor/model 格式只有 router 在用
  else syncLocalModelUi();
});

function saveSettings() {
  // **先把畫面上的值全部讀完，再做任何 store 寫入。**
  //
  // 每一次 store 寫入都會 emit，訂閱者立刻重跑 populateSettings，把每個欄位用
  // 「已存的舊值」重畫。所以只要在寫入之後才讀某個欄位，讀到的就是舊值 ——
  // 使用者剛打的字被自己的儲存動作吃掉。
  //
  // 原本的寫法只把 saveCurrentDomainFields() 提到 updateSettings 之前，但它自己
  // 就會寫 store（setDomainWriteField / setDomainSectionPrompt，每個 section 一次），
  // 而底下這些欄位是在它之後才讀的。實測一次 change 事件讓 #ai-model 被舊值覆寫
  // 10 次，打進去的模型 ID 完全存不下來。分界線在這裡，不在函式呼叫的順序。
  const model = (document.getElementById("ai-model") as HTMLInputElement).value as AISettings["model"];
  const provider = ((document.getElementById("ai-provider") as HTMLSelectElement | null)?.value ??
    "auto") as AISettings["provider"];
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

  // 讀完了，從這裡開始才可以寫。
  saveCurrentDomainFields();

  store.updateSettings({
    model,
    provider,
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

// ── AI 按鈕與 Prompt（prompt-registry）────────────────────────────
// 名冊是資料，這裡只負責畫表與收表單。一次只展開一列 —— 同時編兩份 prompt
// 沒有正當用途，只會讓「儲存了哪一份」變得不確定。

let openPromptId: string | null = null;

function renderPromptRegistry(): void {
  const host = document.getElementById("prompt-registry-root");
  if (!host) return;
  const ov = store.get().settings.promptOverrides ?? {};

  host.innerHTML = `<table class="pr-table">
    <thead><tr>
      <th>按鈕／流程</th><th>使用位置</th><th>溫度</th><th>回傳</th><th>狀態</th><th></th>
    </tr></thead>
    <tbody>
      ${PROMPTS.map((p) => {
        const o = ov[p.id];
        const temp = typeof o?.temperature === "number" ? o.temperature : p.temperature;
        const custom = isPromptOverridden(p.id);
        const open = openPromptId === p.id;
        const row = `<tr class="pr-row${open ? " is-open" : ""}" data-pr-id="${escapeHtml(p.id)}">
          <td class="pr-label">${escapeHtml(p.label)}</td>
          <td class="pr-where">${escapeHtml(p.where)}</td>
          <td class="mono">${temp === null ? "預設" : temp}</td>
          <td>${p.jsonMode ? "JSON" : "純文字"}</td>
          <td>${custom ? `<span class="pr-badge is-custom">已自訂</span>` : `<span class="pr-badge">預設</span>`}</td>
          <td><button type="button" class="btn btn-sm" data-pr-edit="${escapeHtml(p.id)}">${open ? "收合" : "編輯"}</button></td>
        </tr>`;
        if (!open) return row;
        const effective = o?.system?.trim() || p.system;
        return `${row}<tr class="pr-editor-row"><td colspan="6">
          <div class="pr-editor">
            <p class="hint">可用變數：${p.vars.length ? p.vars.map((v) => `<code>{{${escapeHtml(v)}}}</code>`).join(" ") : "（無）"}
              ${p.jsonMode ? "　·　⚠️ 這份 prompt 的回傳接 JSON 解析器，改動時保留輸出格式段落" : ""}</p>
            <textarea id="pr-system" rows="14" spellcheck="false">${escapeHtml(effective)}</textarea>
            <div class="pr-editor-foot">
              <label>溫度
                <input type="number" id="pr-temp" min="0" max="1" step="0.05"
                       value="${typeof o?.temperature === "number" ? o.temperature : p.temperature ?? ""}"
                       placeholder="${p.temperature === null ? "provider 預設" : String(p.temperature)}" />
              </label>
              <span style="flex:1"></span>
              ${custom ? `<button type="button" class="btn btn-sm btn-ghost" data-pr-reset="${escapeHtml(p.id)}">還原預設</button>` : ""}
              <button type="button" class="btn btn-sm btn-primary" data-pr-save="${escapeHtml(p.id)}">儲存</button>
            </div>
          </div>
        </td></tr>`;
      }).join("")}
    </tbody>
  </table>`;

  host.querySelectorAll<HTMLButtonElement>("[data-pr-edit]").forEach((b) => {
    b.onclick = () => {
      openPromptId = openPromptId === b.dataset.prEdit ? null : b.dataset.prEdit!;
      renderPromptRegistry();
    };
  });
  host.querySelectorAll<HTMLButtonElement>("[data-pr-save]").forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.prSave!;
      const system = (document.getElementById("pr-system") as HTMLTextAreaElement).value;
      const tempRaw = (document.getElementById("pr-temp") as HTMLInputElement).value.trim();
      const temperature = tempRaw === "" ? (promptDef(id).temperature ?? undefined) : Number(tempRaw);
      if (tempRaw !== "" && (!Number.isFinite(temperature) || temperature! < 0 || temperature! > 1)) {
        toast("溫度要在 0–1 之間");
        return;
      }
      setPromptOverride(id, { system, temperature });
      toast(isPromptOverridden(id) ? `已自訂「${promptDef(id).label}」` : "內容與預設相同 —— 維持預設");
      renderPromptRegistry();
    };
  });
  host.querySelectorAll<HTMLButtonElement>("[data-pr-reset]").forEach((b) => {
    b.onclick = () => {
      if (!confirm(`把「${promptDef(b.dataset.prReset!).label}」還原成內建 prompt 與參數？`)) return;
      clearPromptOverride(b.dataset.prReset!);
      toast("已還原預設");
      renderPromptRegistry();
    };
  });
}

renderPromptRegistry();

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

