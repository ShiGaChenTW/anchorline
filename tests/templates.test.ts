import { describe, expect, test } from "bun:test";
import { SEED_TEMPLATES } from "../src/data/seed";
import type { TemplateCat } from "../src/data/types";

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

  test("分類都在允許值內", () => {
    const allowed: TemplateCat[] = [
      "core",
      "security",
      "growth",
      "platform",
      "openspec",
      "delivery",
      "research",
    ];
    for (const t of SEED_TEMPLATES) expect(allowed).toContain(t.cat);
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

  test("七個分類都至少有一個範本，頁籤不會點進空畫面", () => {
    const cats = new Set(SEED_TEMPLATES.map((t) => t.cat));
    for (const c of ["core", "security", "growth", "platform", "openspec", "delivery", "research"])
      expect(cats.has(c as TemplateCat)).toBe(true);
  });

  test("數量：原本 12 個 + 新增 14 個", () => {
    expect(SEED_TEMPLATES).toHaveLength(26);
  });
});
