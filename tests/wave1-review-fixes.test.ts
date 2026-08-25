/**
 * Wave 1 跨廠商審查（`plans/review-wave1-forge.md`）抓到的六條缺陷。
 *
 * ## 為什麼這一支獨立成檔
 *
 * 六條缺陷的**形狀完全相同**：規則寫對了，但掛在一條真實流程走不到的路徑上，
 * 於是針對規則本身寫的單元測試全綠。Wave 1 的 1563 個測試沒有一個是從
 * 「頁面怎麼呼叫 store」或「agent 執行 → 人簽核」這種端到端順序跑下來的 ——
 * 這一支就是補那條縫。
 *
 * 所以這裡的每一條測試都刻意從**呼叫端的形狀**出發，而不是從 store API 的
 * 參數表出發。`templateWorkflowArg` 那幾條甚至直接讀 `src/pages/templates.ts`
 * 的原始碼：F0 的根因是那一行少傳一個參數，而任何只呼叫 store 的測試
 * 都驗不到那一行存不存在。
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

// 領域包目錄用 `import.meta.glob`（Vite 專屬），bun 跑不動 —— 換成通用領域。
// 這也讓「骨架來自範本分類」這件事單獨可測：generic 不追加任何合規關卡。
mock.module("../src/data/domains", () => ({
  BUILTIN_PACKS: {},
  builtinSource: () => null,
  reloadUserPacks: () => {},
  domainPacks: () => ({}),
  isUserPack: () => false,
  listDomains: () => [],
  DEFAULT_DOMAIN: "generic",
}));

const AGENT_OUTPUT = "建議修改\n\n這是 Agent 的分析全文，它不是簽核者留的話。";
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
const { templateWorkflowArg } = await import("../src/lib/prd-template");
const { canSignStage, caseHasRun, separationOfDuties } = await import("../src/lib/signoff");
import { jobLanded } from "../src/data/types";
import type { CaseRecord, CaseStage, Employee, Project, Template } from "../src/data/types";

// ── fixtures ────────────────────────────────────────────────
//
// id 一律帶檔名前綴：`bun test` 全部跑在同一個 process，`store` 是模組層單例，
// 通用 id 會跟別的測試檔撞號。

const ADMIN = "wrf-admin";
const AGENT_CLAUDE = "wrf-agent-claude";
const AGENT_CODEX = "wrf-agent-codex";
/** `edit` 任務要編輯角色 —— 審查用的 approver agent 呼叫不動它 */
const AGENT_CODEX_EDIT = "wrf-agent-codex-edit";

function ensureEmployee(e: Record<string, unknown>) {
  if (!store.get().employees.some((x) => x.id === e.id)) store.addEmployee(e as never);
}

let seq = 0;
/** 每條測試都要新專案：落地過的專案照 D2 不再重解析，第二次套範本不換關卡 */
function fresh(opts: { authorAgentFamily?: string } = {}) {
  const id = `wrf-${++seq}`;
  store.addProject({
    id,
    title: `審查修復 ${id}`,
    status: "draft",
    pct: 0,
    owner: "測試管理員",
    domain: "generic",
    ...(opts.authorAgentFamily ? { authorAgentFamily: opts.authorAgentFamily } : {}),
  } as never);
  store.setActiveProject(id);
  return id;
}

/** 一份整份範本長什麼樣 —— 形狀照 `Template`，不是照 store 參數表 */
function fullTemplate(cat: Template["cat"]): Template {
  return { id: `tpl-${cat}`, title: `範本 ${cat}`, cat, kind: "full", body: "# x" } as Template;
}

const proj = (id: string) => store.get().projects.find((p) => p.id === id)!;
const stageNames = (id: string) => store.get().cases[id]!.stages.map((s) => s.name);

async function waitForJob(jobId: string, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const j = store.get().agentJobs.find((x) => x.id === jobId);
    if (j && (j.status === "done" || j.status === "failed")) return j;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`工作單 ${jobId} 沒有在時限內跑完`);
}

beforeEach(() => {
  ensureEmployee({
    id: ADMIN,
    name: "測試管理員",
    kind: "human",
    accessRole: "admin",
    active: true,
    isCurrent: true,
  });
  ensureEmployee({
    id: AGENT_CLAUDE,
    name: "Claude 審閱",
    kind: "agent",
    accessRole: "approver",
    agentFamily: "claude",
    active: true,
    agentEnabled: true,
  });
  ensureEmployee({
    id: AGENT_CODEX,
    name: "Codex 審閱",
    kind: "agent",
    accessRole: "approver",
    agentFamily: "codex",
    active: true,
    agentEnabled: true,
  });
  ensureEmployee({
    id: AGENT_CODEX_EDIT,
    name: "Codex 編輯",
    kind: "agent",
    accessRole: "editor",
    agentFamily: "codex",
    active: true,
    agentEnabled: true,
  });
  store.setCurrentUser(ADMIN);
});

// ── F0 ──────────────────────────────────────────────────────

describe("F0：五類骨架要在真實呼叫路徑上生效", () => {
  const TEMPLATES_SRC = readFileSync(new URL("../src/pages/templates.ts", import.meta.url), "utf8");

  /**
   * 這一條驗的是**那一行程式碼**，不是 store 的行為。
   *
   * F0 的根因是 `templates.ts` 少傳第 4 個參數，而它是全 repo 唯一的生產呼叫端。
   * 任何從 store API 出發的測試都驗不到它 —— Wave 1 的
   * `workflow-landing.test.ts` 自己傳四個參數，所以驗的是一條生產程式碼
   * 走不到的路徑，1563 個測試因此全綠。
   */
  test("templates.ts 套用整份範本時有把簽核骨架傳進去", () => {
    const call = TEMPLATES_SRC.match(/store\.applyFullTemplate\([\s\S]{0,400}?\);/);
    expect(call).not.toBeNull();
    expect(call![0]).toContain("templateWorkflowArg(");
  });

  test("整份範本給得出分類；章節範本不給 —— 它的 cat 不對應任何骨架", () => {
    expect(templateWorkflowArg(fullTemplate("enterprise"))).toEqual({ cat: "enterprise" });
    const section = { id: "s1", title: "資安段落", cat: "security", kind: "section", body: "# x" } as Template;
    expect(templateWorkflowArg(section)).toBeUndefined();
  });

  test("自訂範本自帶骨架時一起帶過去", () => {
    const t = fullTemplate("technical");
    t.stages = [
      { id: "ws-x", order: 1, name: "自訂關卡", defaultAssigneeId: null, required: true, mode: "sequential", kind: "review", defaultActor: "agent" },
    ];
    expect(templateWorkflowArg(t)).toEqual({ cat: "technical", stages: t.stages });
  });

  test("照 templates.ts 的呼叫形狀套範本 → 送審落地的是 enterprise 五關", () => {
    const id = fresh();
    const current = fullTemplate("enterprise");
    // 逐字複製 `templates.ts` 的呼叫形狀：第 4 個參數由 templateWorkflowArg 產生
    store.applyFullTemplate(id, store.get().sections, {}, templateWorkflowArg(current));
    expect(proj(id).templateCat).toBe("enterprise");

    store.submitForReview(id, "c1");
    expect(stageNames(id)).toEqual([
      "結構完整度",
      "風險與相依",
      "技術可行性",
      "文件補完",
      "我核准",
    ]);
  });
});

// ── F1 ──────────────────────────────────────────────────────

describe("F1：跑過的判準不能被「加註一句意見」汙染", () => {
  const kase = (p: Partial<CaseRecord>): CaseRecord => ({
    projectId: "p1",
    reviewCommitId: null,
    stages: [],
    log: [],
    withdrawn: false,
    withdrawnAt: null,
    withdrawnBy: null,
    withdrawReason: null,
    locked: false,
    ...p,
  });
  const st = (p: Partial<CaseStage>): CaseStage => ({
    id: "cs1",
    stageDefId: "ws1",
    order: 1,
    name: "工程",
    assigneeId: null,
    assigneeName: "待指派",
    state: "empty",
    ...p,
  });

  test("只有保留意見 → 沒跑過。這一條錯了，範本骨架就永遠不會出現", () => {
    const c = kase({
      log: [{ id: "d1", stageId: "cs1", round: 1, at: "t", byId: "u1", byName: "我", kind: "comment", comment: "先問一句" }],
      stages: [st({})],
    });
    expect(caseHasRun(c)).toBe(false);
  });

  test("核准／要求修改／略過都算跑過", () => {
    for (const kind of ["approved", "changes_requested", "skipped"] as const) {
      expect(caseHasRun(kase({ stages: [st({ state: kind })] }))).toBe(true);
    }
  });

  test("略過**單靠關卡狀態**就要算跑過 —— 不能靠 log 剛好也有一筆來補償", () => {
    // log 刻意留空：Wave 1 靠 skipStage 順手寫的 log 撐住這一格，
    // 那是兩個判準互相補償的巧合，修 F1 把 log 收緊之後就會漏
    expect(caseHasRun(kase({ log: [], stages: [st({ state: "skipped" })] }))).toBe(true);
  });

  test("綁過快照算跑過；空個案不算", () => {
    expect(caseHasRun(kase({ reviewCommitId: "c1" }))).toBe(true);
    expect(caseHasRun(kase({}))).toBe(false);
    expect(caseHasRun(undefined)).toBe(false);
  });

  test("送審前加註一句意見，落地的仍是範本骨架而不是全域舊流程", () => {
    const id = fresh();
    store.applyFullTemplate(id, store.get().sections, {}, templateWorkflowArg(fullTemplate("enterprise")));

    // 建專案時就開好的那個個案走的是全域預設流程（工程／設計／資安／法務）
    const before = store.get().cases[id]!;
    expect(before.stages.length).toBeGreaterThan(0);
    // 還沒送審就加註 —— 現在要被擋下來，因為送審重建個案時它會靜默消失
    const r = store.addStageComment(before.stages[0]!.id, "先問一句");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("還沒送出審閱");

    store.submitForReview(id, "c1");
    expect(stageNames(id)).toEqual([
      "結構完整度",
      "風險與相依",
      "技術可行性",
      "文件補完",
      "我核准",
    ]);
    expect(proj(id).workflowStages!.map((s) => s.name)).toEqual(stageNames(id));
  });

  test("還沒送審的草稿專案簽不了核、退不了件、略不了關", () => {
    const id = fresh();
    const c = store.get().cases[id]!;
    expect(store.approveAndLock().ok).toBe(false);
    expect(store.requestChanges(c.stages[0]!.id, "不行").reason).toContain("還沒送出審閱");
    expect(store.skipStage(c.stages[0]!.id, "跳過").reason).toContain("還沒送出審閱");
  });
});

// ── F2 ──────────────────────────────────────────────────────

describe("F2：存下的 agent 分析不能在送審時靜默消失", () => {
  test("存過分析的個案算跑過 —— 重建會讓分析消失而且救不回來", () => {
    const c: CaseRecord = {
      projectId: "p1",
      reviewCommitId: null,
      stages: [
        {
          id: "cs1",
          stageDefId: "ws1",
          order: 1,
          name: "結構完整度",
          assigneeId: null,
          assigneeName: "待指派",
          state: "empty",
          agentResult: "一段分析",
        },
      ],
      log: [],
      withdrawn: false,
      withdrawnAt: null,
      withdrawnBy: null,
      withdrawReason: null,
      locked: false,
    };
    expect(caseHasRun(c)).toBe(true);
  });

  test("草稿專案的關卡跑不了 agent、也存不了結果 —— 那份分析註定會被重建吃掉", async () => {
    const id = fresh();
    store.applyFullTemplate(id, store.get().sections, {}, templateWorkflowArg(fullTemplate("lean")));
    const stage = store.get().cases[id]!.stages[0]!;

    const r = store.invokeAgent({ agentId: AGENT_CODEX, projectId: id, task: "review", stageId: stage.id });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("還沒送出審閱");
  });

  test("送審後存下的分析，重送審時還在", async () => {
    const id = fresh();
    store.applyFullTemplate(id, store.get().sections, {}, templateWorkflowArg(fullTemplate("lean")));
    store.submitForReview(id, "c1");
    const stage = store.get().cases[id]!.stages.find((s) => s.name === "AI 結構審查")!;

    const r = store.invokeAgent({ agentId: AGENT_CODEX, projectId: id, task: "review", stageId: stage.id });
    expect(r.ok).toBe(true);
    await waitForJob(r.jobId!);
    expect(store.saveAgentResult(r.jobId!)).toEqual({ ok: true });

    store.submitForReview(id, "c1");
    const after = store.get().cases[id]!.stages.find((s) => s.id === stage.id)!;
    expect(after.agentResult).toBe(AGENT_OUTPUT);
  });
});

// ── F3-1 / F3-2 / F3-3 ──────────────────────────────────────

describe("F3-1：agent 分析與簽核意見不共用一個欄位", () => {
  test("先簽核留話、再存 agent 分析 —— 簽核意見不被吃掉", async () => {
    const id = fresh();
    store.applyFullTemplate(id, store.get().sections, {}, templateWorkflowArg(fullTemplate("lean")));
    store.submitForReview(id, "c1");
    const stage = store.get().cases[id]!.stages.find((s) => s.name === "AI 結構審查")!;

    const r = store.invokeAgent({ agentId: AGENT_CODEX, projectId: id, task: "review", stageId: stage.id });
    await waitForJob(r.jobId!);

    store.approveAndLock({ stageIds: [stage.id], comment: "已確認，第 3 點下一版處理" });
    expect(store.saveAgentResult(r.jobId!)).toEqual({ ok: true });

    const after = store.get().cases[id]!.stages.find((s) => s.id === stage.id)!;
    // 簽核紀錄上那句話是**人**留的，不是 agent 的分析全文
    expect(after.comment).toBe("已確認，第 3 點下一版處理");
    expect(after.agentResult).toBe(AGENT_OUTPUT);
  });

  test("先存分析、再簽核 —— 分析不被簽核意見蓋掉", async () => {
    const id = fresh();
    store.applyFullTemplate(id, store.get().sections, {}, templateWorkflowArg(fullTemplate("lean")));
    store.submitForReview(id, "c1");
    const stage = store.get().cases[id]!.stages.find((s) => s.name === "AI 結構審查")!;

    const r = store.invokeAgent({ agentId: AGENT_CODEX, projectId: id, task: "review", stageId: stage.id });
    await waitForJob(r.jobId!);
    store.saveAgentResult(r.jobId!);
    store.approveAndLock({ stageIds: [stage.id], comment: "看過了" });

    const after = store.get().cases[id]!.stages.find((s) => s.id === stage.id)!;
    expect(after.agentResult).toBe(AGENT_OUTPUT);
    expect(after.comment).toBe("看過了");
  });
});

describe("F3-2：saveAgentResult 有權限與狀態閘門", () => {
  test("已核准鎖定的專案，落地不了 —— 已鎖文件的內文不能被覆寫", async () => {
    const id = fresh();
    store.applyFullTemplate(id, store.get().sections, {}, templateWorkflowArg(fullTemplate("enterprise")));
    store.submitForReview(id, "c1");
    const editStage = store.get().cases[id]!.stages.find((s) => s.kind === "edit")!;

    const r = store.invokeAgent({
      agentId: AGENT_CODEX_EDIT,
      projectId: id,
      task: "edit",
      stageId: editStage.id,
    });
    expect(r.ok).toBe(true);
    await waitForJob(r.jobId!);

    // 全部簽掉 → 案子鎖定、專案 approved。
    // 要按好幾次：一次 `approveAndLock` 只簽得掉「當下沒有被順序閘門擋住」的那些，
    // 而「我核准」串行殿後，得等前面幾關先過
    for (let i = 0; i < 6 && proj(id).status !== "approved"; i++) store.approveAndLock({});
    expect(proj(id).status).toBe("approved");
    const before = JSON.stringify(store.get().projectSectionValues[id] ?? {});

    const save = store.saveAgentResult(r.jobId!);
    expect(save.ok).toBe(false);
    expect(JSON.stringify(store.get().projectSectionValues[id] ?? {})).toBe(before);
  });
});

describe("F3-3：舊工作單沒有 landed 就是已經落地過", () => {
  /**
   * 型別註解本來就寫著「沒有 landed 的是舊工作單……當成 saved 處理」，
   * 但沒有任何程式碼實作它 —— `saveAgentResult` 只擋 `landed === "saved"`，
   * `undefined` 一路放行。後果是升級前跑完的工作單會被**第二次**落地。
   */
  test("跑完但沒有 landed 的舊工作單一律當成已落地", () => {
    expect(jobLanded({ landed: undefined, status: "done" })).toBe("saved");
    expect(jobLanded({ landed: "pending", status: "done" })).toBe("pending");
    expect(jobLanded({ landed: "discarded", status: "done" })).toBe("discarded");
  });

  test("還沒跑完的沒有 landed 不能當成已落地 —— 那是還沒開始，不是做完了", () => {
    expect(jobLanded({ landed: undefined, status: "queued" })).toBe("pending");
    expect(jobLanded({ landed: undefined, status: "running" })).toBe("pending");
  });
});

// ── F4-1 ────────────────────────────────────────────────────

describe("F4-1：族系隔離掛在真實流程上", () => {
  const emp = (p: Partial<Employee>): Employee =>
    ({ id: "u1", name: "阿明", accessRole: "approver", kind: "human", agentFamily: null, ...p }) as Employee;
  const project = (p: Partial<Project>): Project =>
    ({ id: "p1", title: "案子", status: "review", authorId: "u9", authorAgentFamily: null, ...p }) as Project;
  const stage = (p: Partial<CaseStage>): CaseStage => ({
    id: "cs1",
    stageDefId: "ws1",
    order: 1,
    name: "結構完整度",
    assigneeId: null,
    assigneeName: "待指派",
    state: "pending",
    kind: "review",
    ...p,
  });
  const kase = (stages: CaseStage[]): CaseRecord => ({
    projectId: "p1",
    reviewCommitId: "c1",
    stages,
    log: [],
    withdrawn: false,
    withdrawnAt: null,
    withdrawnBy: null,
    withdrawReason: null,
    locked: false,
  });

  const claudeAgent = emp({ id: "a-claude", kind: "agent", agentFamily: "claude", name: "Claude 審閱" });
  const employees = [claudeAgent, emp({ id: "a-codex", kind: "agent", agentFamily: "codex" })];

  /**
   * 這一條是 F4-1 的核心：真實流程裡**簽核的永遠是人**，agent 只跑
   * `invokeAgent`。只看 `user.kind === "agent"` 的規則在正式路徑上從來不觸發。
   */
  test("人簽一個派給同族系 agent 的審查關卡 → 擋，而且講得出要改派", () => {
    const human = emp({ id: "u-me", accessRole: "admin" });
    const p = project({ authorAgentFamily: "claude" });
    const st = stage({ assigneeId: "a-claude", assigneeName: "Claude 審閱" });
    const r = canSignStage(human, p, st, kase([st]), { employees });
    expect(r.can).toBe(false);
    expect(r.can === false && r.reason).toContain("claude");
    expect(r.can === false && r.reason).toContain("改派");
  });

  test("代簽也繞不過執行者的族系 —— 代簽繞的是關卡歸屬，不是同一顆腦袋", () => {
    const admin = emp({ id: "u-me", accessRole: "admin" });
    const p = project({ authorAgentFamily: "claude" });
    const st = stage({ assigneeId: "a-claude" });
    expect(canSignStage(admin, p, st, kase([st]), { override: true, employees }).can).toBe(false);
  });

  test("執行者是別的族系 → 放行", () => {
    const human = emp({ id: "u-me", accessRole: "admin" });
    const p = project({ authorAgentFamily: "claude" });
    const st = stage({ assigneeId: "a-codex" });
    expect(canSignStage(human, p, st, kase([st]), { employees }).can).toBe(true);
  });

  test("edit 關卡不受族系限制 —— 族系隔離守的是審查，不是撰寫", () => {
    const human = emp({ id: "u-me", accessRole: "admin" });
    const p = project({ authorAgentFamily: "claude" });
    const st = stage({ assigneeId: "a-claude", kind: "edit", name: "文件補完" });
    expect(canSignStage(human, p, st, kase([st]), { employees }).can).toBe(true);
  });

  test("沒給員工清單時退回原本的判斷，不會憑空放行或憑空擋人", () => {
    const human = emp({ id: "u-me", accessRole: "admin" });
    const p = project({ authorAgentFamily: "claude" });
    const st = stage({ assigneeId: "a-claude" });
    expect(canSignStage(human, p, st, kase([st])).can).toBe(true);
  });

  test("invokeAgent：同族系 agent 不得對審查關卡執行分析", () => {
    const id = fresh({ authorAgentFamily: "claude" });
    store.applyFullTemplate(id, store.get().sections, {}, templateWorkflowArg(fullTemplate("lean")));
    store.submitForReview(id, "c1");
    const stg = store.get().cases[id]!.stages.find((s) => s.name === "AI 結構審查")!;

    const bad = store.invokeAgent({ agentId: AGENT_CLAUDE, projectId: id, task: "review", stageId: stg.id });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toContain("同一種 Agent");

    const good = store.invokeAgent({ agentId: AGENT_CODEX, projectId: id, task: "review", stageId: stg.id });
    expect(good.ok).toBe(true);
  });

  test("invokeAgent：同族系 agent 仍然可以做 edit —— agent 寫 PRD 正是這個產品在做的事", () => {
    const id = fresh({ authorAgentFamily: "claude" });
    store.applyFullTemplate(id, store.get().sections, {}, templateWorkflowArg(fullTemplate("enterprise")));
    store.submitForReview(id, "c1");
    const editStage = store.get().cases[id]!.stages.find((s) => s.kind === "edit")!;

    ensureEmployee({
      id: "wrf-agent-claude-editor",
      name: "Claude 編輯",
      kind: "agent",
      accessRole: "editor",
      agentFamily: "claude",
      active: true,
      agentEnabled: true,
    });
    const r = store.invokeAgent({
      agentId: "wrf-agent-claude-editor",
      projectId: id,
      task: "edit",
      stageId: editStage.id,
    });
    expect(r.ok).toBe(true);
  });
});

// ── F4-2 ────────────────────────────────────────────────────

describe("F4-2：留言覆核仍看職責分立，不是純角色", () => {
  test("separationOfDuties 導出來給專案層級的判斷用", () => {
    const p = { id: "p1", authorId: "u9", authorAgentFamily: "claude" } as Project;
    const claude = { id: "a1", kind: "agent", agentFamily: "claude", accessRole: "approver" } as Employee;
    const codex = { id: "a2", kind: "agent", agentFamily: "codex", accessRole: "approver" } as Employee;
    expect(separationOfDuties(claude, p).can).toBe(false);
    expect(separationOfDuties(codex, p).can).toBe(true);
  });

  test("同族系 agent 不能把自己家族寫的文件上的留言標記已解決", () => {
    const id = fresh({ authorAgentFamily: "claude" });
    store.addComment({
      id: `cmt-${id}`,
      projectId: id,
      author: "審閱",
      authorId: "someone",
      avatar: "AI",
      time: "剛剛",
      anchor: "§ 1",
      body: "這裡有問題",
      resolved: false,
    } as never);

    store.setCurrentUser(AGENT_CLAUDE);
    const r = store.resolveComment(`cmt-${id}`);
    expect(r.ok).toBe(false);

    store.setCurrentUser(AGENT_CODEX);
    expect(store.resolveComment(`cmt-${id}`).ok).toBe(true);
  });
});

// ── F4-3 ────────────────────────────────────────────────────

describe("F4-3：skipStage 走 canSignStage，唯一入口才成立", () => {
  test("略過一個派給同族系 agent 的非必簽關卡 → 擋", () => {
    const id = fresh({ authorAgentFamily: "claude" });
    store.applyFullTemplate(id, store.get().sections, {}, templateWorkflowArg(fullTemplate("technical")));
    store.submitForReview(id, "c1");
    const optional = store.get().cases[id]!.stages.find((s) => s.name === "規格一致性")!;
    store.reassignCaseStage(id, optional.id, AGENT_CLAUDE);

    const r = store.skipStage(optional.id, "這輪不做");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("claude");
  });

  test("抽單的案子略不了關 —— 舊的行內判斷完全沒看這件事", () => {
    const id = fresh();
    store.applyFullTemplate(id, store.get().sections, {}, templateWorkflowArg(fullTemplate("technical")));
    store.submitForReview(id, "c1");
    const optional = store.get().cases[id]!.stages.find((s) => s.name === "規格一致性")!;
    store.withdrawCase(id, "先撤回");

    const r = store.skipStage(optional.id, "這輪不做");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("抽單");
  });

  test("正常情況照舊略得掉", () => {
    const id = fresh();
    store.applyFullTemplate(id, store.get().sections, {}, templateWorkflowArg(fullTemplate("technical")));
    store.submitForReview(id, "c1");
    const optional = store.get().cases[id]!.stages.find((s) => s.name === "規格一致性")!;
    expect(store.skipStage(optional.id, "這輪不做")).toEqual({ ok: true });
    expect(store.get().cases[id]!.stages.find((s) => s.id === optional.id)!.state).toBe("skipped");
  });
});
