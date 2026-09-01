/**
 * 範本第 0 章的路線表。
 *
 * 勾選版的 `triage()` 已移除（三張卡直接指認，沒有仲裁規則要守）。
 * 這裡守的是資料完整性，以及唯一真的會靜默壞掉的東西：節數與章節對不上。
 */
import { describe, expect, test } from "bun:test";
import {
  hiddenSectionIds,
  isSectionVisible,
  normalizeRoute,
  LITE_SECTIONS,
  PRD_ROUTES,
  projectRoute,
  routeById,
  routeScaleLabel,
  visibleSectionIds,
} from "../src/lib/prd-triage";
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

// ── 路線 → 可見章節 ───────────────────────────────────────────
//
// 降級是檢視過濾器，不是資料遷移。這裡守的是那個承諾的兩半：
// Lite 真的變少（不然三張卡回到純心理暗示），而且沒表態的人看得到全部
// （猜成 Lite 會讓舊專案寫好的七節在編輯台上憑空消失）。

describe("projectRoute", () => {
  test("沒存路線的專案是 full —— 舊專案是照全量章節寫的", () => {
    expect(projectRoute(undefined)).toBe("full");
    expect(projectRoute(null)).toBe("full");
    expect(projectRoute({})).toBe("full");
  });

  test("存了 lite 才是 lite", () => {
    expect(projectRoute({ route: "lite" })).toBe("lite");
    expect(projectRoute({ route: "full" })).toBe("full");
  });
});

describe("visibleSectionIds", () => {
  test("full 回 null（＝全部），不回一份要呼叫端自己比對的清單", () => {
    expect(visibleSectionIds("full")).toBeNull();
  });

  test("lite 回的就是 LITE_SECTIONS", () => {
    expect([...visibleSectionIds("lite")!].sort()).toEqual([...LITE_SECTIONS].sort());
  });
});

describe("isSectionVisible", () => {
  test("full 底下每一節都看得見", () => {
    for (const s of SEED_SECTIONS) expect(isSectionVisible("full", s.id), s.id).toBe(true);
  });

  test("lite 底下只有 LITE_SECTIONS 看得見", () => {
    const allow = new Set<string>(LITE_SECTIONS);
    for (const s of SEED_SECTIONS) {
      expect(isSectionVisible("lite", s.id), s.id).toBe(allow.has(s.id));
    }
  });

  test("自訂章節永遠看得見 —— 它從來沒有被歸給任何一條路線", () => {
    expect(isSectionVisible("lite", "某個自訂章節", true)).toBe(true);
  });
});

describe("hiddenSectionIds", () => {
  test("full 不藏任何東西", () => {
    expect(hiddenSectionIds("full")).toEqual([]);
  });

  test("藏起來的 + 看得見的 = 全部，一節都不能漏", () => {
    const hidden = hiddenSectionIds("lite");
    expect(hidden.length + LITE_SECTIONS.length).toBe(SEED_SECTIONS.length);
    expect(hidden.some((id) => (LITE_SECTIONS as readonly string[]).includes(id))).toBe(false);
  });
});

// ── migrateProject 必須保留 route ──────────────────────────────
//
// 這一條是實測抓到的：`route: "lite"` 寫進了 localStorage，但重新載入時
// `migrateProject` 逐欄位重建，漏列就無聲消失 —— 編輯台照樣顯示 15 節，
// 沒有任何錯誤。store.ts 裡同一個坑的註解已經寫了七次，這是第八次。

describe("normalizeRoute", () => {
  test("lite 存得住 —— 漏了這一步，降級會在重新載入時無聲失效", () => {
    expect(normalizeRoute("lite")).toBe("lite");
  });

  test("其他值一律落回 undefined＝Full —— 錯要錯在「看得到全部」那一邊", () => {
    for (const bad of [undefined, "full", "openspec", "", 1, null, {}]) {
      expect(normalizeRoute(bad), String(bad)).toBeUndefined();
    }
  });
});
