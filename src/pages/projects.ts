import { store } from "../data/store";
import { APP_VARIANT } from "../data/seed";
import { projectDisplayName, type Project, type ProjectStatus } from "../data/types";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import {
  BEGINNER_EXAMPLES,
  BEGINNER_STEPS,
  setBeginnerMode,
} from "../lib/beginner-flow";
import { exportHtmlFile, exportJsonFile, exportMarkdownFile, exportOpenspecBundle } from "../lib/export";
import { deriveFlowLayers, renderFlowStripHtml } from "../lib/flow-layers";
import {
  scanFolderFromFileList,
  scanFromNativeFolder,
  scoreTone,
  SLOT_META,
  type FolderScanResult,
  type NativeFolderFile,
  type ProjectCandidate,
} from "../lib/folder-import";
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

  const planModules = import.meta.glob("../../plans/*.md", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

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
      <span class="plan-bar-stat">完成 <em>${avg}%</em></span>
      <span class="plan-bar-stat">待辦 <em>${pending}</em></span>
      <a href="tracking.html" class="plan-bar-link">打開追蹤</a>`;
  }

  function renderFlow() {
    const host = document.getElementById("flow-strip-host");
    if (!host) return;
    const hasPlanSteps = Object.values(planModules).some((raw) =>
      /^- \[[ xXvV]\]/m.test(raw),
    );
    host.innerHTML = renderFlowStripHtml(deriveFlowLayers(store.get(), { hasPlanSteps }));
  }

  function render() {
    const tbody = document.getElementById("tbody");
    if (!tbody) return;
    const user = store.get().currentUser;
    const projects = store.visibleProjects();
    const planHits = loadPlanHits();
    renderPlanBar(planHits);

    const rows = projects.filter((p) => {
      if (filter === "mine" && !p.mine) return false;
      if (filter !== "all" && filter !== "mine" && p.status !== filter) return false;
      if (query) {
        const q = query.toLowerCase();
        return (
          p.title.toLowerCase().includes(q) ||
          p.owner.includes(query) ||
          p.tag.includes(q)
        );
      }
      return true;
    });

    const count = document.getElementById("result-count");
    if (count) count.textContent = rows.length === 0 ? "沒有項目" : `${rows.length} 個專案`;

    if (rows.length === 0) {
      tbody.innerHTML = `<div class="project-board-empty">沒有符合的專案</div>`;
      renderStats(projects);
      syncChrome();
      return;
    }

    tbody.innerHTML = rows
      .map((p) => {
        const s = STATUS[p.status];
        const barCls = p.pct >= 100 ? "ok" : "";
        const actionHref =
          p.status === "review" || p.status === "approved" || p.status === "withdrawn"
            ? "review.html"
            : "editor.html";
        const actionLabel =
          p.status === "approved"
            ? "檢視"
            : p.status === "review"
              ? "審閱"
              : p.status === "withdrawn"
                ? "抽單"
                : "繼續寫";
        const tags: string[] = [];
        if (p.isImported) tags.push(`<span class="p-tag p-tag--import">匯入</span>`);
        if (p.isSample) tags.push(`<span class="p-tag">範例</span>`);
        if (p.id === store.get().activeProjectId) tags.push(`<span class="p-tag p-tag--now">目前</span>`);
        const untrack =
          canDelete(user)
            ? `<button type="button" class="btn btn-sm btn-ghost btn-untrack" data-untrack-id="${escapeHtml(p.id)}" title="僅從工作區退出追蹤，不刪除磁碟檔案">退出追蹤</button>`
            : "";
        const display = projectDisplayName(p);
        const metaBits = [
          p.owner ? escapeHtml(p.owner) : "",
          p.updated ? escapeHtml(p.updated) : "",
        ]
          .filter(Boolean)
          .join(" · ");
        return `<article class="project-card${p.id === store.get().activeProjectId ? " is-active" : ""}" data-id="${p.id}" role="listitem">
  <div class="project-card-main">
    <div class="project-card-title-row">
      <a class="project-card-title" href="${actionHref}" data-open-project="${p.id}">${escapeHtml(display)}</a>
      <span class="pill ${s.cls}">${s.label}</span>
      ${tags.join("")}
    </div>
    <div class="project-card-meta">${metaBits || "—"}</div>
    <div class="project-card-progress">
      <div class="progress"><div class="progress-bar ${barCls}"><i style="width:${p.pct}%"></i></div></div>
      <span class="project-card-pct">${p.pct}%</span>
    </div>
  </div>
  <div class="project-card-actions">
    <a class="btn btn-primary row-action-main" href="${actionHref}" data-open-project="${p.id}">${actionLabel}</a>
    <button type="button" class="btn btn-sm btn-ghost" data-rename-project="${escapeHtml(p.id)}" title="自訂顯示名稱">重新命名</button>
    ${untrack}
  </div>
</article>`;
      })
      .join("");

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
              untrackBtn.textContent = "退出追蹤";
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
      }
    });
  }

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
    const MIGRATE_KEY = "specforge:clear-split-import-v1";
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
  const WIZ_MAX = BEGINNER_STEPS.length - 1;
  let beginnerPath = true; // true=新手引導；false=快速新建（仍走同精靈，可跳過說明）

  function renderWizardChrome() {
    const stepsEl = document.getElementById("wizard-steps");
    if (stepsEl) {
      stepsEl.innerHTML = BEGINNER_STEPS.map(
        (s) =>
          `<span data-ws="${s.n}" class="${s.n === wizStep ? "on" : s.n < wizStep ? "done" : ""}">${s.n + 1} ${escapeHtml(s.label)}</span>`,
      ).join("");
    }
    const step = BEGINNER_STEPS[wizStep];
    const titleEl = document.getElementById("wiz-coach-title");
    const bodyEl = document.getElementById("wiz-coach-body");
    const tipsEl = document.getElementById("wiz-coach-tips");
    if (step && titleEl) titleEl.textContent = step.title;
    if (step && bodyEl) bodyEl.textContent = step.coach;
    if (step && tipsEl) {
      tipsEl.innerHTML = step.tips.map((t) => `<li>${escapeHtml(t)}</li>`).join("");
    }
    const modeLabel = document.getElementById("wiz-mode-label");
    if (modeLabel) {
      modeLabel.textContent = beginnerPath
        ? "新手引導 · 7 步完成可送審骨架"
        : "快速新建 · 同一套骨架，可略過提示直接填";
    }
  }

  function renderConfirmSummary() {
    const dl = document.getElementById("wiz-confirm-dl");
    if (!dl) return;
    const title =
      (document.getElementById("new-title") as HTMLInputElement | null)?.value.trim() || "（未填標題）";
    const what =
      (document.getElementById("wiz-what") as HTMLInputElement | null)?.value.trim() || "—";
    const who =
      (document.getElementById("wiz-who") as HTMLInputElement | null)?.value.trim() || "—";
    const why =
      (document.getElementById("wiz-why") as HTMLTextAreaElement | null)?.value.trim() || "—";
    const ngs = ["wiz-ng1", "wiz-ng2", "wiz-ng3"]
      .map((id) => (document.getElementById(id) as HTMLInputElement).value.trim())
      .filter(Boolean);
    const metrics =
      (document.getElementById("wiz-metrics") as HTMLTextAreaElement | null)?.value.trim() || "—";
    const rows: [string, string][] = [
      ["標題", title],
      ["做什麼", what],
      ["給誰", who],
      ["為何現在", why],
      ["Non-Goals", ngs.length ? ngs.map((x, i) => `${i + 1}. ${x}`).join("\n") : "（未滿 3 條）"],
      ["成功指標", metrics],
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
      const n = Number((p as HTMLElement).dataset.pane);
      (p as HTMLElement).hidden = n !== wizStep;
    });
    renderWizardChrome();
    if (wizStep === WIZ_MAX) renderConfirmSummary();
    const prev = document.getElementById("wizard-prev") as HTMLButtonElement | null;
    const next = document.getElementById("wizard-next") as HTMLButtonElement | null;
    const create = document.getElementById("modal-create") as HTMLButtonElement | null;
    if (prev) prev.hidden = wizStep === 0;
    if (next) next.hidden = wizStep === WIZ_MAX;
    if (create) create.hidden = wizStep !== WIZ_MAX;
  }

  function validateWizardStep(): boolean {
    if (wizStep === 1) {
      const title = (document.getElementById("new-title") as HTMLInputElement).value.trim();
      const what = (document.getElementById("wiz-what") as HTMLInputElement).value.trim();
      if (!title || !what) {
        toast("請填標題與「做什麼」");
        return false;
      }
    }
    if (wizStep === 2) {
      const who = (document.getElementById("wiz-who") as HTMLInputElement).value.trim();
      const why = (document.getElementById("wiz-why") as HTMLTextAreaElement).value.trim();
      if (!who || !why) {
        toast("請填「給誰」與「為何現在」");
        return false;
      }
    }
    if (wizStep === 3) {
      const problem = (document.getElementById("wiz-problem") as HTMLTextAreaElement).value.trim();
      if (problem.length < 20) {
        toast("問題陳述請再具體一些（至少約 20 字）");
        return false;
      }
    }
    if (wizStep === 4) {
      const ngs = ["wiz-ng1", "wiz-ng2", "wiz-ng3"].map(
        (id) => (document.getElementById(id) as HTMLInputElement).value.trim(),
      );
      if (ngs.filter(Boolean).length < 3) {
        toast("Non-Goals 需滿 3 條（送審結構契約）");
        return false;
      }
    }
    if (wizStep === 5) {
      const metrics = (document.getElementById("wiz-metrics") as HTMLTextAreaElement).value.trim();
      if (!metrics) {
        toast("請至少填一條成功指標");
        return false;
      }
    }
    return true;
  }

  function resetWizard() {
    const ids = [
      "new-title",
      "wiz-what",
      "wiz-who",
      "wiz-why",
      "wiz-problem",
      "wiz-ng1",
      "wiz-ng2",
      "wiz-ng3",
      "wiz-goals",
      "wiz-metrics",
    ];
    for (const id of ids) {
      const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
      if (el) el.value = "";
    }
    const target = document.getElementById("new-target") as HTMLInputElement | null;
    if (target) target.value = "Q3 · 2026-09";
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
    if (!asBeginner) {
      // 快速新建：跳過說明，直達一句話
      setWizardStep(1);
    }
    openModal("modal");
  }

  document.getElementById("btn-new")?.addEventListener("click", () => openWizard(false));
  document.getElementById("btn-beginner")?.addEventListener("click", () => openWizard(true));
  document.getElementById("btn-beginner-cta")?.addEventListener("click", () => openWizard(true));
  document.getElementById("modal-close")?.addEventListener("click", () => closeModal("modal"));
  document.getElementById("modal-cancel")?.addEventListener("click", () => closeModal("modal"));
  document.getElementById("wizard-prev")?.addEventListener("click", () => setWizardStep(wizStep - 1));
  document.getElementById("wizard-next")?.addEventListener("click", () => {
    if (!validateWizardStep()) return;
    setWizardStep(wizStep + 1);
  });

  // 範例句填入
  document.querySelectorAll("[data-fill]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = (btn as HTMLElement).dataset.fill;
      const ex = BEGINNER_EXAMPLES;
      if (kind === "oneliner") {
        const t = document.getElementById("new-title") as HTMLInputElement;
        const w = document.getElementById("wiz-what") as HTMLInputElement;
        if (t && !t.value.trim()) t.value = ex.title;
        if (w) w.value = ex.what;
      } else if (kind === "who") {
        const who = document.getElementById("wiz-who") as HTMLInputElement;
        const why = document.getElementById("wiz-why") as HTMLTextAreaElement;
        if (who) who.value = ex.who;
        if (why) why.value = ex.why;
      } else if (kind === "problem") {
        const p = document.getElementById("wiz-problem") as HTMLTextAreaElement;
        if (p) p.value = ex.problem;
      } else if (kind === "goals") {
        (document.getElementById("wiz-ng1") as HTMLInputElement).value = ex.ng1;
        (document.getElementById("wiz-ng2") as HTMLInputElement).value = ex.ng2;
        (document.getElementById("wiz-ng3") as HTMLInputElement).value = ex.ng3;
        (document.getElementById("wiz-goals") as HTMLTextAreaElement).value = ex.goals;
      } else if (kind === "metrics") {
        (document.getElementById("wiz-metrics") as HTMLTextAreaElement).value = ex.metrics;
      }
      toast("已填入範例句，請改成你的場景");
    });
  });

  document.getElementById("modal-create")?.addEventListener("click", () => {
    const user = store.get().currentUser;
    if (!canEditContent(user)) {
      toast("無編輯權限");
      return;
    }
    if (!validateWizardStep()) return;

    const title =
      (document.getElementById("new-title") as HTMLInputElement | null)?.value.trim() ||
      "新功能規格";
    const tpl = (document.getElementById("new-tpl") as HTMLSelectElement | null)?.value ?? "";
    const what = (document.getElementById("wiz-what") as HTMLInputElement).value.trim();
    const who = (document.getElementById("wiz-who") as HTMLInputElement).value.trim();
    const why = (document.getElementById("wiz-why") as HTMLTextAreaElement).value.trim();
    const problem = (document.getElementById("wiz-problem") as HTMLTextAreaElement).value.trim();
    const ngs = ["wiz-ng1", "wiz-ng2", "wiz-ng3"]
      .map((id) => (document.getElementById(id) as HTMLInputElement).value.trim())
      .filter(Boolean);
    const goals = (document.getElementById("wiz-goals") as HTMLTextAreaElement).value.trim();
    const metrics = (document.getElementById("wiz-metrics") as HTMLTextAreaElement).value.trim();

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
    };
    store.addProject(p);
    store.setActiveProject(p.id);

    store.setSectionValues("summary", {
      what: what || title,
      who: who || user.name,
      why: why || "",
    });
    if (problem) store.setSectionField("problem", "problem", problem);
    store.setSectionValues("goals", {
      goals: goals || `• ${what || title}`,
      nongoals: ngs.map((x) => `• ${x}`).join("\n"),
    });
    if (metrics) store.setSectionField("metrics", "m1", metrics);
    store.updateSection("summary", { status: "warn" });
    store.updateSection("problem", { status: problem ? "warn" : "empty" });
    store.updateSection("goals", { status: "warn" });
    store.updateSection("metrics", { status: metrics ? "warn" : "empty" });

    setBeginnerMode(true);
    toast(beginnerPath ? `已建立「${title}」· 進入新手教練編輯` : `已建立「${title}」`);

    // 手動新建沒有資料夾 → 主動問一次。使用者選「稍後再說」就直接進編輯台，
    // 綁定成功則等 toast 看得到再跳頁。
    closeModal("modal");
    askForProjectFolder(p.id, title);

    const goEditor = () => location.href = "editor.html?beginner=1";
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
    toast("已下載 Markdown");
  });
  document.getElementById("btn-export-json")?.addEventListener("click", () => {
    if (!canExport(store.get().currentUser)) {
      toast("無權匯出");
      return;
    }
    exportJsonFile(store.get());
    toast("已下載 JSON 備份");
  });
  document.getElementById("btn-export-html")?.addEventListener("click", () => {
    if (!canExport(store.get().currentUser)) {
      toast("無權匯出");
      return;
    }
    exportHtmlFile(store.get());
    toast("已下載 HTML（可列印）");
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
    // 綁定專案資料夾走另一條路（不掃描評分），交給 project-folder.ts 的 callback
    if (payload.type === "projectFolderPickResult") {
      (window as Window & {
        __specforgeProjectFolderResult?: (p: NativePayload) => void;
      }).__specforgeProjectFolderResult?.(payload);
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
        const result = scanFromNativeFolder(payload.folderName || "匯入資料夾", files);
        applyScanResult(result);
      } catch (e) {
        importErr(e instanceof Error ? e.message : "掃描失敗");
        toast("掃描失敗");
      }
    }
  }

  /** SpecForge.app 注入 window.__SPECFORGE_NATIVE__ + webkit.messageHandlers.specforge */
  function hasNativeFolderPicker(): boolean {
    const w = window as Window & {
      __SPECFORGE_NATIVE__?: boolean;
      __specforgeHasNativeFolder?: boolean;
      webkit?: { messageHandlers?: { specforge?: { postMessage: (m: unknown) => void } } };
    };
    return Boolean(
      w.__SPECFORGE_NATIVE__ ||
        w.__specforgeHasNativeFolder ||
        w.webkit?.messageHandlers?.specforge,
    );
  }

  function openFolderPicker() {
    if (!canEditContent(store.get().currentUser)) {
      toast("無編輯權限，無法匯入");
      return;
    }
    importErr("");

    const w = window as Window & {
      __specforgeNativeFolderResult?: (p: NativePayload) => void;
      webkit?: { messageHandlers?: { specforge?: { postMessage: (m: unknown) => void } } };
    };

    // 優先原生 NSOpenPanel（macOS App）
    if (hasNativeFolderPicker() && w.webkit?.messageHandlers?.specforge) {
      w.__specforgeNativeFolderResult = handleNativeFolderPayload;
      try {
        w.webkit.messageHandlers.specforge.postMessage({ action: "pickFolder" });
        toast("請在系統對話框選擇資料夾…");
        return;
      } catch (e) {
        console.warn("native pickFolder failed, fallback to input", e);
      }
    }

    // 瀏覽器 fallback：不可使用 [hidden]（會擋 dialog），改用 visually-hidden
    const input = document.getElementById("folder-import-input") as HTMLInputElement | null;
    if (!input) {
      importErr("找不到檔案選擇器。若在 App 內，請重啟 SpecForge 以載入原生橋。");
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
          "瀏覽器未開啟資料夾選擇器。請在 SpecForge App 使用（原生選夾），或改用 Chrome 開 dev server。",
        );
      }
    }, 1200);
  }

  // 原生也可能從選單 ⌘⇧O 觸發，需監聽全域 callback / event
  (window as Window & { __specforgeNativeFolderResult?: (p: NativePayload) => void }).__specforgeNativeFolderResult =
    handleNativeFolderPayload;
  window.addEventListener("specforge-native", ((e: CustomEvent<NativePayload>) => {
    handleNativeFolderPayload(e.detail);
  }) as EventListener);

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
    const r = store.importProjectCandidates(candidates, scanResult.folderName);
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

  document.addEventListener("specforge:project-changed", () => {
    render();
    toast("已切換目前專案（內容獨立）");
  });

  // TUI 快捷由 initRailNav 統一綁定

  render();
  store.subscribe(render);
}
