import { describe, expect, test } from "bun:test";
import {
  byNewest,
  cmdHash,
  dedupe,
  eventsFor,
  EVENT_SCHEMA_VERSION,
  MAX_LINE_BYTES,
  parseLog,
  PAYLOAD_ALLOW,
  redactCommand,
  relativizePath,
  sanitizePayload,
  serializeEvent,
  shardFor,
  shardPath,
  type LogEvent,
} from "../src/lib/event-log";

const ev = (o: Partial<LogEvent> = {}): LogEvent => ({
  v: EVENT_SCHEMA_VERSION,
  event_id: "01K2Q9V4B7XM8N",
  ts: "2026-08-09T10:00:00Z",
  project: "anchorline",
  actor: { kind: "agent", family: "claude", name: "Claude" },
  kind: "task.done",
  subject: "sf:t=HNTPRY5R",
  ...o,
});

describe("機密防護 —— append-only 洩漏了刪不掉", () => {
  test("payload 走白名單：沒列的欄位一律丟掉", () => {
    const out = sanitizePayload({
      title: "留著",
      apiKey: "sk-live-should-never-persist",
      authorization: "Bearer xxx",
      tokn: "拼錯的也要擋",
      count: 3,
    });
    expect(out).toEqual({ title: "留著", count: 3 });
  });

  test("白名單裡沒有任何看起來像密鑰的欄位", () => {
    for (const k of PAYLOAD_ALLOW) {
      expect(k.toLowerCase()).not.toMatch(/key|token|secret|password|auth|cookie/);
    }
  });

  test("全部被濾掉時回 undefined，不留空物件", () => {
    expect(sanitizePayload({ apiKey: "x" })).toBeUndefined();
  });

  test("命令只留 hash 與前 16 字元，原文永不進 payload", () => {
    const cmd = 'curl -H "Authorization: Bearer sk-live-abc123" https://api.example.com';
    const r = redactCommand(cmd);
    expect(r.cmd_prefix).toBe('curl -H "Authori');
    expect(r.cmd_prefix.length).toBeLessThanOrEqual(16);
    expect(JSON.stringify(r)).not.toContain("sk-live-abc123");
  });

  test("同一個命令 hash 穩定、不同命令不同", () => {
    expect(cmdHash("bun test")).toBe(cmdHash("bun test"));
    expect(cmdHash("bun test")).not.toBe(cmdHash("bun build"));
  });

  test("路徑相對化；根目錄外的不外洩結構", () => {
    expect(relativizePath("/Users/x/proj/src/a.ts", "/Users/x/proj")).toBe("src/a.ts");
    expect(relativizePath("/Users/x/proj", "/Users/x/proj")).toBe(".");
    expect(relativizePath("/Users/x/.ssh/id_rsa", "/Users/x/proj")).toBe("<outside>");
  });

  test("序列化後的整行不含被擋掉的欄位", () => {
    const line = serializeEvent(ev({ payload: { apiKey: "sk-live-nope", title: "ok" } }));
    expect(line).not.toContain("sk-live-nope");
    expect(line).toContain("ok");
  });
});

describe("單行原子性", () => {
  test("永遠恰好一行、以 \\n 結尾", () => {
    const line = serializeEvent(ev({ payload: { title: "有\n換行\n的標題" } }));
    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1)).not.toContain("\n");
  });

  test("超長事件砍 payload 保住事件本身，而不是整筆丟掉", () => {
    const line = serializeEvent(ev({ payload: { title: "字".repeat(5000) } }));
    expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(MAX_LINE_BYTES);
    expect(JSON.parse(line.trim()).subject).toBe("sf:t=HNTPRY5R");
  });
});

describe("月分片", () => {
  test("依事件自己的時間分片 —— 回填舊 commit 要落在正確月份", () => {
    expect(shardFor("2026-03-15T10:00:00Z")).toBe("2026-03.jsonl");
    expect(shardPath("2026-12-01T00:00:00Z")).toBe(".anchorline/log/2026-12.jsonl");
  });

  test("壞時間不炸，退到當月", () => {
    expect(shardFor("garbage")).toMatch(/^\d{4}-\d{2}\.jsonl$/);
  });
});

describe("parseLog —— 壞一行不能毀整份", () => {
  test("跳過壞行並回報數量", () => {
    const text = [
      serializeEvent(ev({ event_id: "a" })).trim(),
      "{ 半行被 crash 截斷",
      "",
      serializeEvent(ev({ event_id: "b" })).trim(),
    ].join("\n");
    const { events, skipped } = parseLog(text);
    expect(events.map((e) => e.event_id)).toEqual(["a", "b"]);
    expect(skipped).toBe(1);
  });

  test("缺必要欄位的物件算壞行，不是有效事件", () => {
    const { events, skipped } = parseLog('{"foo":1}');
    expect(events).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  test("空字串不算壞行", () => {
    expect(parseLog("\n\n  \n")).toEqual({ events: [], skipped: 0 });
  });

  test("整份都壞掉也不丟例外", () => {
    expect(() => parseLog("完全不是 json\n也不是")).not.toThrow();
  });
});

describe("去重與排序", () => {
  test("event_id 去重 —— hook 會重複觸發、git 回填會重疊", () => {
    const list = [ev({ event_id: "a" }), ev({ event_id: "a" }), ev({ event_id: "b" })];
    expect(dedupe(list).map((e) => e.event_id)).toEqual(["a", "b"]);
  });

  test("byNewest 新到舊", () => {
    const list = [
      ev({ event_id: "old", ts: "2026-01-01T00:00:00Z" }),
      ev({ event_id: "new", ts: "2026-08-09T00:00:00Z" }),
    ];
    expect(byNewest(list)[0]!.event_id).toBe("new");
  });

  test("eventsFor 把同一個 join key 的事件串起來 —— 這是證據區", () => {
    const list = [
      ev({ event_id: "1", subject: "sf:t=AAA", kind: "commit" }),
      ev({ event_id: "2", subject: "sf:t=BBB" }),
      ev({ event_id: "3", subject: "sf:t=AAA", kind: "task.done" }),
    ];
    expect(eventsFor(list, "sf:t=AAA").map((e) => e.event_id).sort()).toEqual(["1", "3"]);
  });
});
