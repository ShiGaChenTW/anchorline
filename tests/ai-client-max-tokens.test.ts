/**
 * 每一條 provider 通路都要送 `max_tokens`。
 *
 * 不送的代價不是「回應可以更長」，而是**額度預授權按模型上限算**。
 * 2026-08-27 實測 OpenRouter 回：
 *   402 … You requested up to 65536 tokens, but can only afford 24775
 * 使用者的餘額跑一次正常回應綽綽有餘，卻被一個從來不打算用到的天花板擋死。
 *
 * 這支用 source-grep 而不是打真的 HTTP：要盯的是「**每一個** request body
 * 都帶了這個欄位」這個形狀，而形狀用 mock 一條一條測，反而容易漏掉新加的那條
 * —— 漏掉的那條沒有測試會紅，症狀是某個 provider 上的 402。
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../src/lib/ai-client.ts", import.meta.url), "utf8");

/** `model,` 開頭到對應 `messages:` 之間就是一個 request body 的欄位區 */
function requestBodies(): string[] {
  const out: string[] = [];
  const re = /JSON\.stringify\(\{([\s\S]*?)messages:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(SRC))) out.push(m[1]!);
  return out;
}

describe("ai-client 的 request body", () => {
  test("找得到多條 provider 通路 —— 這支測的前提", () => {
    expect(requestBodies().length).toBeGreaterThanOrEqual(3);
  });

  test("每一條都送 max_tokens", () => {
    const missing = requestBodies().filter((b) => !/max_tokens/.test(b));
    expect(missing).toEqual([]);
  });

  test("送的是常數，不是各寫各的字面值", () => {
    expect(SRC).toContain("const MAX_TOKENS =");
    // 字面值只准出現在常數宣告那一行
    const literals = SRC.match(/max_tokens:\s*\d+/g) ?? [];
    expect(literals).toEqual([]);
  });
});
