import { store } from "../data/store";
import type { Comment } from "../data/types";
import { bindLogout, requireAuth, roleBadge } from "../lib/auth";
import { exportHtmlFile, exportJsonFile, exportMarkdownFile } from "../lib/export";
import { canApproveProject, canEditContent, canPeerReview } from "../lib/permissions";
import { deriveFlowLayers, renderFlowStripHtml } from "../lib/flow-layers";
import { initHelpOverlay } from "../lib/help-overlay";
import { evaluatePrdGates, gateSummaryLine } from "../lib/prd-gates";
import { initTheme } from "../lib/theme";
import { escapeHtml, initMobileNav, toast, updateUserRailFooter } from "../lib/ui";

const planModules = import.meta.glob("../../plans/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const __authed = requireAuth();
if (__authed) {
initTheme();
initMobileNav("review");
bindLogout();
initHelpOverlay();
{
  const toolbar = document.querySelector(".toolbar");
  if (toolbar && !document.getElementById("flow-strip-host")) {
    const wrap = document.createElement("div");
    wrap.id = "flow-strip-host";
    toolbar.insertAdjacentElement("afterend", wrap);
  }
}

let openOnly = false;
let activeId = "c1";

function activeProject() {
  const st = store.get();
  return (
    st.projects.find((p) => p.id === st.activeProjectId) ??
    st.projects.find((p) => p.id === "p1") ??
    st.projects[0] ??
    null
  );
}

function syncUser() {
  const u = store.get().currentUser;
  updateUserRailFooter({
    name: u.name,
    role: `${roleBadge(u.accessRole)} · ${u.title}`,
    avatar: u.avatar,
  });
}

function renderApprovals() {
  const { approvals, locked, comments, cases, activeProjectId } = store.get();
  const strip = document.querySelector(".approval-strip");
  if (!strip) return;
  const project = activeProject();
  const user = store.get().currentUser;
  const caseRec = cases[activeProjectId] ?? (project ? cases[project.id] : undefined);
  const withdrawn = caseRec?.withdrawn || project?.status === "withdrawn";
  const gate = withdrawn
    ? { ok: false, reason: "此案已抽單，請至管理中心重開" }
    : canApproveProject(user, project);

  const cards = approvals
    .map((a) => {
      const cls =
        a.state === "approved" ? "is-approved" : a.state === "pending" ? "is-pending" : "is-empty";
      return `<div class="approval-card ${cls}" data-od-id="approval-${a.id}">
        <span class="st" aria-hidden="true"></span>
        <span class="role">${escapeHtml(a.role)}</span>
        <span class="name">${escapeHtml(a.name)}</span>
      </div>`;
    })
    .join("");

  const signed = approvals.filter((a) => a.state === "approved").length;
  const open = comments.filter((c) => !c.resolved).length;
  strip.innerHTML =
    cards +
    `<div class="approval-meta" data-od-id="approval-meta">
      <span>${signed} / ${approvals.length} 已簽</span>
      <span>開放留言 ${open}</span>
      ${withdrawn ? "<span style=\"color:var(--danger)\">已抽單</span>" : ""}
    </div>`;

  const pill = document.getElementById("status-pill");
  if (pill) {
    if (withdrawn) {
      pill.className = "pill pill-draft";
      pill.textContent = "已抽單";
    } else if (locked) {
      pill.className = "pill pill-approved";
      pill.textContent = "已核准";
    } else {
      pill.className = "pill pill-review";
      pill.textContent = "審閱中";
    }
  }

  const prdGate = evaluatePrdGates(store.get());
  const approveBtn = document.getElementById("btn-approve") as HTMLButtonElement | null;
  if (approveBtn) {
    const blocked = locked || withdrawn || !gate.ok || !prdGate.canApprove;
    approveBtn.disabled = blocked;
    if (withdrawn) approveBtn.textContent = "已抽單";
    else if (locked) approveBtn.textContent = "已鎖定";
    else if (!prdGate.canApprove) {
      approveBtn.textContent = "結構未達標";
      approveBtn.title = gateSummaryLine(prdGate);
    } else if (!gate.ok) {
      approveBtn.textContent = "無法簽核";
      approveBtn.title = gate.reason ?? "";
    } else {
      approveBtn.textContent = "核准並鎖定";
      approveBtn.title = "";
    }
  }

  const hint = document.getElementById("approve-hint");
  if (hint) {
    if (withdrawn) {
      hint.textContent = `已抽單${caseRec?.withdrawReason ? `：${caseRec.withdrawReason}` : ""}。管理員可至「管理中心 → 個案調整」重開。`;
    } else if (locked) {
      hint.textContent = "此規格已核准鎖定。";
    } else if (!prdGate.canApprove) {
      hint.textContent = gateSummaryLine(prdGate) + "（SCVB 結構 gate 阻擋核准）";
    } else if (!gate.ok) {
      hint.textContent = gate.reason ?? "";
    } else {
      const family = project?.authorAgentFamily
        ? `作者 Agent 族系：${project.authorAgentFamily}。`
        : "";
      hint.textContent = `以「${user.name}」身分簽核。${family}關卡人員可在管理中心異動。`;
    }
  }

  const editLink = document.getElementById("btn-edit") as HTMLAnchorElement | null;
  if (editLink) {
    if (!canEditContent(user) || locked || withdrawn) {
      editLink.classList.add("is-disabled");
      editLink.title = withdrawn ? "已抽單" : locked ? "已鎖定" : "核准人員無編輯權";
    } else {
      editLink.classList.remove("is-disabled");
      editLink.title = "";
    }
  }
}

function renderComments() {
  const list = document.getElementById("comments-list");
  if (!list) return;
  const comments = store.get().comments;
  const visible = openOnly ? comments.filter((c) => !c.resolved) : comments;
  const project = activeProject();
  const peer = canPeerReview(store.get().currentUser, project);
  const canResolve = peer.ok || canApproveProject(store.get().currentUser, project).ok;

  document.getElementById("comment-count")!.textContent = String(comments.length);

  if (visible.length === 0) {
    list.innerHTML = `<div style="padding:20px;color:var(--muted);font-size:13px;text-align:center">沒有留言</div>`;
    return;
  }

  list.innerHTML = visible
    .map((c) => {
      const active = c.id === activeId ? " is-active" : "";
      const resolved = c.resolved ? " is-resolved" : "";
      const resolveDisabled = c.resolved || !canResolve ? "disabled" : "";
      return `<div class="comment${active}${resolved}" data-id="${c.id}" data-od-id="comment-${c.id}">
        <div class="comment-hd">
          <div class="avatar" style="width:22px;height:22px;font-size:9px">${escapeHtml(c.avatar)}</div>
          <strong>${escapeHtml(c.author)}</strong>
          <time>${escapeHtml(c.time)}</time>
        </div>
        <div class="anchor">${escapeHtml(c.anchor)}</div>
        <p>${escapeHtml(c.body)}</p>
        <div class="comment-actions">
          <button type="button" class="btn btn-sm resolve" ${resolveDisabled}>${c.resolved ? "已解決" : "標記已解決"}</button>
          <button type="button" class="btn btn-sm btn-ghost reply">回覆</button>
        </div>
      </div>`;
    })
    .join("");

  if (!canResolve) {
    const note = document.createElement("div");
    note.style.cssText = "padding:8px 12px;font-size:12px;color:var(--muted)";
    note.textContent = peer.reason ?? "目前身分無法覆核此檔案";
    list.prepend(note);
  }

  list.querySelectorAll(".comment").forEach((card) => {
    card.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      activate((card as HTMLElement).dataset.id!);
    });
  });

  list.querySelectorAll(".resolve").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).closest(".comment")?.getAttribute("data-id");
      if (!id) return;
      const r = store.resolveComment(id);
      if (!r.ok) toast(r.reason ?? "無法覆核");
      else toast("留言已標記解決");
      render();
    });
  });

  list.querySelectorAll(".reply").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const who = (btn as HTMLElement).closest(".comment")?.querySelector("strong")?.textContent ?? "";
      const ta = document.getElementById("compose-text") as HTMLTextAreaElement | null;
      if (!ta) return;
      ta.value = `@${who} `;
      ta.focus();
    });
  });
}

function activate(id: string) {
  activeId = id;
  document.querySelectorAll(".hl").forEach((h) => {
    h.classList.toggle("active", (h as HTMLElement).dataset.c === id);
  });
  document.querySelectorAll(".comment").forEach((c) => {
    c.classList.toggle("is-active", (c as HTMLElement).dataset.id === id);
  });
}

function renderDocSections() {
  const { sectionValues } = store.get();

  const probVal = sectionValues["problem"];
  const probSec = document.querySelector<HTMLElement>('[data-od-id="sec-problem"]');
  if (probSec && probVal && (probVal.problem || probVal.quote)) {
    let html = `<h2>問題</h2>`;
    if (probVal.problem) html += `<p>${escapeHtml(probVal.problem)}</p>`;
    if (probVal.quote) {
      html += `<blockquote class="quote-block" data-od-id="customer-quote">${escapeHtml(probVal.quote)}</blockquote>`;
    }
    probSec.innerHTML = html;
  } else if (probSec && !store.get().showSamples) {
    probSec.innerHTML = `<h2>問題</h2><p style="color:var(--muted)">（範例內容已隱藏）</p>`;
  }

  const goalsVal = sectionValues["goals"];
  const goalsSec = document.querySelector<HTMLElement>('[data-od-id="sec-goals"]');
  if (goalsSec && goalsVal && (goalsVal.goals || goalsVal.nongoals)) {
    let html = `<h2>目標與非目標</h2>`;
    if (goalsVal.goals)
      html += `<p><strong>目標</strong> — ${escapeHtml(goalsVal.goals).replace(/\n/g, "<br/>")}</p>`;
    if (goalsVal.nongoals)
      html += `<p><strong>非目標</strong> — ${escapeHtml(goalsVal.nongoals).replace(/\n/g, "<br/>")}</p>`;
    goalsSec.innerHTML = html;
  }
}

function render() {
  renderApprovals();
  renderComments();
  renderDocSections();
  activate(activeId);
  syncUser();
  const host = document.getElementById("flow-strip-host");
  if (host) {
    const hasPlanSteps = Object.values(planModules).some((raw) => /^- \[[ xXvV]\]/m.test(raw));
    host.innerHTML = renderFlowStripHtml(deriveFlowLayers(store.get(), { hasPlanSteps }));
  }
}

document.querySelectorAll(".hl").forEach((h) => {
  h.addEventListener("click", () => activate((h as HTMLElement).dataset.c!));
  h.addEventListener("keydown", (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key === "Enter" || ke.key === " ") {
      ke.preventDefault();
      activate((h as HTMLElement).dataset.c!);
    }
  });
});

document.getElementById("btn-export")?.addEventListener("click", () => {
  exportMarkdownFile(store.get(), activeProject());
  toast("已下載 Markdown 檔");
});

document.getElementById("btn-export-json")?.addEventListener("click", () => {
  exportJsonFile(store.get());
  toast("已下載 JSON");
});

document.getElementById("btn-export-html")?.addEventListener("click", () => {
  exportHtmlFile(store.get(), activeProject());
  toast("已下載 HTML");
});

document.getElementById("btn-post")?.addEventListener("click", () => {
  const ta = document.getElementById("compose-text") as HTMLTextAreaElement | null;
  if (!ta) return;
  const text = ta.value.trim();
  if (!text) {
    toast("請先輸入留言");
    return;
  }
  const u = store.get().currentUser;
  const c: Comment = {
    id: `c${Date.now()}`,
    author: u.name,
    authorId: u.id,
    avatar: u.avatar || u.name.slice(0, 1),
    time: "剛剛",
    anchor: "§ 一般",
    body: text,
    resolved: false,
  };
  store.addComment(c);
  activeId = c.id;
  ta.value = "";
  toast("留言已發表");
  render();
});

document.getElementById("btn-approve")?.addEventListener("click", () => {
  if (store.get().locked) return;
  const prdGate = evaluatePrdGates(store.get());
  if (!prdGate.canApprove) {
    toast(gateSummaryLine(prdGate) + " — 無法核准");
    return;
  }
  const r = store.approveAndLock();
  if (!r.ok) {
    toast(r.reason ?? "無法簽核");
    return;
  }
  toast("規格已核准並鎖定");
  render();
});

document.getElementById("btn-filter")?.addEventListener("click", () => {
  openOnly = !openOnly;
  const btn = document.getElementById("btn-filter");
  if (btn) btn.textContent = openOnly ? "全部" : "未解決";
  toast(openOnly ? "僅顯示未解決留言" : "顯示全部留言");
  render();
});

document.getElementById("btn-toggle-samples")?.addEventListener("click", () => {
  const next = !store.get().showSamples;
  store.setShowSamples(next);
  toast(next ? "已展示範例內容" : "已隱藏範例內容");
  render();
});

document.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).matches("input, textarea")) return;
  if (e.key.toLowerCase() === "r" && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    document.getElementById("compose-text")?.focus();
  }
});

render();
store.subscribe(render);
} // end __authed

