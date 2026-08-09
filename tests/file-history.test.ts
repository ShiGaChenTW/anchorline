import { describe, expect, test } from "bun:test";
import {
  changedLineCount,
  markChangedLines,
  relativeTime,
} from "../src/lib/file-history";

const marks = (a: string, b: string) => markChangedLines(a, b);

describe("markChangedLines", () => {
  test("完全相同時沒有任何標記", () => {
    expect(marks("a\nb\nc", "a\nb\nc")).toEqual([]);
  });

  test("改一行算 modified，並留著改之前的內容", () => {
    const out = marks("a\nb\nc", "a\nB\nc");
    expect(out).toEqual([{ index: 1, kind: "modified", before: "b" }]);
  });

  test("插入一行算 added，before 是 null", () => {
    const out = marks("a\nc", "a\nb\nc");
    expect(out).toEqual([{ index: 1, kind: "added", before: null }]);
  });

  test("只刪不增時，存活的行不標記 —— 但刪掉的那一行要回報", () => {
    // 原本這裡斷言整個結果是 []。名字講的「後面的文字沒有需要標記的行」是對的
    // （a 與 c 都沒動），但那個 [] 順帶把「刪除不回報」也固化成規格 —— 於是
    // 整行刪除在畫面上完全沒有痕跡，而 CSS 的 .fv-del 一直都在等資料。
    const out = marks("a\nb\nc", "a\nc");
    expect(out.filter((m) => m.kind === "added" || m.kind === "modified")).toEqual([]);
    expect(out).toEqual([{ index: 1, kind: "removed", before: "b" }]);
  });

  test("同一區段改兩行 —— 逐行配對，不是一堆刪除加一堆新增", () => {
    const out = marks("a\nb1\nb2\nc", "a\nB1\nB2\nc");
    expect(out).toEqual([
      { index: 1, kind: "modified", before: "b1" },
      { index: 2, kind: "modified", before: "b2" },
    ]);
  });

  test("改一行又多加一行：前者 modified、後者 added", () => {
    const out = marks("a\nb\nc", "a\nB\nNEW\nc");
    expect(out).toEqual([
      { index: 1, kind: "modified", before: "b" },
      { index: 2, kind: "added", before: null },
    ]);
  });

  test("整份從空的開始 —— 每一行都是 added", () => {
    const out = marks("", "x\ny");
    expect(out.map((m) => m.kind)).toEqual(["modified", "added"]);
  });

  test("在最前面插入不會把整份都標成改過", () => {
    const out = marks("a\nb\nc", "TOP\na\nb\nc");
    expect(out).toEqual([{ index: 0, kind: "added", before: null }]);
  });

  test("在最後面追加只標最後一行", () => {
    const out = marks("a\nb", "a\nb\nEND");
    expect(out).toEqual([{ index: 2, kind: "added", before: null }]);
  });

  test("行號是「改之後」的行號，可以直接拿去對 textarea 的行", () => {
    const after = "a\nB\nc\nD";
    for (const m of marks("a\nb\nc\nd", after)) {
      expect(after.split("\n")[m.index]).toBeDefined();
    }
  });

  test("重複出現的行不會互相錯配", () => {
    const out = marks("x\nx\nx", "x\nY\nx");
    expect(out).toEqual([{ index: 1, kind: "modified", before: "x" }]);
  });

  test("真實情境：把 SHALL 改成 MUST", () => {
    const before = [
      "### Requirement: Durable prompt template storage",
      "The system SHALL persist user-curated prompt templates.",
      "",
      "#### Scenario: First launch",
    ].join("\n");
    const after = before.replace("SHALL", "MUST");
    const out = marks(before, after);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("modified");
    expect(out[0].before).toContain("SHALL");
  });

  test("結果依行號排序", () => {
    const out = marks("a\nb\nc\nd\ne", "a\nB\nc\nD\ne");
    expect(out.map((m) => m.index)).toEqual([1, 3]);
  });
});

describe("changedLineCount", () => {
  test("沒改就是 0", () => {
    expect(changedLineCount("a\nb", "a\nb")).toBe(0);
  });
  test("改兩行就是 2", () => {
    expect(changedLineCount("a\nb\nc", "A\nb\nC")).toBe(2);
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-08-08T12:00:00Z");
  test("一分鐘內是「剛剛」", () => {
    expect(relativeTime("2026-08-08T11:59:30Z", now)).toBe("剛剛");
  });
  test("分鐘", () => {
    expect(relativeTime("2026-08-08T11:30:00Z", now)).toBe("30 分鐘前");
  });
  test("小時", () => {
    expect(relativeTime("2026-08-08T09:00:00Z", now)).toBe("3 小時前");
  });
  test("天", () => {
    expect(relativeTime("2026-08-06T12:00:00Z", now)).toBe("2 天前");
  });
  test("壞掉的時間不炸", () => {
    expect(relativeTime("not-a-date", now)).toBe("—");
  });
});

import { inlineDiff, tokenize, visibleSegs } from "../src/lib/file-history";

const txt = (segs: { text: string; kind: string }[], kind: string) =>
  segs.filter((s) => s.kind === kind).map((s) => s.text).join("");

describe("tokenize", () => {
  test("英數連成一個字，不會被拆成字母", () => {
    expect(tokenize("SHALL persist")).toEqual(["SHALL", " ", "persist"]);
  });
  test("CJK 一字一個 token", () => {
    expect(tokenize("系統應")).toEqual(["系", "統", "應"]);
  });
  test("空字串回空陣列", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("inlineDiff", () => {
  test("完全相同時只有 same", () => {
    const segs = inlineDiff("abc def", "abc def");
    expect(segs.every((s) => s.kind === "same")).toBe(true);
  });

  test("SHALL → MUST：只有那個字被標成刪除與新增", () => {
    const segs = inlineDiff("The system SHALL persist", "The system MUST persist");
    expect(txt(segs, "del")).toBe("SHALL");
    expect(txt(segs, "add")).toBe("MUST");
    expect(txt(segs, "same")).toBe("The system  persist");
  });

  test("純新增沒有 del", () => {
    const segs = inlineDiff("abc", "abc def");
    expect(txt(segs, "del")).toBe("");
    expect(txt(segs, "add")).toBe(" def");
  });

  test("純刪除沒有 add", () => {
    const segs = inlineDiff("abc def", "abc");
    expect(txt(segs, "add")).toBe("");
    expect(txt(segs, "del")).toBe(" def");
  });

  test("相鄰同類會合併，不會碎成一堆片段", () => {
    const segs = inlineDiff("a", "a bbb ccc");
    expect(segs.filter((s) => s.kind === "add")).toHaveLength(1);
  });

  test("中文改字也標得出來", () => {
    const segs = inlineDiff("系統應該保存", "系統必須保存");
    expect(txt(segs, "del")).toBe("應該");
    expect(txt(segs, "add")).toBe("必須");
  });

  test("整行從空的開始 —— 全部是 add", () => {
    const segs = inlineDiff("", "new line");
    expect(txt(segs, "same")).toBe("");
    expect(txt(segs, "add")).toBe("new line");
  });
});

describe("visibleSegs", () => {
  test("same + add 串起來剛好等於改之後的文字 —— 這是不錯位的前提", () => {
    const before = "The system SHALL persist user data";
    const after = "The system MUST persist all user data";
    const rebuilt = visibleSegs(inlineDiff(before, after)).map((s) => s.text).join("");
    expect(rebuilt).toBe(after);
  });

  test("中文情境也要能還原", () => {
    const before = "系統應該保存資料";
    const after = "系統必須永久保存資料";
    expect(visibleSegs(inlineDiff(before, after)).map((s) => s.text).join("")).toBe(after);
  });

  test("純刪除時還原出的就是剩下的文字", () => {
    expect(visibleSegs(inlineDiff("abc def", "abc")).map((s) => s.text).join("")).toBe("abc");
  });
});

describe("整行刪除（回歸：刪除線一直畫不出來的根因）", () => {
  // 這一組原本不存在，所以 markChangedLines 對「整行刪除」回傳空陣列這件事
  // 從來沒被發現。症狀是刪掉一整段，畫面上完全沒有痕跡 —— 對比欄空的、
  // 狀態列的「N 行未儲存」是 0。CSS 的 .fv-del 一直都在，沒有資料餵給它。
  test("刪掉中間一行要產生 removed mark", () => {
    const marks = markChangedLines("第一行\n第二行\n第三行", "第一行\n第三行");
    expect(marks).toHaveLength(1);
    expect(marks[0]!.kind).toBe("removed");
    expect(marks[0]!.before).toBe("第二行");
  });

  test("刪掉最後一行也要算", () => {
    const marks = markChangedLines("a\nb\nc", "a\nb");
    expect(marks.filter((m) => m.kind === "removed").map((m) => m.before)).toEqual(["c"]);
  });

  test("連續刪掉多行 → 每一行各一個 mark", () => {
    const marks = markChangedLines("a\nx\ny\nz\nb", "a\nb");
    expect(marks.filter((m) => m.kind === "removed").map((m) => m.before)).toEqual(["x", "y", "z"]);
  });

  test("刪除會被算進未儲存行數", () => {
    expect(changedLineCount("a\nb\nc", "a\nc")).toBe(1);
  });

  test("同時有刪除與新增時，removed 排在同 index 的其他種類之前", () => {
    const marks = markChangedLines("keep\nold1\nold2\nold3", "keep\nnew");
    const kinds = marks.map((m) => m.kind);
    // old1 被 new 取代（modified），old2/old3 是純刪除
    expect(kinds).toContain("removed");
    const removedIdx = kinds.indexOf("removed");
    const modifiedIdx = kinds.indexOf("modified");
    if (modifiedIdx >= 0 && marks[removedIdx]!.index === marks[modifiedIdx]!.index) {
      expect(removedIdx).toBeLessThan(modifiedIdx);
    }
  });

  test("沒有變動時不產生任何 mark", () => {
    expect(markChangedLines("a\nb", "a\nb")).toEqual([]);
  });
});
