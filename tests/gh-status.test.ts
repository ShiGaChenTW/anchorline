import { describe, expect, test } from "bun:test";
import {
  byStalest,
  fetchStaleLabel,
  parsePrList,
  parsePrSearch,
  prRadarLine,
  prStatusLine,
  reviewHandoffMarkdown,
  type PrDetail,
} from "../src/lib/gh-status";

/** 實測自 gh v2.96.0（2026-08-09），真實資料去識別後保留形狀 */
const SEARCH_JSON = JSON.stringify([
  {
    number: 1,
    repository: { name: "Terminal-Widget", nameWithOwner: "ShiGaChenTW/Terminal-Widget" },
    title: "Pi agent console",
    updatedAt: "2026-07-03T09:58:19Z",
  },
  {
    number: 7,
    repository: { name: "border-loom", nameWithOwner: "ShiGaChenTW/border-loom" },
    title: "fix something",
    updatedAt: "2026-08-08T10:00:00Z",
  },
]);

const NOW = new Date("2026-08-09T09:58:19Z").getTime();

describe("parsePrSearch", () => {
  test("解出 repo / number / updatedAt", () => {
    const prs = parsePrSearch(SEARCH_JSON);
    expect(prs).toHaveLength(2);
    expect(prs[0]!.repo).toBe("ShiGaChenTW/Terminal-Widget");
    expect(prs[0]!.number).toBe(1);
  });

  test("壞 JSON / 非陣列不丟例外", () => {
    expect(parsePrSearch("nope")).toEqual([]);
    expect(parsePrSearch('{"message":"rate limited"}')).toEqual([]);
  });
});

describe("雷達那一行", () => {
  test("指出最久沒動的那一筆，用天數不用日期（時間盲對策）", () => {
    const r = { available: true as const, prs: parsePrSearch(SEARCH_JSON), fetchedAt: new Date(NOW).toISOString() };
    expect(prRadarLine(r, NOW)).toBe("你有 2 個 PR 開著，最久的 37 天前");
  });

  test("byStalest 由久到新", () => {
    const s = byStalest(parsePrSearch(SEARCH_JSON), NOW);
    expect(s[0]!.number).toBe(1);
  });

  test("沒有 PR：明講，不顯示 0", () => {
    expect(prRadarLine({ available: true, prs: [], fetchedAt: new Date(NOW).toISOString() }, NOW)).toBe(
      "沒有開著的 PR"
    );
  });

  test("gh 不在／未登入：直說原因，不當錯誤", () => {
    expect(prRadarLine({ available: false, reason: "找不到 gh" }, NOW)).toBe("找不到 gh");
  });
});

describe("新鮮度標示", () => {
  test("剛取得：不加警告", () => {
    const r = { available: true as const, prs: [], fetchedAt: new Date(NOW - 30_000).toISOString() };
    expect(fetchStaleLabel(r, NOW)).toBe("PR 狀態於 剛剛取得");
  });

  test("超過 5 分鐘：標記可能過時", () => {
    const r = { available: true as const, prs: [], fetchedAt: new Date(NOW - 10 * 60_000).toISOString() };
    expect(fetchStaleLabel(r, NOW)).toContain("可能已過時");
  });
});

describe("parsePrList / prStatusLine（L2）", () => {
  const mk = (o: Partial<PrDetail>): PrDetail => ({
    repo: "r",
    number: 1,
    title: "t",
    updatedAt: "",
    isDraft: false,
    reviewDecision: "",
    mergeable: "MERGEABLE",
    checks: [],
    ...o,
  });

  test("空 reviewDecision 是「沒人審」，不是「通過」—— 這個區分是雷達存在的理由", () => {
    expect(prStatusLine(mk({}))).toBe("沒人審，但可以併");
  });

  test("CI 失敗優先於其他狀態", () => {
    expect(prStatusLine(mk({ checks: [{ name: "ci", conclusion: "FAILURE" }] }))).toBe("CI 有 1 項沒過");
  });

  test("空 checks 陣列 = 沒有 CI，不是失敗", () => {
    expect(prStatusLine(mk({ checks: [] }))).not.toContain("沒過");
  });

  test("草稿最優先", () => {
    expect(prStatusLine(mk({ isDraft: true, checks: [{ name: "x", conclusion: "FAILURE" }] }))).toBe(
      "草稿，還在做"
    );
  });

  test("衝突 / 要求修改 / 已核准", () => {
    expect(prStatusLine(mk({ mergeable: "CONFLICTING" }))).toBe("跟主線衝突，要先解");
    expect(prStatusLine(mk({ reviewDecision: "CHANGES_REQUESTED" }))).toBe("有人要求修改");
    expect(prStatusLine(mk({ reviewDecision: "APPROVED" }))).toBe("已核准，可以併了");
  });

  test("parsePrList 讀 statusCheckRollup", () => {
    const raw = JSON.stringify([
      { number: 3, title: "x", updatedAt: "", isDraft: false, reviewDecision: "APPROVED", mergeable: "MERGEABLE", statusCheckRollup: [{ name: "build", conclusion: "SUCCESS" }] },
    ]);
    expect(parsePrList(raw, "o/r")[0]!.checks).toEqual([{ name: "build", conclusion: "SUCCESS" }]);
  });
});

describe("L3 折衷：產生 markdown，不執行 gh pr review", () => {
  test("核准：帶上審查者與撰寫者族系", () => {
    const md = reviewHandoffMarkdown({
      prRepo: "o/r",
      prNumber: 1,
      decision: "approved",
      reviewerName: "Scott",
      reviewerKind: "human",
      authorFamily: "claude",
    });
    expect(md).toContain("✅ 核准");
    expect(md).toContain("Scott（人員）");
    expect(md).toContain("撰寫者族系：claude");
    expect(md).toContain("本工具不代為執行");
  });

  test("同族系審查：markdown 自己標明此核准無效", () => {
    const md = reviewHandoffMarkdown({
      prRepo: "o/r",
      prNumber: 1,
      decision: "approved",
      reviewerName: "Claude",
      reviewerKind: "agent",
      reviewerFamily: "claude",
      authorFamily: "claude",
    });
    expect(md).toContain("同族系");
    expect(md).toContain("職務分離");
  });

  test("不同族系：不加警告", () => {
    const md = reviewHandoffMarkdown({
      prRepo: "o/r",
      prNumber: 1,
      decision: "approved",
      reviewerName: "Codex",
      reviewerKind: "agent",
      reviewerFamily: "codex",
      authorFamily: "claude",
    });
    expect(md).not.toContain("職務分離");
  });
});
