/**
 * C1 —— 交接指令的 runner 對整個 `AgentFamily` 都給得出東西。
 *
 * 修之前 `RUNNER` 只有四個鍵（`claude / codex / gemini / other`），型別是
 * 一個自己另外定義的四成員 `AgentFamilyId`；而 `src/pages/tracking.ts` 用
 * `as AgentFamilyId` 把十個成員的 `AgentFamily` 硬轉進來。族系是
 * `grok`／`pi`／`hermes`／`agy`／`gpt`／`local` 其中之一時，
 * `RUNNER[input.family]` 是 undefined，下一行 `RUNNER[...](prompt)`
 * **當場 TypeError**，使用者看到的是「按了沒反應」。
 *
 * 那個收窄的型別沒有擋住任何東西 —— 它只是把錯誤從編譯期挪到執行期。
 *
 * 這一組釘的是「總函式」這個性質，不是某六個字串：
 * 「聯集裡每個成員都有 runner」那條會在有人往 `AgentFamily` 加成員、
 * 卻忘了補 runner 的時候變紅，而那正是這個 bug 當初的產生方式。
 */
import { describe, expect, test } from "bun:test";
import { buildHandoff, runnerFor, type HandoffInput } from "../src/lib/agent-handoff";
import { AGENT_FAMILIES } from "../src/data/types";

const b: HandoffInput = {
  projectRoot: "/repo",
  task: "做一件事",
  family: "claude",
};

describe("C1 —— 每個族系都給得出指令", () => {
  // 修之前這六個各自是一次 TypeError
  const wasExploding = ["grok", "pi", "hermes", "agy", "gpt", "local"] as const;

  for (const family of wasExploding) {
    test(`${family}：不再 TypeError，給得出非空字串`, () => {
      const h = buildHandoff({ ...b, family });
      expect(typeof h.command).toBe("string");
      expect(h.command.length).toBeGreaterThan(0);
      expect(h.blocked).toBeNull();
    });
  }

  test("聯集裡每一個成員都有 runner —— 加了新族系忘了補 runner 時這條會紅", () => {
    expect(AGENT_FAMILIES.length).toBeGreaterThan(0);
    for (const f of AGENT_FAMILIES) {
      expect(() => buildHandoff({ ...b, family: f })).not.toThrow();
      expect(buildHandoff({ ...b, family: f }).command.length).toBeGreaterThan(0);
    }
  });

  test("有 CLI 的族系用實測過的旗標，而且前綴 cd", () => {
    const cases = [
      ["claude", "claude -p "],
      ["codex", "codex exec "],
      ["gemini", "gemini -p "],
      ["grok", "grok "],
      ["pi", "pi -p "],
      ["agy", "agy -p "],
    ] as const;
    for (const [family, frag] of cases) {
      const cmd = buildHandoff({ ...b, family }).command;
      expect(cmd).toContain("cd '/repo' && ");
      expect(cmd).toContain(frag);
    }
  });

  // 判準是「這串是不是可執行的指令」，不是「族系是不是 other」。
  // 後者只是前者的一個特例，而每多一個沒有 CLI 的族系，後者就會多錯一次。
  test("沒有 CLI 的族系不前綴 cd —— 接了 cd 會讓人以為那串可以直接執行", () => {
    for (const family of ["hermes", "gpt", "local", "other"] as const) {
      const cmd = buildHandoff({ ...b, family }).command;
      expect(cmd).not.toContain("cd ");
      expect(cmd).toContain("貼給你的 agent");
    }
  });
});

/**
 * 型別擋不到磁碟上已經存在的髒資料 —— `project.authorAgentFamily` 讀自
 * localStorage 與匯入的備份，兩者都可以被手改成聯集外的值。
 */
describe("C1 —— 聯集外的字串一律回退，不炸", () => {
  test("大小寫差一個字、含空白、空字串都走貼上模式", () => {
    for (const dirty of ["Pi", "CLAUDE", "", "   ", "claude ", "opencode"]) {
      const r = runnerFor(dirty);
      expect(r.cwd).toBe(false);
      expect(r.run("x")).toContain("貼給你的 agent");
    }
  });

  test("null / undefined 也走貼上模式", () => {
    expect(runnerFor(null).cwd).toBe(false);
    expect(runnerFor(undefined).cwd).toBe(false);
  });

  /**
   * `Object.prototype` 上的名字是 `RUNNER[k] ?? PASTE` 這種寫法的盲點：
   * 它拿到的是**繼承來的函式**而不是 undefined，`??` 因此不會觸發，
   * 接著 `runner.run` 不存在 —— 等於把要修掉的那個 TypeError 換個入口再開一次。
   * 這條測試就是為了釘住這件事（第一版實作真的踩到了）。
   */
  test("__proto__ / toString / constructor 不會撿到繼承來的東西", () => {
    for (const k of ["__proto__", "toString", "constructor", "hasOwnProperty", "valueOf"]) {
      const r = runnerFor(k);
      expect(typeof r.run).toBe("function");
      expect(r.cwd).toBe(false);
      expect(r.run("x")).toContain("貼給你的 agent");
    }
  });

  test("buildHandoff 吃到髒族系時整支仍然可用", () => {
    const h = buildHandoff({ ...b, family: "Pi" as never });
    expect(h.command).toContain("貼給你的 agent");
    expect(h.command).not.toContain("cd ");
  });
});
