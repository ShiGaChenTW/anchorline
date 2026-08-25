import { test, expect, describe, afterEach } from "bun:test";
import { escapeHtml } from "../src/lib/ui";
import {
  acquireDialogLock,
  releaseDialogLock,
  isDialogOpen,
  mapOutcome,
  resolveLabels,
  askConfirm,
  askCustom,
  askText,
  showAlert,
} from "../src/lib/ask";

afterEach(releaseDialogLock);

describe("escapeHtml", () => {
  test("跳脫 &", () => {
    expect(escapeHtml("&")).toBe("&amp;");
  });

  test("跳脫 <", () => {
    expect(escapeHtml("<")).toBe("&lt;");
  });

  test("跳脫 >", () => {
    expect(escapeHtml(">")).toBe("&gt;");
  });

  test('跳脫 "', () => {
    expect(escapeHtml('"')).toBe("&quot;");
  });

  test("四個字元一起出現", () => {
    expect(escapeHtml(`<a href="x"> &`)).toBe("&lt;a href=&quot;x&quot;&gt; &amp;");
  });

  test("空字串", () => {
    expect(escapeHtml("")).toBe("");
  });

  test("不需跳脫的字元原樣通過", () => {
    expect(escapeHtml("hello 確認")).toBe("hello 確認");
  });
});

describe("concurrency", () => {
  test("acquire 第一次 true、第二次 false；isDialogOpen 反映狀態；release 重設", () => {
    expect(isDialogOpen()).toBe(false);
    expect(acquireDialogLock()).toBe(true);
    expect(isDialogOpen()).toBe(true);
    expect(acquireDialogLock()).toBe(false);
    expect(isDialogOpen()).toBe(true);
    releaseDialogLock();
    expect(isDialogOpen()).toBe(false);
    expect(acquireDialogLock()).toBe(true);
  });

  test("lock 被佔用時 askConfirm reject，且不碰 document", async () => {
    expect(acquireDialogLock()).toBe(true);
    await expect(askConfirm({ title: "x" })).rejects.toThrow();
  });

  test("lock 被佔用時 askText reject，且不碰 document", async () => {
    expect(acquireDialogLock()).toBe(true);
    await expect(askText({ title: "x" })).rejects.toThrow();
  });

  test("lock 被佔用時 showAlert reject，且不碰 document", async () => {
    expect(acquireDialogLock()).toBe(true);
    await expect(showAlert({ title: "x" })).rejects.toThrow();
  });

  /**
   * askCustom 走的必須是**同一個** lock，不是自己一份。
   *
   * W2-B 的自動跳窗會在 agent 跑完的當下開窗，而使用者那時可能正開著別的
   * 對話框。兩個 modal 疊起來時 focus trap 會互相搶焦點、Escape 只關掉一個，
   * 而底下那個的 Promise 永遠不 resolve —— 送審流程就停在那裡不動了。
   */
  test("lock 被佔用時 askCustom reject，且不碰 document", async () => {
    expect(acquireDialogLock()).toBe(true);
    await expect(askCustom({ title: "x", bodyHtml: "<p>y</p>" })).rejects.toThrow();
  });

  test("askCustom reject 之後 lock 沒有被它偷偷放掉", async () => {
    expect(acquireDialogLock()).toBe(true);
    await expect(askCustom({ title: "x", bodyHtml: "" })).rejects.toThrow();
    // 原本那個對話框還開著 —— askCustom 失敗不該把別人的鎖解掉
    expect(isDialogOpen()).toBe(true);
  });
});

describe("mapOutcome", () => {
  test("confirm kind：確認 → true、取消 → false", () => {
    expect(mapOutcome("confirm", "confirm")).toBe(true);
    expect(mapOutcome("confirm", "cancel")).toBe(false);
  });

  test("text kind：取消 → null，確認空字串 → \"\" 且不是 null", () => {
    const empty = mapOutcome("text", "confirm", "");
    expect(empty).toBe("");
    expect(empty === "").toBe(true);
    expect(empty !== null).toBe(true);
    expect(mapOutcome("text", "cancel")).toBeNull();
  });

  /**
   * custom 三態必須分得開。
   *
   * W2-B 的「稍後再決定」與「不採用」是兩個相反的決定：前者工作單留在 pending
   * （之後還能拍板），後者寫進 discarded（不再落地）。塌成同一個 falsy 的話，
   * 使用者按「稍後再決定」就會把分析丟掉，而畫面上兩者都只是「窗關了」。
   */
  test("custom kind：三種 action 各自回得出來", () => {
    expect(mapOutcome("custom", "confirm")).toEqual({ action: "confirm", value: undefined });
    expect(mapOutcome("custom", "cancel")).toEqual({ action: "cancel" });
    expect(mapOutcome("custom", "extra")).toEqual({ action: "extra" });
  });

  test("custom kind：只有 confirm 帶 value 回來", () => {
    const picked = { "ws-1": "emp-1", "ws-2": null };
    expect(mapOutcome("custom", "confirm", undefined, picked)).toEqual({
      action: "confirm",
      value: picked,
    });
    // 取消與不採用不得帶值 —— 帶了的話呼叫端會以為使用者「確認了這份選擇」
    expect(mapOutcome("custom", "cancel", undefined, picked)).toEqual({ action: "cancel" });
    expect(mapOutcome("custom", "extra", undefined, picked)).toEqual({ action: "extra" });
  });

  test("custom 的 value 不會漏進其他 kind 的回傳值", () => {
    expect(mapOutcome("confirm", "confirm", undefined, { leaked: true })).toBe(true);
    expect(mapOutcome("text", "confirm", "abc", { leaked: true })).toBe("abc");
  });
});

describe("resolveLabels", () => {
  test("省略時填預設值", () => {
    expect(resolveLabels({ title: "x" }, "confirm")).toEqual({
      confirmLabel: "確認",
      cancelLabel: "取消",
    });
    expect(resolveLabels({ title: "x" }, "text")).toEqual({
      confirmLabel: "確認",
      cancelLabel: "取消",
    });
    expect(resolveLabels({ title: "x" }, "alert")).toEqual({
      confirmLabel: "確定",
      cancelLabel: "取消",
    });
    // custom 跟 confirm 一樣 —— 「確定」是 alert 專屬的單鈕字樣
    expect(resolveLabels({ title: "x" }, "custom")).toEqual({
      confirmLabel: "確認",
      cancelLabel: "取消",
    });
  });

  test("呼叫端提供的值勝出", () => {
    expect(
      resolveLabels({ title: "x", confirmLabel: "刪除", cancelLabel: "不要" }, "confirm"),
    ).toEqual({
      confirmLabel: "刪除",
      cancelLabel: "不要",
    });
    expect(resolveLabels({ title: "x", confirmLabel: "知道了" }, "alert")).toEqual({
      confirmLabel: "知道了",
      cancelLabel: "取消",
    });
    expect(resolveLabels({ title: "x", cancelLabel: "關閉" }, "text")).toEqual({
      confirmLabel: "確認",
      cancelLabel: "關閉",
    });
  });
});
