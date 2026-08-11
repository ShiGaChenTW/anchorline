import { describe, expect, test } from "bun:test";
import { buildChangeFiles, deriveChangeSlug, normalizeChangeSlug } from "../src/lib/change-templates";
import { parsePlanMeta } from "../src/lib/plan-parser";

/**
 * 決定性亂數 —— 錨點要可重現才測得動。
 *
 * **不能回固定值。** `mintMissingIds` 撞號時會 `while (used.has(id))` 重抽，
 * 常數 rand 讓每次都抽到同一個 id，那個迴圈就永遠出不來（測試整個掛住，
 * 不是失敗，是不會結束）。要決定性就用會前進的序列。
 */
function seededRand(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe("change templates", () => {
  test("把標題轉成安全且穩定的 change slug", () => {
    expect(normalizeChangeSlug("  Export / Audit Log  ")).toBe("export-audit-log");
    expect(normalizeChangeSlug("!!!")).toBe("change");
  });

  test("推不出英數 slug 時回 null，不給會相撞的保底值", () => {
    // 這個專案的標題幾乎都是中文。保底值讓每一份文件都叫 `change`，
    // 第二份會蓋掉第一份，而且沒有任何錯誤訊息。
    expect(deriveChangeSlug("勾選寫回失敗")).toBeNull();
    expect(deriveChangeSlug("!!!")).toBeNull();
    expect(deriveChangeSlug("修正 audit export 的路徑")).toBe("audit-export");
  });

  test("新功能產生完整 OpenSpec change 結構", () => {
    const files = buildChangeFiles("feature", {
      title: "匯出稽核軌跡",
      slug: "audit-export",
      date: "2026-08-11",
    });
    expect(files.map((f) => f.path)).toEqual([
      "openspec/changes/audit-export/proposal.md",
      "openspec/changes/audit-export/specs/audit-export/spec.md",
      "openspec/changes/audit-export/design.md",
      "openspec/changes/audit-export/tasks.md",
    ]);
    expect(files[0]?.content).toContain("## Non-goals");
    expect(files[1]?.content).toContain("## ADDED Requirements");
    expect(files[3]?.content).toContain("- [ ] 2.1");
  });

  test("Bug plan 保留日期、種類與重現區段", () => {
    const [file] = buildChangeFiles("bug", {
      title: "登入後列表消失",
      slug: "login-list",
      date: "2026-08-11",
    });
    expect(file?.path).toBe("plans/2026-08-11-bug-login-list.md");
    expect(file?.content).toContain("## 重現步驟");
    expect(file?.content).toContain("防迴歸測試");
  });

  // 這一組是這個檔案存在的理由：產生器的正確性判準是「Anchorline 自己讀得懂」，
  // 不是「字串裡有沒有那幾個字」。原本的測試只做後者，所以整份 plan 被讀成
  // 0 個步驟、狀態「未知」的時候，一條測試都沒有紅。
  test.each(["bug", "maintenance"] as const)("產生的 %s plan 走得過自家 plan-parser", (kind) => {
    const [file] = buildChangeFiles(kind, { title: "測試用", slug: "probe", date: "2026-08-11" }, seededRand());
    const meta = parsePlanMeta(file!.content, file!.path);

    expect(meta.dialect).toBe("plan");
    expect(meta.status).toBe("進行中"); // 必須落在 STATUS_WORDS 裡，不能是「未知」
    expect(meta.total_steps).toBeGreaterThan(0);
    expect(meta.pending_steps).toBe(meta.total_steps);
    expect(meta.next_step).not.toBe("—");
  });

  test("產生的 plan 步驟一出生就有錨點 —— 沒有錨點的 commit 會被算成未治理", () => {
    const [file] = buildChangeFiles("bug", { title: "測試用", slug: "probe", date: "2026-08-11" }, seededRand());
    const meta = parsePlanMeta(file!.content, file!.path);
    expect(meta.unanchored).toBe(0);
    expect(meta.steps.every((s) => Boolean(s.id))).toBe(true);
  });

  test("feature 的 tasks.md 走得過 openspec 方言", () => {
    const files = buildChangeFiles("feature", { title: "匯出稽核軌跡", slug: "audit-export", date: "2026-08-11" });
    const tasks = files.find((f) => f.path.endsWith("tasks.md"))!;
    const meta = parsePlanMeta(tasks.content, tasks.path, { dialect: "openspec", change: "audit-export" });
    expect(meta.total_steps).toBeGreaterThan(0);
    expect(meta.steps[0]?.id).toBe("1.1");
  });

  test("不讓標題換行或不合法日期污染輸出檔案", () => {
    const [file] = buildChangeFiles("maintenance", {
      title: "重構\n標題",
      slug: "safe",
      date: "../secrets",
    });
    expect(file?.path).toBe("plans/undated-maintenance-safe.md");
    expect(file?.content).toContain("# 維護／重構：重構 標題");
  });
});
