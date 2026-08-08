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

  test("只刪不增時，後面的文字沒有需要標記的行", () => {
    expect(marks("a\nb\nc", "a\nc")).toEqual([]);
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
