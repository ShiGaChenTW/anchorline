/**
 * 側邊欄專案卡片：自訂名稱／資料夾名 + 最後更新時間。
 * 側邊欄「目前工作區」上下文（取代 titlebar 長專案名）。
 */
import { store } from "../data/store";
import { projectDisplayName, type Project } from "../data/types";
import { formatLastUpdate } from "./time-format";
import { escapeHtml, toast } from "./ui";

export type RailContextOpts = {
  /** 例如：審閱 / 編輯 / 專案 */
  mode: string;
  projectName?: string;
  statusLabel?: string;
  statusTone?: "draft" | "review" | "ok" | "warn";
  meta?: string;
};

/**
 * 把「目前頁面 · 專案名」放到左側欄（不再塞 titlebar）
 */
export function syncRailContext(opts: RailContextOpts) {
  const rail = document.querySelector(".rail");
  if (!rail) return;

  let el = document.getElementById("rail-context");
  if (!el) {
    el = document.createElement("div");
    el.id = "rail-context";
    el.className = "rail-context";
    el.setAttribute("role", "status");
    el.setAttribute("aria-label", "目前工作區");
    const brand = rail.querySelector(".rail-brand");
    if (brand) brand.insertAdjacentElement("afterend", el);
    else rail.prepend(el);
  }

  const name = (opts.projectName ?? "").trim() || "未選擇專案";
  const tone = opts.statusTone ?? "draft";
  const status = (opts.statusLabel ?? "").trim();
  const meta = (opts.meta ?? "").trim();

  el.innerHTML = `
    <div class="rail-context-kicker">目前</div>
    <div class="rail-context-mode">${escapeHtml(opts.mode)}</div>
    <div class="rail-context-project" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
    ${
      status
        ? `<div class="rail-context-status rail-context-status--${tone}">${escapeHtml(status)}</div>`
        : ""
    }
    ${meta ? `<div class="rail-context-meta">${escapeHtml(meta)}</div>` : ""}
  `;

  // 側欄品牌名固定（titlebar 已移除）
  document.querySelectorAll(".rail-brand strong, .rail-brand-text strong").forEach((n) => {
    n.textContent = "PRD開發監控台";
  });
}

function bumpCounts() {
  import("./rail-nav")
    .then((m) => m.refreshNavCounts())
    .catch(() => {
      /* ignore */
    });
}

function statusTone(p: Project): string {
  if (p.status === "approved") return "ok";
  if (p.status === "review") return "warn";
  return "draft";
}

function statusLabel(p: Project): string {
  if (p.status === "approved") return "已核准";
  if (p.status === "review") return "審閱中";
  if (p.status === "withdrawn") return "已抽單";
  return "草稿";
}

export function renderRailProjects(host?: HTMLElement | null) {
  const nav = host ?? document.querySelector(".rail-nav");
  if (!nav) return;

  let block = document.getElementById("rail-projects-block");
  if (!block) {
    block = document.createElement("div");
    block.id = "rail-projects-block";
    block.className = "rail-projects-block";
    const workLabel = Array.from(nav.querySelectorAll(".nav-label")).find((el) =>
      /工作區/.test(el.textContent || ""),
    );
    const firstNav = nav.querySelector("a.nav-item");
    if (workLabel) {
      workLabel.insertAdjacentElement("afterend", block);
    } else if (firstNav) {
      nav.insertBefore(block, firstNav);
    } else {
      nav.insertBefore(block, nav.firstChild);
    }
  }

  const projects = store.visibleProjects();
  const activeId = store.get().activeProjectId;

  if (!projects.length) {
    block.innerHTML = `
      <div class="nav-label">專案</div>
      <div class="rail-projects-empty">尚無專案<br /><span class="muted">新建或匯入資料夾</span></div>
    `;
    bumpCounts();
    return;
  }

  block.innerHTML = `
    <div class="nav-label">專案 <span class="rail-proj-count">${projects.length}</span></div>
    <div class="rail-projects" role="list" aria-label="專案清單">
      ${projects
        .map((p) => {
          const name = projectDisplayName(p);
          const on = p.id === activeId ? " on" : "";
          const when = formatLastUpdate(p.lastFileAt || p.importSummary?.scannedAt || p.updated);
          const folderHint = p.sourceFolder && !p.customName
            ? escapeHtml(p.sourceFolder)
            : p.customName
              ? escapeHtml(p.sourceFolder || p.title)
              : "";
          const badge = p.isImported
            ? `<span class="rail-proj-tag">匯入</span>`
            : p.isSample
              ? `<span class="rail-proj-tag sample">範例</span>`
              : `<span class="rail-proj-tag new">新建</span>`;
          return `
            <article class="rail-proj-card${on}" data-project-id="${escapeHtml(p.id)}" role="listitem" title="${escapeHtml(name)}${folderHint ? ` · ${folderHint}` : ""}">
              <button type="button" class="rail-proj-card-main" data-open-id="${escapeHtml(p.id)}">
                <span class="rail-proj-card-top">
                  <span class="rail-proj-status rail-proj-status--${statusTone(p)}" title="${statusLabel(p)}"></span>
                  <span class="rail-proj-card-title">${escapeHtml(name)}</span>
                  ${badge}
                </span>
                <span class="rail-proj-card-sub">${escapeHtml(when)}</span>
              </button>
              <button type="button" class="rail-proj-card-rename" data-rename-id="${escapeHtml(p.id)}" title="自訂專案名稱" aria-label="重新命名 ${escapeHtml(name)}">✎</button>
            </article>`;
        })
        .join("")}
    </div>
  `;

  block.querySelectorAll<HTMLButtonElement>("[data-open-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.openId;
      if (!id) return;
      store.setActiveProject(id);
      const path = location.pathname + location.href;
      if (path.includes("editor.html") || path.includes("review.html")) {
        location.reload();
        return;
      }
      if (path.includes("projects.html")) {
        renderRailProjects(nav as HTMLElement);
        document.dispatchEvent(new CustomEvent("specforge:project-changed", { detail: { id } }));
        return;
      }
      location.href = "editor.html";
    });
  });

  block.querySelectorAll<HTMLButtonElement>("[data-rename-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.renameId;
      if (!id) return;
      const p = store.get().projects.find((x) => x.id === id);
      if (!p) return;
      const current = projectDisplayName(p);
      const next = window.prompt(
        `自訂專案名稱（留空則顯示${p.sourceFolder ? "資料夾名" : "標題"}：${p.sourceFolder || p.title}）`,
        p.customName || current,
      );
      if (next === null) return;
      const r = store.renameProject(id, next);
      if (!r.ok) toast(r.reason ?? "重新命名失敗");
      else toast(next.trim() ? `已命名為「${next.trim()}」` : "已清除自訂名稱");
    });
  });

  bumpCounts();
}

let bound = false;

export function bindRailProjects() {
  renderRailProjects();
  if (bound) return;
  bound = true;
  store.subscribe(() => renderRailProjects());
}
