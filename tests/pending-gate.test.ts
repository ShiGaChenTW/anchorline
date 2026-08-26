/**
 * S1 結案閘門 —— 還有沒拍板的分析時，**不讓案子鎖定**。
 *
 * ## 這一支在防什麼
 *
 * 結案會 `locked: true`，而 `saveAgentResult` 對鎖定的案子一律回「此案已結案
 * 鎖定」。所以案子一鎖，所有還沒拍板的分析就**永遠**落不了地 —— 一份跑了
 * 三十秒、使用者還沒讀的分析，會因為他按了最後一關的核准而消失在一顆按不動的
 * 灰鈕後面，而且沒有任何提示。
 *
 * Scott 拍板擋在結案那一端（S1）：不是等鎖定之後解釋那顆灰鈕，而是不讓它鎖定。
 *
 * ## 為什麼閘門在 store 而不是只在 UI
 *
 * `approveAndLock` 與 `skipStage` **是兩條各自會 `locked: allDone` 的路**。
 * 只擋 UI 的話另一條會靜默走過去 —— 而「靜默」正是這個 bug 最貴的地方：
 * 畫面一切正常，只有那幾份分析再也存不進去。這裡對兩條路各測一次。
 */
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AgentJob } from "../src/data/types";
import { isPendingAgentJob, pendingAgentJobsOf } from "../src/data/types";

// ── Part A：篩選條件（純函式，不碰 store）──────────────────────
//
// 這一段刻意不經過 store：`landed` 欄位缺失（升級前的舊工作單）與空結果這兩條
// 分支，用公開 API 造不出來 —— hydrate 時的移轉就會把舊單補成 `saved`。
// 條件住在純函式裡，每一條分支才驗得到。

function job(patch: Partial<AgentJob>): AgentJob {
  return {
    id: "j1",
    agentId: "a1",
    agentName: "測試 Agent",
    projectId: "pg-p1",
    projectTitle: "測試專案",
    stageId: "st-1",
    task: "review",
    status: "done",
    note: "",
    result: "建議核准\n內容",
    createdAt: "2026-08-26T00:00:00.000Z",
    finishedAt: "2026-08-26T00:01:00.000Z",
    landed: "pending",
    ...patch,
  };
}

describe("isPendingAgentJob 的四個條件", () => {
  test("綁關卡 + done + pending + 有內容 = 等人拍板", () => {
    expect(isPendingAgentJob(job({}))).toBe(true);
  });

  test("沒綁關卡的一般進場不算 —— 它的落地目標是留言，跟簽核結案無關", () => {
    // 算進去的話，簽核頁會擋著結案要求使用者處理一份那一頁根本顯示不出來的東西
    expect(isPendingAgentJob(job({ stageId: undefined }))).toBe(false);
  });

  test("還在跑／失敗／取消的都不算「等人決定」", () => {
    expect(isPendingAgentJob(job({ status: "queued" }))).toBe(false);
    expect(isPendingAgentJob(job({ status: "running" }))).toBe(false);
    expect(isPendingAgentJob(job({ status: "failed", result: "進場失敗：逾時" }))).toBe(false);
    expect(isPendingAgentJob(job({ status: "cancelled" }))).toBe(false);
  });

  test("已拍板的（saved / discarded）不算", () => {
    expect(isPendingAgentJob(job({ landed: "saved" }))).toBe(false);
    expect(isPendingAgentJob(job({ landed: "discarded" }))).toBe(false);
  });

  /**
   * **這一條是整支測試最重要的一條。**
   *
   * 升級前跑完的舊工作單沒有 `landed` 欄位，它們的副作用當年已經寫進文件了。
   * `jobLanded` 把它們算成 `saved`。如果閘門寫成 `j.landed === "pending"`，
   * 這批舊單會全部變成擋門的幽靈 —— 而且**永遠拍不掉**：`saveAgentResult` 對
   * 它們回「這份結果已經存過了」，使用者卡在一個沒有出口的迴圈裡，案子再也
   * 結不了。症狀是「我明明沒跑過分析，它卻說有三份沒拍板」。
   */
  test("升級前的舊工作單（沒有 landed 欄位）不擋結案", () => {
    const legacy = job({});
    delete (legacy as Partial<AgentJob>).landed;
    expect(isPendingAgentJob(legacy)).toBe(false);
  });

  test("空結果不算 —— 存不進去的東西不該擋著結案", () => {
    // `saveAgentResult` 自己也擋空結果。兩邊不一致的話就沒有出口了
    expect(isPendingAgentJob(job({ result: "" }))).toBe(false);
    expect(isPendingAgentJob(job({ result: "   \n  " }))).toBe(false);
  });
});

describe("pendingAgentJobsOf", () => {
  test("只回這個專案的", () => {
    const jobs = [job({ id: "a" }), job({ id: "b", projectId: "pg-other" })];
    expect(pendingAgentJobsOf(jobs, "pg-p1").map((j) => j.id)).toEqual(["a"]);
  });

  test("保序（新到舊）—— invokeAgent 是 [job, ...prev]，filter 不改順序", () => {
    const jobs = [job({ id: "new" }), job({ id: "mid", landed: "saved" }), job({ id: "old" })];
    expect(pendingAgentJobsOf(jobs, "pg-p1").map((j) => j.id)).toEqual(["new", "old"]);
  });

  test("沒有待拍板的就是空陣列", () => {
    expect(pendingAgentJobsOf([job({ landed: "saved" })], "pg-p1")).toEqual([]);
  });
});

// ── Part B：store 的兩條結案路徑 ───────────────────────────────

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
 * **字串必須跟 `agent-result-landing.test.ts` 的那份逐字相同。**
 *
 * `mock.module` 在 bun 是全域的，所有測試檔共用同一份模組登錄表 —— 最後註冊的
 * 那個 mock 對全部檔案生效。兩邊回傳不同字串的話，誰先跑就決定另一邊會不會紅，
 * 而那種失敗只在整批跑時出現、單檔跑全綠，是最難查的一種。
 */
const AGENT_OUTPUT = "建議修改\n\n這段文字是 Agent 產出的，沒有按存檔就不該出現在任何地方。";
mock.module("../src/lib/ai-coach", () => ({
  isAiConfigured: () => true,
  runAgentTask: async () => AGENT_OUTPUT,
  // W3：`invokeAgent` 的 CLI 分支會叫這支。**五個 mock 這份的回傳值必須逐字相同**。
  agentTaskPrompt: (opts: { agentName: string; task: string }) => ({
    system: `SYSTEM<${opts.agentName}>`,
    user: `USER<${opts.task}>`,
  }),
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
const ADMIN = "pg-admin";
const AGENT = "pg-agent";

function ensureEmployee(e: Record<string, unknown>) {
  if (!store.get().employees.some((x) => x.id === e.id)) store.addEmployee(e as never);
}

function bootstrap() {
  ensureEmployee({
    id: ADMIN,
    name: "閘門測試管理員",
    kind: "human",
    accessRole: "admin",
    active: true,
    isCurrent: true,
  });
  ensureEmployee({
    id: AGENT,
    name: "閘門測試 Agent",
    kind: "agent",
    accessRole: "editor",
    agentFamily: "claude",
    active: true,
    agentEnabled: true,
  });
  store.setCurrentUser(ADMIN);
}

function freshProject(id: string) {
  if (!store.get().projects.some((p) => p.id === id)) {
    store.addProject({
      id,
      title: `閘門測試 ${id}`,
      status: "draft",
      pct: 0,
      owner: "閘門測試管理員",
      domain: "generic",
    } as never);
  }
  store.setActiveProject(id);
  return id;
}

async function waitForJob(jobId: string, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const j = store.get().agentJobs.find((x) => x.id === jobId);
    if (j && (j.status === "done" || j.status === "failed")) return j;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`工作單 ${jobId} 沒有在時限內跑完`);
}

/** 全域流程是跨檔共用的單例狀態，動完一定要還原 */
const ORIGINAL_WORKFLOW = store.get().workflowStages.map((s) => ({ ...s }));
afterAll(() => {
  store.setWorkflowStages(ORIGINAL_WORKFLOW.map((s) => ({ ...s })));
});

beforeEach(() => {
  bootstrap();
});

describe("pendingAgentJobs 走 store", () => {
  test("跑完沒拍板的工作單會被列出來，拍板後就消失", async () => {
    const pid = freshProject("pg-query");
    store.applyFullTemplate(pid, store.get().sections, {}, { cat: "lean" });
    store.submitForReview(pid, "pg-commit-1");
    const stage = store.get().cases[pid]!.stages[0]!;

    expect(store.pendingAgentJobs(pid)).toEqual([]);

    const r = store.invokeAgent({
      agentId: AGENT,
      projectId: pid,
      task: "review",
      stageId: stage.id,
    });
    await waitForJob(r.jobId!);

    expect(store.pendingAgentJobs(pid).map((j) => j.id)).toEqual([r.jobId!]);

    expect(store.discardAgentResult(r.jobId!).ok).toBe(true);
    expect(store.pendingAgentJobs(pid)).toEqual([]);
  });
});

describe("approveAndLock 的結案閘門", () => {
  /**
   * 中途簽一關**不該**被擋。
   *
   * 閘門只在 `allDone` 那一次生效 —— 綁在每一次核准上的話，使用者連第一關都
   * 簽不了，而他要處理的那份分析可能正屬於後面的關卡。
   */
  test("不是結案的那一簽照常放行", async () => {
    const pid = freshProject("pg-partial");
    store.applyFullTemplate(pid, store.get().sections, {}, { cat: "lean" });
    store.submitForReview(pid, "pg-commit-2");
    const stages = store.get().cases[pid]!.stages;

    const r = store.invokeAgent({
      agentId: AGENT,
      projectId: pid,
      task: "review",
      stageId: stages[0]!.id,
    });
    await waitForJob(r.jobId!);
    expect(store.pendingAgentJobs(pid).length).toBe(1);

    // lean 有兩關，簽第一關不會結案
    const first = store.approveAndLock({ stageIds: [stages[0]!.id] });
    expect(first.ok).toBe(true);
    expect(first.allDone).toBe(false);
    expect(first.pendingJobs).toBeUndefined();
  });

  test("會讓案子結案的那一簽被擋下，而且 state 逐字不變", async () => {
    const pid = freshProject("pg-block");
    store.applyFullTemplate(pid, store.get().sections, {}, { cat: "lean" });
    store.submitForReview(pid, "pg-commit-3");
    const stages = store.get().cases[pid]!.stages;

    const r = store.invokeAgent({
      agentId: AGENT,
      projectId: pid,
      task: "review",
      stageId: stages[0]!.id,
    });
    await waitForJob(r.jobId!);
    store.approveAndLock({ stageIds: [stages[0]!.id] });

    const before = JSON.stringify(store.get().cases[pid]);
    const statusBefore = store.get().projects.find((p) => p.id === pid)!.status;

    const blocked = store.approveAndLock({ stageIds: [stages[1]!.id] });

    expect(blocked.ok).toBe(false);
    expect(blocked.pendingJobs).toBe(1);
    expect(blocked.reason).toContain("沒拍板");
    // **擋下就是完全沒發生。** 閘門若放在寫入之後，這裡會看到一份簽了一半的個案
    expect(JSON.stringify(store.get().cases[pid])).toBe(before);
    expect(store.get().cases[pid]!.locked).toBeFalsy();
    expect(store.get().projects.find((p) => p.id === pid)!.status).toBe(statusBefore);
  });

  test("拍板之後同一簽就過得去 —— 閘門有出口", async () => {
    const pid = freshProject("pg-unblock");
    store.applyFullTemplate(pid, store.get().sections, {}, { cat: "lean" });
    store.submitForReview(pid, "pg-commit-4");
    const stages = store.get().cases[pid]!.stages;

    const r = store.invokeAgent({
      agentId: AGENT,
      projectId: pid,
      task: "review",
      stageId: stages[0]!.id,
    });
    await waitForJob(r.jobId!);
    store.approveAndLock({ stageIds: [stages[0]!.id] });
    expect(store.approveAndLock({ stageIds: [stages[1]!.id] }).ok).toBe(false);

    // 存進去（review 關卡＝釘在關卡上），閘門就該放行
    expect(store.saveAgentResult(r.jobId!).ok).toBe(true);

    const done = store.approveAndLock({ stageIds: [stages[1]!.id] });
    expect(done.ok).toBe(true);
    expect(done.allDone).toBe(true);
    expect(store.get().cases[pid]!.locked).toBe(true);
  });

  test("沒有待拍板分析的案子照常結案 —— 閘門不影響原本的路", async () => {
    const pid = freshProject("pg-clean");
    store.applyFullTemplate(pid, store.get().sections, {}, { cat: "lean" });
    store.submitForReview(pid, "pg-commit-5");
    const stages = store.get().cases[pid]!.stages;

    store.approveAndLock({ stageIds: [stages[0]!.id] });
    const done = store.approveAndLock({ stageIds: [stages[1]!.id] });
    expect(done.ok).toBe(true);
    expect(done.allDone).toBe(true);
  });
});

describe("skipStage 的結案閘門（第二條路）", () => {
  /**
   * 為什麼要自己組一份「全部非必簽」的流程：
   *
   * `allStagesSettled` 只看必簽關卡，所以在五類骨架下，略過一個非必簽關卡
   * **永遠**不會把 `allDone` 從 false 翻成 true —— 那條路上的閘門在內建骨架裡
   * 打不到。但沒有必簽關卡時 `allStagesSettled` 回 `stages.length > 0`，
   * 略過就會結案。prod 種子的「法務」正是 `required:false`，這不是假想的形狀。
   *
   * 閘門只放在 `approveAndLock` 的話，這條路會**靜默**把案子鎖上。
   */
  test("略過最後一關會結案時，一樣被擋下", async () => {
    const pid = freshProject("pg-skip");
    store.setWorkflowStages([
      {
        id: "pg-ws-a",
        order: 1,
        name: "選配分析",
        defaultAssigneeId: null,
        kind: "review",
        defaultActor: "agent",
        required: false,
        mode: "parallel",
      },
      {
        id: "pg-ws-b",
        order: 2,
        name: "選配複核",
        defaultAssigneeId: null,
        kind: "review",
        defaultActor: "agent",
        required: false,
        mode: "parallel",
      },
    ]);
    expect(store.applyWorkflowToCase(pid).ok).toBe(true);
    const stages = store.get().cases[pid]!.stages;
    expect(stages.length).toBe(2);

    const r = store.invokeAgent({
      agentId: AGENT,
      projectId: pid,
      task: "review",
      stageId: stages[0]!.id,
    });
    await waitForJob(r.jobId!);
    expect(store.pendingAgentJobs(pid).length).toBe(1);

    const before = JSON.stringify(store.get().cases[pid]);
    const blocked = store.skipStage(stages[1]!.id, "不需要");

    expect(blocked.ok).toBe(false);
    expect(blocked.pendingJobs).toBe(1);
    expect(blocked.reason).toContain("沒拍板");
    expect(JSON.stringify(store.get().cases[pid])).toBe(before);
    expect(store.get().cases[pid]!.locked).toBeFalsy();

    // 拍板之後放行
    expect(store.discardAgentResult(r.jobId!).ok).toBe(true);
    expect(store.skipStage(stages[1]!.id, "不需要").ok).toBe(true);
  });
});
