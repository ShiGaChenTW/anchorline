import { describe, expect, test } from "bun:test";
import {
  coverageLine,
  governanceCoverage,
  isGoverned,
  rollupCoverage,
  type ProjectCoverage,
} from "../src/lib/governance";
import type { LogEvent } from "../src/lib/event-log";

/** plans 裡真的存在的錨點。測試裡預設把用到的都當成存在。 */
const KNOWN = new Set(["HNTPRY5R", "ABC12345", "KZ4M7QVT"]);

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
    expect(isGoverned({ subject: "anc:t=HNTPRY5R" }, KNOWN)).toBe(true);
    expect(isGoverned({ subject: "sf:t=ABC12345" }, KNOWN)).toBe(true);
  });

  test("commit hash 不算", () => {
    expect(isGoverned({ subject: "a009563" }, KNOWN)).toBe(false);
  });

  // 這條是這個模組選擇前綴而不是字元集的理由：七位全數字的 hash 完全符合
  // Crockford 的字元集，用字元集判定會把它錯算成已治理。
  test("全數字的 commit hash 不會被錯認成錨點", () => {
    expect(isGoverned({ subject: "1234567" }, KNOWN)).toBe(false);
  });

  test("branch name 當 subject 的未治理 task 不算", () => {
    expect(isGoverned({ subject: "task/readme-md-commit" }, KNOWN)).toBe(false);
  });

  test("裸 id 不算 —— 兩個 writer 必須寫同一種形狀", () => {
    expect(isGoverned({ subject: "HNTPRY5R" }, KNOWN)).toBe(false);
  });
});

describe("governanceCoverage", () => {
  test("完全沒有錨點事件 = 尚未開始治理，不是零未治理", () => {
    const c = governanceCoverage([ev("a009563", "2026-08-01T00:00:00Z")], KNOWN);
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
    ], KNOWN);
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
    ], KNOWN);
    expect(c.startedIso).toBe("2026-08-01T00:00:00Z");
    expect(c.governed).toBe(2);
    expect(c.ungoverned).toBe(1);
  });

  test("全部都有錨點時說得出來", () => {
    const c = governanceCoverage([ev("anc:t=HNTPRY5R", "2026-08-01T00:00:00Z")], KNOWN);
    expect(coverageLine(c)).toBe("全部都經過治理");
  });

  test("有未治理時給數字與比例", () => {
    const c = governanceCoverage([
      ev("anc:t=HNTPRY5R", "2026-08-01T00:00:00Z"),
      ev("x1", "2026-08-02T00:00:00Z"),
      ev("x2", "2026-08-03T00:00:00Z"),
      ev("x3", "2026-08-04T00:00:00Z"),
    ], KNOWN);
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

// 磁碟上真的混著兩種寫法：git 回填的 `…+08:00` 與 Border Loom 的 `…Z`。
// 這兩個字串的字典序跟時間順序相反，而基準線原本是字串比較 —— 錯法是
// 「抓到錯的那一筆當起點」，沒有任何錯誤訊息。
describe("時間戳格式混用（真實 log 的狀況）", () => {
  const at = (subject: string, ts: string): LogEvent => ({
    v: 1,
    event_id: ts,
    ts,
    project: "p",
    actor: { kind: "human", family: null, name: "S" },
    kind: "commit",
    subject,
  });

  test("基準線用解析後的時間，不用字串", () => {
    // 15:22Z 其實是 23:22+08:00 —— 比 19:31+08:00 晚，雖然字串比較說它比較早。
    const c = governanceCoverage([
      at("cfbdb09", "2026-08-10T19:31:31+08:00"),
      at("anc:t=HNTPRY5R", "2026-08-10T15:22:33.599Z"),
    ], KNOWN);
    expect(c.startedIso).toBe("2026-08-10T15:22:33.599Z");
    // 錨點事件是最晚的那一筆，所以它之前的 commit 不該計入。
    expect(c.ungoverned).toBe(0);
    expect(c.governed).toBe(1);
  });

  test("字串比較會給出相反答案 —— 這條記錄下為什麼不能那樣寫", () => {
    expect("2026-08-10T15:22:33.599Z" < "2026-08-10T19:31:31+08:00").toBe(true);
    expect(Date.parse("2026-08-10T15:22:33.599Z") < Date.parse("2026-08-10T19:31:31+08:00")).toBe(
      false
    );
  });

  test("讀不出來的時間戳排到最後，不會把基準線往前拉", () => {
    const c = governanceCoverage([
      at("anc:t=HNTPRY5R", "not a date"),
      at("cfbdb09", "2026-08-10T19:31:31+08:00"),
    ], KNOWN);
    // 壞掉的那筆被當成最晚，所以它之前的 commit 不計入 —— 不會因為一筆爛
    // 資料就把整段歷史算成未治理。
    expect(c.ungoverned).toBe(0);
  });
});

// 這組是這次改動存在的理由。實測 Anchorline 自己的 175 個 commit，兩筆被判成
// 「已治理」，而它們是寫文件時舉的例子 —— `X` 在 Crockford 字元集裡，所以
// 佔位字串完全通過形狀檢查。
describe("佔位字串不是錨點", () => {
  const ev2 = (subject: string, ts = "2026-08-01T00:00:00Z"): LogEvent => ({
    v: 1,
    event_id: subject,
    ts,
    project: "p",
    actor: { kind: "human", family: null, name: "S" },
    kind: "commit",
    subject,
  });

  test("形狀合法但 plans 裡不存在的 id 不算已治理", () => {
    const known = new Set(["HNTPRY5R"]);
    expect(isGoverned({ subject: "anc:t=XXXXXXXX" }, known)).toBe(false);
    expect(isGoverned({ subject: "anc:t=XXXX" }, known)).toBe(false);
    expect(isGoverned({ subject: "anc:t=HNTPRY5R" }, known)).toBe(true);
  });

  test("整份 log 只有佔位字串時＝尚未開始治理，不是已治理", () => {
    const c = governanceCoverage(
      [ev2("anc:t=XXXXXXXX"), ev2("anc:t=XXXX"), ev2("a009563")],
      new Set(["HNTPRY5R"])
    );
    expect(c.startedIso).toBeNull();
    expect(c.governed).toBe(0);
  });

  // 不確定時要往「還沒治理」倒，不要往「已經治理」倒：前者促使人去看，
  // 後者讓人安心而其實什麼都沒發生。
  test("讀不到 plan 檔（空集合）時，全部算未治理", () => {
    const c = governanceCoverage([ev2("anc:t=HNTPRY5R")], new Set());
    expect(c.startedIso).toBeNull();
  });
});

describe("openspec 第二形狀（W1-3）", () => {
  const LIVE = new Set<string>([]);

  test("openspec 形狀合格 → 已治理（形狀認定，不驗存在）", () => {
    expect(isGoverned(ev("openspec:add-login/1.1", "2026-08-15T00:00:00Z"), LIVE)).toBe(true);
  });

  test("步驟編號重編不影響歷史——任何數字編號都以形狀放行（Grok C7：N.M 是位置編號不是鑄造 id）", () => {
    expect(isGoverned(ev("openspec:add-login/9.9", "2026-08-15T00:00:00Z"), LIVE)).toBe(true);
  });

  test("歸檔／已刪的 change → 照樣放行（歸檔是正常生命週期，不倒扣）", () => {
    expect(isGoverned(ev("openspec:archived-change/3.2", "2026-08-15T00:00:00Z"), LIVE)).toBe(true);
  });

  test("形狀不合（編號不是數字）→ 未治理", () => {
    expect(isGoverned(ev("openspec:add-login/abc", "2026-08-15T00:00:00Z"), LIVE)).toBe(false);
  });

  test("舊事件用 H1 標題當 changeId → 不在活集合，依形狀放行（向後相容）", () => {
    expect(isGoverned(ev("openspec:某個中文標題/1.2", "2026-08-15T00:00:00Z"), LIVE)).toBe(true);
  });

  test("錨點形狀行為不變：佔位字串仍被第二層擋掉", () => {
    expect(isGoverned(ev("anc:t=XXXXXXXX", "2026-08-15T00:00:00Z"), LIVE)).toBe(false);
  });

  test("uat 報告層級 subject（uat:檔名）不是治理形狀 → 未治理", () => {
    expect(isGoverned(ev("uat:uat-w1-1.md", "2026-08-15T00:00:00Z"), LIVE)).toBe(false);
  });
});
