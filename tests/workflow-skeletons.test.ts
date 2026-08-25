/**
 * W2-C 管理中心：關卡欄位、五類骨架、落地流程檢視。
 *
 * ## 這一支在防什麼
 *
 * 兩個**不同**的失敗形狀，兩者的共同症狀都是「畫面正常，功能是零」：
 *
 * 1. **F0 的形狀**（C-1）：`kind` / `defaultActor` / `editTarget` 是 Wave 1 就加好、
 *    `updateWorkflowStage` 也收得下的三個欄位，但管理中心一直只傳四個。從 store
 *    出發的測試永遠驗不到那一行 —— 測試自己傳七個參數，驗的是一條生產程式碼
 *    走不到的路徑。所以這裡有一段 source-grep：驗的是**那一行程式碼**。
 *
 * 2. **改了不生效的表單**（C-2）：`resolveWorkflowFor` 若直接讀
 *    `SEED_WORKFLOW_SKELETONS`，整塊骨架編輯 UI 就是一個存得進去、重新載入還在、
 *    送審卻完全不理它的表單。這比沒做還糟：使用者會相信他改過了。
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Project, Section, WorkflowStageDef } from "../src/data/types";
import { FULL_CATS } from "../src/data/types";
import {
  editFieldOptionsHtml,
  FULL_CAT_TITLE,
  landedFlowProjects,
  REAPPLY_COPY,
  skeletonLandedCounts,
  SKELETON_D2_NOTICE,
  stagePatchFrom,
  STAGE_FIELD_SEL,
  stageRowFieldsHtml,
  type StageFormRaw,
} from "../src/lib/workflow-admin";

/* ══ Part A：純函式（不碰 store）══════════════════════════════ */

function raw(patch: Partial<StageFormRaw> = {}): StageFormRaw {
  return {
    name: "結構審查",
    assigneeId: "",
    required: true,
    mode: "sequential",
    kind: "review",
    actor: "agent",
    editSectionId: "",
    editFieldKey: "",
    ...patch,
  };
}

describe("stagePatchFrom —— 三個 Wave 1 欄位真的被讀出來", () => {
  test("kind / defaultActor 原樣帶出去", () => {
    const p = stagePatchFrom(raw({ kind: "edit", actor: "human", editSectionId: "open", editFieldKey: "oq" }));
    expect(p.kind).toBe("edit");
    expect(p.defaultActor).toBe("human");
  });

  test("edit + 章節與欄位都選了 → editTarget 成形", () => {
    const p = stagePatchFrom(raw({ kind: "edit", editSectionId: "open", editFieldKey: "oq" }));
    expect(p.editTarget).toEqual({ sectionId: "open", fieldKey: "oq" });
  });

  /**
   * 只選章節不選欄位**不是**一個可寫入的位址。
   *
   * 存成 `{sectionId, fieldKey: ""}` 的話，落地時 `resolveEditTarget` 不會退回
   * 「開放問題」（它只認 undefined），而是往一個不存在的 key 寫 —— agent 跑完、
   * 使用者按下存檔，內容進到一個畫面上永遠顯示不出來的地方。
   */
  test("只選章節、沒選欄位 → 不成形，退回 undefined", () => {
    expect(stagePatchFrom(raw({ kind: "edit", editSectionId: "open", editFieldKey: "" })).editTarget)
      .toBeUndefined();
    expect(stagePatchFrom(raw({ kind: "edit", editSectionId: "", editFieldKey: "oq" })).editTarget)
      .toBeUndefined();
  });

  /**
   * 把改稿關卡改回審閱時，`editTarget` 必須被清掉。
   * 留著的話，使用者下次再切回改稿就會沿用一個他以為已經取消掉的欄位。
   */
  test("kind 改回 review → editTarget 一律清成 undefined", () => {
    const p = stagePatchFrom(raw({ kind: "review", editSectionId: "open", editFieldKey: "oq" }));
    expect(p.kind).toBe("review");
    expect(p.editTarget).toBeUndefined();
  });

  test("認不得的 kind / mode / actor 退回預設，不原樣塞進聯合型別", () => {
    const p = stagePatchFrom(raw({ kind: "<img>", actor: "robot", mode: "whatever" }));
    expect(p.kind).toBe("review");
    expect(p.defaultActor).toBe("agent");
    expect(p.mode).toBe("parallel");
  });

  test("空白關卡名退回「關卡」，不存一個看不見的關卡", () => {
    expect(stagePatchFrom(raw({ name: "   " })).name).toBe("關卡");
  });

  test("「— 待指派 —」的空字串要變成 null，不是空字串", () => {
    expect(stagePatchFrom(raw({ assigneeId: "" })).defaultAssigneeId).toBeNull();
    expect(stagePatchFrom(raw({ assigneeId: "e1" })).defaultAssigneeId).toBe("e1");
  });
});

/* ── 產生端與讀回端的迴路 ─────────────────────────────────── */

const SECTIONS: Section[] = [
  {
    id: "open",
    n: "08",
    title: "開放問題",
    desc: "",
    status: "empty",
    guide: "",
    tips: [],
    example: "",
    fields: [{ key: "oq", label: "待決事項", hint: "", type: "textarea", rows: 8, value: "" }],
    checks: [],
    score: 0,
  },
  {
    id: "summary",
    n: "01",
    title: "三行摘要",
    desc: "",
    status: "empty",
    guide: "",
    tips: [],
    example: "",
    fields: [{ key: "vision", label: "專案功能說明與願景", hint: "", type: "textarea", rows: 8, value: "" }],
    checks: [],
    score: 0,
  },
];

function stage(patch: Partial<WorkflowStageDef> = {}): WorkflowStageDef {
  return {
    id: "ws-1",
    order: 1,
    name: "結構審查",
    defaultAssigneeId: null,
    required: true,
    mode: "sequential",
    kind: "review",
    defaultActor: "agent",
    ...patch,
  };
}

describe("產生端與讀回端用的是同一組選擇器", () => {
  /**
   * **這一條是整支測試的樞紐。**
   *
   * 這個檔裡有兩段程式必須逐字一致：產生 HTML 的 class，與讀回時查的選擇器。
   * 兩邊各自打字面值的話，改了一邊沒改另一邊 —— 表單畫得出來、按下儲存卻讀回
   * 空字串，那一關就被靜默改成預設值（`kind` 退回 review、`editTarget` 被清掉）。
   * 沒有錯誤訊息，而使用者以為自己存好了一個會改內文的關卡。
   */
  test("stageRowFieldsHtml 產出的 class 涵蓋 readStageForm 要查的每一個", () => {
    const html = stageRowFieldsHtml(stage({ kind: "edit", editTarget: { sectionId: "open", fieldKey: "oq" } }), SECTIONS);
    for (const sel of [
      STAGE_FIELD_SEL.kind,
      STAGE_FIELD_SEL.actor,
      STAGE_FIELD_SEL.editSection,
      STAGE_FIELD_SEL.editField,
    ]) {
      expect(html).toContain(`class="${sel.slice(1)}"`);
    }
  });

  test("edit 關卡的目標下拉預選現值 —— 不預選就等於每次存檔都重挑一次", () => {
    const html = stageRowFieldsHtml(
      stage({ kind: "edit", editTarget: { sectionId: "open", fieldKey: "oq" } }),
      SECTIONS,
    );
    expect(html).toContain('<option value="open" selected>');
    expect(html).toContain('<option value="oq" selected>');
  });

  test("review 關卡把覆寫目標那一組藏起來（但留在 DOM 裡）", () => {
    const html = stageRowFieldsHtml(stage({ kind: "review" }), SECTIONS);
    // 留在 DOM：切成 edit 時不必重畫整列，使用者同一列打到一半的關卡名才不會被丟掉
    expect(html).toContain(STAGE_FIELD_SEL.editSection.slice(1));
    expect(html).toContain("display:none");
  });

  test("edit 關卡不藏", () => {
    const html = stageRowFieldsHtml(stage({ kind: "edit" }), SECTIONS);
    const wrapAt = html.indexOf(STAGE_FIELD_SEL.editWrap.slice(1));
    expect(wrapAt).toBeGreaterThan(-1);
    expect(html.slice(wrapAt, wrapAt + 120)).not.toContain("display:none");
  });

  test("關卡名會被 escape —— 關卡名是使用者打的字", () => {
    const html = stageRowFieldsHtml(stage({ id: '"><script>x</script>' }), SECTIONS);
    expect(html).not.toContain("<script>");
  });

  test("editFieldOptionsHtml 只列那個章節的欄位", () => {
    expect(editFieldOptionsHtml(SECTIONS, "open", "")).toContain("待決事項");
    expect(editFieldOptionsHtml(SECTIONS, "open", "")).not.toContain("專案功能說明與願景");
    // 查不到的章節 → 只剩「不指定」，不是崩掉
    expect(editFieldOptionsHtml(SECTIONS, "nope", "")).toContain("— 不指定 —");
  });
});

/* ── 落地統計 ────────────────────────────────────────────── */

function proj(patch: Partial<Project>): Project {
  return {
    id: "x",
    title: "x",
    status: "draft",
    pct: 0,
    owner: "o",
    ownerId: "",
    authorId: "",
    authorAgentFamily: null,
    mine: true,
    updated: "",
    tag: "product",
    isSample: false,
    isImported: false,
    ...patch,
  } as Project;
}

describe("skeletonLandedCounts —— D2 那句話的證據", () => {
  test("只算落地過的；沒有 workflowStages 的不算", () => {
    const counts = skeletonLandedCounts([
      proj({ id: "a", templateCat: "enterprise", workflowStages: [stage()] }),
      proj({ id: "b", templateCat: "enterprise" }),
    ]);
    expect(counts.enterprise).toBe(1);
  });

  test("沒有 templateCat 的算 lean —— 跟 resolveWorkflow 的 FALLBACK_CAT 一致", () => {
    const counts = skeletonLandedCounts([proj({ id: "a", workflowStages: [stage()] })]);
    expect(counts.lean).toBe(1);
  });

  /**
   * 自訂範本自帶骨架的專案落地的是**範本自己那一份**，不是這五類裡的任何一份。
   * 算進去的話，使用者改了 lean 骨架卻發現計數裡有一個毫無關係的專案。
   */
  test("自帶骨架（templateStages）的專案不算進任何一類", () => {
    const counts = skeletonLandedCounts([
      proj({ id: "a", templateCat: "lean", templateStages: [stage()], workflowStages: [stage()] }),
    ]);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(0);
  });

  test("五類都給得出數字 —— 少一類畫面會印出 undefined", () => {
    const counts = skeletonLandedCounts([]);
    expect(Object.keys(counts).sort()).toEqual([...FULL_CATS].sort());
  });

  test("landedFlowProjects 只回落地過的，且不重排", () => {
    const list = landedFlowProjects([
      proj({ id: "a", workflowStages: [stage()] }),
      proj({ id: "b" }),
      proj({ id: "c", workflowStages: [stage()] }),
    ]);
    expect(list.map((p) => p.id)).toEqual(["a", "c"]);
  });
});

describe("五類的標題", () => {
  test("FULL_CAT_TITLE 五類都有 —— 少一類收合區的標題會是 undefined", () => {
    expect(Object.keys(FULL_CAT_TITLE).sort()).toEqual([...FULL_CATS].sort());
  });
});

/* ══ Part B：store（骨架覆寫真的被送審讀到）═══════════════════ */

mock.module("../src/data/domains", () => ({
  BUILTIN_PACKS: {},
  builtinSource: () => null,
  reloadUserPacks: () => {},
  domainPacks: () => ({}),
  isUserPack: () => false,
  listDomains: () => [],
  DEFAULT_DOMAIN: "generic",
}));

/**
 * **字串必須跟 `agent-result-landing.test.ts` / `pending-gate.test.ts` 逐字相同。**
 * `mock.module` 在 bun 是全域的 —— 兩邊回傳不同字串時，誰先跑就決定另一邊會不會紅。
 */
const AGENT_OUTPUT = "建議修改\n\n這段文字是 Agent 產出的，沒有按存檔就不該出現在任何地方。";
mock.module("../src/lib/ai-coach", () => ({
  isAiConfigured: () => true,
  runAgentTask: async () => AGENT_OUTPUT,
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

const { store } = await import("../src/data/store");

// id 一律帶檔名前綴 —— store 是跨檔共用的單例，通用 id 會抓到別人的東西
const ADMIN = "wsk-admin";
const EDITOR = "wsk-editor";

function ensureEmployee(e: Record<string, unknown>) {
  if (!store.get().employees.some((x) => x.id === e.id)) store.addEmployee(e as never);
}

function bootstrap() {
  ensureEmployee({
    id: ADMIN,
    name: "骨架測試管理員",
    kind: "human",
    accessRole: "admin",
    active: true,
    isCurrent: true,
  });
  ensureEmployee({
    id: EDITOR,
    name: "骨架測試編輯",
    kind: "human",
    accessRole: "editor",
    active: true,
  });
  store.setCurrentUser(ADMIN);
}

function freshProject(id: string, cat: "lean" | "enterprise" = "lean") {
  if (!store.get().projects.some((p) => p.id === id)) {
    store.addProject({
      id,
      title: `骨架測試 ${id}`,
      status: "draft",
      pct: 0,
      owner: "骨架測試管理員",
      domain: "generic",
      templateCat: cat,
    } as never);
  }
  store.setActiveProject(id);
  return id;
}

function human(id: string): WorkflowStageDef {
  // `hasHumanApproval` 同時要求名字是「我核准」**且** defaultActor 是 human
  return {
    id,
    order: 99,
    name: "我核准",
    defaultAssigneeId: null,
    required: true,
    mode: "sequential",
    kind: "review",
    defaultActor: "human",
  };
}

beforeEach(() => {
  bootstrap();
});

afterEach(() => {
  // store 是跨檔共用的單例 —— 不還原的話，後面跑到的測試檔會拿到一份被改過的
  // lean 骨架，而那種失敗只在整批跑時出現、單檔跑全綠
  for (const cat of FULL_CATS) store.resetWorkflowSkeleton(cat);
});

describe("workflowSkeletons —— 覆寫優先，否則種子", () => {
  test("沒改過時五類都給得出內容，而且都含「我核准」", () => {
    const sk = store.workflowSkeletons();
    for (const cat of FULL_CATS) {
      expect(sk[cat].length).toBeGreaterThan(0);
      expect(sk[cat].some((s) => s.name === "我核准")).toBe(true);
    }
  });

  test("回傳的是複本 —— 改它不該動到 store 裡的骨架", () => {
    const a = store.workflowSkeletons();
    a.lean[0]!.name = "被外面改掉了";
    expect(store.workflowSkeletons().lean[0]!.name).not.toBe("被外面改掉了");
  });
});

describe("setWorkflowSkeleton 的兩條拒絕路徑", () => {
  test("空陣列被拒 —— 零關卡的流程送出去就永遠結不了案", () => {
    const before = store.workflowSkeletons().lean;
    const r = store.setWorkflowSkeleton("lean", []);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("不能是空的");
    // 拒絕就是完全沒發生
    expect(store.workflowSkeletons().lean).toEqual(before);
  });

  test("沒有「我核准」被拒 —— 這一類 PRD 就再也沒有人簽過", () => {
    const r = store.setWorkflowSkeleton("lean", [
      { ...human("x"), name: "AI 自己核准", defaultActor: "agent", kind: "review" },
    ]);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("一定要留一關由人核准");
  });

  /**
   * 一關叫「我核准」但 `defaultActor` 是 agent，等於讓 agent 核准自己的分析。
   * `hasHumanApproval` 兩個條件都查，這一條把它釘住。
   */
  test("名字對但預設執行者是 agent 的「我核准」不算數", () => {
    const r = store.setWorkflowSkeleton("lean", [{ ...human("x"), defaultActor: "agent" }]);
    expect(r.ok).toBe(false);
  });

  test("合法的骨架存得進去，order 重編成 1..n", () => {
    const r = store.setWorkflowSkeleton("lean", [
      { ...human("wsk-a"), name: "自訂第一關", defaultActor: "agent", order: 77 },
      { ...human("wsk-b"), order: 3 },
    ]);
    expect(r.ok).toBe(true);
    expect(store.workflowSkeletons().lean.map((s) => s.order)).toEqual([1, 2]);
    expect(store.workflowSkeletons().lean[0]!.name).toBe("自訂第一關");
  });

  test("resetWorkflowSkeleton 還原成種子", () => {
    // 名字要留「我核准」—— 改掉就會被 hasHumanApproval 擋下來，
    // 於是骨架根本沒被覆寫，而這一條要測的是「覆寫之後還原得回來」
    expect(store.setWorkflowSkeleton("lean", [human("wsk-a")]).ok).toBe(true);
    expect(store.workflowSkeletons().lean.length).toBe(1);
    store.resetWorkflowSkeleton("lean");
    expect(store.workflowSkeletons().lean.some((s) => s.name === "AI 結構審查")).toBe(true);
  });

  test("改 lean 不會動到別的四類", () => {
    const before = store.workflowSkeletons().enterprise;
    expect(store.setWorkflowSkeleton("lean", [human("wsk-a")]).ok).toBe(true);
    expect(store.workflowSkeletons().enterprise).toEqual(before);
  });
});

describe("resolveWorkflowFor 真的讀 workflowSkeletons()", () => {
  /**
   * **這是 C-2 唯一真正重要的一條。**
   *
   * `resolveWorkflowFor` 若直接讀 `SEED_WORKFLOW_SKELETONS`，整塊骨架編輯 UI
   * 就是一個改了不生效的表單：存得進去、重新載入還在、送審卻完全不理它。
   * 比沒做還糟 —— 使用者會相信他改過了。
   */
  test("改過骨架的分類，新專案送審落地的是改後的關卡", () => {
    store.setWorkflowSkeleton("lean", [
      { ...human("wsk-custom-1"), name: "自訂稽核關", defaultActor: "agent", kind: "review" },
      human("wsk-custom-approve"),
    ]);
    const id = freshProject("wsk-p-live", "lean");
    expect(store.submitPlan(id).landsNow).toBe(true);
    expect(store.submitPlan(id).stages.map((s) => s.name)).toEqual(["自訂稽核關", "我核准"]);

    store.submitForReview(id);
    const landed = store.get().projects.find((p) => p.id === id)!.workflowStages!;
    expect(landed.map((s) => s.name)).toEqual(["自訂稽核關", "我核准"]);
  });

  /**
   * D2：落地後不重算。改骨架**只影響之後第一次送審的專案**。
   * 這一條是畫面上那句警語的可執行版本。
   */
  test("已落地的專案不跟著改 —— D2", () => {
    const id = freshProject("wsk-p-d2", "lean");
    store.submitForReview(id);
    const before = store.get().projects.find((p) => p.id === id)!.workflowStages!;

    store.setWorkflowSkeleton("lean", [
      { ...human("wsk-d2-1"), name: "之後才加的關", defaultActor: "agent" },
      human("wsk-d2-approve"),
    ]);
    store.submitForReview(id);

    const after = store.get().projects.find((p) => p.id === id)!.workflowStages!;
    expect(after).toEqual(before);
    expect(after.some((s) => s.name === "之後才加的關")).toBe(false);
  });
});

describe("reapplyWorkflow", () => {
  test("清掉落地流程之後，下一次送審重新照骨架解析", () => {
    const id = freshProject("wsk-p-reapply", "lean");
    store.submitForReview(id);
    expect(store.get().projects.find((p) => p.id === id)!.workflowStages).toBeDefined();

    expect(store.reapplyWorkflow(id).ok).toBe(true);
    const p = store.get().projects.find((x) => x.id === id)!;
    expect(p.workflowStages).toBeUndefined();
    // key 真的被拿掉，不是留一個值是 undefined 的 key
    expect("workflowStages" in p).toBe(false);
  });

  /**
   * 個案的 stages **不動**。在這裡順手砍掉的話，一個跑到一半的案子會連同
   * 已經簽過的關卡與 agent 分析一起消失 —— 而那正是簽核紀錄的全部價值。
   */
  test("不動個案的 stages", () => {
    const id = freshProject("wsk-p-case", "lean");
    store.submitForReview(id);
    const before = store.get().cases[id]!.stages;
    store.reapplyWorkflow(id);
    expect(store.get().cases[id]!.stages).toEqual(before);
  });

  /**
   * **這一條是把限制變成寫下來的合約。**
   *
   * `reapplyWorkflow` 只清 `project.workflowStages`。對一個**已經跑過簽核**的案子，
   * `submitPlanFor` 走 `caseHasRun(live) === true` → `workflowFromCase(live)`，
   * 從個案自己反推流程，根本不回頭讀骨架。所以重套對它做的事是：清掉一份沒人會
   * 再讀的紀錄，其餘什麼都沒發生。
   *
   * 這個行為是規格拍板的（「不要順手把個案的 stages 也砍掉」），不是 bug。
   * 但第一版 UI 文案對使用者說「簽核狀態會被清掉、關卡會換一份」—— 兩句都是假的，
   * 而且是一顆 `danger: true` 的鈕在說謊。行為留著、文案對齊，並用這一條釘住：
   * 之後有人要改行為，會先撞到它。
   */
  test("跑過的案子：重套之後仍不重解析，且既有簽章原封不動", () => {
    const id = freshProject("wsk-p-ran", "lean");
    store.submitForReview(id);

    // 簽掉第一關 —— 這就是「跑過」的痕跡（caseHasRun 為 true）
    const first = store.get().cases[id]!.stages[0]!;
    store.approveAndLock({ stageIds: [first.id] });
    const signedBefore = store
      .get()
      .cases[id]!.stages.map((s) => `${s.id}:${s.state}`);
    expect(signedBefore.some((x) => x.endsWith(":approved"))).toBe(true);

    expect(store.reapplyWorkflow(id).ok).toBe(true);

    // 落地紀錄清掉了……
    expect(store.get().projects.find((p) => p.id === id)!.workflowStages).toBeUndefined();
    // ……但下次送審**不會**重新解析，而且簽章一個都沒掉
    expect(store.submitPlan(id).landsNow).toBe(false);
    expect(store.get().cases[id]!.stages.map((s) => `${s.id}:${s.state}`)).toEqual(signedBefore);
  });

  /** 對照組：沒有簽核痕跡的案子，重套是真的有效的 */
  test("沒跑過的案子：重套之後下次送審真的重新解析", () => {
    const id = freshProject("wsk-p-notrun", "lean");
    store.submitForReview(id);
    expect(store.reapplyWorkflow(id).ok).toBe(true);
    expect(store.submitPlan(id).landsNow).toBe(true);
  });

  test("找不到專案時據實回報，不當作成功", () => {
    const r = store.reapplyWorkflow("wsk-does-not-exist");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("找不到");
  });

  test("非管理員被拒", () => {
    const id = freshProject("wsk-p-perm", "lean");
    store.submitForReview(id);
    store.setCurrentUser(EDITOR);
    const r = store.reapplyWorkflow(id);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("僅管理員");
    // 拒絕就是完全沒發生
    expect(store.get().projects.find((p) => p.id === id)!.workflowStages).toBeDefined();
    store.setCurrentUser(ADMIN);
  });

  test("已抽單的案子要走「重開案件」，不是重套", () => {
    const id = freshProject("wsk-p-withdrawn", "lean");
    store.submitForReview(id);
    store.withdrawCase(id, "測試抽單");
    const r = store.reapplyWorkflow(id);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("重開案件");
  });
});

/* ══ Part C：admin.ts 真的把東西交出去了（source-grep）═══════ */

/**
 * **這一段驗的是那幾行程式碼，不是 store 的行為。**
 *
 * Wave 1 的 F0 根因是生產呼叫端少傳參數，而它是全 repo 唯一的呼叫端。任何從
 * store API 出發的測試都驗不到它 —— 測試自己傳完整的 patch，驗的是一條生產
 * 程式碼走不到的路徑，1563 個測試因此全綠。
 */
describe("admin.ts 真的把三個欄位交給了 store", () => {
  const ADMIN_SRC = readFileSync(new URL("../src/pages/admin.ts", import.meta.url), "utf8");
  const STORE_SRC = readFileSync(new URL("../src/data/store.ts", import.meta.url), "utf8");

  test("儲存關卡走共用的 readStageForm + stagePatchFrom（兩個儲存點都要）", () => {
    // 頁面自己刻一份讀回邏輯的話，測試驗的規則跟畫面上跑的規則會分岔。
    //
    // 2026-08-26 改成計數（Cato 審查報告 §E 的具體建議）：原本是
    // `toContain(...)`，只要求這個字串**出現一次**。但 admin.ts 有**兩個**
    // 儲存點（全域關卡編輯器與骨架編輯器），其中一處退回舊寫法，
    // 這條照樣綠 —— 而那正是它要防的東西。斷言只變嚴，沒有放寬。
    expect((ADMIN_SRC.match(/stagePatchFrom\(readStageForm\(/g) ?? []).length).toBe(2);
  });

  test("updateWorkflowStage 收到的是完整 patch，不是四個欄位的字面值", () => {
    const call = ADMIN_SRC.match(/store\.updateWorkflowStage\([\s\S]{0,160}?\);/);
    expect(call).not.toBeNull();
    // 舊版是 `{ name, defaultAssigneeId, required, mode }` —— 三個新欄位全漏
    expect(call![0]).not.toContain("defaultAssigneeId,");
    expect(call![0]).toContain("stagePatchFrom");
  });

  test("關卡列真的畫得出三個欄位 —— 用共用的 stageRowFieldsHtml", () => {
    expect(ADMIN_SRC).toContain("stageRowFieldsHtml(");
  });

  test("骨架編輯接的是 store 的三支，不是自己動 state", () => {
    expect(ADMIN_SRC).toContain("store.workflowSkeletons()");
    expect(ADMIN_SRC).toContain("store.setWorkflowSkeleton(");
    expect(ADMIN_SRC).toContain("store.resetWorkflowSkeleton(");
    expect(ADMIN_SRC).toContain("store.reapplyWorkflow(");
  });

  /**
   * 管理中心自己去讀 `SEED_WORKFLOW_SKELETONS` 的話，畫面會永遠顯示種子 ——
   * 使用者改完看到的是改前的內容，於是再改一次，然後以為存檔壞了。
   */
  test("管理中心不自己讀種子骨架", () => {
    expect(ADMIN_SRC).not.toContain("SEED_WORKFLOW_SKELETONS");
  });

  /**
   * D2 那句話**必須印在畫面上**。使用者改完骨架、回頭看現有專案完全沒變，
   * 第一個念頭是「沒存到」，然後去別的地方找開關改。
   */
  test("D2 的警語真的被印出來", () => {
    expect(ADMIN_SRC).toContain("SKELETON_D2_NOTICE");
    expect(SKELETON_D2_NOTICE).toContain("只影響之後第一次送審");
    expect(ADMIN_SRC).toContain("個專案落地了這一份");
  });

  test("重新套用範本只有管理員看得到", () => {
    // slice 的下界要卡在下一個 render 函式 —— 吃到 renderCases 的話，
    // 「唯讀」那一條會被個案調整區的 case-reassign 誤判
    const block = ADMIN_SRC.slice(
      ADMIN_SRC.indexOf("function renderLandedFlows"),
      ADMIN_SRC.indexOf("function renderCases"),
    );
    expect(block).toContain('accessRole === "admin"');
    expect(block).toContain("lf-reapply");
    // 唯讀檢視：那一塊不得出現任何指派用的 select
    expect(block).not.toContain("case-reassign");
  });

  /**
   * 第一版文案說「簽核狀態會被清掉……關卡與已簽的紀錄都會換一份」，而實測是
   * `approved` 原封不動、`landsNow: false`。**一顆 danger 鈕在說「我會破壞你的
   * 東西」，而它什麼都沒做** —— 使用者要嘛不敢按，要嘛按了以為重套好了。
   */
  test("文案不再宣稱會清掉簽核狀態 —— 那句話是假的", () => {
    expect(ADMIN_SRC).not.toContain("簽核狀態會被清掉");
    expect(ADMIN_SRC).not.toContain("已簽的紀錄都會換一份");
    expect(REAPPLY_COPY.freshBody).not.toContain("簽核狀態會被清掉");
  });

  test("有效／不生效兩種案子各有自己的文案，而且不生效那份指得出路", () => {
    // 有效的那條講「還沒有任何簽核痕跡」，不是泛泛的「會重新解析」
    expect(REAPPLY_COPY.freshBody).toContain("還沒有任何簽核痕跡");
    // 不生效的那條要明講不生效，並指向真的做得到的地方
    expect(REAPPLY_COPY.ranNote).toContain("不生效");
    expect(REAPPLY_COPY.ranNote).toContain("套用目前流程");
  });

  test("「這顆鈕有沒有效」問 store.submitPlan，UI 不自己重寫一份 caseHasRun", () => {
    const block = ADMIN_SRC.slice(
      ADMIN_SRC.indexOf("function reapplyEffective"),
      ADMIN_SRC.indexOf("function renderCases"),
    );
    expect(block).toContain("store.submitPlan(projectId).landsNow");
    // 重寫一份判斷 = 兩份會分岔，而分岔的症狀正是這一批在修的東西：
    // 畫面說的跟實際發生的不是同一件事
    expect(ADMIN_SRC).not.toContain("caseHasRun(");
  });

  test("跑過的案子把鈕停用，而且旁邊講得出原因", () => {
    const block = ADMIN_SRC.slice(
      ADMIN_SRC.indexOf("function reapplyBlockHtml"),
      ADMIN_SRC.indexOf("function renderLandedFlows"),
    );
    expect(block).toContain("disabled");
    expect(block).toContain("REAPPLY_COPY.ranNote");
    expect(block).toContain("不生效");
  });

  test("點下去之前再問一次 —— disabled 只是 DOM 狀態，不是守衛", () => {
    const block = ADMIN_SRC.slice(
      ADMIN_SRC.indexOf('querySelector(".lf-reapply")'),
      ADMIN_SRC.indexOf("function renderCases"),
    );
    expect(block).toContain("if (!reapplyEffective(pid))");
    expect(block).toContain("danger: true");
  });

  /**
   * `resolveWorkflow` 的第三個參數就是為 C-2 留的 —— 簽名不得改動，
   * 而 `resolveWorkflowFor` 必須真的把骨架餵進去。
   */
  test("resolveWorkflowFor 餵的是 liveSkeletons()，不是種子", () => {
    const fn = STORE_SRC.slice(
      STORE_SRC.indexOf("function resolveWorkflowFor"),
      STORE_SRC.indexOf("function workflowFor"),
    );
    expect(fn).toContain("liveSkeletons()");
    expect(fn).not.toContain("SEED_WORKFLOW_SKELETONS");
  });
});

describe("admin.html 有這兩塊的掛載點", () => {
  const HTML = readFileSync(new URL("../admin.html", import.meta.url), "utf8");

  test("兩個分頁與兩個容器都在 —— 少了容器，render 會 return 而且不報錯", () => {
    expect(HTML).toContain('data-tab="skeletons"');
    expect(HTML).toContain('data-tab="landed"');
    expect(HTML).toContain('id="panel-skeletons"');
    expect(HTML).toContain('id="panel-landed"');
    expect(HTML).toContain('id="skeleton-list"');
    expect(HTML).toContain('id="landed-flow-list"');
  });
});
