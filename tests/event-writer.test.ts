import { describe, expect, test } from "bun:test";
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
  const events = commitsToEvents(COMMITS, "p", "https://github.com/ShiGaChenTW/PM-SPEC-SCVB.git");

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

  test("subject = hash，證據區才串得起來", () => {
    expect(events[0]!.subject).toBe("abc1234");
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

  test("路徑相對化，不記絕對路徑", () => {
    const cmd = JSON.parse(hookInstallSnippet()).hooks.PostToolUse[0].hooks[0].command as string;
    expect(cmd).toContain('${CLAUDE_TOOL_FILE#$r/}');
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
