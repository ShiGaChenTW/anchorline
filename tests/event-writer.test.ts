import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dedupe, parseLog, serializeEvent } from "../src/lib/event-log";
import {
  buildEvent,
  commitsToEvents,
  commitUrl,
  hookInstallSnippet,
  hookIsLive,
  newEventId,
} from "../src/lib/event-writer";

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

const COMMITS = [
  { hash: "abc1234", subject: "feat: 加焦點卡", at: "2026-08-09T10:00:00Z", author: "Scott", refs: "HEAD -> main" },
  { hash: "def5678", subject: "fix: 修 rollup", at: "2026-08-08T10:00:00Z", author: "Scott", refs: "" },
];

describe("event id", () => {
  test("Crockford base32，長度 14", () => {
    expect(newEventId(seeded(1))).toMatch(/^[0-9A-HJKMNP-TV-Z]{14}$/);
  });

  test("不從內容推導 —— 同一筆事件兩次拿到不同 id", () => {
    expect(newEventId(seeded(1))).not.toBe(newEventId(seeded(2)));
  });
});

describe("Writer C —— git 回填", () => {
  const events = commitsToEvents(COMMITS, "p", "https://github.com/ShiGaChenTW/anchorline.git");

  test("event_id = commit hash，所以重跑幾次都只有一筆", () => {
    const twice = [...events, ...commitsToEvents(COMMITS, "p")];
    expect(twice).toHaveLength(4);
    expect(dedupe(twice)).toHaveLength(2);
  });

  test("時間用 commit 的時間，不是現在 —— 否則回填會全部擠在同一個月分片", () => {
    expect(events[0]!.ts).toBe("2026-08-09T10:00:00Z");
    expect(events[1]!.ts).toBe("2026-08-08T10:00:00Z");
  });

  test("author 記成 human 且 family 為 null —— 猜族系會讓職務分離誤判", () => {
    expect(events[0]!.actor).toEqual({ kind: "human", family: null, name: "Scott" });
  });

  test("訊息沒有錨點時，subject 退回 hash", () => {
    expect(events[0]!.subject).toBe("abc1234");
  });

  test("訊息內文寫了錨點就用錨點當 subject —— 那是 join key", () => {
    const [ev] = commitsToEvents(
      [
        {
          hash: "a009563",
          subject: "docs: README 加入安裝說明",
          at: "2026-08-10T12:16:56Z",
          author: "ShiGa Chen",
          refs: "",
          body: "anc:t=HNTPRY5R\n",
        },
      ],
      "p"
    );
    expect(ev!.subject).toBe("anc:t=HNTPRY5R");
    // hash 不能因此遺失，否則回填不再冪等。
    expect(ev!.event_id).toBe("a009563");
  });

  test("錨點也讀得到標題行與舊的 sf: 前綴", () => {
    const subjectAnchor = commitsToEvents(
      [{ hash: "h1", subject: "fix: 修 rollup anc:t=ABCD1234", at: "2026-08-10T12:00:00Z", author: "S", refs: "" }],
      "p"
    );
    expect(subjectAnchor[0]!.subject).toBe("anc:t=ABCD1234");

    const legacy = commitsToEvents(
      [{ hash: "h2", subject: "chore", at: "2026-08-10T12:00:00Z", author: "S", refs: "", body: "sf:t=ABC12345" }],
      "p"
    );
    // 舊的 sf: 錨點讀得到，但寫出來一律正規化成當前前綴。
    expect(legacy[0]!.subject).toBe("anc:t=ABC12345");
  });

  test("像錨點但不合法的字串不當成錨點 —— 誤判會把事件掛到不存在的任務上", () => {
    const bad = (body: string) =>
      commitsToEvents(
        [{ hash: "h3", subject: "chore", at: "2026-08-10T12:00:00Z", author: "S", refs: "", body }],
        "p"
      )[0]!.subject;

    expect(bad("anc:t=abc")).toBe("h3"); // 太短，且小寫不在字元集內
    // Crockford base32 刻意排除 I / L / O / U（手抄時容易看錯）。手寫的錨點
    // 很容易誤用它們 —— L0 探針用的 `L0PROBE1` 就同時踩到 L 和 O。
    expect(bad("anc:t=L0PROBE1")).toBe("h3");
  });

  test("GitHub remote → commit 連結；認不得的 remote 不瞎拼", () => {
    expect(commitUrl("https://github.com/o/r.git", "abc")).toBe("https://github.com/o/r/commit/abc");
    expect(commitUrl("git@github.com:o/r.git", "abc")).toBe("https://github.com/o/r/commit/abc");
    expect(commitUrl("https://gitlab.com/o/r.git", "abc")).toBeUndefined();
  });

  test("沒有 remote 時就不給 ref", () => {
    expect(commitsToEvents(COMMITS, "p")[0]!.ref).toBeUndefined();
  });

  test("回填的事件序列化後讀得回來", () => {
    const text = events.map((e) => serializeEvent(e)).join("");
    const { events: back, skipped } = parseLog(text);
    expect(skipped).toBe(0);
    expect(back.map((e) => e.subject)).toEqual(["abc1234", "def5678"]);
  });
});

describe("Writer B —— hook", () => {
  test("安裝片段是合法 JSON", () => {
    expect(() => JSON.parse(hookInstallSnippet())).not.toThrow();
  });

  test("指令只做追加，不開視窗、不起長駐進程", () => {
    const cmd = JSON.parse(hookInstallSnippet()).hooks.PostToolUse[0].hooks[0].command as string;
    expect(cmd).toContain(">>");
    expect(cmd).not.toMatch(/osascript|open -a|ghostty|iterm|Terminal|&\s*$|nohup/i);
  });

  test("寫進月分片而不是單一大檔", () => {
    const cmd = JSON.parse(hookInstallSnippet()).hooks.PostToolUse[0].hooks[0].command as string;
    expect(cmd).toContain("%Y-%m).jsonl");
  });

  // 這裡刻意「真的跑一次」而不是比對字串。
  // 上一版斷言 cmd 含有 ${CLAUDE_TOOL_FILE#$r/} —— 那個環境變數不存在，
  // hook 從來沒有寫出過一筆有效事件，而這條測試整段時間都是綠的。
  // 字串斷言守的是寫法，執行斷言守的是行為。
  async function runHook(root: string, stdin: string): Promise<string> {
    const cmd = JSON.parse(hookInstallSnippet()).hooks.PostToolUse[0].hooks[0].command as string;
    const p = Bun.spawn(["bash", "-c", cmd], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      stdin: new TextEncoder().encode(stdin),
    });
    await p.exited;
    const shard = join(root, ".anchorline/log", `${new Date().toISOString().slice(0, 7)}.jsonl`);
    return existsSync(shard) ? readFileSync(shard, "utf8") : "";
  }

  test("真的執行：路徑相對化，而且 App 讀得回來", async () => {
    const root = mkdtempSync(join(tmpdir(), "anc-hook-"));
    mkdirSync(join(root, ".anchorline"), { recursive: true });
    // 空白與中文路徑是真實情況（本 repo 的 worktree 目錄名就是中文）
    const abs = join(root, "計 劃/a b.ts");
    const out = await runHook(root, JSON.stringify({ tool_input: { file_path: abs } }));

    const { events, skipped } = parseLog(out);
    expect(skipped).toBe(0);
    expect(events).toHaveLength(1);
    expect(events[0]!.subject).toBe("計 劃/a b.ts");
    expect(events[0]!.actor?.kind).toBe("hook");
    rmSync(root, { recursive: true, force: true });
  });

  test("真的執行：沒有 .anchorline/ 就不寫，也不建目錄", async () => {
    const root = mkdtempSync(join(tmpdir(), "anc-hook-off-"));
    const out = await runHook(root, JSON.stringify({ tool_input: { file_path: join(root, "x.ts") } }));
    expect(out).toBe("");
    expect(existsSync(join(root, ".anchorline"))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  test("活著的判準是「有沒有 hook 事件」，不是「設定檔寫了沒」", () => {
    const now = Date.parse("2026-08-09T00:00:00Z");
    const fresh = [{ actor: { kind: "hook" }, ts: "2026-08-08T00:00:00Z" }];
    const stale = [{ actor: { kind: "hook" }, ts: "2026-06-01T00:00:00Z" }];
    expect(hookIsLive(fresh, now)).toBe(true);
    expect(hookIsLive(stale, now)).toBe(false);
    expect(hookIsLive([{ actor: { kind: "agent" }, ts: "2026-08-08T00:00:00Z" }], now)).toBe(false);
  });
});

describe("buildEvent", () => {
  test("選填欄位不存在時不出現在物件裡 —— 不留一堆 null 佔位", () => {
    const e = buildEvent(
      { project: "p", actor: { kind: "human", family: null, name: "S" }, kind: "gate.pass", subject: "x" },
      "ID0000000000AA"
    );
    expect(e).not.toHaveProperty("ref");
    expect(e).not.toHaveProperty("run_id");
    expect(e).not.toHaveProperty("payload");
  });

  test("ts 可覆寫；未給就是現在", () => {
    const e = buildEvent(
      { project: "p", actor: { kind: "human", family: null, name: "S" }, kind: "commit", subject: "x", ts: "2020-01-01T00:00:00Z" },
      "ID0000000000AB"
    );
    expect(e.ts).toBe("2020-01-01T00:00:00Z");
  });
});
