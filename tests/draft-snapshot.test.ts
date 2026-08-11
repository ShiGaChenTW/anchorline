import { describe, expect, test } from "bun:test";
import { restorePlan, snapshotDrafts, type DraftBag } from "../src/lib/draft-snapshot";

describe("snapshotDrafts", () => {
  test("深拷貝 —— 之後改原物件不能影響快照", () => {
    const bag: DraftBag = { summary: { what: "舊的" } };
    const snap = snapshotDrafts(bag);
    bag.summary!.what = "被 AI 蓋掉了";
    bag.problem = { problem: "新的一節" };
    expect(snap).toEqual({ summary: { what: "舊的" } });
  });

  test("undefined 也要能拿（專案還沒有任何草稿）", () => {
    expect(snapshotDrafts(undefined)).toEqual({});
  });
});

describe("restorePlan", () => {
  test("執行前沒有草稿的欄位 → value 為 null（呼叫端寫回已儲存值）", () => {
    const plan = restorePlan({}, [{ sectionId: "summary", key: "what" }]);
    expect(plan).toEqual([{ sectionId: "summary", key: "what", value: null }]);
  });

  test("執行前有草稿的欄位 → 還原成那個值，不是清掉", () => {
    const before: DraftBag = { summary: { what: "我自己手寫的一句" } };
    const plan = restorePlan(before, [{ sectionId: "summary", key: "what" }]);
    expect(plan).toEqual([{ sectionId: "summary", key: "what", value: "我自己手寫的一句" }]);
  });

  test("**只碰動過的欄位** —— 這是這支函式存在的理由", () => {
    // 使用者按 AI 撰寫之前，problem 已經有自己寫的草稿。
    // AI 只寫了 summary。取消時 problem 不能被碰到。
    const before: DraftBag = {
      summary: { what: "舊" },
      problem: { problem: "使用者手寫的，不能弄丟" },
    };
    const plan = restorePlan(before, [{ sectionId: "summary", key: "what" }]);
    expect(plan).toHaveLength(1);
    expect(plan.some((op) => op.sectionId === "problem")).toBe(false);
  });

  test("同一欄位被寫很多次也只還原一次，順序穩定", () => {
    const plan = restorePlan({ summary: { what: "舊" } }, [
      { sectionId: "summary", key: "what" },
      { sectionId: "summary", key: "who" },
      { sectionId: "summary", key: "what" },
    ]);
    expect(plan.map((o) => o.key)).toEqual(["what", "who"]);
  });

  test("同一節不同欄位分別判斷 —— 有舊草稿的還原、沒有的清掉", () => {
    const before: DraftBag = { summary: { what: "舊的 what" } };
    const plan = restorePlan(before, [
      { sectionId: "summary", key: "what" },
      { sectionId: "summary", key: "why" },
    ]);
    expect(plan).toEqual([
      { sectionId: "summary", key: "what", value: "舊的 what" },
      { sectionId: "summary", key: "why", value: null },
    ]);
  });

  test("什麼都沒動就什麼都不還原", () => {
    expect(restorePlan({ summary: { what: "x" } }, [])).toEqual([]);
  });

  test("空字串是有效的舊草稿值，不能被當成沒有", () => {
    const plan = restorePlan({ summary: { what: "" } }, [{ sectionId: "summary", key: "what" }]);
    expect(plan[0]!.value).toBe("");
  });
});
