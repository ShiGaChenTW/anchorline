/**
 * 版號政策要活過重新載入。
 *
 * `migrateProject` 是逐欄位重建，忘了列的欄位會在載入時無聲消失 ——
 * tags 與 domain 都踩過，versionPolicy 是第三次：選了 vX.YY.ZZ、
 * persist 也真的寫進 localStorage，但下次載入被 migrateProject 吃掉，
 * 版號紀錄卡每次都重新問一次。這支直接對 migrateProject 驗
 * 「存進去的欄位讀得回來」—— load() 只在模組第一次 import 時跑，
 * 測試共用進程搶不到那個時機，所以不走整條 localStorage 路徑。
 */
import { describe, expect, mock, test } from "bun:test";

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

// store 在 import 時就會讀 localStorage —— 沒有就補一個最小替身
if (!("localStorage" in globalThis)) {
  const mem = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  };
}

const { migrateProject } = await import("../src/data/store");
const { policyOf } = await import("../src/lib/release");

const base = { id: "pv", title: "測試", owner: "x" };

describe("migrateProject × versionPolicy", () => {
  test("strict 讀得回來 —— 不會退回 loose 重新問一次", () => {
    const p = migrateProject({ ...base, versionPolicy: "strict" }, []);
    expect(p.versionPolicy).toBe("strict");
    expect(policyOf(p)).toBe("strict");
  });

  test("沒選過的專案維持 loose", () => {
    expect(policyOf(migrateProject({ ...base }, []))).toBe("loose");
  });

  test("認不得的值當作沒選 —— 不會把垃圾寫回 state", () => {
    expect(migrateProject({ ...base, versionPolicy: "semver" }, []).versionPolicy).toBeUndefined();
  });
});

describe("migrateProject × shortCode", () => {
  test("合法簡寫讀得回來、存成大寫", () => {
    expect(migrateProject({ ...base, shortCode: "al" }, []).shortCode).toBe("AL");
    expect(migrateProject({ ...base, shortCode: "SNOTE" }, []).shortCode).toBe("SNOTE");
  });

  test("不合法的值當作沒設 —— 不要寫進 state 讓取號用錯前綴", () => {
    expect(migrateProject({ ...base }, []).shortCode).toBeUndefined();
    expect(migrateProject({ ...base, shortCode: "AL1" }, []).shortCode).toBeUndefined();
    expect(migrateProject({ ...base, shortCode: "TOOLONG" }, []).shortCode).toBeUndefined();
  });
});
