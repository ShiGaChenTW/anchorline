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
  routeSectionCount,
  upgradeSeedText,
  VIBE_SECTIONS,
  visibleSectionIds,
} from "../src/lib/prd-triage";
import { SEED_SECTIONS } from "../src/data/seed";

describe("PRD_ROUTES", () => {
  test("剛好四條路線，id 不重複", () => {
    const ids = PRD_ROUTES.map((r) => r.id);
    expect(ids).toEqual(["full", "lite", "vibe", "openspec"]);
    expect(new Set(ids).size).toBe(4);
  });

  test("每條都有名稱、說明、時機與至少一條適用情境（卡片欄位不能開天窗）", () => {
    for (const r of PRD_ROUTES) {
      expect(r.name.length, `${r.id} 缺名稱`).toBeGreaterThan(0);
      expect(r.desc.length, `${r.id} 缺說明`).toBeGreaterThan(0);
      expect(r.timing.length, `${r.id} 缺時機`).toBeGreaterThan(0);
      expect(r.cases.length, `${r.id} 缺適用情境`).toBeGreaterThan(0);
      expect(r.cases.every((c) => c.trim().length > 0)).toBe(true);
    }
  });

  test("試作／探索那張卡的欄位齊全", () => {
    const vibe = routeById("vibe")!;
    expect(vibe.name).toBe("試作／探索");
    expect(vibe.desc).toContain("還不確定要不要做");
    expect(vibe.sections).toEqual(VIBE_SECTIONS);
    // 適用情境涵蓋：週末專案／一次性腳本／想法未成形／之後可能轉正
    const cases = vibe.cases.join("\n");
    for (const kw of ["週末專案", "一次性腳本", "還沒成形", "轉正"]) {
      expect(cases, `vibe 適用情境缺「${kw}」`).toContain(kw);
    }
  });

  test("UI 全程不出現 L0–L4 檔位編號 —— flow-layers 已用 L1–L6，撞名比對齊社群術語貴", () => {
    for (const r of PRD_ROUTES) {
      const text = [r.name, r.desc, r.timing, routeScaleLabel(r), ...r.cases].join("\n");
      expect(text, `${r.id} 的卡片文案出現 L 編號`).not.toMatch(/L[0-4]/);
    }
  });

  test("routeById 認得的回物件，不認得的回 null（不拋錯）", () => {
    expect(routeById("lite")?.name).toBe(PRD_ROUTES[1]!.name);
    expect(routeById("vibe")?.name).toBe("試作／探索");
    expect(routeById("不存在")).toBeNull();
  });
});

// ── 卡片上的「時機」行 ────────────────────────────────────────
//
// 決策 3：升檔訊號（6 個 change／3 題 UAT 失敗）只以靜態文案呈現，
// 系統不做任何自動偵測。文案在就是全部 —— 這裡逐卡釘住關鍵詞。

describe("timing —— 四張卡各一行時機文案", () => {
  test("vibe：動工前 5 分鐘、AI 起草你只審，並含升檔訊號的數字", () => {
    const t = routeById("vibe")!.timing;
    expect(t).toContain("動工前 5 分鐘");
    expect(t).toContain("AI 起草");
    expect(t).toContain("6 個 change");
    expect(t).toContain("3 題 UAT");
  });

  test("openspec：不寫 PRD，一個 change 一份紀錄", () => {
    const t = routeById("openspec")!.timing;
    expect(t).toContain("不寫 PRD");
    expect(t).toContain("一個 change 一份紀錄");
  });

  test("lite：出現轉折訊號就轉", () => {
    const t = routeById("lite")!.timing;
    expect(t).toContain("轉折訊號");
    expect(t).toContain("AI 修 A 壞 B");
  });

  test("full：動工前想清楚", () => {
    expect(routeById("full")!.timing).toContain("動工前想清楚");
  });
});

// ── 節數必須跟真的章節對得上 ──────────────────────────────────
//
// 寫死數字的失敗是靜默的：有人加了一章，卡片還在說舊數字，沒有任何錯誤。

describe("routeScaleLabel", () => {
  // 三條既有路線的文案逐字不變 —— vibe 分支加進去時最容易順手動到的就是它們
  test("Full 的節數等於通用骨架章節數（文案逐字不變）", () => {
    expect(routeScaleLabel(PRD_ROUTES[0]!)).toBe(`Full ${SEED_SECTIONS.length} 節（全量）`);
  });

  test("Lite 的節數等於 LITE_SECTIONS 長度（文案逐字不變）", () => {
    expect(routeScaleLabel(PRD_ROUTES[1]!)).toBe(`Lite ${LITE_SECTIONS.length} 節（簡化）`);
  });

  test("OpenSpec 那條不報節數 —— 它根本不寫 PRD（文案逐字不變）", () => {
    expect(routeScaleLabel(routeById("openspec")!)).toBe("不寫 PRD · 走 OpenSpec");
  });

  test("vibe 講「意圖 1 頁」，欄位數從 VIBE_SECTIONS 算", () => {
    expect(routeScaleLabel(routeById("vibe")!)).toBe(`意圖 1 頁 · ${VIBE_SECTIONS.length} 欄位`);
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

// ── VIBE_SECTIONS 同一套要求 ──────────────────────────────────

describe("VIBE_SECTIONS", () => {
  test("就是三節：三行摘要、問題、目標", () => {
    expect([...VIBE_SECTIONS]).toEqual(["summary", "problem", "goals"]);
  });

  test("每個 id 都在通用骨架裡", () => {
    const ids = new Set(SEED_SECTIONS.map((s) => s.id));
    for (const id of VIBE_SECTIONS) {
      expect(ids.has(id), `VIBE_SECTIONS 的「${id}」不在 SEED_SECTIONS 裡`).toBe(true);
    }
  });

  test("是 LITE_SECTIONS 的真子集 —— 升 lite 時三節都還在可見範圍", () => {
    const lite = new Set<string>(LITE_SECTIONS);
    for (const id of VIBE_SECTIONS) expect(lite.has(id), id).toBe(true);
    expect(VIBE_SECTIONS.length).toBeLessThan(LITE_SECTIONS.length);
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

  test("存了 lite 才是 lite，存了 vibe 才是 vibe", () => {
    expect(projectRoute({ route: "lite" })).toBe("lite");
    expect(projectRoute({ route: "vibe" })).toBe("vibe");
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

  test("vibe 回的就是 VIBE_SECTIONS —— 只見三節", () => {
    expect([...visibleSectionIds("vibe")!].sort()).toEqual([...VIBE_SECTIONS].sort());
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

  test("vibe 底下只有 VIBE_SECTIONS 看得見", () => {
    const allow = new Set<string>(VIBE_SECTIONS);
    for (const s of SEED_SECTIONS) {
      expect(isSectionVisible("vibe", s.id), s.id).toBe(allow.has(s.id));
    }
  });

  test("自訂章節永遠看得見 —— 它從來沒有被歸給任何一條路線", () => {
    expect(isSectionVisible("lite", "某個自訂章節", true)).toBe(true);
    expect(isSectionVisible("vibe", "某個自訂章節", true)).toBe(true);
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

  test("vibe 的 hidden 清單＝全量減三節", () => {
    const hidden = hiddenSectionIds("vibe");
    expect(hidden.length).toBe(SEED_SECTIONS.length - VIBE_SECTIONS.length);
    expect(hidden.some((id) => (VIBE_SECTIONS as readonly string[]).includes(id))).toBe(false);
  });
});

// ── 升檔對話框的種子文案 ──────────────────────────────────────
//
// 「試作的 3 節原樣保留，新增 N 節待補」—— N 從目標路線章節數算，不寫死。
// 寫死的下場：有人改了 LITE_SECTIONS，對話框還在講舊數字，沒有任何錯誤。
// 措辭描述路線不描述「已寫」（審查 m1）：三節可能有兩節還空著。

describe("routeSectionCount / upgradeSeedText", () => {
  test("三條路線的節數都從資料算", () => {
    expect(routeSectionCount("full")).toBe(SEED_SECTIONS.length);
    expect(routeSectionCount("lite")).toBe(LITE_SECTIONS.length);
    expect(routeSectionCount("vibe")).toBe(VIBE_SECTIONS.length);
  });

  test("vibe 升 lite：試作的 3 節原樣保留、待補節數是計算值", () => {
    expect(upgradeSeedText("vibe", "lite")).toBe(
      `試作的 ${VIBE_SECTIONS.length} 節原樣保留，新增 ${LITE_SECTIONS.length - VIBE_SECTIONS.length} 節待補`,
    );
  });

  test("vibe 升 full：待補節數對到全量骨架", () => {
    expect(upgradeSeedText("vibe", "full")).toBe(
      `試作的 ${VIBE_SECTIONS.length} 節原樣保留，新增 ${SEED_SECTIONS.length - VIBE_SECTIONS.length} 節待補`,
    );
  });

  test("lite 升 full 也算得出來 —— 這支不是 vibe 專用", () => {
    expect(upgradeSeedText("lite", "full")).toBe(
      `Lite 的 ${LITE_SECTIONS.length} 節原樣保留，新增 ${SEED_SECTIONS.length - LITE_SECTIONS.length} 節待補`,
    );
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

  test("vibe 存得住 —— 不重演 lite 當年「重載變回 Full、15 節長回來、沒有錯誤」的坑", () => {
    expect(normalizeRoute("vibe")).toBe("vibe");
    // 模擬 migrateProject 的重載路徑：存進去的 route 經正規化後不回退 full
    expect(projectRoute({ route: normalizeRoute("vibe") })).toBe("vibe");
  });

  test("其他值一律落回 undefined＝Full —— 錯要錯在「看得到全部」那一邊", () => {
    for (const bad of [undefined, "full", "openspec", "", 1, null, {}, "Vibe", "vibe "]) {
      expect(normalizeRoute(bad), String(bad)).toBeUndefined();
    }
  });
});
