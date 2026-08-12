import { describe, expect, test } from "bun:test";
import { fieldNo, numberedFieldLabel } from "../src/lib/field-number";
import type { Section } from "../src/data/types";

// 編號是 PRD 的座標語言（「012 給誰還沒寫」）。它從欄位位置算出來，
// 不存在欄位上 —— 這組測試鎖的是「插入欄位後順延自動發生」。
const sec = {
  id: "summary",
  n: "01",
  fields: [
    { key: "vision", label: "專案功能說明與願景", type: "textarea" },
    { key: "what", label: "做什麼", type: "textarea" },
    { key: "who", label: "給誰", type: "text" },
  ],
} as unknown as Section;

describe("fieldNo", () => {
  test("章節號接序號，從 1 起", () => {
    expect(fieldNo("01", 0)).toBe("011");
    expect(fieldNo("01", 3)).toBe("014");
    expect(fieldNo("07", 1)).toBe("072");
  });
});

describe("numberedFieldLabel", () => {
  test("依位置編號 —— 插入新欄位後其餘自動順延", () => {
    expect(numberedFieldLabel(sec, "vision")).toBe("011 專案功能說明與願景");
    expect(numberedFieldLabel(sec, "who")).toBe("013 給誰");
  });

  test("找不到 key 退回 key，不長出假編號", () => {
    expect(numberedFieldLabel(sec, "ghost")).toBe("ghost");
  });
});
