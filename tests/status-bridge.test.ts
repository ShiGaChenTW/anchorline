import { beforeEach, describe, expect, test } from "bun:test";
import { GH_REFRESH_MS, type GhResult } from "../src/lib/gh-status";
import { getGhStatusCached, invalidateGhCache } from "../src/lib/status-bridge";

const ok = (n: number): GhResult => ({
  available: true,
  prs: Array.from({ length: n }, (_, i) => ({
    repo: "o/r",
    number: i,
    title: "t",
    updatedAt: "2026-08-01T00:00:00Z",
  })),
  fetchedAt: "2026-08-09T10:00:00Z",
});

describe("GitHub 快取 —— 網路呼叫不進 1 秒迴圈", () => {
  beforeEach(() => invalidateGhCache());

  test("60 秒內重複呼叫只打一次 CLI", async () => {
    let calls = 0;
    const f = async () => {
      calls++;
      return ok(1);
    };
    await getGhStatusCached(1000, f);
    await getGhStatusCached(1000 + 30_000, f);
    await getGhStatusCached(1000 + 59_000, f);
    expect(calls).toBe(1);
  });

  test("超過 60 秒才重新打", async () => {
    let calls = 0;
    const f = async () => {
      calls++;
      return ok(calls);
    };
    await getGhStatusCached(0, f);
    await getGhStatusCached(GH_REFRESH_MS + 1, f);
    expect(calls).toBe(2);
  });

  test("同時發出的請求被去重 —— 否則三個元件會同時跑三個 gh", async () => {
    let calls = 0;
    const f = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return ok(1);
    };
    const [a, b, c] = await Promise.all([
      getGhStatusCached(0, f),
      getGhStatusCached(0, f),
      getGhStatusCached(0, f),
    ]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  test("失敗不寫快取 —— 下一輪要能重試，不是把錯誤黏 60 秒", async () => {
    let calls = 0;
    const f = async () => {
      calls++;
      if (calls === 1) throw new Error("找不到 gh");
      return ok(2);
    };
    const first = await getGhStatusCached(0, f);
    expect(first).toEqual({ available: false, reason: "找不到 gh" });
    const second = await getGhStatusCached(1, f);
    expect(second.available).toBe(true);
    expect(calls).toBe(2);
  });

  test("手動刷新會清掉快取", async () => {
    let calls = 0;
    const f = async () => {
      calls++;
      return ok(1);
    };
    await getGhStatusCached(0, f);
    invalidateGhCache();
    await getGhStatusCached(1, f);
    expect(calls).toBe(2);
  });
});
