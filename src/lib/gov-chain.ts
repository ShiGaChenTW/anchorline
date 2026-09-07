/**
 * 治理鏈 —— dashboard 以六站「意圖 → 規格 → 計劃 → 實作 → 驗證 → 交付」為頁面骨架，
 * 每一站直立排列、帶自己的證據。
 *
 * ## 為什麼是純函式層
 *
 * 全 repo 零 DOM 測試環境（107 個測試檔全是 `bun:test` 純函式 ＋ HTML 字串比對）。
 * 這支只吃 plain data、回字串，不碰 store、不碰 DOM、不碰 `dashboard.ts`。接線是
 * P2-2c 的事、CSS 是 P2-1 的事；三支唯一的防撞面是 `plans/p2-contract-classnames` 那份契約。
 *
 * ## 為什麼 `planStepsKnown` 需要和 `done.l3` 分開（三態，不是單一布林）
 *
 * 非桌面版（或沒綁資料夾）量不到計劃步驟。此時 L3 必須是 `"unknown"`，顯示
 * 「桌面版才量得到」，且重算 active 時**跳過該站**。
 *
 * 如果只靠一個 `hasPlanSteps` 布林，量不到就會被畫成「沒完成」——於是非桌面版的鏈
 * 永遠卡在 L3，使用者被指去建立一個他根本量不到的計劃；反之若把量不到畫成「已完成」，
 * 就是「假全清」：一條沒被量過的鏈看起來全綠。三態只存在於這一層（`done` + `todo` +
 * `unknown`），刻意**不改 `flow-layers.ts` 加 unknown**——那要動 editor / review /
 * projects / tracking 四個既有呼叫端。
 *
 * ## R10 —— 兩支 `activeProject()` 可能指向不同專案
 *
 * `dashboard.ts:91-95` 的 `activeProject()` 會過濾 `isSample` 並 fallback 到 `visible[0]`；
 * `flow-layers.ts:37-44` 的 `activeProject(state)` 不過濾、fallback 到 `p1`。兩者可能指向
 * 不同專案 → 鏈的規格側會描述**另一個專案**的章節，而且完全不報錯。修法在 P2-2c（呼叫端
 * 餵專案限定的 state，照 `overview.ts` 的 `gateOf` 寫法），但這個坑要記在這裡讓後人看得到。
 *
 * ## 為什麼 `AUDIT_ITEM_CAP` 是 3
 *
 * 照 `focus-card.ts` 的 `FOCUS_FIELD_CAP` 先例：沒有那條測試，第四條微列遲早會被加進來，
 * 而且會很有道理。上限由常數 ＋ 測試一起執法。
 */
import { FLOW_LAYER_DEFS, FLOW_LAYER_DOCS } from "./flow-layers";

/** 稽核微列上限。改這個數字之前先讀上面那段。 */
export const AUDIT_ITEM_CAP = 3;

export type StationId = "l1" | "l2" | "l3" | "l4" | "l5" | "l6";

export type StationState = "done" | "active" | "todo" | "unknown";

/** 一站的內容段。空字串／空陣列代表「缺資料」，渲染時整段不輸出，不留 `—` 空殼。 */
export type ChainStationContent = {
  /** 一句話結論。空字串 = 缺資料，不渲染 `.gc-lead` */
  lead: string;
  /**
   * 「何時會亮綠」。**取傳進來的 `layer.passWhen`**（`FlowLayer` 上的動態值），
   * 不得取 `FLOW_LAYER_DOCS[].passWhen` —— 那是靜態值，L2 依 gate spec 生成，取靜態值
   * 等於對 vibe 路線的專案說謊。空字串 = 缺資料，不渲染 `.gc-pass`。
   */
  passWhen: string;
  /** 稽核微列。渲染時截到 `AUDIT_ITEM_CAP`。空陣列 = 缺資料，不渲染 `.audit-trail-micro` */
  items: string[];
};

export type ChainInput = {
  /**
   * 各站是否完成。呼叫端照 `deriveFlowLayers` 的 doneMap 餵即可。
   * L3 例外：`planStepsKnown === false` 時忽略 `done.l3`，直接判 `"unknown"`。
   */
  done: Record<StationId, boolean>;
  /**
   * L3 量不量得到計劃步驟。**false = 量不到**（非桌面版／未綁資料夾）→ L3 `"unknown"`；
   * true = 量得到，此時才用 `done.l3` 分 done / todo。這是三態的關鍵：單一布林
   * （`hasPlanSteps`）無法區分「沒有計劃」與「量不到計劃」。
   */
  planStepsKnown: boolean;
  /** 每站內容。呼叫端用 domain 函式（`gateSummaryLine`／`derivePrdPct`／…）算好餵進來。 */
  content: Record<StationId, ChainStationContent>;
};

export type ChainStation = {
  id: StationId;
  /** 1–6 阿拉伯數字，不是 L 碼 */
  idx: number;
  /** 取自 `FLOW_LAYER_DEFS[].name`，不另造對照表 */
  name: string;
  state: StationState;
  lead: string;
  passWhen: string;
  items: string[];
  /** 「現在該做」文案。只有 active 站非空 */
  next: string;
  /** 前往按鈕。只有 active 站非 null */
  go: { href: string; label: string } | null;
};

const STATION_IDS: readonly StationId[] = ["l1", "l2", "l3", "l4", "l5", "l6"];

const STATE_CLASS: Record<StationState, string> = {
  done: "is-done",
  active: "is-active",
  todo: "is-todo",
  unknown: "is-unknown",
};

const STATE_TEXT: Record<StationState, string> = {
  done: "已完成",
  active: "進行中",
  todo: "未開始",
  unknown: "桌面版才量得到",
};

/** 依完成信號推每一站的 done / todo / unknown。active 由下一步另算。 */
function stationStates(input: ChainInput): Record<StationId, StationState> {
  const out = {} as Record<StationId, StationState>;
  for (const id of STATION_IDS) {
    if (id === "l3" && !input.planStepsKnown) {
      out[id] = "unknown";
    } else {
      out[id] = input.done[id] ? "done" : "todo";
    }
  }
  return out;
}

/** 第一個未完成站。unknown 站跳過——量不到不能當成「該做」也不能當成「已完成」。 */
function firstActiveId(states: Record<StationId, StationState>): StationId | null {
  for (const id of STATION_IDS) {
    if (states[id] === "unknown") continue;
    if (states[id] === "todo") return id;
  }
  return null;
}

export function buildChainStations(input: ChainInput): ChainStation[] {
  const states = stationStates(input);
  const activeId = firstActiveId(states);
  if (activeId) states[activeId] = "active";

  return FLOW_LAYER_DEFS.map((def, i) => {
    const id = def.id as StationId;
    const content = input.content[id];
    const state = states[id];
    const doc = FLOW_LAYER_DOCS[id];
    const isActive = id === activeId;
    return {
      id,
      idx: i + 1,
      name: def.name,
      state,
      lead: content.lead.trim(),
      passWhen: content.passWhen.trim(),
      items: content.items.slice(0, AUDIT_ITEM_CAP),
      // 只有 active 站帶待辦與前往。next/goto 是靜態說明（不依 gate spec 變），
      // 用 FLOW_LAYER_DOCS 是安全的——被禁的只有 `passWhen` 那一個欄位。
      next: isActive ? doc.next : "",
      go: isActive && doc.goto ? doc.goto : null,
    };
  });
}

function stationHtml(s: ChainStation): string {
  const head =
    `<li class="gc-station ${STATE_CLASS[s.state]}">` +
    `<span class="gc-dot" aria-hidden="true"></span>` +
    `<span class="gc-idx">${s.idx}</span>` +
    `<span class="gc-name">${s.name}</span>` +
    `<span class="gc-state">${STATE_TEXT[s.state]}</span>`;

  const parts: string[] = [head];

  if (s.lead) parts.push(`<p class="gc-lead">${s.lead}</p>`);

  const evidence: string[] = [];
  if (s.passWhen) evidence.push(`<p class="gc-pass">${s.passWhen}</p>`);
  if (s.items.length) {
    evidence.push(
      `<ul class="audit-trail-micro">${s.items.map((it) => `<li class="atm-item">${it}</li>`).join("")}</ul>`,
    );
  }
  if (evidence.length) {
    // 原生 details/summary：純字串可測，鍵盤與輔助技術免費，不用委派 listener。
    // active 站預設展開——它正在動，證據要第一眼看得見；其餘摺疊。
    const open = s.state === "active" ? " open" : "";
    parts.push(`<details class="gc-details"${open}><summary class="gc-summary">判定依據</summary>${evidence.join("")}</details>`);
  }

  if (s.state === "active") {
    parts.push(`<p class="gc-todo">現在該做：${s.next}</p>`);
    if (s.go) parts.push(`<a class="gc-go" href="${s.go.href}">${s.go.label} →</a>`);
  }

  // 自簽語彙判準本輪未定（等 SPEC-02），這裡只預留位置，不填內容。
  parts.push(`<div class="gc-note"></div>`);

  parts.push(`</li>`);
  return parts.join("");
}

export function renderGovChainHtml(stations: ChainStation[]): string {
  return `<ol class="gov-chain">${stations.map(stationHtml).join("")}</ol>`;
}

/** 沒綁資料夾的專案用的灰階鏈：六站全部「未建立」，不宣稱任何事實。 */
export function renderGhostChainHtml(): string {
  const items = FLOW_LAYER_DEFS.map(
    (def, i) =>
      `<li class="gc-station">` +
      `<span class="gc-dot" aria-hidden="true"></span>` +
      `<span class="gc-idx">${i + 1}</span>` +
      `<span class="gc-name">${def.name}</span>` +
      `<span class="gc-state">未建立</span>` +
      `</li>`,
  ).join("");
  return `<ol class="gov-chain gc-ghost">${items}</ol>`;
}

/** 頁首那一行鏈健康度。靠右、不得出現 L 碼。 */
export function chainHealthLine(stations: ChainStation[]): string {
  const done = stations.filter((s) => s.state === "done").length;
  const unknown = stations.filter((s) => s.state === "unknown").length;
  const active = stations.find((s) => s.state === "active");
  if (active) {
    const tail = unknown > 0 ? ` · ${unknown} 站需桌面版` : "";
    return `治理鏈 ${done}/6 · 目前「${active.name}」${tail}`;
  }
  if (unknown > 0) return `治理鏈 ${done}/6 完成 · ${unknown} 站需桌面版`;
  return "治理鏈 6/6 全線完成";
}
