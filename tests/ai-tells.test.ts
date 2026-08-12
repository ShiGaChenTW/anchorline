import { describe, expect, test } from "bun:test";
import {
  AI_TELL_TERMS,
  aiTellFindings,
  DEFAULT_STYLE_SAMPLE,
  LONG_BULLET,
  LONG_SENTENCE,
  WRITING_DISCIPLINE,
} from "../src/lib/ai-tells";

// 診斷依據是 HelmDeck 實測樣本：AI 味主要是**結構**（長句、不分段、
// 超長條列），不是空話。這組測試用「像那份樣本的輸入」當案例。

describe("結構檢查", () => {
  test("一路逗號串到底的長句要被抓到", () => {
    const s = `這份報告要在派工給實作代理之前，把跨文件的落差一次盤完，給出可直接貼回的修改文字，並明確標記哪些風險本階段接受，哪些必須先補，同時列出每一項的嚴重度與收斂條件，避免範圍繼續膨脹`;
    expect(s.length).toBeGreaterThan(LONG_SENTENCE);
    expect(aiTellFindings(s).some((f) => f.kind === "long-sentence")).toBe(true);
  });

  test("斷好句的同樣內容不觸發", () => {
    const s = "報告在派工前把落差盤完。每項標嚴重度與收斂條件。風險分兩類：本階段接受的，與必須先補的。";
    expect(aiTellFindings(s).filter((f) => f.kind === "long-sentence")).toEqual([]);
  });

  test("超過 400 字沒有空行＝一面牆", () => {
    const wall = "這是一句話。".repeat(80); // 480 字、有句號、無空行
    expect(aiTellFindings(wall).some((f) => f.kind === "wall")).toBe(true);
    // 同樣長度、有分段就不是牆
    const paged = `${"這是一句話。".repeat(40)}\n\n${"這是一句話。".repeat(40)}`;
    expect(aiTellFindings(paged).some((f) => f.kind === "wall")).toBe(false);
  });

  test("超長條列項（HelmDeck 樣本的主要病灶）", () => {
    const b = `- ${"跨文件比對七份規格與現有實作，".repeat(12)}`;
    expect(b.length).toBeGreaterThan(LONG_BULLET);
    expect(aiTellFindings(b).some((f) => f.kind === "long-bullet")).toBe(true);
    expect(aiTellFindings("- 先一句結論\n- 細節放子條列").length).toBe(0);
  });
});

describe("詞面檢查", () => {
  test("樣板語逐一命中", () => {
    const hit = aiTellFindings("本專案旨在打造一站式平台，賦能使用者。");
    expect(hit.some((f) => f.kind === "term" && f.message.includes("旨在"))).toBe(true);
    expect(hit.some((f) => f.message.includes("一站式"))).toBe(true);
  });

  test("「不僅…更…」排比要靠 regex，不在詞表裡", () => {
    expect(aiTellFindings("這不僅是工具，更是一種方法。").some((f) => f.message.includes("排比"))).toBe(true);
    expect(aiTellFindings("不僅台北，高雄也要。").some((f) => f.message.includes("排比"))).toBe(false);
  });

  test("乾淨文字零誤報", () => {
    expect(aiTellFindings("補上 TOTP 與 WebAuthn。Q4 前通過審查。")).toEqual([]);
    expect(aiTellFindings("")).toEqual([]);
  });
});

describe("兩面一致", () => {
  test("紀律段落引用同一份詞表與門檻 —— 改標準要兩邊一起動", () => {
    for (const w of AI_TELL_TERMS) expect(WRITING_DISCIPLINE).toContain(w);
    expect(WRITING_DISCIPLINE).toContain(String(LONG_SENTENCE));
  });

  test("出廠語氣樣本自己要過檢查 —— 錨點帶病等於教壞", () => {
    expect(aiTellFindings(DEFAULT_STYLE_SAMPLE)).toEqual([]);
  });
});
