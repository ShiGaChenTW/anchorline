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
  // 呼叫端自己叫了 show，就代表這一頁已經接手了遮罩的生命週期 ——
  // 開場那一段結束了，開場的錯誤攔截也該跟著下班（見 beginBootOverlay）
  disarmBootGuard();
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
  // 進度條是**不定量**的：我們不知道要跑多久，所以不假裝有百分比。
  // 一條會來回跑的填色比三顆點更能表達「還在動」，而假的百分比會讓人
  // 盯著它算什麼時候好 —— 那個數字是編的。
  el.innerHTML = `<div class="load-box">
    <p class="load-text"></p>
    <span class="load-bar" role="progressbar" aria-label="讀取中"><i></i></span>
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

/* ─── 開場遮罩 ────────────────────────────────────────────────
 *
 * 上面那組（show/hide）是給「頁面已經能用、背景在算東西」用的。這一組不同：
 * 它接管**寫死在 HTML 裡**的那一層遮罩，蓋住的是「JS 還沒跑完第一次
 * render」的那段時間。
 *
 * ## 為什麼遮罩要寫死在 HTML，不用 showLoading 建
 *
 * 用 JS 建的遮罩，最快也要等 module 下載、解析、執行完才會出現 —— 而
 * 使用者抱怨的正好是那段時間：側欄、欄位標題、邊框全都畫好了，內容區
 * 卻是空的，標題寫著「載入中…」。那一幕看起來不像在載入，看起來像壞掉。
 * 遮罩必須從**第一次 paint** 就在，所以只能是靜態標記。
 *
 * 所以這裡沒有 `show` 的對應函式：建立那一步由 HTML 負責，這組只管
 * 「接手」與「收掉」。
 *
 * ## 三條收掉的路，缺一不可
 *
 * 1. `endBootOverlay()` —— 正常路徑，由呼叫端放在 `finally` 裡。
 * 2. `autoHideAfter` 硬上限 —— 沒有 throw，但某個 await 永遠不回來。
 * 3. `window` 的 error 攔截 —— module 頂層任何一行 throw，都不會走到
 *    呼叫端的 `finally`（那一行以後的程式碼根本沒執行）。
 *
 * 第 3 條是這裡真正的價值。`try/finally` 只保護得了你包住的那幾行；
 * 開場的風險卻散在十幾個 init 呼叫裡，包不完也不該包 —— 為了包住而把
 * 整個 else 區塊往右縮排一層，diff 會大到沒有人審得動。
 *
 * 攔截只在「開場」這個窗口內有效（module 開始執行 → endBootOverlay），
 * 而那個窗口是**同步**的。這很重要：它意味著攔截不可能誤抓到之後的
 * 點擊事件錯誤，把一個好好的頁面換成錯誤畫面。
 *
 * 刻意**不**攔 `unhandledrejection`：頁面到處都有 `void doSomething()`
 * 這種射後不理的 promise，它們 reject 在現行行為下是無害的。而且
 * rejection 一定在 microtask 之後才通報，那時開場窗口早就關了 —— 攔了
 * 有風險、沒好處。
 */

let bootGuarded = false;
/** 開場已經判定失敗。endBootOverlay 要看它，否則 `finally` 會把錯誤畫面收掉 */
let bootBroke = false;

function onBootError(e: ErrorEvent) {
  failBootOverlay(e.error ?? e.message);
}

function disarmBootGuard() {
  if (!bootGuarded) return;
  bootGuarded = false;
  window.removeEventListener("error", onBootError);
}

/**
 * 接手 HTML 裡那層靜態遮罩。放在頁面腳本的**第一行**：攔截要先裝好，
 * 才擋得住後面任何一行的 throw。
 *
 * 沒找到靜態遮罩就整個不做事 —— 沒轉換過的頁面 import 到這裡不會有副作用。
 */
export function beginBootOverlay(opts: LoadingOpts = {}) {
  if (!document.getElementById(ID)) return;
  bootBroke = false;
  minMs = opts.minMs ?? 0;
  shownAt = performance.now();
  document.body.setAttribute("aria-busy", "true");

  window.clearTimeout(capTimer);
  if (opts.autoHideAfter) {
    capTimer = window.setTimeout(() => hideLoading(true), opts.autoHideAfter);
  }

  if (!bootGuarded) {
    bootGuarded = true;
    window.addEventListener("error", onBootError);
  }
}

/**
 * 開場結束，把遮罩收掉。放在 `finally` 裡 —— 放在 try 尾巴的話，
 * 第一次 render 一 throw 就再也不會執行到，整頁被自己的遮罩鎖死。
 */
export function endBootOverlay() {
  disarmBootGuard();
  if (bootBroke) return; // 錯誤畫面要留著給使用者看
  hideLoading();
}

/**
 * 開場失敗。**不是**把遮罩收掉 —— 收掉只會露出那個半殘的殼，
 * 使用者得自己猜「是還在載入還是壞了」。改成在原地講清楚，並給一條出路。
 */
export function failBootOverlay(err: unknown) {
  disarmBootGuard();
  bootBroke = true;
  window.clearTimeout(capTimer);
  console.error("[boot] 頁面初始化失敗", err);

  let el = document.getElementById(ID);
  if (!el) {
    // 已經收掉了才失敗（例如 render 之後才炸）—— 還是要讓人看得見
    el = document.createElement("div");
    el.id = ID;
    el.className = "load-back";
    document.body.appendChild(el);
  }
  el.setAttribute("role", "alert");
  el.removeAttribute("aria-live");
  el.innerHTML = `<div class="load-box">
    <p class="load-text"></p>
    <p class="load-why"></p>
    <button type="button" class="load-retry">重新載入</button>
  </div>`;
  // 錯誤訊息可能來自任何地方，一律走 textContent —— 不讓它變成標記
  const title = el.querySelector(".load-text");
  if (title) title.textContent = "這一頁沒能載入完成";
  const why = el.querySelector(".load-why");
  if (why) why.textContent = bootErrorText(err);
  el.querySelector(".load-retry")?.addEventListener("click", () => location.reload());
  document.body.removeAttribute("aria-busy");
}

/**
 * 把任何丟出來的東西變成一行可讀的字。
 *
 * 重點在**永遠不回空字串**：錯誤框裡一片空白等於沒講，使用者只會更困惑。
 * 也**永遠不自己丟例外** —— 在錯誤處理路徑上再丟一次，原始錯誤就消失了。
 */
export function bootErrorText(err: unknown): string {
  if (err instanceof Error) return err.message || err.name || "Error";
  if (typeof err === "string") return err || "（沒有錯誤訊息）";
  if (err === null) return "null";
  if (err === undefined) return "undefined";
  try {
    return JSON.stringify(err) || String(err);
  } catch {
    return String(err);
  }
}
