/**
 * gov-chain 的機器化執法者。
 *
 * 這支要守住三條會隨時間被「合理」地破壞掉的契約：
 * 1. UI 新增行不得出現 L0–L4 字樣（硬約束 1 與 AC-10）
 * 2. active 站恰好 1 個，且只有它帶「現在該做」與 `.gc-go`
 * 3. L2 的 passWhen 走 `layer.passWhen`（動態值）——餵不同 gate spec 要看到不同門檻，
 *    不得退回 `FLOW_LAYER_DOCS[].passWhen` 的靜態值
 */
import { expect, test } from "bun:test";
import {
  AUDIT_ITEM_CAP,
  buildChainStations,
  chainHealthLine,
  renderGhostChainHtml,
  renderGovChainHtml,
  type ChainInput,
} from "../src/lib/gov-chain";
import { l2PassWhenText } from "../src/lib/flow-layers";
import { BASE_GATE_SPEC, VIBE_GATE_SPEC } from "../src/lib/prd-gates";

const EMPTY = { lead: "", passWhen: "", items: [] };

function input(over: Partial<ChainInput> = {}): ChainInput {
  const content = {
    l1: { ...EMPTY, lead: "意圖已齊" },
    l2: { ...EMPTY, lead: "規格待補", passWhen: "至少 3 條" },
    l3: { ...EMPTY },
    l4: { ...EMPTY },
    l5: { ...EMPTY },
    l6: { ...EMPTY },
  };
  return {
    done: { l1: false, l2: false, l3: false, l4: false, l5: false, l6: false },
    planStepsKnown: true,
    content,
    ...over,
  };
}

test("UI 新增行不得出現 L0–L4 字樣（硬約束 1）", () => {
  const html = renderGovChainHtml(buildChainStations(input()));
  expect(html).not.toMatch(/L[0-4]/);
  expect(renderGhostChainHtml()).not.toMatch(/L[0-4]/);
  expect(chainHealthLine(buildChainStations(input()))).not.toMatch(/L[0-4]/);
});

test("active 站恰好 1 個，且只有它帶「現在該做」與 gc-go", () => {
  const stations = buildChainStations(
    input({ done: { l1: true, l2: true, l3: true, l4: false, l5: false, l6: false } }),
  );
  const active = stations.filter((s) => s.state === "active");
  expect(active).toHaveLength(1);
  expect(active[0].id).toBe("l4");

  const html = renderGovChainHtml(stations);
  expect(html.match(/class="gc-todo"/g) ?? []).toHaveLength(1);
  expect(html.match(/class="gc-go"/g) ?? []).toHaveLength(1);
  // 「現在該做」文案只在 active 站出現
  expect(html.match(/現在該做/g) ?? []).toHaveLength(1);
});

test("L2 的 passWhen 走 layer.passWhen（動態值），餵 VIBE 見「至少 1 條」、BASE 見「至少 3 條」", () => {
  const vibe = buildChainStations(
    input({ content: { ...input().content, l2: { lead: "", passWhen: l2PassWhenText(VIBE_GATE_SPEC), items: [] } } }),
  );
  expect(renderGovChainHtml(vibe)).toContain("至少 1 條");

  const base = buildChainStations(
    input({ content: { ...input().content, l2: { lead: "", passWhen: l2PassWhenText(BASE_GATE_SPEC), items: [] } } }),
  );
  expect(renderGovChainHtml(base)).toContain("至少 3 條");
});

test("planStepsKnown:false 時 l3 為 unknown，且 active 跳過該站", () => {
  const stations = buildChainStations(
    input({
      planStepsKnown: false,
      done: { l1: true, l2: true, l3: false, l4: false, l5: false, l6: false },
    }),
  );
  expect(stations.find((s) => s.id === "l3")?.state).toBe("unknown");
  // l1、l2 已完成，l3 量不到被跳過 → active 落在 l4，不是 l3
  expect(stations.find((s) => s.state === "active")?.id).toBe("l4");
  const html = renderGovChainHtml(stations);
  expect(html).toContain("桌面版才量得到");
});

test("稽核微列超過 AUDIT_ITEM_CAP 會被截到 3", () => {
  const stations = buildChainStations(
    input({
      content: {
        ...input().content,
        l1: { lead: "x", passWhen: "x", items: ["a", "b", "c", "d", "e"] },
      },
    }),
  );
  expect(stations.find((s) => s.id === "l1")?.items).toHaveLength(AUDIT_ITEM_CAP);
  const html = renderGovChainHtml(stations);
  expect(html.match(/class="atm-item"/g) ?? []).toHaveLength(AUDIT_ITEM_CAP);
});

test("缺資料的站不出現空殼（不留 — 空段落）", () => {
  const stations = buildChainStations(
    input({ done: { l1: false, l2: false, l3: false, l4: false, l5: false, l6: false } }),
  );
  const html = renderGovChainHtml(stations);
  // l3 沒 lead / passWhen / items，不該有 gc-lead / gc-pass / audit-trail-micro 空殼
  expect(html).not.toContain('<p class="gc-lead"></p>');
  expect(html).not.toContain('<p class="gc-pass"></p>');
  expect(html).not.toContain('<ul class="audit-trail-micro"></ul>');
  expect(html).not.toContain("—");
});

test("影子鏈六站全部未建立，不宣稱事實", () => {
  const html = renderGhostChainHtml();
  expect(html).toContain('class="gov-chain gc-ghost"');
  expect(html.match(/gc-station/g) ?? []).toHaveLength(6);
  expect(html.match(/未建立/g) ?? []).toHaveLength(6);
  expect(html).not.toContain("已完成");
});
