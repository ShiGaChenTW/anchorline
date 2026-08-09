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

  const hints: Record<FlowLayerId, string> = {
    l1: "寫清做什麼／給誰／為何現在",
    l2: "Non-Goals≥3、可量測指標後可送審",
    l3: "在 plans/ 維護 Plan Steps（bun run track）",
    l4: "補齊章節內容或呼叫編輯 Agent",
    l5: "審閱佇列簽核中",
    l6: "已核准鎖定／匯出交付",
  };

  return FLOW_LAYER_DEFS.map((d) => ({
    ...d,
    done: doneMap[d.id],
    active: d.id === activeId && !doneMap.l6,
    hint: hints[d.id],
  }));
}

/** 渲染水平流程條 HTML */
export function renderFlowStripHtml(layers: FlowLayer[]): string {
  return `<div class="flow-strip" role="list" aria-label="L1 到 L6 流程（依目前焦點專案）">
    ${layers
      .map((l) => {
        const cls = l.done ? "is-done" : l.active ? "is-active" : "is-todo";
        return `<div class="flow-strip-step ${cls}" role="listitem" title="${l.hint}">
          <span class="code">${l.code}</span>
          <span class="name">${l.name}</span>
        </div>`;
      })
      .join('<span class="flow-strip-sep" aria-hidden="true">→</span>')}
  </div>`;
}
