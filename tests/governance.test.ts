import { describe, expect, test } from "bun:test";
import {
  coverageLine,
  governanceCoverage,
  isGoverned,
  rollupCoverage,
  type ProjectCoverage,
} from "../src/lib/governance";
import type { LogEvent } from "../src/lib/event-log";

function ev(subject: string, ts: string): LogEvent {
  return {
    v: 1,
    event_id: subject,
    ts,
    project: "p",
    actor: { kind: "human", family: null, name: "S" },
    kind: "commit",
    subject,
  };
}

describe("isGoverned", () => {
  test("帶前綴的錨點算治理過", () => {
    expect(isGoverned({ subject: "anc:t=HNTPRY5R" })).toBe(true);
    expect(isGoverned({ subject: "sf:t=ABC12345" })).toBe(true);
  });

  test("commit hash 不算", () => {
    expect(isGoverned({ subject: "a009563" })).toBe(false);
  });

  // 這條是這個模組選擇前綴而不是字元集的理由：七位全數字的 hash 完全符合
  // Crockford 的字元集，用字元集判定會把它錯算成已治理。
  test("全數字的 commit hash 不會被錯認成錨點", () => {
    expect(isGoverned({ subject: "1234567" })).toBe(false);
  });

  test("branch name 當 subject 的未治理 task 不算", () => {
    expect(isGoverned({ subject: "task/readme-md-commit" })).toBe(false);
  });

  test("裸 id 不算 —— 兩個 writer 必須寫同一種形狀", () => {
    expect(isGoverned({ subject: "HNTPRY5R" })).toBe(false);
  });
});

describe("governanceCoverage", () => {
  test("完全沒有錨點事件 = 尚未開始治理，不是零未治理", () => {
    const c = governanceCoverage([ev("a009563", "2026-08-01T00:00:00Z")]);
    expect(c.startedIso).toBeNull();
    expect(c.ungoverned).toBe(0);
    expect(coverageLine(c)).toBe("尚未開始治理");
  });

  // 基準線的整個重點：導入之前的歷史不算在使用者頭上。
  test("基準線之前的事件完全不計", () => {
    const c = governanceCoverage([
      ev("old1", "2026-01-01T00:00:00Z"),
      ev("old2", "2026-02-01T00:00:00Z"),
      ev("anc:t=HNTPRY5R", "2026-08-01T00:00:00Z"),
      ev("later", "2026-08-02T00:00:00Z"),
    ]);
    expect(c.startedIso).toBe("2026-08-01T00:00:00Z");
    expect(c.governed).toBe(1);
    expect(c.ungoverned).toBe(1);
  });

  // 三類 writer 併發追加、月分片合併，順序沒有保證。
  test("事件亂序時基準線仍取最早的錨點事件", () => {
    const c = governanceCoverage([
      ev("anc:t=KZ4M7QVT", "2026-08-05T00:00:00Z"),
      ev("anc:t=HNTPRY5R", "2026-08-01T00:00:00Z"),
      ev("between", "2026-08-03T00:00:00Z"),
      ev("before", "2026-07-31T00:00:00Z"),
    ]);
    expect(c.startedIso).toBe("2026-08-01T00:00:00Z");
    expect(c.governed).toBe(2);
    expect(c.ungoverned).toBe(1);
  });

  test("全部都有錨點時說得出來", () => {
    const c = governanceCoverage([ev("anc:t=HNTPRY5R", "2026-08-01T00:00:00Z")]);
    expect(coverageLine(c)).toBe("全部都經過治理");
  });

  test("有未治理時給數字與比例", () => {
    const c = governanceCoverage([
      ev("anc:t=HNTPRY5R", "2026-08-01T00:00:00Z"),
      ev("x1", "2026-08-02T00:00:00Z"),
      ev("x2", "2026-08-03T00:00:00Z"),
      ev("x3", "2026-08-04T00:00:00Z"),
    ]);
    expect(coverageLine(c)).toBe("3 件未治理（占 75%）");
  });
});

describe("rollupCoverage", () => {
  const row = (
    projectId: string,
    projectName: string,
    startedIso: string | null,
    governed: number,
    ungoverned: number
  ): ProjectCoverage => ({ projectId, projectName, startedIso, governed, ungoverned });

  test("加總只算有治理資料的專案", () => {
    const r = rollupCoverage([
      row("a", "Alpha", "2026-08-01T00:00:00Z", 3, 5),
      row("b", "Beta", "2026-08-01T00:00:00Z", 1, 2),
      row("c", "Gamma", null, 0, 0),
    ]);
    expect(r.ungoverned).toBe(7);
    expect(r.governed).toBe(4);
    expect(r.notStarted).toBe(1);
  });

  // 尚未導入的專案若算成 0，看起來就跟「導入得很乾淨」一樣 —— 那是獎勵什麼都沒做。
  test("尚未開始治理的專案不進明細", () => {
    const r = rollupCoverage([row("c", "Gamma", null, 0, 0)]);
    expect(r.active).toHaveLength(0);
    expect(r.notStarted).toBe(1);
  });

  test("明細按未治理數量由多到少排，同數量按名稱", () => {
    const r = rollupCoverage([
      row("a", "Beta", "2026-08-01T00:00:00Z", 0, 2),
      row("b", "Alpha", "2026-08-01T00:00:00Z", 0, 2),
      row("c", "Zeta", "2026-08-01T00:00:00Z", 0, 9),
    ]);
    expect(r.active.map((x) => x.projectName)).toEqual(["Zeta", "Alpha", "Beta"]);
  });
});
