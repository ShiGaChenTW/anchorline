import { critiqueSectionWithAI, generateAIDraft, polishTextWithAI } from "../lib/ai-coach";
import { evaluateChecks, liveScore, store } from "../data/store";
import type { Project, Section } from "../data/types";
import { projectDisplayName } from "../data/types";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import { syncRailContext } from "../lib/rail-projects";
import {
  expandEnter,
  flashFocus,
  pulseSubmitWhenBecameReady,
  syncMotionPreferenceClass,
} from "../lib/attention-motion";
import {
  EDITOR_BEGINNER_TRACK,
  isBeginnerMode,
  setBeginnerMode,
} from "../lib/beginner-flow";
import { exportMarkdownFile } from "../lib/export";
import { bindMdField, mdFieldHtml } from "../lib/markamd";
import { canEditContent } from "../lib/permissions";
import { deriveFlowLayers, renderFlowStripHtml } from "../lib/flow-layers";
import { initHelpOverlay } from "../lib/help-overlay";
import { evaluatePrdGates, gateSummaryLine } from "../lib/prd-gates";
import { initTheme } from "../lib/theme";
import { escapeHtml, initMobileNav, toast, updateUserRailFooter } from "../lib/ui";

/** MarkaMD 雙欄欄位清理 */
let unbindMd: (() => void) | null = null;

const planModules = import.meta.glob("../../plans/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const __authed = requireAuth();
if (__authed) {
initTheme();
initMobileNav("editor");
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

let idx = 0;
/** 用於章節切換時 flash 視線錨定 */
let prevIdx = -1;

function editable(): boolean {
  return canEditContent(store.get().currentUser) && !store.get().locked;
}

function activeProject(): Project | null {
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

/** 工具列綁定目前專案；專案名改放側欄（不再塞 titlebar） */
function syncProjectChrome() {
  const p = activeProject();
  const name = p ? projectDisplayName(p) : "未選擇專案";
  const meta =
    (p?.sourceFolder && p.sourceFolder.trim()) ||
    (p?.tag && p.tag.trim()) ||
    (p?.id ?? "—");

  const statusMap: Record<string, { label: string; tone: "draft" | "review" | "ok" | "warn"; cls: string }> = {
    draft: { label: "草稿", tone: "draft", cls: "pill pill-draft" },
    review: { label: "審閱中", tone: "review", cls: "pill pill-review" },
    approved: { label: "已核准", tone: "ok", cls: "pill pill-approved" },
    withdrawn: { label: "已抽單", tone: "warn", cls: "pill pill-draft" },
  };
  const stInfo = (p && statusMap[p.status]) || { label: "—", tone: "draft" as const, cls: "pill pill-draft" };

  syncRailContext({
    mode: "編輯工作台",
    projectName: name,
    statusLabel: stInfo.label,
    statusTone: stInfo.tone,
    meta: p ? meta : undefined,
  });

  const h1 = document.querySelector<HTMLElement>('[data-od-id="page-title"], .toolbar h1');
  if (h1) h1.textContent = name;

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const sub = document.querySelector<HTMLElement>('[data-od-id="page-sub"], .toolbar .sub');
  if (sub) {
    sub.textContent = p
      ? `${meta} · 自動儲存 ${hh}:${mm}`
      : "回到專案列表選擇一個專案";
  }

  document.title = `${name} · 編輯 · PRD開發監控台`;
}

function syncUser() {
  const u = store.get().currentUser;
  updateUserRailFooter(toRailUser(u));
  const banner = document.getElementById("perm-banner");
  if (banner) {
    if (!canEditContent(u)) {
      banner.hidden = false;
      banner.textContent = "目前身分為核准人員：可檢視，不可編輯內文。請至審閱頁簽核。";
    } else if (store.get().locked) {
      banner.hidden = false;
      banner.textContent = "規格已核准鎖定，內文唯讀。";
    } else {
      banner.hidden = true;
    }
  }
}

function sections(): Section[] {
  return store.get().sections;
}

function valuesFor(s: Section): Record<string, string> {
  return store.get().sectionValues[s.id] ?? {};
}

function renderOutline() {
  const el = document.getElementById("outline");
  if (!el) return;
  const list = sections();
  // ADHD：大綱只顯示編號＋標題＋狀態；說明改 title tooltip，減少並列文字
  el.innerHTML = list
    .map((s, i) => {
      const st = s.status === "done" ? "done" : s.status === "warn" ? "warn" : "empty";
      const label = s.status === "done" ? "完成" : s.status === "warn" ? "待補" : "空白";
      const active = i === idx;
      return `<button type="button" class="sec adhd-sec ${active ? "active" : ""}" data-i="${i}" role="option" aria-selected="${active}" data-od-id="sec-${s.id}" title="${escapeHtml(s.desc)}">
      <span class="n">${s.n}</span>
      <span class="adhd-sec-body"><div class="t">${escapeHtml(s.title)}</div>${
        active ? `<div class="d adhd-sec-hint">${escapeHtml(s.desc)}</div>` : ""
      }</span>
      <span class="st ${st}">${label}</span>
    </button>`;
    })
    .join("");

  el.querySelectorAll(".sec").forEach((btn) => {
    (btn as HTMLButtonElement).onclick = () => {
      idx = Number((btn as HTMLElement).dataset.i);
      const s = sections()[idx];
      if (s) store.setActiveSection(s.id);
      render();
    };
  });

  const avg = Math.round(
    list.reduce((a, s) => a + liveScore(s, valuesFor(s)), 0) / list.length,
  );
  const pct = document.getElementById("outline-pct");
  if (pct) pct.textContent = `${avg}%`;
}

function renderEditor() {
  const list = sections();
  const s = list[idx];
  if (!s) return;
  const values = valuesFor(s);
  const label = document.getElementById("sec-label");
  if (label) label.textContent = `${s.n} · ${s.title}`;

  const fields = s.fields
    .map((f) => {
      const val = values[f.key] ?? "";
      if (f.type === "text") {
        return `<div class="field" data-od-id="field-${f.key}">
        <label>${escapeHtml(f.label)}<span>${escapeHtml(f.hint || "")}</span></label>
        <input type="text" data-key="${f.key}" value="${escapeHtml(val)}" />
      </div>`;
      }
      // 長文欄位：MarkaMD 風格雙欄 Markdown 寫作 + 即時預覽
      const rows = Math.max(f.rows || 6, 8);
      return mdFieldHtml({
        key: f.key,
        label: f.label,
        hint: f.hint || "Markdown",
        value: val,
        rows,
        readOnly: !editable(),
      });
    })
    .join("");

  const body = document.getElementById("editor-body");
  if (!body) return;

  unbindMd?.();
  unbindMd = null;

  // 章節導引可摺：空白章節預設展開，已有內容則收合（文件編輯器本體不動）
  const filledLen = Object.values(values).join("").trim().length;
  const guideOpen = filledLen < 40 || s.status === "empty";

  body.innerHTML = `
    <header class="adhd-sec-header">
      <p class="adhd-sec-kicker">本章</p>
      <h3 data-od-id="section-title">${escapeHtml(s.title)}</h3>
      <p class="lead adhd-sec-lead">${escapeHtml(s.desc)}</p>
    </header>
    <details class="adhd-guide" data-od-id="guide" ${guideOpen ? "open" : ""}>
      <summary>本章怎麼寫 <span class="adhd-guide-meta">${s.tips.length} 提示</span></summary>
      <div class="guide">
        ${escapeHtml(s.guide)}
        <ul>${s.tips.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>
      </div>
    </details>
    ${fields}
    <div class="hint adhd-editor-hint">變更即時存檔 · <span class="mono">⌘↵</span> 下一節 · <span class="mono">⌘S</span> 確認</div>
  `;

  // 一般 input
  body.querySelectorAll<HTMLInputElement>("input[data-key]").forEach((input) => {
    if (!editable()) {
      input.readOnly = true;
      input.disabled = true;
    }
    input.addEventListener("input", () => {
      if (!editable()) return;
      const key = input.dataset.key!;
      store.setSectionField(s.id, key, input.value);
      const len = Object.values(store.get().sectionValues[s.id] ?? {}).join("").length;
      if (len > 80 && s.status === "empty") {
        store.updateSection(s.id, { status: "warn" });
      }
      renderCoach();
      renderOutline();
    });
  });

  // MarkaMD 雙欄 textarea
  unbindMd = bindMdField(body, (key, value) => {
    if (!editable()) return;
    store.setSectionField(s.id, key, value);
    const len = Object.values(store.get().sectionValues[s.id] ?? {}).join("").length;
    if (len > 80 && s.status === "empty") {
      store.updateSection(s.id, { status: "warn" });
    }
    renderCoach();
    renderOutline();
  });

  const prev = document.getElementById("btn-prev") as HTMLButtonElement | null;
  const next = document.getElementById("btn-next") as HTMLButtonElement | null;
  if (prev) prev.disabled = idx === 0;
  if (next) next.textContent = idx === list.length - 1 ? "完成" : "下一節";
  syncUser();
}

function renderCoach() {
  const s = sections()[idx];
  if (!s) return;
  const values = valuesFor(s);
  const checks = evaluateChecks(s, values);
  const score = liveScore({ ...s, checks }, values);
  const passN = checks.filter((c) => c.pass).length;
  const settings = store.get().settings;

  const gate = evaluatePrdGates(store.get());
  const coach = document.getElementById("coach-body");
  if (!coach) return;

  // ADHD：一次只強調「現在補什麼」；其餘收進 details
  const failing = checks.filter((c) => !c.pass);
  const nextCheck = failing[0];
  const scoreLabel = score >= 85 ? "可送審" : score >= 70 ? "接近完成" : "需補強";
  const gateBlocks = gate.findings.filter((f) => f.level === "block");
  const gateOpen = !gate.canSubmit;

  coach.innerHTML = `
    <div class="card adhd-coach-now" data-od-id="next-card">
      <p class="adhd-coach-kicker">現在做這一件</p>
      ${
        nextCheck
          ? `<h4 class="adhd-coach-now-title">補齊：${escapeHtml(nextCheck.label)}</h4>
             <p class="adhd-coach-now-detail">完成後分數與檢查會即時更新。一次只盯這一項。</p>`
          : `<h4 class="adhd-coach-now-title">本章檢查已過</h4>
             <p class="adhd-coach-now-detail">可按「下一節」，或結構 gate 全過後送出審閱。</p>`
      }
      ${
        failing.length > 1
          ? `<p class="adhd-coach-more-count">另外還有 ${failing.length - 1} 項稍後再補</p>`
          : ""
      }
    </div>

    <div class="card adhd-score-card" data-od-id="score-card">
      <div class="adhd-score-row">
        <div class="score-ring adhd-score-ring">
          <div class="ring" style="--p:${score}"><b>${score}</b></div>
        </div>
        <div class="adhd-score-meta">
          <div class="adhd-score-label">${scoreLabel}</div>
          <div class="mono adhd-score-pass">${passN}/${checks.length} 通過</div>
          <span class="pill pill-review adhd-model-pill">${escapeHtml(settings.model)}</span>
        </div>
      </div>
    </div>

    <details class="adhd-coach-details card" data-od-id="checklist-card" ${failing.length && failing.length <= 3 ? "open" : ""}>
      <summary>檢查清單 <span class="adhd-details-meta">${passN}/${checks.length}</span></summary>
      <div class="check-list">
        ${checks
          .map(
            (c) => `
          <label>
            <input type="checkbox" ${c.pass ? "checked" : ""} data-cid="${c.id}" />
            <span>${escapeHtml(c.label)}</span>
          </label>`,
          )
          .join("")}
      </div>
    </details>

    <details class="adhd-coach-details card" data-od-id="prd-gate-card" ${gateOpen ? "open" : ""}>
      <summary>結構 gate <span class="adhd-details-meta">${escapeHtml(gateSummaryLine(gate))}</span></summary>
      <div class="mono adhd-gate-score">score ${gate.score}</div>
      <div class="check-list">
        ${gate.findings
          .map((f) => {
            const icon = f.level === "pass" ? "✔" : f.level === "warn" ? "!" : "✗";
            const color =
              f.level === "pass" ? "var(--success)" : f.level === "warn" ? "var(--warn)" : "var(--danger)";
            return `<div class="adhd-gate-row">
              <span style="color:${color}">${icon}</span>
              <span><strong>${escapeHtml(f.label)}</strong>
              <span class="adhd-gate-detail"> — ${escapeHtml(f.detail)}</span></span>
            </div>`;
          })
          .join("")}
      </div>
      ${
        !gate.canSubmit
          ? `<p class="adhd-gate-block">有 BLOCK 項時無法送審${gateBlocks.length ? `（${gateBlocks.length}）` : ""}</p>`
          : `<p class="adhd-gate-ok">可送審</p>`
      }
      <p class="adhd-coach-link"><a href="tracking.html">開啟計劃追蹤 →</a></p>
    </details>

    <details class="adhd-coach-details card adhd-ai-card" data-od-id="ai-tools-card">
      <summary>AI 助教</summary>
      <div class="adhd-ai-actions">
        <button type="button" class="btn btn-sm btn-accent" id="btn-ai-draft">一鍵生稿</button>
        <button type="button" class="btn btn-sm" id="btn-ai-polish">語調潤色</button>
        <button type="button" class="btn btn-sm" id="btn-ai-audit">深度評估</button>
      </div>
      <div class="adhd-ai-prompt-row">
        <input type="text" id="ai-prompt-input" placeholder="提問，如：補充資安評估" />
        <button type="button" class="btn btn-sm btn-primary" id="btn-ai-send">送出</button>
      </div>
      <div id="ai-feedback" class="adhd-ai-feedback"></div>
    </details>

    <details class="adhd-coach-details card" data-od-id="example-card">
      <summary>好例子</summary>
      <div class="example">${escapeHtml(s.example)}</div>
    </details>
  `;

  coach.querySelectorAll<HTMLInputElement>(".check-list input").forEach((cb) => {
    cb.addEventListener("change", () => {
      store.setCheck(s.id, cb.dataset.cid!, cb.checked);
      renderCoach();
      renderOutline();
    });
  });

  // AI Draft Button
  document.getElementById("btn-ai-draft")?.addEventListener("click", async () => {
    if (!editable()) {
      toast("目前身分無法編輯內文");
      return;
    }
    const feedbackEl = document.getElementById("ai-feedback");
    if (feedbackEl) feedbackEl.innerHTML = `<span style="color:var(--accent)">✨ AI 正在依據《${escapeHtml(s.title)}》生成最佳實踐段落...</span>`;
    const draft = await generateAIDraft(s, valuesFor(s));
    for (const key in draft) {
      store.setSectionField(s.id, key, draft[key]);
    }
    toast("✨ AI 生稿已套用至編輯畫布");
    renderEditor();
    renderOutline();
    renderCoach();
  });

  // AI Polish Button
  document.getElementById("btn-ai-polish")?.addEventListener("click", async () => {
    if (!editable()) {
      toast("目前身分無法編輯內文");
      return;
    }
    const feedbackEl = document.getElementById("ai-feedback");
    if (feedbackEl) feedbackEl.innerHTML = `<span style="color:var(--accent)">🪄 AI 正在進行語調潤色與結構修整...</span>`;
    const current = valuesFor(s);
    for (const key in current) {
      if (current[key]) {
        const polished = await polishTextWithAI(current[key], settings.persona === "concise" ? "concise" : "executive");
        store.setSectionField(s.id, key, polished);
      }
    }
    toast("🪄 已完成 AI 潤色");
    renderEditor();
    renderOutline();
    renderCoach();
  });

  // AI Audit Button
  document.getElementById("btn-ai-audit")?.addEventListener("click", async () => {
    const feedbackEl = document.getElementById("ai-feedback");
    if (feedbackEl) feedbackEl.innerHTML = `<span style="color:var(--accent)">🔍 AI 深度審查中...</span>`;
    const critique = await critiqueSectionWithAI(s, valuesFor(s), settings);
    if (feedbackEl) {
      feedbackEl.innerHTML = `
        <div style="padding:6px;background:var(--inset);border-radius:var(--radius-sm);margin-top:4px">
          <strong>${critique.summary}</strong>
          <ul style="margin:4px 0 0;padding-left:16px">
            ${critique.warnings.map((w) => `<li style="color:var(--warn,#d9534f)">${escapeHtml(w)}</li>`).join("")}
            ${critique.suggestions.map((sg) => `<li style="color:var(--accent)">${escapeHtml(sg)}</li>`).join("")}
          </ul>
        </div>
      `;
    }
  });

  // AI Custom Prompt Send
  document.getElementById("btn-ai-send")?.addEventListener("click", async () => {
    if (!editable()) {
      toast("目前身分無法編輯內文");
      return;
    }
    const input = document.getElementById("ai-prompt-input") as HTMLInputElement | null;
    const promptText = input?.value.trim();
    if (!promptText) {
      toast("請先輸入提問或指令");
      return;
    }
    const feedbackEl = document.getElementById("ai-feedback");
    if (feedbackEl) feedbackEl.innerHTML = `<span style="color:var(--accent)">🤖 處理指令中：「${escapeHtml(promptText)}」...</span>`;
    const patch = await generateAIDraft(s, valuesFor(s), promptText);
    for (const key in patch) {
      store.setSectionField(s.id, key, patch[key]);
    }
    toast("AI 已根據您的指令更新內容");
    if (input) input.value = "";
    renderEditor();
    renderOutline();
    renderCoach();
  });

  if (!editable()) {
    coach.querySelectorAll("button, input").forEach((el) => {
      if ((el as HTMLElement).id === "btn-ai-audit") return;
      (el as HTMLButtonElement).disabled = true;
    });
  }
}

function sectionFilled(sectionId: string): boolean {
  const vals = store.get().sectionValues[sectionId] ?? {};
  return Object.values(vals).some((v) => String(v).trim().length > 0);
}

function renderBeginnerCoach() {
  const params = new URLSearchParams(location.search);
  if (params.get("beginner") === "1") setBeginnerMode(true);
  if (!isBeginnerMode()) {
    document.getElementById("beginner-coach")?.remove();
    return;
  }

  let bar = document.getElementById("beginner-coach");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "beginner-coach";
    bar.className = "beginner-coach";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "PRD 新手教練");
    const host = document.getElementById("flow-strip-host");
    const toolbar = document.querySelector(".toolbar");
    if (host) host.insertAdjacentElement("afterend", bar);
    else toolbar?.insertAdjacentElement("afterend", bar);
  }

  const activeId = store.get().activeSectionId;
  const track = EDITOR_BEGINNER_TRACK;
  const doneCount = track.filter((t) => sectionFilled(t.sectionId)).length;
  const next = track.find((t) => !sectionFilled(t.sectionId));

  bar.innerHTML = `
    <div class="beginner-coach-head">
      <strong>🌱 新手教練</strong>
      <span class="mono">${doneCount}/${track.length} 核心章節已有內容</span>
      <button type="button" class="btn btn-sm btn-ghost" id="btn-beginner-dismiss">結束教練</button>
    </div>
    <div class="beginner-coach-track">
      ${track
        .map((t) => {
          const done = sectionFilled(t.sectionId);
          const on = t.sectionId === activeId;
          return `<button type="button" class="beginner-step ${done ? "done" : ""} ${on ? "on" : ""}" data-sec="${escapeHtml(t.sectionId)}" title="${escapeHtml(t.hint)}">
            <span class="beginner-step-mark">${done ? "✓" : "·"}</span>
            <span>${escapeHtml(t.label)}</span>
          </button>`;
        })
        .join("")}
    </div>
    <p class="beginner-coach-hint">
      ${
        next
          ? `下一步：補齊「<strong>${escapeHtml(next.label)}</strong>」— ${escapeHtml(next.hint)}`
          : "核心骨架已齊，可補使用者故事／開放問題，通過結構 gate 後送審。"
      }
    </p>
  `;

  bar.querySelectorAll("[data-sec]").forEach((btn) => {
    (btn as HTMLButtonElement).onclick = () => {
      const id = (btn as HTMLElement).dataset.sec!;
      const i = sections().findIndex((s) => s.id === id);
      if (i >= 0) {
        idx = i;
        store.setActiveSection(id);
        render();
      }
    };
  });
  document.getElementById("btn-beginner-dismiss")?.addEventListener("click", () => {
    setBeginnerMode(false);
    bar?.remove();
    toast("已關閉新手教練（可從專案列表再開新手引導）");
  });
}

function render() {
  // restore idx from active section
  const activeId = store.get().activeSectionId;
  const found = sections().findIndex((s) => s.id === activeId);
  if (found >= 0) idx = found;
  const sectionChanged = prevIdx >= 0 && prevIdx !== idx;
  syncProjectChrome();
  renderOutline();
  renderEditor();
  renderCoach();
  renderBeginnerCoach();
  syncUser();
  const host = document.getElementById("flow-strip-host");
  if (host) {
    const hasPlanSteps = Object.values(planModules).some((raw) => /^- \[[ xXvV]\]/m.test(raw));
    host.innerHTML = renderFlowStripHtml(deriveFlowLayers(store.get(), { hasPlanSteps }));
  }

  // Phase A：章節切換視線錨定；送審就緒單次 pulse
  if (sectionChanged) {
    const head = document.querySelector(".adhd-sec-header") ?? document.getElementById("editor-body");
    flashFocus(head);
    flashFocus(document.querySelector(".adhd-coach-now"));
  }
  prevIdx = idx;

  const gate = evaluatePrdGates(store.get());
  const submitBtn = document.getElementById("btn-submit");
  pulseSubmitWhenBecameReady(submitBtn, gate.canSubmit && editable());
  syncMotionPreferenceClass();
}

// Apply pending template insert into current section first field
const pending = store.consumePendingInsert();
if (pending && editable()) {
  const s = sections()[idx] ?? sections()[0];
  if (s?.fields[0]) {
    const cur = valuesFor(s)[s.fields[0].key] ?? "";
    const next = cur ? `${cur}\n\n${pending}` : pending;
    store.setSectionField(s.id, s.fields[0].key, next);
    if (s.status === "empty") store.updateSection(s.id, { status: "warn" });
    toast("已插入範本段落");
  }
} else if (pending && !editable()) {
  toast("目前身分無法插入範本到內文");
}

document.getElementById("btn-prev")?.addEventListener("click", () => {
  if (idx > 0) {
    idx--;
    store.setActiveSection(sections()[idx]!.id);
    render();
  }
});

document.getElementById("btn-next")?.addEventListener("click", () => {
  const list = sections();
  if (idx < list.length - 1) {
    idx++;
    store.setActiveSection(list[idx]!.id);
    render();
  } else {
    toast("所有章節已走完 — 可送出審閱");
  }
});

document.getElementById("btn-submit")?.addEventListener("click", () => {
  if (!editable()) {
    toast("目前身分無法送出編輯成果");
    return;
  }
  const gate = evaluatePrdGates(store.get());
  if (!gate.canSubmit) {
    toast(gateSummaryLine(gate) + " — 請先補齊 BLOCK 項");
    renderCoach();
    return;
  }
  store.submitForReview();
  toast("結構檢查通過，已送出審閱佇列");
  window.setTimeout(() => {
    location.href = "review.html";
  }, 600);
});

document.getElementById("btn-outline")?.addEventListener("click", () => {
  toast("大綱已在左側固定顯示");
});

document.getElementById("btn-export-md")?.addEventListener("click", () => {
  exportMarkdownFile(store.get());
  toast("已下載 Markdown");
});

document.getElementById("btn-toggle-samples")?.addEventListener("click", () => {
  const next = !store.get().showSamples;
  store.setShowSamples(next);
  toast(next ? "已展示範例內文" : "已清空範例內文");
  render();
});

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    document.getElementById("btn-next")?.click();
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    toast("已儲存");
  }
});

// Phase B：教練 / 章節指南 details 展開淡入（動態重建，用委派）
document.getElementById("coach-body")?.addEventListener(
  "toggle",
  (e) => {
    const t = e.target;
    if (!(t instanceof HTMLDetailsElement) || !t.open) return;
    expandEnter(t.querySelector(":scope > :not(summary)") ?? t);
  },
  true,
);
document.getElementById("editor-body")?.addEventListener(
  "toggle",
  (e) => {
    const t = e.target;
    if (!(t instanceof HTMLDetailsElement) || !t.open) return;
    expandEnter(t.querySelector(":scope > :not(summary)") ?? t);
  },
  true,
);

render();
} // end __authed
