import { describe, expect, test } from "bun:test";
import { EVENT_SCHEMA_VERSION, type LogEvent } from "../src/lib/event-log";
import { buildReplay, CHAIN_STAGES, chainComplete, findViolations, replayMarkdown } from "../src/lib/replay";

const NOW = new Date("2026-08-09T12:00:00Z").getTime();

let n = 0;
const ev = (kind: LogEvent["kind"], ts: string, actor?: Partial<LogEvent["actor"]>): LogEvent => ({
  v: EVENT_SCHEMA_VERSION,
  event_id: `E${n++}`,
  ts,
  project: "p",
  actor: { kind: "human", family: null, name: "Scott", ...actor },
  kind,
  subject: "prd:p1",
});

const FULL = [
  ev("prd.section.edit", "2026-08-01T10:00:00Z"),
  ev("gate.pass", "2026-08-02T10:00:00Z"),
  ev("review.submit", "2026-08-03T10:00:00Z"),
  ev("review.approve", "2026-08-03T12:00:00Z"),
  ev("commit", "2026-08-04T10:00:00Z", { kind: "agent", family: "claude", name: "Claude" }),
  ev("pr.open", "2026-08-05T10:00:00Z", { kind: "ci", family: null, name: "GitHub" }),
  ev("release.tag", "2026-08-06T10:00:00Z"),
];

describe("治理鏈六段", () => {
  const r = buildReplay(FULL, "prd:p1", null, NOW);

  test("順序固定 —— 這個順序本身就是論點", () => {
    expect(r.stages.map((s) => s.id)).toEqual(CHAIN_STAGES.map((s) => s.id));
  });

  test("每段算出事件數與參與者", () => {
    const impl = r.stages.find((s) => s.id === "implement")!;
    expect(impl.count).toBe(1);
    expect(impl.actors).toEqual(["Claude"]);
  });

  test("全部走過 = 完整", () => {
    expect(chainComplete(r)).toBe(true);
    expect(r.total).toBe(7);
  });

  test("空段落要標出來，不能跳過 —— 缺口本身是資訊", () => {
    const partial = buildReplay(FULL.slice(0, 2), "prd:p1", null, NOW);
    expect(chainComplete(partial)).toBe(false);
    const review = partial.stages.find((s) => s.id === "review")!;
    expect(review.empty).toBe(true);
    expect(review.count).toBe(0);
  });

  test("完全沒有事件也不炸", () => {
    const empty = buildReplay([], "prd:p1", null, NOW);
    expect(empty.total).toBe(0);
    expect(empty.spanLabel).toBe("還沒有事件");
    expect(empty.stages).toHaveLength(CHAIN_STAGES.length);
  });
});

describe("agent 族系職務分離 —— GitHub 原生抓不到的那一類", () => {
  test("同族 agent 核准自己族系寫的文件 = 違規", () => {
    const events = [ev("review.approve", "2026-08-03T12:00:00Z", { kind: "agent", family: "claude", name: "Claude" })];
    const v = findViolations(events, "claude");
    expect(v).toHaveLength(1);
    expect(v[0]!.detail).toContain("claude");
  });

  test("不同族 agent 核准 = 合法", () => {
    const events = [ev("review.approve", "2026-08-03T12:00:00Z", { kind: "agent", family: "codex", name: "Codex" })];
    expect(findViolations(events, "claude")).toHaveLength(0);
  });

  test("人核准永遠合法 —— 人不是被治理的對象，是治理者", () => {
    const events = [ev("review.approve", "2026-08-03T12:00:00Z")];
    expect(findViolations(events, "claude")).toHaveLength(0);
  });

  test("撰寫者是人時不檢查", () => {
    const events = [ev("review.approve", "2026-08-03T12:00:00Z", { kind: "agent", family: "claude", name: "Claude" })];
    expect(findViolations(events, null)).toHaveLength(0);
  });

  test("同族但不是核准動作 = 不違規 —— 同族一起寫沒問題", () => {
    const events = [ev("commit", "2026-08-04T10:00:00Z", { kind: "agent", family: "claude", name: "Claude" })];
    expect(findViolations(events, "claude")).toHaveLength(0);
  });
});

describe("Markdown 輸出 —— 作品要能貼出去", () => {
  test("六段全列，含空段落", () => {
    const md = replayMarkdown(buildReplay(FULL.slice(0, 1), "prd:p1", null, NOW), "測試");
    for (const s of CHAIN_STAGES) expect(md).toContain(s.label);
    expect(md).toContain("尚未發生");
  });

  test("通過時明說通過，不是靜默", () => {
    expect(replayMarkdown(buildReplay(FULL, "prd:p1", null, NOW), "t")).toContain("職務分離檢查：通過");
  });

  test("違規時單獨一段，並點名 GitHub 原生抓不到", () => {
    const bad = [...FULL, ev("review.approve", "2026-08-07T10:00:00Z", { kind: "agent", family: "claude", name: "Claude" })];
    const md = replayMarkdown(buildReplay(bad, "prd:p1", "claude", NOW), "t");
    expect(md).toContain("⚠️ 職務分離違規");
    expect(md).toContain("CODEOWNERS");
  });
});
