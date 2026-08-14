import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../src/lib/markamd/markdown";

// CommonMark flanking 規則會讓 `**專案：**內容`（關閉 ** 前是全形標點、後接文字）
// 關不掉粗體，星號原樣輸出。markdown-it-cjk-friendly 修掉這個。
describe("renderMarkdown CJK emphasis", () => {
  test("全形冒號後直接接文字的粗體要能渲染", () => {
    const html = renderMarkdown("**專案：**Project_Border-loom_rust");
    expect(html).toContain("<strong>專案：</strong>");
    expect(html).not.toContain("**");
  });

  test("UAT 前言的多行標籤全部渲染", () => {
    const src = [
      "**專案：**Project_Border-loom_rust",
      "**日期/時間：**2026-08-14 20:32",
      "**測試編號：**UAT-20260814-01",
      "**已通過免測：** A1–A5",
    ].join("\n");
    const html = renderMarkdown(src);
    expect(html).not.toContain("**");
    expect(html).toContain("<strong>測試編號：</strong>");
  });

  test("一般英文粗體不受影響", () => {
    expect(renderMarkdown("**bold** text")).toContain("<strong>bold</strong>");
  });
});
