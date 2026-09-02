/**
 * 簽核紀錄的單列渲染 —— 純函式，零 I/O、零 DOM。
 *
 * ## 為什麼從 `pages/signoff.ts` 搬出來
 *
 * 這一列要分岔了：自簽事件的標題、徽章、意見三處都跟一般核准不同。而它原本
 * 是頁面裡的一個區域變數，藏在 `requireAuth()` 後面，測試呼叫不到 ——
 * 全 repo 沒有 DOM 測試環境，105 個測試檔全是「吃 plain data、回字串」的比對，
 * 這一列不搬出來就一行都測不到。
 *
 * 唯一的替代方案是把「自簽」兩個字寫成 CSS `content:` 注入，靠選擇器決定顯不
 * 顯示。那是把使用者讀得到的文案藏進樣式表：改文案要去改 CSS、翻譯抓不到、
 * 而且 grep「自簽」在 `src/` 裡會查無此物。徽章是內容，不是裝飾。
 *
 * 所以這裡是**唯一一個**產出簽核紀錄列的地方，頁面那一層只負責把 store 的
 * 東西湊齊交進來。
 */
import { SELF_SIGN_HUMAN, type TimelineEntry } from "./signoff";
import { sinceLabel } from "./time-format";
import { escapeHtml } from "./ui";

/**
 * 一筆簽核紀錄。
 *
 * `now` 預設吃系統時間，但收成參數 —— 測試要斷言「三天前」這種相對時間，
 * 得先把「現在」釘住。
 */
export function timelineRowHtml(e: TimelineEntry, now: number = Date.now()): string {
  const selfSign = e.kind === "selfsign";
  // 自簽的 detail 已經是人話（`SELF_SIGN_HUMAN`），錨點單獨用等寬字排 ——
  // 內部 join key（`anc:t=…`）從頭到尾不出現在畫面上。
  const detail =
    selfSign && e.anchor
      ? `${escapeHtml(SELF_SIGN_HUMAN)} · 錨點 <span class="mono">${escapeHtml(e.anchor)}</span>`
      : escapeHtml(e.detail);
  return `<li class="sg-log sg-log--${e.kind}">
      <span class="sg-log-when mono">${escapeHtml(e.at ? sinceLabel(e.at, now) : "時間不詳")}</span>
      <span class="sg-log-body">
        <b>${escapeHtml(e.title)}</b>${selfSign ? `<span class="sg-selfsign">自簽</span>` : ""}
        <span class="sg-log-who">${escapeHtml(e.who)}</span>
        <span class="sg-log-detail">${detail}</span>
      </span>
    </li>`;
}
