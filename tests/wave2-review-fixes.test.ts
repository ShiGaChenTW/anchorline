/**
 * Wave 2 跨 context 審查（Cato）的四條缺陷修復 —— C-1 / C-2 / C-3 / C-4。
 *
 * ## 為什麼這一支不是「再加幾條 source-grep」
 *
 * 審查報告 §E 對這批測試的評價值得逐字記著：**source-grep 測試比預期強，
 * 但解析度到「函式」為止，剛好停在這兩條缺陷門口。**
 *
 * - C-1 的缺陷在 `maybeAutoShow` 與 `handlePendingGate` **之間**，
 *   而既有的 `test("自動跳窗有 isDialogOpen 守門…")` 只驗 `maybeAutoShow` 體內
 *   有那兩個字串 —— 兩者都在、測試綠、缺陷還在。
 * - C-3 的缺陷在「這張工作單畫不畫得出來」與「它擋不擋結案」用了兩套判準，
 *   兩邊各有完整測試，但沒有一條測試同時持有兩邊。
 *
 * 所以這一支補的是兩種東西：
 *
 * 1. **時序替身**（Part A）—— 把 `askCustom` 換成一個記錄呼叫順序、而且
 *    **同步拿鎖**的替身（`ask.ts` 的 `rejectIfBusy` 跑在第一個 await 之前，
 *    這一點是整條缺陷的根），拿它跑真實的呼叫順序。
 * 2. **同時持有兩邊的合約測試**（Part B）—— 對每一張「擋得住結案」的工作單，
 *    斷言它在關卡列的產出 HTML 裡有拍板入口。
 */
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createDialogFlows } from "../src/lib/dialog-flow";
import { stageAnalysisJobs } from "../src/lib/signoff";
import { stageAnalysisRowHtml } from "../src/lib/agent-result";
import { assignDialogHtml } from "../src/lib/submit-assign";
import { stageActorLabel, stageKindLabel, stageModeLabel } from "../src/lib/workflow-admin";
import { isPendingAgentJob, jobLanded } from "../src/data/types";
import type { AgentJob, CaseStage, Employee, Section, WorkflowStageDef } from "../src/data/types";

/**
 * `store.ts` 在 import 時就會跑 `load()`，而 `data/domains/index.ts` 用了
 * `import.meta.glob`（Vite 的東西，bun test 沒有）。這兩段是既有測試檔逐字相同的
 * 開機樣板 —— **`mock.module` 在 bun 是全域的**，回傳不同的東西會讓誰先跑決定
 * 別人紅不紅，所以這裡刻意不「改良」它。
 */
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

// 這一支**只用 store 匯出的三支純函式**，不碰 store 單例的狀態 ——
// store 是跨測試檔共用的，在這裡 importState 會把別人的資料掃掉
const { migrateProject, sanitizeStageDef, sanitizeStageDefs } = await import("../src/data/store");

const SIGNOFF_SRC = readFileSync(new URL("../src/pages/signoff.ts", import.meta.url), "utf8");
const STORE_SRC = readFileSync(new URL("../src/data/store.ts", import.meta.url), "utf8");

/** 等到 microtask 與一輪 macrotask 都排空 */
async function drain(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

/**
 * `ask.ts` 的極薄替身。
 *
 * **唯一必須忠實的地方是「鎖是同步拿的」**：`askCustom` 雖然是 async，
 * `rejectIfBusy()` 跑在第一個 `await` 之前，所以呼叫的那一瞬間鎖就沒了。
 * 這正是 C-1 的機制 —— 換成「await 之後才拿鎖」的替身，這支測試就測不到東西。
 */
function fakeAsk() {
  let open = false;
  const calls: string[] = [];
  return {
    calls,
    isDialogOpen: () => open,
    askCustom: async (label: string): Promise<void> => {
      if (open) throw new Error("已有對話框開啟");
      open = true;
      calls.push(`open:${label}`);
      await Promise.resolve();
      open = false;
      calls.push(`close:${label}`);
    },
  };
}

/* ══ Part A：C-1 —— 自動跳窗與 S1 攔截對話框搶同一把鎖 ═══════ */

describe("C-1 對話框排隊（時序替身）", () => {
  /**
   * **這一條是整支測試最重要的一條。**
   *
   * 重現的是報告裡那條不需要競態的路徑：兩份待拍板分析 → 重開簽核頁 →
   * auto-show 第一份 → 按「稍後再決定」→ 去簽最後一關 → 閘門擋下。
   * 修復前這條路上使用者看到的是**另一張工作單的結果窗**，而他剛才被擋下的
   * 簽核一句話都沒有；S1 攔截對話框（這個功能的主要出口）整個不出現。
   */
  test("閘門擋下時 S1 對話框真的被呼叫到，期間來的 render 讓位", async () => {
    const ask = fakeAsk();
    const errors: unknown[] = [];
    const flows = createDialogFlows({ isDialogOpen: ask.isDialogOpen, onError: (e) => errors.push(e) });

    // signoff.ts 的 render()：尾端掛著自動跳窗
    const render = (opts?: { skipAutoShow?: boolean }) => {
      if (!opts?.skipAutoShow) flows.tryAuto(() => ask.askCustom("auto"));
    };

    // 逐字照 signoff.ts 閘門被擋下那條路的順序
    render({ skipAutoShow: true });
    flows.runUser(() => ask.askCustom("gate"));
    // 對話框開著的期間，別的分頁改了狀態 → store.subscribe → render
    render();
    await drain();

    expect(ask.calls).toEqual(["open:gate", "close:gate"]);
    expect(errors).toEqual([]);
  });

  /**
   * 反例 —— 這一條說明 `skipAutoShow` 為什麼必須存在。
   *
   * 少了它，`render()` 尾端的自動跳窗會**同步**把鎖拿走，接著的 S1 對話框
   * 直接 throw。修復後那個 throw 至少被 `onError` 接住（修復前是裸的 `void`，
   * 而這個 repo 刻意不攔 `unhandledrejection`，它只會沉到 console）。
   */
  test("反例：自動跳窗先跑就吃掉鎖，而那個 throw 一定要有人接", async () => {
    const ask = fakeAsk();
    const errors: unknown[] = [];
    const flows = createDialogFlows({ isDialogOpen: ask.isDialogOpen, onError: (e) => errors.push(e) });

    flows.tryAuto(() => ask.askCustom("auto")); // 這就是沒有 skipAutoShow 的 render()
    flows.runUser(() => ask.askCustom("gate"));
    await drain();

    expect(ask.calls).toContain("open:auto");
    expect(ask.calls).not.toContain("open:gate");
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("已有對話框開啟");
  });

  test("使用者的流程在跑時，自動跳窗一律讓位而且 flow 完全不執行", async () => {
    const ask = fakeAsk();
    const flows = createDialogFlows({ isDialogOpen: ask.isDialogOpen, onError: () => {} });
    let autoRan = 0;

    flows.runUser(() => ask.askCustom("gate"));
    // 讓位的那一次要回 false —— 呼叫端拿這個值決定「不標記成已經自動開過」，
    // 標記了的話這一份從此不再自動跳，而使用者根本沒看到過它
    expect(flows.tryAuto(() => void autoRan++)).toBe(false);
    expect(autoRan).toBe(0);
    expect(flows.isBusy()).toBe(true);

    await drain();
    // 使用者的流程結束之後才輪得到自動跳窗
    expect(flows.isBusy()).toBe(false);
    expect(flows.tryAuto(() => void autoRan++)).toBe(true);
    expect(autoRan).toBe(1);
  });

  test("同步 throw 的流程也接得住，而且鎖的計數要放掉", async () => {
    const errors: unknown[] = [];
    const flows = createDialogFlows({ isDialogOpen: () => false, onError: (e) => errors.push(e) });
    flows.runUser(() => {
      throw new Error("同步爆炸");
    });
    await drain();
    expect(errors).toHaveLength(1);
    // 計數沒放掉的話，自動跳窗從此永遠讓位 —— 症狀是「跑完分析再也不會跳窗」
    expect(flows.isBusy()).toBe(false);
  });

  /* ── 生產端接線（Wave 1 F0 的形狀：新東西只有測試在用）── */

  test("閘門那條路用 skipAutoShow，而且把 S1 交給 runUser", () => {
    // 下界要卡在閘門分支之後的第一個 toast —— 檔案裡有兩處同字串（另一處在
    // showAgentResult），從 0 找會切出空字串，而空字串的 toContain 永遠是紅的
    const from = SIGNOFF_SRC.indexOf("if (r.pendingJobs) {");
    expect(from).toBeGreaterThan(0);
    const gate = SIGNOFF_SRC.slice(from, SIGNOFF_SRC.indexOf("toast(r.reason ?? \"動作失敗\")", from));
    expect(gate).toContain("render({ skipAutoShow: true })");
    expect(gate).toContain("flows.runUser(() => handlePendingGate(p))");
  });

  test("signoff.ts 不再有任何裸的 void 對話框呼叫", () => {
    // 裸呼叫的症狀是「按了沒反應」，而 console 裡沉著一個沒人接的 rejection
    expect(SIGNOFF_SRC).not.toContain("void showAgentResult(");
    expect(SIGNOFF_SRC).not.toContain("void handlePendingGate(");
  });

  test("askConfirm 的兩顆按鈕也走 runUser —— 它們跟 askCustom 共用同一把鎖", () => {
    expect((SIGNOFF_SRC.match(/flows\.runUser\(/g) ?? []).length).toBe(4);
  });
});

/* ══ Part B：C-3 —— 擋得住結案的工作單一定要找得到 ═══════════ */

function job(patch: Partial<AgentJob>): AgentJob {
  return {
    id: "j1",
    agentId: "a1",
    agentName: "審查 Agent",
    projectId: "w2r-p1",
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

const STAGE: Pick<CaseStage, "kind" | "editTarget" | "agentResult"> = {
  kind: "review",
  editTarget: undefined,
  agentResult: undefined,
};

/** 逐字照 signoff.ts 的組法：把選出來的工作單各畫一列，接起來 */
function stageListRows(jobs: AgentJob[]): string {
  return jobs
    .map((j) =>
      stageAnalysisRowHtml({ job: j, stage: STAGE, sections: [], landed: jobLanded(j), now: Date.now() }),
    )
    .join("");
}

describe("C-3 待拍板的工作單不得從關卡列消失", () => {
  /**
   * **這一條同時持有兩邊。** 舊的分工是：`pendingAgentJobsOf` 的測試驗
   * 「擋不擋結案」、`stageAnalysisRowHtml` 的測試驗「畫成什麼樣」，
   * 而沒有任何一條測試問「擋得住的那些，畫得出來嗎」。
   */
  test("合約：擋得住結案的每一張，關卡列產出的 HTML 裡都有拍板入口", () => {
    const all = [
      job({ id: "j-new" }), // 重新分析跑出來的第二張
      job({ id: "j-old" }), // 前一張，仍然 pending
      job({ id: "j-saved", landed: "saved" }),
      job({ id: "j-other-stage", stageId: "st-2" }),
    ];
    const picked = stageAnalysisJobs({ jobs: all, projectId: "w2r-p1", stageId: "st-1", isAgent: true });
    const html = stageListRows(picked);

    for (const j of all.filter((x) => x.stageId === "st-1" && isPendingAgentJob(x))) {
      expect(html).toContain(`data-sg-view="${j.id}"`);
    }
    expect(picked.map((j) => j.id)).toEqual(["j-new", "j-old"]);
  });

  test("(a) 按過「重新分析」之後，前一張仍然畫得出來", () => {
    const jobs = [job({ id: "j2" }), job({ id: "j1" })];
    const picked = stageAnalysisJobs({ jobs, projectId: "w2r-p1", stageId: "st-1", isAgent: true });
    // 新的在前 —— 「重新分析」鈕看的是 [0]，語意跟改動前一致
    expect(picked.map((j) => j.id)).toEqual(["j2", "j1"]);
    expect(stageListRows(picked)).toContain('data-sg-view="j1"');
  });

  test("(b) 把關卡改派給人之後，pending 的那張不得跟著消失", () => {
    const jobs = [job({ id: "j1" })];
    const picked = stageAnalysisJobs({ jobs, projectId: "w2r-p1", stageId: "st-1", isAgent: false });
    expect(picked.map((j) => j.id)).toEqual(["j1"]);
    expect(stageListRows(picked)).toContain('data-sg-view="j1"');
  });

  test("改派給人且沒有任何 pending 時仍然什麼都不畫（不是改成永遠都畫）", () => {
    const jobs = [job({ id: "j1", landed: "saved" })];
    expect(stageAnalysisJobs({ jobs, projectId: "w2r-p1", stageId: "st-1", isAgent: false })).toEqual([]);
  });

  test("指派 agent 時，最新那張非 pending 的照舊要畫（不能只剩 pending）", () => {
    const jobs = [job({ id: "j2", status: "running", result: "" }), job({ id: "j1", landed: "saved" })];
    const picked = stageAnalysisJobs({ jobs, projectId: "w2r-p1", stageId: "st-1", isAgent: true });
    expect(picked.map((j) => j.id)).toEqual(["j2"]);
  });

  test("別的專案／別的關卡不得混進來", () => {
    const jobs = [job({ id: "x", projectId: "w2r-other" }), job({ id: "y", stageId: "st-9" })];
    expect(stageAnalysisJobs({ jobs, projectId: "w2r-p1", stageId: "st-1", isAgent: true })).toEqual([]);
  });

  test("signoff.ts 真的把整批畫出來，不是只畫一張", () => {
    expect(SIGNOFF_SRC).toContain("stageAnalysisJobs({");
    expect(SIGNOFF_SRC).toContain("analysisJobs");
    // 舊寫法：只挑最新一筆、而且被 isAgent 擋著
    expect(SIGNOFF_SRC).not.toContain("isAgent ? stageAnalysis(");
  });
});

/* ══ Part C：C-2 / C-4 —— 型別謊報的輸入 ═════════════════════ */

function stageDef(patch: Record<string, unknown>): WorkflowStageDef {
  return {
    id: "w1",
    order: 1,
    name: "結構審查",
    defaultAssigneeId: null,
    kind: "review",
    defaultActor: "human",
    required: true,
    mode: "parallel",
    ...patch,
  } as WorkflowStageDef;
}

const XSS = '"><img src=x onerror=alert(1)>';

describe("C-4 匯入的工作區 JSON 收斂到跟 load() 同一套", () => {
  test("缺 kind / defaultActor 的舊匯出檔補得回合法值", () => {
    const s = sanitizeStageDef({ id: "w1", name: "法務", order: 3 }, 0);
    expect(s.kind).toBe("review");
    expect(s.defaultActor).toBe("human");
    expect(s.mode).toBe("parallel");
    expect(s.required).toBe(true);
  });

  test("查表一律有退路 —— 缺值不得變成 undefined.replace", () => {
    // 這正是讓管理中心整頁停止 render 的那一步：`renderLandedFlows` 炸掉之後
    // `renderCases()` 不再執行，而它掛在 store.subscribe 上，之後每次狀態變動都再炸
    expect(() => stageKindLabel(undefined)).not.toThrow();
    expect(() => stageActorLabel(undefined)).not.toThrow();
    expect(stageKindLabel(undefined)).toBe(stageKindLabel("review"));
    expect(stageActorLabel(undefined)).toBe(stageActorLabel("human"));
    expect(stageModeLabel(undefined)).toBe(stageModeLabel("parallel"));
  });

  test("order 是一段 HTML 時收斂成數字", () => {
    expect(sanitizeStageDef({ id: "w1", name: "x", order: XSS }, 4).order).toBe(5);
  });

  test("不認得的欄位原樣帶過 —— 逐欄位重建會讓它們無聲消失", () => {
    // migrateProject 上面那串「第三、五、六、七次踩同一個坑」講的就是這件事
    const s = sanitizeStageDef({ id: "w1", name: "x", order: 1, futureField: "keep-me" }, 0);
    expect((s as unknown as Record<string, unknown>).futureField).toBe("keep-me");
  });

  test("空陣列與非陣列回 undefined —— 對齊 migrateProject 的既有語意", () => {
    expect(sanitizeStageDefs([])).toBeUndefined();
    expect(sanitizeStageDefs(undefined)).toBeUndefined();
    expect(sanitizeStageDefs("nope")).toBeUndefined();
  });

  test("migrateProject 的 workflowStages / templateStages 都走收斂", () => {
    const p = migrateProject(
      {
        id: "w2r-p1",
        title: "測試",
        workflowStages: [{ id: "a", name: "甲", order: XSS }],
        templateStages: [{ id: "b", name: "乙" }],
      },
      [] as Employee[],
    );
    expect(p.workflowStages![0]!.kind).toBe("review");
    expect(p.workflowStages![0]!.order).toBe(1);
    expect(p.templateStages![0]!.defaultActor).toBe("human");
  });

  /**
   * F0 的形狀防護：收斂函式存在、但匯入那條路沒接，等於什麼都沒做。
   * **用計數而不是 `toContain`** —— 見報告 §E 對 `stagePatchFrom` 那條的評語。
   */
  test("importState 真的接上了三支收斂函式", () => {
    const body = STORE_SRC.slice(
      STORE_SRC.indexOf("importState(newState: Partial<AppState>)"),
      STORE_SRC.indexOf("deleteTemplate(id: string)"),
    );
    expect(body).toContain("migrateProject(");
    expect(body).toContain("sanitizeStageDefs(");
    expect(body).toContain("sanitizeSkeletons(");
    expect(body).toContain("normalizeCases(");
    // 收斂必須寫在 `...newState` **之後**，否則原值會被蓋回來
    expect(body.indexOf("...newState")).toBeLessThan(body.indexOf("workflowSkeletons: sanitizeSkeletons("));
  });

  test("normalizeCases 是 load 與 importState 共用的同一支", () => {
    expect((STORE_SRC.match(/normalizeCases\(/g) ?? []).length).toBe(3); // 定義 + 兩個呼叫端
  });
});

describe("C-2 指派對話框的 order 有 escape", () => {
  test("型別謊報的 order 不得原樣進到 bodyHtml", () => {
    const html = assignDialogHtml(
      [stageDef({ order: XSS as unknown as number })],
      [] as Employee[],
      null,
      [] as Section[],
      {},
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  test("正常的數字序號照樣印得出來", () => {
    const html = assignDialogHtml([stageDef({ order: 7 })], [] as Employee[], null, [] as Section[], {});
    expect(html).toContain('<span class="assign-order">7</span>');
  });
});
