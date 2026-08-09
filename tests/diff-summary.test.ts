import { describe, expect, test } from "bun:test";
import { diffRowsHtml } from "../src/lib/diff-summary";

/**
 * 這一組守的是「使用者實際看得到什麼」。
 * 三種標示是需求本身：橘底（有未儲存變更）、藍字新增、紅字刪除線。
 * 前兩者在 CSS，這裡守的是**資料有沒有被畫出來** —— 之前刪除線畫不出來，
 * 原因就是資料層根本沒產出刪除，CSS 一直在等一份永遠不會來的輸入。
 */
describe("diffRowsHtml", () => {
  test("沒有差異就不產生任何列", () => {
    expect(diffRowsHtml("一樣", "一樣")).toBe("");
  });

  test("新增的行標成 fv-add", () => {
    const html = diffRowsHtml("第一行", "第一行\n第二行");
    expect(html).toContain("fv-add");
    expect(html).toContain("第二行");
  });

  test("整行刪除要畫出紅字刪除線的列", () => {
    const html = diffRowsHtml("第一行\n要刪的\n第三行", "第一行\n第三行");
    expect(html).toContain("fv-line-removed");
    expect(html).toContain("fv-del");
    expect(html).toContain("要刪的");
  });

  test("行內改字同時有 add 與 del", () => {
    const html = diffRowsHtml("痛點是使用者找不到入口", "本專案旨在解決使用者找不到入口");
    expect(html).toContain("fv-del");
    expect(html).toContain("fv-add");
  });

  test("沒動的行不出現在摘要裡 —— 摘要只講改了什麼", () => {
    const html = diffRowsHtml("保留這行\n改這行", "保留這行\n改過了");
    expect(html).not.toContain("保留這行");
    // 改動的那一行會被行內 diff 拆成 same/del/add 三段（「改」沒動、
    // 「這行」刪掉、「過了」新增），所以斷言拆開後的片段而不是完整字串。
    expect(html).toContain('<span class="fv-add">過了</span>');
    expect(html).toContain('<span class="fv-del">這行</span>');
  });

  test("刪在最後面的行也要畫出來", () => {
    const html = diffRowsHtml("a\nb\nc", "a");
    expect((html.match(/fv-line-removed/g) ?? []).length).toBe(2);
  });

  test("HTML 特殊字元要跳脫，不能讓內容注入標記", () => {
    const html = diffRowsHtml("", "<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
