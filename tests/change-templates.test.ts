import { describe, expect, test } from "bun:test";
import { buildChangeFiles, normalizeChangeSlug } from "../src/lib/change-templates";

describe("change templates", () => {
  test("把標題轉成安全且穩定的 change slug", () => {
    expect(normalizeChangeSlug("  Export / Audit Log  ")).toBe("export-audit-log");
    expect(normalizeChangeSlug("!!!")).toBe("change");
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

  test("Bug plan 保留日期、種類與驗收區段", () => {
    const [file] = buildChangeFiles("bug", {
      title: "登入後列表消失",
      slug: "login-list",
      date: "2026-08-11",
    });
    expect(file?.path).toBe("plans/2026-08-11-bug-login-list.md");
    expect(file?.content).toContain("## 驗收條件");
    expect(file?.content).toContain("回歸測試");
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
