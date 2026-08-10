import { describe, expect, test } from "bun:test";
import {
  buildHandoff,
  buildPayload,
  buildPrompt,
  shellQuote,
  validAnchor,
  type HandoffInput,
} from "../src/lib/agent-handoff";

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
    expect(buildHandoff({ ...base, family: "codex" }).command).toContain(
      "codex exec ",
    );
    expect(buildHandoff({ ...base, family: "gemini" }).command).toContain(
      "gemini -p ",
    );
  });

  test("other：不組 shell 指令，只給 prompt 讓人自己貼", () => {
    const h = buildHandoff({ ...base, family: "other" });
    expect(h.command).not.toContain("cd ");
    expect(h.command).toContain("貼給你的 agent");
  });

  test("openspec 脈絡進 prompt —— 「寫 design.md」比「繼續」有用", () => {
    const p = buildPrompt({
      ...base,
      change: "add-dark-mode",
      nextArtifact: "design.md",
    });
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
    const h = buildHandoff({
      ...base,
      family: "claude",
      authorFamily: "claude",
      isApproval: true,
    });
    expect(h.blocked).toContain("職務分離");
  });

  test("不同族系核准 → 放行", () => {
    const h = buildHandoff({
      ...base,
      family: "codex",
      authorFamily: "claude",
      isApproval: true,
    });
    expect(h.blocked).toBeNull();
  });

  test("同族但不是核准（叫它寫東西）→ 放行", () => {
    const h = buildHandoff({
      ...base,
      family: "claude",
      authorFamily: "claude",
    });
    expect(h.blocked).toBeNull();
  });

  test("人寫的文件 → 不檢查", () => {
    const h = buildHandoff({
      ...base,
      family: "claude",
      authorFamily: null,
      isApproval: true,
    });
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

describe("錨點交接（L2）", () => {
  const base = {
    projectRoot: "/repo",
    task: "在 README 加安裝說明",
    family: "claude" as const,
  };

  test("帶合法錨點時，prompt 要求 agent 把它寫進 commit 訊息", () => {
    const p = buildPrompt({ ...base, anchor: "HNTPRY5R" });
    expect(p).toContain("anc:t=HNTPRY5R");
    // 自成一段。埋在句子中間 agent 容易連帶改寫，而改一個字元就等於沒有錨點。
    expect(p).toContain("\n\n");
  });

  test("沒有錨點時 prompt 一個字都不變", () => {
    expect(buildPrompt(base)).toBe(buildPrompt({ ...base, anchor: null }));
    expect(buildPrompt(base)).not.toContain("anc:t=");
  });

  // 這條是整組測試的核心：帶一個永遠對不上的錨點，比不帶更糟 ——
  // 它看起來像串起來了，實際上事件會掛在一個不存在的任務上。
  test("不合法的錨點一律當成沒有，不會混進 prompt", () => {
    for (const bad of ["L0PROBE1", "abc", "abc123", "HAS-DASH", "TOOSHORT!"]) {
      expect(validAnchor(bad)).toBeNull();
      expect(buildPrompt({ ...base, anchor: bad })).not.toContain("anc:t=");
    }
  });

  test("帶前綴傳進來也接受，輸出一律裸 id", () => {
    expect(validAnchor("anc:t=HNTPRY5R")).toBe("HNTPRY5R");
    expect(validAnchor("sf:t=ABC12345")).toBe("ABC12345");
  });

  test("payload 的 taskName 是短標題，不是整段 prompt", () => {
    const long = "第一行標題\n第二行細節".repeat(10);
    const payload = buildPayload({ ...base, task: long, anchor: "HNTPRY5R" });
    expect(payload.taskName.length).toBeLessThanOrEqual(60);
    expect(payload.taskName).not.toContain("\n");
    expect(payload.prompt).toContain("anc:t=HNTPRY5R");
    expect(payload.anchor).toBe("HNTPRY5R");
  });

  test("payload 帶著撰寫者族系 —— 執行端要靠它記 actor 與擋同族核准", () => {
    expect(buildPayload({ ...base, authorFamily: "codex" }).authorFamily).toBe(
      "codex",
    );
    expect(buildPayload(base).authorFamily).toBeNull();
  });

  test("職務分離仍然生效，加了錨點不會繞過它", () => {
    const h = buildHandoff({
      ...base,
      anchor: "HNTPRY5R",
      isApproval: true,
      authorFamily: "claude",
    });
    expect(h.blocked).not.toBeNull();
  });
});

describe("漂移自述（L2 補強）", () => {
  const base = {
    projectRoot: "/repo",
    task: "在 README 加安裝說明",
    family: "claude" as const,
  };

  // 最便宜的偵測器是做事的人自己。實測兩輪派工，兩個 agent 都在沒被要求的
  // 情況下主動舉報了「我做的跟步驟描述不一樣」—— 那就把它寫進 prompt，
  // 讓它講在會被記錄下來的地方。
  test("帶錨點時要求 agent 說明實際做的事與描述的差異", () => {
    const p = buildPrompt({ ...base, anchor: "HNTPRY5R" });
    expect(p).toContain("不同");
    expect(p).toContain("commit 訊息");
  });

  // 沒有錨點就沒有步驟可以對照，那句話會變成沒有指涉對象的雜訊。
  test("沒有錨點時不加那句話", () => {
    expect(buildPrompt(base)).not.toContain("實際做的事跟上面的描述不同");
  });

  test("錨點那一行仍然獨立成段且原樣", () => {
    const p = buildPrompt({ ...base, anchor: "HNTPRY5R" });
    expect(p).toContain("anc:t=HNTPRY5R");
    expect(p.split("\n\n").length).toBeGreaterThanOrEqual(3);
  });
});
