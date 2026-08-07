import {
  AiError,
  critiqueSectionWithAI,
  generateAIDraft,
  getAiReadiness,
  isAiConfigured,
  polishTextWithAI,
} from "../lib/ai-coach";
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
import {
  buildFileTree,
  renderFileTreeHtml,
  SECTION_TO_OPENSPEC,
  sourceFileForSection,
} from "../lib/file-tree";
import { initHelpOverlay } from "../lib/help-overlay";
import { askForProjectFolder } from "../lib/project-folder";
import { initFocusMode, renderProgress } from "../lib/focus-mode";
import {
  bindResumeTracking,
  ensureStarter,
  initHyperfocusGuard,
  markActivity,
  restoreCaret,
} from "../lib/writing-assist";
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
      : "回總覽選一個專案";
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

/**
 * 上層：專案資料夾檔案樹（哪些是 PRD 來源、哪些是 OpenSpec 產出）
 *
 * 用簽章擋掉不必要的重繪：store 每次按鍵都 emit，無條件重建會清掉
 * 使用者的展開／捲動狀態。
 */
let lastTreeSig = "__init__";

/**
 * 大綱欄的可收合區塊。三塊共用一支：OpenSpec 章節、Task List、專案檔案。
 * 收合狀態各自記在 localStorage —— 每次開編輯台都要重收一次是懲罰。
 */
function initCollapsible(btnId: string, bodyId: string, storageKey: string, label: string) {
  const btn = document.getElementById(btnId) as HTMLButtonElement | null;
  const body = document.getElementById(bodyId) as HTMLElement | null;
  if (!btn || !body) return;

  const apply = (collapsed: boolean) => {
    body.hidden = collapsed;
    btn.classList.toggle("is-collapsed", collapsed);
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    btn.title = `${collapsed ? "展開" : "收合"} ${label}`;
  };

  let collapsed = false;
  try {
    collapsed = localStorage.getItem(storageKey) === "1";
  } catch {
    /* private mode */
  }
  apply(collapsed);

  btn.addEventListener("click", () => {
    collapsed = !collapsed;
    apply(collapsed);
    try {
      localStorage.setItem(storageKey, collapsed ? "1" : "0");
    } catch {
      /* private mode */
    }
  });
}

const FT_COLLAPSE_KEY = "specforge:file-tree-collapsed";

const FT_HEIGHT_KEY = "specforge:file-tree-height";

/**
 * 檔案樹高度拖曳。
 * 「章節」與「專案檔案」誰該多分一點，只有當下在做什麼的你知道 ——
 * 寫死一個比例一定會有人不滿意，給把手比猜便宜。
 */
function initFileTreeResize() {
  const col = document.querySelector('[data-od-id="outline-col"]') as HTMLElement | null;
  const grip = document.getElementById("file-tree-resize") as HTMLElement | null;
  const host = document.getElementById("file-tree") as HTMLElement | null;
  if (!col || !grip || !host) return;

  const MIN = 90;
  const apply = (h: number) => col.style.setProperty("--ft-h", `${Math.round(h)}px`);

  try {
    const saved = Number(localStorage.getItem(FT_HEIGHT_KEY));
    if (saved >= MIN) apply(saved);
  } catch {
    /* private mode */
  }

  let startY = 0;
  let startH = 0;
  const max = () => Math.max(MIN, col.clientHeight - 180); // 章節至少留 180px

  const onMove = (e: PointerEvent) => {
    // 把手在檔案樹「上方」，往上拖 = 變高，所以要取負號
    apply(Math.min(max(), Math.max(MIN, startH - (e.clientY - startY))));
  };
  const onUp = () => {
    // 監聽掛在 window：滑鼠拖到把手外面（很常見）仍然要跟得上，
    // 而且 setPointerCapture 失敗時不會整個拖不動。
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    grip.classList.remove("is-dragging");
    document.body.style.userSelect = "";
    try {
      localStorage.setItem(FT_HEIGHT_KEY, String(host.offsetHeight));
    } catch {
      /* private mode */
    }
  };

  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    startY = e.clientY;
    startH = host.offsetHeight;
    grip.classList.add("is-dragging");
    document.body.style.userSelect = "none";
    try {
      grip.setPointerCapture(e.pointerId);
    } catch {
      /* 沒有 capture 也能拖，只是拖太快可能掉幀 */
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}


/** 檔案樹收合成一條標題列。狀態要留著 —— 每次開編輯台都要重收一次是懲罰。 */
function initFileTreeCollapse() {
  const col = document.querySelector('[data-od-id="outline-col"]') as HTMLElement | null;
  const btn = document.getElementById("btn-file-tree-toggle") as HTMLButtonElement | null;
  if (!col || !btn) return;

  const apply = (collapsed: boolean) => {
    col.classList.toggle("ft-collapsed", collapsed);
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    btn.title = collapsed ? "展開專案檔案" : "收合專案檔案";
  };

  let collapsed = false;
  try {
    collapsed = localStorage.getItem(FT_COLLAPSE_KEY) === "1";
  } catch {
    /* private mode */
  }
  apply(collapsed);

  btn.addEventListener("click", () => {
    collapsed = !collapsed;
    apply(collapsed);
    try {
      localStorage.setItem(FT_COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      /* private mode */
    }
  });
}

function renderFileTree() {
  const host = document.getElementById("file-tree");
  if (!host) return;
  const p = activeProject();
  const sig = `${p?.id ?? ""}|${p?.sourceFolder ?? ""}|${
    p?.importSummary?.allPaths?.length ?? 0
  }|${sections()[idx]?.id ?? ""}`;
  if (sig === lastTreeSig) return;
  lastTreeSig = sig;
  const tree = p ? buildFileTree(p, sections()) : null;
  const activeId = sections()[idx]?.id ?? "";
  host.innerHTML = renderFileTreeHtml(tree, activeId);

  host.querySelectorAll<HTMLButtonElement>("[data-ft-section]").forEach((btn) => {
    btn.onclick = () => {
      const sid = btn.dataset.ftSection!;
      const i = sections().findIndex((s) => s.id === sid);
      if (i < 0) return;
      idx = i;
      store.setActiveSection(sid);
      render();
    };
  });

  // 空狀態的出口：手動新建的 PRD 也能在這裡補綁資料夾
  const bindBtn = document.getElementById("ft-bind-folder");
  if (bindBtn && p) {
    bindBtn.addEventListener("click", () => askForProjectFolder(p.id, projectDisplayName(p)));
  }

  host.querySelectorAll<HTMLButtonElement>("[data-ft-dir]").forEach((btn) => {
    btn.onclick = () => {
      const open = btn.getAttribute("aria-expanded") !== "false";
      btn.setAttribute("aria-expanded", open ? "false" : "true");
      btn.parentElement?.classList.toggle("is-collapsed", open);
    };
  });
}

/**
 * OpenSpec：偵測專案資料夾底下有沒有 `openspec/`，有就列出裡面的檔案。
 *
 * 讀的是匯入掃描留下的相對路徑（importSummary.allPaths）——
 * App 只存路徑不存內文，所以這裡回答的是「有沒有、有哪些」，不是內容。
 * 沒有這個資料夾就直說，不要用 PRD 章節假裝成 OpenSpec 結構。
 */
function renderOpenSpec() {
  const el = document.getElementById("openspec-list");
  if (!el) return;
  const p = activeProject();
  const all = p?.importSummary?.allPaths ?? [];
  const files = all
    .filter((x) => /(^|\/)openspec\//i.test(x))
    .sort((a, b) => a.localeCompare(b));

  const countEl = document.getElementById("os-count");
  if (countEl) countEl.textContent = files.length ? `${files.length} 檔` : "無";

  if (!p) {
    el.innerHTML = `<p class="os-empty">還沒有選擇專案。</p>`;
    return;
  }
  if (!all.length) {
    el.innerHTML = `<p class="os-empty">這份 PRD 還沒有對應的資料夾，掃不到 <code>openspec/</code>。</p>`;
    return;
  }
  if (!files.length) {
    el.innerHTML = `<p class="os-empty">專案目錄底下沒有 <code>openspec/</code> 資料夾。匯出 OpenSpec 後會出現在這裡。</p>`;
    return;
  }

  // 依 openspec/ 底下的第一層分群（changes / specs / …），只有一層就不分群
  const groups = new Map<string, string[]>();
  for (const f of files) {
    const rest = f.replace(/^.*?openspec\//i, "");
    const parts = rest.split("/");
    const key = parts.length > 1 ? parts[0] : "";
    const arr = groups.get(key) ?? [];
    arr.push(f);
    groups.set(key, arr);
  }

  // 沒有子資料夾的（openspec/project.md 之類）排最前面 ——
  // 夾在兩個有標題的群組中間會看不出它屬於誰
  el.innerHTML = [...groups.entries()]
    .sort((a, b) => (a[0] === "" ? -1 : b[0] === "" ? 1 : a[0].localeCompare(b[0])))
    .map(
      ([key, list]) => `${key ? `<p class="os-group">openspec/${escapeHtml(key)}</p>` : ""}
        ${list
          .map((f) => {
            const name = f.split("/").pop() ?? f;
            return `<div class="os-row os-file-row" title="${escapeHtml(f)}">
              <span class="os-dot done"></span>
              <span class="os-body">
                <span class="os-head">${escapeHtml(name)}</span>
                <span class="os-file">${escapeHtml(f)}</span>
              </span>
            </div>`;
          })
          .join("")}`,
    )
    .join("");
}

function renderOutline() {
  renderFileTree();
  const el = document.getElementById("outline");
  if (!el) return;
  const list = sections();
  // ADHD：大綱只顯示編號＋標題＋狀態。說明一律走 title tooltip ——
  // 選中時展開第二排會讓整列跳動，而且那段字在右邊的教練欄已經有了。
  el.innerHTML = list
    .map((s, i) => {
      const st = s.status === "done" ? "done" : s.status === "warn" ? "warn" : "empty";
      const label = s.status === "done" ? "完成" : s.status === "warn" ? "待補" : "空白";
      const active = i === idx;
      return `<button type="button" class="sec adhd-sec ${active ? "active" : ""}" data-i="${i}" role="option" aria-selected="${active}" data-od-id="sec-${s.id}" title="${escapeHtml(s.desc)}">
      <span class="n">${s.n}</span>
      <span class="adhd-sec-body"><div class="t">${escapeHtml(s.title)}</div></span>
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

  renderOpenSpec();
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

  // 這一節從哪個檔案來、匯出後會落在 OpenSpec 的哪裡
  const srcFile = sourceFileForSection(activeProject(), s.id);

  // 章節導引可摺。空章節「不」展開：那時起手骨架按鈕會出現，
  // 它本身就是「怎麼開始」的答案，再攤開 4 條提示只是要人先讀 6 行才知道按哪個。
  // 寫到一半（有內容但還沒滿）才是真正需要提示的時機。
  const filledLen = Object.values(values).join("").trim().length;
  const guideOpen = filledLen >= 10 && filledLen < 40;

  body.innerHTML = `
    <header class="adhd-sec-header">
      <h3 data-od-id="section-title">${escapeHtml(s.title)}</h3>
      <p class="lead adhd-sec-lead">${escapeHtml(s.desc)}</p>
      <dl class="sec-origin" aria-label="這一節的檔案位置">
        <div class="sec-origin-row">
          <dt>來源檔</dt>
          <dd class="mono">${
            srcFile
              ? escapeHtml(srcFile)
              : `<span class="sec-origin-none">無（本節只存在 SpecForge 內）</span>`
          }</dd>
        </div>
        <div class="sec-origin-row">
          <dt>匯出後</dt>
          <dd class="mono">${escapeHtml(SECTION_TO_OPENSPEC[s.id] ?? "PRD.md › ## Technical Specifications")}</dd>
        </div>
      </dl>
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
      markActivity();
      renderCoach();
      renderOutline();
      renderProgress(idx, list.length);
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
    markActivity();
    renderCoach();
    renderOutline();
    renderProgress(idx, list.length);
  });

  const prev = document.getElementById("btn-prev") as HTMLButtonElement | null;
  const next = document.getElementById("btn-next") as HTMLButtonElement | null;
  if (prev) prev.disabled = idx === 0;
  if (next) next.textContent = idx === list.length - 1 ? "完成" : "下一節";
  renderProgress(idx, list.length);

  // ADHD 寫作輔助：空白章節給起手骨架；游標記錄與中斷復原
  ensureStarter(s, values, (key, value) => {
    if (!editable()) return;
    store.setSectionField(s.id, key, value);
    store.updateSection(s.id, { status: "warn" });
    render();
  });
  bindResumeTracking(s.id);
  restoreCaret(s.id);

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
  // AI 是否就緒屬於設定狀態，不是「你寫錯了」——只放進 summary 行，不搶版面
  const aiReadyNow = getAiReadiness().ok;
  // ADHD R1 迴路反轉：原本 `gateOpen = !gate.canSubmit`，等於「越卡住畫面越吵」。
  // 改成只在快過關時才主動展開細節；卡住時保持安靜，數量留在 summary 行。
  const gateOpen = gate.canSubmit && gate.warns > 0;

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

    <details class="adhd-coach-details card" data-od-id="checklist-card" ${failing.length === 1 ? "open" : ""}>
      <summary>檢查清單 <span class="adhd-details-meta">${passN}/${checks.length}${failing.length > 1 ? ` · 還有 ${failing.length}` : ""}</span></summary>
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
            // 「還沒開始」用中性 ○／muted，不用紅 ✗。等級判定不變，只改視覺。
            const icon = f.untouched ? "○" : f.level === "pass" ? "✔" : f.level === "warn" ? "!" : "✗";
            const color = f.untouched
              ? "var(--muted)"
              : f.level === "pass"
                ? "var(--success)"
                : f.level === "warn"
                  ? "var(--warn)"
                  : "var(--danger)";
            return `<div class="adhd-gate-row${f.untouched ? " is-untouched" : ""}">
              <span style="color:${color}">${icon}</span>
              <span><strong>${escapeHtml(f.label)}</strong>
              <span class="adhd-gate-detail"> — ${escapeHtml(f.untouched ? "還沒開始" : f.detail)}</span></span>
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
      <summary>AI 助教 <span class="adhd-details-meta">${
        aiReadyNow ? escapeHtml(settings.model) : "未設定"
      }</span></summary>
      <p class="adhd-ai-status" id="ai-config-status"></p>
      <div class="adhd-ai-actions">
        <button type="button" class="btn btn-sm btn-accent" id="btn-ai-draft">一鍵生稿</button>
        <button type="button" class="btn btn-sm" id="btn-ai-polish">語調潤色</button>
        <button type="button" class="btn btn-sm" id="btn-ai-audit">本機＋AI 評估</button>
      </div>
      <div class="adhd-ai-prompt-row">
        <input type="text" id="ai-prompt-input" placeholder="指令，如：依本專案補技術線選型" />
        <button type="button" class="btn btn-sm btn-primary" id="btn-ai-send">送出</button>
      </div>
      <div id="ai-feedback" class="adhd-ai-feedback"></div>
      <p class="adhd-ai-hint"><a href="settings.html">偏好設定 → API Key</a></p>
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

  const aiReady = getAiReadiness();
  const statusEl = document.getElementById("ai-config-status");
  if (statusEl) {
    if (aiReady.ok) {
      statusEl.innerHTML = `<span class="adhd-ai-ok">已設定 · ${escapeHtml(settings.model)}</span> 生稿／潤色／指令將呼叫真實 API。`;
      statusEl.className = "adhd-ai-status is-ready";
    } else {
      statusEl.innerHTML = `<span class="adhd-ai-bad">未就緒</span> ${escapeHtml(aiReady.reason)}`;
      statusEl.className = "adhd-ai-status is-blocked";
    }
  }

  const setAiBusy = (busy: boolean) => {
    ["btn-ai-draft", "btn-ai-polish", "btn-ai-audit", "btn-ai-send"].forEach((id) => {
      const b = document.getElementById(id) as HTMLButtonElement | null;
      if (b) b.disabled = busy || (!editable() && id !== "btn-ai-audit");
    });
  };

  const showAiError = (feedbackEl: HTMLElement | null, err: unknown) => {
    const msg = err instanceof AiError || err instanceof Error ? err.message : String(err);
    if (feedbackEl) {
      feedbackEl.innerHTML = `<div class="adhd-ai-err">${escapeHtml(msg)}</div>`;
    }
    toast(msg);
  };

  // 一鍵生稿 — 真實 API only
  document.getElementById("btn-ai-draft")?.addEventListener("click", async () => {
    if (!editable()) {
      toast("目前身分無法編輯內文");
      return;
    }
    if (!isAiConfigured()) {
      toast(getAiReadiness().ok ? "AI 未就緒" : (getAiReadiness() as { reason: string }).reason);
      return;
    }
    const feedbackEl = document.getElementById("ai-feedback");
    if (feedbackEl)
      feedbackEl.innerHTML = `<span class="adhd-ai-busy">正在呼叫 ${escapeHtml(settings.model)} 生稿《${escapeHtml(s.title)}》…</span>`;
    setAiBusy(true);
    try {
      const draft = await generateAIDraft(s, valuesFor(s));
      for (const key in draft) {
        store.setSectionField(s.id, key, draft[key]!);
      }
      toast("AI 生稿已套用");
      if (feedbackEl)
        feedbackEl.innerHTML = `<div class="adhd-ai-ok-msg">已更新欄位：${escapeHtml(Object.keys(draft).join("、"))}</div>`;
      renderEditor();
      renderOutline();
      renderCoach();
    } catch (e) {
      showAiError(feedbackEl, e);
    } finally {
      setAiBusy(false);
    }
  });

  // 語調潤色 — 真實 API only
  document.getElementById("btn-ai-polish")?.addEventListener("click", async () => {
    if (!editable()) {
      toast("目前身分無法編輯內文");
      return;
    }
    if (!isAiConfigured()) {
      const r = getAiReadiness();
      toast(r.ok ? "AI 未就緒" : r.reason);
      return;
    }
    const feedbackEl = document.getElementById("ai-feedback");
    if (feedbackEl)
      feedbackEl.innerHTML = `<span class="adhd-ai-busy">正在呼叫 ${escapeHtml(settings.model)} 潤色…</span>`;
    setAiBusy(true);
    try {
      const current = valuesFor(s);
      const mode = settings.persona === "concise" ? "concise" : settings.persona === "technical" ? "technical" : "executive";
      let n = 0;
      for (const key of Object.keys(current)) {
        const v = current[key];
        if (!v?.trim()) continue;
        const polished = await polishTextWithAI(v, mode);
        store.setSectionField(s.id, key, polished);
        n++;
      }
      if (!n) {
        toast("本章沒有可潤色的內容");
        if (feedbackEl) feedbackEl.innerHTML = `<div class="adhd-ai-err">請先撰寫內容再潤色</div>`;
      } else {
        toast(`已潤色 ${n} 個欄位`);
        if (feedbackEl)
          feedbackEl.innerHTML = `<div class="adhd-ai-ok-msg">已用 ${escapeHtml(settings.model)} 潤色 ${n} 欄</div>`;
        renderEditor();
        renderOutline();
        renderCoach();
      }
    } catch (e) {
      showAiError(feedbackEl, e);
    } finally {
      setAiBusy(false);
    }
  });

  // 評估：本機規則一定跑；有 Key 再加深 AI
  document.getElementById("btn-ai-audit")?.addEventListener("click", async () => {
    const feedbackEl = document.getElementById("ai-feedback");
    if (feedbackEl)
      feedbackEl.innerHTML = `<span class="adhd-ai-busy">${isAiConfigured() ? "本機規則 + AI 評估中…" : "本機規則檢查中…"}</span>`;
    setAiBusy(true);
    try {
      const critique = await critiqueSectionWithAI(s, valuesFor(s), settings);
      if (feedbackEl) {
        feedbackEl.innerHTML = `
          <div class="adhd-ai-critique">
            <strong>${escapeHtml(critique.summary)}</strong>
            <div class="adhd-ai-score">分數 ${critique.score} · ${critique.grade}${critique.localOnly ? " · 僅本機" : ""}</div>
            <ul>
              ${critique.warnings.map((w) => `<li class="w">${escapeHtml(w)}</li>`).join("")}
              ${critique.suggestions.map((sg) => `<li class="s">${escapeHtml(sg)}</li>`).join("")}
            </ul>
          </div>
        `;
      }
    } catch (e) {
      showAiError(feedbackEl, e);
    } finally {
      setAiBusy(false);
    }
  });

  // 自訂指令 — 真實 API only
  document.getElementById("btn-ai-send")?.addEventListener("click", async () => {
    if (!editable()) {
      toast("目前身分無法編輯內文");
      return;
    }
    if (!isAiConfigured()) {
      const r = getAiReadiness();
      toast(r.ok ? "AI 未就緒" : r.reason);
      return;
    }
    const input = document.getElementById("ai-prompt-input") as HTMLInputElement | null;
    const promptText = input?.value.trim();
    if (!promptText) {
      toast("請先輸入提問或指令");
      return;
    }
    const feedbackEl = document.getElementById("ai-feedback");
    if (feedbackEl)
      feedbackEl.innerHTML = `<span class="adhd-ai-busy">處理指令：「${escapeHtml(promptText)}」…</span>`;
    setAiBusy(true);
    try {
      const patch = await generateAIDraft(s, valuesFor(s), promptText);
      for (const key in patch) {
        store.setSectionField(s.id, key, patch[key]!);
      }
      toast("AI 已依指令更新內容");
      if (input) input.value = "";
      if (feedbackEl)
        feedbackEl.innerHTML = `<div class="adhd-ai-ok-msg">已更新：${escapeHtml(Object.keys(patch).join("、"))}</div>`;
      renderEditor();
      renderOutline();
      renderCoach();
    } catch (e) {
      showAiError(feedbackEl, e);
    } finally {
      setAiBusy(false);
    }
  });

  // 未設定 Key：生稿／潤色／指令禁用；評估仍可用（本機）
  if (!isAiConfigured()) {
    ["btn-ai-draft", "btn-ai-polish", "btn-ai-send"].forEach((id) => {
      const b = document.getElementById(id) as HTMLButtonElement | null;
      if (b) {
        b.disabled = true;
        b.title = "請先在偏好設定填入 API Key";
      }
    });
    const inp = document.getElementById("ai-prompt-input") as HTMLInputElement | null;
    if (inp) {
      inp.disabled = true;
      inp.placeholder = "需先設定 API Key";
    }
  }

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
    toast("已關閉新手教練");
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

// ⌥F 快捷鍵與狀態還原；同步執行，不能靠 rAF（分頁在背景時 rAF 不觸發）
initFileTreeCollapse();
initFileTreeResize();
initCollapsible("btn-openspec-toggle", "openspec-list", "specforge:openspec-collapsed", "OpenSpec 章節");
initFocusMode();
initHyperfocusGuard();
render();
// 綁定資料夾後檔案樹要立刻長出來；簽章比對讓打字時的 emit 不會觸發重繪
store.subscribe(renderFileTree);
} // end __authed
