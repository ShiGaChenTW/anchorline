import { describe, expect, test } from "bun:test";
import { formatLastUpdate } from "../src/lib/time-format";

/**
 * 側欄清單的重畫守衛。
 *
 * 這個測試守的是一個真的發生過的迴歸：簽章原本用 lastFileAt（ISO 時間戳），
 * 而 touchProjectMeta 在每一次 setSectionField 都會把它設成 nowIso() ——
 * 在編輯台打一個字簽章就變一次，守衛形同虛設。
 *
 * 規則：簽章只能由「畫面上看得到的值」組成。
 */
function sigOf(p: { id: string; name: string; status: string; stamp: string }) {
  return `${p.id}:${p.name}:${p.status}:${formatLastUpdate(p.stamp)}`;
}

describe("側欄簽章", () => {
  const base = { id: "p1", name: "結帳改版", status: "draft" };

  test("同一分鐘內連打數十下，簽章不變", () => {
    const t0 = Date.now();
    const sigs = new Set<string>();
    for (let i = 0; i < 50; i++) {
      // 模擬每次按鍵把 lastFileAt 推進幾十毫秒
      sigs.add(sigOf({ ...base, stamp: new Date(t0 + i * 40).toISOString() }));
    }
    expect(sigs.size).toBe(1);
  });

  test("改用原始時間戳的話會每次都變 —— 這就是原本的 bug", () => {
    const t0 = Date.now();
    const raw = new Set<string>();
    for (let i = 0; i < 50; i++) raw.add(new Date(t0 + i * 40).toISOString());
    expect(raw.size).toBe(50);
  });

  test("改名要讓簽章變", () => {
    const s = new Date().toISOString();
    expect(sigOf({ ...base, stamp: s })).not.toBe(sigOf({ ...base, name: "新名字", stamp: s }));
  });

  test("狀態改變要讓簽章變", () => {
    const s = new Date().toISOString();
    expect(sigOf({ ...base, stamp: s })).not.toBe(sigOf({ ...base, status: "review", stamp: s }));
  });

  test("跨過一小時的顯示分界要讓簽章變", () => {
    const now = Date.now();
    const a = sigOf({ ...base, stamp: new Date(now - 5 * 60_000).toISOString() });
    const b = sigOf({ ...base, stamp: new Date(now - 3 * 3600_000).toISOString() });
    expect(a).not.toBe(b);
  });
});
