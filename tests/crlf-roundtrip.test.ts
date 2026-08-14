/**
 * W1-7：CRLF 檔案的寫回契約。
 *
 * 症狀鏈：mutator 就地把 CRLF 轉 LF → 下一次 safeApply 的位元組級 hash
 * 比對必失敗 → 回報「檔案被改過」拒寫——長得像併發衝突，其實是自己
 * 上一次寫入改了行尾。另外 `.` 不匹配 \r，CRLF 行尾會讓行級 regex
 * 整行比不中——「勾了沒反應」而且零錯誤訊息。
 *
 * 每條測試都做位元組級斷言：改動行以外的每一行、包括行尾，一個位元組都不能變。
 */
import { describe, expect, test } from "bun:test";
import { eolOf, mintMissingIds } from "../src/lib/plan-parser";
import { appendStep, toggleStep } from "../src/lib/plan-writer";
import { setVerdict } from "../src/lib/uat-parser";

const PLAN_LF = [
  "# 計劃",
  "",
  "## Plan Steps",
  "- [ ] 第一步 <!-- anc:t=AAAA1111 -->",
  "- [ ] 沒錨點的步驟",
  "",
  "## 決策紀錄",
  "",
].join("\n");
const PLAN_CRLF = PLAN_LF.replace(/\n/g, "\r\n");

const UAT_LF = [
  "# UAT: 報告",
  "",
  "**狀態：** 進行中",
  "",
  "## T1 題 <!-- anc:t=BBBB2222 -->",
  "",
  "**流程：**",
  "1. 步",
  "",
  "**預期：**",
  "果",
  "",
  "**結果：** 未測",
  "",
  "**說明：**",
  "（無）",
  "",
].join("\n");
const UAT_CRLF = UAT_LF.replace(/\n/g, "\r\n");

describe("eolOf", () => {
  test("純 LF → \\n；含 CRLF → \\r\\n", () => {
    expect(eolOf("a\nb")).toBe("\n");
    expect(eolOf("a\r\nb")).toBe("\r\n");
    expect(eolOf("")).toBe("\n");
  });
});

describe("CRLF round-trip：每個 mutator", () => {
  test("toggleStep 在 CRLF 檔上真的會勾（不是無聲 no-op），且不改行尾", () => {
    const out = toggleStep(PLAN_CRLF, "AAAA1111", true);
    expect(out).not.toBe(PLAN_CRLF); // 有勾到
    expect(out).toContain("- [x] 第一步");
    expect(out.includes("\r\n")).toBe(true);
    // 位元組級：除了勾選那一行，其餘一致
    const a = PLAN_CRLF.split("\r\n");
    const b = out.split("\r\n");
    expect(b.length).toBe(a.length);
    const diff = a.filter((l, i) => l !== b[i]);
    expect(diff.length).toBe(1);
    // 不殘留裸 \n（混用行尾）
    expect(out.replace(/\r\n/g, "").includes("\n")).toBe(false);
  });

  test("appendStep 在 CRLF 檔上插入的新行也用 CRLF", () => {
    const r = appendStep(PLAN_CRLF, "新步驟", () => 0.5);
    expect(r).not.toBeNull();
    expect(r!.text.replace(/\r\n/g, "").includes("\n")).toBe(false);
    expect(r!.text).toContain("新步驟");
  });

  test("mintMissingIds 不再把 CRLF 檔整份轉 LF", () => {
    const { text, minted } = mintMissingIds(PLAN_CRLF, () => 0.5);
    expect(minted).toBe(1); // 沒錨點那一步
    expect(text.includes("\r\n")).toBe(true);
    expect(text.replace(/\r\n/g, "").includes("\n")).toBe(false);
  });

  test("setVerdict 在 CRLF 檔上寫得進去，且不產生混用行尾", () => {
    const r = setVerdict(UAT_CRLF, "BBBB2222", "pass", "", { now: "2026-08-15 04:00" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain("**結果：** 通過");
    expect(r.text.includes("\r\n")).toBe(true);
    expect(r.text.replace(/\r\n/g, "").includes("\n")).toBe(false);
  });

  test("LF 檔行為不變：round-trip 後仍是純 LF", () => {
    const t = toggleStep(PLAN_LF, "AAAA1111", true);
    expect(t.includes("\r")).toBe(false);
    const v = setVerdict(UAT_LF, "BBBB2222", "pass", "");
    expect(v.ok && !v.text.includes("\r")).toBe(true);
  });
});

describe("eolOf 多數決精確計數（Cato-04）", () => {
  test("LF 為主、空行密集、混少量 CRLF → 判 LF", () => {
    const text = "a\n\nb\n\nc\n\nd\n\ne\n\nf\n\n" + "x\r\ny\r\nz\r\nw\r\nv\r\nu\r\nt\r\n";
    expect(eolOf(text)).toBe("\n");
  });
  test("CRLF 為主混少量 LF → 判 CRLF", () => {
    const text = "a\r\nb\r\nc\r\nd\r\ne\r\n" + "x\ny\n";
    expect(eolOf(text)).toBe("\r\n");
  });
});
