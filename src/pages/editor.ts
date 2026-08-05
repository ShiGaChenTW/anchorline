import { critiqueSectionWithAI, generateAIDraft, polishTextWithAI } from "../lib/ai-coach";
import { evaluateChecks, liveScore, store } from "../data/store";
import type { Section } from "../data/types";
import { bindLogout, requireAuth, roleBadge } from "../lib/auth";
import { exportMarkdownFile } from "../lib/export";
import { canEditContent } from "../lib/permissions";
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

function editable(): boolean {
  return canEditContent(store.get().currentUser) && !store.get().locked;
}

function syncUser() {
  const u = store.get().currentUser;
  updateUserRailFooter({
    name: u.name,
    role: `${roleBadge(u.accessRole)} · ${u.title}`,
    avatar: u.avatar,
  });
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
  el.innerHTML = list
    .map((s, i) => {
      const st = s.status === "done" ? "done" : s.status === "warn" ? "warn" : "empty";
      const label = s.status === "done" ? "完成" : s.status === "warn" ? "待補" : "空白";
      return `<button type="button" class="sec ${i === idx ? "active" : ""}" data-i="${i}" role="option" aria-selected="${i === idx}" data-od-id="sec-${s.id}">
      <span class="n">${s.n}</span>
      <span><div class="t">${escapeHtml(s.title)}</div><div class="d">${escapeHtml(s.desc)}</div></span>
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
      const rows = f.rows || 4;
      return `<div class="field" data-od-id="field-${f.key}">
      <label>${escapeHtml(f.label)}<span>${escapeHtml(f.hint || "")}</span></label>
      <textarea data-key="${f.key}" rows="${rows}">${escapeHtml(val)}</textarea>
    </div>`;
    })
    .join("");

  const body = document.getElementById("editor-body");
  if (!body) return;
  body.innerHTML = `
    <h3 data-od-id="section-title">${escapeHtml(s.title)}</h3>
    <p class="lead">${escapeHtml(s.desc)}</p>
    <div class="guide" data-od-id="guide">
      <strong>本章怎麼寫</strong>
      ${escapeHtml(s.guide)}
      <ul>${s.tips.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>
    </div>
    ${fields}
    <div class="hint">變更會即時反映右側品質檢查 · <span class="mono">⌘↵</span> 下一節</div>
  `;

  body.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-key]").forEach((input) => {
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
  coach.innerHTML = `
    <div class="card" data-od-id="score-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <h4 style="margin:0">本章品質</h4>
        <span class="pill pill-review" style="font-size:10px">${escapeHtml(settings.model)}</span>
      </div>
      <div class="score-ring">
        <div class="ring" style="--p:${score}"><b>${score}</b></div>
        <div>
          <div style="font-weight:600;font-size:14px">${score >= 85 ? "可送審" : score >= 70 ? "接近完成" : "需補強"}</div>
          <div class="mono" style="margin-top:4px">${passN}/${checks.length} 檢查通過</div>
        </div>
      </div>
    </div>

    <div class="card" data-od-id="prd-gate-card">
      <h4>結構 gate（SCVB）</h4>
      <div class="mono" style="font-size:11px;color:var(--muted);margin-bottom:8px">${escapeHtml(gateSummaryLine(gate))} · score ${gate.score}</div>
      <div class="check-list">
        ${gate.findings
          .map((f) => {
            const icon = f.level === "pass" ? "✔" : f.level === "warn" ? "!" : "✗";
            const color =
              f.level === "pass" ? "var(--success)" : f.level === "warn" ? "var(--warn)" : "var(--danger)";
            return `<div style="display:flex;gap:8px;margin-bottom:6px;font-size:12px">
              <span style="color:${color};width:14px">${icon}</span>
              <span><strong style="color:var(--fg)">${escapeHtml(f.label)}</strong>
              <span style="color:var(--muted)"> — ${escapeHtml(f.detail)}</span></span>
            </div>`;
          })
          .join("")}
      </div>
      ${
        !gate.canSubmit
          ? `<div style="margin-top:8px;font-size:12px;color:var(--danger)">有 BLOCK 項時無法送審</div>`
          : `<div style="margin-top:8px;font-size:12px;color:var(--success)">可送審</div>`
      }
      <div style="margin-top:8px"><a href="tracking.html" style="color:var(--accent);font-size:12px">開啟計劃追蹤 →</a></div>
    </div>

    <!-- AI Coach Tools -->
    <div class="card" data-od-id="ai-tools-card" style="border:1px solid color-mix(in oklab, var(--accent) 40%, var(--border))">
      <h4 style="display:flex;align-items:center;gap:6px">🤖 AI 寫作教練助教</h4>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
        <button type="button" class="btn btn-sm btn-accent" id="btn-ai-draft">✨ 一鍵 AI 生稿</button>
        <button type="button" class="btn btn-sm" id="btn-ai-polish">🪄 AI 語調潤色</button>
        <button type="button" class="btn btn-sm" id="btn-ai-audit">🔍 深度評估</button>
      </div>

      <!-- Prompt Input -->
      <div style="display:flex;gap:6px">
        <input type="text" id="ai-prompt-input" placeholder="對 AI 提問，如：補充資安評估" style="flex:1;font-size:12px;padding:6px 10px;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg);color:var(--fg)" />
        <button type="button" class="btn btn-sm btn-primary" id="btn-ai-send">送出</button>
      </div>
      <div id="ai-feedback" style="margin-top:8px;font-size:12px;color:var(--muted);line-height:1.4"></div>
    </div>

    <div class="card" data-od-id="checklist-card">
      <h4>檢查清單</h4>
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
    </div>
    <div class="card" data-od-id="example-card">
      <h4>好例子</h4>
      <div class="example">${escapeHtml(s.example)}</div>
    </div>
    <div class="card" data-od-id="next-card">
      <h4>建議下一步</h4>
      <ol>
        ${
          checks
            .filter((c) => !c.pass)
            .slice(0, 2)
            .map((c) => `<li>補齊：${escapeHtml(c.label)}</li>`)
            .join("") || "<li>本章已達標，可進下一節或送出審閱。</li>"
        }
        <li><a href="templates.html" style="color:var(--accent)">從範本庫插入段落</a></li>
      </ol>
    </div>
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

function render() {
  // restore idx from active section
  const activeId = store.get().activeSectionId;
  const found = sections().findIndex((s) => s.id === activeId);
  if (found >= 0) idx = found;
  renderOutline();
  renderEditor();
  renderCoach();
  syncUser();
  const host = document.getElementById("flow-strip-host");
  if (host) {
    const hasPlanSteps = Object.values(planModules).some((raw) => /^- \[[ xXvV]\]/m.test(raw));
    host.innerHTML = renderFlowStripHtml(deriveFlowLayers(store.get(), { hasPlanSteps }));
  }
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

// stamp autosave time
const sub = document.querySelector(".toolbar .sub");
if (sub) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  sub.textContent = `identity / prd-2fa · 自動儲存 ${hh}:${mm}`;
}

render();
} // end __authed
