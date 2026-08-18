import { describe, expect, test } from "bun:test";
import {
  UAT_BOARD_LEFT,
  UAT_BOARD_LESS,
  UAT_BOARD_MORE,
  UAT_BOARD_PREVIEW,
  UAT_BOARD_RIGHT,
  UAT_BOARD_TITLE,
  uatBoardListOverflow,
  uatBoardNeedsMore,
} from "../src/lib/uat-board";

describe("uat-board 契約", () => {
  test("標題與左右副標是指定文案", () => {
    expect(UAT_BOARD_TITLE).toBe("UAT測試");
    expect(UAT_BOARD_LEFT).toBe("待測試報告");
    expect(UAT_BOARD_RIGHT).toBe("重測&待修復");
    expect(UAT_BOARD_MORE).toBe("顯示更多");
    expect(UAT_BOARD_LESS).toBe("顯示較少");
  });

  test("預覽上限是 5", () => {
    expect(UAT_BOARD_PREVIEW).toBe(5);
  });

  test("5 筆以內不出現顯示更多", () => {
    expect(uatBoardNeedsMore(0)).toBe(false);
    expect(uatBoardNeedsMore(5)).toBe(false);
  });

  test("第 6 筆起才需要顯示更多", () => {
    expect(uatBoardNeedsMore(6)).toBe(true);
    expect(uatBoardNeedsMore(11)).toBe(true);
  });

  test("展開只改 overflow，不暗示長高", () => {
    expect(uatBoardListOverflow(false)).toBe("hidden");
    expect(uatBoardListOverflow(true)).toBe("auto");
  });
});
