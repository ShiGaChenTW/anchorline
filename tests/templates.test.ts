import { describe, expect, test } from "bun:test";
import { SEED_FULL_TEMPLATES, SEED_TEMPLATES } from "../src/data/seed";
import { templateKind } from "../src/data/types";
import type { TemplateCat } from "../src/data/types";

const SECTION_CATS: TemplateCat[] = [
  "core",
  "security",
  "growth",
  "platform",
  "openspec",
  "delivery",
  "research",
];
const FULL_CATS: TemplateCat[] = ["lean", "narrative", "enterprise", "agile", "technical"];

const SECTION_TEMPLATES = SEED_TEMPLATES.filter((t) => templateKind(t) === "section");

describe("SEED_TEMPLATES", () => {
  test("id 不重複", () => {
    const ids = SEED_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("使用次數一律從 0 起算 —— 內建範本沒有人用過", () => {
    // 舊版寫死 128 / 96 / 140 當「使用次數」顯示，那是編的。
    expect(SEED_TEMPLATES.every((t) => t.uses === 0)).toBe(true);
  });

  test("每個範本都有標題、說明與內容", () => {
    for (const t of SEED_TEMPLATES) {
      expect(t.title.trim().length).toBeGreaterThan(0);
      expect(t.blurb.trim().length).toBeGreaterThan(0);
      expect(t.body.trim().length).toBeGreaterThan(10);
    }
  });

  test("分類不能跨種類 —— 章節範本用章節分類，整份範本用整份分類", () => {
    // 分錯邊的症狀是「卡片在兩個分頁都看不到」：kind 篩掉它，或分類篩掉它
    for (const t of SEED_TEMPLATES) {
      const allowed = templateKind(t) === "full" ? FULL_CATS : SECTION_CATS;
      expect(allowed).toContain(t.cat);
    }
  });

  test("OpenSpec 分類的內容要符合官方三層格式", () => {
    const req = SEED_TEMPLATES.find((t) => t.id === "t13")!;
    expect(req.body).toContain("### Requirement:");
    expect(req.body).toContain("#### Scenario:");
    expect(req.body).toMatch(/\bSHALL\b|\bMUST\b/);

    const delta = SEED_TEMPLATES.find((t) => t.id === "t14")!;
    for (const h of ["## ADDED Requirements", "## MODIFIED Requirements", "## REMOVED Requirements"])
      expect(delta.body).toContain(h);

    const proposal = SEED_TEMPLATES.find((t) => t.id === "t15")!;
    for (const h of ["## Intent", "## Scope", "## Approach"]) expect(proposal.body).toContain(h);

    const tasks = SEED_TEMPLATES.find((t) => t.id === "t16")!;
    expect(tasks.body).toMatch(/- \[ \] 1\.1/);
  });

  test("七個章節分類都至少有一個範本，頁籤不會點進空畫面", () => {
    const cats = new Set(SECTION_TEMPLATES.map((t) => t.cat));
    for (const c of SECTION_CATS) expect(cats.has(c)).toBe(true);
  });

  test("數量：章節範本 26 個 + 整份 PRD 範本 10 個", () => {
    expect(SECTION_TEMPLATES).toHaveLength(26);
    expect(SEED_TEMPLATES).toHaveLength(36);
  });
});

describe("SEED_FULL_TEMPLATES（整份 PRD 範本）", () => {
  test("全部標成 full —— 漏標就會掉進章節範本分頁", () => {
    for (const t of SEED_FULL_TEMPLATES) expect(t.kind).toBe("full");
    expect(SEED_FULL_TEMPLATES).toHaveLength(10);
  });

  test("五個分類都至少有一個範本", () => {
    const cats = new Set(SEED_FULL_TEMPLATES.map((t) => t.cat));
    for (const c of FULL_CATS) expect(cats.has(c)).toBe(true);
  });

  test("每一份都標出處 —— 照抄的人有權知道抄的是誰的方法論", () => {
    for (const t of SEED_FULL_TEMPLATES) expect(t.source?.trim().length ?? 0).toBeGreaterThan(0);
  });

  test("整份範本至少有三個章節標題，否則它只是一個段落", () => {
    for (const t of SEED_FULL_TEMPLATES) {
      const headings = t.body.split("\n").filter((l) => /^#{1,3} /.test(l));
      expect(headings.length).toBeGreaterThanOrEqual(3);
    }
  });

  test("Shape Up Pitch 五要素齊全", () => {
    const pitch = SEED_FULL_TEMPLATES.find((t) => t.id === "f8")!;
    for (const k of ["Problem", "Appetite", "Solution", "Rabbit holes", "No-gos"])
      expect(pitch.body).toContain(k);
  });

  test("Google 設計文件要有目標／非目標與考慮過的其他方案", () => {
    const doc = SEED_FULL_TEMPLATES.find((t) => t.id === "f9")!;
    for (const h of ["## 目標", "## 非目標", "## 考慮過的其他方案"]) expect(doc.body).toContain(h);
  });

  test("PR/FAQ 要有新聞稿與兩種 FAQ", () => {
    const prfaq = SEED_FULL_TEMPLATES.find((t) => t.id === "f3")!;
    for (const h of ["# 新聞稿", "# 對外 FAQ", "# 對內 FAQ"]) expect(prfaq.body).toContain(h);
  });
});
