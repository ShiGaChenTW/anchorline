/**
 * 側邊導覽：全站同一套 icon + 文案，每次進入頁面重建，避免缺 icon / 重複節點重疊。
 */
import { store } from "../data/store";
import { renderRailProjects } from "./rail-projects";
import { toast } from "./ui";

export type RailPage =
  | "projects"
  | "editor"
  | "templates"
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
};

const IC = {
  projects:
    '<path d="M1.75 2.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25H1.75zM0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75z"/><path d="M7.25 8a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 0 1.5h-5.5A.75.75 0 0 1 7.25 8zm0 3a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1-.75-.75zM4 7.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zm0 3a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0z"/>',
  editor:
    '<path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61zm1.414 1.06a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354l-1.086-1.086zM11.189 6.25 9.75 4.81l-6.286 6.287a.25.25 0 0 0-.064.108l-.558 1.953 1.953-.558a.25.25 0 0 0 .108-.064l6.286-6.286z"/>',
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
  tui: '<path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM7.25 8a.75.75 0 0 1-.22-.53V4.28a.75.75 0 0 1 1.5 0v3.19c0 .199-.079.39-.22.53l-1.75 1.75a.75.75 0 0 1-1.06-1.06L7.25 8z"/>',
};

/** 工作區側欄固定項目 */
export const RAIL_ITEMS: RailItem[] = [
  { page: "projects", href: "projects.html", label: "專案列表", odId: "nav-projects", icon: IC.projects, count: true },
  { page: "editor", href: "editor.html", label: "編輯工作台", odId: "nav-editor", icon: IC.editor },
  { page: "templates", href: "templates.html", label: "章節範本", odId: "nav-templates", icon: IC.templates, count: true },
  { page: "review", href: "review.html", label: "審閱佇列", odId: "nav-review", icon: IC.review, count: true },
  { page: "tracking", href: "tracking.html", label: "計劃追蹤", odId: "nav-tracking", icon: IC.tracking },
  { page: "admin", href: "admin.html", label: "管理中心", odId: "nav-admin", icon: IC.admin },
  { page: "agents", href: "agents.html", label: "Agent 管理", odId: "nav-agents", icon: IC.agents },
  { page: "settings", href: "settings.html", label: "偏好設定", odId: "nav-settings", icon: IC.settings },
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
    ${RAIL_ITEMS.map((it) => itemHtml(it, active)).join("\n")}
    <div class="nav-label">快捷</div>
    <button type="button" class="nav-item" id="btn-tui-hint" data-od-id="nav-tui">
      ${svg(IC.tui)}開啟 TUI 追蹤
    </button>
  `;
  nav.setAttribute("data-rail-built", "1");
  nav.setAttribute("data-rail-active", active);

  const tui = document.getElementById("btn-tui-hint");
  tui?.addEventListener("click", () => {
    toast("終端 TUI：專案目錄執行 bun run track · Web：計劃追蹤頁");
    window.setTimeout(() => {
      location.href = "tracking.html";
    }, 400);
  });

  // 專案清單掛回
  renderRailProjects(nav as HTMLElement);
  refreshNavCounts();

  // ADHD：主流程 3 項 + 其他收合（動態 import 避免循環）
  import("./adhd-ui")
    .then((m) => m.reapplyAdhdRail())
    .catch(() => {
      /* ignore */
    });
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
  // 目前頁在「其他功能」內時展開並標示
  import("./adhd-ui")
    .then((m) => m.expandOtherNavIfNeeded(nav))
    .catch(() => {
      /* ignore */
    });
}

/** 更新側欄 count（專案數／範本數／待審） */
export function refreshNavCounts() {
  const st = store.get();
  const projects = st.projects.filter((p) => (st.showSamples ? true : !p.isSample));
  const pending = projects.filter((p) => p.status === "review").length;
  const set = (page: string, n: number) => {
    const el = document.querySelector(`[data-nav-count="${page}"]`);
    if (el) el.textContent = String(n);
  };
  set("projects", projects.length);
  set("templates", st.templates.length);
  set("review", pending);
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
