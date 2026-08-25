/**
 * 對話框流程的排隊與讓位 —— 零 DOM、零 store，只管「誰先拿到那把鎖」。
 *
 * ## 為什麼要有這個檔
 *
 * `askCustom` 只有一把鎖，而且 **`rejectIfBusy()` 跑在第一個 `await` 之前**
 * （`ask.ts`：併發檢查必須在任何 `document` 存取之前）。也就是說 `askCustom` 雖然
 * 是 async，呼叫它的那一瞬間鎖就同步被拿走了。
 *
 * 簽核頁上有兩個東西會去拿那把鎖：
 *
 * - **自動跳窗**，掛在 `render()` 尾端
 * - **S1 結案攔截對話框**，在簽核被閘門擋下時開
 *
 * 而閘門被擋下的那一段程式碼是 `render(); void handlePendingGate(p);` ——
 * `render()` 尾端的自動跳窗先跑、同步把鎖拿走，接著 `handlePendingGate` 的
 * `askCustom` 直接 throw「已有對話框開啟」。那是個 `void` 呼叫，**沒有人接**，
 * 而這個 repo 刻意不攔 `unhandledrejection`（`loading-overlay.ts`）。
 *
 * 使用者看到的是：另一張工作單的結果窗，而且**沒有任何一句話說明他的簽核被擋下**。
 * 兩份待拍板分析 + 按一次「稍後再決定」就重現，不需要任何競態。
 *
 * ## 為什麼抽成獨立模組而不是在頁面裡多加一個旗標
 *
 * 因為這條缺陷**不在任何一支函式體內，在兩支之間**。`signoff.ts` 是有 DOM 副作用的
 * 頁面腳本，headless 匯入不了；而 source-grep 型測試的解析度到「函式」為止 ——
 * 既有的 `test("自動跳窗有 isDialogOpen 守門…")` 斷言 `maybeAutoShow` 體內有
 * `isDialogOpen()`，兩個字串都在、測試綠、缺陷還在。
 *
 * 把「順序」搬到這裡之後，它就變成一支可以餵替身、驗呼叫順序的純函式。
 *
 * ## 規則只有一條
 *
 * **使用者的動作優先。** 自動跳窗只是提醒；它把鎖搶走的代價是使用者剛按下的那個
 * 動作整個沒有回應，而那個動作正是這個功能的主要出口。
 */

/** 一條會開對話框的流程。回傳的 Promise 完成即代表這條流程結束 */
export type DialogFlow = () => unknown;

export interface DialogFlows {
  /**
   * 跑一條**使用者主動觸發**的流程。
   *
   * 兩件事只在這裡發生：宣告「這把鎖是使用者的」（自動跳窗從此讓位，直到流程結束），
   * 以及**接住錯誤**。`askCustom` 因鎖被占而 throw 的每一條路徑都要經過這裡 ——
   * 裸的 `void askCustom(...)` 失敗時使用者看到的是「按了沒反應」，
   * 而 console 裡沉著一個沒人接的 rejection。
   */
  runUser(flow: DialogFlow): void;
  /**
   * 試著跑一條**自動觸發**的流程。
   *
   * 已經有窗開著、或使用者的流程正在跑，一律不跑並回 `false`。
   * 呼叫端拿這個回傳值決定要不要把它記成「已經自動開過」—— 讓位的那一次
   * **不算開過**，否則使用者從頭到尾不會看到它。
   */
  tryAuto(flow: DialogFlow): boolean;
  /** 現在拿不拿得到鎖。`true` = 拿不到 */
  isBusy(): boolean;
}

export function createDialogFlows(deps: {
  /** 通常是 `ask.isDialogOpen` */
  isDialogOpen: () => boolean;
  /** 流程丟出來的錯誤往哪去。通常是 `toast` */
  onError: (err: unknown) => void;
}): DialogFlows {
  // 計數而不是布林：一條使用者流程裡會接連開第二個窗（攔截 →「查看」→ 結果窗），
  // 而未來若有巢狀呼叫，布林會在第一個窗關掉時就放行
  let userFlows = 0;

  function settle(flow: DialogFlow, onSettled?: () => void): void {
    try {
      void Promise.resolve(flow())
        .catch(deps.onError)
        .finally(() => onSettled?.());
    } catch (err) {
      // flow 本身同步 throw（非 async 的呼叫端）也要收
      onSettled?.();
      deps.onError(err);
    }
  }

  return {
    runUser(flow) {
      // 先加再跑：`flow()` 同步執行到第一個 await 為止，那段裡面就會拿鎖
      userFlows++;
      let released = false;
      settle(flow, () => {
        if (released) return;
        released = true;
        userFlows--;
      });
    },
    tryAuto(flow) {
      if (deps.isDialogOpen() || userFlows > 0) return false;
      settle(flow);
      return true;
    },
    isBusy() {
      return deps.isDialogOpen() || userFlows > 0;
    },
  };
}
