/**
 * SPEC-live-tracking.md §8 的 11 個必要案例。
 *
 * 原 repo 對這個函式有 0 個測試；spec 明說移植時該表是待補清單而非既有成果。
 * 全部只碰記憶體裡的 snapshot —— 沒有臨時目錄、沒有系統時鐘、碰不到使用者真實檔案。
 *
 * 放 tests/ 而不是 src/ 是因為 tsconfig 的 include 是 `src/**`，
 * 擺進去會讓 `bun run typecheck` 要求 @types/bun 才過。
 */
import { describe, expect, test } from "bun:test";
import {
  FRESHNESS_WINDOW_MS,
  sortByRecency,
  trackingTarget,
  type TrackingSnapshot,
} from "../src/lib/tracking";

const NOW = 1_000_000_000_000;

const A_ONE = "/a/plans/one.md";
const A_TWO = "/a/plans/two.md"; // 全域 mtime 最新
const B_X = "/b/plans/x.md";

const FILES = [
  { path: A_ONE, mtimeMs: NOW - 30_000 },
  { path: A_TWO, mtimeMs: NOW - 1_000 },
  { path: B_X, mtimeMs: NOW - 10_000 },
];

/** 預設訊號是新鮮的；各案例只覆寫 raw */
function snap(raw?: string, signalAgeMs = 0): TrackingSnapshot {
  return {
    files: FILES,
    signal: raw === undefined ? null : { raw, mtimeMs: NOW - signalAgeMs },
  };
}

describe("trackingTarget — spec §8", () => {
  test("1. 訊號檔不存在 → 退回 mtime 最新", () => {
    expect(trackingTarget({ files: FILES }, NOW)).toBe(A_TWO);
    expect(trackingTarget(snap(), NOW)).toBe(A_TWO);
  });

  test("2. 訊號新鮮 + 指向存在的 .md → 回傳該檔", () => {
    // 刻意選「不是最新」的那個，證明段 1 真的贏過段 2
    expect(trackingTarget(snap(A_ONE), NOW)).toBe(A_ONE);
  });

  test("3. 訊號新鮮 + 指向專案根目錄 → 該專案 plans/ 內最新 .md", () => {
    expect(trackingTarget(snap("/b"), NOW)).toBe(B_X);
    expect(trackingTarget(snap("/a"), NOW)).toBe(A_TWO);
  });

  test("4. 訊號新鮮 + 指向 plans/ 目錄 → 同上，不重複附加 plans", () => {
    expect(trackingTarget(snap("/b/plans"), NOW)).toBe(B_X);
    expect(trackingTarget(snap("/b/plans/"), NOW)).toBe(B_X);
  });

  test("5. 訊號 mtime 超過 30 分鐘 → 忽略訊號，退回 mtime 最新", () => {
    expect(trackingTarget(snap(A_ONE, FRESHNESS_WINDOW_MS + 1), NOW)).toBe(A_TWO);
    // 邊界：剛好 30 分鐘仍算新鮮
    expect(trackingTarget(snap(A_ONE, FRESHNESS_WINDOW_MS), NOW)).toBe(A_ONE);
  });

  test("6. 訊號新鮮但路徑已不存在 → 退回 mtime 最新", () => {
    expect(trackingTarget(snap("/a/plans/deleted.md"), NOW)).toBe(A_TWO);
  });

  test("7. 訊號內容為空／全空白 → 退回 mtime 最新", () => {
    expect(trackingTarget(snap(""), NOW)).toBe(A_TWO);
    expect(trackingTarget(snap("   \n/b\n"), NOW)).toBe(A_TWO);
  });

  test("8. 訊號指向的目錄內無 .md → 退回 mtime 最新", () => {
    // 段 1 沒有「我決定是 null」的表達能力，只能說「我沒答案」→ 穿透段 2
    expect(trackingTarget(snap("/c"), NOW)).toBe(A_TWO);
  });

  test("9. 訊號指向存在但非 .md 的檔案 → 退回 mtime 最新", () => {
    expect(trackingTarget(snap("/a/plans/notes.txt"), NOW)).toBe(A_TWO);
  });

  test("10. 監看清單為空且無有效訊號 → null", () => {
    expect(trackingTarget({ files: [] }, NOW)).toBe(null);
    expect(trackingTarget({ files: [], signal: { raw: "/a", mtimeMs: NOW } }, NOW)).toBe(null);
  });

  test("11. 監看清單含已刪除的檔 → 跳過該檔，不影響其他", () => {
    // 讀不到 mtime 的項目：readdir 與 stat 之間被刪掉的競態
    const withGhost = {
      files: [{ path: "/a/plans/ghost.md", mtimeMs: NaN }, ...FILES],
    };
    expect(trackingTarget(withGhost, NOW)).toBe(A_TWO);
    expect(sortByRecency(withGhost.files).map((f) => f.path)).toEqual([A_TWO, B_X, A_ONE]);
  });
});

describe("trackingTarget — 額外防呆", () => {
  test("多行訊號只取第一行", () => {
    expect(trackingTarget(snap(`${A_ONE}\n/b\n垃圾`), NOW)).toBe(A_ONE);
  });

  test("訊號 mtime 不是數字 → 當作沒有訊號", () => {
    const s: TrackingSnapshot = { files: FILES, signal: { raw: A_ONE, mtimeMs: NaN } };
    expect(trackingTarget(s, NOW)).toBe(A_TWO);
  });

  test("段 1 的目錄分支不會跨層誤抓子目錄的檔", () => {
    const nested = {
      files: [{ path: "/a/plans/sub/deep.md", mtimeMs: NOW }, ...FILES],
    };
    // /a/plans 只認直屬檔案（非遞迴，同 spec §6 的 watch 語意）
    expect(trackingTarget({ ...nested, signal: { raw: "/a", mtimeMs: NOW } }, NOW)).toBe(A_TWO);
  });

  test("純函式：不修改傳入的 files", () => {
    const files = [...FILES];
    trackingTarget({ files }, NOW);
    expect(files).toEqual(FILES);
  });
});
