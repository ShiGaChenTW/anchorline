/**
 * 測試版種子帶一個本機 CLI 後端；**正式版不得帶**。
 *
 * 方向搞反的代價不對稱：測試版少帶只是 UAT 要多按兩下；正式版多帶，
 * 是在別人的機器上預設綁一個那台機器沒有的 CLI —— 出廠即故障，
 * 而使用者從沒設定過任何東西，看不出那個警告是哪來的。
 *
 * 用 source-grep 盯 APP_VARIANT 閘門：`bun test` 跑的是 prod 變體，
 * 執行期只驗得到一半，而漏掉的正好是危險的那一半。
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const SEED_SRC = readFileSync(new URL("../src/data/seed.ts", import.meta.url), "utf8");

describe("SEED_BACKENDS", () => {
  test("由 APP_VARIANT 閘住，不是無條件給", () => {
    const block = SEED_SRC.slice(SEED_SRC.indexOf("export const SEED_BACKENDS"));
    expect(block.slice(0, 300)).toContain('APP_VARIANT === "test"');
  });

  test("正式版那一支是空陣列", () => {
    const block = SEED_SRC.slice(SEED_SRC.indexOf("export const SEED_BACKENDS"));
    // 三元的 false 分支
    expect(block.slice(0, 400)).toMatch(/:\s*\[\]/);
  });

  test("預載的工具在 CLI 白名單裡 —— 種子不能繞過白名單", async () => {
    const { CLI_TOOLS } = await import("../src/lib/agent-backend");
    const tools = [...SEED_SRC.matchAll(/tool:\s*"([a-z]+)"/g)].map((m) => m[1]!);
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) expect(CLI_TOOLS as readonly string[]).toContain(t);
  });

  test("**每一隻**示範 agent 都綁了後端 —— 漏綁一隻的症狀是那條路照樣打 API", async () => {
    const { SEED_EMPLOYEES_DEMO } = await import("../src/data/seed");
    const agents = SEED_EMPLOYEES_DEMO.filter((e) => e.kind === "agent");
    expect(agents.length).toBeGreaterThan(1);
    const unbound = agents.filter((a) => !a.backendId).map((a) => a.id);
    expect(unbound).toEqual([]);
  });

  test("綁的 id 就是種子裡真的存在的那一個", () => {
    const ids = [...SEED_SRC.matchAll(/backendId:\s*"([\w-]+)"/g)].map((m) => m[1]!);
    const declared = SEED_SRC.match(/const DEMO_CLI_BACKEND_ID = "([\w-]+)"/)?.[1];
    expect(declared).toBeTruthy();
    for (const id of ids) expect(id).toBe(declared);
    expect(SEED_SRC).toContain(`id: "${declared}"`);
  });

  test("正式版的 starter agents 不帶後端綁定", () => {
    const block = SEED_SRC.slice(SEED_SRC.indexOf("export function buildStarterAgents"));
    expect(block.slice(0, 600)).toContain("backendId: undefined");
  });
});
