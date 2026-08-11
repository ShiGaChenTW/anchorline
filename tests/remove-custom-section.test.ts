/**
 * 刪掉「自訂章節」。
 *
 * 這一節不存在 `projectSections` 裡 —— 每次推導骨架時由 `withCustomSection()`
 * 補在最後。所以「從陣列拿掉」刪不掉它：下一次載入又會長回來，而且不會有
 * 任何錯誤訊息。唯一能刪它的方式是一個明確的旗標，這支測的就是那條路徑
 * 在**每一條重算骨架的路徑上**都成立。
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { CUSTOM_SECTION_ID } from "../src/data/seed";

// 領域包目錄用 `import.meta.glob`（Vite 專屬），bun 跑不動 —— 這是 store
// 一直沒有單元測試的原因。用通用領域（測的東西跟領域包無關）換掉它。
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
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
};

const { store } = await import("../src/data/store");

/**
 * 正式版種子沒有專案、目前身分是未啟用的幽靈帳號（那些是首次設定精靈的工作）。
 * 測試自己補一個管理員與兩個專案 —— 兩個是必要的：這支測的核心之一就是
 * 「刪掉只影響這一個專案」。
 */
function bootstrap(): { a: string; b: string } {
  const admin = {
    id: "u-test-admin",
    name: "測試管理員",
    kind: "human",
    accessRole: "admin",
    active: true,
    isCurrent: true,
  } as never;
  store.addEmployee(admin);
  store.setCurrentUser("u-test-admin");
  for (const [id, title] of [["pt-a", "A 專案"], ["pt-b", "B 專案"]] as const) {
    if (!store.get().projects.some((p) => p.id === id)) {
      store.addProject({
        id,
        title,
        status: "draft",
        pct: 0,
        owner: "測試管理員",
        domain: "generic",
      } as never);
    }
  }
  return { a: "pt-a", b: "pt-b" };
}

const { a: PID_A, b: PID_B } = bootstrap();

function ids(): string[] {
  return store.get().sections.map((s) => s.id);
}

beforeEach(() => {
  store.setActiveProject(PID_A);
  store.resetSections(PID_A);
  store.resetSections(PID_B);
});

describe("removeSection(custom)", () => {
  test("刪得掉 —— 而且是真的從章節列表消失", () => {
    expect(ids()).toContain(CUSTOM_SECTION_ID);
    expect(store.removeSection(CUSTOM_SECTION_ID).ok).toBe(true);
    expect(ids()).not.toContain(CUSTOM_SECTION_ID);
  });

  test("**切走再切回來不會長回來** —— 換專案會整個重推骨架", () => {
    store.removeSection(CUSTOM_SECTION_ID);
    store.setActiveProject(PID_B);
    expect(ids()).toContain(CUSTOM_SECTION_ID); // 別的專案不受影響
    store.setActiveProject(PID_A);
    expect(ids()).not.toContain(CUSTOM_SECTION_ID);
  });

  test("只影響這一個專案", () => {
    store.removeSection(CUSTOM_SECTION_ID);
    expect(store.sectionsFor(PID_B).map((s) => s.id)).toContain(CUSTOM_SECTION_ID);
    expect(store.sectionsFor(PID_A).map((s) => s.id)).not.toContain(CUSTOM_SECTION_ID);
  });

  test("刪第二次會講話，不是默默成功", () => {
    store.removeSection(CUSTOM_SECTION_ID);
    const again = store.removeSection(CUSTOM_SECTION_ID);
    expect(again.ok).toBe(false);
    expect(again.reason).toContain("已經沒有");
  });

  test("插入章節範本時自動回來 —— 那些段落沒有別的落點", () => {
    store.removeSection(CUSTOM_SECTION_ID);
    expect(store.restoreCustomSection().ok).toBe(true);
    expect(ids()).toContain(CUSTOM_SECTION_ID);
  });

  test("「回到領域包骨架」也會把它帶回來", () => {
    store.removeSection(CUSTOM_SECTION_ID);
    store.resetSections();
    expect(ids()).toContain(CUSTOM_SECTION_ID);
  });
});
