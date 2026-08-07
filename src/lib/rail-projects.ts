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

/**
 * 「＋」的選單。三條進場路徑放在同一顆按鈕底下：
 * 匯入既有資料夾、從零新建、新手引導。
 *
 * ADHD：三顆並排的按鈕會逼人先比較再決定；一顆 ＋ 打開才做選擇，
 * 決策點只有一個，而且選項自帶一句說明。
 */
const ADD_ITEMS: { href: string; label: string; desc: string }[] = [
  { href: "projects.html?import=1", label: "專案匯入", desc: "掃描既有資料夾，自動對應 PRD 章節" },
  { href: "projects.html?new=1", label: "新建 PRD", desc: "從空白開始，精靈帶你走一遍" },
  { href: "projects.html?beginner=1", label: "新手引導", desc: "多一點提示與範例，第一次寫就選這個" },
];

function bindAddMenu(block: HTMLElement) {
  const btn = block.querySelector("#rail-proj-add") as HTMLButtonElement | null;
  if (!btn) return;

  const close = () => {
    document.getElementById("rail-add-menu")?.remove();
    btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onKey);
  };
  function onDocClick(e: MouseEvent) {
    const menu = document.getElementById("rail-add-menu");
    if (!menu) return;
    if (menu.contains(e.target as Node) || btn!.contains(e.target as Node)) return;
    close();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (document.getElementById("rail-add-menu")) {
      close();
      return;
    }
    const menu = document.createElement("div");
    menu.id = "rail-add-menu";
    menu.className = "rail-add-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML = ADD_ITEMS.map(
      (it) => `
        <a class="rail-add-item" role="menuitem" href="${it.href}">
          <strong>${it.label}</strong>
          <span>${it.desc}</span>
        </a>`,
    ).join("");
    // 掛在 body 而不是側欄裡：側欄有 overflow: auto，掛在裡面會被裁掉
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect();
    menu.style.top = `${Math.round(r.bottom + 6)}px`;
    menu.style.left = `${Math.round(Math.min(r.left - 8, window.innerWidth - menu.offsetWidth - 12))}px`;
    btn.setAttribute("aria-expanded", "true");
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onKey);
    (menu.querySelector("a") as HTMLElement | null)?.focus();
  });
}

  const projects = store.visibleProjects();
  const activeId = store.get().activeProjectId;

  if (!projects.length) {
    block.innerHTML = `
      <div class="nav-label rail-proj-head">
        <span>專案</span>
        <button type="button" class="rail-proj-add" id="rail-proj-add" title="新增" aria-label="新增" aria-haspopup="true" aria-expanded="false">+</button>
      </div>
      <div class="rail-projects-empty">尚無專案<br /><span class="muted">新建或匯入資料夾</span></div>
    `;
    bindAddMenu(block);
    bumpCounts();
    return;
  }

  block.innerHTML = `
    <div class="nav-label rail-proj-head">
      <span>專案 <span class="rail-proj-count">${projects.length}</span></span>
      <a class="rail-overview" href="overview.html" title="所有專案的總覽儀表板">總覽</a>
      <a class="rail-list" href="projects.html" title="專案清單：篩選、搜尋、切換檢視">清單</a>
      <button type="button" class="rail-proj-add" id="rail-proj-add" title="新增" aria-label="新增" aria-haspopup="true" aria-expanded="false">+</button>
    </div>
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
      // 編輯名稱中不要切專案
      if (btn.closest(".rail-proj-card")?.classList.contains("is-renaming")) return;
      const id = btn.dataset.openId;
      if (!id) return;
      store.setActiveProject(id);
      // 點專案卡片一律進儀表板 —— 與專案列表的卡片同一個行為。
      // 已經在儀表板上就重載，讓量測與畫面對上新專案。
      const path = location.pathname + location.href;
      if (path.includes("dashboard.html")) {
        location.reload();
        return;
      }
      location.href = "dashboard.html";
    });
  });

  block.querySelectorAll<HTMLButtonElement>("[data-rename-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.renameId;
      if (!id) return;
      beginInlineRename(block, id);
    });
  });

  bindAddMenu(block);
  bumpCounts();
}

/**
 * 頁內重新命名（WKWebView 不支援 window.prompt）
 */
function beginInlineRename(block: HTMLElement, id: string) {
  const p = store.get().projects.find((x) => x.id === id);
  if (!p) return;

  const card = Array.from(block.querySelectorAll<HTMLElement>(".rail-proj-card")).find(
    (el) => el.dataset.projectId === id,
  );
  if (!card) return;

  // 已在編輯：聚焦
  const existing = card.querySelector<HTMLInputElement>(".rail-proj-rename-input");
  if (existing) {
    existing.focus();
    existing.select();
    return;
  }

  const fallback = (p.sourceFolder || p.title || "").trim() || "專案";
  const current = (p.customName || projectDisplayName(p)).trim();
  card.classList.add("is-renaming");

  const main = card.querySelector(".rail-proj-card-main");
  const renameBtn = card.querySelector(".rail-proj-card-rename");
  if (main) (main as HTMLElement).style.display = "none";
  if (renameBtn) (renameBtn as HTMLElement).style.display = "none";

  const form = document.createElement("div");
  form.className = "rail-proj-rename-form";
  form.innerHTML = `
    <label class="rail-proj-rename-label">自訂名稱
      <span class="rail-proj-rename-hint">留空＝${escapeHtml(fallback)}</span>
    </label>
    <input type="text" class="rail-proj-rename-input" maxlength="80" value="${escapeHtml(current)}" />
    <div class="rail-proj-rename-actions">
      <button type="button" class="btn btn-sm btn-primary rail-proj-rename-save">儲存</button>
      <button type="button" class="btn btn-sm btn-ghost rail-proj-rename-cancel">取消</button>
    </div>
  `;
  card.appendChild(form);

  const input = form.querySelector<HTMLInputElement>(".rail-proj-rename-input")!;
  const save = () => {
    const next = input.value;
    const r = store.renameProject(id, next);
    if (!r.ok) {
      toast(r.reason ?? "重新命名失敗");
      return;
    }
    // 必須先解除 is-renaming 再重繪：subscribe 會跳過「編輯中」卡片
    card.classList.remove("is-renaming");
    form.remove();
    renderRailProjects();
    // 側欄「目前」區塊也同步新名稱
    const active = store.get().activeProjectId === id;
    if (active) {
      const p2 = store.get().projects.find((x) => x.id === id);
      if (p2) {
        const name = projectDisplayName(p2);
        const ctx = document.querySelector(".rail-context-project");
        if (ctx) ctx.textContent = name;
      }
    }
    toast(next.trim() ? `已命名為「${next.trim()}」` : "已清除自訂名稱");
  };
  const cancel = () => {
    card.classList.remove("is-renaming");
    renderRailProjects();
  };

  form.querySelector(".rail-proj-rename-save")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    save();
  });
  form.querySelector(".rail-proj-rename-cancel")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    cancel();
  });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      save();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      cancel();
    }
  });
  input.addEventListener("click", (ev) => ev.stopPropagation());

  // 下一個 frame 聚焦（WKWebView 較穩）
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

/** 供專案列表等外部觸發側欄頁內重新命名 */
export function startProjectRename(id: string) {
  renderRailProjects();
  requestAnimationFrame(() => {
    const block = document.getElementById("rail-projects-block");
    if (!block) {
      toast("側欄專案清單尚未就緒");
      return;
    }
    beginInlineRename(block, id);
  });
}

let bound = false;

export function bindRailProjects() {
  renderRailProjects();
  if (bound) return;
  bound = true;
  store.subscribe(() => {
    // 重新命名編輯中不要洗掉表單
    if (document.querySelector(".rail-proj-card.is-renaming")) return;
    renderRailProjects();
  });
}
