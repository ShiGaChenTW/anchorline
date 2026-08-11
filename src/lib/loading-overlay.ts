/**
 * 全頁載入遮罩：半透明黑底 + 正中央一個小視窗。
 *
 * 為什麼需要它：專案總覽一進頁就同時在量測 git、抓 PR、算治理覆蓋率，
 * 而畫面在那幾秒內是「先畫一版舊的、資料回來再跳一次」。ADHD 對「東西
 * 自己跳掉」特別敏感——你才剛看懂那個數字，它就變了。遮罩把那段期間
 * 明確標成「還在算」，而不是讓人以為已經算完。
 *
 * **不會卡住**：`show` 一定要搭配 `hide`，而呼叫端還要給一個硬上限
 * （見 `autoHideAfter`）。一個永遠關不掉的遮罩比沒有遮罩糟得多——
 * 整頁失效，而且看不出是哪裡壞了。
 */
const ID = "app-loading-overlay";

export type LoadingOpts = {
  /** 最短顯示時間（毫秒）。太快閃一下比不顯示更像 bug */
  minMs?: number;
  /** 硬上限：到了就自己關，不管呼叫端有沒有呼叫 hide */
  autoHideAfter?: number;
};

let shownAt = 0;
let minMs = 0;
let capTimer: number | undefined;

export function showLoading(text: string, opts: LoadingOpts = {}) {
  minMs = opts.minMs ?? 0;
  shownAt = performance.now();

  let el = document.getElementById(ID);
  if (!el) {
    el = document.createElement("div");
    el.id = ID;
    el.className = "load-back";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.innerHTML = `<div class="load-box">
    <span class="load-dots" aria-hidden="true"><i></i><i></i><i></i></span>
    <p class="load-text"></p>
  </div>`;
  // 文字走 textContent，不進 innerHTML —— 呼叫端傳什麼字串都不該變成標記
  const t = el.querySelector(".load-text");
  if (t) t.textContent = text;
  document.body.setAttribute("aria-busy", "true");

  window.clearTimeout(capTimer);
  if (opts.autoHideAfter) {
    capTimer = window.setTimeout(() => hideLoading(true), opts.autoHideAfter);
  }
}

/** `force` 略過最短顯示時間（硬上限用） */
export function hideLoading(force = false) {
  const el = document.getElementById(ID);
  if (!el) return;
  const wait = force ? 0 : Math.max(0, minMs - (performance.now() - shownAt));
  window.setTimeout(() => {
    document.getElementById(ID)?.remove();
    document.body.removeAttribute("aria-busy");
    window.clearTimeout(capTimer);
  }, wait);
}
