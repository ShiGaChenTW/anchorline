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

/**
 * 「真的有條列」：行首的 - * • 或 1. / 1)。
 * 刻意不用 `bullets` predicate —— 它在沒有列點符號時會退回用 `;；換行` 切，
 * 多段落的純敘事會被算成好幾條而矇混過關，正好漏掉這條規則要抓的那一種。
 */
const LIST_ITEM_RE = "^\\s*(?:[-*•]|\\d+[.)])";

/** 期限訊號：日期、季度、或明講的期限字眼 */
const DEADLINE_RE = "\\d{1,2}\\/\\d{1,2}|Q\\d|週|前|deadline|期限";

/**
 * 範本第 6.4 節點名的模糊字眼。「不要寫『適度寬度的欄位』，要寫出數字。」
 *
 * 用在負向 lookahead 裡（`^(?![\s\S]*(?:…))`），所以這裡只列詞，不列語法。
 */
const VAGUE_RE = "適度|盡量|儘量|合理|視情況|大致|酌情|依實際";

/**
 * 通用 15 章的規則。這不是「特例」，是一個叫 `_base` 的領域包——
 * 領域包用同一個 `GateSpec` 形狀，差別只在它從 frontmatter 讀進來。
 *
 * 章節骨架與這份規則的來源是 `docs/TEMPLATE-prd-unified.md`。範本的第 0 章
 * （要不要寫這份 PRD）與第 11 章（送出前自檢）**不是章節**，是檢核工具：
 * 前者在 `prd-triage.ts`，後者在 `prd-selfcheck.ts`，後者的每一個自動項目
 * 都指向下面某一條規則的 id。
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
      // 願景一律 warn，不進 block。單人簽核下 gate 是自我約束，多一道會被習慣性
      // 略過的門，代價是「所有 gate 都變成可以略過」——那比漏填願景貴得多
      // （見 `docs/NEXT-VERSION-PLAN.md:44`）。刻意不發 pass：pass 會進 score 分母，
      // 那是獨立決策（同 problem-thin 的處理）。
      rules: [
        {
          id: "summary-vision-thin",
          level: "warn",
          label: "功能說明與願景單薄",
          detail:
            "建議在「01 三行摘要」的「專案功能說明與願景」先寫 2–3 句敘事，說明主要目的與實際要達成的事（不擋送審，但審閱者少了讀動機的入口）。",
          section: "summary",
          fields: ["vision"],
          require: { kind: "minLength", n: 60 },
        },
        {
          id: "summary-vision-outline",
          level: "warn",
          label: "功能說明與願景缺功能條列",
          detail:
            "已有敘事，但未見條列 — 建議在敘事之後以 -、• 或 1. 開頭逐條列出主要功能與目標，讓人與機器都能逐項核對。",
          section: "summary",
          fields: ["vision"],
          require: { kind: "match", re: LIST_ITEM_RE, flags: "m" },
        },
      ],
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

    // ── 範本第 11 節「送出前自檢」落成的規則 ────────────────────
    //
    // 全部是 `warn` 且 `skipWhenEmpty`，這是刻意的兩個決定：
    //
    // 1. **不進 block**：範本分 Lite（8 章）與 Full（15 章）。把 Full 才有的
    //    章節做成 block，等於逼每一份 Lite PRD 都寫完 15 章才能送審——那正是
    //    範本開頭說的「寫到 50 頁不等於完整」。門檻維持在 Lite 那幾章。
    // 2. **空白就跳過**：新專案十幾章全空，一次噴十幾條警告會讓人直接關掉。
    //    這些是「你寫了，但寫得不夠」的規則，不是「你還沒寫」的規則——
    //    後者由 `emptySections` 一條講完就夠。
    //
    // 對照表在 `prd-selfcheck.ts`：那邊每一個 auto 項目都指向這裡的一個 id。
    {
      skipWhenEmpty: true,
      rules: [
        {
          id: "docinfo-no-revision",
          level: "warn",
          label: "修訂紀錄空白",
          detail:
            "建議每次變更留下日期、修改章節與是否已通知開發——直接改正文的團隊尤其要留，工程師可能已照舊版做完。",
          section: "docinfo",
          fields: ["revisions"],
          require: { kind: "minLength", n: 12 },
        },
      ],
    },
    {
      skipWhenEmpty: true,
      rules: [
        {
          id: "problem-no-evidence",
          level: "warn",
          label: "背景缺可追溯佐證",
          detail: "建議附審查紀錄、工單編號或具名引言。沒有佐證的問題陳述等於一段意見。",
          section: "problem",
          fields: ["quote"],
          require: { kind: "minLength", n: 10 },
        },
      ],
    },
    {
      // 獨立一組而不是接在 metrics 那組後面：接上去會讓 `metrics-ok` 這條
      // pass 連帶被領先指標卡住，而那條 pass 已經有既定語意（有可量測訊號）。
      skipWhenEmpty: true,
      rules: [
        {
          id: "metrics-no-leading",
          level: "warn",
          label: "成功指標缺領先指標",
          detail:
            "看起來只有落後指標。建議至少一個領先指標（例：設定完成率），落後指標要等三個月才知道做錯了。",
          section: "metrics",
          require: { kind: "match", re: "領先|leading|前置" },
        },
      ],
    },
    {
      skipWhenEmpty: true,
      rules: [
        {
          id: "sources-no-conclusion",
          level: "warn",
          label: "需求來源缺釐清結論",
          detail:
            "每筆需求要寫釐清後的判定（進開發／不做／列非目標）。有些需求一釐清就不必進開發，那正是這一節的價值。",
          section: "sources",
          require: { kind: "match", re: "進開發|不做|非目標|延後|待評估|P[0-3]" },
        },
      ],
    },
    {
      skipWhenEmpty: true,
      rules: [
        {
          id: "users-no-competitor",
          level: "warn",
          label: "缺競品對照",
          detail: "建議列出競品作法與「可借鏡之處／不採用的理由」，把取捨寫下來。",
          section: "users",
          fields: ["competitors"],
          require: { kind: "minLength", n: 20 },
        },
      ],
    },
    {
      skipWhenEmpty: true,
      rules: [
        {
          id: "scope-no-risk",
          level: "warn",
          label: "里程碑未標依賴或風險",
          detail: "每一段都要能單獨上線，並標出依賴或風險，否則排程只是願望清單。",
          section: "scope",
          require: { kind: "match", re: "依賴|相依|風險|阻塞|blocker|risk" },
        },
      ],
    },
    {
      skipWhenEmpty: true,
      rules: [
        {
          id: "arch-no-crud",
          level: "warn",
          label: "Function Map 未見 CRUD 檢查",
          detail:
            "建議拿 CRUD 逐一比對每個 Feature，看資料運算有沒有漏掉的一角（範本的例子：復原碼漏了 Update）。",
          section: "arch",
          require: { kind: "match", re: "CRUD|新增|讀取|更新|刪除" },
        },
      ],
    },
    {
      skipWhenEmpty: true,
      rules: [
        {
          // 負向判定用 lookahead 表達。刻意不為此加第五個 predicate——
          // 「不得出現 X」是 `match` 就寫得出來的東西。
          id: "spec-vague-wording",
          level: "warn",
          label: "規格出現模糊字眼",
          detail: "偵測到「適度／盡量／合理／視情況」這類字眼。規格數值要寫死，不要留給人猜。",
          section: "spec",
          require: { kind: "match", re: `^(?![\\s\\S]*(?:${VAGUE_RE}))` },
        },
        {
          id: "spec-no-exception",
          level: "warn",
          label: "需求規格缺例外流程",
          detail:
            "最常漏的一節。每個流程都要跑過一次例外：API timeout、輸入錯誤、載入異常、資訊不足時使用者看到什麼。",
          section: "spec",
          require: { kind: "match", re: "例外|逾時|timeout|失敗|錯誤|異常" },
        },
        {
          id: "spec-no-number",
          level: "warn",
          label: "規格數值未寫死",
          detail: "建議補上具體數字：位數、秒數、次數、天數、字元上限。",
          section: "spec",
          require: { kind: "match", re: "\\d" },
        },
      ],
      pass: { id: "spec-ok", label: "需求規格具體", detail: "含例外流程與寫死的規格數值" },
    },
    {
      skipWhenEmpty: true,
      rules: [
        {
          id: "proto-no-crosscheck",
          level: "warn",
          label: "原型未與 PRD 逐條比對",
          detail:
            "PRD 寫 8 組復原碼、設計稿標 10 組這種矛盾，開發到一半才發現的成本最高。比對過就註明以哪份為準。",
          section: "proto",
          require: { kind: "match", re: "已對|比對|同步|為準" },
        },
      ],
    },
    {
      skipWhenEmpty: true,
      rules: [
        {
          id: "accept-thin",
          level: "warn",
          label: "驗收標準不足 3 項",
          detail: "目前約 {count} 項。只說「要支援 X」而沒定義成功長什麼樣，QA 無從展開測試。",
          section: "accept",
          require: { kind: "bullets", min: 3 },
        },
        {
          id: "accept-no-negative",
          level: "warn",
          label: "驗收標準只有正向路徑",
          detail: "正向與反向都要有：輸入錯誤、服務無回應、重複使用時各該發生什麼。",
          section: "accept",
          require: { kind: "match", re: "失敗|錯誤|拒絕|無回應|逾時|過期|重複|已使用" },
        },
      ],
      pass: { id: "accept-ok", label: "驗收標準可展開測試", detail: "已有 {count} 項，含反向路徑" },
    },
    {
      skipWhenEmpty: true,
      rules: [
        {
          id: "kpi-no-gsm",
          level: "warn",
          label: "產品指標未拆到埋點",
          detail: "建議依 Goal → Signal → Metric 往下拆，最後對到埋點事件名，否則量不出來。",
          section: "kpi",
          require: { kind: "match", re: "Goal|Signal|Metric|埋點|事件" },
        },
      ],
    },
    {
      skipWhenEmpty: true,
      rules: [
        {
          id: "open-too-many",
          level: "warn",
          label: "開放問題超過 8 題",
          detail: "目前約 {count} 題。超過 8 題就不是開放問題，是規格還沒想清楚。",
          section: "open",
          fields: ["oq"],
          require: { kind: "bullets", min: 0, max: 8 },
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
