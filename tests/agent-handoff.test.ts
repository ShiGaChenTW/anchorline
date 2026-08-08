import { describe, expect, test } from "bun:test";
import { buildHandoff, buildPrompt, shellQuote, type HandoffInput } from "../src/lib/agent-handoff";

const base: HandoffInput = {
  projectRoot: "/Users/x/my project",
  task: "依 openspec 寫下一個 artifact",
  family: "claude",
};

describe("指令組裝", () => {
  test("帶上專案目錄，並且 quote 過（路徑有空白）", () => {
    const h = buildHandoff(base);
    expect(h.command).toContain("cd '/Users/x/my project'");
    expect(h.command).toContain("claude -p ");
  });

  test("三個 family 各自的 runner", () => {
    expect(buildHandoff({ ...base, family: "codex" }).command).toContain("codex exec ");
    expect(buildHandoff({ ...base, family: "gemini" }).command).toContain("gemini -p ");
  });

  test("other：不組 shell 指令，只給 prompt 讓人自己貼", () => {
    const h = buildHandoff({ ...base, family: "other" });
    expect(h.command).not.toContain("cd ");
    expect(h.command).toContain("貼給你的 agent");
  });

  test("openspec 脈絡進 prompt —— 「寫 design.md」比「繼續」有用", () => {
    const p = buildPrompt({ ...base, change: "add-dark-mode", nextArtifact: "design.md" });
    expect(p).toContain("add-dark-mode");
    expect(p).toContain("design.md");
  });
});

describe("shell 跳脫 —— prompt 裡有中文引號和 markdown", () => {
  test("單引號被正確跳脫", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });

  test("含引號的 task 不會把指令切斷", () => {
    const h = buildHandoff({ ...base, task: `寫 'design.md' 並標註 'why'` });
    // 跳脫後整段仍然是一個被單引號包起來的參數序列
    const after = h.command.slice(h.command.indexOf("claude -p ") + 10);
    expect(after.startsWith("'")).toBe(true);
    expect(after.endsWith("'")).toBe(true);
  });
});

describe("職務分離也在這裡生效", () => {
  test("同族 agent 要核准同族寫的文件 → 擋下", () => {
    const h = buildHandoff({ ...base, family: "claude", authorFamily: "claude", isApproval: true });
    expect(h.blocked).toContain("職務分離");
  });

  test("不同族系核准 → 放行", () => {
    const h = buildHandoff({ ...base, family: "codex", authorFamily: "claude", isApproval: true });
    expect(h.blocked).toBeNull();
  });

  test("同族但不是核准（叫它寫東西）→ 放行", () => {
    const h = buildHandoff({ ...base, family: "claude", authorFamily: "claude" });
    expect(h.blocked).toBeNull();
  });

  test("人寫的文件 → 不檢查", () => {
    const h = buildHandoff({ ...base, family: "claude", authorFamily: null, isApproval: true });
    expect(h.blocked).toBeNull();
  });
});

describe("永遠不執行", () => {
  test("產出的是字串，模組不匯出任何執行入口", async () => {
    const mod = await import("../src/lib/agent-handoff");
    const names = Object.keys(mod);
    expect(names).not.toContain("run");
    expect(names).not.toContain("exec");
    expect(names).not.toContain("dispatch");
    expect(typeof buildHandoff(base).command).toBe("string");
  });
});
