/**
 * `plansDirsOf` —— Task Tracking 掃描哪些 `plans/` 目錄。
 *
 * 這個函式原本回傳「全部專案」的 plans 目錄，於是側欄選了 A 專案，
 * Task Tracking 卻列出 B、C、D 的計劃檔。這裡的每個案例都是在釘住
 * 「範圍 = 當前選取的專案」這條規則，特別是它**不會**在找不到時
 * 悄悄退回全部。
 *
 * 放 tests/ 而非 src/ 的理由同 tracking.test.ts：tsconfig 的 include 是 `src/**`。
 */
import { describe, expect, test } from "bun:test";
import { plansDirsOf } from "../src/lib/tracking-bridge";

const proj = (id: string, rootPath?: string) => ({
  id,
  ...(rootPath ? { importSummary: { rootPath } } : {}),
});

describe("plansDirsOf", () => {
  test("只回傳當前選取專案的 plans/", () => {
    const projects = [proj("a", "/w/alpha"), proj("b", "/w/beta"), proj("c", "/w/gamma")];
    expect(plansDirsOf(projects, "b")).toEqual(["/w/beta/plans"]);
  });

  test("沒有選取專案時回空陣列，而不是退回全部", () => {
    // 這正是原本的 bug：找不到範圍就把所有東西倒出來。
    const projects = [proj("a", "/w/alpha"), proj("b", "/w/beta")];
    expect(plansDirsOf(projects, undefined)).toEqual([]);
    expect(plansDirsOf(projects, null)).toEqual([]);
    expect(plansDirsOf(projects, "")).toEqual([]);
  });

  test("選取的專案不存在時回空陣列", () => {
    expect(plansDirsOf([proj("a", "/w/alpha")], "nope")).toEqual([]);
  });

  test("選取的專案沒綁資料夾時回空陣列", () => {
    // 空清單要讓 UI 說「這個專案沒有計劃檔」，而不是列出鄰居的。
    expect(plansDirsOf([proj("a"), proj("b", "/w/beta")], "a")).toEqual([]);
  });

  test("去掉 rootPath 尾端的斜線，避免出現 //plans", () => {
    expect(plansDirsOf([proj("a", "/w/alpha//")], "a")).toEqual(["/w/alpha/plans"]);
  });

  test("同一個 rootPath 綁在兩個專案上也只出現一次", () => {
    const projects = [proj("a", "/w/same"), proj("a", "/w/same")];
    expect(plansDirsOf(projects, "a")).toEqual(["/w/same/plans"]);
  });

  test("空專案清單不會爆", () => {
    expect(plansDirsOf([], "a")).toEqual([]);
  });
});
