/**
 * 側邊導覽：全站同一套 icon + 文案，每次進入頁面重建，避免缺 icon / 重複節點重疊。
 */
import { store } from "../data/store";
import { ensureRailContextDefaults, renderRailProjects } from "./rail-projects";

export type RailPage =
  | "projects"
  | "editor"
  | "write"
  | "signoff"
  | "dashboard"
  | "releases"
  | "overview"
  | "templates"
  | "openspec"
  | "review"
  | "tracking"
  | "admin"
  | "agents"
  | "settings";

type RailItem = {
  page: RailPage;
  href: string;
  label: string;
  odId: string;
  /** 內嵌 SVG path（16×16） */
  icon: string;
  count?: boolean;
  /**
   * 不出現在側欄，但仍是已知頁面 —— detectRailPage / 狀態列要認得它。
   * 儀表板的入口是「點專案卡片」，不是側欄多一顆按鈕。
   */
  hidden?: boolean;
};

export const IC = {
  projects:
    '<path d="M1.75 2.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25H1.75zM0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75z"/><path d="M7.25 8a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 0 1.5h-5.5A.75.75 0 0 1 7.25 8zm0 3a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1-.75-.75zM4 7.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zm0 3a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0z"/>',
  editor:
    '<path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61zm1.414 1.06a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354l-1.086-1.086zM11.189 6.25 9.75 4.81l-6.286 6.287a.25.25 0 0 0-.064.108l-.558 1.953 1.953-.558a.25.25 0 0 0 .108-.064l6.286-6.286z"/>',
  write:
    '<path d="M7.53 1.282a.5.5 0 0 1 .94 0l.478 1.306a7.492 7.492 0 0 0 4.464 4.464l1.305.478a.5.5 0 0 1 0 .94l-1.305.478a7.492 7.492 0 0 0-4.464 4.464l-.478 1.305a.5.5 0 0 1-.94 0l-.478-1.305a7.492 7.492 0 0 0-4.464-4.464L1.283 8.47a.5.5 0 0 1 0-.94l1.305-.478a7.492 7.492 0 0 0 4.464-4.464Z"/>',
  signoff:
    '<path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-6.25 6.25a.75.75 0 0 1-1.06 0L2.22 7.28a.75.75 0 0 1 1.06-1.06L7 9.94l5.72-5.72a.75.75 0 0 1 1.06 0z"/>',
  templates:
    '<path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v3.5A1.75 1.75 0 0 1 14.25 7H1.75A1.75 1.75 0 0 1 0 5.25v-3.5zM1.75 1a.25.25 0 0 0-.25.25v3.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-3.5a.25.25 0 0 0-.25-.25H1.75zM0 10.75C0 9.784.784 9 1.75 9h12.5c.966 0 1.75.784 1.75 1.75v3.5A1.75 1.75 0 0 1 14.25 16H1.75A1.75 1.75 0 0 1 0 14.25v-3.5zm1.75-.75a.25.25 0 0 0-.25.25v3.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-3.5a.25.25 0 0 0-.25-.25H1.75z"/>',
  review:
    '<path d="M1.5 8a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0zM8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm.75 4.75a.75.75 0 0 0-1.5 0v3.5a.75.75 0 0 0 .471.696l2.5 1a.75.75 0 0 0 .557-1.392l-2.028-.811V4.75z"/>',
  tracking:
    '<path d="M1.5 1.75a.75.75 0 0 0 0 1.5h13a.75.75 0 0 0 0-1.5h-13zM1.5 5.75a.75.75 0 0 0 0 1.5h8a.75.75 0 0 0 0-1.5h-8zM1.5 9.75a.75.75 0 0 0 0 1.5h13a.75.75 0 0 0 0-1.5h-13zM1.5 13.75a.75.75 0 0 0 0 1.5h8a.75.75 0 0 0 0-1.5h-8z"/>',
  admin:
    '<path d="M2 2.75A.75.75 0 0 1 2.75 2h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 2.75zm0 5A.75.75 0 0 1 2.75 7h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 7.75zm0 5a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75z"/>',
  agents:
    '<path d="M8 0a5 5 0 0 0-3.5 8.57V14a.75.75 0 0 0 1.2.6L8 12.5l2.3 2.1A.75.75 0 0 0 11.5 14V8.57A5 5 0 0 0 8 0zm0 1.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z"/>',
  settings:
    '<path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm0 14.5a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13zM6.5 8a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0z"/>',
  dashboard:
    '<path d="M1.75 1h5A.75.75 0 0 1 7.5 1.75v4.5A.75.75 0 0 1 6.75 7h-5A.75.75 0 0 1 1 6.25v-4.5A.75.75 0 0 1 1.75 1zm7.5 0h5a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-.75.75h-5a.75.75 0 0 1-.75-.75v-2.5A.75.75 0 0 1 9.25 1zM1.75 9h5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-.75.75h-5A.75.75 0 0 1 1 14.25v-4.5A.75.75 0 0 1 1.75 9zm7.5-2.5h5a.75.75 0 0 1 .75.75v7a.75.75 0 0 1-.75.75h-5a.75.75 0 0 1-.75-.75v-7a.75.75 0 0 1 .75-.75z"/>',
  tui: '<path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM7.25 8a.75.75 0 0 1-.22-.53V4.28a.75.75 0 0 1 1.5 0v3.19c0 .199-.079.39-.22.53l-1.75 1.75a.75.75 0 0 1-1.06-1.06L7.25 8z"/>',
};

/** 工作區側欄固定項目 */
export const RAIL_ITEMS: RailItem[] = [
  // 專案列表不進側欄 —— 側欄上方已經是專案清單本身，再放一個入口是重複
  { page: "projects", href: "projects.html", label: "專案列表", odId: "nav-projects", icon: IC.projects, count: true, hidden: true },
  // 編輯工作台／Task Tracking 都是「對某個專案」做的事，改成掛在
  // 選中的專案卡片底下（rail-projects.ts 的 projActionsHtml）。
  // 留在固定導覽區會讓人得自己把「我選的是哪個專案」跟按鈕接起來。
  { page: "editor", href: "editor.html", label: "編輯工作台", odId: "nav-editor", icon: IC.editor, hidden: true },
  { page: "write", href: "write.html", label: "PRD 審閱監控", odId: "nav-write", icon: IC.write, hidden: true },
  { page: "signoff", href: "signoff.html", label: "簽核管理", odId: "nav-signoff", icon: IC.signoff, hidden: true },
  { page: "tracking", href: "tracking.html", label: "Task Tracking", odId: "nav-tracking", icon: IC.tracking, hidden: true },
  { page: "dashboard", href: "dashboard.html", label: "專案儀表板", odId: "nav-dashboard", icon: IC.dashboard, hidden: true },
  // 漏了這一筆的症狀完全符合 config.yaml 那句警告：`detectRailPage()` 回 null，
  // `auth.ts` 的 `if (page && …) initRailNav(page)` 因此整段跳過，
  // 側欄不重建 —— 頁面於是停在 HTML 裡那份過期的靜態導覽，而且不報錯。
  { page: "releases", href: "releases.html", label: "版本取號", odId: "nav-releases", icon: IC.signoff, hidden: true },
  { page: "overview", href: "overview.html", label: "總覽", odId: "nav-overview", icon: IC.dashboard, hidden: true },
  // 章節範本移到「工作區」那一組（rail-projects.ts 的 ensureWorkspaceNav）——
  // 它跟總覽／清單／審閱佇列一樣是跨專案的東西
  { page: "templates", href: "templates.html", label: "PRD 範本", odId: "nav-templates", icon: IC.templates, count: true, hidden: true },
  { page: "openspec", href: "openspec.html", label: "OpenSpec 入口", odId: "nav-openspec", icon: IC.tracking, hidden: true },
  // 審閱佇列改掛在「工作區」區塊標題右側（rail-projects.ts）
  { page: "review", href: "review.html", label: "審閱佇列", odId: "nav-review", icon: IC.review, count: true, hidden: true },
  // 管理中心與 Agent 管理是系統設定，不是日常導覽 —— 入口改在設定彈窗的
  // 「工作區管理」分類（settings.html）。頁面本身照舊存在，detectRailPage 仍要認得。
  { page: "admin", href: "admin.html", label: "管理中心", odId: "nav-admin", icon: IC.admin, hidden: true },
  { page: "agents", href: "agents.html", label: "Agent 管理", odId: "nav-agents", icon: IC.agents, hidden: true },
  // 偏好設定不進側欄清單 —— 入口改成品牌列右側的齒輪圖示
  { page: "settings", href: "settings.html", label: "偏好設定", odId: "nav-settings", icon: IC.settings, hidden: true },
];

function svg(paths: string): string {
  return `<svg class="ic" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${paths}</svg>`;
}

function itemHtml(item: RailItem, active: RailPage): string {
  const on = item.page === active;
  const count = item.count
    ? `<span class="count" data-nav-count="${item.page}">0</span>`
    : "";
  return `<a class="nav-item${on ? " active" : ""}" href="${item.href}" data-od-id="${item.odId}"${
    on ? ' aria-current="page"' : ""
  }>${svg(item.icon)}${item.label}${count}</a>`;
}

/**
 * 重建整個 rail-nav（含 icon），再掛回專案清單。
 * 不再「補純文字連結」——那會造成雙重節點重疊。
 */
/**
 * 偏好設定的入口：品牌列右側的齒輪，跟收合鍵並排。
 * 設定是「偶爾才碰一次」的東西，放在每天要掃視的清單裡只是佔位置。
 * 用 JS 插入而不是改 12 個 HTML 檔 —— 品牌列是靜態 markup，每頁一份。
 */
function ensureBrandSettings(active: RailPage) {
  const brand = document.querySelector(".rail-brand");
  if (!brand || document.getElementById("rail-settings-btn")) return;
  const a = document.createElement("a");
  a.id = "rail-settings-btn";
  a.className = "rail-brand-gear" + (active === "settings" ? " on" : "");
  a.href = "settings.html";
  a.title = "偏好設定";
  a.setAttribute("aria-label", "偏好設定");
  a.innerHTML = svg(IC.settings);
  // 插在收合鍵之前，兩顆並排
  const collapse = brand.parentElement?.querySelector(".panel-collapse-btn, [data-rail-collapse]");
  if (collapse) collapse.insertAdjacentElement("beforebegin", a);
  else brand.appendChild(a);
}

export function initRailNav(active: RailPage) {
  const nav = document.querySelector(".rail-nav");
  if (!nav) return;

  // 已重建過且 active 相同 → 只刷新 active class
  if (nav.getAttribute("data-rail-built") === "1" && nav.getAttribute("data-rail-active") === active) {
    syncActive(nav, active);
    return;
  }

  nav.innerHTML = `
    <div class="nav-label">工作區</div>
    <div id="rail-projects-block" class="rail-projects-block"></div>
    ${RAIL_ITEMS.filter((it) => !it.hidden).map((it) => itemHtml(it, active)).join("\n")}
  `;
  nav.setAttribute("data-rail-built", "1");
  nav.setAttribute("data-rail-active", active);

  ensureBrandSettings(active);

  // 齒輪改開彈窗，不整頁跳走
  import("./settings-modal")
    .then((m) => m.initSettingsModal())
    .catch(() => {
      /* ignore */
    });

  // 「目前」那張卡固定存在 —— 有些頁面不會呼叫 syncRailContext，
  // 沒有這一步它們的側欄就會少一塊
  const label = RAIL_ITEMS.find((it) => it.page === active)?.label ?? "工作區";
  ensureRailContextDefaults(label);

  // 專案清單掛回
  renderRailProjects(nav as HTMLElement);
  refreshNavCounts();
}

function syncActive(nav: Element, active: RailPage) {
  nav.setAttribute("data-rail-active", active);
  for (const item of RAIL_ITEMS) {
    const a = nav.querySelector<HTMLAnchorElement>(`[data-od-id="${item.odId}"]`);
    if (!a) continue;
    const on = item.page === active;
    a.classList.toggle("active", on);
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

/** 更新側欄 count（專案數／範本數／待審） */
export function refreshNavCounts() {
  const st = store.get();
  const projects = st.projects.filter((p) => (st.showSamples ? true : !p.isSample));
  const pending = projects.filter((p) => p.status === "review").length;
  // querySelectorAll：同一個 page 的計數現在可能同時出現在主導覽與
  // 「工作區」那一組，只更新第一個會讓另一個永遠停在 0
  const set = (page: string, n: number) => {
    document.querySelectorAll(`[data-nav-count="${page}"]`).forEach((el) => {
      el.textContent = String(n);
      el.classList.toggle("is-zero", n === 0);
    });
  };
  set("projects", projects.length);
  set("templates", st.templates.length);
  set("review", pending);
  // 「工作區」那一組用的是同一個 data-nav-count 機制，set() 已經涵蓋 ——
  // 之前另外掛一個 id 的做法退休了，兩套計數只會有一套先過期
}

/** 從 pathname 推斷目前頁 */
export function detectRailPage(): RailPage | null {
  const path = (location.pathname + " " + location.href).replace(/\\/g, "/");
  // 較長的檔名優先，避免誤判
  const ordered = [...RAIL_ITEMS].sort((a, b) => b.href.length - a.href.length);
  for (const item of ordered) {
    if (path.includes("/" + item.href) || path.endsWith(item.href) || path.includes(item.href)) {
      return item.page;
    }
  }
  return null;
}
