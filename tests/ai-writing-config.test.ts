import { expect, test } from "bun:test";
import {
  BASE_DOMAIN,
  baseSectionValue,
  baseValue,
  isInherited,
  isSectionInherited,
  migrateAiWriting,
  resolveWriting,
  sectionKey,
  setField,
  setInherit,
  setSectionPrompt,
} from "../src/lib/ai-writing-config";
import type { DomainWriteConfig } from "../src/data/types";

const base = (): Record<string, DomainWriteConfig> => ({
  generic: {
    globalInstruction: "通用指令",
    styleSample: "通用範本",
    sectionPrompts: { summary: "通用摘要提示" },
  },
});

test("預設是自訂且空白——沒設定過的領域不會自動繼承", () => {
  const by = base();
  expect(isInherited(by, "payment", "globalInstruction")).toBe(false);
  const r = resolveWriting(by, "payment");
  expect(r.globalInstruction).toBe("");
  expect(r.styleSample).toBe("");
  expect(r.sectionPrompts.summary).toBeUndefined();
});

test("明示沿用之後才拿得到通用值", () => {
  const by = setInherit(base(), "payment", "globalInstruction", true);
  expect(isInherited(by, "payment", "globalInstruction")).toBe(true);
  expect(resolveWriting(by, "payment").globalInstruction).toBe("通用指令");
  // 沒標的欄位仍然是自訂空白，不跟著一起繼承
  expect(resolveWriting(by, "payment").styleSample).toBe("");
});

test("切成沿用不會刪掉自訂內容——切回來字還在", () => {
  let by = setField(base(), "payment", "globalInstruction", "支付專用");
  by = setInherit(by, "payment", "globalInstruction", true);
  expect(resolveWriting(by, "payment").globalInstruction).toBe("通用指令");
  by = setInherit(by, "payment", "globalInstruction", false);
  expect(resolveWriting(by, "payment").globalInstruction).toBe("支付專用");
});

test("通用領域自己不能被標成沿用——它是基底", () => {
  const by = setInherit(base(), BASE_DOMAIN, "globalInstruction", true);
  expect(isInherited(by, BASE_DOMAIN, "globalInstruction")).toBe(false);
  expect(resolveWriting(by, BASE_DOMAIN).globalInstruction).toBe("通用指令");
});

test("章節逐節切換，互不影響", () => {
  let by = setSectionPrompt(base(), "payment", "clearing_settlement", "講清算");
  by = setInherit(by, "payment", sectionKey("summary"), true);
  const r = resolveWriting(by, "payment");
  expect(r.sectionPrompts.summary).toBe("通用摘要提示"); // 明示沿用
  expect(r.sectionPrompts.clearing_settlement).toBe("講清算"); // 領域限定，自訂
  expect(isSectionInherited(by, "payment", "summary")).toBe(true);
  expect(isSectionInherited(by, "payment", "clearing_settlement")).toBe(false);
});

test("章節前綴不會跟欄位名撞在一起", () => {
  const by = setInherit(base(), "payment", sectionKey("globalInstruction"), true);
  // 標的是章節 globalInstruction，不該讓「全域指令」欄位變成沿用
  expect(isInherited(by, "payment", "globalInstruction")).toBe(false);
  expect(isSectionInherited(by, "payment", "globalInstruction")).toBe(true);
});

test("自訂成空字串就是空的，不會偷偷回退到通用", () => {
  const by = setField(base(), "payment", "globalInstruction", "");
  expect(resolveWriting(by, "payment").globalInstruction).toBe("");
});

test("通用值供 UI 顯示——使用者要看得到自己繼承到什麼", () => {
  expect(baseValue(base(), "styleSample")).toBe("通用範本");
  expect(baseSectionValue(base(), "summary")).toBe("通用摘要提示");
  expect(baseSectionValue(base(), "不存在的章節")).toBe("");
});

test("遷移：最早的頂層格式收進 generic", () => {
  const m = migrateAiWriting({
    globalInstruction: "舊指令",
    styleSample: "舊範本",
    sectionPrompts: { summary: "舊提示" },
    overwriteFilled: true,
  });
  expect(m.byDomain.generic.globalInstruction).toBe("舊指令");
  expect(m.byDomain.generic.sectionPrompts?.summary).toBe("舊提示");
  expect(m.overwriteFilled).toBe(true);
});

test("遷移：角色格式取當時生效的那個，不是第一個", () => {
  const m = migrateAiWriting({
    profiles: [
      { id: "a", globalInstruction: "A 的", styleSample: "", sectionPrompts: {} },
      { id: "b", globalInstruction: "B 的", styleSample: "", sectionPrompts: {} },
    ],
    activeProfileId: "b",
  });
  expect(m.byDomain.generic.globalInstruction).toBe("B 的");
});

test("遷移：已經是新格式就原樣帶過，且保證 generic 存在", () => {
  const m = migrateAiWriting({
    byDomain: { payment: { globalInstruction: "支付", inherit: ["styleSample"] } },
  });
  expect(m.byDomain.payment?.globalInstruction).toBe("支付");
  expect(m.byDomain.payment?.inherit).toEqual(["styleSample"]);
  expect(m.byDomain.generic).toBeDefined();
});

test("遷移：undefined / 垃圾輸入不炸，回傳可用的空設定", () => {
  for (const bad of [undefined, null, "字串", 42, []]) {
    const m = migrateAiWriting(bad);
    expect(m.byDomain.generic).toBeDefined();
    expect(m.overwriteFilled).toBe(false);
  }
});

test("setter 不改動原物件——store 靠這個做不可變更新", () => {
  const orig = base();
  const a = setField(orig, "payment", "globalInstruction", "新");
  const b = setInherit(orig, "payment", "styleSample", true);
  expect(orig.payment).toBeUndefined();
  expect(a.payment?.globalInstruction).toBe("新");
  expect(b.payment?.inherit).toEqual(["styleSample"]);
});

test("重複標記沿用不會塞進兩筆", () => {
  let by = setInherit(base(), "payment", "styleSample", true);
  by = setInherit(by, "payment", "styleSample", true);
  expect(by.payment?.inherit).toEqual(["styleSample"]);
});
