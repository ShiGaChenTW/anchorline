import { store } from "../data/store";
import type { Project, ProjectStatus } from "../data/types";
import { bindLogout, requireAuth, roleBadge } from "../lib/auth";
import { exportHtmlFile, exportJsonFile, exportMarkdownFile, exportOpenspecBundle } from "../lib/export";
import { deriveFlowLayers, renderFlowStripHtml } from "../lib/flow-layers";
import { initHelpOverlay } from "../lib/help-overlay";
import { parsePlanMeta, planProgressPct, type PlanMeta } from "../lib/plan-parser";
import { canDelete, canEditContent, canExport } from "../lib/permissions";
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
  bindLogout();
  initHelpOverlay();

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
    updateUserRailFooter({
      name: u.name,
      role: `${roleBadge(u.accessRole)} · ${u.title}`,
      avatar: u.avatar,
    });
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

  /** 依標題／tag／檔名模糊對應 plan（簽核狀態仍以 case 為準，不覆寫） */
  function matchPlan(project: Project, plans: PlanHit[]): PlanHit | null {
    if (!plans.length) return null;
    let best: PlanHit | null = null;
    let bestScore = 0;
    const title = project.title.toLowerCase();
    const tag = project.tag.toLowerCase();
    const id = project.id.toLowerCase();
    for (const pl of plans) {
      let score = 0;
      const pt = pl.meta.title.toLowerCase();
      const pn = pl.name.toLowerCase();
      if (pt && (pt.includes(title.slice(0, 6)) || title.includes(pt.slice(0, 6)))) score += 4;
      if (pn.includes(tag) || pn.includes(id)) score += 3;
      if (project.isSample && pn.includes("prod-app")) score += 1;
      if (project.status === "review" && pl.meta.status.includes("進行")) score += 1;
      if (score > bestScore) {
        bestScore = score;
        best = pl;
      }
    }
    // 無明確對應時：焦點專案掛「最新一筆有 steps 的 plan」作工作區提示
    if (bestScore < 2) {
      if (project.id === store.get().activeProjectId || project.id === "p1") {
        return plans.find((p) => p.meta.total_steps > 0) ?? plans[0] ?? null;
      }
      return null;
    }
    return best;
  }

  function renderPlanBar(plans: PlanHit[]) {
    const bar = document.getElementById("plan-workspace-bar");
    if (!bar) return;
    if (!plans.length) {
      bar.innerHTML = `工作區計劃：0 檔 · <a href="tracking.html" style="color:var(--accent)">開啟追蹤</a> · <span class="muted">bun run track</span>`;
      return;
    }
    const withSteps = plans.filter((p) => p.meta.total_steps > 0);
    const avg =
      withSteps.length === 0
        ? 0
        : Math.round(withSteps.reduce((a, p) => a + p.pct, 0) / withSteps.length);
    const pending = withSteps.reduce((a, p) => a + p.meta.pending_steps, 0);
    bar.innerHTML = `工作區計劃：<strong>${plans.length}</strong> 檔 · 平均完成 <strong>${avg}%</strong> · 待辦步驟 <strong>${pending}</strong> · <a href="tracking.html" style="color:var(--accent)">計劃追蹤</a> · <span style="color:var(--muted)">終端 bun run track</span>`;
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
    if (count) count.textContent = `${rows.length} 筆`;

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--muted)">沒有符合的專案${
        !store.get().showSamples ? "（範例文件已隱藏）" : ""
      }</td></tr>`;
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
                : "繼續";
        const sampleTag = p.isSample
          ? `<span class="pill" style="margin-left:6px;font-size:10px">範例</span>`
          : "";
        const agentTag = p.authorAgentFamily
          ? `<span class="mono" style="color:var(--muted);font-size:11px"> · agent:${escapeHtml(p.authorAgentFamily)}</span>`
          : "";
        const plan = matchPlan(p, planHits);
        const planCell = plan
          ? `<a href="tracking.html" class="plan-link" title="${escapeHtml(plan.meta.title)} (${escapeHtml(plan.name)})">
              <span class="plan-pct">${plan.meta.done_steps}/${plan.meta.total_steps || "—"}</span>
              <span class="mono" style="color:var(--muted)">${plan.pct}%</span>
            </a>`
          : `<span class="mono" style="color:var(--meta)">—</span>`;
        const del =
          canDelete(user)
            ? `<button type="button" class="btn btn-sm btn-ghost btn-del" data-id="${p.id}" title="移除">移除</button>`
            : "";
        return `<tr data-id="${p.id}" data-od-id="row-${p.id}">
      <td><a href="editor.html">${escapeHtml(p.title)}</a>${sampleTag}<div class="mono">#${escapeHtml(p.tag)}${agentTag}</div></td>
      <td><span class="pill ${s.cls}">${s.label}</span></td>
      <td><div class="progress"><div class="progress-bar ${barCls}"><i style="width:${p.pct}%"></i></div><span>${p.pct}%</span></div></td>
      <td>${planCell}</td>
      <td>${escapeHtml(p.owner)}</td>
      <td class="mono">${escapeHtml(p.updated)}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap">
        <a class="btn btn-sm" href="${actionHref}">${actionLabel}</a>
        ${del}
      </td>
    </tr>`;
      })
      .join("");

    tbody.querySelectorAll(".btn-del").forEach((btn) => {
      (btn as HTMLButtonElement).onclick = () => {
        const id = (btn as HTMLElement).dataset.id!;
        const p = projects.find((x) => x.id === id);
        if (!p || !confirm(`確定移除「${p.title}」？`)) return;
        const r = store.deleteProject(id);
        if (!r.ok) toast(r.reason ?? "無法移除");
        else toast("已移除專案");
        render();
      };
    });

    renderStats(projects);
    renderFlow();
    syncChrome();
    const navCount = document.querySelector('[data-od-id="nav-projects"] .count');
    if (navCount) navCount.textContent = String(projects.length);
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

  /* ─── 4-step PRD wizard ─── */
  let wizStep = 0;
  const WIZ_MAX = 3;

  function setWizardStep(step: number) {
    wizStep = Math.max(0, Math.min(WIZ_MAX, step));
    document.querySelectorAll(".wizard-pane").forEach((p) => {
      const n = Number((p as HTMLElement).dataset.pane);
      (p as HTMLElement).hidden = n !== wizStep;
    });
    document.querySelectorAll("#wizard-steps [data-ws]").forEach((s) => {
      s.classList.toggle("on", Number((s as HTMLElement).dataset.ws) === wizStep);
    });
    const prev = document.getElementById("wizard-prev") as HTMLButtonElement | null;
    const next = document.getElementById("wizard-next") as HTMLButtonElement | null;
    const create = document.getElementById("modal-create") as HTMLButtonElement | null;
    if (prev) prev.hidden = wizStep === 0;
    if (next) next.hidden = wizStep === WIZ_MAX;
    if (create) create.hidden = wizStep !== WIZ_MAX;
  }

  function validateWizardStep(): boolean {
    if (wizStep === 0) {
      const title = (document.getElementById("new-title") as HTMLInputElement).value.trim();
      const what = (document.getElementById("wiz-what") as HTMLInputElement).value.trim();
      if (!title || !what) {
        toast("請填標題與「做什麼」");
        return false;
      }
    }
    if (wizStep === 2) {
      const ngs = ["wiz-ng1", "wiz-ng2", "wiz-ng3"].map(
        (id) => (document.getElementById(id) as HTMLInputElement).value.trim(),
      );
      if (ngs.filter(Boolean).length < 3) {
        toast("Non-Goals 需滿 3 條（SCVB 契約）");
        return false;
      }
    }
    return true;
  }

  function resetWizard() {
    setWizardStep(0);
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
  }

  document.getElementById("btn-new")?.addEventListener("click", () => {
    if (!canEditContent(store.get().currentUser)) {
      toast("核准人員無法新建或編輯內文");
      return;
    }
    resetWizard();
    openModal("modal");
  });
  document.getElementById("modal-close")?.addEventListener("click", () => closeModal("modal"));
  document.getElementById("modal-cancel")?.addEventListener("click", () => closeModal("modal"));
  document.getElementById("wizard-prev")?.addEventListener("click", () => setWizardStep(wizStep - 1));
  document.getElementById("wizard-next")?.addEventListener("click", () => {
    if (!validateWizardStep()) return;
    setWizardStep(wizStep + 1);
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
      status: "draft",
      pct: 12,
      owner: user.name,
      ownerId: user.id,
      authorId: user.id,
      authorAgentFamily: user.kind === "agent" ? user.agentFamily : null,
      mine: true,
      updated: "剛剛",
      tag: tpl.includes("資安") ? "security" : tpl.includes("成長") ? "growth" : "product",
      isSample: false,
    };
    store.addProject(p);
    store.setActiveProject(p.id);

    // 寫入精靈產出的章節初稿
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
    store.updateSection("goals", { status: "warn" });

    toast(`已建立「${title}」（含精靈初稿）`);
    location.href = "editor.html";
  });

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

  document.getElementById("btn-import")?.addEventListener("click", () => {
    toast("已選擇匯入流程（原型）");
  });

  document.getElementById("btn-tui-hint")?.addEventListener("click", () => {
    toast("終端 TUI：在專案目錄執行 bun run track · Web：側欄「計劃追蹤」");
    window.setTimeout(() => {
      location.href = "tracking.html";
    }, 600);
  });

  render();
  store.subscribe(render);
}
