import { store } from "../data/store";
import type { Project, ProjectStatus } from "../data/types";
import { ACCESS_ROLE_LABEL } from "../data/types";
import { bindLogout, requireAuth, roleBadge } from "../lib/auth";
import { exportHtmlFile, exportJsonFile, exportMarkdownFile } from "../lib/export";
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

  document.getElementById("btn-new")?.addEventListener("click", () => {
    if (!canEditContent(store.get().currentUser)) {
      toast("核准人員無法新建或編輯內文");
      return;
    }
    openModal("modal");
  });
  document.getElementById("modal-close")?.addEventListener("click", () => closeModal("modal"));
  document.getElementById("modal-cancel")?.addEventListener("click", () => closeModal("modal"));

  document.getElementById("modal-create")?.addEventListener("click", () => {
    const user = store.get().currentUser;
    if (!canEditContent(user)) {
      toast("無編輯權限");
      return;
    }
    const title =
      (document.getElementById("new-title") as HTMLInputElement | null)?.value.trim() ||
      "新功能規格";
    const tpl = (document.getElementById("new-tpl") as HTMLSelectElement | null)?.value ?? "";
    const p: Project = {
      id: `p${Date.now()}`,
      title,
      status: "draft",
      pct: 8,
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
    toast(`已建立「${title}」`);
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
