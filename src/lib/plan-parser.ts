/**
 * 計劃 markdown 解析 — 移植自 S.CodingFlow scvb plan-parser 概念
 * Checkbox： [ ] pending · [x]/[v] done · Plan Steps 內 ~~skip~~
 */

export type StepState = "done" | "skipped" | "pending";

export type PlanStep = { text: string; state: StepState };

export type PlanMeta = {
  title: string;
  status: string;
  created: string;
  updated: string;
  total_steps: number;
  done_steps: number;
  skipped_steps: number;
  pending_steps: number;
  last_decision: string;
  blockers: number;
  next_step: string;
  steps: PlanStep[];
  goal: string;
  path?: string;
};

const CHECKBOX_RE = /^- \[([ vVxX])\]\s*(.*)$/;
const STRIKE_BULLET_RE = /^- ~~(.+?)~~/;

const STATUS_WORDS = ["進行中", "已完成", "已暫停", "已放棄", "阻塞"] as const;

export function parsePlanMeta(text: string, path?: string): PlanMeta {
  const out: PlanMeta = {
    title: "(無標題)",
    status: "未知",
    created: "—",
    updated: "—",
    total_steps: 0,
    done_steps: 0,
    skipped_steps: 0,
    pending_steps: 0,
    last_decision: "—",
    blockers: 0,
    next_step: "—",
    steps: [],
    goal: "—",
    path,
  };
  if (!text) return out;

  const lines = text.split(/\r?\n/);
  let inSteps = false;
  let inGoal = false;
  let inBlockers = false;
  let inDecisions = false;
  const goalParts: string[] = [];

  for (const raw of lines) {
    const s = raw.trim();

    if (s.startsWith("# ") && out.title === "(無標題)") {
      out.title = s.slice(2).trim();
      continue;
    }
    if (s.startsWith("**建立時間：**") || s.startsWith("**建立時間:**")) {
      out.created = s.replace(/\*\*建立時間：?\*\*/, "").trim();
      continue;
    }
    if (s.startsWith("**最後更新：**") || s.startsWith("**最後更新:**")) {
      out.updated = s.replace(/\*\*最後更新：?\*\*/, "").trim();
      continue;
    }
    if (s.startsWith("**狀態：**") || s.startsWith("**狀態:**")) {
      const st = s.replace(/\*\*狀態：?\*\*/, "").trim();
      const hit = STATUS_WORDS.find((w) => st.startsWith(w));
      out.status = hit ?? (st.split(/[（(]/)[0]?.trim() || st);
      continue;
    }

    if (/^##\s+Plan Steps/i.test(s) || s === "## Plan Steps") {
      inSteps = true;
      inGoal = false;
      inBlockers = false;
      inDecisions = false;
      continue;
    }
    if (/^##\s+目標/.test(s)) {
      inGoal = true;
      inSteps = false;
      inBlockers = false;
      inDecisions = false;
      continue;
    }
    if (/^##\s+阻塞/.test(s)) {
      inBlockers = true;
      inSteps = false;
      inGoal = false;
      inDecisions = false;
      continue;
    }
    if (/^##\s+決策/.test(s)) {
      inDecisions = true;
      inSteps = false;
      inGoal = false;
      inBlockers = false;
      continue;
    }
    if (s.startsWith("## ")) {
      inSteps = false;
      inGoal = false;
      inBlockers = false;
      inDecisions = false;
      continue;
    }

    if (inSteps) {
      const m = s.match(CHECKBOX_RE);
      if (m) {
        const mark = m[1]!;
        const textStep = m[2]!.trim();
        const done = mark === "x" || mark === "X" || mark === "v" || mark === "V";
        const state: StepState = done ? "done" : "pending";
        out.steps.push({ text: textStep, state });
        continue;
      }
      const sk = s.match(STRIKE_BULLET_RE);
      if (sk) {
        out.steps.push({ text: sk[1]!.trim(), state: "skipped" });
        continue;
      }
      if (s.startsWith("- ~~")) {
        out.steps.push({ text: s.replace(/^- ~~/, "").replace(/~~$/, "").trim(), state: "skipped" });
      }
      continue;
    }

    if (inGoal && s && !s.startsWith("<!--")) {
      goalParts.push(s);
    }
    if (inBlockers) {
      if (s.startsWith("- ") && !/^-\s*無\s*$/.test(s)) out.blockers += 1;
    }
    if (inDecisions && s.startsWith("- ")) {
      out.last_decision = s.replace(/^- /, "").trim();
    }
  }

  if (goalParts.length) out.goal = goalParts.join(" ").slice(0, 280);

  out.total_steps = out.steps.length;
  out.done_steps = out.steps.filter((x) => x.state === "done").length;
  out.skipped_steps = out.steps.filter((x) => x.state === "skipped").length;
  out.pending_steps = out.steps.filter((x) => x.state === "pending").length;
  const next = out.steps.find((x) => x.state === "pending");
  out.next_step = next?.text ?? "—";

  return out;
}

export function planProgressPct(meta: PlanMeta): number {
  if (!meta.total_steps) return 0;
  return Math.round(((meta.done_steps + meta.skipped_steps) / meta.total_steps) * 100);
}

/** 瀏覽器：從 Vite 無法直接讀 disk plans/；改由頁面 fetch 或預嵌列表 */
export const FLOW_LAYERS = [
  { id: "l1", code: "L1", name: "意圖" },
  { id: "l2", code: "L2", name: "規格" },
  { id: "l3", code: "L3", name: "計劃" },
  { id: "l4", code: "L4", name: "實作" },
  { id: "l5", code: "L5", name: "驗證" },
  { id: "l6", code: "L6", name: "交付" },
] as const;
