import { describe, expect, test } from "bun:test";
import {
  planApply,
  seedValuesFromTemplate,
  sectionsFromTemplate,
  splitTemplate,
} from "../src/lib/prd-template";

const ONE_PAGER = `# [功能名稱]

**負責人：** ｜ **日期：**

## 1. 問題
現況與痛點。

## 2. 提案
要做什麼。

## 3. 成功指標
| 指標 | 目標 |

## 4. 不做什麼
- 不做 A

## 5. 開放問題
誰能回答。
`;

describe("splitTemplate", () => {
  test("單一 # 是文件名，章節取下一層", () => {
    const s = splitTemplate(ONE_PAGER);
    expect(s.map((x) => x.title)).toEqual(["問題", "提案", "成功指標", "不做什麼", "開放問題"]);
  });

  test("**編號照範本**，不重新編 —— 使用者選這份就是要它的規格", () => {
    expect(splitTemplate(ONE_PAGER).map((x) => x.n)).toEqual(["1", "2", "3", "4", "5"]);
  });

  test("沒寫編號才補流水號", () => {
    const s = splitTemplate("## 問題\na\n\n## 提案\nb");
    expect(s.map((x) => x.n)).toEqual(["01", "02"]);
  });

  test("多層編號（2.1）也認得", () => {
    expect(splitTemplate("## 2.1 邊界\nx")[0]!.n).toBe("2.1");
  });

  test("用 # 當章節的範本不會切出 0 節", () => {
    const s = splitTemplate("# 問題\na\n\n# 提案\nb");
    expect(s).toHaveLength(2);
  });

  test("程式碼區塊裡的 # 不是標題", () => {
    const s = splitTemplate("## 一\n\n```sh\n# 這是註解\n```\n\n## 二\n");
    expect(s.map((x) => x.title)).toEqual(["一", "二"]);
  });

  test("內文歸屬到它上面那個標題", () => {
    expect(splitTemplate(ONE_PAGER)[0]!.body).toBe("現況與痛點。");
  });

  test("沒有標題就回空陣列（呼叫端要擋下來，不能靜默切出 0 節）", () => {
    expect(splitTemplate("就只是一段話")).toEqual([]);
  });

  test("id 用 slug 不是流水號 —— 刪一節不能讓後面的正文錯位", () => {
    const s = splitTemplate("## 1. Problem\na\n\n## 2. Goals\nb");
    expect(s.map((x) => x.id)).toEqual(["problem", "goals"]);
  });

  test("同名章節的 id 不會撞", () => {
    const s = splitTemplate("## 附錄\na\n\n## 附錄\nb");
    expect(new Set(s.map((x) => x.id)).size).toBe(2);
  });
});

describe("sectionsFromTemplate", () => {
  test("每節一個 textarea，編號與命名照範本", () => {
    const secs = sectionsFromTemplate(ONE_PAGER, { title: "一頁式 PRD" });
    expect(secs).toHaveLength(5);
    expect(secs[0]!.n).toBe("1");
    expect(secs[0]!.title).toBe("問題");
    expect(secs[0]!.fields).toHaveLength(1);
    expect(secs[0]!.fields[0]!.type).toBe("textarea");
    expect(secs[0]!.desc).toContain("一頁式 PRD");
  });

  test("狀態一律從空的開始 —— 範本示範內容不算使用者寫的", () => {
    expect(sectionsFromTemplate(ONE_PAGER).every((s) => s.status === "empty")).toBe(true);
  });
});

describe("seedValuesFromTemplate", () => {
  test("示範內容可以當草稿預填，鍵對得上章節 id", () => {
    const v = seedValuesFromTemplate(ONE_PAGER);
    const ids = splitTemplate(ONE_PAGER).map((x) => x.id);
    // 中文標題產不出 ASCII slug，退回 `sec-<編號>` —— 仍然穩定、仍然對得上
    expect(ids[0]).toBe("sec-1");
    expect(v[ids[0]!]).toEqual({ body: "現況與痛點。" });
  });
});

describe("planApply", () => {
  const cur = [
    { id: "summary", n: "01", title: "三行摘要" },
    { id: "problem", n: "02", title: "問題陳述" },
    { id: "goals", n: "03", title: "目標與非目標" },
  ];
  const next = [
    { id: "problem", n: "1", title: "問題" },
    { id: "sec-2", n: "2", title: "提案" },
  ];

  test("算得出哪幾節會留下、哪幾節會不見", () => {
    const p = planApply(cur, next, {});
    expect(p.current.filter((r) => r.kept).map((r) => r.id)).toEqual(["problem"]);
    expect(p.current.filter((r) => !r.kept).map((r) => r.id)).toEqual(["summary", "goals"]);
  });

  test("**有內容又會消失的才算孤兒** —— 空章節不見不痛", () => {
    const p = planApply(cur, next, { summary: { what: "寫過的字" }, goals: { goals: "  " } });
    expect(p.orphans).toBe(1);
  });

  test("比對用 id 不是標題 —— 同名不同 id 的正文本來就不通用", () => {
    const p = planApply([{ id: "a", n: "1", title: "問題" }], [{ id: "b", n: "1", title: "問題" }], {
      a: { body: "x" },
    });
    expect(p.orphans).toBe(1);
  });

  test("沒有任何內容時孤兒數是 0", () => {
    expect(planApply(cur, next, {}).orphans).toBe(0);
  });
});
