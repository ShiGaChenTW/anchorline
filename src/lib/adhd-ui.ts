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
          label: "先建立第一份規格",
          detail: "匯入既有資料夾，或新建空白 PRD。一次只選一個即可。",
          cta: "匯入專案",
          action: () => document.getElementById("btn-import")?.click(),
        };
      }
      return {
        label: "接著寫規格",
        detail: name
          ? `目前：${name}。打開編輯台繼續填寫章節。`
          : `你有 ${projects.length} 個專案，選一個開始寫。`,
        cta: "進入編輯",
        href: "editor.html",
      };
    case "editor":
      return {
        label: active ? `正在寫：${name}` : "先選一個專案",
        detail: active
          ? "左側章節由上往下填。空的先補齊，再送審。"
          : "回到專案列表，點一個專案卡片。",
        cta: active ? "去審閱" : "專案列表",
        href: active ? "review.html" : "projects.html",
      };
    case "review":
      return {
        label: "檢查後再決定",
        detail: "沒問題就核准；要改字就回編輯。",
        cta: "回編輯",
        href: "editor.html",
      };
    case "templates":
      return {
        label: "挑選範本",
        detail: "插入後回編輯台修改即可。",
        cta: "回編輯",
        href: "editor.html",
      };
    case "tracking":
      return {
        label: "這裡只看進度",
        detail: "要改規格內容，請回編輯台。",
        cta: "回編輯",
        href: "editor.html",
      };
    case "admin":
      return {
        label: "人員與流程設定",
        detail: "日常寫作不用常待在這裡。",
        cta: "回專案",
        href: "projects.html",
      };
    case "agents":
      return {
        label: "Agent 設定",
        detail: "調完就回編輯台寫內容。",
        cta: "回編輯",
        href: "editor.html",
      };
    case "settings":
      return {
        label: "個人偏好",
        detail: "行號、主題、備份都在這裡。",
        cta: "回專案",
        href: "projects.html",
      };
    default:
      return {
        label: "從專案開始",
        detail: "左側點「專案列表」。",
        cta: "專案列表",
        href: "projects.html",
      };
  }
}

function ensureFocusStrip(step: NextStep) {
  const main = document.querySelector(".main");
  if (!main) return;

  let strip = document.getElementById("adhd-focus-strip");
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

  const moveables: HTMLElement[] = [];
  Array.from(toolbar.children).forEach((child) => {
    const el = child as HTMLElement;
    if (el.classList.contains("spacer")) return;
    if (el.tagName === "DIV" && el.querySelector("h1")) return; // title block
    if (el.classList.contains("search")) return; // keep search visible but compact
    if (el.id === "folder-import-input") return;
    if (el.classList.contains("adhd-more")) return;

    const id = el.id;
    if (id && keepIds.has(id)) return;
    if (el.classList.contains("btn-primary") || el.classList.contains("btn-accent")) return;
    if (el.matches("a.btn-primary, a.btn-accent")) return;
    // 預覽審閱保留在主列（主路徑）
    if (el.matches('a[href="review.html"], a[data-od-id="btn-preview"]')) return;
    if (el.matches('a[href="editor.html"]#btn-edit, a[data-od-id="btn-edit"]')) return;

    // export-menu、次要 btn、登出 → more
    const isExport = el.classList.contains("export-menu");
    const isLogout = el.matches("[data-logout], .btn-logout");
    const isSecondaryBtn =
      el.matches("button.btn, a.btn") &&
      !keepClasses.some((c) => el.classList.contains(c)) &&
      !(el.id && keepIds.has(el.id));
    const isToggleSamples = el.id === "btn-toggle-samples";
    const isUntrackAll = el.id === "btn-untrack-all";

    if (isExport || isLogout || isSecondaryBtn || isToggleSamples || isUntrackAll) {
      moveables.push(el);
    }
  });

  if (!moveables.length) return;

  moveables.forEach((el) => {
    el.classList.add("adhd-more-item");
    panel.appendChild(el);
  });
  toolbar.appendChild(moreHost);

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

/** 側欄：主流程 3 項 + 其餘收合 */
export function applyAdhdRail(nav: Element) {
  if (nav.getAttribute("data-adhd-rail") === "1") return;
  nav.setAttribute("data-adhd-rail", "1");

  const primary = new Set(["nav-projects", "nav-editor", "nav-review"]);
  const secondary: HTMLElement[] = [];

  nav.querySelectorAll<HTMLElement>("a.nav-item, button.nav-item").forEach((el) => {
    const od = el.getAttribute("data-od-id") || "";
    if (primary.has(od)) {
      el.classList.add("adhd-nav-primary");
      return;
    }
    // 專案卡片區不進 secondary
    if (el.closest("#rail-projects-block")) return;
    secondary.push(el);
  });

  // 快捷 label + TUI 也進 secondary 群組
  const labels = Array.from(nav.querySelectorAll(".nav-label")).filter(
    (l) => !/工作區|專案/.test(l.textContent || ""),
  );

  if (!secondary.length) return;

  const details = document.createElement("details");
  details.className = "adhd-nav-more";
  details.innerHTML = `<summary>其他功能</summary><div class="adhd-nav-more-body"></div>`;
  const body = details.querySelector(".adhd-nav-more-body")!;

  // 插在最後一個 primary 後面
  const lastPrimary =
    nav.querySelector('[data-od-id="nav-review"]') ||
    nav.querySelector('[data-od-id="nav-editor"]') ||
    nav.querySelector('[data-od-id="nav-projects"]');

  secondary.forEach((el) => body.appendChild(el));
  labels.forEach((l) => {
    if (l.parentElement === nav) body.appendChild(l);
  });

  if (lastPrimary?.nextSibling) {
    lastPrimary.parentElement?.insertBefore(details, lastPrimary.nextSibling);
  } else {
    nav.appendChild(details);
  }
}

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
  document.body?.classList.add("adhd-calm");

  const page = detectRailPage();
  ensureFocusStrip(nextStepForPage(page));
  collapseToolbar();
  collapseNoiseBlocks();
  enhanceEmptyState();

  // 側欄 ADHD 簡化（在 rail-nav 重建後呼叫）
  const nav = document.querySelector(".rail-nav");
  if (nav) applyAdhdRail(nav);

  // store 變更時刷新下一步與空狀態
  store.subscribe(() => {
    ensureFocusStrip(nextStepForPage(detectRailPage()));
    enhanceEmptyState();
  });
}

/** rail 重建後再套一次（auth 呼叫） */
export function reapplyAdhdRail() {
  const nav = document.querySelector(".rail-nav");
  if (!nav) return;
  nav.removeAttribute("data-adhd-rail");
  applyAdhdRail(nav);
}
