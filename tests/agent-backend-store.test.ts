/**
 * 後端清單的 **store 面**——也就是生產環境真正會被呼叫到的那一層。
 *
 * 上一批的 F0（`applyFullTemplate` 加了第四個參數，只有測試在傳）教的事是：
 * 純函式全綠不代表功能存在。所以這支測的全部是 `store.*` 方法本身，
 * 加上兩條 source-grep 形狀防護，盯住 `load()` / `importState()` 有沒有真的
 * 接上 migration —— 那兩條路只在模組第一次 import 時跑，測試共用進程搶不到
 * 那個時機（見 `version-policy-reload.test.ts` 檔頭），只能用形狀盯。
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

// 領域包目錄用 `import.meta.glob`（Vite 專屬），bun 跑不動 —— 換成通用領域。
mock.module("../src/data/domains", () => ({
  BUILTIN_PACKS: {},
  builtinSource: () => null,
  reloadUserPacks: () => {},
  domainPacks: () => ({}),
  isUserPack: () => false,
  listDomains: () => [],
  DEFAULT_DOMAIN: "generic",
}));

// store 在 import 時就會讀 localStorage —— 先塞一個最小的實作進去
const mem = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage ??= {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
};

const { store } = await import("../src/data/store");
const { DEFAULT_BACKEND_ID } = await import("../src/lib/agent-backend");
const STORE_SRC = readFileSync(new URL("../src/data/store.ts", import.meta.url), "utf8");

/**
 * id 一律帶檔名前綴 —— `bun test` 把所有檔跑在同一個 process 裡，store 是單例。
 */
const A1 = "abw1-agent-one";
const A2 = "abw1-agent-two";
const HUMAN = "abw1-human";

// 這支會動到全域 AI 設定（default 後端是從它推導的）。跑完還原，
// 不然共用同一個 store 的其他測試檔會拿到被我改過的金鑰。
const ORIGINAL_SETTINGS = structuredClone(store.get().settings);

function ensureEmployee(e: Record<string, unknown>) {
  if (!store.get().employees.some((x) => x.id === e.id)) store.addEmployee(e as never);
}

beforeAll(() => {
  ensureEmployee({
    id: A1,
    name: "後端測試 Agent 一號",
    kind: "agent",
    accessRole: "editor",
    agentFamily: "claude",
    active: true,
    agentEnabled: true,
  });
  ensureEmployee({
    id: A2,
    name: "後端測試 Agent 二號",
    kind: "agent",
    accessRole: "editor",
    agentFamily: "codex",
    active: true,
    agentEnabled: true,
  });
  ensureEmployee({
    id: HUMAN,
    name: "後端測試真人",
    kind: "human",
    accessRole: "editor",
    active: true,
  });
  store.updateSettings({ backends: [] });
});

afterAll(() => {
  store.updateSettings(ORIGINAL_SETTINGS);
  for (const id of [A1, A2]) store.setAgentBackend(id, null);
});

describe("store.listBackends / resolveBackend", () => {
  test("清單第一筆永遠是 default", () => {
    expect(store.listBackends()[0]?.id).toBe(DEFAULT_BACKEND_ID);
  });

  test("沒綁後端的 agent 解析到 default", () => {
    expect(store.resolveBackend(A1).id).toBe(DEFAULT_BACKEND_ID);
  });

  /**
   * 這條是「default 不落地存進 backends」的生產面證據：
   * 使用者在設定頁改了金鑰，agent 下一次呼叫就必須拿到新的那把。
   * 若 default 是存下來的副本，這裡會拿到舊金鑰，而畫面上完全看不出差別。
   */
  test("改了全域金鑰，default 後端立刻跟著變", () => {
    store.updateSettings({ apiKey: "sk-abw1-new" });
    const b = store.resolveBackend(A1);
    expect(b.kind).toBe("api");
    if (b.kind !== "api") throw new Error("unreachable");
    expect(b.apiKey).toBe("sk-abw1-new");
  });
});

describe("store.addBackend", () => {
  test("加得進去，而且出現在清單裡", () => {
    const r = store.addBackend({ id: "abw1-cli", label: "本機 grok", kind: "cli", tool: "grok" });
    expect(r.ok).toBe(true);
    expect(store.listBackends().map((b) => b.id)).toContain("abw1-cli");
    // 真的寫進 settings，不是只活在記憶體衍生值裡
    expect(store.get().settings.backends?.some((b) => b.id === "abw1-cli")).toBe(true);
  });

  test("id 重複擋下來", () => {
    const r = store.addBackend({ id: "abw1-cli", label: "又一個", kind: "cli", tool: "claude" });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("abw1-cli");
  });

  test("id 用保留字 default 擋下來", () => {
    const r = store.addBackend({ id: "default", label: "假的", kind: "cli", tool: "claude" });
    expect(r.ok).toBe(false);
  });

  test("空白 id 擋下來", () => {
    expect(store.addBackend({ id: "   ", label: "", kind: "cli", tool: "claude" }).ok).toBe(false);
  });

  test("非白名單的 CLI 工具擋下來 —— 這個欄位最後會走到原生執行路徑", () => {
    const r = store.addBackend({
      id: "abw1-evil",
      label: "",
      kind: "cli",
      tool: "sh" as never,
    });
    expect(r.ok).toBe(false);
    expect(store.listBackends().map((b) => b.id)).not.toContain("abw1-evil");
  });
});

describe("store.updateBackend", () => {
  test("改得動自訂後端", () => {
    expect(store.updateBackend("abw1-cli", { label: "改過的名字", tool: "agy" }).ok).toBe(true);
    const b = store.listBackends().find((x) => x.id === "abw1-cli")!;
    expect(b.label).toBe("改過的名字");
    expect(b.kind === "cli" && b.tool).toBe("agy");
  });

  test("改到不存在的 id 回 ok:false", () => {
    expect(store.updateBackend("ghost", { label: "x" }).ok).toBe(false);
  });

  test("非白名單工具改不進去", () => {
    expect(store.updateBackend("abw1-cli", { tool: "bash" as never }).ok).toBe(false);
    // `codex` / `hermes` 2026-08-26 實測出局，現在跟 `bash` 同一個待遇 ——
    // 前端擋不住的東西後端要擋得住，而這裡是前端這一關
    expect(store.updateBackend("abw1-cli", { tool: "codex" as never }).ok).toBe(false);
    expect(store.updateBackend("abw1-cli", { tool: "hermes" as never }).ok).toBe(false);
    expect((store.listBackends().find((x) => x.id === "abw1-cli") as { tool: string }).tool).toBe("agy");
  });

  /** default 是全域設定的投影 —— 改它就是改全域，不另存一份 */
  test("改 default 會寫回全域設定", () => {
    expect(store.updateBackend(DEFAULT_BACKEND_ID, { model: "abw1-model", temperature: 0.1 }).ok).toBe(true);
    expect(store.get().settings.model).toBe("abw1-model");
    expect(store.get().settings.temperature).toBe(0.1);
    expect(store.get().settings.backends?.some((b) => b.id === DEFAULT_BACKEND_ID)).toBe(false);
  });

  test("default 不能被改成 cli 後端", () => {
    expect(store.updateBackend(DEFAULT_BACKEND_ID, { tool: "claude" }).ok).toBe(false);
  });
});

describe("store.setAgentBackend", () => {
  test("綁得上，解析結果跟著換", () => {
    expect(store.setAgentBackend(A1, "abw1-cli").ok).toBe(true);
    expect(store.resolveBackend(A1).id).toBe("abw1-cli");
    expect(store.get().employees.find((e) => e.id === A1)?.backendId).toBe("abw1-cli");
  });

  test("綁到不存在的後端擋下來 —— 不製造懸空 id", () => {
    const r = store.setAgentBackend(A2, "ghost");
    expect(r.ok).toBe(false);
    expect(store.get().employees.find((e) => e.id === A2)?.backendId).toBeUndefined();
  });

  test("真人帳號不能綁後端", () => {
    expect(store.setAgentBackend(HUMAN, "abw1-cli").ok).toBe(false);
  });

  test("傳 null 清掉綁定，回到 default", () => {
    expect(store.setAgentBackend(A1, null).ok).toBe(true);
    expect(store.resolveBackend(A1).id).toBe(DEFAULT_BACKEND_ID);
  });
});

describe("store.removeBackend —— 刪除守門", () => {
  test("還有 agent 綁著就擋下來，而且訊息說得出是哪幾個", () => {
    store.setAgentBackend(A1, "abw1-cli");
    store.setAgentBackend(A2, "abw1-cli");
    const r = store.removeBackend("abw1-cli");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("後端測試 Agent 一號");
    expect(r.reason).toContain("後端測試 Agent 二號");
    // 擋下來就是真的沒刪掉
    expect(store.listBackends().map((b) => b.id)).toContain("abw1-cli");
  });

  test("解除綁定之後刪得掉", () => {
    store.setAgentBackend(A1, null);
    store.setAgentBackend(A2, null);
    expect(store.removeBackend("abw1-cli").ok).toBe(true);
    expect(store.listBackends().map((b) => b.id)).not.toContain("abw1-cli");
  });

  test("default 不可刪 —— 它是所有回退的終點", () => {
    const r = store.removeBackend(DEFAULT_BACKEND_ID);
    expect(r.ok).toBe(false);
    expect(store.listBackends()[0]?.id).toBe(DEFAULT_BACKEND_ID);
  });

  test("刪不存在的 id 回 ok:false", () => {
    expect(store.removeBackend("ghost").ok).toBe(false);
  });
});

/**
 * F0 形狀防護。收斂函式存在、但 `load()` / `importState()` 沒接上，
 * 等於什麼都沒做 —— 而且沒有任何畫面症狀：手改過的 localStorage 會直接
 * 變成清單裡一筆合法後端。
 */
describe("migration 真的接在兩條讀取路徑上", () => {
  test("load() 與 importState() 都呼叫了 withMigratedBackends", () => {
    const calls = (STORE_SRC.match(/withMigratedBackends\(/g) ?? []).length;
    expect(calls).toBe(2);
  });

  test("importState 的 settings 收斂寫在 `...newState` 之後", () => {
    const body = STORE_SRC.slice(
      STORE_SRC.indexOf("importState(newState: Partial<AppState>)"),
      STORE_SRC.indexOf("deleteTemplate(id: string)"),
    );
    expect(body).toContain("withMigratedBackends(");
    expect(body.indexOf("...newState")).toBeLessThan(body.indexOf("withMigratedBackends("));
  });
});
