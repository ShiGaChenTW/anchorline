/**
 * C2 —— `normalizeAgentFamily` 不再 fail open。
 *
 * 舊版是 `family ?? "other"`：只補了 null，**沒有檢查成員資格**。型別上看起來
 * 安全，但這支的呼叫端吃的是 localStorage 與匯入備份裡的字串 —— 型別在那裡
 * 是一句宣稱，不是保證。
 *
 * 一個手改出來的 `"Pi"`（大小寫差一個字）會原封不動穿過去，變成一個只有它
 * 自己屬於的「族系」。族系隔離閘門用 `===` 比字串，於是它跟誰都不同族，
 * **「同一種 Agent 已撰寫此文件、不得由同族核准」這條規則對它完全失效**。
 * 而它沒有畫面症狀：使用者只看到核准成功了。
 *
 * 方向很重要。收斂成 `other` 的代價是一群不同的髒值被判成同族而互相擋掉 ——
 * 那是**過度攔截**，使用者看得到、講得出來、改得掉。反方向沒有症狀。
 */
import { describe, expect, test } from "bun:test";
import { normalizeAgentFamily } from "../src/lib/permissions";
import { AGENT_FAMILIES, isAgentFamily } from "../src/data/types";
import type { AgentFamily } from "../src/data/types";

describe("C2 —— 非聯集成員一律收斂成 other", () => {
  // 全部走 `as never`：型別本來就不該讓這些值進來，這裡模擬的是
  // 繞過型別的那條路（localStorage／匯入的備份）。
  const dirty = ["Pi", "PI", "Claude", "claude ", " grok", "openai", "", "自己打的字"];

  for (const v of dirty) {
    test(`「${v}」→ other`, () => {
      expect(normalizeAgentFamily("agent", v as never)).toBe("other");
    });
  }

  test("null / undefined 仍然是 other（舊行為不變）", () => {
    expect(normalizeAgentFamily("agent", null)).toBe("other");
    expect(normalizeAgentFamily("agent", undefined)).toBe("other");
  });

  test("合法成員原樣通過 —— 收斂不可以誤傷真的族系", () => {
    for (const f of AGENT_FAMILIES) {
      expect(normalizeAgentFamily("agent", f)).toBe(f);
    }
  });

  test("非 agent 一律 null（這條沒動）", () => {
    expect(normalizeAgentFamily("human", "claude")).toBeNull();
    expect(normalizeAgentFamily("human", "Pi" as never)).toBeNull();
  });

  /**
   * 這條是整組的重點：兩個不同的髒值收斂後**必須相等**，
   * 因為族系隔離靠 `===`。收斂前它們是兩個互不相同的「族系」，
   * 於是同一個被手改過的 agent 可以核准自己寫的文件。
   */
  test("兩個不同的髒值收斂後相等 —— 隔離閘門才擋得住", () => {
    const a = normalizeAgentFamily("agent", "Pi" as never);
    const b = normalizeAgentFamily("agent", "pi " as never);
    expect(a).toBe(b);
    expect(a).toBe("other");
  });
});

describe("isAgentFamily —— 名冊從標籤表推導，不另抄一份", () => {
  test("聯集成員回 true", () => {
    for (const f of AGENT_FAMILIES) expect(isAgentFamily(f)).toBe(true);
  });

  test("非字串與聯集外的字串回 false", () => {
    for (const v of ["Pi", "", " claude", 1, null, undefined, {}, ["claude"]]) {
      expect(isAgentFamily(v)).toBe(false);
    }
  });

  test("Object.prototype 上的名字不算族系", () => {
    for (const k of ["toString", "constructor", "hasOwnProperty"]) {
      expect(isAgentFamily(k)).toBe(false);
    }
  });

  test("名冊涵蓋每一個標籤，數量對得上", () => {
    const fromLabels: AgentFamily[] = [
      "claude",
      "codex",
      "grok",
      "pi",
      "hermes",
      "agy",
      "gpt",
      "gemini",
      "local",
      "other",
    ];
    expect([...AGENT_FAMILIES].sort()).toEqual(fromLabels.sort());
  });
});
