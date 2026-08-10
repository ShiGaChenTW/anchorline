/**
 * L1–L6 流程層（S.CodingFlow SSOT 詞彙）
 * 以「目前焦點專案」推導，避免 workspace 任一案已核准就 L1–L6 全綠。
 */
import type { AppState, Project } from "../data/types";
import { evaluatePrdGates } from "./prd-gates";
import type { GateSpec } from "./gate-rules";

export type FlowLayerId = "l1" | "l2" | "l3" | "l4" | "l5" | "l6";

export type FlowLayer = {
  id: FlowLayerId;
  code: string;
  name: string;
  done: boolean;
  active: boolean;
  hint: string;
};

export const FLOW_LAYER_DEFS: readonly { id: FlowLayerId; code: string; name: string }[] = [
  { id: "l1", code: "L1", name: "意圖" },
  { id: "l2", code: "L2", name: "規格" },
  { id: "l3", code: "L3", name: "計劃" },
  { id: "l4", code: "L4", name: "實作" },
  { id: "l5", code: "L5", name: "驗證" },
  { id: "l6", code: "L6", name: "交付" },
] as const;

function activeProject(state: AppState): Project | null {
  return (
    state.projects.find((p) => p.id === state.activeProjectId) ??
    state.projects.find((p) => p.id === "p1") ??
    state.projects[0] ??
    null
  );
}

export function deriveFlowLayers(
  state: AppState,
  opts?: { hasPlanSteps?: boolean; gateSpec?: GateSpec },
): FlowLayer[] {
  // gateSpec 由呼叫端給（store.activeGateSpec()）——這個檔是純函式，不該認得 store
  const gate = evaluatePrdGates(state, opts?.gateSpec);
  const summary = state.sectionValues.summary ?? {};
  const problem = (state.sectionValues.problem?.problem ?? "").trim();
  const project = activeProject(state);

  const hasIntent = !!(summary.what?.trim() && summary.who?.trim()) || problem.length > 40;
  const hasSpec = gate.canSubmit;
  // 不可預設 true：否則一進畫面 L3 永遠完成
  const hasPlan = opts?.hasPlanSteps === true;

  const status = project?.status ?? "draft";
  const locked = state.locked && state.activeProjectId === (project?.id ?? state.activeProjectId);

  // 實作：草稿有進度，或已進入審閱（仍不算交付）
  const implementing =
    status === "review" ||
    status === "approved" ||
    status === "withdrawn" ||
    (status === "draft" && (project?.pct ?? 0) >= 25);

  const verifying = status === "review" || status === "approved" || locked;
  const delivered = status === "approved" || locked;

  const doneMap: Record<FlowLayerId, boolean> = {
    l1: hasIntent,
    l2: hasSpec,
    l3: hasPlan,
    l4: implementing && hasSpec,
    l5: verifying,
    l6: delivered,
  };

  let activeId: FlowLayerId = "l6";
  for (const d of FLOW_LAYER_DEFS) {
    if (!doneMap[d.id]) {
      activeId = d.id;
      break;
    }
  }

  return FLOW_LAYER_DEFS.map((d) => ({
    ...d,
    done: doneMap[d.id],
    active: d.id === activeId && !doneMap.l6,
    hint: FLOW_LAYER_DOCS[d.id].next,
  }));
}

/**
 * 每一層的完整說明。
 * 原本只有一行 hint 塞在 title 屬性裡 —— 要停在上面等一秒才浮出來，
 * 而且沒告訴使用者「它為什麼是這個顏色」「要做什麼才會變綠」，
 * 等於有等於沒有。拆成四個問題各自回答。
 */
export type FlowLayerDoc = {
  /** 這一層在做什麼 */
  what: string;
  /** 什麼條件會讓它變綠（判定依據，對應 deriveFlowLayers 的 doneMap） */
  passWhen: string;
  /** 還沒完成時現在該做什麼 */
  next: string;
  /** 動作在哪一頁；已經在該頁時不顯示按鈕 */
  goto?: { href: string; label: string };
};

export const FLOW_LAYER_DOCS: Record<FlowLayerId, FlowLayerDoc> = {
  l1: {
    what: "把「要做什麼、給誰、為何是現在」講清楚，這是後面所有判斷的基準。",
    passWhen: "三行摘要的「做什麼」與「給誰」都有填，或問題陳述超過 40 字。",
    next: "回到 01·三行摘要，先寫做什麼／給誰。",
    goto: { href: "editor.html", label: "去寫摘要" },
  },
  l2: {
    what: "規格要完整到能被審閱 —— 也就是通過送審 gate 的檢查。",
    passWhen: "所有送審 gate 都通過（Non-Goals 至少 3 條、指標可量測等）。",
    next: "看編輯頁的 gate 檢查，把紅色項目補齊。",
    goto: { href: "editor.html", label: "去補規格" },
  },
  l3: {
    what: "把規格拆成可追蹤的執行步驟，落在 plans/ 目錄裡。",
    passWhen: "plans/ 有這個專案的 Plan Steps（`bun run track` 產生）。",
    next: "在 plans/ 建立步驟清單，或跑 `bun run track`。",
    goto: { href: "tracking.html", label: "開追蹤頁" },
  },
  l4: {
    what: "依照規格與計劃實際把內容寫出來。",
    passWhen: "規格已通過 gate，且專案進度達 25% 以上或已送審。",
    next: "補齊章節內容，或用寫作教練的 AI 撰寫。",
    goto: { href: "editor.html", label: "回編輯" },
  },
  l5: {
    what: "送進審閱佇列，由對應角色逐關簽核。",
    passWhen: "專案已送審、已核准，或已鎖定。",
    next: "按右上角「送出審閱」把這版送進佇列。",
    goto: { href: "review.html", label: "開審閱佇列" },
  },
  l6: {
    what: "簽核完成、版本鎖定，可以匯出交付。",
    passWhen: "專案已核准，或已鎖定。",
    next: "等所有簽核關卡完成後才會亮。",
    goto: { href: "review.html", label: "看簽核進度" },
  },
};

const STATUS_TEXT = { done: "已完成", active: "進行中", todo: "未開始" } as const;

function statusOf(l: FlowLayer): keyof typeof STATUS_TEXT {
  return l.done ? "done" : l.active ? "active" : "todo";
}

/** 單層說明卡（純函式，方便測試） */
export function flowLayerDetailHtml(l: FlowLayer, currentPage = ""): string {
  const doc = FLOW_LAYER_DOCS[l.id];
  const st = statusOf(l);
  // 已經在目的頁就別給按鈕 —— 點了只會重載並丟掉現場
  const goto =
    doc.goto && !currentPage.endsWith(doc.goto.href)
      ? `<a class="fsd-go" href="${doc.goto.href}">${doc.goto.label} →</a>`
      : "";
  return `<div class="fsd-head">
      <span class="fsd-code">${l.code}</span>
      <b>${l.name}</b>
      <span class="fsd-status is-${st}">${STATUS_TEXT[st]}</span>
    </div>
    <p class="fsd-what">${doc.what}</p>
    <dl class="fsd-dl">
      <dt>何時會亮綠</dt><dd>${doc.passWhen}</dd>
      ${l.done ? "" : `<dt>現在該做</dt><dd>${doc.next}</dd>`}
    </dl>
    ${goto}`;
}

/** 最後一次渲染的層狀態，供委派 handler 取用 */
let lastLayers: FlowLayer[] = [];

/** 渲染水平流程條 HTML */
export function renderFlowStripHtml(layers: FlowLayer[]): string {
  lastLayers = layers;
  ensureFlowStripDelegate();
  // role=group 而非 list：listitem 會蓋掉 button 的角色，
  // 輔助技術會把可點的東西唸成清單項目，而且拿不到可存取名稱。
  return `<div class="flow-strip" role="group" aria-label="L1 到 L6 流程（依目前焦點專案）">
    <span class="flow-strip-label">流程<span class="flow-strip-tip">點階段看說明</span></span>
    ${layers
      .map((l) => {
        const cls = l.done ? "is-done" : l.active ? "is-active" : "is-todo";
        const st = l.done ? "已完成" : l.active ? "進行中" : "未開始";
        return `<button type="button" class="flow-strip-step ${cls}"
          data-flow-step="${l.id}" aria-expanded="false"
          aria-label="${l.code} ${l.name}，${st}，點開說明">
          <span class="code">${l.code}</span>
          <span class="name">${l.name}</span>
        </button>`;
      })
      .join('<span class="flow-strip-sep" aria-hidden="true">→</span>')}
    <div class="flow-strip-detail" hidden></div>
  </div>`;
}

/**
 * 點擊委派給 document，只裝一次。
 * 三個頁面各自用 innerHTML 重畫這條，直接綁在按鈕上的 listener 每次重畫都會消失；
 * 委派讓它不必知道誰重畫了什麼。
 */
let delegateInstalled = false;
function ensureFlowStripDelegate() {
  if (delegateInstalled || typeof document === "undefined") return;
  delegateInstalled = true;
  document.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement | null)?.closest<HTMLElement>("[data-flow-step]");
    const strip = (ev.target as HTMLElement | null)?.closest(".flow-strip");
    if (!strip) return;
    const detail = strip.querySelector<HTMLElement>(".flow-strip-detail");
    if (!detail) return;
    if (!btn) return;

    const id = btn.dataset.flowStep as FlowLayerId;
    const already = btn.getAttribute("aria-expanded") === "true";
    strip
      .querySelectorAll<HTMLElement>("[data-flow-step]")
      .forEach((b) => b.setAttribute("aria-expanded", "false"));
    if (already) {
      detail.hidden = true;
      return;
    }
    btn.setAttribute("aria-expanded", "true");
    const layer = lastLayers.find((l) => l.id === id);
    if (!layer) return;
    detail.innerHTML = flowLayerDetailHtml(
      layer,
      typeof location === "undefined" ? "" : location.pathname,
    );
    detail.hidden = false;
  });
}
