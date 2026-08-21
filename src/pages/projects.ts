import { isNative, native } from "../lib/native";
import { store } from "../data/store";
import { APP_VARIANT } from "../data/seed";
import { projectDisplayName, type Project, type ProjectStatus } from "../data/types";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import {
  setBeginnerMode,
} from "../lib/beginner-flow";
import {
  exportHtmlFile,
  exportJsonFile,
  exportMarkdownFile,
  exportOpenspecBundle,
  exportProjectProfile,
} from "../lib/export";
import { deriveFlowLayers, renderFlowStripHtml } from "../lib/flow-layers";
import { DEFAULT_DOMAIN, listDomains } from "../data/domains";
import {
  scanFolderFromFileList,
  scanFromNativeFolder,
  scoreTone,
  SLOT_META,
  type FolderScanResult,
  type NativeFolderFile,
  type ProjectCandidate,
} from "../lib/folder-import";
import { initFirstRunTour } from "../lib/first-run-tour";
import { initHelpOverlay } from "../lib/help-overlay";
import {
  applyTasksReadback,
  parseTasksReadback,
  type TasksReadback,
} from "../lib/openspec-import";
import { parsePlanMeta, planProgressPct, type PlanMeta } from "../lib/plan-parser";
import { askForProjectFolder } from "../lib/project-folder";
import { canDelete, canEditContent, canExport } from "../lib/permissions";
import { bindRailProjects, renderRailProjects } from "../lib/rail-projects";
import { initTheme } from "../lib/theme";
import {
  bindModalDismiss,
  closeModal,
  escapeHtml,
  initMobileNav,
  openModal,
  toast,
  updateUserRailFooter,
} from "../lib/ui";
import {
  filterProjects,
  nextProjectSort,
  parseProjectSort,
  projectFolderLabel,
  projectSortIndicator,
  sortProjects,
  type ProjectSortKey,
  type ProjectSortState,
} from "../lib/project-list";

if (!requireAuth()) {
  /* redirected */
} else {
  initTheme();
  initMobileNav("projects");
  bindModalDismiss("modal");
  bindModalDismiss("modal-import");
  bindLogout();
  initHelpOverlay();
  bindRailProjects();
  initFirstRunTour();


  // L1–L6 strip under toolbar
  {
    const main = document.querySelector(".main");
    const toolbar = document.querySelector(".toolbar");
    if (main && toolbar && !document.querySelector(".flow-strip")) {
      const wrap = document.createElement("div");
      wrap.id = "flow-strip-host";
      toolbar.insertAdjacentElement("afterend", wrap);
    }
  }

  const STATUS: Record<ProjectStatus, { label: string; cls: string }> = {
    draft: { label: "草稿", cls: "pill-draft" },
    review: { label: "審閱中", cls: "pill-review" },
    approved: { label: "已核准", cls: "pill-approved" },
    withdrawn: { label: "已抽單", cls: "pill-draft" },
  };

  let filter = "all";
  let query = "";
  /** 標籤篩選（可複選，全部命中才留下）。網址 ?tag=xxx 可直接帶入 */
  let tagFilter: string[] = (() => {
    const t = new URLSearchParams(location.search).get("tag");
    return t ? [t] : [];
  })();

  function syncChrome() {
    const u = store.get().currentUser;
    updateUserRailFooter(toRailUser(u));
    const sampleBtn = document.getElementById("btn-toggle-samples");
    if (sampleBtn) {
      sampleBtn.textContent = store.get().showSamples ? "隱藏範例文件" : "展示範例文件";
      sampleBtn.setAttribute("aria-pressed", store.get().showSamples ? "true" : "false");
    }
    const newBtn = document.getElementById("btn-new") as HTMLButtonElement | null;
    if (newBtn) {
      const allow = canEditContent(u);
      newBtn.disabled = !allow;
      newBtn.title = allow ? "" : "核准人員無法新建／編輯內文";
    }
  }

  function renderStats(projects: Project[]) {
    const open = projects.filter((p) => p.status === "draft" || p.status === "review").length;
    const pending = projects.filter((p) => p.status === "review").length;
    const approved = projects.filter((p) => p.status === "approved").length;
    // 粗估「完成天數」：僅示意 — 用 (100-pct)/15 的平均，避免寫死 6.4
    const drafts = projects.filter((p) => p.status !== "approved");
    const avgDays =
      drafts.length === 0
        ? 0
        : Math.round(
            (drafts.reduce((a, p) => a + Math.max(1, (100 - p.pct) / 12), 0) / drafts.length) * 10,
          ) / 10;

    const nodes = document.querySelectorAll(".stat .v");
    if (nodes[0]) {
      // 可能含 <small>，只更新數字文字節點
      const el = nodes[0] as HTMLElement;
      if (el.querySelector("small")) {
        el.childNodes[0] && (el.childNodes[0].textContent = String(open));
      } else el.textContent = String(open);
    }
    if (nodes[1]) nodes[1].textContent = String(pending);
    if (nodes[2]) nodes[2].textContent = String(approved);
    if (nodes[3]) {
      const el = nodes[3] as HTMLElement;
      const small = el.querySelector("small");
      if (small) {
        el.childNodes[0] && (el.childNodes[0].textContent = String(avgDays) + " ");
      } else el.textContent = String(avgDays);
    }

    const navProjects = document.querySelector('[data-od-id="nav-projects"] .count');
    if (navProjects) navProjects.textContent = String(projects.length);
    const navReview = document.querySelector('[data-od-id="nav-review"] .count');
    if (navReview) navReview.textContent = String(pending);
    const navTpl = document.querySelector('[data-od-id="nav-templates"] .count');
    if (navTpl) navTpl.textContent = String(store.get().templates.length);
  }

  // plans/*.md 只在開發時預嵌。
  // eager glob 會把「這個 repo 自己的」內部規劃文件整包打進 bundle ——
  // 正式版曾因此多出一個 160KB chunk，等於把開發筆記發布給使用者。
  // 桌面版本來就走原生橋讀「使用者選取專案」的 plans/，不靠這份預嵌；
  // 瀏覽器版失去的只是開發用的假資料。
  const planModules = (import.meta.env.DEV
    ? import.meta.glob("../../plans/*.md", {
        query: "?raw",
        import: "default",
        eager: true,
      })
    : {}) as Record<string, string>;

  type PlanHit = { name: string; meta: PlanMeta; pct: number };

  function loadPlanHits(): PlanHit[] {
    return Object.entries(planModules).map(([path, raw]) => {
      const name = path.split("/").pop() ?? path;
      const meta = parsePlanMeta(raw, name);
      return { name, meta, pct: planProgressPct(meta) };
    });
  }

  function renderPlanBar(plans: PlanHit[]) {
    const bar = document.getElementById("plan-workspace-bar");
    if (!bar) return;
    if (!plans.length) {
      bar.innerHTML = `尚無計劃檔 · <a href="tracking.html" class="plan-bar-link">打開計劃追蹤</a>`;
      return;
    }
    const withSteps = plans.filter((p) => p.meta.total_steps > 0);
    const avg =
      withSteps.length === 0
        ? 0
        : Math.round(withSteps.reduce((a, p) => a + p.pct, 0) / withSteps.length);
    const pending = withSteps.reduce((a, p) => a + p.meta.pending_steps, 0);
    bar.innerHTML = `<span class="plan-bar-stat"><em>${plans.length}</em> 份計劃</span>
      <span class="plan-bar-stat">已結 <em>${avg}%</em></span>
      <span class="plan-bar-stat">待辦 <em>${pending}</em></span>
      <a href="tracking.html" class="plan-bar-link">打開追蹤</a>`;
  }

  function renderFlow() {
    const host = document.getElementById("flow-strip-host");
    if (!host) return;
    const hasPlanSteps = Object.values(planModules).some((raw) =>
      /^- \[[ xXvV]\]/m.test(raw),
    );
    host.innerHTML = renderFlowStripHtml(deriveFlowLayers(store.get(), { hasPlanSteps, gateSpec: store.activeGateSpec() }));
  }

  /** 顯示方式：列表／卡片／資料夾。存 localStorage —— 換了頁回來不該重來。 */
  type ViewMode = "list" | "card" | "folder";
  const VIEW_KEY = "anchorline:project-view";
  /** 資料夾模式裡，群組內部要用清單還是卡片 */
  type SubMode = "list" | "card";
  const SUB_KEY = "anchorline:folder-sub";
  let sub: SubMode = (() => {
    try {
      return localStorage.getItem(SUB_KEY) === "card" ? "card" : "list";
    } catch {
      return "list";
    }
  })();
  let view: ViewMode = (() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      return v === "list" || v === "card" || v === "folder" ? v : "list";
    } catch {
      return "list";
    }
  })();
  /** 與範本庫同一套三態。null = visibleProjects 原順序 */
  let sort: ProjectSortState = null;

  function actionOf(p: Project): { href: string; label: string } {
    const href =
      p.status === "review" || p.status === "approved" || p.status === "withdrawn"
        ? "review.html"
        : "editor.html";
    const label =
      p.status === "approved"
        ? "檢視"
        : p.status === "review"
          ? "審閱"
          : p.status === "withdrawn"
            ? "抽單"
            : "繼續寫";
    return { href, label };
  }

  function tagsOf(p: Project): string {
    const t: string[] = [];
    if (p.isImported) t.push(`<span class="p-tag p-tag--import">匯入</span>`);
    if (p.isSample) t.push(`<span class="p-tag">範例</span>`);
    if (p.id === store.get().activeProjectId) t.push(`<span class="p-tag p-tag--now">目前</span>`);
    return t.join("");
  }

  /** compact=true 時收掉低頻操作（重新命名／退出追蹤），一行才塞得下 */
  function cardHtml(p: Project, compact: boolean): string {
    const st = STATUS[p.status];
    const { href, label } = actionOf(p);
    const barCls = p.pct >= 100 ? "ok" : "";
    const display = projectDisplayName(p);
    const meta = [p.owner, p.updated].filter(Boolean).map((x) => escapeHtml(String(x))).join(" · ");
    const untrack = canDelete(store.get().currentUser)
      ? `<button type="button" class="btn btn-sm btn-ghost btn-untrack" data-untrack-id="${escapeHtml(p.id)}" title="僅從工作區退出追蹤，不刪除磁碟檔案">退出追蹤</button>`
      : "";

    return `<article class="project-card${p.id === store.get().activeProjectId ? " is-active" : ""}" data-id="${p.id}" role="listitem">
  <div class="project-card-main" data-card-open="${p.id}" role="link" tabindex="0" title="看這個專案的儀表板">
    <div class="project-card-title-row">
      <a class="project-card-title" href="dashboard.html" data-open-project="${p.id}">${escapeHtml(display)}</a>${p.shortCode ? ` <span class="rail-proj-code">${escapeHtml(p.shortCode)}</span>` : ""}
      <span class="pill ${st.cls}">${st.label}</span>
      ${tagsOf(p)}
    </div>
    <div class="project-card-meta">${meta || "—"}</div>
    <div class="project-card-progress">
      <div class="progress"><div class="progress-bar ${barCls}"><i style="width:${p.pct}%"></i></div></div>
      <span class="project-card-pct">${p.pct}%</span>
    </div>
  </div>
  <div class="project-card-actions">
    <a class="btn btn-primary row-action-main" href="${href}" data-open-project="${p.id}">${label}</a>
    ${compact ? "" : `<button type="button" class="btn btn-sm btn-ghost" data-rename-project="${escapeHtml(p.id)}" title="自訂顯示名稱">重新命名</button>${untrack}`}
  </div>
</article>`;
  }

  function renderFlatView(rows: Project[], mode: ViewMode): string {
    if (mode === "list") return renderListTable(rows);
    return rows.map((p) => cardHtml(p, false)).join("");
  }

  const LIST_COLS: { key: ProjectSortKey | null; label: string; cls?: string }[] = [
    { key: "title", label: "標題" },
    { key: "status", label: "狀態" },
    { key: "pct", label: "進度", cls: "tv-num" },
    { key: "updated", label: "更新" },
    { key: "folder", label: "資料夾", cls: "tv-col-source" },
    { key: null, label: "", cls: "tv-actions" },
  ];

  /**
   * 與 PRD 範本庫同一套表：表頭可點、三態排序、標題＋一句說明。
   * 動作欄沿用既有 data-*，委派 handler 不用改。
   */
  function renderListTable(rows: Project[]): string {
    const head = LIST_COLS.map((c) => {
      if (!c.key) return `<th class="${c.cls ?? ""}" aria-label="動作"></th>`;
      const arrow = projectSortIndicator(sort, c.key);
      const dir = sort && sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
      return `<th class="tv-sortable ${c.cls ?? ""}" data-pl-sort="${c.key}" role="columnheader"
                  aria-sort="${dir}" tabindex="0" title="點一下排序，再點反向，第三次回到預設">
                ${escapeHtml(c.label)}${arrow ? `<span class="tv-sort-arrow">${arrow}</span>` : ""}
              </th>`;
    }).join("");

    const body = rows
      .map((p) => {
        const st = STATUS[p.status];
        const { href, label } = actionOf(p);
        const display = projectDisplayName(p);
        const blurb = (p.description ?? "").trim() || [p.owner, p.updated].filter(Boolean).join(" · ");
        const folder = projectFolderLabel(p);
        const untrack = canDelete(store.get().currentUser)
          ? `<button type="button" class="btn btn-sm btn-ghost btn-untrack" data-untrack-id="${escapeHtml(p.id)}" data-untrack-label="✕" title="僅從工作區退出追蹤，不刪除磁碟檔案" style="color:var(--muted)">✕</button>`
          : "";
        const rename = `<button type="button" class="btn btn-sm btn-ghost" data-rename-project="${escapeHtml(p.id)}" title="自訂顯示名稱">重新命名</button>`;
        return `<tr data-id="${escapeHtml(p.id)}" data-card-open="${escapeHtml(p.id)}" class="${p.id === store.get().activeProjectId ? "is-active" : ""}">
          <td>
            <a class="tv-title" href="dashboard.html" data-open-project="${escapeHtml(p.id)}">${escapeHtml(display)}</a>${p.shortCode ? ` <span class="rail-proj-code">${escapeHtml(p.shortCode)}</span>` : ""}
            <span class="tv-blurb tv-col-blurb">${escapeHtml(blurb || "—")}</span>
          </td>
          <td><span class="pill ${st.cls}">${st.label}</span>${tagsOf(p)}</td>
          <td class="tv-num">${p.pct}%</td>
          <td class="tv-num">${escapeHtml(p.updated || "—")}</td>
          <td class="tv-col-source">${folder ? escapeHtml(folder) : "—"}</td>
          <td class="tv-actions">
            <a class="btn btn-sm btn-ghost row-action-main" href="${href}" data-open-project="${escapeHtml(p.id)}" style="color:var(--accent);font-weight:600">${escapeHtml(label)}</a>
            ${rename}${untrack}
          </td>
        </tr>`;
      })
      .join("");

    return `<table class="tv-list pl-list"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  function bindListSort(host: HTMLElement) {
    host.querySelectorAll<HTMLElement>("[data-pl-sort]").forEach((th) => {
      const apply = () => {
        sort = nextProjectSort(sort, th.dataset.plSort as ProjectSortKey);
        render();
      };
      th.onclick = apply;
      th.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          apply();
        }
      };
    });
  }

  /**
   * 資料夾模式：依磁碟位置分群。沒綁資料夾的收在最後一組 ——
   * 那本身就是有用的資訊（這些專案量不到 git／容量）。
   */
  function renderFolderView(rows: Project[]): string {
    const groups = new Map<string, Project[]>();
    for (const p of rows) {
      const key = p.importSummary?.rootPath || p.sourceFolder || "";
      const g = groups.get(key);
      if (g) g.push(p);
      else groups.set(key, [p]);
    }
    const ordered = [...groups.entries()].sort((a, b) => {
      if (!a[0]) return 1; // 未綁定永遠排最後
      if (!b[0]) return -1;
      return a[0].localeCompare(b[0]);
    });

    return ordered
      .map(([path, list]) => {
        const label = path
          ? escapeHtml(path.split("/").filter(Boolean).pop() || path)
          : "未綁定資料夾";
        const pathHint = path ? escapeHtml(path) : "量不到 git、技術線與容量";
        return `<section class="folder-group">
          <header class="folder-group-head">
            <svg class="ic" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1.75 1h4.5c.29 0 .56.14.72.38L8.13 3h6.12c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75C0 1.784.784 1 1.75 1z"/></svg>
            <span class="folder-group-name">${label}</span>
            <span class="folder-group-count">${list.length}</span>
            <span class="folder-group-path mono">${pathHint}</span>
          </header>
          <div class="folder-group-body sub-${sub}">${
            sub === "list" ? renderListTable(list) : list.map((p) => cardHtml(p, false)).join("")
          }</div>
        </section>`;
      })
      .join("");
  }

  /**
   * 標籤篩選列。只在真的有人打過標籤時才出現 ——
   * 一條永遠空著的篩選列只是佔位噪音。
   */
  function renderTagBar() {
    const host = document.getElementById("tag-bar");
    if (!host) return;
    const all = store.allTags();
    if (!all.length) {
      host.innerHTML = "";
      host.hidden = true;
      return;
    }
    host.hidden = false;
    host.innerHTML = `
      <span class="tag-bar-label">標籤</span>
      ${all
        .map((t) => {
          const on = tagFilter.some((x) => x.toLowerCase() === t.tag.toLowerCase());
          return `<button type="button" class="tag-chip${on ? " on" : ""}" data-tag="${escapeHtml(t.tag)}"
                    aria-pressed="${on}">${escapeHtml(t.tag)}<span>${t.count}</span></button>`;
        })
        .join("")}
      ${tagFilter.length ? `<button type="button" class="tag-clear" id="tag-clear">清除</button>` : ""}
    `;
  }

  function render() {
    const tbody = document.getElementById("tbody");
    if (!tbody) return;
    const projects = store.visibleProjects();
    const planHits = loadPlanHits();
    renderPlanBar(planHits);

    const rows = sortProjects(
      filterProjects(projects, {
        status: filter as "all" | "mine" | ProjectStatus,
        tags: tagFilter,
        q: query,
      }),
      sort,
    );

    renderTagBar();

    const count = document.getElementById("result-count");
    if (count) count.textContent = rows.length === 0 ? "沒有項目" : `${rows.length} 個專案`;

    if (rows.length === 0) {
      tbody.innerHTML = `<div class="project-board-empty">沒有符合的專案</div>`;
      renderStats(projects);
      syncChrome();
      return;
    }

    tbody.className = view === "list" ? "tv-list-wrap" : `project-board-list view-${view}`;
    if (view === "list") tbody.removeAttribute("role");
    else tbody.setAttribute("role", "list");
    tbody.innerHTML =
      view === "folder" ? renderFolderView(rows) : renderFlatView(rows, view);
    bindListSort(tbody);

    const sortSel = document.getElementById("pl-sort-select") as HTMLSelectElement | null;
    if (sortSel) sortSel.value = sort ? `${sort.key}:${sort.dir}` : "";

    renderStats(projects);
    renderFlow();
    syncChrome();
    syncBeginnerCta();
    const navCount = document.querySelector('[data-od-id="nav-projects"] .count');
    if (navCount) navCount.textContent = String(projects.length);
  }

  // 表格操作：委派綁定（避免 WKWebView 下 re-render 後 handler 失效；confirm 不可靠時仍可操作）
  const tbodyEl = document.getElementById("tbody");
  if (tbodyEl && !tbodyEl.dataset.actionsBound) {
    tbodyEl.dataset.actionsBound = "1";
    tbodyEl.addEventListener("click", (e) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;

      const renameBtn = t.closest<HTMLElement>("[data-rename-project]");
      if (renameBtn) {
        e.preventDefault();
        e.stopPropagation();
        const id = renameBtn.dataset.renameProject;
        if (!id) return;
        import("../lib/rail-projects")
          .then((m) => m.startProjectRename(id))
          .catch(() => toast("無法開啟重新命名"));
        return;
      }

      const untrackBtn = t.closest<HTMLElement>("[data-untrack-id]");
      if (untrackBtn) {
        e.preventDefault();
        e.stopPropagation();
        const id = untrackBtn.dataset.untrackId;
        if (!id) return;
        const p = store.get().projects.find((x) => x.id === id);
        const title = p?.title ?? id;
        // WKWebView 的 confirm 偶發無效；改用兩段式 data-confirm
        if (untrackBtn.dataset.confirming !== "1") {
          untrackBtn.dataset.confirming = "1";
          untrackBtn.textContent = "再點確認";
          untrackBtn.classList.add("btn-warn-confirm");
          toast(`再點一次以退出追蹤「${title}」（不刪檔）`);
          window.setTimeout(() => {
            if (untrackBtn.dataset.confirming === "1") {
              untrackBtn.dataset.confirming = "";
              untrackBtn.textContent = untrackBtn.dataset.untrackLabel || "退出追蹤";
              untrackBtn.classList.remove("btn-warn-confirm");
            }
          }, 4000);
          return;
        }
        const r = store.untrackProject(id);
        if (!r.ok) toast(r.reason ?? "無法退出追蹤");
        else toast(`已退出追蹤「${title}」· 磁碟檔案未動`);
        return;
      }

      const openEl = t.closest<HTMLElement>("[data-open-project]");
      if (openEl && openEl.tagName === "A") {
        const id = openEl.dataset.openProject;
        if (id) store.setActiveProject(id);
        // 讓 <a href> 正常導向
        return;
      }

      // 卡片主體（標題以外的空白處）也算點卡片 → 進儀表板。
      // 「繼續寫／審閱」是明確的行動，維持直達編輯台／審閱頁，不繞路。
      const cardEl = t.closest<HTMLElement>("[data-card-open]");
      if (cardEl) {
        const id = cardEl.dataset.cardOpen;
        if (!id) return;
        store.setActiveProject(id);
        location.href = "dashboard.html";
      }
    });
  }

  // role="link" + tabindex 就必須吃鍵盤，否則只有滑鼠使用者進得去
  document.getElementById("tbody")?.addEventListener("keydown", (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key !== "Enter" && ke.key !== " ") return;
    const card = (ke.target as HTMLElement).closest<HTMLElement>("[data-card-open]");
    if (!card) return;
    ke.preventDefault();
    const id = card.dataset.cardOpen;
    if (!id) return;
    store.setActiveProject(id);
    location.href = "dashboard.html";
  });

  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      view = (btn.dataset.view as ViewMode) ?? "card";
      try {
        localStorage.setItem(VIEW_KEY, view);
      } catch {
        /* private mode */
      }
      syncViewSwitch();
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-sub]").forEach((btn) => {
    btn.addEventListener("click", () => {
      sub = btn.dataset.sub === "card" ? "card" : "list";
      try {
        localStorage.setItem(SUB_KEY, sub);
      } catch {
        /* private mode */
      }
      syncViewSwitch();
      render();
    });
  });

  function syncViewSwitch() {
    document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((b) => {
      const on = b.dataset.view === view;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    // 子切換只在資料夾模式有意義，其他模式藏起來不佔位
    const subHost = document.getElementById("folder-sub");
    if (subHost) subHost.hidden = view !== "folder";
    document.querySelectorAll<HTMLButtonElement>("[data-sub]").forEach((b) => {
      const on = b.dataset.sub === sub;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }
  syncViewSwitch();

  // 標籤列用事件委派：內容每次 render 都會重建
  document.getElementById("tag-bar")?.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("#tag-clear")) {
      tagFilter = [];
      render();
      return;
    }
    const chip = t.closest("[data-tag]") as HTMLElement | null;
    if (!chip) return;
    const tag = chip.dataset.tag ?? "";
    const i = tagFilter.findIndex((x) => x.toLowerCase() === tag.toLowerCase());
    if (i >= 0) tagFilter.splice(i, 1);
    else tagFilter.push(tag);
    render();
  });

  document.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-filter]").forEach((b) => b.classList.remove("on"));
      btn.classList.add("on");
      filter = (btn as HTMLElement).dataset.filter ?? "all";
      render();
    });
  });

  document.getElementById("q")?.addEventListener("input", (e) => {
    query = (e.target as HTMLInputElement).value.trim();
    render();
  });

  document.getElementById("pl-sort-select")?.addEventListener("change", (e) => {
    sort = parseProjectSort((e.target as HTMLSelectElement).value);
    render();
  });

  // 工具列：全部退出追蹤
  const toolbar = document.querySelector(".toolbar");
  if (toolbar && !document.getElementById("btn-untrack-all")) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "btn-untrack-all";
    btn.className = "btn";
    btn.title = "清空工作區追蹤列表，不刪除磁碟檔案";
    btn.textContent = "全部退出追蹤";
    const importBtn = document.getElementById("btn-import");
    if (importBtn?.parentElement) {
      importBtn.parentElement.insertBefore(btn, importBtn);
    } else {
      toolbar.appendChild(btn);
    }
    btn.addEventListener("click", () => {
      const n = store.get().projects.length;
      if (!n) {
        toast("目前沒有追蹤中的專案");
        return;
      }
      if (btn.dataset.confirming !== "1") {
        btn.dataset.confirming = "1";
        btn.textContent = `再點確認清空 ${n} 筆`;
        toast("再點一次將清空工作區追蹤（不刪磁碟檔）");
        window.setTimeout(() => {
          if (btn.dataset.confirming === "1") {
            btn.dataset.confirming = "";
            btn.textContent = "全部退出追蹤";
          }
        }, 4000);
        return;
      }
      const r = store.untrackAllProjects();
      btn.dataset.confirming = "";
      btn.textContent = "全部退出追蹤";
      if (!r.ok) toast(r.reason ?? "清空失敗");
      else toast(`已退出追蹤 ${r.count} 個專案 · 可重新匯入`);
    });
  }

  // 一次性清空：先前錯誤拆分子目錄匯入的追蹤資料，方便重新匯入
  {
    const MIGRATE_KEY = "anchorline:clear-split-import-v1";
    try {
      if (!localStorage.getItem(MIGRATE_KEY) && store.get().projects.length > 0) {
        const r = store.untrackAllProjects();
        localStorage.setItem(MIGRATE_KEY, "1");
        if (r.ok && r.count > 0) {
          toast(`已清空 ${r.count} 筆舊追蹤，請重新「專案匯入」`);
        }
      } else if (!localStorage.getItem(MIGRATE_KEY)) {
        localStorage.setItem(MIGRATE_KEY, "1");
      }
    } catch {
      /* ignore */
    }
  }

  /* ─── PRD 新手撰寫流程（7 步） ─── */
  let wizStep = 0;
  /** 3 個問題 + 1 個確認頁 */
  const WIZ_MAX = 3;
  const DRAFT_KEY = "anchorline:new-prd-draft:v1";
  let beginnerPath = true;

  /** 三題的欄位與範例句。範例句是任務啟動的坡道，不是裝飾。 */
  const ASK: { id: string; label: string; example: string }[] = [
    {
      id: "wiz-what",
      label: "做什麼",
      example: "在登入流程加入 TOTP 與 WebAuthn 第二因素，並支援工作區強制政策。",
    },
    { id: "wiz-who", label: "給誰", example: "租戶管理員與資安團隊；一般使用者為受影響對象。" },
    {
      id: "wiz-why",
      label: "為何現在",
      example: "兩家企業客戶把 2FA 列為續約條件，合約在 Q3 到期。",
    },
  ];

  const askEl = (id: string) =>
    document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;

  /** 進度條：填充式而非離散編號，看得出「快到了」 */
  function renderWizardChrome() {
    const stepsEl = document.getElementById("wizard-steps");
    if (stepsEl) {
      stepsEl.setAttribute("aria-valuenow", String(Math.min(wizStep + 1, WIZ_MAX)));
      stepsEl.innerHTML = Array.from({ length: WIZ_MAX }, (_, i) => {
        const state = i < wizStep ? "done" : i === wizStep ? "on" : "";
        return `<span class="ask-seg ${state}"></span>`;
      }).join("");
    }
    const modeLabel = document.getElementById("wiz-mode-label");
    if (modeLabel) {
      modeLabel.textContent =
        wizStep >= WIZ_MAX
          ? beginnerPath
            ? "建立後新手教練會在編輯台逐節帶你寫。"
            : "答不出來的欄位進編輯台再補就好。"
          : `第 ${wizStep + 1} 題 / 共 3 · 約還需 ${Math.max(1, (WIZ_MAX - wizStep) * 30)} 秒`;
    }
  }

  function renderConfirmSummary() {
    const dl = document.getElementById("wiz-confirm-dl");
    if (!dl) return;
    const val = (id: string) => askEl(id)?.value.trim() || "";
    const what = val("wiz-what");
    const rows: [string, string][] = [
      ["標題", val("new-title") || what || "（未填）"],
      ["做什麼", what || "（跳過了 — 進編輯台再補）"],
      ["給誰", val("wiz-who") || "（跳過了 — 進編輯台再補）"],
      ["為何現在", val("wiz-why") || "（跳過了 — 進編輯台再補）"],
    ];
    dl.innerHTML = rows
      .map(
        ([k, v]) =>
          `<div class="wiz-confirm-row"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`,
      )
      .join("");
  }

  function setWizardStep(step: number) {
    wizStep = Math.max(0, Math.min(WIZ_MAX, step));
    document.querySelectorAll(".wizard-pane").forEach((p) => {
      (p as HTMLElement).hidden = Number((p as HTMLElement).dataset.pane) !== wizStep;
    });
    renderWizardChrome();
    if (wizStep === WIZ_MAX) renderConfirmSummary();

    const prev = document.getElementById("wizard-prev") as HTMLButtonElement | null;
    const next = document.getElementById("wizard-next") as HTMLButtonElement | null;
    const skip = document.getElementById("wizard-skip") as HTMLButtonElement | null;
    const create = document.getElementById("modal-create") as HTMLButtonElement | null;
    if (prev) prev.hidden = wizStep === 0;
    if (next) {
      next.hidden = wizStep === WIZ_MAX;
      next.textContent = wizStep === WIZ_MAX - 1 ? "看一下再建立" : "下一題";
    }
    if (skip) skip.hidden = wizStep === WIZ_MAX;
    if (create) create.hidden = wizStep !== WIZ_MAX;

    // 焦點直接落在輸入框：ADHD 少一個「現在要點哪裡」的判斷
    if (wizStep < WIZ_MAX) {
      const el = askEl(ASK[wizStep]!.id);
      window.setTimeout(() => el?.focus(), 30);
    }
  }

  /**
   * 草稿：中途關掉不該懲罰使用者。ADHD 的中斷率高，
   * 丟掉半份輸入等於保證下次不會再開這個對話框。
   */
  function saveDraft() {
    try {
      const data: Record<string, string> = {};
      for (const a of ASK) data[a.id] = askEl(a.id)?.value ?? "";
      data["new-title"] = (askEl("new-title")?.value ?? "");
      if (Object.values(data).every((v) => !v.trim())) {
        localStorage.removeItem(DRAFT_KEY);
        return;
      }
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ step: wizStep, data }));
      const flag = document.getElementById("ask-draft");
      if (flag) flag.hidden = false;
    } catch {
      /* private mode */
    }
  }

  function loadDraft(): boolean {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return false;
      const { step, data } = JSON.parse(raw) as { step: number; data: Record<string, string> };
      for (const [id, v] of Object.entries(data)) {
        const el = askEl(id);
        if (el) el.value = v;
      }
      setWizardStep(Math.min(step ?? 0, WIZ_MAX));
      const flag = document.getElementById("ask-draft");
      if (flag) flag.hidden = false;
      return true;
    } catch {
      return false;
    }
  }

  function clearDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    const flag = document.getElementById("ask-draft");
    if (flag) flag.hidden = true;
  }

  /** 不擋。空著也能往下走，缺的欄位在編輯台由 gate 接手。 */
  function validateWizardStep(): boolean {
    return true;
  }

  function resetWizard() {
    for (const id of [...ASK.map((a) => a.id), "new-title"]) {
      const el = askEl(id);
      if (el) el.value = "";
    }
    const target = document.getElementById("new-target") as HTMLInputElement | null;
    if (target) target.value = "Q3 · 2026-09";
    const flag = document.getElementById("ask-draft");
    if (flag) flag.hidden = true;
    setWizardStep(0);
  }

  function openWizard(asBeginner: boolean) {
    if (!canEditContent(store.get().currentUser)) {
      toast("核准人員無法新建或編輯內文");
      return;
    }
    beginnerPath = asBeginner;
    setBeginnerMode(asBeginner);
    resetWizard();
    if (loadDraft()) toast("接續上次未完成的草稿");
    openModal("modal");
  }

  // 領域下拉：選項來自 src/data/domains/ 的 .md，加一個檔就多一個選項
  for (const id of ["new-domain", "import-domain"]) {
    const sel = document.getElementById(id) as HTMLSelectElement | null;
    if (sel && !sel.options.length) {
      sel.innerHTML = listDomains()
        .map(
          (d) =>
            `<option value="${escapeHtml(d.name)}"${d.name === DEFAULT_DOMAIN ? " selected" : ""}>${escapeHtml(d.displayName)}</option>`,
        )
        .join("");
    }
  }

  // 每次輸入都存草稿
  for (const a of ASK) {
    document.getElementById(a.id)?.addEventListener("input", saveDraft);
  }
  document.getElementById("new-title")?.addEventListener("input", saveDraft);

  // 「不知道怎麼寫？先用這句」— 填入後直接把游標放到結尾，讓人接著改
  document.querySelectorAll<HTMLButtonElement>(".ask-fill").forEach((btn, i) => {
    btn.addEventListener("click", () => {
      const a = ASK[i];
      if (!a) return;
      const el = askEl(a.id);
      if (!el) return;
      el.value = a.example;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      saveDraft();
      toast("放進去了 — 直接改成你的版本");
    });
  });

  // 換題也要存 —— 只存欄位不存題號的話，接續草稿會回到第 1 題
  document.getElementById("wizard-skip")?.addEventListener("click", () => {
    setWizardStep(wizStep + 1);
    saveDraft();
  });

  document.getElementById("btn-new")?.addEventListener("click", () => openWizard(false));
  document.getElementById("btn-beginner")?.addEventListener("click", () => openWizard(true));
  document.getElementById("btn-beginner-cta")?.addEventListener("click", () => openWizard(true));
  document.getElementById("modal-close")?.addEventListener("click", () => closeModal("modal"));
  document.getElementById("modal-cancel")?.addEventListener("click", () => closeModal("modal"));
  document.getElementById("wizard-prev")?.addEventListener("click", () => {
    setWizardStep(wizStep - 1);
    saveDraft();
  });
  document.getElementById("wizard-next")?.addEventListener("click", () => {
    if (!validateWizardStep()) return;
    setWizardStep(wizStep + 1);
    saveDraft();
  });

  document.getElementById("modal-create")?.addEventListener("click", () => {
    const user = store.get().currentUser;
    if (!canEditContent(user)) {
      toast("無編輯權限");
      return;
    }
    if (!validateWizardStep()) return;

    const tpl = (document.getElementById("new-tpl") as HTMLSelectElement | null)?.value ?? "";
    const what = askEl("wiz-what")?.value.trim() ?? "";
    const who = askEl("wiz-who")?.value.trim() ?? "";
    const why = askEl("wiz-why")?.value.trim() ?? "";
    // 標題留白就用「做什麼」那句 —— 少問一題
    const title = askEl("new-title")?.value.trim() || what || "新功能規格";

    const p: Project = {
      id: `p${Date.now()}`,
      title,
      customName: undefined,
      status: "draft",
      pct: 18,
      owner: user.name,
      ownerId: user.id,
      authorId: user.id,
      authorAgentFamily: user.kind === "agent" ? user.agentFamily : null,
      mine: true,
      updated: "剛剛",
      lastFileAt: new Date().toISOString(),
      tag: tpl.includes("資安") ? "security" : tpl.includes("成長") ? "growth" : "product",
      isSample: false,
      domain:
        (document.getElementById("new-domain") as HTMLSelectElement | null)?.value || DEFAULT_DOMAIN,
    };
    store.addProject(p);
    store.setActiveProject(p.id);

    store.setSectionValues("summary", {
      what: what || title,
      who: who || user.name,
      why: why || "",
    });
    // 問題／非目標／指標刻意不在這裡問：編輯台有起手骨架與結構 gate 帶著寫
    store.updateSection("summary", { status: what || who || why ? "warn" : "empty" });
    clearDraft();

    // 按「新手引導」才開編輯台的逐節教練；按「新建」就安靜進去
    setBeginnerMode(beginnerPath);
    toast(beginnerPath ? `已建立「${title}」· 新手教練會帶你逐節寫` : `已建立「${title}」`);

    // 手動新建沒有資料夾 → 主動問一次。使用者選「稍後再說」就直接進編輯台，
    // 綁定成功則等 toast 看得到再跳頁。
    closeModal("modal");
    askForProjectFolder(p.id, title);

    const goEditor = () =>
      (location.href = beginnerPath ? "editor.html?beginner=1" : "editor.html");
    let done = false;
    const off = store.subscribe(() => {
      if (done) return;
      if (store.get().projects.find((x) => x.id === p.id)?.sourceFolder) {
        done = true;
        off();
        window.setTimeout(goEditor, 900); // 讓「已綁定」的 toast 看得到
      }
    });
    document.getElementById("pf-ask")?.addEventListener("click", (ev) => {
      if ((ev.target as HTMLElement).dataset.pf !== "later" || done) return;
      done = true;
      off();
      goEditor();
    });
  });

  // 新手 CTA：尚無自建專案時顯示
  function syncBeginnerCta() {
    const cta = document.getElementById("beginner-cta");
    if (!cta) return;
    const nonSample = store.visibleProjects().filter((p) => !p.isSample).length;
    cta.hidden = nonSample > 0;
  }

  // 初始化步驟列（關閉時也有正確 DOM）
  renderWizardChrome();

  // 側欄「＋」直接開新建精靈（非新手路徑）
  if (new URLSearchParams(location.search).get("new") === "1") {
    window.setTimeout(() => {
      if (canEditContent(store.get().currentUser)) openWizard(false);
    }, 120);
  }

  // 側欄「＋」選「專案匯入」
  if (new URLSearchParams(location.search).get("import") === "1") {
    window.setTimeout(() => {
      (document.getElementById("btn-import") as HTMLButtonElement | null)?.click();
    }, 150);
  }

  // 正式版首次引導選「新手流程」→ 自動開啟精靈
  if (new URLSearchParams(location.search).get("beginner") === "1") {
    setBeginnerMode(true);
    window.setTimeout(() => {
      if (canEditContent(store.get().currentUser)) openWizard(true);
    }, 200);
  }

  // 正式版：隱藏「範例文件」切換（無示範內容）
  if (APP_VARIANT === "prod") {
    document.getElementById("btn-toggle-samples")?.remove();
  }

  // 測試版標題列可顯示變體提示
  if (APP_VARIANT === "test") {
    const meta = document.querySelector(".titlebar-meta");
    if (meta && !document.getElementById("variant-badge")) {
      const b = document.createElement("span");
      b.id = "variant-badge";
      b.className = "pill pill-warn";
      b.textContent = "TEST";
      b.title = "測試版：多筆範例專案";
      meta.insertBefore(b, meta.firstChild);
    }
  }

  document.getElementById("btn-toggle-samples")?.addEventListener("click", () => {
    const next = !store.get().showSamples;
    store.setShowSamples(next);
    toast(next ? "已展示範例文件與示範內文" : "已移除範例文件內容（可再一鍵還原）");
    render();
  });

  document.getElementById("btn-export-md")?.addEventListener("click", () => {
    if (!canExport(store.get().currentUser)) {
      toast("無權匯出");
      return;
    }
    exportMarkdownFile(store.get());
  });
  document.getElementById("btn-export-json")?.addEventListener("click", () => {
    if (!canExport(store.get().currentUser)) {
      toast("無權匯出");
      return;
    }
    exportJsonFile(store.get());
  });
  document.getElementById("btn-export-html")?.addEventListener("click", () => {
    if (!canExport(store.get().currentUser)) {
      toast("無權匯出");
      return;
    }
    exportHtmlFile(store.get());
  });

  document.getElementById("btn-export-openspec")?.addEventListener("click", () => {
    if (!canExport(store.get().currentUser)) {
      toast("無權匯出");
      return;
    }
    const st = store.get();
    const active =
      st.projects.find((p) => p.id === st.activeProjectId) ?? st.projects[0] ?? null;
    exportOpenspecBundle(st, active);
    toast("已匯出 OpenSpec：PRD.md · tasks.md · proposal.md");
  });

  document.getElementById("btn-export-profile")?.addEventListener("click", () => {
    if (!canExport(store.get().currentUser)) {
      toast("無權匯出");
      return;
    }
    const st = store.get();
    const active = st.projects.find((p) => p.id === st.activeProjectId) ?? st.projects[0] ?? null;
    exportProjectProfile(st, active);
  });

  /* ─── tasks.md 回讀（OpenSpec 的另一半） ─── */
  document.getElementById("btn-read-tasks")?.addEventListener("click", () => {
    if (!canEditContent(store.get().currentUser)) {
      toast("無權修改檢查項");
      return;
    }
    (document.getElementById("tasks-readback-input") as HTMLInputElement | null)?.click();
  });

  document.getElementById("tasks-readback-input")?.addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ""; // 讓同一個檔案可以再選一次
    if (!file) return;

    const md = await file.text();
    const report = parseTasksReadback(md, store.get());
    showTasksReadbackModal(file.name, report);
  });

  /**
   * 先預覽再套用。回讀會覆寫使用者手動勾過的檢查項，靜默執行不可接受。
   */
  function showTasksReadbackModal(fileName: string, r: TasksReadback) {
    document.getElementById("tasks-readback-modal")?.remove();

    const rows = r.changes
      .map(
        (c) => `<tr>
          <td>${escapeHtml(c.sectionLabel)}</td>
          <td>${escapeHtml(c.checkLabel)}</td>
          <td class="mono">${c.from ? "✔" : "○"} → <strong>${c.to ? "✔" : "○"}</strong></td>
        </tr>`,
      )
      .join("");

    const notes: string[] = [];
    if (!r.usedAnchors && r.changes.length)
      notes.push("這份檔案沒有回讀錨點（舊版匯出），改用文字比對——請對照上表確認。");
    if (r.ignoredApprovals)
      notes.push(`簽核段 ${r.ignoredApprovals} 行已忽略：簽核是人的決定，不從檔案回讀。`);
    if (r.unmatched.length)
      notes.push(`${r.unmatched.length} 行對不到檢查項，已跳過：${r.unmatched.slice(0, 3).map(escapeHtml).join("、")}${r.unmatched.length > 3 ? " …" : ""}`);

    const back = document.createElement("div");
    back.className = "modal-back open";
    back.id = "tasks-readback-modal";
    back.innerHTML = `
      <div class="modal" role="dialog" aria-labelledby="trb-title" aria-modal="true">
        <header>
          <h3 id="trb-title">回讀 ${escapeHtml(fileName)}</h3>
          <button type="button" class="btn btn-ghost btn-sm" data-trb="cancel">關閉</button>
        </header>
        <div class="body">
          ${
            r.changes.length
              ? `<p class="sub">將變更 ${r.changes.length} 個檢查項（另有 ${r.unchanged} 項已一致）。</p>
                 <table class="trb-table"><thead><tr><th>章節</th><th>檢查項</th><th>變更</th></tr></thead><tbody>${rows}</tbody></table>`
              : `<p class="sub">沒有需要變更的檢查項（${r.unchanged} 項已一致）。</p>`
          }
          ${notes.length ? `<ul class="trb-notes">${notes.map((n) => `<li>${n}</li>`).join("")}</ul>` : ""}
        </div>
        <footer>
          <button type="button" class="btn" data-trb="cancel">取消</button>
          <button type="button" class="btn btn-primary" data-trb="apply" ${r.changes.length ? "" : "disabled"}>套用 ${r.changes.length} 項</button>
        </footer>
      </div>
    `;
    document.body.appendChild(back);

    back.querySelectorAll('[data-trb="cancel"]').forEach((b) =>
      b.addEventListener("click", () => back.remove()),
    );
    back.querySelector('[data-trb="apply"]')?.addEventListener("click", () => {
      applyTasksReadback(r.changes);
      back.remove();
      toast(`已回讀 ${r.changes.length} 個檢查項`);
      render();
    });
  }

  /* ─── 專案資料夾匯入 ─── */
  let scanResult: FolderScanResult | null = null;
  let candidates: ProjectCandidate[] = [];

  function importErr(msg: string) {
    const el = document.getElementById("import-err");
    if (el) el.textContent = msg;
  }

  function renderImportModal() {
    const empty = document.getElementById("import-empty");
    const result = document.getElementById("import-result");
    const bar = document.getElementById("import-summary-bar");
    const list = document.getElementById("import-candidates");
    const confirmBtn = document.getElementById("import-confirm") as HTMLButtonElement | null;
    const sub = document.getElementById("import-subtitle");

    if (!scanResult || !candidates.length) {
      if (empty) empty.hidden = false;
      if (result) result.hidden = true;
      if (confirmBtn) confirmBtn.disabled = true;
      if (sub) sub.textContent = "選擇資料夾後自動偵測 PRD 相關文件";
      return;
    }

    if (empty) empty.hidden = true;
    if (result) result.hidden = false;
    if (sub) {
      sub.textContent = `資料夾「${scanResult.folderName}」· 掃描 ${scanResult.fileCount} 個文字檔 · ${candidates.length} 個候選專案`;
    }

    const selected = candidates.filter((c) => c.selected);
    const avg =
      selected.length === 0
        ? 0
        : Math.round(selected.reduce((a, c) => a + c.overallScore, 0) / selected.length);
    if (bar) {
      bar.innerHTML = `
        <div class="import-bar-stats">
          <span>已勾選 <strong>${selected.length}</strong> / ${candidates.length}</span>
          <span>平均評分 <strong class="score-tone-${scoreTone(avg)}">${avg}</strong></span>
          <span class="hint">必要欄位：PRD · 問題 · 目標 · 指標</span>
        </div>`;
    }

    if (list) {
      const shortName = (name: string, max = 36) => {
        if (name.length <= max) return name;
        const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
        const base = ext ? name.slice(0, -ext.length) : name;
        const keep = Math.max(8, max - ext.length - 1);
        return `${base.slice(0, keep)}…${ext}`;
      };
      const slotRow = (row: (typeof candidates)[0]["slots"][0]) => {
        const st = row.status === "ok" ? "ok" : row.status === "warn" ? "warn" : "miss";
        const full = row.match?.file.name ?? "";
        const file = row.match
          ? escapeHtml(shortName(full))
          : row.required
            ? "未找到"
            : "—";
        const sc = row.match ? `${row.match.contentScore}` : "";
        const title = row.match
          ? `${SLOT_META[row.slot].label} · ${full} · ${row.match.contentScore}分`
          : SLOT_META[row.slot].sectionHint;
        const mark =
          row.status === "ok" ? "✓" : row.status === "warn" ? "!" : row.required ? "×" : "·";
        return `<div class="import-slot import-slot-${st}" title="${escapeHtml(title)}">
          <span class="import-slot-mark" aria-hidden="true">${mark}</span>
          <span class="import-slot-body">
            <span class="import-slot-label">${escapeHtml(row.label)}${row.required ? "" : " <em>選用</em>"}</span>
            <span class="import-slot-file">${file}${sc ? ` · ${sc}分` : ""}</span>
          </span>
        </div>`;
      };

      list.innerHTML = candidates
        .map((c) => {
          const tone = scoreTone(c.overallScore);
          const required = c.slots.filter((s) => s.required);
          const optional = c.slots.filter((s) => !s.required && s.status !== "missing");
          const missingOpt = c.slots.filter((s) => !s.required && s.status === "missing").length;
          const reqHtml = required.map(slotRow).join("");
          const optHtml = optional.map(slotRow).join("");
          const unmapped =
            c.unmapped.length > 0
              ? `<details class="import-unmapped"><summary>其他檔案 ${c.unmapped.length}</summary>
                  <ul>${c.unmapped
                    .slice(0, 40)
                    .map((f) => `<li title="${escapeHtml(f.path)}">${escapeHtml(shortName(f.name, 42))}</li>`)
                    .join("")}${
                      c.unmapped.length > 40
                        ? `<li class="muted">…另有 ${c.unmapped.length - 40} 個</li>`
                        : ""
                    }</ul>
                </details>`
              : "";
          return `
            <article class="import-card${c.selected ? " selected" : ""}" data-temp="${escapeHtml(c.tempId)}" role="listitem">
              <header class="import-card-head">
                <label class="import-check">
                  <input type="checkbox" data-sel="${escapeHtml(c.tempId)}" ${c.selected ? "checked" : ""} />
                  <strong title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</strong>
                </label>
                <div class="import-scores">
                  <span class="score-pill score-tone-${tone}" title="綜合評分">${c.overallScore}</span>
                  <span class="import-cov">覆蓋 ${c.coveragePct}%</span>
                </div>
              </header>
              <div class="import-progress" aria-label="進度 ${c.progressPct}%">
                <div class="import-progress-bar"><i style="width:${c.progressPct}%"></i></div>
                <span class="import-pct">${c.progressPct}%</span>
              </div>
              <div class="import-section-label">必要欄位</div>
              <div class="import-slots import-slots--required">${reqHtml}</div>
              ${
                optHtml || missingOpt
                  ? `<details class="import-optional">
                      <summary>選用欄位（已對應 ${optional.length}${missingOpt ? ` · 缺 ${missingOpt}` : ""}）</summary>
                      <div class="import-slots import-slots--optional">${optHtml || `<p class="hint">尚無對應檔</p>`}</div>
                    </details>`
                  : ""
              }
              ${unmapped}
            </article>`;
        })
        .join("");

      list.querySelectorAll<HTMLInputElement>("input[data-sel]").forEach((inp) => {
        inp.addEventListener("change", () => {
          const id = inp.dataset.sel!;
          const c = candidates.find((x) => x.tempId === id);
          if (c) c.selected = inp.checked;
          renderImportModal();
        });
      });
    }

    if (confirmBtn) confirmBtn.disabled = selected.length === 0;
  }

  type NativePayload = {
    type: string;
    folderName?: string;
    folderPath?: string;
    files?: NativeFolderFile[];
    message?: string;
  };

  function applyScanResult(result: FolderScanResult) {
    scanResult = result;
    candidates = result.candidates.map((c) => ({ ...c, selected: true }));
    if (!candidates.length || result.fileCount === 0) {
      importErr("此資料夾沒有可讀的 Markdown／文字檔（.md / .txt）");
      candidates = [];
    } else {
      importErr("");
    }
    renderImportModal();
    openModal("modal-import");
    if (result.fileCount > 0) {
      toast(`掃描完成：${result.fileCount} 檔 · ${candidates.length} 候選專案`);
    }
  }

  async function handleFolderPicked(fileList: FileList | null) {
    importErr("");
    if (!fileList?.length) {
      importErr("未選擇任何檔案（若在 App 內請改用原生選夾）");
      return;
    }
    toast("掃描資料夾中…");
    try {
      const first = fileList[0] as File & { webkitRelativePath?: string };
      const folderHint = first.webkitRelativePath?.split("/")[0];
      const result = await scanFolderFromFileList(fileList, folderHint);
      applyScanResult(result);
    } catch (e) {
      importErr(e instanceof Error ? e.message : "掃描失敗");
      toast("掃描失敗");
    }
  }

  function handleNativeFolderPayload(payload: NativePayload) {
    if (!payload || typeof payload !== "object") return;

    /**
     * Agent 交接：Skill 在終端問完三題、把資料夾與 seed 檔寫好後丟 handoff 檔，
     * App 啟動／回前景時讀到就走到這裡。直接掃描＋匯入＋跳編輯台 ——
     * 使用者不必自己去找「專案匯入」按鈕。
     */
    if (payload.type === "agentHandoff") {
      toast("agent 交接進來了，正在匯入…");
      try {
        const files = Array.isArray(payload.files) ? payload.files : [];
        const result = scanFromNativeFolder(payload.folderName || "agent 專案", files, payload.folderPath ?? "");
        const res = store.importProjectCandidates(
          result.candidates.map((c) => ({ ...c, selected: true })),
          payload.folderName || "agent 專案",
        );
        const first = res.projectIds[0];
        if (first) {
          store.setActiveProject(first);
          setBeginnerMode(true);
          window.setTimeout(() => (location.href = "editor.html"), 700);
        } else {
          applyScanResult(result);
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : "agent 交接匯入失敗");
      }
      return;
    }

    // 綁定專案資料夾走另一條路（不掃描評分），交給 project-folder.ts 的 callback
    if (payload.type === "projectFolderPickResult") {
      (window as Window & {
        __anchorlineProjectFolderResult?: (p: NativePayload) => void;
      }).__anchorlineProjectFolderResult?.(payload);
      return;
    }
    if (payload.type === "folderPickCancelled") {
      toast("已取消選擇資料夾");
      return;
    }
    if (payload.type === "folderPickError") {
      importErr(payload.message ?? "原生選夾失敗");
      toast(payload.message ?? "選夾失敗");
      return;
    }
    if (payload.type === "folderPickResult") {
      toast("掃描資料夾中…");
      try {
        const files = Array.isArray(payload.files) ? payload.files : [];
        const result = scanFromNativeFolder(payload.folderName || "匯入資料夾", files, payload.folderPath ?? "");
        applyScanResult(result);
      } catch (e) {
        importErr(e instanceof Error ? e.message : "掃描失敗");
        toast("掃描失敗");
      }
    }
  }

  function openFolderPicker() {
    if (!canEditContent(store.get().currentUser)) {
      toast("無編輯權限，無法匯入");
      return;
    }
    importErr("");

    // 原生資料夾選擇器
    if (isNative()) {
      toast("請在系統對話框選擇資料夾…");
      void native
        .pickFolder()
        .then((r) => {
          if (r.cancelled) return;
          handleNativeFolderPayload({
            type: "folderPickResult",
            folderName: r.folderName,
            folderPath: r.folderPath,
            files: r.files,
          });
        })
        .catch((e) => {
          console.warn("native pickFolder failed", e);
          importErr("無法開啟系統對話框，請重啟 App");
        });
      return;
    }

    // 瀏覽器 fallback：不可使用 [hidden]（會擋 dialog），改用 visually-hidden
    const input = document.getElementById("folder-import-input") as HTMLInputElement | null;
    if (!input) {
      importErr("找不到檔案選擇器。若在 App 內，請重啟 Anchorline 以載入原生橋。");
      toast("無法開啟選夾");
      return;
    }
    input.value = "";
    // 某些 WebKit 需要在同一使用者手勢內同步 click
    input.click();
    // 若 800ms 內沒有 change，提示可能被擋
    window.setTimeout(() => {
      if (!input.files?.length && !scanResult) {
        importErr(
          "瀏覽器未開啟資料夾選擇器。請在 Anchorline App 使用（原生選夾），或改用 Chrome 開 dev server。",
        );
      }
    }, 1200);
  }

  document.getElementById("btn-import")?.addEventListener("click", () => {
    scanResult = null;
    candidates = [];
    importErr("");
    renderImportModal();
    openModal("modal-import");
    // 同一 click 手勢內立刻開選夾（原生 / input 皆需）
    openFolderPicker();
  });

  document.getElementById("import-pick")?.addEventListener("click", () => openFolderPicker());
  document.getElementById("import-rescan")?.addEventListener("click", () => openFolderPicker());
  document.getElementById("import-close")?.addEventListener("click", () => closeModal("modal-import"));
  document.getElementById("import-cancel")?.addEventListener("click", () => closeModal("modal-import"));

  document.getElementById("folder-import-input")?.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    void handleFolderPicked(input.files);
  });

  document.getElementById("import-confirm")?.addEventListener("click", () => {
    importErr("");
    if (!scanResult) {
      importErr("請先選擇資料夾");
      return;
    }
    const r = store.importProjectCandidates(
      candidates,
      scanResult.folderName,
      (document.getElementById("import-domain") as HTMLSelectElement | null)?.value || DEFAULT_DOMAIN,
    );
    if (!r.ok) {
      importErr(r.reason ?? "匯入失敗");
      toast(r.reason ?? "匯入失敗");
      return;
    }
    closeModal("modal-import");
    setBeginnerMode(false);
    toast(`已匯入 ${r.projectIds.length} 個專案 · 內容各自獨立`);
    renderRailProjects();
    render();
    // 進入第一個專案的編輯畫面（獨立內容）
    location.href = "editor.html";
  });

  document.addEventListener("anchorline:project-changed", () => {
    render();
    toast("已切換目前專案（內容獨立）");
  });

  // TUI 快捷由 initRailNav 統一綁定

  render();
  store.subscribe(render);
}
