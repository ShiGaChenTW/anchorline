/**
 * 領域包的管理面：改名底稿、找原始碼、移除。
 *
 * `lib/domain-pack-manage.ts` 本身測不到 —— 它 import `data/domains`，那裡有
 * `import.meta.glob`（只有 Vite 有）。所以真正需要被測的邏輯都放在測得到的
 * 那一層：`domain-pack.ts` 的改名，與 `user-domains.ts` 的快取異動。
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseDomainPack, renamePackSource, validatePackStructure } from "../src/lib/domain-pack";

function fakeStorage(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init));
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  } as Storage;
}

const TEMPLATE = readFileSync(new URL("../src/data/domains/_template.md", import.meta.url), "utf8");
const CACHE_KEY = "anchorline:user-domains:v1";

const packMd = (name: string) =>
  `---\nname: ${name}\ndisplayName: ${name} 顯示名\nextends: _base\n---\n`;

describe("renamePackSource（新增領域包的底稿）", () => {
  test("改掉 name 與 displayName，其餘原樣", () => {
    const out = renamePackSource(TEMPLATE, "insurance");
    expect(out).toContain("name: insurance");
    expect(out).toContain("displayName: insurance");
    expect(out).not.toContain("name: _template");
    // 註解是使用者照著改的說明，不能被洗掉
    expect(out).toContain("# 領域包範本");
  });

  test("產出的底稿本身要是合法的領域包 —— 不然新增第一步就卡住", () => {
    const v = validatePackStructure(renamePackSource(TEMPLATE, "insurance"));
    expect(v.ok).toBe(true);
  });

  test("非英數底線的名字會被消毒，開頭底線會被剝掉（`_` 是內部保留前綴）", () => {
    // 全中文名字消毒後什麼都不剩，退回 my_domain。底稿上看得到這一行，
    // 使用者要改成什麼是他的事 —— 但存進去的識別碼一定是合法的
    expect(parseDomainPack(renamePackSource(TEMPLATE, "產險 線上")).name).toBe("my_domain");
    expect(parseDomainPack(renamePackSource(TEMPLATE, "產險 線上")).displayName).toBe("產險 線上");
    const v = validatePackStructure(renamePackSource(TEMPLATE, "_sneaky"));
    expect(v.ok).toBe(true); // 剝掉開頭底線後才過得了「不可用 _ 開頭」那一關
    expect(parseDomainPack(renamePackSource(TEMPLATE, "_sneaky")).name).toBe("sneaky");
  });
});

describe("removeUserPack", () => {
  let ud: typeof import("../src/lib/user-domains");

  beforeEach(async () => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage({
      [CACHE_KEY]: JSON.stringify({
        dir: "",
        scannedAt: "2026-08-11T00:00:00.000Z",
        sources: { "a.md": packMd("alpha"), "b.md": packMd("beta") },
      }),
    });
    ud = await import("../src/lib/user-domains");
  });

  test("依領域名找到對應的檔案原始碼", () => {
    expect(ud.userPackSource("alpha")?.file).toBe("a.md");
    expect(ud.userPackSource("nope")).toBeNull();
  });

  test("只移除指定的那一個，其他留著", () => {
    const r = ud.removeUserPack("alpha");
    expect(r.ok).toBe(true);
    expect(Object.keys(ud.getUserPacks().packs)).toEqual(["beta"]);
  });

  test("沒指定資料夾時 stillOnDisk 為 false —— 這個移除是真的移除", () => {
    const r = ud.removeUserPack("beta");
    expect(r.ok && r.stillOnDisk).toBe(false);
  });

  test("移除不存在的包會說原因，不會靜靜成功", () => {
    const r = ud.removeUserPack("ghost");
    expect(r.ok).toBe(false);
  });
});
