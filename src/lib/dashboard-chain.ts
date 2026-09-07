/**
 * 治理鏈的 dashboard 資料組裝層 —— 把 dashboard 的 domain 資料組成 `gov-chain` 的
 * `ChainInput`。純函式、零 I/O、零 store、零 DOM。
 *
 * ## 為什麼這支必須存在（dashboard.ts 為何 import 不得）
 *
 * `dashboard.ts` 有 `import.meta.glob`（Vite 專屬語法）加上頂層 DOM 存取，
 * 無法被 `bun test` import —— 但組裝規則（block 優先、passWhen 來源、三態轉交、
 * 缺資料不留 `—` 空殼）如果住在 dashboard.ts 裡就永遠測不到。所以組裝邏輯獨立
 * 到這一層，由純函式＋HTML 字串比對的測試執法。接線（dashboard.ts 呼叫）是
 * P2-2c 下一棒的事。
 *
 * ## 為什麼 `DashboardChainSource` 收「已經算好的 layers」，不收 state（R10）
 *
 * R10：`dashboard.ts` 的 `activeProject()` 會過濾 `isSample` 並 fallback 到
 * `visible[0]`；`flow-layers.ts` 的 `activeProject(state)` 不過濾、fallback 到
 * `p1`。兩者可能指向不同專案 → 鏈的規格側會描述**另一個專案**的章節，完全不
 * 報錯。
 *
 * 修法是呼叫端餵**專案限定的 state**（照 `overview.ts` 的 `gateOf` 先例：把
 * `sectionValues` 換成 `projectSectionValues[p.id]`、`sections` 換成
 * `sectionsFor(p.id)`）給 `deriveFlowLayers`。為了在型別上就強迫這件事，這一層
 * **不收 state**：`layers` 是呼叫端用那份限定 state 算好的成品，`passWhen`／`done`
 * 直接從 `FlowLayer` 上取。這一層拿不到 state，就不可能再算錯一次專案。
 *
 * ## 組裝規則（與 `gov-chain.ts` 的分工）
 *
 * - `passWhen` 一律取 `layer.passWhen`（`FlowLayer` 上的動態值，L2 依 gate spec
 *   生成）。不得取 `FLOW_LAYER_DOCS[].passWhen` —— 那是靜態值，對 vibe 路線說謊。
 * - `done` 取 `layer.done`；但 `planStepsKnown === false` 時 L3 不填 done，三態
 *   （done / todo / unknown）交給 `gov-chain` 的 `buildChainStations` 判 —— 只有它
 *   知道「量不到」該跳過且不宣稱完成。
 * - 缺資料一律給空字串／空陣列，`gov-chain` 整段不渲染，不留 `—` 空殼。
 * - L5「本專案待修 N 題」零題不渲染（給空字串，不是「0 題」）。
 * - 微列不自己截到 3（`gov-chain` 的 `AUDIT_ITEM_CAP` 會截）；唯一例外是 L2 的
 *   findings：block 優先、最多 2 條 —— 那是排序，不是截斷。
 * - UI 文字不得出現 `L0`–`L4`（序號 1–6 是 `gov-chain` 用 `FLOW_LAYER_DEFS` 排的，
 *   這一層不碰數字序號）。
 */
import type { ChainInput } from "./gov-chain";
import type { FlowLayer } from "./flow-layers";

/** L2 findings 上限。block 優先排序後取前 2 —— 只影響規格站，不是全鏈微列上限。 */
export const L2_FINDINGS_CAP = 2;

/** 一站要產出的內容。要加新站內容就從這份表補欄位。 */
export type LayerSource = {
  /** 一句話結論。缺資料給空字串，不渲染 `.gc-lead`。 */
  lead: string;
  /** 何時亮綠。缺資料給空字串，不渲染 `.gc-pass`。 */
  passWhen: string;
  /** 稽核微列。缺資料給空陣列。微列上限由 `gov-chain` 的 `AUDIT_ITEM_CAP` 截。 */
  items: string[];
};

export type DashboardChainSource = {
  /**
   * 呼叫端用**專案限定**的 state（照 `overview.ts` 的 `gateOf` 先例）算好的流程層。
   * 這一層直接取 `layer.done` 與 `layer.passWhen`。見檔頭 R10 段。
   */
  layers: FlowLayer[];
  /** L3 量不量得到計劃步驟。false = 量不到 → L3 三態交 `gov-chain` 判。 */
  planStepsKnown: boolean;
  /** L3 量得到但沒有步驟時，計劃站的說明。 */
  hasPlanSteps: boolean;
  /** 意圖站：三行摘要是否填妥（`summaryFilled`）、缺陷微列。 */
  summaryFilled: boolean;
  summaryFindings: string[];
  /** 規格站：一句話結論、章節完成度、findings（block 優先、最多 2 條）。 */
  gateSummary: string;
  prdPct: { done: number; total: number };
  gateFindings: { text: string; level: "block" | "warn" }[];
  /** 計劃站：覆蓋率說明、錨定／未受治理筆數。 */
  coverageLine: string;
  anchors: number;
  ungoverned: number;
  /** 實作站：git 標題、近期提交、分支與 worktree 數。 */
  gitHeadline: string;
  recentCommits: string[];
  branches: number;
  worktrees: number;
  /** 驗證站：狀態行、待修數。零待修時 openFixes 顯示空字串。 */
  statusText: string;
  openFixes: number;
  submittedAt?: string;
  approvedAt?: string;
  /** 交付站：版號、標籤、版號政策說明。未發版時 version 為 null。 */
  version: string | null;
  tags: string[];
  versionPolicyLine: string;
};

export function buildDashboardChainInput(src: DashboardChainSource): ChainInput {
  const { layers } = src;
  const layer = (id: string) => layers.find((l) => l.id === id)!;
  const emptyContent: LayerSource = { lead: "", passWhen: "", items: [] };

  // L2 規格站微列：章節完成度（N/M，只在有完成數時出現）＋ findings（block 優先、最多 2 條）。
  const pctLine = src.prdPct.done > 0 ? `${src.prdPct.done}/${src.prdPct.total} 節已完成` : "";
  const top2 = [...src.gateFindings]
    .sort((a, b) => (a.level === b.level ? 0 : a.level === "block" ? -1 : 1))
    .slice(0, L2_FINDINGS_CAP)
    .map((f) => f.text);

  // 計劃站微列：coverageLine 原文 ＋ 未治理件數。錨點數是「還沒開始治理、但已有錨點」
  // 的替代說明（dashboard.ts 三分支文案），只在 coverageLine 沒描述錨點時才補。
  const l3Items = [src.coverageLine];
  if (src.ungoverned > 0) {
    l3Items.push(`${src.ungoverned} 件未治理`);
  } else if (!src.coverageLine.includes("錨點")) {
    l3Items.push(src.anchors > 0 ? `plans 有 ${src.anchors} 個錨點，但還沒有工作掛上去` : "");
  }

  // 實作站微列：最近 2 筆 commit ＋ 分支／worktree 一列。
  // 判準是 OR 不是 AND：多數專案沒有 worktree，AND 會讓「3 條分支」這個真實資訊
  // 跟著一起消失。改成各自成段、以 · 相接 —— 零值那一段不出現，不留「0 個」空殼。
  // 仍然是**一列**而不是兩列：l4 已有 2 筆 commit，AUDIT_ITEM_CAP 是 3，
  // 拆成兩列會讓第二列被截掉。
  const wsLine = [
    src.branches > 0 ? `${src.branches} 條分支` : "",
    src.worktrees > 0 ? `${src.worktrees} 個 worktree` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  // 驗證站微列：待修題數 ＋ 送審／核准時間。零題待修時 fixLine 是空字串，不會出現「0 題」。
  const fixLine = src.openFixes > 0 ? `本專案待修 ${src.openFixes} 題` : "";
  const verificationItems = [fixLine, src.submittedAt ?? "", src.approvedAt ?? ""].filter(Boolean);

  // L3 量不到計劃步驟：content 交 gov-chain 判 unknown，清空以免渲染。量得到才寫內容。
  // 微列只在量得到時帶 coverageLine／未治理件數（l3Items 已把 0 值過濾成空字串）。
  const l3: LayerSource =
    src.planStepsKnown && src.hasPlanSteps
      ? { lead: "計劃已建立", passWhen: layer("l3").passWhen, items: l3Items.filter(Boolean) }
      : src.planStepsKnown
        ? { lead: "計劃尚未建立", passWhen: layer("l3").passWhen, items: [] }
        : emptyContent;

  // 交付站未發版（version 為 null）→ 整段缺資料，不渲染
  const delivery: LayerSource = src.version
    ? {
        lead: src.version,
        passWhen: layer("l6").passWhen,
        items: [src.versionPolicyLine, ...src.tags].filter(Boolean),
      }
    : emptyContent;

  return {
    // done 一律取 layer.done —— layers 是呼叫端用專案限定 state 算好的成品（見檔頭 R10）。
    // 唯一例外：planStepsKnown:false 時 L3 不填死（三態交 gov-chain 判 unknown）。
    done: {
      l1: layer("l1").done,
      l2: layer("l2").done,
      l3: src.planStepsKnown && layer("l3").done,
      l4: layer("l4").done,
      l5: layer("l5").done,
      l6: layer("l6").done,
    },
    planStepsKnown: src.planStepsKnown,
    content: {
      l1: {
        lead: src.summaryFilled ? "三行摘要已填妥" : "三行摘要待補",
        passWhen: layer("l1").passWhen,
        items: src.summaryFindings,
      },
      l2: { lead: src.gateSummary, passWhen: layer("l2").passWhen, items: [pctLine, ...top2].filter(Boolean) },
      l3,
      l4: {
        lead: src.gitHeadline,
        passWhen: layer("l4").passWhen,
        items: [...src.recentCommits, wsLine].filter(Boolean),
      },
      l5: { lead: src.statusText, passWhen: layer("l5").passWhen, items: verificationItems },
      l6: delivery,
    },
  };
}

/** 頁首一行：`.d-head`。name 為專案身分、healthLine 為鏈健康度（`chainHealthLine` 的產物）。 */
export function dashboardHeadHtml(name: string, healthLine: string): string {
  return (
    `<header class="d-head">` +
    `<span class="d-head-name">${name}</span>` +
    `<span class="d-head-health">${healthLine}</span>` +
    `</header>`
  );
}

/** 鏈下量測行：`.d-measured`。at 為量測時間、path 為資料路徑。 */
export function measuredLineHtml(at: string, path: string): string {
  return `<p class="d-measured">${at} · ${path}</p>`;
}
