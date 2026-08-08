/**
 * 端到端：勾一個步驟 → 檔案被改 → 事件進 log → 「回到工作」讀得到。
 *
 * 這條走的是**正式模組**，不是模擬：`plan-writer` 的 `safeApply`、
 * `event-log` 的序列化與解析、`log-views` 的 resume card。唯一被換掉的是
 * bridge 的 read/write（改成 node:fs），因為 bun test 裡沒有 Tauri。
 *
 * 它取代「錄一段操作影片」：影片證明某一次成功，這條每次 CI 都證明一次。
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parsePlanMeta } from "../src/lib/plan-parser";
import { appendStep, guardOf, safeApply, toggleStep } from "../src/lib/plan-writer";
import { buildEvent } from "../src/lib/event-writer";
import { parseLog, serializeEvent, shardPath, type LogEvent } from "../src/lib/event-log";
import { buildResumeCard, exportMarkdown } from "../src/lib/log-views";

const root = mkdtempSync(join(tmpdir(), "sf-e2e-"));
const planPath = join(root, "plans", "demo.md");
mkdirSync(join(root, "plans"), { recursive: true });

const PLAN = `# Demo

**建立時間：** 2026-08-09 05:00
**最後更新：** 2026-08-09 05:00
**狀態：** 進行中

## 目標

證明勾選會落到磁碟並留下事件。

## Plan Steps

- [ ] 第一步：接上 bridge <!-- sf:t=HNTPRY5R -->
- [ ] 第二步：寫回檔案 <!-- sf:t=DSTT1PJ2 -->
`;
writeFileSync(planPath, PLAN);

/** 正式流程走 native.readFile/writeFile；這裡換成 fs，其餘完全相同 */
const io = {
  read: async (p: string) => readFileSync(p, "utf8"),
  write: async (p: string, t: string) => writeFileSync(p, t),
};

/** 正式流程走 bridge 的 appendFile（真 O_APPEND）；這裡用 fs 追加 */
function appendEvent(ev: LogEvent) {
  const p = join(root, shardPath(ev.ts));
  mkdirSync(join(root, ".specforge", "log"), { recursive: true });
  const prev = (() => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return "";
    }
  })();
  writeFileSync(p, prev + serializeEvent(ev));
}

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("端到端：勾選 → 磁碟 → 事件 → 回到工作", () => {
  test("① 勾第一步：檔案真的變了", async () => {
    const before = readFileSync(planPath, "utf8");
    const r = await safeApply(
      guardOf(planPath, before),
      (t) => toggleStep(t, "HNTPRY5R", true),
      io
    );
    expect(r.ok).toBe(true);

    const meta = parsePlanMeta(readFileSync(planPath, "utf8"));
    expect(meta.steps[0]!.state).toBe("done");
    expect(meta.steps[1]!.state).toBe("pending");
    expect(meta.done_steps).toBe(1);
  });

  test("② 事件落到月分片，subject 是那個錨點", () => {
    appendEvent(
      buildEvent(
        {
          project: "demo",
          actor: { kind: "human", family: null, name: "Scott" },
          kind: "task.done",
          subject: "sf:t=HNTPRY5R",
          ts: "2026-08-09T05:10:00Z",
          payload: { title: "第一步：接上 bridge" },
        },
        "E2E0000000001"
      )
    );

    const text = readFileSync(join(root, ".specforge/log/2026-08.jsonl"), "utf8");
    const { events, skipped } = parseLog(text);
    expect(skipped).toBe(0);
    expect(events).toHaveLength(1);
    expect(events[0]!.subject).toBe("sf:t=HNTPRY5R");
  });

  test("③「回到工作」讀得到：最後做完什麼、下一個是什麼", () => {
    const { events } = parseLog(readFileSync(join(root, ".specforge/log/2026-08.jsonl"), "utf8"));
    const open = parsePlanMeta(readFileSync(planPath, "utf8")).steps.filter(
      (s) => s.state === "pending"
    );
    const card = buildResumeCard(events, open, Date.parse("2026-08-09T06:10:00Z"));

    expect(card.lastActive).toBe("1 小時前");
    expect(card.lastDone).toBe("最後做完 第一步：接上 bridge");
    expect(card.nextOpen).toBe("下一個未完成是 第二步：寫回檔案");
    expect(card.resumeSubject).toBe("DSTT1PJ2");
  });

  test("④ 稽核報告匯得出來，而且看得到是誰做的", () => {
    const { events } = parseLog(readFileSync(join(root, ".specforge/log/2026-08.jsonl"), "utf8"));
    const md = exportMarkdown(events, "端到端");
    expect(md).toContain("Scott（人員）");
    expect(md).toContain("完成步驟");
    expect(md).toContain("sf:t=HNTPRY5R");
  });

  test("⑤ agent 在中途動了檔案：勾選被擋，磁碟一個位元組都沒變", async () => {
    const seen = readFileSync(planPath, "utf8");
    const guard = guardOf(planPath, seen);

    // 模擬 agent 在使用者讀到畫面之後、按下去之前加了一步
    writeFileSync(planPath, appendStep(seen, "agent 剛加的第三步")!.text);
    const afterAgent = readFileSync(planPath, "utf8");

    const r = await safeApply(guard, (t) => toggleStep(t, "DSTT1PJ2", true), io);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("新增 1 個步驟");

    // 最關鍵的一條：agent 寫的東西還在
    expect(readFileSync(planPath, "utf8")).toBe(afterAgent);
    expect(readFileSync(planPath, "utf8")).toContain("agent 剛加的第三步");
  });

  test("⑥ 重新讀取後再勾一次：這次成功", async () => {
    const fresh = readFileSync(planPath, "utf8");
    const r = await safeApply(guardOf(planPath, fresh), (t) => toggleStep(t, "DSTT1PJ2", true), io);
    expect(r.ok).toBe(true);

    const meta = parsePlanMeta(readFileSync(planPath, "utf8"));
    expect(meta.done_steps).toBe(2);
    expect(meta.total_steps).toBe(3); // agent 加的那步還在
    expect(meta.unanchored).toBe(0);
  });
});
