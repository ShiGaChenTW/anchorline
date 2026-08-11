import { describe, expect, test } from "bun:test";
import {
  asViewMode,
  filterByOrigin,
  filterTemplates,
  nextSort,
  outlineCount,
  sortIndicator,
  sortTemplates,
} from "../src/lib/template-view";
import type { Template } from "../src/data/types";

function tpl(p: Partial<Template> & { id: string }): Template {
  return {
    cat: "core",
    title: p.id,
    blurb: "",
    uses: 0,
    body: "",
    ...p,
  } as Template;
}

const FULL_A = tpl({ id: "a", kind: "full", cat: "lean", title: "三步驟精簡", uses: 5, body: "# 一\n# 二\n# 三", source: "Lenny" });
const FULL_B = tpl({ id: "b", kind: "full", cat: "enterprise", title: "一頁式", uses: 12, body: "# 一\n# 二", source: "Amazon" });
const FULL_C = tpl({ id: "c", kind: "full", cat: "lean", title: "Agile Brief", uses: 12, body: "# 一", source: "" });
const SECTION_A = tpl({ id: "s1", kind: "section", cat: "security", title: "威脅模型", uses: 3, blurb: "資安章節" });

const ALL = [FULL_A, FULL_B, FULL_C, SECTION_A];

describe("篩選", () => {
  test("kind 是硬邊界：章節範本不會出現在整份範本裡", () => {
    const r = filterTemplates(ALL, { kind: "full", cat: "all", q: "" });
    expect(r.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  test("cat 與 kind 取交集", () => {
    const r = filterTemplates(ALL, { kind: "full", cat: "lean", q: "" });
    expect(r.map((t) => t.id)).toEqual(["a", "c"]);
  });

  test("搜尋：英文不分大小寫，中文比對原字串", () => {
    expect(filterTemplates(ALL, { kind: "full", cat: "all", q: "agile" }).map((t) => t.id)).toEqual(["c"]);
    expect(filterTemplates(ALL, { kind: "section", cat: "all", q: "資安" }).map((t) => t.id)).toEqual(["s1"]);
  });

  test("空白搜尋字串不當成條件（不然打一個空格就全空）", () => {
    expect(filterTemplates(ALL, { kind: "full", cat: "all", q: "   " })).toHaveLength(3);
  });

  test("沒有符合的組合回空陣列，不是丟例外", () => {
    expect(filterTemplates(ALL, { kind: "full", cat: "lean", q: "不存在" })).toEqual([]);
  });
});

describe("排序", () => {
  test("null 代表維持原順序，而且不動到輸入陣列", () => {
    const input = [FULL_B, FULL_A];
    const out = sortTemplates(input, null);
    expect(out.map((t) => t.id)).toEqual(["b", "a"]);
    expect(input.map((t) => t.id)).toEqual(["b", "a"]);
  });

  test("數值欄位升降冪", () => {
    const asc = sortTemplates([FULL_A, FULL_B], { key: "uses", dir: "asc" });
    expect(asc.map((t) => t.uses)).toEqual([5, 12]);
    const desc = sortTemplates([FULL_A, FULL_B], { key: "uses", dir: "desc" });
    expect(desc.map((t) => t.uses)).toEqual([12, 5]);
  });

  test("同分用標題當第二鍵 —— 否則同分項目的順序會隨實作飄", () => {
    // 兩者 uses 都是 12，勝負由標題決定。
    // zh-Hant 定序把中文排在拉丁字母**之前**（實測 "Agile Brief".localeCompare("一頁式","zh-Hant") === 1），
    // 所以「一頁式」在前。這裡釘住的是「同分有確定順序」，不是某個特定語言的直覺。
    const r = sortTemplates([FULL_C, FULL_B], { key: "uses", dir: "asc" });
    expect(r.map((t) => t.id)).toEqual(["b", "c"]);
  });

  test("段落數只有整份範本才算，章節範本一律 0", () => {
    expect(outlineCount(FULL_A)).toBe(3);
    expect(outlineCount(SECTION_A)).toBe(0);
  });

  test("沒有出處的排在有出處之前（空字串最小），不會爆在 undefined", () => {
    const r = sortTemplates([FULL_A, FULL_C], { key: "source", dir: "asc" });
    expect(r.map((t) => t.id)).toEqual(["c", "a"]);
  });
});

describe("表頭三態", () => {
  test("同一欄：asc → desc → 回到預設", () => {
    let s = nextSort(null, "uses");
    expect(s).toEqual({ key: "uses", dir: "asc" });
    s = nextSort(s, "uses");
    expect(s).toEqual({ key: "uses", dir: "desc" });
    s = nextSort(s, "uses");
    expect(s).toBeNull(); // 第三次要回得去，否則使用者只能靠重新整理復原
  });

  test("換一欄一律從 asc 開始，不沿用上一欄的方向", () => {
    const s = nextSort({ key: "uses", dir: "desc" }, "title");
    expect(s).toEqual({ key: "title", dir: "asc" });
  });

  test("只有正在排序的那一欄畫箭頭", () => {
    expect(sortIndicator({ key: "uses", dir: "asc" }, "uses")).toBe("▲");
    expect(sortIndicator({ key: "uses", dir: "desc" }, "uses")).toBe("▼");
    expect(sortIndicator({ key: "uses", dir: "asc" }, "title")).toBe("");
    expect(sortIndicator(null, "uses")).toBe("");
  });
});

describe("檢視偏好", () => {
  test("只認得 list，其餘一律回 cards（未知不該變成新畫面）", () => {
    expect(asViewMode("list")).toBe("list");
    expect(asViewMode("cards")).toBe("cards");
    expect(asViewMode(null)).toBe("cards");
    expect(asViewMode("表格")).toBe("cards");
  });
});

describe("領域包來源篩選", () => {
  const packs = [
    { origin: "builtin" as const, name: "generic" },
    { origin: "custom" as const, name: "mine" },
    { origin: "override" as const, name: "payment" },
  ];

  test("all 回全部且是新陣列", () => {
    const r = filterByOrigin(packs, "all");
    expect(r).toHaveLength(3);
    expect(r).not.toBe(packs);
  });

  test("依來源篩", () => {
    expect(filterByOrigin(packs, "custom").map((p) => p.name)).toEqual(["mine"]);
    expect(filterByOrigin(packs, "override").map((p) => p.name)).toEqual(["payment"]);
  });
});
