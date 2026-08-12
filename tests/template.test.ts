import { describe, expect, test } from "bun:test";
import { fillTemplate } from "../src/lib/template";
import { DRAFT_SHARED_TEMPLATE, buildDraftSystem, draftKindRules } from "../src/lib/change-templates";
import { COMMIT_SYSTEM_TEMPLATE, buildCommitSystem } from "../src/lib/commit-message";

describe("fillTemplate", () => {
  test("認得的變數替換、認不得的原樣保留", () => {
    // 使用者自訂 prompt 打錯變數名時，錯字要出現在送出的文字裡才看得到
    expect(fillTemplate("A {{x}} B {{typo}}", { x: "1" })).toBe("A 1 B {{typo}}");
  });

  test("同一個變數出現多次全都換", () => {
    expect(fillTemplate("{{a}}-{{a}}", { a: "x" })).toBe("x-x");
  });
});

describe("模板抽出後行為不變", () => {
  // registry 拿模板常數當「可覆寫的預設值」；builder 用同一份常數組出
  // 跟抽出前一字不差的結果 —— 這兩條測的是重構沒有改行為
  test("buildDraftSystem 不再含未填的佔位符，且 kind 規則有分流", () => {
    const feature = buildDraftSystem("feature");
    const bug = buildDraftSystem("bug");
    expect(feature).not.toContain("{{");
    expect(feature).toContain("Non-goals");
    expect(bug).toContain("plans/");
    expect(bug).not.toContain("Non-goals");
    expect(DRAFT_SHARED_TEMPLATE).toContain("{{kindRules}}");
    expect(draftKindRules("feature")).toContain("tasks.md");
  });

  test("buildCommitSystem 語言與前綴風格照舊分流", () => {
    const base = { changeset: { status: "", stat: "", patch: "", truncated: false }, files: [], recentSubjects: [] };
    const zh = buildCommitSystem({ ...base, conventional: true, language: "zh-TW" } as never);
    const en = buildCommitSystem({ ...base, conventional: false, language: "en-US" } as never);
    expect(zh).toContain("繁體中文");
    expect(zh).toContain("conventional commits，主旨要以");
    expect(en).toContain("English");
    expect(en).toContain("不使用 conventional commits");
    expect(zh).not.toContain("{{");
    expect(COMMIT_SYSTEM_TEMPLATE).toContain("{{subjectLimit}}");
  });
});
