/**
 * 範本第 0 章的路線表。
 *
 * 勾選版的 `triage()` 已移除（三張卡直接指認，沒有仲裁規則要守）。
 * 這裡守的是資料完整性，以及唯一真的會靜默壞掉的東西：節數與章節對不上。
 */
import { describe, expect, test } from "bun:test";
import { LITE_SECTIONS, PRD_ROUTES, routeById, routeScaleLabel } from "../src/lib/prd-triage";
import { SEED_SECTIONS } from "../src/data/seed";

describe("PRD_ROUTES", () => {
  test("剛好三條路線，id 不重複", () => {
    const ids = PRD_ROUTES.map((r) => r.id);
    expect(ids).toEqual(["full", "lite", "openspec"]);
    expect(new Set(ids).size).toBe(3);
  });

  test("每條都有名稱、說明與至少一條適用情境（卡片四欄不能開天窗）", () => {
    for (const r of PRD_ROUTES) {
      expect(r.name.length, `${r.id} 缺名稱`).toBeGreaterThan(0);
      expect(r.desc.length, `${r.id} 缺說明`).toBeGreaterThan(0);
      expect(r.cases.length, `${r.id} 缺適用情境`).toBeGreaterThan(0);
      expect(r.cases.every((c) => c.trim().length > 0)).toBe(true);
    }
  });

  test("routeById 認得的回物件，不認得的回 null（不拋錯）", () => {
    expect(routeById("lite")?.name).toBe(PRD_ROUTES[1]!.name);
    expect(routeById("不存在")).toBeNull();
  });
});

// ── 節數必須跟真的章節對得上 ──────────────────────────────────
//
// 寫死數字的失敗是靜默的：有人加了一章，卡片還在說舊數字，沒有任何錯誤。

describe("routeScaleLabel", () => {
  test("Full 的節數等於通用骨架章節數", () => {
    expect(routeScaleLabel(PRD_ROUTES[0]!)).toBe(`Full ${SEED_SECTIONS.length} 節（全量）`);
  });

  test("Lite 的節數等於 LITE_SECTIONS 長度", () => {
    expect(routeScaleLabel(PRD_ROUTES[1]!)).toBe(`Lite ${LITE_SECTIONS.length} 節（簡化）`);
  });

  test("OpenSpec 那條不報節數 —— 它根本不寫 PRD", () => {
    expect(routeScaleLabel(PRD_ROUTES[2]!)).not.toMatch(/\d+ 節/);
  });
});

// ── LITE_SECTIONS 必須指向真的存在的章節 ──────────────────────

describe("LITE_SECTIONS", () => {
  test("每個 id 都在通用骨架裡", () => {
    const ids = new Set(SEED_SECTIONS.map((s) => s.id));
    for (const id of LITE_SECTIONS) {
      expect(ids.has(id), `LITE_SECTIONS 的「${id}」不在 SEED_SECTIONS 裡`).toBe(true);
    }
  });

  test("是通用骨架的真子集（Lite 比 Full 短）", () => {
    expect(LITE_SECTIONS.length).toBeLessThan(SEED_SECTIONS.length);
  });
});
