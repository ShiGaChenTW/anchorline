/**
 * 流程在第一次送審時落地到專案上。
 *
 * D2 的整個重點是**紀錄的連續性**：`signoffTimeline` 靠 stageId 跨輪串接決策，
 * 關卡 id 一變，第一輪的意見就顯示「（已移除的關卡）」—— 而那正是簽核紀錄最該
 * 講清楚的一段。所以這支測的不是「流程有沒有算對」（那在 workflow-resolve.test.ts），
 * 而是「算完之後有沒有被釘住」。
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

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
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
};

const { store, migrateProject } = await import("../src/data/store");

const WL_ADMIN = "wl-admin";
const WL_APPROVER = "wl-approver";

let seq = 0;
function freshProject(cat?: "lean" | "narrative" | "enterprise" | "agile" | "technical") {
  const id = `wl-${++seq}`;
  store.addProject({
    id,
    title: `流程落地 ${id}`,
    status: "draft",
    pct: 0,
    owner: "測試管理員",
    domain: "generic",
  } as never);
  store.setActiveProject(id);
  if (cat) store.applyFullTemplate(id, store.get().sections, {}, { cat });
  return id;
}

const proj = (id: string) => store.get().projects.find((p) => p.id === id)!;
const stageNames = (id: string) => store.get().cases[id]!.stages.map((s) => s.name);

/**
 * id 帶檔名前綴、而且逐一檢查。`bun test` 全部跑在同一個 process，`store` 是
 * 模組層單例 —— 通用 id 會跟別的測試檔撞號，而「有 admin 就假設 fixture 都在」
 * 這種整批式的守衛一撞號就整組失效。
 */
function ensureEmployee(e: Record<string, unknown>) {
  if (!store.get().employees.some((x) => x.id === e.id)) store.addEmployee(e as never);
}

beforeEach(() => {
  ensureEmployee({
    id: WL_ADMIN,
    name: "測試管理員",
    kind: "human",
    accessRole: "admin",
    active: true,
    isCurrent: true,
  });
  ensureEmployee({
    id: WL_APPROVER,
    name: "核准者",
    kind: "human",
    accessRole: "approver",
    active: true,
  });
  store.setCurrentUser(WL_ADMIN);
});

describe("第一次送審落地", () => {
  test("送審前沒有落地流程；送審後專案帶著自己那一份", () => {
    const id = freshProject("technical");
    expect(proj(id).workflowStages).toBeUndefined();

    store.submitForReview(id, "c1");

    const landed = proj(id).workflowStages!;
    expect(landed.map((s) => s.name)).toEqual(["設計取捨審查", "規格一致性", "我核准"]);
    expect(stageNames(id)).toEqual(landed.map((s) => s.name));
  });

  test("五類範本各自落地不同的流程 —— 這是整個改動的目的", () => {
    const byCat = (["lean", "narrative", "enterprise", "agile", "technical"] as const).map((cat) => {
      const id = freshProject(cat);
      store.submitForReview(id, "c1");
      return stageNames(id).join("／");
    });
    // 五類至少要有四種不同的形狀（lean 與 agile 都是兩關但關卡名不同）
    expect(new Set(byCat).size).toBe(5);
  });

  test("沒套過整份範本的專案走 lean —— 而不是全域那套四關", () => {
    const id = freshProject();
    store.submitForReview(id, "c1");
    expect(stageNames(id)).toEqual(["AI 結構審查", "我核准"]);
  });
});

describe("落地之後不再重算", () => {
  test("改了範本分類，進行中的案子照舊 —— 關卡 id 逐字不變", () => {
    const id = freshProject("lean");
    store.submitForReview(id, "c1");
    const before = store.get().cases[id]!.stages.map((s) => s.id);

    // 換成 enterprise。骨架完全不同，但這個案子已經在跑了
    store.applyFullTemplate(id, store.get().sections, {}, { cat: "enterprise" });
    store.submitForReview(id, "c2");

    expect(store.get().cases[id]!.stages.map((s) => s.id)).toEqual(before);
    expect(stageNames(id)).toEqual(["AI 結構審查", "我核准"]);
  });

  test("重送審沿用同一組關卡 id —— 第一輪的意見才接得回來", () => {
    const id = freshProject("narrative");
    store.submitForReview(id, "c1");
    const first = store.get().cases[id]!.stages.map((s) => s.id);

    store.submitForReview(id, "c2");
    store.submitForReview(id, "c3");

    const later = store.get().cases[id]!.stages.map((s) => s.id);
    expect(later).toEqual(first);
    // 輪次有往前走，證明這確實是「重送」而不是沒發生任何事
    expect(store.get().cases[id]!.round).toBeGreaterThan(1);
  });
});

describe("逐關指派", () => {
  test("assignments 蓋過範本預設，指定給誰就是誰", () => {
    const id = freshProject("lean");
    const defs = store.get().projects.find((p) => p.id === id);
    expect(defs?.workflowStages).toBeUndefined();

    // 先算出這一類會有哪幾關，才知道 stageDefId 要填什麼
    store.submitForReview(id, "c1");
    const landedIds = proj(id).workflowStages!.map((s) => s.id);

    // 換一個新專案重來一次，這次帶指派
    const id2 = freshProject("lean");
    store.submitForReview(id2, "c1", { [landedIds[0]!]: WL_APPROVER });

    const stages = store.get().cases[id2]!.stages;
    expect(stages[0]!.assigneeId).toBe(WL_APPROVER);
    expect(stages[0]!.assigneeName).toBe("核准者");
    expect(stages[0]!.state).toBe("pending");
  });

  test("明確給 null = 這一關不派人，跟「沒提到這一關」不同", () => {
    const id = freshProject("lean");
    store.submitForReview(id, "c1");
    const first = proj(id).workflowStages![0]!.id;

    const id2 = freshProject("lean");
    store.submitForReview(id2, "c1", { [first]: null });
    expect(store.get().cases[id2]!.stages[0]!.assigneeId).toBeNull();
    expect(store.get().cases[id2]!.stages[0]!.state).toBe("empty");
  });
});

describe("舊資料相容", () => {
  test("跑到一半、沒有落地欄位的案子不會被換掉關卡", () => {
    const id = freshProject("lean");
    // 手動造出「舊資料」的形狀：個案已經綁過快照、也簽掉一關，但專案沒有
    // workflowStages。這正是升級前送出去的案子長的樣子
    store.submitForReview(id, "c1");
    const oldIds = store.get().cases[id]!.stages.map((s) => s.id);
    const oldNames = stageNames(id);

    store.setCurrentUser(WL_ADMIN);
    store.approveAndLock({ stageIds: [oldIds[0]!], comment: "第一輪先過" });

    // 抹掉落地欄位，模擬升級前的專案：個案跑到一半，但專案上沒有 workflowStages
    store.setProjects(
      store.get().projects.map((x) => {
        if (x.id !== id) return x;
        const { workflowStages: _drop, ...rest } = x;
        return rest;
      }),
    );
    expect(proj(id).workflowStages).toBeUndefined();

    store.submitForReview(id, "c2");

    // 關卡 id 與名字都不能變 —— 變了第一輪的決策就變成「（已移除的關卡）」
    expect(store.get().cases[id]!.stages.map((s) => s.id)).toEqual(oldIds);
    expect(stageNames(id)).toEqual(oldNames);
    // 而且流程被補寫回專案上，下次不用再靠反推
    expect(proj(id).workflowStages!.map((s) => s.name)).toEqual(oldNames);
  });

  test("migrateProject 讀得回 workflowStages 與 templateCat", () => {
    const raw = {
      id: "mig",
      title: "移轉",
      owner: "x",
      templateCat: "enterprise",
      workflowStages: [
        {
          id: "ws-x",
          order: 1,
          name: "關卡",
          defaultAssigneeId: null,
          required: true,
          mode: "sequential",
          kind: "review",
          defaultActor: "agent",
        },
      ],
    };
    const p = migrateProject(raw, []);
    expect(p.templateCat).toBe("enterprise");
    expect(p.workflowStages).toHaveLength(1);
    expect(p.workflowStages![0]!.kind).toBe("review");
  });

  test("沒有這些欄位的舊專案讀回來是 undefined，不是空陣列", () => {
    const p = migrateProject({ id: "mig2", title: "舊", owner: "x" }, []);
    // 空陣列會被當成「這個專案的流程真的沒有關卡」—— 那是完全不同的意思
    expect(p.workflowStages).toBeUndefined();
    expect(p.templateCat).toBeUndefined();
  });
});
