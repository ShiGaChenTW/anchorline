/**
 * `Project.pct` 由章節完成度推導。
 *
 * ## 這一支在防什麼
 *
 * `pct` 從產品上線至今從來不是推導的（建案寫死 18、Markdown 匯入寫死 8），
 * 而 `flow-layers.ts` 的 L4 判定是 `draft && pct >= 25`。18 < 25，所以
 * **手動新建的草稿寫得再完整，L4 也永遠不亮** —— 而且不報錯、只是不亮，
 * 所以從來沒有人回報過。流程條六格裡有一格是死的。
 *
 * 兩件事各自會靜默壞掉，分開測：
 *
 * - **分母**：路線會改章節數（full 15 / lite 8 / vibe 3）。寫死任何一個數字
 *   都會讓另外兩檔算錯，症狀同樣是「百分比不動」。
 * - **接線**：推導函式再對，沒接上 store 的內容變更就等於沒做。
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Project } from "../src/data/types";
import {
  derivePrdPct,
  SECTION_SUBSTANCE_MIN,
  sectionHasSubstance,
  sectionTextLength,
} from "../src/lib/prd-progress";
import { deriveFlowLayers } from "../src/lib/flow-layers";

// ── Part A：推導本身（純函式，不碰 store）──────────────────────

const secs = (...ids: string[]) => ids.map((id) => ({ id }));

/** 剛好過門檻的一段字（12 個中文字） */
const LONG = "一二三四五六七八九十十一";
/** 一定不過門檻 */
const SHORT = "太短";

describe("sectionTextLength", () => {
  test("欄位各自去頭尾空白後相加 —— 空白不是內容", () => {
    expect(sectionTextLength({ a: "  abc  ", b: "de" })).toBe(5);
  });

  test("沒有值／空物件都是 0，不是 NaN", () => {
    expect(sectionTextLength(undefined)).toBe(0);
    expect(sectionTextLength({})).toBe(0);
    expect(sectionTextLength({ a: "   " })).toBe(0);
  });
});

describe("sectionHasSubstance", () => {
  test("剛好到門檻就算 —— 邊界是 >=，不是 >", () => {
    expect(LONG.length).toBe(SECTION_SUBSTANCE_MIN);
    expect(sectionHasSubstance({ a: LONG })).toBe(true);
    expect(sectionHasSubstance({ a: LONG.slice(0, -1) })).toBe(false);
  });

  test("一個字元不算「有實質內容」—— pct 回答的是寫了多少，不是有沒有碰過鍵盤", () => {
    expect(sectionHasSubstance({ a: "x" })).toBe(false);
    expect(sectionHasSubstance({ a: "—" })).toBe(false);
  });

  test("同一節的多個欄位合起來算 —— 分三欄各寫四個字也是寫了", () => {
    expect(sectionHasSubstance({ a: "一二三四", b: "五六七八", c: "九十十一" })).toBe(true);
  });
});

describe("derivePrdPct", () => {
  test("分母是傳進來的章節數 —— 同一份內容，路線不同結果就不同", () => {
    const values = { summary: { what: LONG }, goals: { goals: LONG } };
    // vibe 3 節：2/3
    expect(derivePrdPct(secs("summary", "problem", "goals"), values)).toBe(67);
    // lite 8 節：2/8
    expect(
      derivePrdPct(secs("docinfo", "summary", "problem", "goals", "metrics", "spec", "accept", "open"), values),
    ).toBe(25);
  });

  test("自訂章節不進分母也不進分子 —— 它是選填的自由區，空著是常態", () => {
    const values = { summary: { what: LONG } };
    // 有 custom 與沒有 custom 必須算出同一個數字，否則每份 PRD 的上限都
    // 變成「除非你寫了自訂章節，否則到不了 100%」
    expect(derivePrdPct(secs("summary", "problem"), values)).toBe(50);
    expect(derivePrdPct(secs("summary", "problem", "custom"), values)).toBe(50);
    // 自訂章節寫滿了也不加分
    expect(derivePrdPct(secs("summary", "problem", "custom"), { ...values, custom: { x: LONG } })).toBe(50);
  });

  test("沒有可計數的章節回 0 而不是 NaN —— 這個值會直接進 style=\"width:N%\"", () => {
    expect(derivePrdPct([], { summary: { what: LONG } })).toBe(0);
    expect(derivePrdPct(secs("custom"), { custom: { x: LONG } })).toBe(0);
  });

  test("空白袋是 0、全填滿是 100", () => {
    expect(derivePrdPct(secs("a", "b", "c"), {})).toBe(0);
    expect(derivePrdPct(secs("a", "b", "c"), undefined)).toBe(0);
    expect(derivePrdPct(secs("a", "b", "c"), { a: { x: LONG }, b: { x: LONG }, c: { x: LONG } })).toBe(100);
  });

  test("太短的章節不算 —— 分子只數有實質內容的那幾節", () => {
    expect(derivePrdPct(secs("a", "b"), { a: { x: LONG }, b: { x: SHORT } })).toBe(50);
  });

  test("四捨五入到整數", () => {
    // 1/3 = 33.33…
    expect(derivePrdPct(secs("a", "b", "c"), { a: { x: LONG } })).toBe(33);
    // 2/3 = 66.66…
    expect(derivePrdPct(secs("a", "b", "c"), { a: { x: LONG }, b: { x: LONG } })).toBe(67);
  });
});

// ── Part B：store 接線 ─────────────────────────────────────────
//
// 推導函式再對，沒接上 store 就等於沒做 —— 而漏接的症狀是「百分比不動」，
// 不是錯誤訊息。

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

const { store, withDerivedPct } = await import("../src/data/store");
const STORE_SRC = readFileSync(new URL("../src/data/store.ts", import.meta.url), "utf8");

/** id 一律帶檔名前綴 —— `bun test` 把所有檔跑在同一個 process 裡，store 是單例 */
const ADMIN = "pp-admin";
const PREV_USER = store.get().currentUser.id;
const PREV_ACTIVE = store.get().activeProjectId;

beforeAll(() => {
  if (!store.get().employees.some((e) => e.id === ADMIN)) {
    store.addEmployee({
      id: ADMIN,
      name: "完成度測試管理員",
      kind: "human",
      accessRole: "admin",
      active: true,
    } as never);
  }
  store.setCurrentUser(ADMIN);
});

afterAll(() => {
  store.setCurrentUser(PREV_USER);
  if (PREV_ACTIVE) store.setActiveProject(PREV_ACTIVE);
});

function freshProject(id: string, extra: Record<string, unknown> = {}): string {
  if (!store.get().projects.some((p) => p.id === id)) {
    store.addProject({
      id,
      title: `完成度測試 ${id}`,
      status: "draft",
      // 呼叫端給的值一律是佔位 —— 這裡故意給一個荒謬的數字，
      // 接線沒生效的話它會原封不動留在專案上
      pct: 77,
      owner: "完成度測試管理員",
      domain: "generic",
      ...extra,
    } as never);
  }
  return id;
}

const pctOf = (id: string) => store.get().projects.find((p) => p.id === id)!.pct;

describe("store：pct 由內容推導", () => {
  test("新建專案的 pct 來自空白正文袋（0），不是呼叫端寫死的數字", () => {
    const id = freshProject("pp-new");
    expect(pctOf(id)).toBe(0);
  });

  test("寫進章節內容之後 pct 跟著上升 —— 這是 L4 能不能亮的唯一輸入", () => {
    const id = freshProject("pp-edit", { route: "vibe" });
    store.setActiveProject(id);
    expect(pctOf(id)).toBe(0);

    // vibe＝3 節（summary / problem / goals）
    store.setSectionValues("summary", { what: "把試作檔的治理鏈從自簽的錨點接回正式流程" });
    expect(pctOf(id)).toBe(33);
    store.setSectionValues("goals", { goals: "先把最小治理做對", nongoals: "- 不做多人簽核" });
    expect(pctOf(id)).toBe(67);

    // L4 的門檻是 25 —— 舊行為（寫死 18）在這裡永遠過不去
    expect(pctOf(id)).toBeGreaterThanOrEqual(25);
  });

  test("換路線會重算 —— 路線換掉的是分母", () => {
    const id = "pp-edit"; // 沿用上一條：3 節裡填了 2 節 = 67%
    expect(pctOf(id)).toBe(67);
    // 升成 full（15 節）：同一份內容，分母變大
    expect(store.setProjectRoute(id, "full").ok).toBe(true);
    expect(pctOf(id)).toBeLessThan(67);
    // 切回試作，數字要回得來 —— 降級不刪正文
    expect(store.setProjectRoute(id, "vibe").ok).toBe(true);
    expect(pctOf(id)).toBe(67);
  });

  /**
   * 這一條是整支測試的目的地：pct 推導出來就是為了讓 L4 亮得起來。
   * 舊行為下 pct 恆為 18，L4 的 `draft && pct >= 25` 在送審前永遠是 false。
   */
  test("寫完內容的草稿，流程條的 L4 會亮 —— 舊行為下它永遠不亮", () => {
    const id = "pp-edit";
    store.setActiveProject(id);
    const layers = deriveFlowLayers(store.get(), { gateSpec: store.activeGateSpec() });
    const l4 = layers.find((l) => l.id === "l4")!;
    expect(store.get().projects.find((p) => p.id === id)!.status).toBe("draft");
    expect(l4.done).toBe(true);
  });

  test("已核准的專案不被拉下來 —— approveAndLock 的 100 是既有語意", () => {
    const id = freshProject("pp-approved", { status: "approved", pct: 100 });
    store.setActiveProject(id);
    // 內容遠遠不到 100%，但這份專案核准的是「完整的那一份」
    store.setSectionValues("summary", { what: "核准後才補的一句話" });
    expect(pctOf(id)).toBe(100);
  });
});

// ── Part C：既有資料的一次性移轉 ────────────────────────────────
//
// Part B 證明的是「以後改內容會重算」。對**已經在用這個 App 的人**，那還不夠：
// `migrateProject` 是 `pct: Number(raw.pct ?? 0)`，原樣讀回不重算 —— 一個寫得
// 很滿的舊草稿重新載入之後 `pct` 仍是 localStorage 裡的 18，L4 照樣不亮，
// 這次修的東西對他們實質無效，直到他剛好去編輯某一節才會突然跳一大格。

/** 移轉測試用的專案。`route: "vibe"` 讓分母固定成 3 節，斷言才咬得死 */
function stale(id: string, over: Partial<Project> = {}): Project {
  return {
    id,
    title: `移轉 ${id}`,
    status: "draft",
    // 舊存檔裡那個寫死的數字（建案 18 / Markdown 匯入 8 / 種子 82…）
    pct: 18,
    owner: "完成度測試管理員",
    ownerId: "",
    authorId: "",
    authorAgentFamily: null,
    mine: true,
    updated: "",
    tag: "product",
    isSample: false,
    route: "vibe",
    domain: "generic",
    ...over,
  } as Project;
}

/** `withDerivedPct` 要的最小 state 形狀 */
function ctx(projects: Project[], bag: Record<string, Record<string, Record<string, string>>>) {
  return {
    activeProjectId: "",
    sectionValues: {},
    projectSectionValues: bag,
    projectSectionMeta: {},
    projects,
  };
}

describe("withDerivedPct：既有資料的一次性移轉", () => {
  test("寫死的舊 pct 被推導值取代 —— 不重算的話，這次修的東西對既有使用者等於沒修", () => {
    const s = ctx([stale("mig-draft")], {
      // vibe＝3 節，填 2 節
      "mig-draft": { summary: { what: LONG }, problem: { why: LONG } },
    });
    expect(withDerivedPct(s).projects[0]!.pct).toBe(67);
    // L4 的門檻是 25 —— 舊值 18 過不去，這一步就是它能不能亮的分水嶺
    expect(withDerivedPct(s).projects[0]!.pct).toBeGreaterThanOrEqual(25);
  });

  test("寫死的數字比實際內容高時一樣要下修 —— 移轉是換成真值，不是取大的", () => {
    const s = ctx([stale("mig-inflated", { pct: 82 })], { "mig-inflated": {} });
    expect(withDerivedPct(s).projects[0]!.pct).toBe(0);
  });

  test("已核准的 100 不得被拉下來 —— approveAndLock 的 allDone ? 100 是既有語意", () => {
    // 正文袋是空的：不跳過的話這一份會從 100 掉到 0
    const s = ctx([stale("mig-approved", { status: "approved", pct: 100 })], {});
    expect(withDerivedPct(s).projects[0]!.pct).toBe(100);
  });

  test("每個專案各讀自己的正文袋 —— 共用一份的症狀是「別人的內容算到我頭上」", () => {
    const s = ctx([stale("mig-a"), stale("mig-b")], {
      "mig-a": { summary: { what: LONG }, problem: { why: LONG }, goals: { goals: LONG } },
    });
    const out = withDerivedPct(s).projects;
    expect(out.find((p) => p.id === "mig-a")!.pct).toBe(100);
    expect(out.find((p) => p.id === "mig-b")!.pct).toBe(0);
  });

  test("active 專案讀的是 sectionValues，不是 bag —— 拿錯一路的症狀是百分比不動", () => {
    const s = {
      ...ctx([stale("mig-active")], { "mig-active": {} }),
      activeProjectId: "mig-active",
      // 編輯台當下的內容還沒被 snapshot 進 bag
      sectionValues: { summary: { what: LONG } },
    };
    expect(withDerivedPct(s).projects[0]!.pct).toBe(33);
  });
});

/**
 * 形狀防護。移轉函式存在、但讀取路徑沒接上就等於什麼都沒做 ——
 * 而且沒有任何畫面症狀（`withMigratedBackends` 當年漏的正是 `importState`）。
 *
 * 為什麼用 source-grep 而不是真的跑一遍：`load()` 只在模組第一次 import 時執行，
 * 而 `bun test` 把所有檔跑在同一個 process 裡、store 是單例，這個檔搶不到那個
 * 時機；`importState()` 會把別的測試檔的資料整份掃掉。同 `agent-backend-store`
 * 與 `wave2-review-fixes` 的既有做法。
 */
describe("移轉真的接在三條讀取路徑上", () => {
  const bodyOf = (from: string, to: string) =>
    STORE_SRC.slice(STORE_SRC.indexOf(from), STORE_SRC.indexOf(to));

  test("load() 套了 withDerivedPct —— 這條是既有使用者的 localStorage", () => {
    expect(bodyOf("function load(): AppState {", "function pendingJobsFor(")).toContain(
      "withDerivedPct(",
    );
  });

  test("seedState() 套了 withDerivedPct —— 種子的 82 / 41 / 18 是編出來的數字", () => {
    expect(bodyOf("function seedState(): AppState {", "function mergeTemplates(")).toContain(
      "withDerivedPct(",
    );
  });

  test("importState() 套了 withDerivedPct —— 匯入的備份跟 localStorage 是同一份資料", () => {
    expect(bodyOf("importState(newState: Partial<AppState>)", "deleteTemplate(id: string)")).toContain(
      "withDerivedPct(",
    );
  });
});
