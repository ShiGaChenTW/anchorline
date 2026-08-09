/**
 * PRD 結構 gate（程式判定，非 LLM）
 * 概念來自 S.CodingFlow SpecGate：Non-Goals ≥ 3、可量測 Outcomes 等。
 */
import type { AppState } from "../data/types";

export type GateLevel = "pass" | "warn" | "block";

export type GateFinding = {
  id: string;
  level: GateLevel;
  label: string;
  detail: string;
  /**
   * 來源欄位完全空白 = 「還沒開始」，不是「做錯了」。
   * 判定等級不變（仍擋送審），只讓 UI 用中性符號呈現。
   * ADHD／RSD：未嘗試就先看到紅叉會觸發迴避。
   */
  untouched?: boolean;
};

export type GateReport = {
  findings: GateFinding[];
  blocks: number;
  warns: number;
  /**
   * block 中「還沒開始」的數量（來源欄位全空）。
   * `blocks` 不減 —— 送審門檻不變；但跨專案彙總時必須分開講：
   * 把「還沒寫」跟「寫了但不合格」加成同一個數字，會讓總覽首屏
   * 出現一個誇大的阻擋總數，正是本頁想消除的那種焦慮。
   */
  untouchedBlocks: number;
  /** block 中真的「動過但沒過」的數量 = blocks - untouchedBlocks */
  activeBlocks: number;
  /** 可送審：無 block */
  canSubmit: boolean;
  /** 可核准：無 block（可另加更嚴規則） */
  canApprove: boolean;
  score: number;
};

function bullets(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[-*•]/.test(l) || /^\d+[\.\)]/.test(l))
    .map((l) => l.replace(/^[-*•]\s*/, "").replace(/^\d+[\.\)]\s*/, "").trim())
    .filter(Boolean);
}

function fieldJoin(state: AppState, sectionId: string): string {
  const vals = state.sectionValues[sectionId] ?? {};
  return Object.values(vals).join("\n");
}

/** 量測/數字啟發式（對應 vague-outcome WARN） */
const METRIC_RE =
  /\d+\s*%|\d+\s*ms|\d+\s*天|≥|<=|>=|p95|p99|Q[1-4]|覆蓋率|完成率|歸零|少於|大於|至少/;

export function evaluatePrdGates(state: AppState): GateReport {
  const findings: GateFinding[] = [];
  const { sections, sectionValues } = state;

  // Summary core fields（做什麼／給誰／為何現在 = block；技術線選型 = warn）
  const summary = sectionValues["summary"] ?? {};
  const missingSummary = ["what", "who", "why"].filter((k) => !(summary[k] ?? "").trim());
  if (missingSummary.length) {
    findings.push({
      id: "summary-incomplete",
      level: "block",
      label: "三行摘要不完整",
      detail: `缺少欄位：${missingSummary.join(", ")}（做什麼／給誰／為何現在）`,
      untouched: missingSummary.length === 3,
    });
  } else {
    findings.push({
      id: "summary-ok",
      level: "pass",
      label: "三行摘要完整",
      detail: "做什麼／給誰／為何現在皆有內容",
    });
  }
  const tech = (summary.tech ?? "").trim();
  if (!tech || tech.length < 12) {
    findings.push({
      id: "summary-tech-missing",
      level: "warn",
      label: "技術線選型未填",
      detail: "建議在「01 三行摘要」補主技術路徑與至少一項刻意不選（不擋送審，但影響工程對齊）。",
    });
  } else if (!/不選|不做|暫不|排除|不採用|out of scope|non-?goal/i.test(tech)) {
    findings.push({
      id: "summary-tech-boundary",
      level: "warn",
      label: "技術線選型缺邊界",
      detail: "已有技術描述，但未見「刻意不選」— 建議加一行避免 scope 膨脹。",
    });
  } else {
    findings.push({
      id: "summary-tech-ok",
      level: "pass",
      label: "技術線選型已寫",
      detail: "含主路徑與不選邊界",
    });
  }

  // Non-Goals ≥ 3（SpecGate no-non-goals）
  const nongoalsText = (sectionValues["goals"]?.nongoals ?? "").trim();
  const ngBullets = bullets(nongoalsText);
  const ngCount = ngBullets.length || (nongoalsText ? nongoalsText.split(/[;；\n]/).filter((x) => x.trim().length > 4).length : 0);
  if (ngCount < 3) {
    findings.push({
      id: "non-goals-min",
      level: "block",
      label: "Non-Goals 不足 3 條",
      detail: `目前約 ${ngCount} 條。至少 3 條「刻意不做」才能擋 scope 膨脹（S.CodingFlow 契約）。`,
      untouched: !nongoalsText,
    });
  } else {
    findings.push({
      id: "non-goals-ok",
      level: "pass",
      label: "Non-Goals 達標",
      detail: `已有 ${ngCount} 條非目標`,
    });
  }

  // Goals present
  const goalsText = (sectionValues["goals"]?.goals ?? "").trim();
  if (goalsText.length < 20) {
    findings.push({
      id: "goals-thin",
      level: "block",
      label: "目標過薄",
      detail: "目標欄需可驗收描述（建議列點）",
      untouched: !goalsText,
    });
  } else {
    findings.push({
      id: "goals-ok",
      level: "pass",
      label: "目標有內容",
      detail: "目標欄已填寫",
    });
  }

  // Metrics / Desired Outcomes 可量測
  const metrics = fieldJoin(state, "metrics");
  if (metrics.trim().length < 30) {
    findings.push({
      id: "metrics-missing",
      level: "block",
      label: "成功指標空白",
      detail: "需填寫指標／目標／量測（Desired Outcomes）",
      untouched: !metrics.trim(),
    });
  } else if (!METRIC_RE.test(metrics)) {
    findings.push({
      id: "metrics-vague",
      level: "warn",
      label: "成功指標可能不可量測",
      detail: "建議加入數字、%、期限或 p95 等可驗證門檻",
    });
  } else {
    findings.push({
      id: "metrics-ok",
      level: "pass",
      label: "成功指標含可量測訊號",
      detail: "偵測到數字或量測用語",
    });
  }

  // Problem not empty
  const problem = (sectionValues["problem"]?.problem ?? "").trim();
  if (problem.length < 40) {
    findings.push({
      id: "problem-thin",
      level: "warn",
      label: "問題陳述偏短",
      detail: "建議補足痛點、對象與佐證",
    });
  }

  // Open questions without deadline
  const oq = (sectionValues["open"]?.oq ?? "").trim();
  if (oq && !/\d{1,2}\/\d{1,2}|Q\d|週|前|deadline|期限/.test(oq)) {
    findings.push({
      id: "open-no-deadline",
      level: "warn",
      label: "開放問題缺少期限",
      detail: "建議每題有負責人與決策期限",
    });
  }

  // Section status empty count
  const emptySecs = sections.filter((s) => s.status === "empty").length;
  if (emptySecs >= 3) {
    findings.push({
      id: "many-empty",
      level: "warn",
      label: "多個章節仍空白",
      detail: `${emptySecs} 個章節標記為空白`,
    });
  }

  const blockFindings = findings.filter((f) => f.level === "block");
  const blocks = blockFindings.length;
  const untouchedBlocks = blockFindings.filter((f) => f.untouched).length;
  const warns = findings.filter((f) => f.level === "warn").length;
  const passes = findings.filter((f) => f.level === "pass").length;
  const score = Math.max(0, Math.min(100, Math.round((passes / Math.max(1, findings.length)) * 100 - blocks * 15 - warns * 5)));

  return {
    findings,
    blocks,
    warns,
    untouchedBlocks,
    activeBlocks: blocks - untouchedBlocks,
    canSubmit: blocks === 0,
    canApprove: blocks === 0,
    score,
  };
}

export function gateSummaryLine(report: GateReport): string {
  // 全部 block 都是「沒動過」時，講「N 項阻擋」是錯的敘事 —— 那是還沒開始，
  // 不是做錯了。這一行會出現在狀態列，跟總覽的戰情列必須講同一種話。
  if (report.blocks && report.activeBlocks === 0)
    return `PRD 還沒開始（${report.blocks} 個必填章節）`;
  if (report.blocks)
    return `結構檢查：${report.activeBlocks} 項要改${
      report.untouchedBlocks ? ` · ${report.untouchedBlocks} 項還沒開始` : ""
    } · ${report.warns} 警告`;
  if (report.warns) return `結構檢查通過（${report.warns} 則建議）`;
  return "結構檢查全部通過";
}
