import { describe, expect, test } from "bun:test";
import { inlineDiff } from "../src/lib/file-history";
import { capVersions } from "../src/lib/prd-versions";
import {
  applyDrafts,
  canCommit,
  changedFieldCount,
  diffDocs,
  nextDraftValue,
  pickBaseline,
  pickLatestCommit,
  type Docs,
} from "../src/lib/prd-versions";
import type { PrdVersion } from "../src/data/types";

const v = (id: string, kind: PrdVersion["kind"], docs: Docs): PrdVersion => ({
  id,
  kind,
  at: "2026-08-10T00:00:00.000Z",
  byId: "u1",
  byName: "Scott",
  message: "",
  docs,
});

describe("版本挑選", () => {
  test("主線是最近一次 merge，不是最近一次 commit", () => {
    const versions = [
      v("c2", "commit", { s: { a: "送審中" } }),
      v("m1", "merge", { s: { a: "已核准" } }),
      v("c1", "commit", { s: { a: "更早" } }),
    ];
    expect(pickBaseline(versions)?.id).toBe("m1");
    expect(pickLatestCommit(versions)?.id).toBe("c2");
  });

  test("從未核准過就沒有主線", () => {
    expect(pickBaseline([v("c1", "commit", {})])).toBeNull();
  });
});

describe("草稿正規化", () => {
  test("改回跟已儲存一樣就不該留在草稿裡", () => {
    // 少了這一步，「改了又改回去」會永遠卡在 dirty，
    // 使用者看著一模一樣的文字卻被擋著不能送審。
    expect(nextDraftValue({ a: "改過" }, "a", "原本", "原本")).toBeUndefined();
  });

  test("只剩一個欄位改回原樣時，其他草稿要留著", () => {
    expect(nextDraftValue({ a: "改過", b: "也改過" }, "a", "原本", "原本")).toEqual({
      b: "也改過",
    });
  });

  test("與已儲存不同就寫進草稿", () => {
    expect(nextDraftValue(undefined, "a", "新內容", "原本")).toEqual({ a: "新內容" });
  });
});

describe("草稿疊加", () => {
  test("草稿蓋過已儲存，未涉及的欄位保持原樣", () => {
    const saved: Docs = { s1: { a: "1", b: "2" }, s2: { c: "3" } };
    expect(applyDrafts(saved, { s1: { a: "改了" } })).toEqual({
      s1: { a: "改了", b: "2" },
      s2: { c: "3" },
    });
  });

  test("沒有草稿時原樣回傳", () => {
    const saved: Docs = { s1: { a: "1" } };
    expect(applyDrafts(saved, {})).toBe(saved);
  });
});

describe("快照對比", () => {
  test("改過的欄位帶出前後與行級 marks", () => {
    const d = diffDocs({ s: { a: "第一行\n第二行" } }, { s: { a: "第一行\n改過的第二行" } });
    expect(d).toHaveLength(1);
    expect(d[0]!.marks[0]!.kind).toBe("modified");
  });

  test("新增的欄位 before 是空字串", () => {
    const d = diffDocs({ s: {} }, { s: { a: "新的" } });
    expect(d[0]).toMatchObject({ sectionId: "s", key: "a", before: "", after: "新的" });
  });

  test("整個章節被移除 → 它底下每個欄位各算一筆", () => {
    // 審閱者要看得到「這一節整個不見了」，不能靜悄悄少一段
    const d = diffDocs({ s1: { a: "1", b: "2" }, s2: { c: "3" } }, { s2: { c: "3" } });
    expect(d.map((x) => x.key)).toEqual(["a", "b"]);
    expect(d.every((x) => x.after === "")).toBe(true);
  });

  test("內容相同的欄位不出現在 diff 裡", () => {
    expect(diffDocs({ s: { a: "一樣" } }, { s: { a: "一樣" } })).toEqual([]);
  });

  test("欄位被清空時，原文要能以刪除的形式呈現出來", () => {
    // 行級上這是「該行被換成空行」= modified，不是 removed（removed 保留給
    // 整行消失、後面的行遞補上來的情況）。這裡要保證的不是 kind 叫什麼，
    // 而是**原文有被帶出來**，畫面才畫得出紅字刪除線。
    const d = diffDocs({ s: { a: "本來有字" } }, { s: { a: "" } });
    expect(d).toHaveLength(1);
    expect(d[0]!.before).toBe("本來有字");
    const deleted = inlineDiff(d[0]!.before, d[0]!.after).filter((sg) => sg.kind === "del");
    expect(deleted.map((sg) => sg.text).join("")).toBe("本來有字");
  });

  test("多行內容整段清空 → 後面幾行是 removed", () => {
    const d = diffDocs({ s: { a: "一\n二\n三" } }, { s: { a: "" } });
    expect(d[0]!.marks.filter((m) => m.kind === "removed").map((m) => m.before)).toEqual(["二", "三"]);
  });
});

describe("送審把關", () => {
  test("有未儲存變更就擋下", () => {
    const r = canCommit({ hasUnsaved: true, changedFields: 3 });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("未儲存");
  });

  test("跟主線沒差異就沒東西可送", () => {
    expect(canCommit({ hasUnsaved: false, changedFields: 0 }).ok).toBe(false);
  });

  test("已儲存且有差異才放行", () => {
    expect(canCommit({ hasUnsaved: false, changedFields: 2 }).ok).toBe(true);
  });
});

describe("changedFieldCount", () => {
  test("數的是欄位數不是章節數", () => {
    expect(changedFieldCount({ s: { a: "1", b: "2" } }, { s: { a: "X", b: "Y" } })).toBe(2);
  });
});

describe("版本線上限（防 localStorage 撐爆 → 靜默掉資料）", () => {
  const mk = (i: number, kind: PrdVersion["kind"] = "commit"): PrdVersion => ({
    id: `v${i}`, kind, at: "", byId: "u", byName: "u", message: "", docs: {},
  });

  test("未超過上限時原樣回傳", () => {
    const list = [mk(1), mk(2)];
    expect(capVersions(list, 5)).toBe(list as PrdVersion[]);
  });

  test("超過上限時只留最近 N 筆", () => {
    const list = [mk(1), mk(2), mk(3), mk(4)];
    expect(capVersions(list, 2).map((v) => v.id)).toEqual(["v1", "v2"]);
  });

  test("主線（最近一次 merge）永遠留著 —— 掉了就算不出這一版改了什麼", () => {
    // 前面塞滿 commit，merge 被擠到尾端
    const list = [mk(1), mk(2), mk(3), mk(9, "merge")];
    const out = capVersions(list, 2);
    expect(out.some((v) => v.kind === "merge")).toBe(true);
    expect(out).toHaveLength(2);
  });

  test("留下來的那批本來就有 merge 時不額外處理", () => {
    const list = [mk(1, "merge"), mk(2), mk(3)];
    expect(capVersions(list, 2).map((v) => v.id)).toEqual(["v1", "v2"]);
  });

  test("完全沒有 merge 時就是單純截斷", () => {
    const list = [mk(1), mk(2), mk(3)];
    expect(capVersions(list, 2).map((v) => v.id)).toEqual(["v1", "v2"]);
  });
});
