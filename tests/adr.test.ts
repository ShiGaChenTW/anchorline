import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { decisionEventSeeds, parseChangelog, parseDecisions } from "../src/lib/adr";
import { prsToEvents } from "../src/lib/event-writer";
import { dedupe } from "../src/lib/event-log";

const ISA = `---
task: x
---

## Goal

某個目標。

## Decisions

- **2026-08-09** — ISA 家：任務型而非專案型。理由：一次性評估。
- **2026-08-09** — refined: 焦點卡欄位封頂 4 個。
- 這行沒有內容格式，應該被跳過嗎

## Changelog

- **conjectured**: 在 store.ts 加兩張表就好。
  **refuted_by**: store 是 localStorage-backed，5–10MB 硬上限。
  **learned**: 缺的是 join key 與磁碟上的事件流。
  **criterion_now**: ISC-15、ISC-34。

- **conjectured**: 這筆不完整。
  **learned**: 只有兩個欄位。

## Verification

無。
`;

describe("ISA Decisions → ADR", () => {
  const ds = parseDecisions(ISA);

  test("抓出日期與內容", () => {
    expect(ds[0]!.date).toBe("2026-08-09");
    expect(ds[0]!.text).toContain("ISA 家");
  });

  test("refined: 前綴被辨識並從內容剝掉", () => {
    expect(ds[1]!.refined).toBe(true);
    expect(ds[1]!.text).toBe("焦點卡欄位封頂 4 個。");
    expect(ds[0]!.refined).toBe(false);
  });

  test("只讀 ## Decisions，不吃到別的區段", () => {
    expect(ds.every((d) => !d.text.includes("某個目標"))).toBe(true);
    expect(ds.every((d) => !d.text.includes("無。"))).toBe(true);
  });

  test("沒有 Decisions 區段時回空陣列，不丟例外", () => {
    expect(parseDecisions("# 只有標題")).toEqual([]);
  });
});

describe("ISA Changelog → Deutsch 三段式", () => {
  const cl = parseChangelog(ISA);

  test("四個欄位齊全才算一筆 —— 半筆比沒有更糟", () => {
    expect(cl).toHaveLength(1);
    expect(cl[0]!.conjectured).toContain("store.ts");
    expect(cl[0]!.refutedBy).toContain("localStorage");
    expect(cl[0]!.learned).toContain("join key");
    expect(cl[0]!.criterionNow).toContain("ISC-15");
  });

  test("壞格式不丟例外", () => {
    expect(() => parseChangelog("## Changelog\n亂寫\n")).not.toThrow();
    expect(parseChangelog("## Changelog\n亂寫\n")).toEqual([]);
  });
});

describe("decision → 事件", () => {
  test("同一份 ISA 解析兩次得到同一批 id（冪等）", () => {
    const a = decisionEventSeeds(parseDecisions(ISA), "p");
    const b = decisionEventSeeds(parseDecisions(ISA), "p");
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
  });

  test("改了內容就是新事件 —— 決策紀錄要的正是這個行為", () => {
    const a = decisionEventSeeds([{ date: "2026-08-09", text: "A", refined: false }], "p");
    const b = decisionEventSeeds([{ date: "2026-08-09", text: "B", refined: false }], "p");
    expect(a[0]!.id).not.toBe(b[0]!.id);
  });

  test("subject 可指向受影響的 task，證據區才串得起來", () => {
    const seeds = decisionEventSeeds(parseDecisions(ISA), "p", () => "sf:t=HNTPRY5R");
    expect(seeds[0]!.subject).toBe("sf:t=HNTPRY5R");
  });
});

describe("PR → 事件（§十一 L2）", () => {
  const prs = [
    { repo: "o/r", number: 1, title: "t", updatedAt: "2026-08-09T00:00:00Z", reviewDecision: "APPROVED", checks: [{ name: "ci", conclusion: "FAILURE" }] },
    { repo: "o/r", number: 2, title: "u", updatedAt: "2026-08-09T00:00:00Z" },
  ];

  test("每個 PR 依狀態產生對應事件", () => {
    const kinds = prsToEvents(prs, "p").map((e) => e.kind);
    expect(kinds).toEqual(["pr.open", "pr.review", "pr.checks.fail", "pr.open"]);
  });

  test("輪詢很多次也只留一筆 —— 用時間戳當 id 會產生上萬筆", () => {
    const many = [...prsToEvents(prs, "p"), ...prsToEvents(prs, "p"), ...prsToEvents(prs, "p")];
    expect(dedupe(many)).toHaveLength(4);
  });

  test("subject 與 ref 指得回 GitHub", () => {
    const [first] = prsToEvents(prs, "p");
    expect(first!.subject).toBe("pr:o/r#1");
    expect(first!.ref).toBe("https://github.com/o/r/pull/1");
  });

  test("沒有 CI 的 repo 不產生 checks 事件", () => {
    expect(prsToEvents([prs[1]!], "p").map((e) => e.kind)).toEqual(["pr.open"]);
  });
});

describe("真實 fixture：本 session 的 ISA", () => {
  const path = `${process.env.HOME}/.claude/PAI/MEMORY/WORK/dev-workbench-upgrade-eval/ISA.md`;
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    /* ISA 不在就跳過 —— 這個測試不該讓別台機器紅燈 */
  }

  test.skipIf(!text)("解得出決策，且每一筆都有內容", () => {
    const ds = parseDecisions(text);
    expect(ds.length).toBeGreaterThan(0);
    expect(ds.every((d) => d.text.length > 0)).toBe(true);
  });

  test.skipIf(!text)("解得出至少一筆完整的 Deutsch 三段式", () => {
    expect(parseChangelog(text).length).toBeGreaterThan(0);
  });
});
