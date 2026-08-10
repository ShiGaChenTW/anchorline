import { store } from "../data/store";
import type { Comment, Section } from "../data/types";
import { projectDisplayName } from "../data/types";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import { exportHtmlFile, exportJsonFile, exportMarkdownFile } from "../lib/export";
import { canApproveProject, canEditContent, canPeerReview } from "../lib/permissions";
import { deriveFlowLayers, renderFlowStripHtml } from "../lib/flow-layers";
import { initHelpOverlay } from "../lib/help-overlay";
import { renderMarkdown } from "../lib/markamd/markdown";
import { applySemanticHighlight } from "../lib/markamd/semantic-highlight";
import { diffDocs } from "../lib/prd-versions";
import { inlineDiff } from "../lib/file-history";
import { evaluatePrdGates, gateSummaryLine } from "../lib/prd-gates";
import { initTheme } from "../lib/theme";
import { syncRailContext } from "../lib/rail-projects";
import {
  expandEnter,
  flashFocus,
  markHighlightEnter,
  pulseWhenBecameReady,
  syncMotionPreferenceClass,
} from "../lib/attention-motion";
import { escapeHtml, initMobileNav, toast, updateUserRailFooter } from "../lib/ui";

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
let activeId = "";
/** 空字串 = 顯示全部章節；否則只顯示該 section id */
let focusSectionId = "";

function activeProject() {
  const st = store.get();
  const visible = st.projects.filter((p) => (st.showSamples ? true : !p.isSample));
  return (
    visible.find((p) => p.id === st.activeProjectId) ??
    visible[0] ??
    st.projects.find((p) => p.id === st.activeProjectId) ??
    st.projects[0] ??
    null
  );
}

function syncUser() {
  const u = store.get().currentUser;
  updateUserRailFooter(toRailUser(u));
}

function syncProjectChrome() {
  const p = activeProject();
  const name = p ? projectDisplayName(p) : "未選擇專案";
  const meta =
    (p?.sourceFolder && p.sourceFolder.trim()) ||
    (p?.tag && p.tag.trim()) ||
    (p?.id ?? "—");
  const owner = p?.owner?.trim() || "—";

  const statusMap: Record<string, { label: string; tone: "draft" | "review" | "ok" | "warn"; cls: string }> = {
    draft: { label: "草稿", tone: "draft", cls: "pill pill-draft" },
    review: { label: "審閱中", tone: "review", cls: "pill pill-review" },
    approved: { label: "已核准", tone: "ok", cls: "pill pill-approved" },
    withdrawn: { label: "已抽單", tone: "warn", cls: "pill pill-draft" },
  };
  const stInfo = (p && statusMap[p.status]) || statusMap.draft;

  // 專案名／審閱狀態 → 左側欄（不再塞 titlebar）
  syncRailContext({
    mode: "審閱佇列",
    projectName: name,
    statusLabel: stInfo.label,
    statusTone: stInfo.tone,
    meta: p ? `負責人 ${owner}` : undefined,
  });

  const h1 = document.querySelector<HTMLElement>('[data-od-id="page-title"]');
  if (h1) h1.textContent = "審閱規格";

  const sub = document.querySelector<HTMLElement>('[data-od-id="page-sub"], .toolbar .sub');
  if (sub) {
    sub.textContent = p
      ? `${name} · ${meta}`
      : "回總覽選一個專案";
  }

  const docTitle = document.querySelector<HTMLElement>('[data-od-id="doc-title"]');
  if (docTitle) docTitle.textContent = name;

  const docSlug = document.querySelector<HTMLElement>('[data-od-id="doc-slug"]');
  if (docSlug) docSlug.textContent = meta;

  const docStatus = document.querySelector<HTMLElement>('[data-od-id="doc-status"]');
  if (docStatus && p) {
    docStatus.className = stInfo.cls;
    docStatus.textContent = stInfo.label;
  }

  document.title = `審閱 · ${name} · Anchorline`;
}

/** 章節欄位 → Markdown 字串 */
function fieldsToMarkdown(s: Section, values: Record<string, string>): string {
  const parts: string[] = [];
  for (const f of s.fields) {
    const v = (values[f.key] ?? "").trim();
    if (!v) continue;
    // 單欄章節直接輸出；多欄加小標
    if (s.fields.length === 1) {
      parts.push(v);
    } else {
      parts.push(`**${f.label}**\n\n${v}`);
    }
  }
  return parts.join("\n\n");
}

function sectionFilled(s: Section, values: Record<string, string>): boolean {
  return s.fields.some((f) => (values[f.key] ?? "").trim().length > 0);
}

/** 一句話摘要：summary.what → problem 首段 → 尚無 */
function deriveLede(sectionValues: Record<string, Record<string, string>>): string {
  const what = (sectionValues["summary"]?.what ?? "").trim();
  if (what) return what.split("\n").map((l) => l.trim()).filter(Boolean)[0] || what;

  const who = (sectionValues["summary"]?.who ?? "").trim();
  const why = (sectionValues["summary"]?.why ?? "").trim();
  if (who || why) {
    return [who && `給：${who}`, why && `為何：${why.split("\n")[0]}`].filter(Boolean).join(" · ");
  }

  const problem = (sectionValues["problem"]?.problem ?? "").trim();
  if (problem) {
    // 取第一個非標題段落
    const line = problem
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("#") && !l.startsWith("|") && !l.startsWith("---"));
    if (line) return line.replace(/\*\*/g, "").slice(0, 220);
  }
  return "尚無一句話摘要 — 請至編輯台補「三行摘要 · 做什麼」";
}

function deriveMeta(): { label: string; value: string }[] {
  const p = activeProject();
  if (!p) return [];
  const items: { label: string; value: string }[] = [];
  items.push({ label: "負責人", value: p.owner || "—" });
  if (p.sourceFolder) items.push({ label: "來源", value: p.sourceFolder });
  else if (p.tag) items.push({ label: "標籤", value: p.tag });
  if (p.isImported) items.push({ label: "類型", value: "資料夾匯入" });
  if (p.updated) items.push({ label: "更新", value: p.updated });
  if (p.importSummary) {
    items.push({
      label: "匯入評分",
      value: `${Math.round(p.importSummary.overallScore)} 分 · 覆蓋 ${p.importSummary.coveragePct}%`,
    });
  }
  return items;
}

function extractOpenItems(text: string): string[] {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/待決|待定|TBD|TODO|開放|未定|？\s*$|\?\s*$/i.test(line)) {
      const clean = line
        .replace(/^[-*•]\s+/, "")
        .replace(/^\d+\.\s+/, "")
        .replace(/\*\*/g, "")
        .slice(0, 120);
      if (clean) out.push(clean);
    }
  }
  return out.slice(0, 5);
}

function renderFocusBar() {
  const bar = document.getElementById("review-focus-bar");
  if (!bar) return;
  const st = store.get();
  const openVals = reviewDocs()["open"] ?? {};
  const openText = Object.values(openVals).join("\n");
  const items = extractOpenItems(openText);
  // 也掃其他章節的待決
  if (items.length < 3) {
    for (const s of st.sections) {
      if (s.id === "open") continue;
      const t = Object.values(reviewDocs()[s.id] ?? {}).join("\n");
      for (const it of extractOpenItems(t)) {
        if (!items.includes(it)) items.push(it);
        if (items.length >= 5) break;
      }
      if (items.length >= 5) break;
    }
  }

  const gate = evaluatePrdGates(st, store.activeGateSpec());
  if (!items.length && gate.canApprove) {
    bar.hidden = true;
    bar.innerHTML = "";
    return;
  }

  bar.hidden = false;
  const gateLine = gate.canApprove
    ? `<span class="review-focus-ok">結構 gate 可核准</span>`
    : `<span class="review-focus-block">${escapeHtml(gateSummaryLine(gate))}</span>`;

  const list =
    items.length > 0
      ? `<ul class="review-focus-list">${items
          .slice(0, 3)
          .map((t) => `<li>${escapeHtml(t)}</li>`)
          .join("")}${
          items.length > 3
            ? `<li class="review-focus-more">另有 ${items.length - 3} 項待決</li>`
            : ""
        }</ul>`
      : `<p class="review-focus-empty">沒有掃到「待決」句，請人工掃過開放問題章節。</p>`;

  bar.innerHTML = `
    <div class="review-focus-head">
      <strong>審閱焦點</strong>
      ${gateLine}
    </div>
    ${list}
  `;
}

function renderSecNav() {
  const nav = document.getElementById("review-sec-nav");
  if (!nav) return;
  const st = store.get();
  const pills = [
    `<button type="button" class="review-sec-pill${focusSectionId === "" ? " on" : ""}" data-sec="">全部</button>`,
    ...st.sections.map((s) => {
      const vals = reviewDocs()[s.id] ?? {};
      const filled = sectionFilled(s, vals);
      const on = focusSectionId === s.id ? " on" : "";
      const empty = filled ? "" : " is-empty";
      return `<button type="button" class="review-sec-pill${on}${empty}" data-sec="${escapeHtml(s.id)}" title="${escapeHtml(s.desc)}">${escapeHtml(s.n)} ${escapeHtml(s.title)}</button>`;
    }),
  ];
  nav.innerHTML = pills.join("");
  nav.querySelectorAll<HTMLButtonElement>("[data-sec]").forEach((btn) => {
    btn.onclick = () => {
      focusSectionId = btn.dataset.sec ?? "";
      renderDoc();
      renderSecNav();
      const target = focusSectionId
        ? document.getElementById(`review-sec-${focusSectionId}`)
        : document.getElementById("review-doc-body");
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        flashFocus(target);
      }
    };
  });
}

function renderDoc() {
  const st = store.get();
  const p = activeProject();
  const body = document.getElementById("review-doc-body");
  const ledeEl = document.querySelector<HTMLElement>('[data-od-id="doc-lede"]');
  const metaEl = document.querySelector<HTMLElement>('[data-od-id="doc-meta"]');
  if (!body) return;

  if (ledeEl) ledeEl.textContent = deriveLede(reviewDocs());

  if (metaEl) {
    const items = deriveMeta();
    metaEl.innerHTML = items
      .map(
        (it) =>
          `<span><strong>${escapeHtml(it.label)}</strong>${escapeHtml(it.value)}</span>`,
      )
      .join("");
    metaEl.hidden = items.length === 0;
  }

  if (!p) {
    body.innerHTML = `<div class="review-empty-doc">
      <p>尚未選擇專案。</p>
      <a class="btn btn-primary" href="overview.html">回總覽</a>
    </div>`;
    return;
  }

  const sections = st.sections.filter((s) =>
    focusSectionId ? s.id === focusSectionId : true,
  );

  let html = "";
  let filledN = 0;
  for (const s of st.sections) {
    if (sectionFilled(s, reviewDocs()[s.id] ?? {})) filledN++;
  }

  html += `<p class="review-doc-progress">${filledN} / ${st.sections.length} 章節有內容${
    focusSectionId ? " · 正在聚焦單一章節" : ""
  }</p>`;

  for (const s of sections) {
    const values = reviewDocs()[s.id] ?? {};
    const filled = sectionFilled(s, values);
    const md = fieldsToMarkdown(s, values);
    const statusClass =
      s.status === "done" ? "is-done" : s.status === "warn" ? "is-warn" : "is-empty";

    html += `<section class="review-sec ${statusClass}" id="review-sec-${escapeHtml(s.id)}" data-od-id="sec-${escapeHtml(s.id)}">
      <header class="review-sec-head">
        <span class="review-sec-n">${escapeHtml(s.n)}</span>
        <h2>${escapeHtml(s.title)}</h2>
        <span class="review-sec-st">${filled ? "有內容" : "未填"}</span>
      </header>`;

    if (!filled) {
      html += `<div class="review-sec-empty">
        <p>此章節尚未填寫。</p>
        <a class="btn btn-sm" href="editor.html">回編輯台補齊</a>
      </div>`;
    } else {
      html += `<div class="review-sec-md mdv-prose">${renderMarkdown(md)}</div>`;
    }
    html += `</section>`;
  }

  body.innerHTML = html;

  // 語意高亮（與編輯台同一套）
  const ed = st.settings.editor;
  const intensity = ed?.highlightIntensity === "medium" ? "medium" : "soft";
  const enabled = ed?.semanticHighlight !== false;
  body.querySelectorAll<HTMLElement>(".review-sec-md").forEach((el) => {
    applySemanticHighlight(el, { enabled, intensity, todosOnly: false });
    markHighlightEnter(el);
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
      const stateLabel =
        a.state === "approved" ? "已簽" : a.state === "pending" ? "審閱中" : "待指派";
      return `<div class="approval-card ${cls}" data-od-id="approval-${a.id}">
        <span class="st" aria-hidden="true"></span>
        <span class="role">${escapeHtml(a.role)}</span>
        <span class="name">${escapeHtml(a.name || stateLabel)}</span>
      </div>`;
    })
    .join("");

  const signed = approvals.filter((a) => a.state === "approved").length;
  // 只算這個專案的 —— 留言原本是全域的，別的專案的未解決數會混進來
  const open = comments.filter((c) => c.projectId === activeProjectId && !c.resolved).length;
  strip.innerHTML =
    cards +
    `<div class="approval-meta" data-od-id="approval-meta">
      <span>${signed} / ${approvals.length} 已簽</span>
      <span>開放留言 ${open}</span>
      ${withdrawn ? '<span style="color:var(--danger)">已抽單</span>' : ""}
    </div>`;

  const sum = document.getElementById("approvals-summary");
  if (sum) {
    sum.textContent = `簽核 ${signed}/${approvals.length} · 留言未決 ${open}${
      withdrawn ? " · 已抽單" : locked ? " · 已鎖定" : ""
    }`;
  }

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

  // gate 要對**即將被核准的那一份快照**跑。
  // 讀 store.get() 等於檢查「當下已儲存的內容」—— 送審後作者又改過的話，
  // 擋不擋得住跟審閱者看到的東西無關。
  const prdGate = evaluatePrdGates(
    { ...store.get(), sectionValues: reviewDocs() },
    store.activeGateSpec(),
  );
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
    let text = "";
    if (withdrawn) {
      text = `已抽單${caseRec?.withdrawReason ? `：${caseRec.withdrawReason}` : ""}。管理員可至「管理中心 → 個案調整」重開。`;
    } else if (locked) {
      text = "此規格已核准鎖定。";
    } else if (!prdGate.canApprove) {
      text = gateSummaryLine(prdGate) + "（SCVB 結構 gate 阻擋核准）";
    } else if (!gate.ok) {
      text = gate.reason ?? "";
    } else {
      const family = project?.authorAgentFamily
        ? `作者 Agent 族系：${project.authorAgentFamily}。`
        : "";
      text = `以「${user.name}」身分簽核。${family}`;
    }
    hint.textContent = text;
    hint.hidden = !text;
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
  const pid = store.get().activeProjectId;
  const comments = store.get().comments.filter((c) => c.projectId === pid);
  const visible = openOnly ? comments.filter((c) => !c.resolved) : comments;
  const project = activeProject();
  const peer = canPeerReview(store.get().currentUser, project);
  const canResolve = peer.ok || canApproveProject(store.get().currentUser, project).ok;

  const countEl = document.getElementById("comment-count");
  if (countEl) countEl.textContent = String(comments.length);

  if (visible.length === 0) {
    list.innerHTML = `<div class="review-comments-empty">尚無留言。有疑慮就寫下一條，一次只盯一件事。</div>`;
  } else {
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
  }

  if (!canResolve && visible.length) {
    const note = document.createElement("div");
    note.className = "review-comments-note";
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
      const who =
        (btn as HTMLElement).closest(".comment")?.querySelector("strong")?.textContent ?? "";
      const ta = document.getElementById("compose-text") as HTMLTextAreaElement | null;
      if (!ta) return;
      ta.value = `@${who} `;
      ta.focus();
      expandComments(true);
    });
  });
}

function activate(id: string) {
  activeId = id;
  document.querySelectorAll(".comment").forEach((c) => {
    c.classList.toggle("is-active", (c as HTMLElement).dataset.id === id);
  });
}

function expandComments(open: boolean) {
  const panel = document.querySelector(".review-comments") as HTMLElement | null;
  const body = document.getElementById("comments-body");
  const toggle = document.getElementById("btn-comments-toggle");
  if (!panel || !body || !toggle) return;
  panel.dataset.collapsed = open ? "0" : "1";
  body.hidden = !open;
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
  const chev = toggle.querySelector(".review-comments-chevron");
  if (chev) chev.textContent = open ? "▾" : "▸";
  document.querySelector(".review-layout")?.classList.toggle("comments-open", open);
  if (open) expandEnter(body);
}

/**
 * 這一版相對主線改了什麼。
 *
 * 比的是「送審時的快照」與「上一次核准合併的快照」—— 不是當下的編輯內容。
 * 審閱者要看的是他即將核准的那一份，作者送審後又改的東西不該混進來。
 *
 * 沒有主線（第一次送審）就整份都是新的，不畫 diff —— 全部標成新增等於
 * 沒有資訊，直接看正文比較快。
 */
/**
 * 審閱要看的那一份正文 = 個案綁定的送審快照。
 *
 * 沒有快照（舊資料、或從未送審）才退回當下已儲存的內容。
 * 這支存在的理由：審閱頁原本直接讀 state.sectionValues，於是送審之後
 * 作者再改一次，審閱者看到的是新的、核准合併的卻是舊的那一份快照。
 */
function reviewDocs(): Record<string, Record<string, string>> {
  return store.prdReviewCommit()?.docs ?? store.get().sectionValues;
}

function renderVersionDiff() {
  const host = document.getElementById("rv-diff");
  if (!host) return;
  const commit = store.prdReviewCommit();
  const base = store.prdBaseline();
  if (!commit || !base) {
    host.hidden = true;
    return;
  }

  const diffs = diffDocs(base.docs, commit.docs);
  if (!diffs.length) {
    host.hidden = true;
    return;
  }

  const secTitle = (id: string) => {
    const sec = store.get().sections.find((x) => x.id === id);
    return sec ? `${sec.n} · ${sec.title}` : id;
  };

  host.hidden = false;
  host.innerHTML = `
    <header class="rv-diff-head">
      <h2>這一版改了什麼</h2>
      <p class="rv-diff-sub">
        對照上次核准的版本（${escapeHtml(base.at.slice(0, 10))}）·
        ${diffs.length} 個欄位有變更 ·
        <span class="fv-add">新增</span> / <span class="fv-del">刪除</span>
      </p>
    </header>
    ${diffs
      .map((d) => {
        const afterLines = d.after.split("\n");
        const removedAt = new Map<number, string[]>();
        const byIndex = new Map<number, (typeof d.marks)[number]>();
        for (const m of d.marks) {
          if (m.kind === "removed") {
            const list = removedAt.get(m.index) ?? [];
            list.push(m.before ?? "");
            removedAt.set(m.index, list);
          } else byIndex.set(m.index, m);
        }
        const rows: string[] = [];
        const pushRemoved = (at: number) => {
          for (const gone of removedAt.get(at) ?? []) {
            rows.push(
              `<span class="fv-line fv-changed fv-line-removed"><span class="fv-del">${
                escapeHtml(gone) || "&nbsp;"
              }</span></span>`,
            );
          }
        };
        afterLines.forEach((ln, i) => {
          pushRemoved(i);
          const m = byIndex.get(i);
          if (!m) return;
          rows.push(
            `<span class="fv-line fv-changed">${
              m.kind === "modified"
                ? inlineDiff(m.before ?? "", ln)
                    .map((sg) => `<span class="fv-${sg.kind}">${escapeHtml(sg.text)}</span>`)
                    .join("")
                : `<span class="fv-add">${escapeHtml(ln) || "&nbsp;"}</span>`
            }</span>`,
          );
        });
        pushRemoved(afterLines.length);
        return `<div class="rv-diff-item">
          <p class="rv-diff-where">${escapeHtml(secTitle(d.sectionId))} · <span class="mono">${escapeHtml(d.key)}</span></p>
          <div class="rv-diff-body">${rows.join("\n") || "<em>（僅空白差異）</em>"}</div>
        </div>`;
      })
      .join("")}
  `;
}

function render() {
  syncMotionPreferenceClass();
  syncProjectChrome();
  renderVersionDiff();
  renderApprovals();
  renderFocusBar();
  renderSecNav();
  renderDoc();
  renderComments();
  if (activeId) activate(activeId);
  syncUser();
  const host = document.getElementById("flow-strip-host");
  if (host) {
    const hasPlanSteps = Object.values(planModules).some((raw) =>
      /^- \[[ xXvV]\]/m.test(raw),
    );
    host.innerHTML = renderFlowStripHtml(
      deriveFlowLayers(store.get(), { hasPlanSteps, gateSpec: store.activeGateSpec() }),
    );
  }

  // Phase A：核准從不可→可時 pulse 一次
  const approveBtn = document.getElementById("btn-approve");
  const ready =
    approveBtn instanceof HTMLButtonElement && !approveBtn.disabled;
  pulseWhenBecameReady(approveBtn, ready);
}

document.getElementById("btn-comments-toggle")?.addEventListener("click", () => {
  const panel = document.querySelector(".review-comments") as HTMLElement | null;
  const open = panel?.dataset.collapsed !== "0";
  expandComments(open);
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
    projectId: store.get().activeProjectId,
    author: u.name,
    authorId: u.id,
    avatar: u.avatar || u.name.slice(0, 1),
    time: "剛剛",
    anchor: focusSectionId
      ? `§ ${store.get().sections.find((s) => s.id === focusSectionId)?.title ?? "一般"}`
      : "§ 一般",
    body: text,
    resolved: false,
  };
  store.addComment(c);
  activeId = c.id;
  ta.value = "";
  toast("留言已發表");
  expandComments(true);
  render();
});

document.getElementById("btn-approve")?.addEventListener("click", () => {
  if (store.get().locked) return;
  const prdGate = evaluatePrdGates(store.get(), store.activeGateSpec());
  if (!prdGate.canApprove) {
    toast(gateSummaryLine(prdGate) + " — 無法核准");
    return;
  }
  const r = store.approveAndLock();
  if (!r.ok) {
    toast(r.reason ?? "無法簽核");
    return;
  }

  // 核准 = merge：把**送審時那一份快照**併進主線，成為下一輪比較的基準。
  // 合併的不是「現在的內容」—— 審閱者核准的是他看過的那一份；送審之後
  // 作者又改的東西留在 working copy，等下一次送審。
  // **只有全部關卡完成才合併。**
  // approveAndLock 在「只簽了自己那一關」時同樣回 ok（案件仍停在 review），
  // 先前這裡無條件接著 merge —— 等於第一個關卡簽名就把整份併進主線，
  // 其他關卡的人根本還沒看。多關卡簽核形同虛設。
  if (!r.allDone) {
    toast("已簽核你負責的關卡 —— 其餘關卡完成後才會併入主線");
    render();
    return;
  }

  const merged = store.mergeApproved();
  toast(
    merged.ok
      ? "全部關卡完成，已併入主線 —— 之後的修改會以這一版為基準"
      : `已核准（${merged.reason ?? "沒有可合併的送審版本"}）`,
  );
  render();
});

document.getElementById("btn-filter")?.addEventListener("click", () => {
  openOnly = !openOnly;
  const btn = document.getElementById("btn-filter");
  if (btn) btn.textContent = openOnly ? "全部" : "未解決";
  toast(openOnly ? "僅顯示未解決留言" : "顯示全部留言");
  expandComments(true);
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
    expandComments(true);
    document.getElementById("compose-text")?.focus();
  }
});

// 預設留言收合；簽核 details 展開淡入
expandComments(false);
document.querySelector(".review-approvals-wrap")?.addEventListener("toggle", (e) => {
  const d = e.currentTarget;
  if (!(d instanceof HTMLDetailsElement) || !d.open) return;
  expandEnter(d.querySelector(".approval-strip") ?? d);
});

render();
store.subscribe(render);
} // end __authed
