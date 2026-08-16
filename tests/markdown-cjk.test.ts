/**
 * 中文粗體：`**專案：**內容` 這種寫法在純 CommonMark 下整段變字面星號，
 * 而 UAT／PRD 檔頭幾乎全長這樣。這支測試就是防它回歸。
 */
import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../src/lib/markamd/markdown";

describe("renderMarkdown — CJK 粗體", () => {
  test("全形冒號結尾的粗體要收得起來", () => {
    const html = renderMarkdown("**專案：**Project_Border-loom_rust");
    expect(html).toContain("<strong>專案：</strong>");
    expect(html).not.toContain("**");
  });

  test("中文字直接接粗體也要成立", () => {
    const html = renderMarkdown("測試**重點**在這");
    expect(html).toContain("<strong>重點</strong>");
  });

  test("程式碼區塊裡的星號不能被動到", () => {
    const html = renderMarkdown("```\n**專案：**x\n```");
    expect(html).toContain("**專案：**x");
    expect(html).not.toContain("<strong>");
  });

  test("英文粗體與斜體沒被打壞", () => {
    const html = renderMarkdown("**bold** and *italic*");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });
});
