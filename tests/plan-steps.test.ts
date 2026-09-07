/**
 * `plan-steps.ts` —— dashboard 治理鏈「計劃」站的資料通道。
 *
 * 這一支餵的是**使用者的專案**（Rust 掃 `<root>/plans/` 回來的絕對路徑），
 * 不是本 repo 自己的 plans/。重點防線是 rootPath 的**前綴誤命中**：`/a/proj`
 * 不得命中 `/a/proj2` —— 純字串前綴會讓兄弟專案互點亮，畫面上看不出來，
 * 只會看到「這個專案明明沒計劃，鏈上計劃站卻亮了」。
 *
 * 放 tests/ 而非 src/ 的理由同 tracking-bridge.test.ts：tsconfig 的 include 是 `src/**`。
 */
import { describe, expect, test } from "bun:test";
import { hasPlanSteps, hasPlanStepsFor, planStepDirsFrom } from "../src/lib/plan-steps";
import type { ScannedPlan } from "../src/lib/tracking-bridge";

/** 掃描回傳的 path 是絕對路徑（Rust 端 `${root}/plans/<檔名>`）。 */
function plan(root: string, name: string, text: string): ScannedPlan {
  return { path: `${root}/plans/${name}`, name, mtimeMs: 1000, text, kind: "plan" };
}

describe("hasPlanSteps —— 勾選框判定", () => {
  test("四種 checkbox 寫法都算有計劃步驟", () => {
    const bodies = [
      "- [ ] 待辦",
      "- [x] 已勾",
      "- [X] 大寫已勾",
      "* [ ] 星號待辦",
    ];
    for (const body of bodies) {
      expect(hasPlanSteps(`# 標題\n\n## Plan Steps\n${body}`), `body: ${body}`).toBe(true);
    }
  });

  test("含前導空白縮排的 checkbox 也算", () => {
    const text = "# 標題\n\n- [ ] 一\n  - [x] 縮排子項\n  * [ ] 縮排星號\n";
    expect(hasPlanSteps(text)).toBe(true);
  });

  test("沒有 checkbox 的 markdown 不算", () => {
    const text = "# 標題\n\n一段說明\n\n1. 編號清單\n2. 沒有方框\n";
    expect(hasPlanSteps(text)).toBe(false);
  });

  test("prose 裡的方括號不算 —— 必須是行首 list item", () => {
    const text = "說明：[ ] 這裡不是勾選框\n";
    expect(hasPlanSteps(text)).toBe(false);
  });
});

describe("planStepDirsFrom —— 掃描清單 → 專案根目錄清單", () => {
  test("帶 checkbox 的檔回報它的 root，不帶的回報空清單", () => {
    const files = [
      plan("/w/alpha", "a.md", "- [ ] 一步"),
      plan("/w/alpha", "b.md", "沒有方框"),
    ];
    expect(planStepDirsFrom(files)).toEqual(["/w/alpha"]);
  });

  test("同一 root 多份帶 checkbox 的檔只算一次", () => {
    const files = [
      plan("/w/alpha", "a.md", "- [x] 一"),
      plan("/w/alpha", "b.md", "- [X] 二"),
    ];
    expect(planStepDirsFrom(files)).toEqual(["/w/alpha"]);
  });

  test("多個專案各自回報，排序與輸入順序無關", () => {
    const files = [
      plan("/w/zzz", "z.md", "- [ ] z"),
      plan("/w/alpha", "a.md", "- [x] a"),
      plan("/w/zzz", "z2.md", "* [ ] z2"),
      plan("/w/alpha", "a2.md", "- [ ] a2"),
    ];
    expect(planStepDirsFrom(files)).toEqual(["/w/alpha", "/w/zzz"]);
  });

  test("openspec 的 tasks.md 不算 —— 另一種方言，不該點亮沒有計劃的專案", () => {
    const files = [
      {
        path: "/w/alpha/openspec/changes/add-x/tasks.md",
        name: "tasks.md",
        mtimeMs: 1000,
        text: "- [ ] 變更步驟",
        kind: "openspec" as const,
        change: "add-x",
      },
    ];
    expect(planStepDirsFrom(files)).toEqual([]);
  });

  test("空清單與非 plans 路徑不會爆", () => {
    expect(planStepDirsFrom([])).toEqual([]);
    const weird = plan("/w/alpha", "a.md", "- [ ] 一步");
    expect(planStepDirsFrom([{ ...weird, path: "/w/alpha/notes/a.md" }])).toEqual([]);
  });
});

describe("hasPlanStepsFor —— rootPath 前綴比對", () => {
  test("命中：rootPath 底下的 plans 檔點亮它", () => {
    const dirs = planStepDirsFrom([plan("/a/proj", "a.md", "- [ ] 一步")]);
    expect(hasPlanStepsFor("/a/proj", dirs)).toBe(true);
  });

  test("防線：/a/proj 不得命中 /a/proj2", () => {
    const dirs = planStepDirsFrom([plan("/a/proj2", "a.md", "- [ ] 一步")]);
    expect(hasPlanStepsFor("/a/proj", dirs)).toBe(false);
  });

  test("rootPath 為 undefined 時回 false", () => {
    const dirs = planStepDirsFrom([plan("/a/proj", "a.md", "- [ ] 一步")]);
    expect(hasPlanStepsFor(undefined, dirs)).toBe(false);
  });

  test("空字串 rootPath 回 false（沒綁資料夾的專案）", () => {
    expect(hasPlanStepsFor("", ["/a/proj"])).toBe(false);
  });
});
