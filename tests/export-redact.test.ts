/**
 * 匯出**不得**帶出 API 金鑰，而匯入**不得**清空現有金鑰。
 *
 * 這兩條是同一個決定的兩半，所以放在同一支測。只做遮蔽那一半的話，
 * 使用者還原自己的備份就會把正在用的金鑰洗成空字串 —— 而那個症狀是
 * 稍後某次 AI 呼叫 401，跟「我剛剛還原了備份」看起來毫無關聯。
 *
 * 外洩那條用 canary 搜**整份序列化結果**，不是檢查 `apiKey` 欄位在不在。
 * 欄位檢查抓得到「金鑰被複製到另一個欄位」，抓不到「金鑰被串進某個字串裡」，
 * 而後者才是實際會發生的形狀。
 */
import { beforeAll, describe, expect, mock, test } from "bun:test";

mock.module("../src/data/domains", () => ({
  BUILTIN_PACKS: {},
  builtinSource: () => null,
  reloadUserPacks: () => {},
  domainPacks: () => ({}),
  isUserPack: () => false,
  listDomains: () => [],
  DEFAULT_DOMAIN: "generic",
}));

const mem = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage ??= {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
};

const { redactSecrets } = await import("../src/lib/export");
const { store } = await import("../src/data/store");

const GLOBAL_CANARY = "REDACT-CANARY-GLOBAL-8F2Q";
const BACKEND_CANARY = "REDACT-CANARY-BACKEND-3K7Z";

describe("redactSecrets", () => {
  beforeAll(() => {
    store.updateSettings({ apiKey: GLOBAL_CANARY });
    store.addBackend({
      id: "redact-api",
      label: "有金鑰的後端",
      kind: "api",
      provider: "openai",
      model: "gpt-5.1",
      endpoint: "https://api.openai.com/v1",
      apiKey: BACKEND_CANARY,
    });
    store.addBackend({ id: "redact-cli", label: "本機 claude", kind: "cli", tool: "claude" });
  });

  test("全域金鑰被清空", () => {
    expect(redactSecrets(store.get()).settings.apiKey).toBe("");
  });

  test("每一個 API 後端的金鑰都被清空 —— 不是只清第一個", () => {
    const out = redactSecrets(store.get()).settings.backends ?? [];
    const apis = out.filter((b) => b.kind === "api");
    expect(apis.length).toBeGreaterThan(0);
    for (const b of apis) expect((b as { apiKey: string }).apiKey).toBe("");
  });

  test("CLI 後端原樣保留 —— 它沒有金鑰，遮蔽不該把它弄壞", () => {
    const cli = (redactSecrets(store.get()).settings.backends ?? []).find(
      (b) => b.id === "redact-cli",
    );
    expect(cli).toBeTruthy();
    expect(cli?.kind).toBe("cli");
  });

  test("序列化後整份找不到任何 canary", () => {
    const dump = JSON.stringify(redactSecrets(store.get()));
    expect(dump).not.toContain(GLOBAL_CANARY);
    expect(dump).not.toContain(BACKEND_CANARY);
  });

  test("原始 state 沒有被就地改掉 —— 遮蔽是複製，不是破壞", () => {
    redactSecrets(store.get());
    expect(store.get().settings.apiKey).toBe(GLOBAL_CANARY);
  });
});

describe("importState 對金鑰的處理", () => {
  test("匯入一份遮蔽過的備份，不會清掉目前的金鑰", () => {
    store.updateSettings({ apiKey: GLOBAL_CANARY });
    const backup = redactSecrets(store.get());
    store.importState(JSON.parse(JSON.stringify(backup)));
    expect(store.get().settings.apiKey).toBe(GLOBAL_CANARY);
  });

  test("後端的金鑰同樣依 id 保留", () => {
    store.updateSettings({ apiKey: GLOBAL_CANARY });
    store.updateBackend("redact-api", { apiKey: BACKEND_CANARY });
    const backup = redactSecrets(store.get());
    store.importState(JSON.parse(JSON.stringify(backup)));
    const b = store.get().settings.backends?.find((x) => x.id === "redact-api");
    expect((b as { apiKey?: string } | undefined)?.apiKey).toBe(BACKEND_CANARY);
  });

  test("帶著真金鑰的舊備份**照樣覆蓋** —— 保留只針對空值", () => {
    store.updateSettings({ apiKey: GLOBAL_CANARY });
    const old = JSON.parse(JSON.stringify(store.get()));
    old.settings.apiKey = "OLD-BACKUP-KEY-XYZ";
    store.importState(old);
    expect(store.get().settings.apiKey).toBe("OLD-BACKUP-KEY-XYZ");
  });
});
