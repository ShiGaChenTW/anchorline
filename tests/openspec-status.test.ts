import { describe, expect, test } from "bun:test";
import {
  nextArtifact,
  openspecHeadline,
  openspecProgressPct,
  parseOpenspecList,
  parseOpenspecStatus,
  type OpenspecChange,
} from "../src/lib/openspec-status";

/**
 * Snapshot fixture —— 實測自 openspec v1.6.0（2026-08-09）。
 * 上游改格式時這裡要紅燈，而不是靜默壞掉。裁掉與判定無關的欄位（路徑、
 * planningHome、actionContext）以免噪音蓋過訊號。
 */
const STATUS_JSON = JSON.stringify({
  changeName: "add-dark-mode",
  schemaName: "spec-driven",
  isComplete: false,
  applyRequires: ["tasks"],
  artifacts: [
    { id: "proposal", outputPath: "proposal.md", status: "done" },
    { id: "design", outputPath: "design.md", status: "ready" },
    { id: "specs", outputPath: "specs/**/*.md", status: "ready" },
    { id: "tasks", outputPath: "tasks.md", status: "blocked", missingDeps: ["design", "specs"] },
  ],
});

const LIST_JSON = JSON.stringify({
  changes: [
    {
      name: "add-dark-mode",
      completedTasks: 0,
      totalTasks: 0,
      lastModified: "2026-08-08T17:45:28.701Z",
      status: "no-tasks",
    },
  ],
  root: { path: "/tmp/x", source: "nearest" },
});

const EMPTY_LIST_JSON = JSON.stringify({ changes: [], root: { path: "/tmp/x", source: "implicit" } });

describe("parseOpenspecStatus（v1.6.0 snapshot）", () => {
  const change = parseOpenspecStatus(STATUS_JSON)!;

  test("四個 artifact 全部解出來，狀態正確", () => {
    expect(change.name).toBe("add-dark-mode");
    expect(change.isComplete).toBe(false);
    expect(change.artifacts.map((a) => [a.id, a.status])).toEqual([
      ["proposal", "done"],
      ["design", "ready"],
      ["specs", "ready"],
      ["tasks", "blocked"],
    ]);
  });

  test("blocked 的 missingDeps 保留", () => {
    expect(change.artifacts[3]!.missingDeps).toEqual(["design", "specs"]);
  });

  test("nextArtifact = 第一個 ready（CLI 已排好序，不自己算相依）", () => {
    expect(nextArtifact(change)?.id).toBe("design");
  });
});

describe("fail-soft", () => {
  test("壞 JSON 不丟例外", () => {
    expect(parseOpenspecStatus("not json")).toBeNull();
    expect(parseOpenspecList("not json")).toEqual([]);
  });

  test("CLI 回錯誤物件（缺 --change）不會被誤認成 change", () => {
    const err = JSON.stringify({ status: [{ severity: "error", code: "change_error" }] });
    expect(parseOpenspecStatus(err)).toBeNull();
  });

  test("沒見過的 status 字串退成 blocked，不當成 done", () => {
    const weird = JSON.stringify({
      changeName: "x",
      artifacts: [{ id: "a", outputPath: "a.md", status: "future-state" }],
    });
    expect(parseOpenspecStatus(weird)!.artifacts[0]!.status).toBe("blocked");
  });

  test("空 changes 清單", () => {
    expect(parseOpenspecList(EMPTY_LIST_JSON)).toEqual([]);
  });
});

describe("parseOpenspecList", () => {
  test("解出 name 與 task 計數", () => {
    const [c] = parseOpenspecList(LIST_JSON);
    expect(c!.name).toBe("add-dark-mode");
    expect(c!.totalTasks).toBe(0);
    expect(c!.status).toBe("no-tasks");
  });
});

describe("openspecProgressPct", () => {
  const mk = (statuses: string[]): OpenspecChange => ({
    name: "c",
    isComplete: false,
    applyRequires: [],
    artifacts: statuses.map((s, i) => ({
      id: `a${i}`,
      outputPath: `a${i}.md`,
      status: s as OpenspecChange["artifacts"][number]["status"],
    })),
  });

  test("done 與 skipped 都算完成 —— skip design 是合法路徑", () => {
    expect(openspecProgressPct([mk(["done", "skipped", "ready", "blocked"])])).toBe(50);
  });

  test("沒有 artifact 回 null，不是 0 —— 0% 會謊稱有進度來源", () => {
    expect(openspecProgressPct([])).toBeNull();
  });
});

describe("openspecHeadline", () => {
  test("CLI 不在：直說原因", () => {
    expect(openspecHeadline({ available: false, reason: "找不到 openspec" })).toBe("找不到 openspec");
  });

  test("有 ready：指出下一步寫哪個檔", () => {
    const c = parseOpenspecStatus(STATUS_JSON)!;
    expect(openspecHeadline({ available: true, changes: [c] })).toBe(
      "下一步：寫 design.md（add-dark-mode）"
    );
  });

  test("沒有 change：明講，不顯示 0%", () => {
    expect(openspecHeadline({ available: true, changes: [] })).toBe("沒有進行中的 change");
  });
});
