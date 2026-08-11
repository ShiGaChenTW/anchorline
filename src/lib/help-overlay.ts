/**
 * 全頁 `?` 快捷鍵說明（S.CodingFlow TUI help overlay 概念）
 */
import { escapeHtml } from "./ui";

export type HelpBinding = { keys: string; desc: string };

export type HelpSection = { title: string; items: HelpBinding[] };

const DEFAULT_SECTIONS: HelpSection[] = [
  {
    title: "導覽",
    items: [
      { keys: "1", desc: "專案列表" },
      { keys: "2", desc: "編輯工作台" },
      { keys: "3", desc: "範本庫" },
      { keys: "4", desc: "審閱佇列" },
      { keys: "5", desc: "計劃追蹤" },
      { keys: "6", desc: "PRD 審閱監控" },
      { keys: "7", desc: "簽核管理" },
      { keys: "?", desc: "顯示／關閉本說明" },
      { keys: "Esc", desc: "關閉浮層／Modal" },
    ],
  },
  {
    title: "編輯",
    items: [
      { keys: "⌘↵ / Ctrl+Enter", desc: "下一節" },
      { keys: "⌘S / Ctrl+S", desc: "儲存提示" },
    ],
  },
  {
    title: "審閱",
    items: [
      { keys: "R", desc: "聚焦回覆框" },
    ],
  },
  {
    title: "計劃追蹤",
    items: [
      { keys: "j / ↓", desc: "下一個 plan" },
      { keys: "k / ↑", desc: "上一個 plan" },
      { keys: "r", desc: "重新整理" },
    ],
  },
  {
    title: "SCVB 結構 gate",
    items: [
      { keys: "Non-Goals", desc: "至少 3 條才可送審" },
      { keys: "摘要", desc: "做什麼／給誰／為何現在必填" },
      { keys: "指標", desc: "建議含可量測數字" },
    ],
  },
];

let bound = false;

export function ensureHelpOverlay(extra?: HelpSection[]) {
  let root = document.getElementById("help-overlay");
  if (!root) {
    root = document.createElement("div");
    root.id = "help-overlay";
    root.className = "help-overlay";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "快捷鍵說明");
    document.body.appendChild(root);
  }

  const sections = extra ? [...DEFAULT_SECTIONS, ...extra] : DEFAULT_SECTIONS;
  root.innerHTML = `
    <div class="help-overlay-card">
      <header>
        <strong>快捷鍵與 SCVB 說明</strong>
        <button type="button" class="btn btn-ghost btn-sm" data-help-close>關閉</button>
      </header>
      <div class="help-overlay-body">
        ${sections
          .map(
            (sec) => `
          <section>
            <h4>${escapeHtml(sec.title)}</h4>
            <ul>
              ${sec.items
                .map(
                  (it) =>
                    `<li><kbd>${escapeHtml(it.keys)}</kbd><span>${escapeHtml(it.desc)}</span></li>`,
                )
                .join("")}
            </ul>
          </section>`,
          )
          .join("")}
      </div>
      <footer>
        <button type="button" class="btn btn-sm btn-ghost" data-help-tour>重看首次導覽</button>
        <span class="mono help-foot-note">按 ? 或 Esc 關閉 · Anchorline</span>
      </footer>
    </div>`;

  root.querySelector("[data-help-close]")?.addEventListener("click", () => hideHelp());
  // 導覽不是一次性消耗品：忘了就回來看
  root.querySelector("[data-help-tour]")?.addEventListener("click", () => {
    hideHelp();
    import("./first-run-tour").then((m) => m.startTour()).catch(() => {});
  });
  root.addEventListener("click", (e) => {
    if (e.target === root) hideHelp();
  });

  if (!bound) {
    bound = true;
    document.addEventListener("keydown", (e) => {
      const t = e.target as HTMLElement;
      if (t.matches("input, textarea, select, [contenteditable='true']")) return;
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        toggleHelp();
        return;
      }
      if (e.key === "Escape") {
        const el = document.getElementById("help-overlay");
        if (el && !el.hidden) {
          e.preventDefault();
          hideHelp();
        }
      }
      // 數字鍵導覽
      const routes: Record<string, string> = {
        "1": "projects.html",
        "2": "editor.html",
        "3": "templates.html",
        "4": "review.html",
        "5": "tracking.html",
        "6": "write.html",
        "7": "signoff.html",
      };
      if (routes[e.key] && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        location.href = routes[e.key]!;
      }
    });
  }
}

export function showHelp() {
  const el = document.getElementById("help-overlay");
  if (el) el.hidden = false;
}

export function hideHelp() {
  const el = document.getElementById("help-overlay");
  if (el) el.hidden = true;
}

export function toggleHelp() {
  const el = document.getElementById("help-overlay");
  if (!el) return;
  el.hidden = !el.hidden;
}

/** 頁面初始化：掛 help + 可選額外區段 */
export function initHelpOverlay(extra?: HelpSection[]) {
  ensureHelpOverlay(extra);
}
