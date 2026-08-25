/**
 * W2-A：送審前的逐關指派。
 *
 * ## 為什麼有一半的測試在讀 `editor.ts` 的原始碼
 *
 * Wave 1 的 F0 是這樣壞的：`applyFullTemplate` 新增的第 4 個參數只有測試在傳，
 * 生產唯一呼叫端沒傳，於是整批工作在 App 裡是零，而 1563 個測試全綠。
 * `submitForReview` 的 `assignments` 是**一模一樣的形狀** —— Wave 1 就備好、
 * 生產端到這一批之前都沒傳的選填參數。
 *
 * 任何只呼叫 store 的測試都驗不到「`editor.ts` 那一行有沒有把東西交出去」：
 * 測試自己傳三個參數，驗的就是一條生產程式碼走不到的路徑。所以這裡跟
 * `wave1-review-fixes.test.ts` 用同一招 —— 直接讀那個檔案。
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

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
const {
  assignDialogHtml,
  assignOptionGroups,
  buildAssignments,
  editTargetLabel,
  FULL_CAT_LABEL,
  readAssignments,
} = await import("../src/lib/submit-assign");
import type { Employee, Section, WorkflowStageDef } from "../src/data/types";

// ── fixtures ────────────────────────────────────────────────
//
// id 一律帶檔名前綴：`bun test` 全部跑在同一個 process，`store` 是模組層單例，
// 通用 id 會跟別的測試檔撞號。

const SA_ADMIN = "sa-admin";
const SA_AGENT_A = "sa-agent-a";
const SA_AGENT_B = "sa-agent-b";
const SA_HUMAN = "sa-human";
const SA_OFF = "sa-agent-off";

function emp(over: Partial<Employee> & { id: string; name: string }): Employee {
  return {
    title: "測試",
    avatar: "",
    email: `${over.id}@example.test`,
    accessRole: "member",
    kind: "human",
    agentFamily: null,
    password: "x",
    ...over,
  } as Employee;
}

const PEOPLE: Employee[] = [
  emp({ id: SA_ADMIN, name: "測試管理員", accessRole: "admin", kind: "human" }),
  emp({ id: SA_AGENT_A, name: "Agent 甲", kind: "agent", agentFamily: "claude" }),
  emp({ id: SA_AGENT_B, name: "Agent 乙", kind: "agent", agentFamily: "codex" }),
  emp({ id: SA_HUMAN, name: "同事丙", kind: "human" }),
  emp({ id: SA_OFF, name: "停用的 Agent", kind: "agent", agentFamily: "grok", active: false }),
];

const ME = PEOPLE[0]!;

function stage(over: Partial<WorkflowStageDef> & { id: string }): WorkflowStageDef {
  return {
    order: 1,
    name: `關卡 ${over.id}`,
    defaultAssigneeId: null,
    required: true,
    mode: "sequential",
    kind: "review",
    defaultActor: "agent",
    ...over,
  };
}

const SECTIONS: Section[] = [
  {
    id: "open",
    n: "9",
    title: "開放問題",
    desc: "",
    status: "empty",
    guide: "",
    tips: [],
    example: "",
    fields: [{ key: "oq", label: "開放問題", type: "textarea", value: "" }],
    checks: [],
    score: 0,
  },
  {
    id: "risk",
    n: "8",
    title: "風險",
    desc: "",
    status: "empty",
    guide: "",
    tips: [],
    example: "",
    fields: [{ key: "mitigation", label: "緩解措施", type: "textarea", value: "" }],
    checks: [],
    score: 0,
  },
];

// ── buildAssignments ────────────────────────────────────────

describe("buildAssignments：預設選誰", () => {
  /**
   * 這一條是整個對話框存在的理由。五類骨架的 defaultAssigneeId 全部是 null
   * （seed.ts），照著填的話使用者看到一整排「不指派」，按下送出就得到一份
   * 沒有任何人在上面的流程 —— 跟不開這個對話框的結果一樣。
   */
  test("defaultActor: agent → 第一個啟用的 agent；human → 我", () => {
    const stages = [
      stage({ id: "s-a", order: 1, defaultActor: "agent" }),
      stage({ id: "s-h", order: 2, defaultActor: "human" }),
    ];
    expect(buildAssignments(stages, PEOPLE, ME)).toEqual({
      "s-a": SA_AGENT_A,
      "s-h": SA_ADMIN,
    });
  });

  test("defaultAssigneeId 有值時勝過 defaultActor —— 那是流程設計者明確指定的人", () => {
    const stages = [stage({ id: "s-1", defaultAssigneeId: SA_AGENT_B, defaultActor: "human" })];
    expect(buildAssignments(stages, PEOPLE, ME)["s-1"]).toBe(SA_AGENT_B);
  });

  test("defaultAssigneeId 指到停用帳號時退回依 defaultActor 猜", () => {
    const stages = [stage({ id: "s-1", defaultAssigneeId: SA_OFF, defaultActor: "agent" })];
    // 停用的 agent 不該被派工 —— 派了之後那一關永遠不會有人動它
    expect(buildAssignments(stages, PEOPLE, ME)["s-1"]).toBe(SA_AGENT_A);
  });

  test("停用的 agent 不會被當成「第一個 agent」挑走", () => {
    const onlyOff = [PEOPLE[4]!];
    const stages = [stage({ id: "s-1", defaultActor: "agent" })];
    expect(buildAssignments(stages, onlyOff, ME)["s-1"]).toBeNull();
  });

  test("找不到人就是 null，不退回「隨便挑一個」", () => {
    const stages = [stage({ id: "s-1", defaultActor: "human" })];
    // 沒有目前使用者時派給誰都是猜的，而猜錯會讓工作靜默流到不相干的人身上
    expect(buildAssignments(stages, PEOPLE, null)["s-1"]).toBeNull();
  });

  test("每一關都有一筆 —— 漏掉的關卡會退回 defaultAssigneeId，等於對話框沒生效", () => {
    const stages = [
      stage({ id: "s-1", order: 1 }),
      stage({ id: "s-2", order: 2 }),
      stage({ id: "s-3", order: 3, defaultActor: "human" }),
    ];
    expect(Object.keys(buildAssignments(stages, PEOPLE, ME)).sort()).toEqual(["s-1", "s-2", "s-3"]);
  });
});

// ── assignOptionGroups ──────────────────────────────────────

describe("assignOptionGroups：下拉選項的三段", () => {
  test("「我」單獨一段，兩個 optgroup 都把自己排除掉", () => {
    const g = assignOptionGroups(PEOPLE, ME);
    expect(g.me?.id).toBe(SA_ADMIN);
    // 我已經在最上面了，人的那一組再列一次就是同一個人出現兩次
    expect(g.humans.map((e) => e.id)).toEqual([SA_HUMAN]);
    expect(g.agents.map((e) => e.id)).toEqual([SA_AGENT_A, SA_AGENT_B]);
  });

  test("停用帳號一律不列", () => {
    const g = assignOptionGroups(PEOPLE, ME);
    expect([...g.agents, ...g.humans].some((e) => e.id === SA_OFF)).toBe(false);
  });

  test("目前使用者被停用時不出現在「我」，也不漏到 humans", () => {
    const off = emp({ id: SA_ADMIN, name: "測試管理員", active: false });
    const g = assignOptionGroups(PEOPLE, off);
    expect(g.me).toBeNull();
    expect(g.humans.some((e) => e.id === SA_ADMIN)).toBe(false);
  });
});

// ── editTargetLabel ─────────────────────────────────────────

describe("editTargetLabel：會被整段覆寫的欄位叫什麼", () => {
  test("查得到就用章節定義的中文名", () => {
    expect(editTargetLabel({ sectionId: "risk", fieldKey: "mitigation" }, SECTIONS)).toBe("緩解措施");
  });

  test("editTarget 缺值 → 「開放問題」，跟 saveAgentResult 的退路同一個欄位", () => {
    expect(editTargetLabel(undefined, SECTIONS)).toBe("開放問題");
  });

  test("章節被刪掉時顯示 id，不猜一個欄位名", () => {
    // 猜錯比不知道更糟：這行字的用途正是讓使用者知道哪一段會被換掉
    expect(editTargetLabel({ sectionId: "gone", fieldKey: "k" }, SECTIONS)).toBe("gone.k");
  });
});

// ── assignDialogHtml ────────────────────────────────────────

describe("assignDialogHtml：對話框內容", () => {
  const stages = [
    stage({ id: "s-r", order: 1, name: "結構完整度", kind: "review", mode: "sequential" }),
    stage({
      id: "s-e",
      order: 2,
      name: "文件補完",
      kind: "edit",
      required: false,
      mode: "parallel",
      editTarget: { sectionId: "risk", fieldKey: "mitigation" },
    }),
  ];
  const html = () =>
    assignDialogHtml(stages, PEOPLE, ME, SECTIONS, buildAssignments(stages, PEOPLE, ME));

  test("每一關一個 select，data-stage 是 stageDefId", () => {
    expect(html()).toContain('data-stage="s-r"');
    expect(html()).toContain('data-stage="s-e"');
  });

  test("預設值以 selected 標在對的 option 上", () => {
    // 兩關的 defaultActor 都是 agent → 都預設 Agent 甲
    expect(html().match(/<option value="sa-agent-a" selected>/g)?.length).toBe(2);
  });

  test("kind／非必簽／mode 都寫在列上", () => {
    const h = html();
    expect(h).toContain("審閱");
    expect(h).toContain("改稿");
    expect(h).toContain("非必簽");
    expect(h).toContain("串行");
    expect(h).toContain("並行");
  });

  /**
   * edit 關卡的警語不是裝飾。使用者在**指派的當下**就該知道哪一關會動內文，
   * 而不是在 agent 跑完、按下存檔之後才發現整段被換掉。
   */
  test("edit 關卡帶覆寫警語，並指名欄位；review 關卡沒有", () => {
    const h = html();
    expect(h).toContain("這一關存檔時會整段覆寫「緩解措施」");
    expect(h.match(/assign-warn/g)?.length).toBe(1);
  });

  test("關卡名與員工名都有 escape —— 兩者都是使用者打的字", () => {
    const evil = [stage({ id: "s-x", name: `<img src=x onerror="alert(1)">` })];
    const evilPeople = [emp({ id: "sa-evil", name: "<script>bad()</script>", kind: "agent" })];
    const h = assignDialogHtml(evil, evilPeople, null, SECTIONS, {});
    expect(h).not.toContain("<img src=x");
    expect(h).not.toContain("<script>");
    expect(h).toContain("&lt;img");
  });

  test("依 order 排，不依陣列順序", () => {
    const shuffled = [stages[1]!, stages[0]!];
    const h = assignDialogHtml(shuffled, PEOPLE, ME, SECTIONS, {});
    expect(h.indexOf("結構完整度")).toBeLessThan(h.indexOf("文件補完"));
  });
});

// ── readAssignments ─────────────────────────────────────────

describe("readAssignments：從對話框讀回選擇", () => {
  /** 只用到 querySelectorAll / dataset / value 三件事，headless 下拿假物件餵就好 */
  function fakeRoot(pairs: { stage: string; value: string }[]): HTMLElement {
    return {
      querySelectorAll: () => pairs.map((p) => ({ dataset: { stage: p.stage }, value: p.value })),
    } as unknown as HTMLElement;
  }

  test("空字串（— 不指派 —）讀成 null，不是空字串", () => {
    // caseFromWorkflow 用 `w.id in assignments` 判斷「有沒有提到這一關」；
    // "" 會被當成一個查不到的員工 id，結果看起來一樣但意圖不同
    const got = readAssignments(fakeRoot([{ stage: "s-1", value: "" }]));
    expect(got["s-1"]).toBeNull();
    expect(got["s-1"]).not.toBe("");
  });

  test("選了人就讀出那個 id，而且每一關都在", () => {
    expect(
      readAssignments(
        fakeRoot([
          { stage: "s-1", value: SA_AGENT_A },
          { stage: "s-2", value: "" },
          { stage: "s-3", value: SA_ADMIN },
        ]),
      ),
    ).toEqual({ "s-1": SA_AGENT_A, "s-2": null, "s-3": SA_ADMIN });
  });

  test("沒有 data-stage 的 select 跳過，不會塞出一個 undefined 鍵", () => {
    const root = {
      querySelectorAll: () => [{ dataset: {}, value: "x" }],
    } as unknown as HTMLElement;
    expect(readAssignments(root)).toEqual({});
  });
});

// ── store.submitPlan ────────────────────────────────────────

let seq = 0;
function freshProject(cat?: "lean" | "narrative" | "enterprise" | "agile" | "technical") {
  const id = `sa-${++seq}`;
  store.addProject({
    id,
    title: `指派 ${id}`,
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

function ensureEmployee(e: Record<string, unknown>) {
  if (!store.get().employees.some((x) => x.id === e.id)) store.addEmployee(e as never);
}

beforeEach(() => {
  ensureEmployee({
    id: SA_ADMIN,
    name: "測試管理員",
    kind: "human",
    accessRole: "admin",
    active: true,
    isCurrent: true,
  });
  store.setCurrentUser(SA_ADMIN);
});

describe("store.submitPlan：這次送審會不會建立關卡", () => {
  test("全新專案 → landsNow true，stages 是解析出來的骨架", () => {
    const id = freshProject("enterprise");
    const plan = store.submitPlan(id);
    expect(plan.landsNow).toBe(true);
    expect(plan.stages.map((s) => s.name)).toEqual([
      "結構完整度",
      "風險與相依",
      "技術可行性",
      "文件補完",
      "我核准",
    ]);
  });

  /**
   * S2：已落地的重送審直接送，不問指派。改人走簽核頁的 reassignCaseStage，
   * 那條路徑會留下紀錄；在這裡再問一次等於開一條不留紀錄的改派後門。
   */
  test("已落地的案子重送審 → landsNow false，stages 是專案自己那一份", () => {
    const id = freshProject("lean");
    store.submitForReview(id, "c1");
    const landedIds = proj(id).workflowStages!.map((s) => s.id);

    const plan = store.submitPlan(id);
    expect(plan.landsNow).toBe(false);
    expect(plan.stages.map((s) => s.id)).toEqual(landedIds);
  });

  test("跑過但沒落地（升級前的舊資料）→ landsNow false，stages 從個案反推", () => {
    const id = freshProject("lean");
    store.submitForReview(id, "c1");
    const oldIds = store.get().cases[id]!.stages.map((s) => s.id);
    store.approveAndLock({ stageIds: [oldIds[0]!], comment: "第一輪先過" });

    // 抹掉落地欄位，模擬升級前送出去的案子：個案跑到一半，專案沒有 workflowStages
    store.setProjects(
      store.get().projects.map((x) => {
        if (x.id !== id) return x;
        const { workflowStages: _drop, ...rest } = x;
        return rest;
      }),
    );
    expect(proj(id).workflowStages).toBeUndefined();

    const plan = store.submitPlan(id);
    expect(plan.landsNow).toBe(false);
    // 反推出來的定義保留原本的 stageDefId，紀錄才接得起來
    expect(plan.stages.map((s) => s.id)).toEqual(
      store.get().cases[id]!.stages.map((s) => s.stageDefId),
    );
  });

  test("submitPlan 是純讀 —— 呼叫它不會把流程落地", () => {
    const id = freshProject("technical");
    store.submitPlan(id);
    store.submitPlan(id);
    expect(proj(id).workflowStages).toBeUndefined();
    expect(proj(id).status).toBe("draft");
  });

  /**
   * 這一條釘的是「兩邊共用同一段判斷」。
   *
   * 分岔的症狀是「對話框問了指派，送審卻沒套用」—— 沒有錯誤訊息，關卡全部
   * 顯示「待指派」，看起來像使用者自己沒選。所以 landsNow 為真的那一次，
   * assignments 必須真的生效；為假的那一次，必須真的不生效。
   */
  test("landsNow true 的那一次，assignments 真的套得上去", () => {
    const id = freshProject("lean");
    const plan = store.submitPlan(id);
    expect(plan.landsNow).toBe(true);

    store.submitForReview(id, "c1", { [plan.stages[0]!.id]: SA_ADMIN });
    expect(store.get().cases[id]!.stages[0]!.assigneeId).toBe(SA_ADMIN);
  });

  test("landsNow false 的那一次，assignments 不生效（S2：改派要走簽核頁）", () => {
    const id = freshProject("lean");
    store.submitForReview(id, "c1");
    store.approveAndLock({ stageIds: [store.get().cases[id]!.stages[0]!.id], comment: "過" });

    const plan = store.submitPlan(id);
    expect(plan.landsNow).toBe(false);
    const before = store.get().cases[id]!.stages.map((s) => s.assigneeId);

    store.submitForReview(id, "c2", { [plan.stages[0]!.id]: SA_ADMIN });
    expect(store.get().cases[id]!.stages.map((s) => s.assigneeId)).toEqual(before);
  });

  test("submitPlan 的 stages 跟 submitForReview 真的落地的那一份逐字相同", () => {
    const id = freshProject("narrative");
    const planned = store.submitPlan(id).stages.map((s) => `${s.order}:${s.id}:${s.name}`);
    store.submitForReview(id, "c1");
    expect(proj(id).workflowStages!.map((s) => `${s.order}:${s.id}:${s.name}`)).toEqual(planned);
  });
});

// ── 生產呼叫端（F0 的形狀）──────────────────────────────────

describe("editor.ts 真的把指派交給了 store", () => {
  const EDITOR_SRC = readFileSync(new URL("../src/pages/editor.ts", import.meta.url), "utf8");

  /**
   * **這一條驗的是那一行程式碼，不是 store 的行為。**
   *
   * F0 的根因是生產呼叫端少傳一個參數，而它是全 repo 唯一的呼叫端。任何從
   * store API 出發的測試都驗不到它 —— 測試自己傳三個參數，驗的是一條生產
   * 程式碼走不到的路徑，1563 個測試因此全綠。
   */
  test("submitForReview 的第三個參數存在", () => {
    const call = EDITOR_SRC.match(/store\.submitForReview\([\s\S]{0,200}?\);/);
    expect(call).not.toBeNull();
    expect(call![0]).toContain("assignments");
    // 三個參數：不能只是把變數宣告在附近而沒有傳進去
    expect(call![0].split(",").length).toBeGreaterThanOrEqual(3);
  });

  test("指派用的是共用函式，不是頁面自己刻一份", () => {
    // 自己刻一份的話，測試驗的規則跟畫面上跑的規則會分岔
    expect(EDITOR_SRC).toContain("buildAssignments(");
    expect(EDITOR_SRC).toContain("read: readAssignments");
    expect(EDITOR_SRC).toContain("assignDialogHtml(");
  });

  test("「這次會不會落地」問 store.submitPlan()，UI 不自己算", () => {
    expect(EDITOR_SRC).toContain("store.submitPlan()");
    // UI 重寫一份判斷 = 兩份會分岔，而症狀是「問了指派卻沒套用」
    expect(EDITOR_SRC).not.toContain("caseHasRun(");
  });

  /**
   * 順序：對話框在 commit **之前**。
   * 放在 commit 之後的話，使用者一按取消就留下一個沒人要的版本快照，
   * 而版本清單上看不出它是廢的。
   *
   * ## 2026-08-26：這兩條改讀 `submit-flow.ts`
   *
   * **意圖逐字沒變，盯的那段程式碼換了檔案。** 送審按鈕的那段順序
   * （預檢 → 對話框 → commit → 送審）從 `editor.ts` 抽進
   * `src/lib/submit-flow.ts`，理由是 Scott 實測回報的缺陷正好在
   * 「兩個各自都正確的函式**之間**」——「檢查跑在對話框之後」。
   * 那種形狀 source-grep 驗不到（Wave 2 的 C-1／C-3 已經證明過一次），
   * 要抓得靠純函式 + 記錄呼叫的替身。
   *
   * 前例：C-3 那條 grep 也曾因為關卡列 HTML 從 `signoff.ts` 搬到
   * `signoff-stages.ts` 而改讀另一個檔案（見 `wave2-review-fixes.test.ts`）。
   *
   * **變嚴還是變鬆：變嚴。** 這兩條 grep 只驗得到「字串的先後」，
   * `tests/submit-precheck.test.ts` 的 Part B 現在**真的跑那段順序**，
   * 斷言取消時 commit 一次都沒被呼叫、沒東西可送時對話框一次都沒被開啟。
   * grep 留著是因為它還擋得住「有人把順序寫反」這種一眼可見的退步。
   */
  const SUBMIT_FLOW_SRC = readFileSync(
    new URL("../src/lib/submit-flow.ts", import.meta.url),
    "utf8",
  );

  test("指派對話框開在 commit 之前", () => {
    const iAsk = SUBMIT_FLOW_SRC.indexOf("await deps.ask()");
    const iCommit = SUBMIT_FLOW_SRC.indexOf("deps.commit()");
    expect(iAsk).toBeGreaterThan(-1);
    expect(iCommit).toBeGreaterThan(-1);
    expect(iAsk).toBeLessThan(iCommit);
  });

  /** 新增的一條：預檢又在對話框之前 —— 這是 Scott 撞到的那條缺陷 */
  test("預檢開在指派對話框之前", () => {
    const iPre = SUBMIT_FLOW_SRC.indexOf("deps.precheck()");
    const iAsk = SUBMIT_FLOW_SRC.indexOf("await deps.ask()");
    expect(iPre).toBeGreaterThan(-1);
    expect(iPre).toBeLessThan(iAsk);
  });

  test("取消時直接收工 —— 不 commit、不送審", () => {
    const flow = SUBMIT_FLOW_SRC.slice(SUBMIT_FLOW_SRC.indexOf("await deps.ask()"));
    const cancelBlock = flow.slice(0, flow.indexOf("deps.commit()"));
    expect(cancelBlock).toContain("CANCELLED");
    expect(cancelBlock).toContain("return");
  });

  /** editor 仍然是唯一的接線點：flow 拿到的 `commit` 必須真的接 store */
  test("editor 把 store.commitForReview 接進 flow 的 commit", () => {
    expect(EDITOR_SRC).toContain("runSubmitFlow<Assignments>");
    expect(EDITOR_SRC).toContain("store.commitForReview(");
  });
});

describe("FULL_CAT_LABEL", () => {
  test("五類都給得出中文名 —— 副標少一類就會印出 undefined", () => {
    expect(Object.keys(FULL_CAT_LABEL).sort()).toEqual([
      "agile",
      "enterprise",
      "lean",
      "narrative",
      "technical",
    ]);
    expect(Object.values(FULL_CAT_LABEL).every((v) => v.length > 0)).toBe(true);
  });
});
