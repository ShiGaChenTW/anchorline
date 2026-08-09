/**
 * ADHD 友善介面層：
 * - 每頁只強調「現在下一步」
 * - 工具列次要按鈕收進「更多」
 * - 降低同時可見選項（統計／計劃列可摺疊）
 */
import { store } from "../data/store";
import { projectDisplayName } from "../data/types";
import { detectRailPage, type RailPage } from "./rail-nav";

type NextStep = {
  label: string;
  detail: string;
  cta?: string;
  href?: string;
  action?: () => void;
};

function nextStepForPage(page: RailPage | null): NextStep {
  const st = store.get();
  const projects = st.projects.filter((p) => (st.showSamples ? true : !p.isSample));
  const active =
    projects.find((p) => p.id === st.activeProjectId) ?? projects[0] ?? null;
  const name = active ? projectDisplayName(active) : "";

  switch (page) {
    case "projects":
      if (!projects.length) {
        return {
          label: "下一步",
          detail: "先建立第一份規格：匯入資料夾或新建空白 PRD，一次只選一個。",
          cta: "匯入專案",
          action: () => document.getElementById("btn-import")?.click(),
        };
      }
      return {
        label: "下一步",
        detail: name
          ? `目前：${name}。打開編輯台繼續填寫章節。`
          : `你有 ${projects.length} 個專案，選一個開始寫。`,
        cta: "進入編輯",
        href: "editor.html",
      };
    case "editor":
      // 標題已在 toolbar h1；此處只補「下一步」文案，CTA 用工具列「送出審閱／預覽審閱」
      return {
        label: active ? "下一步" : "先選一個專案",
        detail: active
          ? "左側章節由上往下填。空的先補齊，再送出審閱。"
          : "回總覽，點一個專案。",
        cta: active ? undefined : "專案列表",
        href: active ? undefined : "overview.html",
      };
    case "review":
      return {
        label: "下一步",
        detail: "檢查後再決定：沒問題就核准；要改字就返回編輯。",
        // 工具列已有「返回編輯」— 不重複 CTA
      };
    case "templates":
      return {
        label: "下一步",
        detail: "挑選段落骨架插入後，回編輯台改成你的內容。",
        cta: "回編輯",
        href: "editor.html",
      };
    case "tracking":
      return {
        label: "下一步",
        detail: "這裡只看任務進度；要改規格請回編輯台。",
        cta: "回編輯",
        href: "editor.html",
      };
    case "admin":
      return {
        label: "下一步",
        detail: "人員與流程在此調整；日常寫作請回專案列表。",
        cta: "回總覽",
        href: "overview.html",
      };
    case "agents":
      return {
        label: "下一步",
        detail: "調完 prompt／進場後，回編輯台繼續寫內容。",
        cta: "回編輯",
        href: "editor.html",
      };
    case "settings":
      return {
        label: "下一步",
        detail: "行號、主題、AI 金鑰與備份都在這裡；改完回專案。",
        cta: "回總覽",
        href: "overview.html",
      };
    case "overview":
      return {
        label: "下一步",
        detail: "頭條指的那一個就是現在最該碰的。其餘稍後再看。",
      };
    case "dashboard":
      return {
        label: "下一步",
        detail: "這頁只看現況。要動內容回編輯台。",
        cta: "回編輯台",
        href: "editor.html",
      };
    default:
      return {
        label: "從專案開始",
        detail: "側欄上方點一個專案卡片，或按「＋」新建。",
      };
  }
}

/**
 * 全站：工具列 + 焦點條合併為單一 chrome（對齊編輯工作台）
 * 避免標題列與「下一步」雙層重複、雙 CTA。
 */
/** 引導列是否被使用者收起來 */
const FOCUS_HIDDEN_KEY = "anchorline:hide-focus-strip";
function focusHidden(): boolean {
  try {
    return localStorage.getItem(FOCUS_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}
export function setFocusStripHidden(hidden: boolean) {
  try {
    localStorage.setItem(FOCUS_HIDDEN_KEY, hidden ? "1" : "0");
  } catch {
    /* private mode */
  }
  document.documentElement.classList.toggle("hide-focus-strip", hidden);
  const btn = document.getElementById("btn-toggle-focus-strip");
  if (btn) btn.textContent = hidden ? "顯示引導列" : "隱藏引導列";
}

function integratePageChrome(step: NextStep) {
  const main = document.querySelector(".main");
  const toolbar = main?.querySelector(".toolbar") as HTMLElement | null;
  if (!toolbar) {
    // 無 toolbar 的頁面才退回獨立焦點條
    ensureStandaloneFocusStrip(step);
    return;
  }

  document.getElementById("adhd-focus-strip")?.remove();

  toolbar.classList.add("adhd-page-chrome", "adhd-editor-chrome", "adhd-toolbar");

  let chromeMain = toolbar.querySelector(".adhd-page-chrome-main, .adhd-editor-chrome-main") as HTMLElement | null;
  if (!chromeMain) {
    const titleBlock = toolbar.querySelector("h1")?.parentElement as HTMLElement | null;
    if (!titleBlock || titleBlock === toolbar) {
      ensureStandaloneFocusStrip(step);
      return;
    }

    chromeMain = document.createElement("div");
    chromeMain.className = "adhd-page-chrome-main adhd-editor-chrome-main";
    titleBlock.replaceWith(chromeMain);
    titleBlock.classList.add("adhd-page-chrome-title", "adhd-editor-chrome-title");
    chromeMain.appendChild(titleBlock);
  }

  let focusLine = document.getElementById("adhd-toolbar-focus");
  const isNew = !focusLine;
  if (!focusLine) {
    focusLine = document.createElement("div");
    focusLine.id = "adhd-toolbar-focus";
    focusLine.className = "adhd-toolbar-focus";
    focusLine.setAttribute("role", "status");
    focusLine.setAttribute("aria-label", "目前建議的下一步");
    chromeMain.appendChild(focusLine);
  }

  const prev = focusLine.dataset.detail ?? "";
  focusLine.dataset.detail = step.detail;
  focusLine.innerHTML = `
    <span class="adhd-toolbar-focus-kicker">${escape(step.label)}</span>
    <span class="adhd-toolbar-focus-detail">${escape(step.detail)}</span>
  `;

  let actions = toolbar.querySelector(
    ".adhd-page-chrome-actions, .adhd-editor-chrome-actions",
  ) as HTMLElement | null;
  if (!actions) {
    actions = document.createElement("div");
    actions.className = "adhd-page-chrome-actions adhd-editor-chrome-actions";
    Array.from(toolbar.children).forEach((child) => {
      const el = child as HTMLElement;
      if (el === chromeMain) return;
      if (el.classList.contains("spacer")) {
        el.remove();
        return;
      }
      actions!.appendChild(el);
    });
    toolbar.appendChild(actions);
  }

  // CTA：若工具列已有相同 href 的連結，不重複放「回編輯／進入編輯」
  let cta = document.getElementById("adhd-toolbar-cta") as HTMLAnchorElement | null;
  const href = step.href || "";
  const hasSameLink =
    !!href &&
    !!actions.querySelector(
      `a[href="${href}"], a[href$="${href.split("/").pop() || href}"]`,
    );

  if (step.cta && step.href && !hasSameLink) {
    if (!cta) {
      cta = document.createElement("a");
      cta.id = "adhd-toolbar-cta";
      cta.className = "btn btn-primary adhd-toolbar-cta";
      actions.appendChild(cta);
    }
    cta.href = step.href;
    cta.textContent = step.cta;
    cta.hidden = false;
    // 主路徑 CTA 置前（在更多之前）
    const more = actions.querySelector(".adhd-more");
    if (more && cta.nextElementSibling !== more) {
      actions.insertBefore(cta, more);
    }
  } else if (cta) {
    cta.hidden = true;
  } else if (step.cta && step.action && !step.href) {
    // 僅 action（如匯入）
    let btn = document.getElementById("adhd-toolbar-cta-action") as HTMLButtonElement | null;
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.id = "adhd-toolbar-cta-action";
      btn.className = "btn btn-primary adhd-toolbar-cta";
      actions.appendChild(btn);
    }
    btn.textContent = step.cta;
    btn.hidden = false;
    btn.onclick = () => step.action?.();
  } else {
    const btn = document.getElementById("adhd-toolbar-cta-action");
    if (btn) (btn as HTMLButtonElement).hidden = true;
  }

  import("./attention-motion")
    .then((m) => {
      m.syncMotionPreferenceClass();
      if (isNew) m.enter(focusLine);
      else if (prev && prev !== step.detail) m.flashFocus(focusLine);
    })
    .catch(() => {});
}

/** 無標準 toolbar 時的後備焦點條 */
function ensureStandaloneFocusStrip(step: NextStep) {
  const main = document.querySelector(".main");
  if (!main) return;

  let strip = document.getElementById("adhd-focus-strip");
  const isNew = !strip;
  if (!strip) {
    strip = document.createElement("div");
    strip.id = "adhd-focus-strip";
    strip.className = "adhd-focus-strip";
    strip.setAttribute("role", "region");
    strip.setAttribute("aria-label", "目前建議的下一步");
    const toolbar = main.querySelector(".toolbar");
    if (toolbar) toolbar.insertAdjacentElement("afterend", strip);
    else main.prepend(strip);
  }

  const prevLabel = strip.querySelector(".adhd-focus-label")?.textContent ?? "";
  const labelChanged = prevLabel !== step.label;

  strip.innerHTML = `
    <div class="adhd-focus-text">
      <strong class="adhd-focus-label">${escape(step.label)}</strong>
      <span class="adhd-focus-detail">${escape(step.detail)}</span>
    </div>
    ${
      step.cta
        ? step.href
          ? `<a class="btn btn-primary adhd-focus-cta" href="${step.href}">${escape(step.cta)}</a>`
          : `<button type="button" class="btn btn-primary adhd-focus-cta" id="adhd-focus-action">${escape(step.cta)}</button>`
        : ""
    }
  `;

  if (step.action) {
    document.getElementById("adhd-focus-action")?.addEventListener("click", () => step.action?.());
  }

  import("./attention-motion")
    .then((m) => {
      m.syncMotionPreferenceClass();
      if (isNew) m.enter(strip);
      else if (labelChanged) m.flashFocus(strip);
    })
    .catch(() => {});
}

function ensureFocusStrip(step: NextStep) {
  integratePageChrome(step);
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 工具列：只留主要 CTA，其餘收進「更多」 */
function collapseToolbar() {
  const toolbar = document.querySelector(".toolbar") as HTMLElement | null;
  if (!toolbar || toolbar.dataset.adhdCollapsed === "1") return;
  toolbar.dataset.adhdCollapsed = "1";
  toolbar.classList.add("adhd-toolbar");

  // 主路徑按鈕：保留 primary / import / beginner / new
  const keepIds = new Set([
    "btn-new",
    "btn-import",
    "btn-beginner",
    "btn-submit",
    "btn-prev",
    "btn-next",
    "btn-outline",
    "modal-close",
  ]);
  const keepClasses = ["btn-primary", "btn-accent"];

  const moreHost = document.createElement("div");
  moreHost.className = "adhd-more";
  moreHost.innerHTML = `
    <button type="button" class="btn adhd-more-toggle" aria-expanded="false" aria-haspopup="true">更多 ▾</button>
    <div class="adhd-more-panel" hidden role="menu"></div>
  `;
  const panel = moreHost.querySelector(".adhd-more-panel") as HTMLElement;
  const toggle = moreHost.querySelector(".adhd-more-toggle") as HTMLButtonElement;

  // 頁面 chrome 整合後按鈕在 actions 內
  const host =
    (toolbar.querySelector(
      ".adhd-page-chrome-actions, .adhd-editor-chrome-actions",
    ) as HTMLElement | null) ?? toolbar;

  const moveables: HTMLElement[] = [];
  Array.from(host.children).forEach((child) => {
    const el = child as HTMLElement;
    if (el.classList.contains("spacer")) return;
    if (el.classList.contains("adhd-editor-chrome-main")) return;
    if (el.classList.contains("adhd-page-chrome-main")) return;
    if (el.tagName === "DIV" && el.querySelector("h1")) return; // title block
    if (el.classList.contains("search")) return; // keep search visible but compact
    if (el.id === "folder-import-input") return;
    if (el.classList.contains("adhd-more")) return;
    if (el.id === "adhd-toolbar-cta") return;

    const id = el.id;
    if (id && keepIds.has(id) && id !== "btn-outline") return;
    if (el.classList.contains("btn-primary") || el.classList.contains("btn-accent")) return;
    if (el.matches("a.btn-primary, a.btn-accent")) return;
    // 預覽審閱與儀表板保留在主列（主路徑）
    if (el.matches('a[href="review.html"], a[data-od-id="btn-preview"]')) return;
    if (el.matches('a[href="dashboard.html"], a[data-od-id="btn-dashboard"]')) return;
    if (el.matches('a[href="editor.html"]#btn-edit, a[data-od-id="btn-edit"]')) return;

    // export-menu、次要 btn、登出、大綱 → more
    const isExport = el.classList.contains("export-menu");
    const isLogout = el.matches("[data-logout], .btn-logout");
    const isSecondaryBtn =
      el.matches("button.btn, a.btn") &&
      !keepClasses.some((c) => el.classList.contains(c)) &&
      !(el.id && keepIds.has(el.id) && el.id !== "btn-outline");
    const isToggleSamples = el.id === "btn-toggle-samples";
    const isUntrackAll = el.id === "btn-untrack-all";
    const isOutline = el.id === "btn-outline";

    if (isExport || isLogout || isSecondaryBtn || isToggleSamples || isUntrackAll || isOutline) {
      moveables.push(el);
    }
  });

  // 引導列開關放「更多」裡 —— 偶爾才調一次的偏好，不該佔工具列。
  // 必須在 early return 之前掛：沒有次要按鈕可搬的頁面（例如總覽）
  // 也要有「更多」，否則開關整個消失。
  const stripToggle = document.createElement("button");
  stripToggle.type = "button";
  stripToggle.id = "btn-toggle-focus-strip";
  stripToggle.className = "btn adhd-more-item";
  stripToggle.textContent = focusHidden() ? "顯示引導列" : "隱藏引導列";
  stripToggle.addEventListener("click", () => setFocusStripHidden(!focusHidden()));
  panel.appendChild(stripToggle);

  moveables.forEach((el) => {
    el.classList.add("adhd-more-item");
    panel.appendChild(el);
  });

  host.appendChild(moreHost);

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.textContent = open ? "更多 ▴" : "更多 ▾";
  });
  document.addEventListener("click", (e) => {
    if (!moreHost.contains(e.target as Node)) {
      panel.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      toggle.textContent = "更多 ▾";
    }
  });
}

/** 統計／計劃列預設收合，需要再展開 */
function collapseNoiseBlocks() {
  const stats = document.querySelector(".stats") as HTMLElement | null;
  const planBar = document.getElementById("plan-workspace-bar");
  const filters = document.querySelector(".filters") as HTMLElement | null;

  const wrap = (el: HTMLElement | null, label: string) => {
    if (!el || el.dataset.adhdWrapped === "1") return;
    el.dataset.adhdWrapped = "1";
    const details = document.createElement("details");
    details.className = "adhd-details";
    details.open = false;
    const sum = document.createElement("summary");
    sum.textContent = label;
    el.parentElement?.insertBefore(details, el);
    details.appendChild(sum);
    details.appendChild(el);
  };

  wrap(stats, "數字摘要（可略過）");
  if (planBar) wrap(planBar, "計劃進度（可略過）");
  // filters 保留但加 class 讓樣式更安靜
  filters?.classList.add("adhd-filters");
  // 流程條降級為次要資訊
  document.querySelector(".flow-strip")?.classList.add("adhd-flow-quiet");
  document.querySelector("#flow-strip-host")?.classList.add("adhd-flow-quiet");
}

// 「其他功能」收合區退休了。
// 它當初存在的理由是「側欄項目太多」——但主流程入口早就搬去專案卡片與
// 「工作區」那一組，剩在裡面的只有管理中心與 Agent 管理兩個系統設定項。
// 兩個項目卻要一整塊邊框、一個標題、一次展開動作，包裝比內容重。
// 兩者已改由設定彈窗的「工作區管理」分類進入（settings.html）。

/** 空狀態大引導（專案頁） */
function enhanceEmptyState() {
  const tbody = document.getElementById("tbody");
  if (!tbody) return;
  const st = store.get();
  const n = st.projects.filter((p) => (st.showSamples ? true : !p.isSample)).length;
  if (n > 0) {
    document.getElementById("adhd-empty-hero")?.remove();
    return;
  }
  if (document.getElementById("adhd-empty-hero")) return;
  const content = document.querySelector(".content");
  if (!content) return;
  const hero = document.createElement("div");
  hero.id = "adhd-empty-hero";
  hero.className = "adhd-empty-hero";
  hero.innerHTML = `
    <p class="adhd-empty-kicker">開始</p>
    <h2>還沒有任何專案</h2>
    <p>選一個入口即可，完成後會引導你去編輯。</p>
    <div class="adhd-empty-actions">
      <button type="button" class="btn btn-primary btn-lg" id="adhd-empty-import">匯入資料夾</button>
      <button type="button" class="btn btn-lg" id="adhd-empty-new">新建 PRD</button>
      <button type="button" class="btn btn-ghost btn-lg" id="adhd-empty-beginner">新手引導</button>
    </div>
  `;
  content.prepend(hero);
  document.getElementById("adhd-empty-import")?.addEventListener("click", () => {
    document.getElementById("btn-import")?.click();
  });
  document.getElementById("adhd-empty-new")?.addEventListener("click", () => {
    document.getElementById("btn-new")?.click();
  });
  document.getElementById("adhd-empty-beginner")?.addEventListener("click", () => {
    document.getElementById("btn-beginner")?.click();
  });
}

export function initAdhdUi() {
  document.documentElement.classList.add("adhd-calm");
  if (focusHidden()) document.documentElement.classList.add("hide-focus-strip");
  document.body?.classList.add("adhd-calm");

  import("./attention-motion")
    .then((m) => m.syncMotionPreferenceClass())
    .catch(() => {});

  const page = detectRailPage();
  // 先收斂工具列，再合併焦點（編輯台 chrome 依賴 actions 容器）
  collapseToolbar();
  ensureFocusStrip(nextStepForPage(page));
  collapseNoiseBlocks();
  enhanceEmptyState();

  // store 變更時刷新下一步與空狀態
  store.subscribe(() => {
    ensureFocusStrip(nextStepForPage(detectRailPage()));
    enhanceEmptyState();
  });
}
