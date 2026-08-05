/**
 * L1–L6 流程層（S.CodingFlow SSOT 詞彙）
 * 由 PRD / 計劃 / 專案狀態粗推導，供 hub、editor、tracking 共用。
 */
import type { AppState } from "../data/types";
import { evaluatePrdGates } from "./prd-gates";

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

export function deriveFlowLayers(
  state: AppState,
  opts?: { hasPlanSteps?: boolean },
): FlowLayer[] {
  const gate = evaluatePrdGates(state);
  const summary = state.sectionValues.summary ?? {};
  const problem = (state.sectionValues.problem?.problem ?? "").trim();
  const hasIntent = !!(summary.what?.trim() || problem.length > 20);
  const hasSpec = gate.canSubmit;
  const hasPlan = !!opts?.hasPlanSteps;
  const inReview = state.projects.some((p) => p.status === "review");
  const approved = state.locked || state.projects.some((p) => p.status === "approved");
  const implementing = state.projects.some(
    (p) => p.status === "review" || p.status === "approved" || p.pct >= 40,
  );

  const doneMap: Record<FlowLayerId, boolean> = {
    l1: hasIntent,
    l2: hasSpec,
    l3: hasPlan,
    l4: implementing,
    l5: inReview || approved,
    l6: approved,
  };

  // active = 第一個未完成層
  let activeId: FlowLayerId = "l1";
  for (const d of FLOW_LAYER_DEFS) {
    if (!doneMap[d.id]) {
      activeId = d.id;
      break;
    }
    activeId = d.id;
  }

  const hints: Record<FlowLayerId, string> = {
    l1: "寫清做什麼／給誰／為何現在",
    l2: "Non-Goals≥3、可量測指標後可送審",
    l3: "在 plans/ 維護 Plan Steps",
    l4: "Agent 進場或人工撰寫章節",
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
  return `<div class="flow-strip" role="list" aria-label="L1 到 L6 流程">
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
