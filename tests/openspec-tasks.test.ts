import { describe, expect, test } from "bun:test";
import { parsePlanMeta, planProgress } from "../src/lib/plan-parser";
import { osStepNoOf, toggleStep } from "../src/lib/plan-writer";
import { openspecRootsOf } from "../src/lib/tracking-bridge";

/**
 * 真實形狀，抄自
 * `Project_Border-loom_rust/openspec/changes/establish-tauri-rust-mainline/tasks.md`。
 * 沒有 H1、沒有 `## Plan Steps`、沒有 `**狀態：**`、沒有錨點 —— 這四件事
 * 每一件單獨都會讓舊 parser 回 0 步驟。
 */
const TASKS = `## 1. Line separation and formal documentation

- [x] 1.1 Verify \`parallel-code\` is independently reachable from the reference remote
- [x] 1.2 Restore \`docs/electron-migration-evaluation.md\` as the formal record

## 2. Tauri/Rust baseline

- [x] 2.1 Add an explicit Tauri development/build command
- [ ] 3.5 Remove Electron from the active build only after the matrix is green
`;

describe("openspec tasks.md 方言", () => {
  test("沒有 ## Plan Steps 也讀得到步驟（這就是原本壞掉的那一點）", () => {
    const old = parsePlanMeta(TASKS, "tasks.md");
    expect(old.total_steps).toBe(0); // 舊方言：整份看不到

    const meta = parsePlanMeta(TASKS, "tasks.md", {
      dialect: "openspec",
      change: "establish-tauri-rust-mainline",
    });
    expect(meta.total_steps).toBe(4);
    expect(meta.done_steps).toBe(3);
    expect(meta.pending_steps).toBe(1);
  });

  test("標題退回變更代號 —— tasks.md 沒有 H1", () => {
    const meta = parsePlanMeta(TASKS, "tasks.md", {
      dialect: "openspec",
      change: "establish-tauri-rust-mainline",
    });
    expect(meta.title).toBe("establish-tauri-rust-mainline");
    expect(meta.dialect).toBe("openspec");
  });

  test("N.M 編號就是步驟身分，文字不含編號", () => {
    const meta = parsePlanMeta(TASKS, "tasks.md", { dialect: "openspec", change: "c" });
    expect(meta.steps.map((s) => s.id)).toEqual(["1.1", "1.2", "2.1", "3.5"]);
    expect(meta.steps[0]!.text).toBe(
      "Verify `parallel-code` is independently reachable from the reference remote",
    );
    // 有編號就有身分，unanchored 必須是 0 —— 否則 UI 會叫人去補鑄錨點，
    // 而那會把我們的格式寫進上游工具管的檔案
    expect(meta.unanchored).toBe(0);
  });

  test("群組來自 ## N. 標題", () => {
    const meta = parsePlanMeta(TASKS, "tasks.md", { dialect: "openspec", change: "c" });
    expect(meta.steps[0]!.group).toBe("1. Line separation and formal documentation");
    expect(meta.steps[3]!.group).toBe("2. Tauri/Rust baseline");
  });

  test("狀態是算出來的：全勾完才叫已完成", () => {
    const meta = parsePlanMeta(TASKS, "tasks.md", { dialect: "openspec", change: "c" });
    expect(meta.status).toBe("進行中");
    const allDone = parsePlanMeta(TASKS.replace("- [ ] 3.5", "- [x] 3.5"), "tasks.md", {
      dialect: "openspec",
      change: "c",
    });
    expect(allDone.status).toBe("已完成");
    expect(planProgress(allDone).pct).toBe(100);
  });

  test("縮排的子項目也算得到", () => {
    const nested = `## 1. G\n\n- [x] 1.1 top\n  - [ ] 1.1.1 nested\n`;
    const meta = parsePlanMeta(nested, "tasks.md", { dialect: "openspec", change: "c" });
    expect(meta.total_steps).toBe(2);
    expect(meta.steps[1]!.id).toBe("1.1.1");
  });

  test("沒有編號的 checkbox 收得到，但沒有身分（UI 不給勾選鈕）", () => {
    const meta = parsePlanMeta("## 1. G\n\n- [ ] no number here\n", "tasks.md", {
      dialect: "openspec",
      change: "c",
    });
    expect(meta.total_steps).toBe(1);
    expect(meta.steps[0]!.id).toBeUndefined();
    expect(meta.unanchored).toBe(1);
  });

  test("空檔不會炸，回一個誠實的空 meta", () => {
    const meta = parsePlanMeta("", "tasks.md", { dialect: "openspec", change: "c" });
    expect(meta.total_steps).toBe(0);
    expect(meta.title).toBe("c");
  });
});

describe("openspec 勾選寫回", () => {
  test("依 N.M 定位，只翻那一個方框字元", () => {
    const out = toggleStep(TASKS, "3.5", true, "openspec");
    expect(out).toContain("- [x] 3.5 Remove Electron");
    // 其餘一字不改
    expect(out.replace("- [x] 3.5", "- [ ] 3.5")).toBe(TASKS);
  });

  test("取消勾選", () => {
    const out = toggleStep(TASKS, "1.1", false, "openspec");
    expect(out).toContain("- [ ] 1.1 Verify");
    expect(out).toContain("- [x] 1.2 Restore");
  });

  test("plan 方言不會誤中 N.M —— 兩種身分不能互相污染", () => {
    // 沒有錨點的話 plan 方言找不到任何一行，原文原封不動回來
    expect(toggleStep(TASKS, "3.5", true)).toBe(TASKS);
  });

  test("找不到 id 就原樣回傳，不會亂改別行", () => {
    expect(toggleStep(TASKS, "9.9", true, "openspec")).toBe(TASKS);
  });

  test("osStepNoOf 只認 N.M 開頭", () => {
    expect(osStepNoOf("1.1 Verify things")).toBe("1.1");
    expect(osStepNoOf("2.10.3 deep")).toBe("2.10.3");
    expect(osStepNoOf("1 not nested enough")).toBeNull();
    expect(osStepNoOf("no number")).toBeNull();
  });
});

describe("openspecRootsOf", () => {
  const projects = [
    { id: "a", importSummary: { rootPath: "/x/a/" } },
    { id: "b", importSummary: { rootPath: "/x/b" } },
  ];

  test("只給當前選取的專案，尾斜線去掉", () => {
    expect(openspecRootsOf(projects, "a")).toEqual(["/x/a"]);
  });

  test("沒有選取就回空 —— 不退回全部專案", () => {
    expect(openspecRootsOf(projects, null)).toEqual([]);
    expect(openspecRootsOf(projects, "nope")).toEqual([]);
  });

  test("沒綁資料夾的專案不產生路徑", () => {
    expect(openspecRootsOf([{ id: "a" }], "a")).toEqual([]);
  });
});

describe("實測補的邊界：帶字母後綴的編號", () => {
  // Project_Border-loom_rust/openspec/changes/prompt-library 裡就有 `6.3a`，
  // 插在 6.3 與 6.4 之間。舊 regex 讀不到 → 那一步沒有身分、不能勾。
  const withSuffix = "## 6. G\n\n- [x] 6.3 base\n- [ ] 6.3a inserted later\n- [x] 6.4 after\n";

  test("6.3a 認得出來，而且文字不留編號", () => {
    const meta = parsePlanMeta(withSuffix, "tasks.md", { dialect: "openspec", change: "c" });
    expect(meta.steps.map((s) => s.id)).toEqual(["6.3", "6.3a", "6.4"]);
    expect(meta.steps[1]!.text).toBe("inserted later");
    expect(meta.unanchored).toBe(0);
  });

  test("勾得到 6.3a，而且不會誤中 6.3", () => {
    const out = toggleStep(withSuffix, "6.3a", true, "openspec");
    expect(out).toContain("- [x] 6.3a inserted later");
    expect(out).toContain("- [x] 6.3 base");
    const off = toggleStep(withSuffix, "6.3", false, "openspec");
    expect(off).toContain("- [ ] 6.3 base");
    expect(off).toContain("- [ ] 6.3a inserted later");
  });
});
