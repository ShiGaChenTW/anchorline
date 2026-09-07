import { expect, test } from "bun:test";
import { deriveFlowLayers, flowLayerDetailHtml, FLOW_LAYER_DOCS, l2PassWhenText } from "../src/lib/flow-layers";
import type { FlowLayer } from "../src/lib/flow-layers";
import { BASE_GATE_SPEC, VIBE_GATE_SPEC } from "../src/lib/prd-gates";
import type { GateSpec } from "../src/lib/gate-rules";
import type { AppState } from "../src/data/types";

function layer(over: Partial<FlowLayer> = {}): FlowLayer {
  return {
    id: "l3",
    code: "L3",
    name: "計劃",
    done: false,
    active: true,
    hint: FLOW_LAYER_DOCS.l3.next,
    passWhen: FLOW_LAYER_DOCS.l3.passWhen,
    ...over,
  };
}

test("未完成時要說「現在該做什麼」——只講判定條件等於沒回答使用者的問題", () => {
  const html = flowLayerDetailHtml(layer());
  expect(html).toContain("現在該做");
  expect(html).toContain(FLOW_LAYER_DOCS.l3.next);
});

test("已完成就不再顯示待辦，只留判定依據", () => {
  const html = flowLayerDetailHtml(layer({ done: true, active: false }));
  expect(html).not.toContain("現在該做");
  expect(html).toContain("何時會亮綠");
  expect(html).toContain("已完成");
});

test("已經在目的頁時不給前往按鈕——點了只會重載並丟掉現場", () => {
  const onTracking = flowLayerDetailHtml(layer(), "/tracking.html");
  expect(onTracking).not.toContain("fsd-go");

  const onEditor = flowLayerDetailHtml(layer(), "/editor.html");
  expect(onEditor).toContain("fsd-go");
  expect(onEditor).toContain("tracking.html");
});

test("三種狀態各自帶不同的狀態標籤", () => {
  expect(flowLayerDetailHtml(layer({ done: true, active: false }))).toContain("is-done");
  expect(flowLayerDetailHtml(layer({ done: false, active: true }))).toContain("is-active");
  expect(flowLayerDetailHtml(layer({ done: false, active: false }))).toContain("is-todo");
});

test("每一層都有完整四欄說明——缺一欄就會在畫面上留白", () => {
  for (const [id, doc] of Object.entries(FLOW_LAYER_DOCS)) {
    expect(doc.what.length, `${id}.what`).toBeGreaterThan(10);
    expect(doc.passWhen.length, `${id}.passWhen`).toBeGreaterThan(10);
    expect(doc.next.length, `${id}.next`).toBeGreaterThan(5);
  }
});

// ── L2 的判定說明依 gate spec 生成 ──────────────────────────────
//
// 原本硬寫「Non-Goals 至少 3 條、指標可量測等」—— 那是 `_base` 的規則。
// vibe 只要 1 條、而且沒有指標類 gate，領域包又可能自帶別的數字。
// 這是使用者點 L2 時看到的**唯一**判定說明，四檔裡有一檔在說謊。

test("L2 的數字從 gate spec 讀出來：_base 是 3 條、vibe 是 1 條", () => {
  const base = l2PassWhenText(BASE_GATE_SPEC);
  expect(base).toContain("Non-Goals 至少 3 條");
  expect(base).toContain("4 道 BLOCK");

  const vibe = l2PassWhenText(VIBE_GATE_SPEC);
  expect(vibe).toContain("Non-Goals 至少 1 條");
  expect(vibe).toContain("2 道 BLOCK");
  // 兩檔講的不是同一句話 —— 這正是原本壞掉的地方
  expect(vibe).not.toBe(base);
});

test("數字不是查表來的：領域包自訂的門檻也照樣講得出來", () => {
  const spec: GateSpec = {
    groups: [
      {
        rules: [
          {
            id: "non-goals-min",
            level: "block",
            label: "Non-Goals 不足 7 條",
            detail: "",
            section: "goals",
            fields: ["nongoals"],
            require: { kind: "bullets", min: 7 },
          },
        ],
      },
    ],
  };
  expect(l2PassWhenText(spec)).toContain("Non-Goals 至少 7 條");
  expect(l2PassWhenText(spec)).toContain("1 道 BLOCK");
});

test("沒有 non-goals 規則就不硬掰一個數字出來", () => {
  const spec: GateSpec = {
    groups: [
      {
        rules: [
          {
            id: "summary-incomplete",
            level: "block",
            label: "三行摘要不完整",
            detail: "",
            section: "summary",
            fields: ["what"],
            require: { kind: "present" },
          },
        ],
      },
    ],
  };
  const text = l2PassWhenText(spec);
  expect(text).toContain("1 道 BLOCK");
  expect(text).not.toContain("Non-Goals");
});

test("靜態文案不得帶任何具體數字 —— 那是「對 vibe 說謊」的來源", () => {
  expect(FLOW_LAYER_DOCS.l2.passWhen).not.toMatch(/\d/);
});

test("deriveFlowLayers 把依 spec 生成的那一句放進 L2，說明卡才拿得到", () => {
  const st = {
    sectionValues: {},
    sections: [],
    projects: [{ id: "p1", status: "draft", pct: 0 }],
    activeProjectId: "p1",
    locked: false,
  } as unknown as AppState;

  const vibe = deriveFlowLayers(st, { gateSpec: VIBE_GATE_SPEC }).find((l) => l.id === "l2")!;
  expect(vibe.passWhen).toBe(l2PassWhenText(VIBE_GATE_SPEC));
  // 說明卡渲染的是 layer 上那一份，不是靜態值
  expect(flowLayerDetailHtml(vibe)).toContain("Non-Goals 至少 1 條");

  const base = deriveFlowLayers(st, { gateSpec: BASE_GATE_SPEC }).find((l) => l.id === "l2")!;
  expect(flowLayerDetailHtml(base)).toContain("Non-Goals 至少 3 條");

  // 其餘層沿用靜態說明
  const l5 = deriveFlowLayers(st, { gateSpec: VIBE_GATE_SPEC }).find((l) => l.id === "l5")!;
  expect(l5.passWhen).toBe(FLOW_LAYER_DOCS.l5.passWhen);
});
