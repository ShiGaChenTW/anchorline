/**
 * Wave 3 既有缺陷 B1／B2 —— Scott 2026-08-26 實測回報，探針重現過。
 *
 * ## B1：同一關同時顯示「已簽」與「待簽核」
 *
 * ```
 * 送審後:        AI 結構審查[empty]     who=待指派
 * 核准第1關:     AI 結構審查[approved]  who=Scott · 已簽
 * 第2關要求修改: AI 結構審查[approved]  who=Scott · 已簽
 * 重送審(第2輪): AI 結構審查[pending]   who=Scott · 已簽   ← 矛盾
 * ```
 *
 * `assigneeName` 被當成狀態欄用：`approveAndLock` 的 `sign()` 把它覆寫成
 * `"名字 · 已簽"`，而 `stagesAfterResubmit` 重送審時只把 `state` 退回 `pending`
 * —— 那行字沒人清。而且 `sign()` 保留原本的 `assigneeId`，所以改派下拉顯示
 * agent、旁邊那行字顯示簽核者，兩個欄位互相矛盾。
 *
 * ## B2：全新案子第一次送審，`round` 就跳到 2
 *
 * `submitForReview` 的 `nextRound` 用 `commitId !== c.reviewCommitId` 判斷，
 * 而新案子的 `reviewCommitId` 是 `null` —— 第一次送審必然不相等。
 *
 * ## 為什麼這一支要跑完整條、而且要讀 HTML
 *
 * 兩個缺陷都不在任何**單一**函式裡：B1 是「寫入端塞了狀態進去」與「重送審端
 * 只清了一半」之間的分岔，B2 是「初始值是 null」與「用不等於判斷」之間的分岔。
 * 只驗 store 的測試看不到畫面上那句矛盾的話，只驗畫面的測試造不出那份矛盾的
 * 資料 —— 兩種都會全綠（Wave 2 的 C-1／C-3 就是這樣漏的）。
 *
 * 所以這裡走**真的 store**：送審 → 核准 → 要求修改 → 重送審，
 * 每一步的斷言同時握著 `state.cases` 與 `stageListHtml()` 產出的 HTML。
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, mock, test } from "bun:test";

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
(globalThis as Record<string, unknown>).localStorage ??= {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
};

const { store } = await import("../src/data/store");
const {
  SIGNED_SUFFIX,
  groupTimelineByRound,
  normalizeStageAssignee,
  signoffStageView,
  signoffTimeline,
  stageAssignment,
} = await import("../src/lib/signoff");
const { stageListHtml } = await import("../src/lib/signoff-stages");
const { isNewRound } = await import("../src/lib/prd-versions");
import type { CaseDecision, CaseRecord, CaseStage, Project } from "../src/data/types";

const STORE_SRC = readFileSync(new URL("../src/data/store.ts", import.meta.url), "utf8");

// ── fixtures ────────────────────────────────────────────────
//
// id 帶檔名前綴：`bun test` 全部跑在同一個 process，`store` 是模組層單例，
// 通用 id 會跟別的測試檔撞號。

const B_ADMIN = "b3-admin";
const B_AGENT = "b3-agent";
const ADMIN_NAME = "B3 管理員";
const AGENT_NAME = "B3 結構審查 Agent";

let seq = 0;
function freshProject(): string {
  const id = `b3-${++seq}`;
  store.addProject({
    id,
    title: `B1B2 ${id}`,
    status: "draft",
    pct: 0,
    owner: ADMIN_NAME,
    domain: "generic",
  } as never);
  store.setActiveProject(id);
  store.applyFullTemplate(id, store.get().sections, {}, { cat: "lean" });
  return id;
}

const proj = (id: string): Project => store.get().projects.find((p) => p.id === id)!;
const caseOf = (id: string): CaseRecord => store.get().cases[id]!;
const stageAt = (id: string, i: number): CaseStage => caseOf(id).stages[i]!;

/** 頁面 render 時餵給 `stageListHtml` 的那一組參數，逐項照抄 `pages/signoff.ts` */
function htmlOf(id: string): string {
  const st = store.get();
  return stageListHtml({
    project: proj(id),
    user: st.currentUser,
    c: st.cases[id],
    view: signoffStageView({
      projectId: id,
      plan: store.submitPlan(id),
      c: st.cases[id],
      employees: st.employees,
    }),
    jobs: st.agentJobs,
    sections: store.sectionsFor(id),
    employees: st.employees,
    pending: null,
    now: Date.UTC(2026, 7, 26),
  });
}

/**
 * 從產出的 HTML 裡讀回每一關「那行字」。
 *
 * 刻意不讀 store —— 這一支要回答的是「**畫面上**寫了什麼」，
 * 從資料反推的話就退回成一條只驗 store 的測試了。
 */
function whoInHtml(html: string): string[] {
  return [...html.matchAll(/<span class="sg-stage-who">([\s\S]*?)<\/span>/g)].map((m) =>
    m[1]!.trim(),
  );
}

function ensureEmployee(e: Record<string, unknown>) {
  if (!store.get().employees.some((x) => x.id === e.id)) store.addEmployee(e as never);
}

beforeEach(() => {
  ensureEmployee({
    id: B_ADMIN,
    name: ADMIN_NAME,
    kind: "human",
    accessRole: "admin",
    active: true,
    isCurrent: true,
  });
  ensureEmployee({
    id: B_AGENT,
    name: AGENT_NAME,
    kind: "agent",
    agentFamily: "claude",
    accessRole: "approver",
    active: true,
  });
  store.setCurrentUser(B_ADMIN);
});

/**
 * 送審 → 核准第 1 關 → 第 2 關要求修改 → 重送審。
 *
 * 第 1 關**指派給 agent**、卻由管理員（人）簽核 —— 缺陷正是從這個組合長出來的：
 * 「派給誰」與「誰簽的」是兩個不同的人，共用一個欄位就一定有一邊被蓋掉。
 */
function runFullCycle(): { id: string; defIds: string[] } {
  const id = freshProject();
  const defIds = store.submitPlan(id).stages.map((s) => s.id);
  expect(defIds.length).toBeGreaterThanOrEqual(2);

  store.submitForReview(id, "b3-commit-1", { [defIds[0]!]: B_AGENT, [defIds[1]!]: B_ADMIN });
  const first = stageAt(id, 0);
  expect(store.approveAndLock({ stageIds: [first.id] }).ok).toBe(true);
  expect(store.requestChanges(stageAt(id, 1).id, "指標沒有量測方式").ok).toBe(true);
  store.submitForReview(id, "b3-commit-2");
  return { id, defIds };
}

// ── B1 ──────────────────────────────────────────────────────

describe("B1 關卡不得同時宣稱「已簽」與「待簽核」", () => {
  test("重送審之後那一關是 pending，而畫面上沒有「已簽」兩個字", () => {
    const { id } = runFullCycle();
    const s0 = stageAt(id, 0);
    expect(s0.state).toBe("pending");

    const html = htmlOf(id);
    // 整份關卡列 —— 連改派下拉的選項都算進去
    expect(html).not.toContain("已簽");
    expect(html).not.toContain(SIGNED_SUFFIX.trim());
  });

  test("pending 的那一關，畫面顯示的執行者 = `assigneeId` 指到的人（不是簽核者）", () => {
    const { id } = runFullCycle();
    const s0 = stageAt(id, 0);
    expect(s0.assigneeId).toBe(B_AGENT);
    // 簽的是管理員 —— 兩者確實是不同的人，這一條才有意義
    expect(s0.decidedByName).toBe(ADMIN_NAME);

    const who = whoInHtml(htmlOf(id))[0];
    const assignee = store.get().employees.find((e) => e.id === s0.assigneeId)!;
    expect(who).toBe(assignee.name);
    expect(who).not.toBe(ADMIN_NAME);
  });

  test("`assigneeName` 從頭到尾等於被指派者的名字 —— 簽核不會把它改掉", () => {
    const id = freshProject();
    const defIds = store.submitPlan(id).stages.map((s) => s.id);
    store.submitForReview(id, "b3-keep-1", { [defIds[0]!]: B_AGENT, [defIds[1]!]: B_ADMIN });
    expect(stageAt(id, 0).assigneeName).toBe(AGENT_NAME);

    store.approveAndLock({ stageIds: [stageAt(id, 0).id] });
    expect(stageAt(id, 0).state).toBe("approved");
    expect(stageAt(id, 0).assigneeName).toBe(AGENT_NAME);
    // 「誰簽的」有自己的欄位，資訊沒有掉
    expect(stageAt(id, 0).decidedByName).toBe(ADMIN_NAME);
  });

  test("已核准時畫面照樣講得出「誰簽的」—— 修掉矛盾不等於把資訊拿掉", () => {
    const id = freshProject();
    const defIds = store.submitPlan(id).stages.map((s) => s.id);
    store.submitForReview(id, "b3-signed-1", { [defIds[0]!]: B_AGENT, [defIds[1]!]: B_ADMIN });
    store.approveAndLock({ stageIds: [stageAt(id, 0).id] });

    // settled 的關卡讀 `decidedByName`，所以畫面上是簽核者，不是被指派的 agent
    expect(whoInHtml(htmlOf(id))[0]).toContain(ADMIN_NAME);
  });

  test("改派不再把「· 已簽」寫進名字", () => {
    const id = freshProject();
    const defIds = store.submitPlan(id).stages.map((s) => s.id);
    store.submitForReview(id, "b3-reassign-1", { [defIds[0]!]: B_AGENT, [defIds[1]!]: B_ADMIN });
    store.approveAndLock({ stageIds: [stageAt(id, 0).id] });

    expect(store.reassignCaseStage(id, stageAt(id, 0).id, B_ADMIN).ok).toBe(true);
    expect(stageAt(id, 0).assigneeName).toBe(ADMIN_NAME);
    expect(htmlOf(id)).not.toContain("已簽");
  });
});

describe("B1 既有資料的收斂", () => {
  /**
   * 只修寫入端不夠：那行字是**存下來的**，不是每次算出來的。
   * localStorage 裡已經有一批 `assigneeName` 被寫成「某某 · 已簽」的個案。
   */
  test("查得到執行者 → 照員工名單重新取名（修得掉「下拉是 agent、字是簽核者」）", () => {
    const dirty = { assigneeId: B_AGENT, assigneeName: `${ADMIN_NAME}${SIGNED_SUFFIX}` };
    expect(normalizeStageAssignee(dirty, store.get().employees).assigneeName).toBe(AGENT_NAME);
  });

  test("查不到執行者 → 只切後綴，不憑空造名字", () => {
    const gone = { assigneeId: "b3-deleted", assigneeName: `離職的人${SIGNED_SUFFIX}` };
    expect(normalizeStageAssignee(gone, []).assigneeName).toBe("離職的人");
  });

  test("沒指派的關卡也收斂得掉 —— 舊資料的 `empty` 關卡也被蓋過", () => {
    const orphan = { assigneeId: null, assigneeName: `代簽的人${SIGNED_SUFFIX}` };
    expect(normalizeStageAssignee(orphan, store.get().employees).assigneeName).toBe("代簽的人");
  });

  test("乾淨的資料原物件回傳 —— 不製造無謂的新參考", () => {
    const clean = { assigneeId: B_AGENT, assigneeName: AGENT_NAME };
    expect(normalizeStageAssignee(clean, store.get().employees)).toBe(clean);
  });

  test("收斂過的關卡畫成 HTML 之後不再出現「已簽」", () => {
    const st = store.get();
    const dirty: CaseStage = {
      id: "b3-legacy-cs",
      stageDefId: "b3-legacy-ws",
      order: 1,
      name: "AI 結構審查",
      assigneeId: B_AGENT,
      assigneeName: `${ADMIN_NAME}${SIGNED_SUFFIX}`,
      state: "pending",
      decidedByName: ADMIN_NAME,
      decidedAt: "2026-08-25T00:00:00.000Z",
      mode: "parallel",
      required: true,
    };
    const clean = normalizeStageAssignee(dirty, st.employees);
    const c: CaseRecord = {
      projectId: "b3-legacy",
      reviewCommitId: "c1",
      stages: [clean],
      round: 2,
      log: [],
      withdrawn: false,
      withdrawnAt: null,
      withdrawnBy: null,
      withdrawReason: null,
      locked: false,
    };
    const html = stageListHtml({
      project: { ...proj(freshProject()), status: "review" },
      user: st.currentUser,
      c,
      view: { preview: false, stages: c.stages, view: c },
      jobs: [],
      sections: [],
      employees: st.employees,
      pending: null,
      now: Date.UTC(2026, 7, 26),
    });
    expect(html).not.toContain("已簽");
    expect(whoInHtml(html)[0]).toBe(AGENT_NAME);
  });

  /**
   * 形狀防護：收斂函式存在、但 `load()` / `importState()` 沒接，等於什麼都沒做。
   * 這一條抄 `wave2-review-fixes.test.ts` 的 F0 防護 —— 那兩條路都不能在
   * 共用 store 單例的測試裡真的跑（會把別的測試檔的資料掃掉）。
   */
  test("`normalizeCases` 真的接上了收斂，而且 load 與 importState 共用同一支", () => {
    // 用 boolean 而不是 `toContain` —— 失敗時 `toContain` 會把整份 store.ts
    // 印進測試輸出（16 萬字），真正的訊息就淹掉了
    const body = STORE_SRC.slice(
      STORE_SRC.indexOf("function normalizeCases("),
      STORE_SRC.indexOf("function load()"),
    );
    expect(body.includes("normalizeStageAssignee(")).toBe(true);
    expect((STORE_SRC.match(/normalizeCases\(/g) ?? []).length).toBe(3); // 定義 + 兩個呼叫端
  });

  test("`stageAssignment` 是「派給誰」的唯一產生處，兩個欄位一起出", () => {
    expect(stageAssignment(store.get().employees.find((e) => e.id === B_AGENT))).toEqual({
      assigneeId: B_AGENT,
      assigneeName: AGENT_NAME,
    });
    expect(stageAssignment(null)).toEqual({ assigneeId: null, assigneeName: "待指派" });
  });
});

// ── B2 ──────────────────────────────────────────────────────

describe("B2 輪次不得多算一輪", () => {
  test("全新案子第一次送審 → round 是 1", () => {
    const id = freshProject();
    expect(caseOf(id).round ?? 1).toBe(1);
    store.submitForReview(id, "b3-r1");
    expect(caseOf(id).round).toBe(1);
  });

  test("換了 commit 的第二次送審才變 2", () => {
    const id = freshProject();
    store.submitForReview(id, "b3-r2-a");
    expect(caseOf(id).round).toBe(1);
    store.submitForReview(id, "b3-r2-b");
    expect(caseOf(id).round).toBe(2);
  });

  test("同一份快照重按送審不灌輪次", () => {
    const id = freshProject();
    store.submitForReview(id, "b3-r3");
    store.submitForReview(id, "b3-r3");
    expect(caseOf(id).round).toBe(1);
  });

  test("有人要求修改 → 就算快照沒換也算新的一輪", () => {
    const id = freshProject();
    const defIds = store.submitPlan(id).stages.map((s) => s.id);
    store.submitForReview(id, "b3-r4", { [defIds[0]!]: B_ADMIN, [defIds[1]!]: B_ADMIN });
    expect(caseOf(id).round).toBe(1);
    store.requestChanges(stageAt(id, 0).id, "這一段要改");
    store.submitForReview(id, "b3-r4");
    expect(caseOf(id).round).toBe(2);
  });

  test("`isNewRound` 純函式：從未送審過（prev 為 null）不算新的一輪", () => {
    const pending = [{ state: "pending" as const }];
    expect(isNewRound(pending, null, "c1")).toBe(false);
    expect(isNewRound(pending, "c1", "c2")).toBe(true);
    expect(isNewRound(pending, "c1", "c1")).toBe(false);
    // 沒帶新快照也不算 —— 舊條件在這裡也是對的，這一條防的是「順手改壞另一半」
    expect(isNewRound(pending, "c1", null)).toBe(false);
    // 還沒有關卡的案子不進輪次
    expect(isNewRound([], "c1", "c2")).toBe(false);
    // 要求修改過就算新的一輪，即使快照沒換
    expect(isNewRound([{ state: "changes_requested" as const }], null, null)).toBe(true);
  });
});

describe("B2 既有資料：round 已經被灌高過的個案", () => {
  const legacyLog: CaseDecision[] = [
    {
      id: "b3-d1",
      stageId: "b3-cs1",
      round: 2,
      at: "2026-08-20T01:00:00.000Z",
      byId: B_ADMIN,
      byName: ADMIN_NAME,
      kind: "changes_requested",
      comment: "第一次審閱的意見",
    },
    {
      id: "b3-d2",
      stageId: "b3-cs1",
      round: 3,
      at: "2026-08-21T01:00:00.000Z",
      byId: B_ADMIN,
      byName: ADMIN_NAME,
      kind: "approved",
      comment: "改好了",
    },
  ];

  const legacyCase = (round: number): CaseRecord => ({
    projectId: "b3-legacy-round",
    reviewCommitId: "c9",
    round,
    log: legacyLog,
    stages: [
      {
        id: "b3-cs1",
        stageDefId: "b3-ws1",
        order: 1,
        name: "AI 結構審查",
        assigneeId: B_AGENT,
        assigneeName: AGENT_NAME,
        state: "approved",
      },
    ],
    withdrawn: false,
    withdrawnAt: null,
    withdrawnBy: null,
    withdrawReason: null,
    locked: false,
  });

  /**
   * 取捨寫在這裡：**不回頭把既有個案的 `round` 減一。**
   *
   * `CaseDecision.round` 是寫入當下蓋上去的，`groupTimelineByRound` 分組讀的是
   * 那個戳記、不是 `c.round`。所以「灌高過」對既有紀錄只是一個外顯的偏移一，
   * 每一筆紀錄仍然跟自己那一輪的同伴在一起。
   */
  test("既有紀錄照舊分組，新的一輪在前 —— 修法不動它們", () => {
    const g = groupTimelineByRound(signoffTimeline({ c: legacyCase(3), versions: [] }));
    expect(g.map((x) => x.round)).toEqual([3, 2]);
    expect(g[0]!.entries.map((e) => e.detail)).toEqual(["改好了"]);
    expect(g[1]!.entries.map((e) => e.detail)).toEqual(["第一次審閱的意見"]);
  });

  test("灌高過的個案繼續往前走，新舊紀錄接得起來，沒有兩輪被併成一組", () => {
    const c = legacyCase(3);
    // 下一次送審換了快照 → 第 4 輪。新決策蓋 4，跟既有的 2／3 不撞號
    expect(isNewRound(c.stages, c.reviewCommitId, "c10")).toBe(true);
    const nextRound = (c.round ?? 1) + 1;
    expect(nextRound).toBe(4);

    const after: CaseRecord = {
      ...c,
      round: nextRound,
      log: [
        ...legacyLog,
        {
          id: "b3-d3",
          stageId: "b3-cs1",
          round: nextRound,
          at: "2026-08-26T01:00:00.000Z",
          byId: B_ADMIN,
          byName: ADMIN_NAME,
          kind: "approved",
          comment: "第三輪核准",
        },
      ],
    };
    const g = groupTimelineByRound(signoffTimeline({ c: after, versions: [] }));
    expect(g.map((x) => x.round)).toEqual([4, 3, 2]);
    expect(g.map((x) => x.entries.length)).toEqual([1, 1, 1]);
  });

  /**
   * 反面證據：如果為了讓標籤好看而在載入時把 `c.round` 減一，
   * 下一輪的決策就會蓋上一個**既有紀錄已經占著**的號碼 ——
   * 兩輪的紀錄被併成一組，而那正是分組要防的事。
   */
  test("反例：回頭把既有 round 減一，下一輪就會跟既有紀錄撞號", () => {
    const migrated = legacyCase(2); // 假想的「修正」：3 → 2
    const collided = (migrated.round ?? 1) + 1; // 下一輪 = 3，而 3 已經有紀錄了
    const after: CaseRecord = {
      ...migrated,
      round: collided,
      log: [
        ...legacyLog,
        {
          id: "b3-d3",
          stageId: "b3-cs1",
          round: collided,
          at: "2026-08-26T01:00:00.000Z",
          byId: B_ADMIN,
          byName: ADMIN_NAME,
          kind: "approved",
          comment: "第三輪核准",
        },
      ],
    };
    const g = groupTimelineByRound(signoffTimeline({ c: after, versions: [] }));
    expect(g.map((x) => x.round)).toEqual([3, 2]);
    // 兩輪被併進同一組 —— 這就是不做回溯遷移的理由
    expect(g[0]!.entries.length).toBe(2);
  });
});
