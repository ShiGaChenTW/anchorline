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
import type { Section } from "../src/data/types";

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
  // 只能簽核、不能改內文 —— 孤兒的搬移與刪除都要擋下這個身分
  store.addEmployee({
    id: "u-test-approver",
    name: "測試核准者",
    kind: "human",
    accessRole: "approver",
    active: true,
  } as never);
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

// ─────────────────────────────────────────────────────────────────────
// 孤兒正文（orphan-content-recovery）
//
// 借用上面那套 store 測試骨架（mock 掉領域包目錄 + 假的 localStorage）——
// 孤兒的成因就是「換骨架但不刪正文」，所以測起來一定得碰真的 store，
// 純函式那一層在 `tests/orphan-content.test.ts`。
// ─────────────────────────────────────────────────────────────────────

let seq = 0;

/**
 * 每一支測試自己一個專案。
 *
 * 理由不是潔癖：`orphansOf()` 回傳的是「這個專案的全部孤兒」，共用專案的話
 * 前一支測留下的孤兒會變成下一支的雜訊，而 store 沒有「清掉某專案全部正文」
 * 的 API 可以在 beforeEach 收尾。
 */
function freshProject(): string {
  const id = `pt-orphan-${++seq}`;
  store.addProject({
    id,
    title: `孤兒測試 ${seq}`,
    status: "draft",
    pct: 0,
    owner: "測試管理員",
    domain: "generic",
  } as never);
  store.setActiveProject(id);
  return id;
}

function newSection(id: string, title: string): Section {
  return {
    id,
    n: "1",
    title,
    desc: "",
    status: "empty",
    guide: "",
    tips: [],
    example: "",
    fields: [
      { key: "f1", label: "欄位一", type: "textarea", value: "" },
      { key: "f2", label: "欄位二", type: "textarea", value: "" },
    ],
    checks: [],
    score: 0,
  };
}

/**
 * 製造一段孤兒 —— 走真實成因：寫正文、存檔，然後套整份範本把骨架換掉。
 *
 * 不直接戳 state 塞一筆假資料：那樣測到的是 `findOrphans` 而不是
 * 「applyFullTemplate 之後真的會有孤兒」，而後者才是這個功能存在的理由。
 */
function makeOrphan(pid: string, text: string): { id: string; key: string } {
  const src = store.sectionsFor(pid)[0];
  const ref = { id: src.id, key: src.fields[0].key };
  store.setSectionDraft(ref.id, ref.key, text);
  store.saveSections();
  store.applyFullTemplate(pid, [newSection("os-new", "新章節")]);
  return ref;
}

/**
 * 製造一段「只活在草稿裡」的孤兒 —— 打了字但換骨架前沒按存檔。
 * `applyFullTemplate` 不動 `prdDrafts`，所以舊章節的草稿會原封不動留著，
 * 只是編輯台不再畫得出來（欄位不在新骨架裡）。
 */
function makeDraftOnlyOrphan(pid: string, text: string): { id: string; key: string } {
  const src = store.sectionsFor(pid)[0];
  const ref = { id: src.id, key: src.fields[0].key };
  store.setSectionDraft(ref.id, ref.key, text);
  store.applyFullTemplate(pid, [newSection("os-new", "新章節")]);
  return ref;
}

describe("orphansOf", () => {
  beforeEach(() => store.setCurrentUser("u-test-admin"));

  test("沒換過骨架就沒有孤兒", () => {
    const pid = freshProject();
    expect(store.orphansOf(pid)).toEqual([]);
  });

  test("換骨架之後，寫過的內容變成孤兒 —— 帶原章節 id、欄位與全文", () => {
    const pid = freshProject();
    const src = makeOrphan(pid, "這段字不能不見");
    expect(store.orphansOf(pid)).toEqual([
      { sectionId: src.id, fieldKey: src.key, text: "這段字不能不見" },
    ]);
  });

  test("空白不算孤兒 —— 否則「有 N 段內容不見了」是謊話", () => {
    const pid = freshProject();
    makeOrphan(pid, "   \n  ");
    expect(store.orphansOf(pid)).toEqual([]);
  });

  test("**用該專案自己的正文袋，不是 active 那一份**", () => {
    const withOrphan = freshProject();
    const src = makeOrphan(withOrphan, "A 的孤兒");
    // 切到別的專案 —— active 的 sectionValues 從此是另一個專案的
    const other = freshProject();
    expect(store.get().activeProjectId).toBe(other);

    expect(store.orphansOf(withOrphan)).toEqual([
      { sectionId: src.id, fieldKey: src.key, text: "A 的孤兒" },
    ]);
    expect(store.orphansOf(other)).toEqual([]);
  });

  test("孤兒不會外溢到別的專案", () => {
    const a = freshProject();
    makeOrphan(a, "只屬於 A");
    const b = freshProject();
    makeOrphan(b, "只屬於 B");
    expect(store.orphansOf(a).map((o) => o.text)).toEqual(["只屬於 A"]);
    expect(store.orphansOf(b).map((o) => o.text)).toEqual(["只屬於 B"]);
  });

  test("換骨架前打了字但沒存檔，一樣算孤兒 —— 不是只看已存的正文", () => {
    const pid = freshProject();
    const src = makeDraftOnlyOrphan(pid, "還沒存就換骨架了");
    expect(store.orphansOf(pid)).toEqual([
      { sectionId: src.id, fieldKey: src.key, text: "還沒存就換骨架了" },
    ]);
  });

  test("章節 id 沒變、但欄位被範本拿掉了 —— 那個欄位單獨算孤兒", () => {
    const pid = freshProject();
    const src = store.sectionsFor(pid)[0];
    const [f1, f2] = src.fields;
    store.setSectionDraft(src.id, f1.key, "留下的欄位");
    store.setSectionDraft(src.id, f2.key, "會被拿掉的欄位");
    store.saveSections();
    // 範本沿用同一個 sectionId，但欄位只剩一個 —— f2 從骨架裡消失
    store.applyFullTemplate(pid, [
      { ...src, fields: [{ key: f1.key, label: f1.label, type: "textarea", value: "" }] },
    ]);
    expect(store.orphansOf(pid)).toEqual([{ sectionId: src.id, fieldKey: f2.key, text: "會被拿掉的欄位" }]);
  });
});

describe("moveOrphan", () => {
  beforeEach(() => store.setCurrentUser("u-test-admin"));

  test("搬進草稿，來源從已儲存正文消失", () => {
    const pid = freshProject();
    const src = makeOrphan(pid, "搬我");
    const r = store.moveOrphan(pid, { sectionId: src.id, fieldKey: src.key }, { sectionId: "os-new", fieldKey: "f1" });
    expect(r.ok).toBe(true);
    expect(store.sectionFieldValue("os-new", "f1")).toBe("搬我");
    expect(store.orphansOf(pid)).toEqual([]);
  });

  test("落點已經有字時中間空一行，不覆蓋", () => {
    const pid = freshProject();
    const src = makeOrphan(pid, "後來的");
    store.setSectionDraft("os-new", "f1", "本來就有的");
    store.saveSections();
    store.moveOrphan(pid, { sectionId: src.id, fieldKey: src.key }, { sectionId: "os-new", fieldKey: "f1" });
    expect(store.sectionFieldValue("os-new", "f1")).toBe("本來就有的\n\n後來的");
  });

  test("落點章節被標記成未儲存 —— 使用者要知道還沒存", () => {
    const pid = freshProject();
    const src = makeOrphan(pid, "搬我");
    expect(store.isSectionDirty("os-new")).toBe(false);
    store.moveOrphan(pid, { sectionId: src.id, fieldKey: src.key }, { sectionId: "os-new", fieldKey: "f1" });
    expect(store.isSectionDirty("os-new")).toBe(true);
  });

  test("**存檔之後留在已儲存正文裡，而且孤兒不會復活**", () => {
    const pid = freshProject();
    const src = makeOrphan(pid, "搬完要存得住");
    store.moveOrphan(pid, { sectionId: src.id, fieldKey: src.key }, { sectionId: "os-new", fieldKey: "f1" });
    store.saveSections();
    expect(store.sectionFieldSaved("os-new", "f1")).toBe("搬完要存得住");
    // 來源若還留著草稿，saveSections() 會把它寫回正文 —— 孤兒就復活了
    expect(store.orphansOf(pid)).toEqual([]);
    expect(store.get().projectSectionValues[pid]?.[src.id]?.[src.key]).toBeUndefined();
  });

  test("找不到來源會講話，不是默默成功", () => {
    const pid = freshProject();
    makeOrphan(pid, "搬我");
    const r = store.moveOrphan(pid, { sectionId: "沒這節", fieldKey: "f1" }, { sectionId: "os-new", fieldKey: "f1" });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("找不到");
  });

  test("落點不在目前骨架裡會擋下來 —— 否則搬完又是一個孤兒", () => {
    const pid = freshProject();
    const src = makeOrphan(pid, "搬我");
    const r = store.moveOrphan(pid, { sectionId: src.id, fieldKey: src.key }, { sectionId: "os-new", fieldKey: "不存在的欄位" });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("落點");
    expect(store.orphansOf(pid)).toHaveLength(1); // 沒有半途改壞
  });

  test("沒有編輯權限就擋下來", () => {
    const pid = freshProject();
    const src = makeOrphan(pid, "搬我");
    store.setCurrentUser("u-test-approver");
    const r = store.moveOrphan(pid, { sectionId: src.id, fieldKey: src.key }, { sectionId: "os-new", fieldKey: "f1" });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("無法編輯");
    expect(store.orphansOf(pid)).toHaveLength(1);
  });

  test("來源其實還在骨架裡（不是孤兒）就擋下來 —— 不能把活著的內容當孤兒搬走", () => {
    const pid = freshProject();
    store.applyFullTemplate(pid, [newSection("live-sec", "還在用的章節")]);
    store.setSectionDraft("live-sec", "f1", "還活著的內容");
    store.saveSections();
    const r = store.moveOrphan(pid, { sectionId: "live-sec", fieldKey: "f1" }, { sectionId: "live-sec", fieldKey: "f2" });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("不是孤兒");
    expect(store.sectionFieldValue("live-sec", "f1")).toBe("還活著的內容");
  });

  test("只活在草稿裡的孤兒也搬得動 —— 不會誤判成「找不到」", () => {
    const pid = freshProject();
    const src = makeDraftOnlyOrphan(pid, "草稿孤兒");
    const r = store.moveOrphan(pid, { sectionId: src.id, fieldKey: src.key }, { sectionId: "os-new", fieldKey: "f1" });
    expect(r.ok).toBe(true);
    expect(store.sectionFieldValue("os-new", "f1")).toBe("草稿孤兒");
    expect(store.orphansOf(pid)).toEqual([]);
  });
});

describe("dropOrphan", () => {
  beforeEach(() => store.setCurrentUser("u-test-admin"));

  test("刪掉就真的不見了", () => {
    const pid = freshProject();
    const src = makeOrphan(pid, "刪我");
    expect(store.dropOrphan(pid, { sectionId: src.id, fieldKey: src.key }).ok).toBe(true);
    expect(store.orphansOf(pid)).toEqual([]);
    expect(store.get().projectSectionValues[pid]?.[src.id]?.[src.key]).toBeUndefined();
  });

  test("同一節的其他欄位不受影響", () => {
    const pid = freshProject();
    const src = store.sectionsFor(pid)[0];
    const [f1, f2] = src.fields;
    store.setSectionDraft(src.id, f1.key, "留下");
    store.setSectionDraft(src.id, f2.key, "刪掉");
    store.saveSections();
    store.applyFullTemplate(pid, [newSection("os-new", "新章節")]);

    expect(store.dropOrphan(pid, { sectionId: src.id, fieldKey: f2.key }).ok).toBe(true);
    expect(store.orphansOf(pid)).toEqual([
      { sectionId: src.id, fieldKey: f1.key, text: "留下" },
    ]);
  });

  test("刪第二次會講話", () => {
    const pid = freshProject();
    const src = makeOrphan(pid, "刪我");
    store.dropOrphan(pid, { sectionId: src.id, fieldKey: src.key });
    const again = store.dropOrphan(pid, { sectionId: src.id, fieldKey: src.key });
    expect(again.ok).toBe(false);
    expect(again.reason).toContain("找不到");
  });

  test("沒有編輯權限就擋下來", () => {
    const pid = freshProject();
    const src = makeOrphan(pid, "刪我");
    store.setCurrentUser("u-test-approver");
    const r = store.dropOrphan(pid, { sectionId: src.id, fieldKey: src.key });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("無法編輯");
    expect(store.orphansOf(pid)).toHaveLength(1);
  });

  test("來源其實還在骨架裡（不是孤兒）就擋下來 —— 不能把活著的內容當孤兒永久刪除", () => {
    const pid = freshProject();
    store.applyFullTemplate(pid, [newSection("live-sec", "還在用的章節")]);
    store.setSectionDraft("live-sec", "f1", "還活著的內容");
    store.saveSections();
    const r = store.dropOrphan(pid, { sectionId: "live-sec", fieldKey: "f1" });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("不是孤兒");
    expect(store.sectionFieldValue("live-sec", "f1")).toBe("還活著的內容");
  });

  test("只活在草稿裡的孤兒也刪得掉 —— 不會誤判成「找不到」", () => {
    const pid = freshProject();
    const src = makeDraftOnlyOrphan(pid, "草稿孤兒");
    expect(store.dropOrphan(pid, { sectionId: src.id, fieldKey: src.key }).ok).toBe(true);
    expect(store.orphansOf(pid)).toEqual([]);
    expect(store.get().prdDrafts[pid]?.[src.id]?.[src.key]).toBeUndefined();
  });
});
