/**
 * 送審按鈕按下去之後的那段順序 —— 預檢 → 指派對話框 → commit → 送審。
 *
 * ## 為什麼要從 `editor.ts` 抽出來
 *
 * 這一段的全部價值就在**順序**，而順序是 source-grep 驗不到的東西。Wave 2 的
 * 教訓逐字是：「source-grep 型測試的解析度到『函式』為止」—— C-1／C-3 兩條缺陷
 * 都在函式**之間**，兩邊各自的字串都在、測試全綠、缺陷還在。
 *
 * 這一輪 Scott 撞到的缺陷是同一個形狀：`commitForReview` 的閘門是對的、
 * 指派對話框的位置也是對的，錯的是「檢查跑在對話框之後」——
 * **兩個都對的東西，順序錯了。** 抽成純函式、餵記錄呼叫的替身，
 * 才驗得到「沒東西可送時，對話框一次都沒被開啟」。
 *
 * ## 兩條不可以動的順序
 *
 * 1. **預檢在對話框之前。** 否則使用者逐關選完人、按下送出，才被告知
 *    根本沒東西可送 —— 白做工。這是這一輪修的缺陷。
 * 2. **對話框在 commit 之前。** 否則使用者一按取消就留下一個沒人要的
 *    版本快照，而版本清單上看不出它是廢的。這是 W2-A 已經釘住的。
 *
 * ## 這裡不做判斷，只排順序
 *
 * `precheck` 的規則在 `store.commitPrecheck()`（它跟 `commitForReview` 共用
 * 同一支 `canCommit`）。這支函式**不重寫任何一條規則**，也不知道規則長什麼樣 ——
 * 它只負責「誰先問、誰後問、擋下來就不要往下走」。
 */
import type { Docs } from "./prd-versions";

/** 使用者按了取消。`undefined` 是「不必問」，兩者在送審路徑上是相反的決定 */
export const CANCELLED = Symbol("submit-cancelled");

export type SubmitOutcome =
  /** 擋下來了：沒有開對話框、沒有拍快照、沒有動到任何 state */
  | { status: "blocked"; message: string }
  /** 使用者在指派對話框按了取消：沒有拍快照 */
  | { status: "cancelled"; message: string }
  /** 送出去了 */
  | { status: "submitted"; message: string };

export type SubmitFlowDeps<A> = {
  /** 唯讀預檢，一律接 `store.commitPrecheck()` —— 不要在這裡另外算一份 */
  precheck: () => { ok: boolean; reason?: string };
  /** 逐關指派對話框。回 `CANCELLED` = 使用者取消；回 `undefined` = 這次不必問 */
  ask: () => Promise<A | undefined | typeof CANCELLED>;
  /** 拍快照，一律接 `store.commitForReview()` —— 它自己還有一道同樣的閘門 */
  commit: () => { ok: boolean; reason?: string; versionId?: string; docs?: Docs };
  /** 把快照與逐關指派交給個案。漏了指派就是 Wave 1 F0 的形狀（問完就丟的問卷） */
  submit: (versionId: string, assignments: A | undefined) => void;
  /** 這一版相對主線改了幾個欄位；沒有主線回 `null`（第一個版本） */
  changedFields: (docs: Docs) => number | null;
};

export async function runSubmitFlow<A>(deps: SubmitFlowDeps<A>): Promise<SubmitOutcome> {
  // ① 預檢在最前面。這一步失敗就**什麼都不做** —— 特別是不開對話框。
  const pre = deps.precheck();
  if (!pre.ok) return { status: "blocked", message: pre.reason ?? "無法送審" };

  // ② 逐關指派。取消就直接收工，不拍快照。
  const assignments = await deps.ask();
  if (assignments === CANCELLED) return { status: "cancelled", message: "已取消送審" };

  // ③ commit：對整份 PRD 拍快照。審閱者看的是這一份，
  //    不是「送審之後又被改過的當下內容」。
  const commit = deps.commit();
  if (!commit.ok || !commit.versionId || !commit.docs) {
    return { status: "blocked", message: commit.reason ?? "無法送審" };
  }

  // ④ 把這一份 commit 綁進個案，連同逐關指派一起交出去。
  deps.submit(commit.versionId, assignments);

  const changed = deps.changedFields(commit.docs);
  return {
    status: "submitted",
    message:
      changed === null
        ? "已送出審閱 —— 這是第一個版本"
        : `已送出審閱 —— 這一版改了 ${changed} 個欄位`,
  };
}
