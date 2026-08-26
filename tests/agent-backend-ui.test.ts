/**
 * W4 —— 兩張清單的顯示邏輯。
 *
 * 這一層拆出來的理由不是好看，是可測。這兩張清單真正會出錯的地方全部是純
 * 資料轉換，而留在 `innerHTML` 樣板裡的話只能靠人開 App 用眼睛看：
 *
 *   1. **金鑰有沒有外洩到畫面上** —— 這是派工單的硬性約束，也是這支測試最重要的一條
 *   2. CLI 偵測不到時說了什麼（使用者要知道「按下去會失敗」）
 *   3. 綁定值與實際解析結果不一致時有沒有講出來
 *
 * 純函式：不碰 DOM、不碰 store、不碰 `native`，探測結果由參數餵進來。
 */
import { describe, expect, test } from "bun:test";
import {
  backendBinding,
  backendRow,
  cliProbe,
  cliProbeNote,
  keyStateLabel,
} from "../src/lib/agent-backend-ui";
import type { AgentBackend, ApiBackend } from "../src/data/types";

const SECRET = "sk-live-CANARY-3QX7ZP-do-not-render";

const apiBackend: ApiBackend = {
  id: "openrouter-backup",
  label: "備援 OpenRouter",
  kind: "api",
  provider: "openrouter",
  model: "anthropic/claude-sonnet-4.5",
  endpoint: "https://openrouter.ai/api/v1",
  apiKey: SECRET,
};

const cliBackend: AgentBackend = {
  id: "local-claude",
  label: "本機 Claude",
  kind: "cli",
  tool: "claude",
};

const defaultBackend: ApiBackend = {
  id: "default",
  label: "預設（OpenRouter／gpt-5.1）",
  kind: "api",
  provider: "openrouter",
  model: "gpt-5.1",
  endpoint: "https://openrouter.ai/api/v1",
  apiKey: SECRET,
};

/* ─── 硬性約束：金鑰不進畫面 ───────────────────────────────── */

describe("金鑰永遠不出現在回傳值裡（硬性約束）", () => {
  /**
   * 用 canary 而不是檢查「有沒有 apiKey 欄位」：後者只擋得住直接複製欄位，
   * 擋不住把金鑰拼進 detail 或 label 這種真的會發生的寫法。
   * 整個回傳值序列化之後搜字串，是唯一涵蓋得到全部路徑的驗法。
   */
  test("backendRow：整個回傳值序列化後不含金鑰", () => {
    for (const b of [apiBackend, defaultBackend]) {
      const row = backendRow(b, { claude: "/usr/local/bin/claude" }, true);
      expect(JSON.stringify(row)).not.toContain(SECRET);
      expect(JSON.stringify(row)).not.toContain("sk-live");
    }
  });

  test("backendRow：只講金鑰的狀態，連長度都不給", () => {
    const set = backendRow(apiBackend, null, true);
    expect(set.keyState).toBe("set");
    const unset = backendRow({ ...apiBackend, apiKey: "   " }, null, true);
    expect(unset.keyState).toBe("unset");
    // 狀態字串本身也不可以洩漏長度之類的線索
    expect(keyStateLabel("set")).not.toContain(String(SECRET.length));
    expect(JSON.stringify(unset)).not.toContain(SECRET);
  });

  test("CLI 後端沒有金鑰欄位，keyState 是 null 不是空字串", () => {
    expect(backendRow(cliBackend, null, true).keyState).toBeNull();
  });

  test("backendBinding：選項與警告都不含金鑰", () => {
    const list = [defaultBackend, apiBackend, cliBackend];
    const bound = backendBinding("openrouter-backup", list, apiBackend);
    expect(JSON.stringify(bound)).not.toContain(SECRET);
    const stale = backendBinding("deleted-one", list, defaultBackend);
    expect(JSON.stringify(stale)).not.toContain(SECRET);
  });
});

/* ─── CLI 偵測 ─────────────────────────────────────────────── */

describe("cliProbe —— 四種狀態要分得開", () => {
  /**
   * 四種分開是因為使用者要做的事完全不同：瀏覽器要去開桌面版、missing 要去裝
   * 或指路徑、pending 只要等。併成一個 boolean 的話 UI 只能說「不可用」，
   * 而那句話沒有告訴任何人下一步。
   */
  test("非桌面版 → unsupported（連探測都不該跑）", () => {
    expect(cliProbe("claude", null, false)).toEqual({ state: "unsupported" });
    // 就算探測結果不知怎地有值，非 native 仍然是 unsupported
    expect(cliProbe("claude", { claude: "/bin/claude" }, false).state).toBe("unsupported");
  });

  test("桌面版但結果還沒回來 → pending", () => {
    expect(cliProbe("claude", null, true)).toEqual({ state: "pending" });
  });

  test("找到 → found，帶著路徑", () => {
    expect(cliProbe("claude", { claude: "/opt/homebrew/bin/claude" }, true)).toEqual({
      state: "found",
      path: "/opt/homebrew/bin/claude",
    });
  });

  test("探測回來但沒有這個工具 → missing（不是 pending）", () => {
    expect(cliProbe("grok", { claude: "/bin/claude", grok: null }, true)).toEqual({
      state: "missing",
    });
    // 鍵根本不存在也是 missing —— 卡在 pending 會讓使用者等一個不會來的答案
    expect(cliProbe("agy", {}, true)).toEqual({ state: "missing" });
  });
});

describe("cliProbeNote —— 每種狀態都要講得出下一步", () => {
  test("missing 要明說「現在按下去會失敗」", () => {
    const note = cliProbeNote({ state: "missing" }, "grok");
    expect(note).toContain("grok");
    expect(note).toContain("失敗");
    expect(note).toContain("路徑");
  });

  test("unsupported 要說是桌面版的事，不是「不可用」了事", () => {
    expect(cliProbeNote({ state: "unsupported" }, "claude")).toContain("桌面版");
  });

  test("found 要把路徑講出來（使用者才知道抓到的是哪一個）", () => {
    expect(cliProbeNote({ state: "found", path: "/x/y/claude" }, "claude")).toContain("/x/y/claude");
  });

  test("四種都給得出非空字串", () => {
    const all = [
      { state: "unsupported" },
      { state: "pending" },
      { state: "found", path: "/p" },
      { state: "missing" },
    ] as const;
    for (const p of all) expect(cliProbeNote(p, "pi").length).toBeGreaterThan(0);
  });
});

/* ─── 清單列 ───────────────────────────────────────────────── */

describe("backendRow —— default 是投影，不是清單裡的一筆", () => {
  test("default：不可改名、不可刪除，而且要說明它是什麼", () => {
    const r = backendRow(defaultBackend, null, true);
    expect(r.isDefault).toBe(true);
    expect(r.canRename).toBe(false);
    expect(r.canDelete).toBe(false);
    expect(r.badge).toContain("預設");
    expect(r.badge).toContain("投影");
  });

  test("其他後端可改名、可刪除，沒有徽章", () => {
    for (const b of [apiBackend, cliBackend]) {
      const r = backendRow(b, null, true);
      expect(r.isDefault).toBe(false);
      expect(r.canRename).toBe(true);
      expect(r.canDelete).toBe(true);
      expect(r.badge).toBeNull();
    }
  });

  test("CLI 後端的細節就是偵測結果 —— 偵測不到要在清單上直接看得到", () => {
    const r = backendRow(cliBackend, { claude: null }, true);
    expect(r.kindLabel).toBe("CLI");
    expect(r.detail).toContain("找不到");
  });

  test("API 後端沒填端點時講「用通路預設」，不是空白", () => {
    const r = backendRow({ ...apiBackend, endpoint: "  " }, null, true);
    expect(r.kindLabel).toBe("API");
    expect(r.detail.trim().length).toBeGreaterThan(0);
  });
});

/* ─── agents 頁的綁定 ──────────────────────────────────────── */

describe("backendBinding —— 綁定值與實際解析結果不一致時要講", () => {
  const list = [defaultBackend, apiBackend, cliBackend];

  test("沒綁 → 選「跟隨預設」，沒有警告", () => {
    const b = backendBinding(undefined, list, defaultBackend);
    expect(b.options[0]!.selected).toBe(true);
    expect(b.options[0]!.value).toBe("");
    expect(b.warning).toBeNull();
    expect(b.resolvedLabel).toContain("預設");
  });

  test("綁一個存在的後端 → 那一項被選中，沒有警告", () => {
    const b = backendBinding("local-claude", list, cliBackend);
    const hit = b.options.find((o) => o.value === "local-claude");
    expect(hit?.selected).toBe(true);
    expect(b.options[0]!.selected).toBe(false);
    expect(b.warning).toBeNull();
  });

  /**
   * 這條是這一組的重點。`removeBackend` 擋得住「還被綁著就刪」，但匯入備份
   * 繞得過去。`resolveBackend` 會安靜地回退到 default —— **安靜正是問題**：
   * 使用者以為自己在跑本機 CLI，實際上在燒 API 額度，而那種錯誤沒有畫面
   * 症狀，月底看帳單才會發現。
   */
  test("綁的後端已不存在 → 有警告，而且說得出實際在跑哪一個", () => {
    const b = backendBinding("deleted-backend", list, defaultBackend);
    expect(b.warning).not.toBeNull();
    expect(b.warning).toContain("deleted-backend");
    expect(b.warning).toContain("不存在");
    expect(b.resolvedLabel).toBe("預設（OpenRouter／gpt-5.1）");
  });

  test("綁的後端已不存在時，選中的是「跟隨預設」—— 那才是實際發生的事", () => {
    const b = backendBinding("deleted-backend", list, defaultBackend);
    expect(b.options[0]!.selected).toBe(true);
    // 死掉的 id 不可以出現成一個看起來還活著的選項
    expect(b.options.some((o) => o.value === "deleted-backend")).toBe(false);
  });

  test("下拉不重複列出 default —— 它已經是第一項「跟隨預設」了", () => {
    const b = backendBinding(null, list, defaultBackend);
    expect(b.options.filter((o) => o.value === "default")).toHaveLength(0);
    expect(b.options).toHaveLength(3); // 跟隨預設 + 兩個自訂後端
  });

  test("選項標示 API／CLI —— 使用者要看得出自己綁的是哪一條通路", () => {
    const b = backendBinding(null, list, defaultBackend);
    expect(b.options.find((o) => o.value === "local-claude")?.label).toContain("CLI");
    expect(b.options.find((o) => o.value === "openrouter-backup")?.label).toContain("API");
  });

  test("空字串綁定等同沒綁（trim 過的空白也是）", () => {
    for (const v of ["", "   ", null, undefined]) {
      const b = backendBinding(v, list, defaultBackend);
      expect(b.warning).toBeNull();
      expect(b.options[0]!.selected).toBe(true);
    }
  });
});
