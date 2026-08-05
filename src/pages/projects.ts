import { store } from "../data/store";
import type { Project, ProjectStatus } from "../data/types";
import { ACCESS_ROLE_LABEL } from "../data/types";
import { bindLogout, requireAuth, roleBadge } from "../lib/auth";
import { exportHtmlFile, exportJsonFile, exportMarkdownFile } from "../lib/export";
import { deriveFlowLayers, renderFlowStripHtml } from "../lib/flow-layers";
import { initHelpOverlay } from "../lib/help-overlay";
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
    const nodes = document.querySelectorAll(".stat .v");
    if (nodes[0]) nodes[0].textContent = String(open);
    if (nodes[1]) nodes[1].textContent = String(pending);
    if (nodes[2]) nodes[2].textContent = String(approved);
  }

  function renderFlow() {
    const host = document.getElementById("flow-strip-host");
    if (!host) return;
    // plan steps presence unknown without fetch; mark true if any plan file name in plans list later
    host.innerHTML = renderFlowStripHtml(deriveFlowLayers(store.get(), { hasPlanSteps: true }));
  }

  function render() {
    const tbody = document.getElementById("tbody");
    if (!tbody) return;
    const user = store.get().currentUser;
    const projects = store.visibleProjects();
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
        const del =
          canDelete(user)
            ? `<button type="button" class="btn btn-sm btn-ghost btn-del" data-id="${p.id}" title="移除">移除</button>`
            : "";
        return `<tr data-id="${p.id}" data-od-id="row-${p.id}">
      <td><a href="editor.html">${escapeHtml(p.title)}</a>${sampleTag}<div class="mono">#${escapeHtml(p.tag)}${agentTag}</div></td>
      <td><span class="pill ${s.cls}">${s.label}</span></td>
      <td><div class="progress"><div class="progress-bar ${barCls}"><i style="width:${p.pct}%"></i></div><span>${p.pct}%</span></div></td>
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

  document.getElementById("btn-import")?.addEventListener("click", () => {
    toast("已選擇匯入流程（原型）");
  });

  document.getElementById("btn-tui-hint")?.addEventListener("click", () => {
    toast(`目前身分：${store.get().currentUser.name}（${ACCESS_ROLE_LABEL[store.get().currentUser.accessRole]}）`);
  });

  render();
  store.subscribe(render);
}
