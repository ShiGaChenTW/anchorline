/**
 * 全站底部狀態列：目前頁面 / 專案 / 規格狀態 / 結構 gate / 使用者 / 時鐘
 * 由 requireAuth 注入，不需各 HTML 手寫。
 */
import { store } from "../data/store";
import { type Project, projectDisplayName } from "../data/types";
import { formatBuildStamp, resolveBuildInfo } from "./build-info";
import { evaluatePrdGates } from "./prd-gates";
import { detectRailPage, type RailPage } from "./rail-nav";
import { gateStatusText, projectNameHtml, routeChipHtml } from "./status-bar-view";
import { escapeHtml } from "./ui";

const PAGE_LABEL: Record<RailPage, string> = {
  projects: "專案列表",
  editor: "工作台-PRD",
  write: "PRD 審閱監控",
  signoff: "簽核管理",
  dashboard: "專案儀表板",
  releases: "版本取號",
  overview: "全部專案總覽",
  templates: "PRD 範本",
  openspec: "OpenSpec 入口",
  "openspec-workspace": "工作台-OpenSpec",
  review: "審閱佇列",
  tracking: "Task Tracking",
  history: "提交與 Diff",
  uat: "UAT使用者測試",
  admin: "管理中心",
  agents: "Agent 管理",
  settings: "偏好設定",
};

const ROLE_LABEL: Record<string, string> = {
  admin: "管理員",
  approver: "核准人員",
  editor: "編輯人員",
};

const STATUS_MAP: Record<string, { label: string; tone: string }> = {
  draft: { label: "草稿", tone: "draft" },
  review: { label: "審閱中", tone: "review" },
  approved: { label: "已核准", tone: "ok" },
  withdrawn: { label: "已抽單", tone: "warn" },
};

let ephemeral: { text: string; until: number } | null = null;
let clockTimer: ReturnType<typeof setInterval> | null = null;
let bound = false;

/**
 * 建置識別碼。整個 App 生命週期內是常數 —— 建置期就固定了，算一次即可。
 */
const BUILD = resolveBuildInfo();
const BUILD_STAMP = formatBuildStamp(BUILD);

/**
 * 「我現在跑的是哪一份 build」。
 *
 * 放狀態列最右邊而不是設定頁：要在 3 秒內看到，而且不能為它多開一頁。狀態列是
 * 唯一由 `requireAuth()` 注入、17 個 HTML 進入點共用的區塊，寫一次就全站都有。
 *
 * `#app-build-stamp` 與 `data-build-*` 是對外契約：Scott 用選取複製貼進 bug 報告，
 * 自動化驗證則直接讀屬性，不必去 parse 顯示字串。
 */
function buildStampHtml(): string {
  const title = `建置識別：${BUILD_STAMP}（點一下複製）`;
  return `<span
    class="app-status-build mono"
    id="app-build-stamp"
    title="${escapeHtml(title)}"
    data-build-stamp="${escapeHtml(BUILD_STAMP)}"
    data-build-version="${escapeHtml(BUILD.version)}"
    data-build-commit="${escapeHtml(BUILD.commit)}"
    data-build-dirty="${BUILD.dirty ? "true" : "false"}"
    data-build-time="${escapeHtml(BUILD.builtAt)}"
  >${escapeHtml(BUILD_STAMP)}</span>`;
}

/**
 * 點一下複製建置識別碼。
 *
 * 用 document 事件委派：`renderStatusBar()` 每次 store 變動都重寫 `innerHTML`，
 * 掛在節點上的 listener 下一次 render 就跟著節點一起消失了。
 */
function bindBuildStampCopy() {
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target?.closest("#app-build-stamp")) return;
    // 沒有 clipboard API（非安全來源、舊 webview）就明講，不要假裝複製成功 ——
    // 使用者會直接去貼上，貼到的是上一次剪貼簿的內容
    if (!navigator.clipboard?.writeText) {
      setStatusMessage("此環境無法存取剪貼簿，請手動選取複製");
      return;
    }
    navigator.clipboard.writeText(BUILD_STAMP).then(
      () => setStatusMessage(`已複製建置識別：${BUILD_STAMP}`),
      () => setStatusMessage("複製失敗，請手動選取複製"),
    );
  });
}

/**
 * 狀態列要標示的專案，外加「這是不是真的 focus 專案」。
 *
 * fallback 鏈本身是刻意的 —— 狀態列寧可顯示某個專案，也不要在剛啟動、
 * `activeProjectId` 還沒落地時整條變空白。但 fallback 出來的專案**不能**拿去配
 * gate 結果：`evaluatePrdGates()` 讀的永遠是 `activeProjectId` 的章節內容，
 * 配起來就是 A 專案的名字配 B 專案的檢查結果，而且不會有任何錯誤訊息。
 *
 * 所以這裡把分岔如實回報給呼叫端，而不是呼叫 `setActiveProject()` 去「收斂」它 ——
 * `renderStatusBar` 掛在 `store.subscribe`，在裡面寫 store 會自遞迴。
 */
function activeProject(): { project: Project | null; isFocus: boolean } {
  const st = store.get();
  const visible = st.projects.filter((p) => (st.showSamples ? true : !p.isSample));
  const project =
    visible.find((p) => p.id === st.activeProjectId) ??
    visible[0] ??
    st.projects.find((p) => p.id === st.activeProjectId) ??
    st.projects[0] ??
    null;
  return { project, isFocus: project != null && project.id === st.activeProjectId };
}

function clockText(): string {
  const n = new Date();
  const hh = String(n.getHours()).padStart(2, "0");
  const mm = String(n.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function ensureBar(): HTMLElement | null {
  const app = document.querySelector(".app");
  if (!app) return null;

  let bar = document.getElementById("app-status-bar");
  if (bar) return bar;

  bar = document.createElement("footer");
  bar.id = "app-status-bar";
  bar.className = "app-status-bar";
  bar.setAttribute("role", "status");
  bar.setAttribute("aria-live", "polite");
  bar.setAttribute("aria-label", "狀態列");

  // 放在 mobile-bar 之前（若有），否則 append
  const mobile = app.querySelector(".mobile-bar");
  if (mobile) app.insertBefore(bar, mobile);
  else app.appendChild(bar);

  document.documentElement.classList.add("has-status-bar");
  return bar;
}

export function renderStatusBar(): void {
  const bar = ensureBar();
  if (!bar) return;

  const st = store.get();
  const page = detectRailPage();
  const pageLabel = page ? PAGE_LABEL[page] : "工作台";
  const { project: p, isFocus } = activeProject();
  const name = p ? projectDisplayName(p) : "未選擇專案";
  const stInfo = (p && STATUS_MAP[p.status]) || STATUS_MAP.draft;
  const user = st.currentUser;
  const role = ROLE_LABEL[user.accessRole] ?? user.accessRole;
  // 非 focus 時整條 gate 不計算 —— 算出來的是別的專案的結果（見 activeProject 說明）
  const gate = isFocus ? evaluatePrdGates(st, store.activeGateSpec()) : null;
  const { text: gateText, tone: gateTone } = gateStatusText({ locked: st.locked, gate });

  const eph =
    ephemeral && ephemeral.until > Date.now() ? ephemeral.text : null;
  if (ephemeral && ephemeral.until <= Date.now()) ephemeral = null;

  bar.innerHTML = `
    <div class="app-status-left">
      <span class="app-status-dot app-status-dot--${stInfo.tone}" title="${escapeHtml(stInfo.label)}"></span>
      ${projectNameHtml(name)}
      <span class="app-status-sep" aria-hidden="true">·</span>
      <span class="app-status-page">${escapeHtml(pageLabel)}</span>
      <span class="app-status-pill app-status-pill--${stInfo.tone}">${escapeHtml(stInfo.label)}</span>
      ${routeChipHtml(p)}
    </div>
    <div class="app-status-center" title="${escapeHtml(gateText)}">
      ${
        eph
          ? `<span class="app-status-ephemeral">${escapeHtml(eph)}</span>`
          : gateText
            ? `<span class="app-status-gate app-status-gate--${gateTone}">${escapeHtml(gateText)}</span>`
            : ""
      }
    </div>
    <div class="app-status-right">
      <span class="app-status-user" title="${escapeHtml(user.title || "")}">${escapeHtml(user.name)} · ${escapeHtml(role)}</span>
      <span class="app-status-clock mono" id="app-status-clock">${clockText()}</span>
      ${buildStampHtml()}
    </div>
  `;
}

/** 狀態列短暫訊息（例如儲存成功），不取代 toast */
export function setStatusMessage(text: string, ms = 3200): void {
  ephemeral = { text, until: Date.now() + ms };
  renderStatusBar();
  window.setTimeout(() => {
    if (ephemeral && ephemeral.until <= Date.now()) {
      ephemeral = null;
      renderStatusBar();
    }
  }, ms + 50);
}

export function initStatusBar(): void {
  if (document.querySelector(".app") && !document.getElementById("app-status-bar")) {
    ensureBar();
  }
  renderStatusBar();

  if (!bound) {
    bound = true;
    bindBuildStampCopy();
    store.subscribe(() => renderStatusBar());
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = setInterval(() => {
      const el = document.getElementById("app-status-clock");
      if (el) el.textContent = clockText();
    }, 15_000);
  }
}
