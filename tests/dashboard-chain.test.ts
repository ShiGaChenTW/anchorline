/**
 * dashboard-chain 的機器化執法者。
 *
 * 這支守住四條會隨時間被「合理」地破壞掉的契約：
 * 1. passWhen 一律來自 `layers[].passWhen`（動態值），不得退回靜態對照表
 * 2. 缺資料給空字串／空陣列、不留 `—` 空殼；L5 零題待修整條不渲染
 * 3. L2 findings block 優先、最多 2 條（排序，不是截斷）
 * 4. `planStepsKnown:false` 時 L3 三態交 gov-chain（done 不填死、active 不卡 L3）
 * 5. 產出的頁首／量測行帶契約 class、不得出現 L0–L4 字樣
 */
import { expect, test } from "bun:test";
import {
  buildChainStations,
  renderGovChainHtml,
  type ChainInput,
} from "../src/lib/gov-chain";
import type { FlowLayer } from "../src/lib/flow-layers";
import {
  buildDashboardChainInput,
  dashboardHeadHtml,
  measuredLineHtml,
  type DashboardChainSource,
} from "../src/lib/dashboard-chain";

/** 六層假資料 —— done 值可被個別覆寫，passWhen 刻意給可辨識的假字串。 */
function fakeLayers(over: Partial<Record<FlowLayer["id"], boolean>> = {}): FlowLayer[] {
  const done = { l1: false, l2: false, l3: false, l4: false, l5: false, l6: false, ...over };
  return (["l1", "l2", "l3", "l4", "l5", "l6"] as const).map((id) => ({
    id,
    code: id.toUpperCase(),
    name: id,
    hint: "",
    active: false,
    passWhen: `假門檻:${id}`,
    done: done[id],
  }));
}

function source(over: Partial<DashboardChainSource> = {}): DashboardChainSource {
  return {
    layers: fakeLayers(),
    planStepsKnown: true,
    hasPlanSteps: false,
    summaryFilled: false,
    summaryFindings: [],
    gateSummary: "",
    prdPct: { done: 0, total: 0 },
    gateFindings: [],
    coverageLine: "",
    anchors: 0,
    ungoverned: 0,
    gitHeadline: "",
    recentCommits: [],
    branches: 0,
    worktrees: 0,
    statusText: "",
    openFixes: 0,
    version: null,
    tags: [],
    versionPolicyLine: "",
    ...over,
  };
}

/** 假層的 id 都長這樣；這裡只抓 station 內容，不重複測 gov-chain 的截斷。 */
function station(input: ChainInput, id: string) {
  return input.content[id as keyof ChainInput["content"]];
}

test("passWhen 一律來自 layers[].passWhen —— 餵假值要出現在輸出裡", () => {
  const input = buildDashboardChainInput(source({ version: "v0.4.0" }));
  for (const id of ["l1", "l2", "l3", "l4", "l5", "l6"]) {
    const src = station(input, id);
    expect(src.passWhen).toBe("假門檻:" + id);
  }
  const html = renderGovChainHtml(buildChainStations(input));
  expect(html).toContain("假門檻:l2");
});

test("planStepsKnown:false 時 L3 交 gov-chain 判三態 —— active 不停在 L3", () => {
  const input = buildDashboardChainInput(
    source({
      planStepsKnown: false,
      layers: fakeLayers({ l1: true, l2: true, l4: true }),
    }),
  );
  // 三態在 gov-chain：這裡不填死 done、content 清空，讓 gov-chain 判 unknown
  expect(input.content.l3).toEqual({ lead: "", passWhen: "", items: [] });
  const stations = buildChainStations(input);
  expect(stations.find((s) => s.id === "l3")?.state).toBe("unknown");
  // l1、l2、l4 皆已完成，l3 量不到被跳過 → active 落在 l5，不停在 l3
  expect(stations.find((s) => s.state === "active")?.id).toBe("l5");
  const html = renderGovChainHtml(stations);
  expect(html).toContain("桌面版才量得到");
});

test("缺資料給空字串／空陣列，不留 — 空殼", () => {
  const input = buildDashboardChainInput(
    source({ layers: fakeLayers({ l1: true, l2: true, l4: true }) }),
  );
  const html = renderGovChainHtml(buildChainStations(input));
  // 規格站沒有 lead / findings → 不渲染 gc-lead / 空微列
  expect(input.content.l2.lead).toBe("");
  expect(input.content.l2.items).toEqual([]);
  // 驗證站零待修、沒有狀態 → lead 空字串、微列不產生「0 題」文案
  expect(input.content.l5.lead).toBe("");
  expect(input.content.l5.items).toEqual([]);
  // 交付站未發版 → lead / passWhen 空字串、items 空陣列
  expect(input.content.l6).toEqual({ lead: "", passWhen: "", items: [] });

  expect(html).not.toContain("0 題");
  expect(html).not.toContain("—");
  expect(html).not.toContain('<p class="gc-lead"></p>');
  expect(html).not.toContain('<ul class="audit-trail-micro"></ul>');
});

test("L5 零題待修不渲染；有題才出「本專案待修 N 題」", () => {
  const clean = buildDashboardChainInput(source());
  expect(clean.content.l5.items).toEqual([]);

  const pending = buildDashboardChainInput(source({ statusText: "審閱中", openFixes: 3 }));
  // statusText 是 lead；items 只放待修題數與時間，不放重複的 lead
  expect(pending.content.l5.lead).toBe("審閱中");
  expect(pending.content.l5.items).toEqual(["本專案待修 3 題"]);
});

test("L2 findings block 優先、最多 2 條", () => {
  const findings = [
    { text: "warn 較舊", level: "warn" as const },
    { text: "warn 較新", level: "warn" as const },
    { text: "block 嚴重", level: "block" as const },
    { text: "warn 第三條", level: "warn" as const },
    { text: "block 次要", level: "block" as const },
  ];
  const input = buildDashboardChainInput(
    source({ layers: fakeLayers({ l1: true, l2: true }), prdPct: { done: 0, total: 3 }, gateFindings: findings }),
  );
  const items = input.content.l2.items;
  expect(items).toHaveLength(2);
  expect(items).toEqual(["block 嚴重", "block 次要"]);
});

test("dashboardHeadHtml / measuredLineHtml 帶契約 class、不得出現 L0–L4", () => {
  const head = dashboardHeadHtml("乙案", "治理鏈 2/6");
  expect(head).toContain('class="d-head"');
  expect(head).toContain('class="d-head-name"');
  expect(head).toContain('class="d-head-health"');
  expect(head).toContain("乙案");
  expect(head).toContain("治理鏈 2/6");

  const measured = measuredLineHtml("剛剛", "~/projects/乙案");
  expect(measured).toContain('class="d-measured"');

  expect(head).not.toMatch(/L[0-4]/);
  expect(measured).not.toMatch(/L[0-4]/);
});

// ── 來源欄位執法：欄位真的進了輸出（防「宣告卻沒接」再犯）────────────────

test("coverageLine 真的進了計劃站微列", () => {
  const out = buildDashboardChainInput(
    source({ hasPlanSteps: true, coverageLine: "已治理 42 件" }),
  );
  expect(out.content.l3.items).toContain("已治理 42 件");
});

test("anchors 真的進了計劃站微列", () => {
  const out = buildDashboardChainInput(
    source({ hasPlanSteps: true, coverageLine: "尚無覆蓋率", anchors: 17, ungoverned: 0 }),
  );
  expect(out.content.l3.items.join("|")).toContain("17 個錨點");
});

test("ungoverned 真的進了計劃站微列", () => {
  const out = buildDashboardChainInput(
    source({ hasPlanSteps: true, ungoverned: 9 }),
  );
  expect(out.content.l3.items).toContain("9 件未治理");
});

test("prdPct 真的進了規格站微列", () => {
  const out = buildDashboardChainInput(source({ prdPct: { done: 5, total: 11 } }));
  expect(out.content.l2.items).toContain("5/11 節已完成");
});

test("branches 真的進了實作站微列", () => {
  const out = buildDashboardChainInput(source({ branches: 7, worktrees: 0 }));
  expect(out.content.l4.items.join("|")).toContain("7 條分支");
});

test("worktrees 真的進了實作站微列", () => {
  const out = buildDashboardChainInput(source({ branches: 0, worktrees: 4 }));
  expect(out.content.l4.items.join("|")).toContain("4 個 worktree");
});

// ── 零值／空字串不留空殼微列 ────────────────────────────────────────────

test("coverageLine 為空字串時計劃站微列不含空殼", () => {
  const out = buildDashboardChainInput(source({ hasPlanSteps: true, coverageLine: "" }));
  expect(out.content.l3.items).not.toContain("");
  expect(out.content.l3.items.join("|")).not.toContain("0 件");
});

test("anchors 為 0 時不出現「0 個錨點」", () => {
  const out = buildDashboardChainInput(
    source({ hasPlanSteps: true, coverageLine: "尚無覆蓋", anchors: 0, ungoverned: 0 }),
  );
  expect(out.content.l3.items.join("|")).not.toContain("0 個");
});

test("ungoverned 為 0 時不出現「0 件未治理」", () => {
  const out = buildDashboardChainInput(
    source({ hasPlanSteps: true, coverageLine: "已治理全部", ungoverned: 0 }),
  );
  expect(out.content.l3.items.join("|")).not.toContain("0 件");
});

test("prdPct.done 為 0 時不出現「0/0」空殼", () => {
  const out = buildDashboardChainInput(source({ prdPct: { done: 0, total: 0 } }));
  expect(out.content.l2.items.join("|")).not.toContain("0/0");
  expect(out.content.l2.items.join("|")).not.toContain("0 節");
});

test("branches 為 0 時不出現「0 條分支」", () => {
  const out = buildDashboardChainInput(source({ branches: 0, worktrees: 2 }));
  expect(out.content.l4.items.join("|")).not.toContain("0 條");
});

test("worktrees 為 0 時不出現「0 個 worktree」", () => {
  const out = buildDashboardChainInput(source({ branches: 3, worktrees: 0 }));
  expect(out.content.l4.items.join("|")).not.toContain("0 個");
});

// ── wsLine OR 判準 ───────────────────────────────────────────────────────

test("branches:3 worktrees:0 → 含「3 條分支」且不含 worktree", () => {
  const out = buildDashboardChainInput(source({ branches: 3, worktrees: 0 }));
  expect(out.content.l4.items).toContain("3 條分支");
  expect(out.content.l4.items.join("|")).not.toContain("worktree");
});

test("branches:0 worktrees:2 → 含「2 個 worktree」且不含條分支", () => {
  const out = buildDashboardChainInput(source({ branches: 0, worktrees: 2 }));
  expect(out.content.l4.items).toContain("2 個 worktree");
  expect(out.content.l4.items.join("|")).not.toContain("條分支");
});

test("branches:3 worktrees:2 → 單一字串「3 條分支 · 2 個 worktree」", () => {
  const out = buildDashboardChainInput(source({ branches: 3, worktrees: 2 }));
  expect(out.content.l4.items).toContain("3 條分支 · 2 個 worktree");
  expect(out.content.l4.items.filter((s) => s.includes("分支") || s.includes("worktree"))).toHaveLength(1);
});

test("branches:0 worktrees:0 → l4 不含分支也不含 worktree", () => {
  const out = buildDashboardChainInput(source({ branches: 0, worktrees: 0 }));
  expect(out.content.l4.items.join("|")).not.toContain("分支");
  expect(out.content.l4.items.join("|")).not.toContain("worktree");
});

// ── 總閘：全部來源欄位餵獨特值，該可見的都要出現 ─────────────────────────

test("全部來源欄位餵獨特值時，該可見的欄位都進了輸出", () => {
  const out = buildDashboardChainInput(
    source({
      layers: fakeLayers(),
      planStepsKnown: true,
      hasPlanSteps: true,
      summaryFilled: true,
      summaryFindings: ["意圖缺陷ZX91"],
      gateSummary: "規格結論QW37",
      prdPct: { done: 3, total: 8 },
      gateFindings: [
        { text: "block發現TY55", level: "block" },
        { text: "warn發現UV66", level: "warn" },
      ],
      coverageLine: "覆蓋率說明MN44",
      anchors: 13,
      ungoverned: 19,
      gitHeadline: "git標題PL22",
      recentCommits: ["commit甲AA11", "commit乙BB22"],
      branches: 6,
      worktrees: 2,
      statusText: "驗證狀態CD33",
      openFixes: 4,
      submittedAt: "送審時間EF77",
      approvedAt: "核准時間GH88",
      version: "v9.9.9-IJ99",
      tags: ["標籤KL12"],
      versionPolicyLine: "版號政策OP34",
    }),
  );

  const blob = [
    out.content.l1.lead,
    ...out.content.l1.items,
    out.content.l2.lead,
    ...out.content.l2.items,
    out.content.l3.lead,
    ...out.content.l3.items,
    out.content.l4.lead,
    ...out.content.l4.items,
    out.content.l5.lead,
    ...out.content.l5.items,
    out.content.l6.lead,
    ...out.content.l6.items,
  ].join("|");

  // 意圖站
  expect(blob).toContain("三行摘要已填妥");
  expect(blob).toContain("意圖缺陷ZX91");
  // 規格站
  expect(blob).toContain("規格結論QW37");
  expect(blob).toContain("3/8 節已完成");
  expect(blob).toContain("block發現TY55");
  expect(blob).toContain("warn發現UV66");
  // 計劃站（ungoverned>0 時走未治理列；anchors 與之互斥，由專測覆蓋）
  expect(blob).toContain("覆蓋率說明MN44");
  expect(blob).toContain("19 件未治理");
  // 實作站
  expect(blob).toContain("git標題PL22");
  expect(blob).toContain("commit甲AA11");
  expect(blob).toContain("commit乙BB22");
  expect(blob).toContain("6 條分支 · 2 個 worktree");
  // 驗證站
  expect(blob).toContain("驗證狀態CD33");
  expect(blob).toContain("本專案待修 4 題");
  expect(blob).toContain("送審時間EF77");
  expect(blob).toContain("核准時間GH88");
  // 交付站
  expect(blob).toContain("v9.9.9-IJ99");
  expect(blob).toContain("標籤KL12");
  expect(blob).toContain("版號政策OP34");
  // passWhen 來自 layers
  expect(out.content.l1.passWhen).toBe("假門檻:l1");
  expect(out.content.l6.passWhen).toBe("假門檻:l6");
});
