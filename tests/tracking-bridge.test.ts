/**
 * `plansDirsOf` / `plansDirsOfAll` —— 掃描哪些 `plans/` 目錄。
 *
 * `plansDirsOf` 原本回傳「全部專案」的 plans 目錄，於是側欄選了 A 專案，
 * Task Tracking 卻列出 B、C、D 的計劃檔。那一段的每個案例都是在釘住
 * 「範圍 = 當前選取的專案」這條規則，特別是它**不會**在找不到時
 * 悄悄退回全部。
 *
 * `plansDirsOfAll` 是刻意的相反：收件匣與側欄 badge 問的是「**所有**專案有
 * 幾份報告在等我」。兩支並存不是重複 —— 分開才擋得住「有人為了讓 badge
 * 數得到跨專案，就把 plansDirsOf 的限定拿掉」，那會讓 tracking 頁一起壞掉。
 *
 * 放 tests/ 而非 src/ 的理由同 tracking.test.ts：tsconfig 的 include 是 `src/**`。
 */
import { describe, expect, test } from "bun:test";
import { plansDirsOf, plansDirsOfAll } from "../src/lib/tracking-bridge";

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

describe("plansDirsOfAll（收件匣／badge 的分母）", () => {
  test("所有專案的 plans/ 都回傳，與當前選了誰無關", () => {
    // 這正是 W2-1 要修的：agent 幫 B 專案出的實測題，人在 A 專案工作時
    // 也必須數得到，否則錯過一次喚醒導頁那份報告就從系統裡消失了。
    const projects = [proj("a", "/w/alpha"), proj("b", "/w/beta"), proj("c", "/w/gamma")];
    expect(plansDirsOfAll(projects)).toEqual([
      "/w/alpha/plans",
      "/w/beta/plans",
      "/w/gamma/plans",
    ]);
  });

  test("沒綁資料夾的專案略過，而不是拼出一個 /plans", () => {
    // 少了 filter(Boolean) 會得到字串 "/plans"，那是檔案系統的根目錄下一層 ——
    // 掃它不會報錯，只會安靜地掃錯地方。
    expect(plansDirsOfAll([proj("a"), proj("b", "/w/beta")])).toEqual(["/w/beta/plans"]);
  });

  test("同一個 rootPath 綁在兩個專案上只出現一次", () => {
    // 重複目錄會讓同一份報告被掃回兩次，badge 直接翻倍。
    expect(plansDirsOfAll([proj("a", "/w/same"), proj("b", "/w/same")])).toEqual([
      "/w/same/plans",
    ]);
  });

  test("去掉 rootPath 尾端的斜線，避免出現 //plans", () => {
    expect(plansDirsOfAll([proj("a", "/w/alpha//")])).toEqual(["/w/alpha/plans"]);
  });

  test("空專案清單回空陣列", () => {
    expect(plansDirsOfAll([])).toEqual([]);
  });

  test("當前專案的目錄一定包含在全專案清單裡", () => {
    // 收件匣是 tracking 頁的超集。反過來（badge 少算了當前專案）的症狀是
    // 「總覽列得出來、側欄卻寫 0」，兩個數字互相打臉最傷信任。
    const projects = [proj("a", "/w/alpha"), proj("b", "/w/beta")];
    for (const dir of plansDirsOf(projects, "b")) {
      expect(plansDirsOfAll(projects)).toContain(dir);
    }
  });
});
