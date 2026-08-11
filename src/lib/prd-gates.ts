/**
 * PRD 結構 gate（程式判定，非 LLM）
 * 概念來自 S.CodingFlow SpecGate：Non-Goals ≥ 3、可量測 Outcomes 等。
 *
 * 這個檔現在只剩兩件事：`_base` 領域的規則資料，以及 AppState → 直譯器的轉接。
 * 判定邏輯全在 `gate-rules.ts`；規則本身是資料，所以領域包可以自帶一份而
 * 不必改任何程式（見 `plans/Pm-Spec__2026-08-09__domain-pack-architecture-eval.md`）。
 */
import type { AppState } from "../data/types";
import { CUSTOM_SECTION_ID } from "../data/seed";
import { type GateReport, type GateSpec, runGateSpec } from "./gate-rules";

export type { GateFinding, GateLevel, GateReport } from "./gate-rules";

/** 量測/數字啟發式（對應 vague-outcome WARN） */
const METRIC_RE = "\\d+\\s*%|\\d+\\s*ms|\\d+\\s*天|≥|<=|>=|p95|p99|Q[1-4]|覆蓋率|完成率|歸零|少於|大於|至少";

/** 「刻意不選」的各種寫法 */
const BOUNDARY_RE = "不選|不做|暫不|排除|不採用|out of scope|non-?goal";

/** 期限訊號：日期、季度、或明講的期限字眼 */
const DEADLINE_RE = "\\d{1,2}\\/\\d{1,2}|Q\\d|週|前|deadline|期限";

/**
 * 通用 7 章的規則。這不是「特例」，是一個叫 `_base` 的領域包——
 * 領域包用同一個 `GateSpec` 形狀，差別只在它從 frontmatter 讀進來。
 */
export const BASE_GATE_SPEC: GateSpec = {
  groups: [
    {
      rules: [
        {
          id: "summary-incomplete",
          level: "block",
          label: "三行摘要不完整",
          detail: "缺少欄位：{missing}（做什麼／給誰／為何現在）",
          section: "summary",
          fields: ["what", "who", "why"],
          require: { kind: "present" },
        },
      ],
      pass: { id: "summary-ok", label: "三行摘要完整", detail: "做什麼／給誰／為何現在皆有內容" },
    },
    {
      rules: [
        {
          id: "summary-tech-missing",
          level: "warn",
          label: "技術線選型未填",
          detail: "建議在「01 三行摘要」補主技術路徑與至少一項刻意不選（不擋送審，但影響工程對齊）。",
          section: "summary",
          fields: ["tech"],
          require: { kind: "minLength", n: 12 },
        },
        {
          id: "summary-tech-boundary",
          level: "warn",
          label: "技術線選型缺邊界",
          detail: "已有技術描述，但未見「刻意不選」— 建議加一行避免 scope 膨脹。",
          section: "summary",
          fields: ["tech"],
          require: { kind: "match", re: BOUNDARY_RE, flags: "i" },
        },
      ],
      pass: { id: "summary-tech-ok", label: "技術線選型已寫", detail: "含主路徑與不選邊界" },
    },
    {
      rules: [
        {
          id: "non-goals-min",
          level: "block",
          label: "Non-Goals 不足 3 條",
          detail: "目前約 {count} 條。至少 3 條「刻意不做」才能擋 scope 膨脹（S.CodingFlow 契約）。",
          section: "goals",
          fields: ["nongoals"],
          require: { kind: "bullets", min: 3 },
        },
      ],
      pass: { id: "non-goals-ok", label: "Non-Goals 達標", detail: "已有 {count} 條非目標" },
    },
    {
      rules: [
        {
          id: "goals-thin",
          level: "block",
          label: "目標過薄",
          detail: "目標欄需可驗收描述（建議列點）",
          section: "goals",
          fields: ["goals"],
          require: { kind: "minLength", n: 20 },
        },
      ],
      pass: { id: "goals-ok", label: "目標有內容", detail: "目標欄已填寫" },
    },
    {
      rules: [
        {
          id: "metrics-missing",
          level: "block",
          label: "成功指標空白",
          detail: "需填寫指標／目標／量測（Desired Outcomes）",
          section: "metrics",
          require: { kind: "minLength", n: 30 },
        },
        {
          id: "metrics-vague",
          level: "warn",
          label: "成功指標可能不可量測",
          detail: "建議加入數字、%、期限或 p95 等可驗證門檻",
          section: "metrics",
          require: { kind: "match", re: METRIC_RE },
        },
      ],
      pass: { id: "metrics-ok", label: "成功指標含可量測訊號", detail: "偵測到數字或量測用語" },
    },
    {
      // 問題陳述只有懲罰沒有獎勵（寫得好時不發 pass）—— 沿用現況，
      // 改動會連帶影響 score 分母，屬於獨立決策。
      rules: [
        {
          id: "problem-thin",
          level: "warn",
          label: "問題陳述偏短",
          detail: "建議補足痛點、對象與佐證",
          section: "problem",
          fields: ["problem"],
          require: { kind: "minLength", n: 40 },
        },
      ],
    },
    {
      skipWhenEmpty: true,
      rules: [
        {
          id: "open-no-deadline",
          level: "warn",
          label: "開放問題缺少期限",
          detail: "建議每題有負責人與決策期限",
          section: "open",
          fields: ["oq"],
          require: { kind: "match", re: DEADLINE_RE },
        },
      ],
    },
  ],
  // 只給寫作教練看的軟提示。這些原本寫死在 ai-coach.ts 的 if/else 裡，
  // 搬成資料之後領域包也能自帶自己的 hints，教練不必再認得章節 id。
  hints: [
    {
      rules: [
        {
          id: "summary-what-thin",
          level: "warn",
          label: "交付物描述偏短",
          detail: "一句話說清楚要交付什麼，不要只寫方向",
          section: "summary",
          fields: ["what"],
          require: { kind: "minLength", n: 11 },
        },
      ],
      pass: { id: "summary-what-ok", label: "交付物描述明確", detail: "已具體指出要交付什麼" },
    },
    {
      rules: [
        {
          id: "summary-why-thin",
          level: "warn",
          label: "「為何現在」論述較薄弱",
          detail: "補上外部壓力、期限或可驗證的業務時機",
          section: "summary",
          fields: ["why"],
          require: { kind: "minLength", n: 20 },
        },
      ],
    },
    {
      rules: [
        {
          id: "stories-ac",
          level: "warn",
          label: "使用者故事未採用三句式",
          detail: "建議「作為…／我想要…／以便…」，缺了「以便」就看不出價值",
          section: "stories",
          // 兩個詞都要出現，用 lookahead 表達 AND——predicate 刻意不支援組合，
          // 為了一條規則長出布林運算子不划算
          require: { kind: "match", re: "(?=[\\s\\S]*作為)(?=[\\s\\S]*以便)" },
        },
      ],
    },
  ],
  emptySections: {
    warnAt: 3,
    id: "many-empty",
    label: "多個章節仍空白",
    detail: "{count} 個章節標記為空白",
  },
};

/** 領域包接進來時，把 spec 換掉即可；預設走 `_base`。 */
export function evaluatePrdGates(state: AppState, spec: GateSpec = BASE_GATE_SPEC): GateReport {
  return runGateSpec(
    {
      sectionValues: state.sectionValues,
      // 自訂章節不算進「空白章節數」——它是選填的自由區，空著是常態，
      // 算進去等於每份 PRD 都被推近一步的「多個章節仍空白」警告
      sectionStatuses: state.sections.filter((s) => s.id !== CUSTOM_SECTION_ID).map((s) => s.status),
    },
    spec,
  );
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
