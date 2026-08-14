/**
 * UAT 喚醒導頁鏈的前端半段。
 *
 * agent 出完題之後，CLI 會寫一份交件檔再 `open -a Anchorline`。App 這邊要在
 * 「被叫起來」的那一刻把交件取走並帶使用者到那份報告 —— 否則他看到的是一個
 * 自己跳出來、卻停在上次畫面的 App，完全猜不到剛剛發生了什麼事。
 *
 * ## 為什麼 load 與 focus 兩處都要掛
 *
 * App 沒開時 `open -a` 會冷啟動 → 頁面載入那一次抓得到。
 * App 已經開著時 `open -a` **只是把視窗帶到前景，不會重新載入任何頁面** ——
 * 只掛 load 的話，這條鏈在最常見的情境（App 一直開著）永遠不會觸發，
 * 而且不會有任何錯誤，只是「按了沒反應」。
 *
 * ## 取件即消耗，狀態只有一份
 *
 * 刪檔在 Rust 端。這裡不記「我處理過哪些交件」：檔案本身就是那個狀態，
 * 多一份前端狀態只是多一個會跟磁碟不同步的地方。
 *
 * 非桌面版全程什麼都不做 —— 瀏覽器沒有原生通道，這條鏈在那裡不存在。
 */
import { isNative, isUnavailable, native } from "./native";

/** 導頁時報告路徑掛在哪個 query 參數上。tracking 頁靠它著陸。 */
export const UAT_QUERY_KEY = "uat";

/**
 * 已經在 tracking 頁時改用事件交件，不重新導頁。
 *
 * 導頁會整頁重載，把捲動位置、展開狀態、還沒存的說明欄全部丟掉 —— 而使用者
 * 正在做的事很可能就是勾上一份報告。
 */
export const UAT_HANDOFF_EVENT = "anchorline:uat-handoff";

/**
 * 交件檔內容 → 報告路徑。認不得的形狀一律回 `null`，**不丟例外**。
 *
 * 寬容讀兩個欄位名是刻意的：寫檔的是另一支程式（CLI），兩邊對不上時的症狀是
 * 「App 跳出來但沒導頁」，而那個 bug 從畫面上完全看不出根因。`reportPath` 是
 * 合約欄位，`path` 是保險絲。
 */
export function parseHandoff(text: string): string | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    // 壞 JSON：CLI 寫到一半被中斷、或有人手動塞了東西進去。丟掉就好 ——
    // 交件檔已經被讀走了，下一次出題會寫一份新的。
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const p = typeof o["reportPath"] === "string" ? o["reportPath"] : o["path"];
  return typeof p === "string" && p.trim() ? p.trim() : null;
}

/** 現在人在 tracking 頁嗎。判斷方式與 `auth.ts` 的 `isLoginPage` 一致。 */
export function isTrackingPage(): boolean {
  const path = location.pathname.replace(/\\/g, "/");
  return path.endsWith("tracking.html") || path.endsWith("/tracking");
}

/** 報告路徑 → 著陸網址。導頁與測試共用同一段拼接，不要在呼叫端各拼一次。 */
export function trackingUrlFor(reportPath: string): string {
  return `tracking.html?${UAT_QUERY_KEY}=${encodeURIComponent(reportPath)}`;
}

async function takeOnce(): Promise<void> {
  if (!isNative()) return;
  const raw = await native.uatHandoffTake();
  // unavailable（橋壞了）與 null（沒有待辦）在這裡處理方式一樣：什麼都不做。
  // 這支是背景輪詢，沒有任何理由讓它變成使用者看得到的訊息。
  if (isUnavailable(raw) || !raw) return;
  const reportPath = parseHandoff(raw);
  if (!reportPath) return;

  if (isTrackingPage()) {
    window.dispatchEvent(
      new CustomEvent(UAT_HANDOFF_EVENT, { detail: { reportPath } }),
    );
    return;
  }
  location.href = trackingUrlFor(reportPath);
}

let bound = false;

/**
 * 掛上取件檢查。**由共用 bootstrap 呼叫，不是由某一頁。**
 *
 * 喚醒的那一刻使用者停在哪一頁是未知的（agent 交接常常直接落在編輯台），
 * 只在 tracking 頁掛的話，這條鏈在其他頁全部不會發生。
 *
 * 重複呼叫是安全的 —— 每頁 load 都會走一次共用 bootstrap。
 */
export function initUatHandoff(): void {
  if (bound || !isNative()) return;
  bound = true;
  void takeOnce();
  window.addEventListener("focus", () => void takeOnce());
}
