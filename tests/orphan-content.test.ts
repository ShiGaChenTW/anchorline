/**
 * 孤兒正文的偵測與併入。
 *
 * 換骨架（套整份範本、換領域包）刻意不刪正文，代價是那些內容從此沒有畫面
 * 顯示。這一層是「把看不見的東西重新變成一份清單」的純函式，store 與編輯台
 * 都靠它 —— 算錯的後果不是畫面醜，是使用者被告知有東西不見了卻找不回來。
 */
import { describe, expect, test } from "bun:test";
import { appendInto, findOrphans, labelForOrphan, visibleValues, withoutField } from "../src/lib/orphan-content";
import type { Section } from "../src/data/types";

function sec(id: string, n: string, title: string, keys: [string, string][]): Section {
  return {
    id,
    n,
    title,
    desc: "",
    status: "empty",
    guide: "",
    tips: [],
    example: "",
    fields: keys.map(([key, label]) => ({ key, label, type: "textarea" as const, value: "" })),
    checks: [],
    score: 0,
  };
}

const LIVE: Section[] = [
  sec("summary", "01", "摘要", [["what", "一句話"], ["who", "給誰"]]),
  sec("goals", "02", "目標", [["goals", "目標"]]),
];

describe("findOrphans", () => {
  test("id 在目前結構裡的不算孤兒 —— 那些看得見", () => {
    expect(findOrphans(LIVE, { summary: { what: "有寫" }, goals: { goals: "有寫" } })).toEqual([]);
  });

  test("id 不在結構裡、又有字，才是孤兒", () => {
    expect(findOrphans(LIVE, { kyc_aml: { rule: "洗錢防制規則" } })).toEqual([
      { sectionId: "kyc_aml", fieldKey: "rule", text: "洗錢防制規則" },
    ]);
  });

  test("空白值不算 —— 空字串與全空白都一樣", () => {
    expect(findOrphans(LIVE, { kyc_aml: { rule: "", note: "   \n\t " } })).toEqual([]);
  });

  test("同一節多個欄位各自成立，不是整節一筆", () => {
    const out = findOrphans(LIVE, {
      kyc_aml: { rule: "A", note: "", risk: "B" },
    });
    expect(out).toEqual([
      { sectionId: "kyc_aml", fieldKey: "rule", text: "A" },
      { sectionId: "kyc_aml", fieldKey: "risk", text: "B" },
    ]);
  });

  test("多節混合：只挑不在結構裡的那些，順序照正文袋", () => {
    const out = findOrphans(LIVE, {
      summary: { what: "看得見" },
      kyc_aml: { rule: "A" },
      legacy: { body: "B" },
    });
    expect(out.map((o) => o.sectionId)).toEqual(["kyc_aml", "legacy"]);
  });

  test("正文袋是空的就沒有孤兒（不是丟例外）", () => {
    expect(findOrphans(LIVE, {})).toEqual([]);
  });

  test("原文不 trim —— 顯示要跟使用者寫的一模一樣", () => {
    const out = findOrphans(LIVE, { legacy: { body: "  前後有空白  " } });
    expect(out[0]!.text).toBe("  前後有空白  ");
  });

  test("章節 id 還在、但欄位被拿掉了 —— 那個欄位算孤兒，不是整節被放過", () => {
    const out = findOrphans(LIVE, { summary: { what: "還在的", removed_field: "已經被拿掉的欄位" } });
    expect(out).toEqual([{ sectionId: "summary", fieldKey: "removed_field", text: "已經被拿掉的欄位" }]);
  });
});

describe("visibleValues", () => {
  test("草稿蓋過已存的", () => {
    expect(visibleValues({ a: { x: "舊的" } }, { a: { x: "新的" } })).toEqual({ a: { x: "新的" } });
  });

  test("只存在草稿裡的欄位也要出現", () => {
    expect(visibleValues({}, { a: { x: "只有草稿" } })).toEqual({ a: { x: "只有草稿" } });
  });

  test("同節不同欄位分別疊：草稿沒提到的欄位保留已存的值", () => {
    expect(visibleValues({ a: { x: "存的 x", y: "存的 y" } }, { a: { x: "草稿 x" } })).toEqual({
      a: { x: "草稿 x", y: "存的 y" },
    });
  });

  test("兩邊都沒有這個章節就不出現在結果裡", () => {
    expect(visibleValues({ a: { x: "1" } }, { b: { y: "2" } })).toEqual({
      a: { x: "1" },
      b: { y: "2" },
    });
  });
});

describe("appendInto", () => {
  test("目標是空的就直接放進去，不留前導空行", () => {
    expect(appendInto("", "搬過來的")).toBe("搬過來的");
    expect(appendInto("   \n ", "搬過來的")).toBe("搬過來的");
  });

  test("目標非空時中間空一行", () => {
    expect(appendInto("原本的", "搬過來的")).toBe("原本的\n\n搬過來的");
  });

  test("目標本來就有換行結尾也只空一行 —— 不累加空白", () => {
    expect(appendInto("原本的\n\n\n", "搬過來的")).toBe("原本的\n\n搬過來的");
  });

  test("要併入的東西是空的就原封不動", () => {
    expect(appendInto("原本的", "")).toBe("原本的");
    expect(appendInto("原本的", "  \n ")).toBe("原本的");
  });

  test("內文中間的空行不動 —— 只處理接縫", () => {
    expect(appendInto("第一段\n\n第二段", "第三段")).toBe("第一段\n\n第二段\n\n第三段");
  });
});

describe("labelForOrphan", () => {
  const pool = [sec("kyc_aml", "05", "洗錢防制", [["rule", "規則"]])];

  test("認得的 id 給編號＋標題與欄位名", () => {
    expect(labelForOrphan({ sectionId: "kyc_aml", fieldKey: "rule", text: "x" }, pool)).toEqual({
      section: "05 洗錢防制",
      field: "規則",
    });
  });

  test("認不得就照實顯示原始 id —— 不要編一個好看的名字出來", () => {
    expect(labelForOrphan({ sectionId: "gone", fieldKey: "body", text: "x" }, pool)).toEqual({
      section: "gone",
      field: "body",
    });
  });

  test("章節認得、欄位不認得：只有欄位退回 key", () => {
    expect(labelForOrphan({ sectionId: "kyc_aml", fieldKey: "extra", text: "x" }, pool)).toEqual({
      section: "05 洗錢防制",
      field: "extra",
    });
  });
});

describe("withoutField", () => {
  test("拿掉一個欄位，同節其他欄位留著", () => {
    expect(withoutField({ kyc_aml: { rule: "A", risk: "B" } }, { sectionId: "kyc_aml", fieldKey: "rule" })).toEqual({
      kyc_aml: { risk: "B" },
    });
  });

  test("整節只剩空殼就連節一起拿掉 —— 不留幽靈章節", () => {
    expect(withoutField({ kyc_aml: { rule: "A" } }, { sectionId: "kyc_aml", fieldKey: "rule" })).toEqual({});
  });

  test("找不到就原封不動回傳同一個物件", () => {
    const bag = { kyc_aml: { rule: "A" } };
    expect(withoutField(bag, { sectionId: "gone", fieldKey: "rule" })).toBe(bag);
    expect(withoutField(bag, { sectionId: "kyc_aml", fieldKey: "gone" })).toBe(bag);
  });

  test("不就地改動輸入 —— store 依賴這個才敢直接塞進 state", () => {
    const bag = { kyc_aml: { rule: "A", risk: "B" } };
    withoutField(bag, { sectionId: "kyc_aml", fieldKey: "rule" });
    expect(bag).toEqual({ kyc_aml: { rule: "A", risk: "B" } });
  });
});
