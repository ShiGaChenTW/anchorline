import { expect, test } from "bun:test";
import { flowLayerDetailHtml, FLOW_LAYER_DOCS } from "../src/lib/flow-layers";
import type { FlowLayer } from "../src/lib/flow-layers";

function layer(over: Partial<FlowLayer> = {}): FlowLayer {
  return {
    id: "l3",
    code: "L3",
    name: "計劃",
    done: false,
    active: true,
    hint: FLOW_LAYER_DOCS.l3.next,
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
