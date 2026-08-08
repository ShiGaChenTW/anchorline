import { describe, expect, test } from "bun:test";
import { EVENT_SCHEMA_VERSION, type LogEvent } from "../src/lib/event-log";
import {
  buildResumeCard,
  exportCsv,
  exportMarkdown,
  filterForExport,
  KIND_GROUP_CAP,
  kindLabel,
  todayLine,
  todaySummary,
} from "../src/lib/log-views";

const NOW = new Date("2026-08-09T18:00:00").getTime();

const ev = (o: Partial<LogEvent>): LogEvent => ({
  v: EVENT_SCHEMA_VERSION,
  event_id: Math.random().toString(36).slice(2),
  ts: "2026-08-09T10:00:00",
  project: "p",
  actor: { kind: "agent", family: "claude", name: "Claude" },
  kind: "file.edit",
  subject: "s",
  ...o,
});

describe("① 回到工作 —— context recovery，不是稽核", () => {
  test("三行：上次動 / 最後做完 / 下一個未完成", () => {
    const card = buildResumeCard(
      [
        ev({ ts: "2026-08-09T16:00:00", kind: "file.edit" }),
        ev({ ts: "2026-08-09T15:00:00", kind: "task.done", subject: "sf:t=AAA", payload: { title: "P1-3 焦點卡" } }),
      ],
      [{ id: "sf:t=BBB", text: "P1-7 PR 雷達" }],
      NOW
    );
    expect(card.lastActive).toBe("2 小時前");
    expect(card.lastDone).toBe("最後做完 P1-3 焦點卡");
    expect(card.nextOpen).toBe("下一個未完成是 P1-7 PR 雷達");
    expect(card.resumeSubject).toBe("sf:t=BBB");
  });

  test("完全沒有事件：不顯示 Invalid Date 或 0", () => {
    const card = buildResumeCard([], [], NOW);
    expect(card.lastActive).toBe("從未");
    expect(card.lastDone).toBe("還沒有完成任何步驟");
    expect(card.nextOpen).toBe("沒有未完成的步驟");
    expect(card.resumeSubject).toBeNull();
  });

  test("有事件但沒完成過任何步驟", () => {
    const card = buildResumeCard([ev({ ts: "2026-08-09T17:00:00" })], [], NOW);
    expect(card.lastActive).toBe("1 小時前");
    expect(card.lastDone).toBe("還沒有完成任何步驟");
  });
});

describe("② 今天做了什麼 —— 折疊成 ≤4 組", () => {
  test("超過 4 種 kind 時併成「其他」", () => {
    const kinds = ["file.edit", "commit", "task.done", "gate.pass", "review.submit", "pr.open"];
    const events = kinds.flatMap((k, i) =>
      Array.from({ length: 6 - i }, () => ev({ kind: k as LogEvent["kind"], ts: "2026-08-09T09:00:00" }))
    );
    const groups = todaySummary(events, NOW);
    expect(groups.length).toBeLessThanOrEqual(KIND_GROUP_CAP + 1);
    expect(groups[groups.length - 1]!.label).toBe("其他");
  });

  test("只算今天的，昨天的不進來", () => {
    const events = [
      ev({ ts: "2026-08-09T09:00:00" }),
      ev({ ts: "2026-08-08T23:59:00" }),
    ];
    expect(todaySummary(events, NOW).reduce((a, g) => a + g.count, 0)).toBe(1);
  });

  test("沒有動作時明講，不顯示 0 件", () => {
    expect(todayLine(todaySummary([], NOW))).toBe("今天還沒有動作");
  });

  test("kind 翻成中文動詞；認不得的照原字串顯示，不吞掉", () => {
    expect(kindLabel("task.done")).toBe("完成步驟");
    expect(kindLabel("future.kind")).toBe("future.kind");
  });
});

describe("③ 匯出稽核報告", () => {
  const events = [
    ev({ ts: "2026-08-09T10:00:00Z", kind: "review.approve", subject: "prd-1", actor: { kind: "human", family: null, name: "Scott" } }),
    ev({ ts: "2026-08-08T10:00:00Z", kind: "commit", subject: "abc123", ref: "https://github.com/o/r/commit/abc123" }),
  ];

  test("Markdown：人員與 agent 的執行者標示不同", () => {
    const md = exportMarkdown(events, "測試報告");
    expect(md).toContain("# 測試報告");
    expect(md).toContain("Scott（人員）");
    expect(md).toContain("Claude（agent · claude）");
    expect(md).toContain("核准");
  });

  test("CSV 欄位順序固定", () => {
    expect(exportCsv(events).split("\n")[0]).toBe(
      "ts,actor_kind,actor_family,actor_name,kind,subject,ref"
    );
  });

  test("CSV 逃逸逗號與引號 —— 少一個就有人的報告在 Excel 裡錯位", () => {
    const csv = exportCsv([ev({ subject: 'a,b"c', ts: "2026-08-09T10:00:00Z" })]);
    expect(csv).toContain('"a,b""c"');
  });

  test("依時間區間與 subject 篩選", () => {
    expect(filterForExport(events, { fromIso: "2026-08-09T00:00:00Z" })).toHaveLength(1);
    expect(filterForExport(events, { subject: "abc123" })).toHaveLength(1);
    expect(filterForExport(events, {})).toHaveLength(2);
  });

  test("匯出結果新到舊", () => {
    expect(filterForExport(events, {})[0]!.subject).toBe("prd-1");
  });
});
