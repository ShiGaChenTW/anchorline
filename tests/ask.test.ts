import { test, expect, describe, afterEach } from "bun:test";
import { escapeHtml } from "../src/lib/ui";
import {
  acquireDialogLock,
  releaseDialogLock,
  isDialogOpen,
  mapOutcome,
  resolveLabels,
  askConfirm,
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
