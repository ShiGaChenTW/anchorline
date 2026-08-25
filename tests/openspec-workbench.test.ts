import { describe, expect, test } from "bun:test";
import {
  archiveCommand,
  changeStall,
  daysSince,
  resolveWorkbenchTab,
  rewriteChangePaths,
  validateChangeRename,
} from "../src/lib/openspec-workbench";
import type { OpenspecChange } from "../src/lib/openspec-status";

const health = (over: Partial<OpenspecChange> = {}): OpenspecChange => ({
  name: "add-habit-tracker",
  isComplete: false,
  applyRequires: ["tasks"],
  artifacts: [
    { id: "proposal", outputPath: "proposal.md", status: "done" },
    { id: "design", outputPath: "design.md", status: "done" },
    { id: "specs", outputPath: "specs/**/*.md", status: "done" },
    { id: "tasks", outputPath: "tasks.md", status: "ready" },
  ],
  ...over,
});

describe("resolveWorkbenchTab", () => {
  test("有未完成 change 時預設 Changes，不要先停在 Wishlist", () => {
    expect(resolveWorkbenchTab({ openChangeCount: 16 })).toBe("changes");
    expect(resolveWorkbenchTab({ openChangeCount: 0 })).toBe("wishlist");
  });

  test("URL tab 與 change 蓋過記憶與預設", () => {
    expect(
      resolveWorkbenchTab({ urlTab: "specs", stored: "wishlist", openChangeCount: 3 }),
    ).toBe("specs");
    expect(
      resolveWorkbenchTab({ urlChange: "add-x", stored: "wishlist", openChangeCount: 0 }),
    ).toBe("changes");
  });

  test("有未完成時記住 Wishlist 也不准蓋過 Changes", () => {
    expect(
      resolveWorkbenchTab({ stored: "wishlist", openChangeCount: 16 }),
    ).toBe("changes");
    expect(
      resolveWorkbenchTab({ stored: "specs", openChangeCount: 2 }),
    ).toBe("specs");
  });

  test("認不得的 stored 不當成分頁", () => {
    expect(resolveWorkbenchTab({ stored: "nope", openChangeCount: 0 })).toBe("wishlist");
  });
});

describe("changeStall", () => {
  test("0/N 不是缺檔，是還沒開工", () => {
    const s = changeStall({
      archived: false,
      progress: { closed: 0, total: 8 },
      health: health(),
      nextStep: "1.1 訂資料模型",
    });
    expect(s.progressLabel).toBe("0/8");
    expect(s.actionKind).toBe("open-tasks");
    expect(s.why).toContain("一題都還沒勾");
    expect(s.actionLabel).toContain("1.1");
  });

  test("做到一半帶 next_step 與過舊天數", () => {
    const s = changeStall({
      archived: false,
      progress: { closed: 4, total: 11 },
      nextStep: "2.3 串 query router",
      listed: {
        name: "add-agent-query-broker",
        completedTasks: 4,
        totalTasks: 11,
        lastModified: "2026-08-14T00:00:00.000Z",
        status: "in-progress",
      },
      now: Date.parse("2026-08-25T00:00:00.000Z"),
    });
    expect(s.progressLabel).toBe("4/11");
    expect(s.why).toContain("2.3");
    expect(s.why).toContain("11 天沒動");
    expect(s.actionKind).toBe("open-tasks");
  });

  test("全勾完還沒 archive", () => {
    const s = changeStall({
      archived: false,
      progress: { closed: 9, total: 9 },
    });
    expect(s.actionKind).toBe("archive");
    expect(s.why).toContain("還沒 archive");
  });

  test("缺 design 時主按鈕是寫那一份，不是開 tasks", () => {
    const s = changeStall({
      archived: false,
      progress: { closed: 0, total: 0 },
      health: health({
        artifacts: [
          { id: "proposal", outputPath: "proposal.md", status: "done" },
          { id: "design", outputPath: "design.md", status: "ready" },
          { id: "tasks", outputPath: "tasks.md", status: "blocked", missingDeps: ["design"] },
        ],
      }),
    });
    expect(s.actionKind).toBe("open-artifact");
    expect(s.actionLabel).toBe("寫 design");
    expect(s.why).toContain("design.md");
  });

  test("已封存不是待辦", () => {
    const s = changeStall({ archived: true, progress: { closed: 4, total: 4 } });
    expect(s.actionKind).toBe("none");
    expect(s.why).toContain("已封存");
  });
});

describe("validateChangeRename", () => {
  test("合法 kebab 且不撞名", () => {
    expect(validateChangeRename("add-old", "add-habit-tracker", ["add-old"])).toEqual({
      ok: true,
      slug: "add-habit-tracker",
    });
  });

  test("中文推不出 slug", () => {
    const r = validateChangeRename("add-old", "習慣追蹤", ["add-old"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("英數");
  });

  test("撞名、沒改、封存、archive 保留字", () => {
    expect(validateChangeRename("a", "add-x", ["a", "add-x"]).ok).toBe(false);
    expect(validateChangeRename("add-x", "add-x", ["add-x"]).ok).toBe(false);
    expect(validateChangeRename("archive/old", "new-name", []).ok).toBe(false);
    expect(validateChangeRename("old", "archive", ["old"]).ok).toBe(false);
  });
});

describe("rewriteChangePaths", () => {
  test("只換路徑段，不誤傷較長的 slug", () => {
    const paths = [
      "/proj/openspec/changes/add-auth/proposal.md",
      "/proj/openspec/changes/add-auth-flow/tasks.md",
      "openspec/changes/add-auth/specs/auth/spec.md",
    ];
    expect(rewriteChangePaths(paths, "add-auth", "add-login")).toEqual([
      "/proj/openspec/changes/add-login/proposal.md",
      "/proj/openspec/changes/add-auth-flow/tasks.md",
      "openspec/changes/add-login/specs/auth/spec.md",
    ]);
  });
});

describe("daysSince / archiveCommand", () => {
  test("天數往下取整", () => {
    expect(daysSince("2026-08-14T00:00:00.000Z", Date.parse("2026-08-25T12:00:00.000Z"))).toBe(11);
  });
  test("archive 指令帶專案根", () => {
    expect(archiveCommand("/tmp/proj", "add-x")).toBe("cd '/tmp/proj' && openspec archive add-x");
  });
});
