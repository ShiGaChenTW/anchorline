import { describe, expect, test } from "bun:test";
import { NO_SNAPSHOT, snapshotLine, type SnapshotState } from "../src/lib/snapshot-bridge";

/**
 * 這句話是兩頁共用的唯一文案。兩邊各寫一份的話會慢慢分岔，
 * 而症狀是同一個專案在 PRD 撰寫與 OpenSpec 入口顯示不同的狀態。
 */
const withReport = (over: Partial<SnapshotState> = {}): SnapshotState => ({
  ...NO_SNAPSHOT,
  required: true,
  at: new Date("2026-08-12T02:39:00Z"),
  name: "Project_HelmDeck-20260812-1039.md",
  bytes: 7_080_082,
  path: "/tmp/p/.anchorline/context/Project_HelmDeck-20260812-1039.md",
  stale: { commitsBehind: 0, ageMs: 0, stale: false },
  ...over,
});

describe("狀態文案", () => {
  test("有報告時一定帶大小 —— 那是「它真的產出來了」的證據", () => {
    // Scott 2026-08-12：掃描快到像是沒執行，只有檔名無法讓人相信它跑過
    const s = snapshotLine(withReport(), "剛剛");
    expect(s).toContain("6.8 MB");
    expect(s).toContain("Project_HelmDeck-20260812-1039.md");
  });

  test("落後時講得出落後幾筆 commit，並且仍然帶大小", () => {
    const s = snapshotLine(
      withReport({ stale: { commitsBehind: 4, ageMs: 0, stale: true } }),
      "3 天前",
    );
    expect(s).toContain("4 筆 commit");
    expect(s).toContain("6.8 MB");
    expect(s).toContain("重新分析");
  });

  test("沒有報告要說得出下一步是什麼", () => {
    expect(snapshotLine({ ...NO_SNAPSHOT, required: true }, "")).toContain("分析報告");
  });

  test("瀏覽器版講真正的原因，不假裝它是新專案", () => {
    // 一個綁好資料夾的專案被說成「新專案，沒有資料夾可讀」是假訊息
    const s = snapshotLine({ ...NO_SNAPSHOT, required: true, unavailable: true }, "");
    expect(s).toContain("瀏覽器版");
    expect(s).not.toContain("新專案");
  });

  test("新專案（沒綁資料夾）走問答，不談報告", () => {
    expect(snapshotLine(NO_SNAPSHOT, "")).toContain("問答");
  });

  test("全部文案都不再出現「快照」", () => {
    // 改名是 Scott 指定的（2026-08-12）。漏掉一句就會兩種叫法並存
    const all = [
      snapshotLine(NO_SNAPSHOT, ""),
      snapshotLine({ ...NO_SNAPSHOT, required: true }, ""),
      snapshotLine({ ...NO_SNAPSHOT, required: true, unavailable: true }, ""),
      snapshotLine(withReport(), "剛剛"),
      snapshotLine(withReport({ stale: { commitsBehind: 1, ageMs: 0, stale: true } }), "剛剛"),
    ];
    for (const line of all) expect(line).not.toContain("快照");
  });
});
