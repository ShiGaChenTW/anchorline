/**
 * 總覽「UAT測試」卡的版面契約。
 *
 * 存在理由：左右兩欄共用同一張卡、同一卡高。預覽列數與「要不要顯示更多」
 * 若散落在 markup 裡，之後改 5 成 6 會漏一邊。這裡只放純數字與文案，
 * 畫面高度由 CSS 用同一常數鎖住。
 */

export const UAT_BOARD_PREVIEW = 5;

export const UAT_BOARD_TITLE = "UAT測試";
export const UAT_BOARD_LEFT = "待測試報告";
export const UAT_BOARD_RIGHT = "重測&待修復";
export const UAT_BOARD_MORE = "顯示更多";
export const UAT_BOARD_LESS = "顯示較少";

/** 超過預覽列數才需要按鈕。剛好 5 筆不必再點一次看同一批。 */
export function uatBoardNeedsMore(count: number, limit = UAT_BOARD_PREVIEW): boolean {
  return count > limit;
}

/**
 * 清單永遠畫完整列，高度鎖在 `limit` 列。
 * 收合：overflow hidden，第 6 筆被裁掉。
 * 展開：overflow auto，同一高度內捲。
 */
export function uatBoardListOverflow(expanded: boolean): "hidden" | "auto" {
  return expanded ? "auto" : "hidden";
}
