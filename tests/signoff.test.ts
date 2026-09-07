import { describe, expect, test } from "bun:test";
import {
  canSelfSign,
  canSignAnyStage,
  canSignStage,
  caseHasSelfSign,
  caseHoldsSelfSign,
  groupTimelineByRound,
  isSelfSignComment,
  isSelfSignDecision,
  isSelfSignStage,
  PREVIEW_DETAIL,
  SELF_SIGN_DRAFT_DETAIL,
  SELF_SIGN_DRAFT_HEADLINE,
  SELF_SIGN_NOTE,
  selfSignAnchor,
  selfSignNote,
  selfSignSubject,
  signoffSummary,
  signoffTimeline,
  stageRows,
} from "../src/lib/signoff";
import type { CaseRecord, CaseStage, Employee, Project } from "../src/data/types";

function emp(p: Partial<Employee> = {}): Employee {
  return {
    id: "u1",
    name: "阿明",
    title: "PM",
    avatar: "明",
    email: "a@b.c",
    accessRole: "approver",
    kind: "human",
    agentFamily: null,
    password: "x",
    ...p,
  } as Employee;
}

function proj(p: Partial<Project> = {}): Project {
  return {
    id: "p1",
    title: "案子",
    status: "review",
    pct: 50,
    owner: "別人",
    ownerId: "u9",
    authorId: "u9",
    authorAgentFamily: null,
    mine: false,
    updated: "剛剛",
    tag: "product",
    isSample: false,
    ...p,
  } as Project;
}

function stage(p: Partial<CaseStage> = {}): CaseStage {
  return {
    id: "cs1",
    stageDefId: "ws1",
    order: 1,
    name: "工程",
    assigneeId: "u1",
    assigneeName: "阿明",
    state: "pending",
    ...p,
  };
}

function kase(p: Partial<CaseRecord> = {}): CaseRecord {
  return {
    projectId: "p1",
    reviewCommitId: "c1",
    stages: [stage()],
    withdrawn: false,
    withdrawnAt: null,
    withdrawnBy: null,
    withdrawReason: null,
    locked: false,
    ...p,
  };
}

describe("canSignStage", () => {
  test("指派給我 → 可以簽", () => {
    expect(canSignStage(emp(), proj(), stage(), kase())).toEqual({ can: true });
  });

  test("指派給別人 → 不能，而且說得出是誰", () => {
    const r = canSignStage(emp(), proj(), stage({ assigneeId: "u2", assigneeName: "小華" }), kase());
    expect(r.can).toBe(false);
    expect(r.can === false && r.reason).toContain("小華");
  });

  test("未指派 + 我是簽核人 → 可以簽", () => {
    const s = stage({ assigneeId: null, assigneeName: "", state: "empty" });
    expect(canSignStage(emp(), proj(), s, kase({ stages: [s] })).can).toBe(true);
  });

  test("未指派 + 我只是編輯 → 不能", () => {
    const s = stage({ assigneeId: null, assigneeName: "", state: "empty" });
    const r = canSignStage(emp({ accessRole: "editor" }), proj(), s, kase({ stages: [s] }));
    expect(r.can).toBe(false);
  });

  test("admin 什麼關都能簽", () => {
    const s = stage({ assigneeId: "u2", assigneeName: "小華" });
    expect(canSignStage(emp({ accessRole: "admin" }), proj(), s, kase()).can).toBe(true);
  });

  test("**職責分立**：自己寫的規格不能自己簽（admin 除外）", () => {
    const me = emp({ id: "u9" });
    const r = canSignStage(me, proj({ authorId: "u9" }), stage({ assigneeId: "u9" }), kase());
    expect(r.can).toBe(false);
  });

  test("同族 agent 不能簽自己家寫的（職責分立的 agent 版）", () => {
    const bot = emp({ id: "b1", kind: "agent", agentFamily: "claude", accessRole: "approver" });
    const r = canSignStage(bot, proj({ authorAgentFamily: "claude" }), stage({ assigneeId: "b1" }), kase());
    expect(r.can).toBe(false);
  });

  test("案子層級的阻擋要**先**講：抽單優先於「這關不是你的」", () => {
    const s = stage({ assigneeId: "u2", assigneeName: "小華" });
    const r = canSignStage(emp(), proj(), s, kase({ withdrawn: true, stages: [s] }));
    expect(r.can === false && r.reason).toBe("此案已抽單");
  });

  test("已核准的關卡不能再簽", () => {
    const r = canSignStage(emp(), proj(), stage({ state: "approved" }), kase());
    expect(r.can === false && r.reason).toBe("這一關已核准");
  });

  test("沒有個案就沒得簽", () => {
    expect(canSignStage(emp(), proj(), stage(), undefined).can).toBe(false);
  });
});

describe("stageRows", () => {
  test("依 order 排序，並帶中文狀態", () => {
    const c = kase({
      stages: [
        stage({ id: "b", order: 2, name: "設計", state: "approved" }),
        stage({ id: "a", order: 1, name: "工程", state: "pending" }),
      ],
    });
    const rows = stageRows(emp(), proj(), c);
    expect(rows.map((r) => r.stage.name)).toEqual(["工程", "設計"]);
    expect(rows.map((r) => r.label)).toEqual(["待簽核", "已核准"]);
  });
});

describe("signoffSummary", () => {
  test("輪到我 → 頭條直接點名要簽哪幾關", () => {
    const c = kase({
      stages: [stage({ id: "a", order: 1 }), stage({ id: "b", order: 2, name: "設計", assigneeId: "u1" })],
    });
    const s = signoffSummary(emp(), proj(), c);
    expect(s.state).toBe("review");
    expect(s.headline).toContain("輪到你");
    expect(s.mine).toHaveLength(2);
    expect(s.detail).toBe("工程、設計");
  });

  test("在等別人 → 說得出在等誰、等哪一關", () => {
    const c = kase({ stages: [stage({ assigneeId: "u2", assigneeName: "小華" })] });
    const s = signoffSummary(emp(), proj(), c);
    expect(s.headline).toContain("小華");
    expect(s.headline).toContain("工程");
    expect(s.mine).toHaveLength(0);
  });

  test("尚未送審（沒有 reviewCommitId）跟審閱中要分得出來", () => {
    const s = signoffSummary(emp(), proj(), kase({ reviewCommitId: null }));
    expect(s.state).toBe("draft");
    expect(s.headline).toBe("尚未送審");
  });

  test("全簽完", () => {
    const c = kase({ stages: [stage({ state: "approved" })], locked: true });
    const s = signoffSummary(emp(), proj(), c);
    expect(s.state).toBe("approved");
    expect(s.approved).toBe(1);
  });

  test("抽單時把理由端出來，而不是只說已抽單", () => {
    const c = kase({ withdrawn: true, withdrawReason: "指標還沒對齊" });
    const s = signoffSummary(emp(), proj(), c);
    expect(s.state).toBe("withdrawn");
    expect(s.detail).toBe("指標還沒對齊");
  });

  test("沒有個案 / 沒有關卡", () => {
    expect(signoffSummary(emp(), proj(), undefined).state).toBe("none");
    expect(signoffSummary(emp(), proj(), kase({ stages: [] })).state).toBe("none");
  });
});

// 自簽過但沒送審時，頭條原本寫「尚未送審」—— 關卡全 approved、進度條滿格，
// 使用者只讀得出「系統漏了我的簽核」。系統沒漏，是自簽刻意不推進正式流程。
// 這一組釘住的是**只換文案、不動行為**：新文案要出現，舊文案要一字不動，
// `state` 要仍然是 `draft`。
describe("signoffSummary：自簽過但未送審", () => {
  const NOTE = selfSignNote(selfSignSubject("Z9K3M7QR"));
  const decision = (stageId: string) => ({
    id: `d-${stageId}`,
    stageId,
    round: 1,
    at: "2026-09-02T00:00:00Z",
    byId: "u1",
    byName: "阿明",
    kind: "approved" as const,
    comment: NOTE,
  });
  /** 自簽過的草稿個案：關卡蓋了自簽戳記，log 也留了對應決策 */
  const selfSigned = (over: Partial<CaseRecord> = {}) =>
    kase({
      reviewCommitId: null,
      stages: [stage({ id: "cs1", state: "approved", comment: NOTE })],
      log: [decision("cs1")],
      ...over,
    });

  test("自簽 + 未送審 → 頭條說得出已自簽，也說得出還沒進正式審閱", () => {
    const s = signoffSummary(emp(), proj(), selfSigned());
    expect(s.headline).toBe(SELF_SIGN_DRAFT_HEADLINE);
    expect(s.headline).toBe("已自簽 —— 尚未進入正式審閱");
    // 舊的那句謊不能還留在畫面上任何一處
    expect(s.headline).not.toBe("尚未送審");
    expect(s.detail).toBe(SELF_SIGN_DRAFT_DETAIL(1, 1));
    // 細節必須講「仍是草稿、進度不前進」—— 這正是使用者會誤讀的那一點
    expect(s.detail).toContain("仍是草稿");
    expect(s.detail).toContain("進度不會因為自簽而前進");
  });

  test("**逐字防迴歸**：沒自簽 + 未送審的文案一個字都不能變", () => {
    const s = signoffSummary(emp(), proj(), kase({ reviewCommitId: null }));
    expect(s.state).toBe("draft");
    expect(s.headline).toBe("尚未送審");
    expect(s.detail).toBe("流程有 1 關。到編輯台按「送出審閱」之後才會開始跑。");

    // 多關的情況也照舊帶數字
    const three = signoffSummary(
      emp(),
      proj(),
      kase({
        reviewCommitId: null,
        stages: [stage({ id: "a", order: 1 }), stage({ id: "b", order: 2 }), stage({ id: "c", order: 3 })],
      }),
    );
    expect(three.headline).toBe("尚未送審");
    expect(three.detail).toBe("流程有 3 關。到編輯台按「送出審閱」之後才會開始跑。");
  });

  test("**SPEC-03**：只換文案不換行為 —— state 仍是 draft，計數照舊", () => {
    const c = selfSigned({
      stages: [
        stage({ id: "cs1", state: "approved", comment: NOTE }),
        stage({ id: "cs2", order: 2, name: "設計", state: "changes_requested" }),
      ],
    });
    const s = signoffSummary(emp(), proj(), c);
    expect(s.state).toBe("draft");
    expect(s.approved).toBe(1);
    expect(s.total).toBe(2);
    // 自簽不核准 `changes_requested`（見 `selfSignVibe`），所以細節不能寫死「都核准了」
    expect(s.detail).toBe(SELF_SIGN_DRAFT_DETAIL(1, 2));
    expect(s.detail).toContain("1/2 關");
  });

  test("1 關自簽 approved ＋ 2 關別人簽的 approved → 細節說 1/3，不是 3/3", () => {
    const c = selfSigned({
      stages: [
        stage({ id: "cs1", state: "approved", comment: NOTE }),
        stage({ id: "cs2", order: 2, name: "設計", state: "approved", comment: "看過了" }),
        stage({ id: "cs3", order: 3, name: "資安", state: "approved", comment: "沒問題" }),
      ],
    });
    const s = signoffSummary(emp(), proj(), c);
    expect(s.state).toBe("draft");
    expect(s.headline).toBe(SELF_SIGN_DRAFT_HEADLINE);
    // 回傳欄位維持「全部 approved」的語意 —— 改的只有細節句的分子
    expect(s.approved).toBe(3);
    expect(s.total).toBe(3);
    // 細節句的主詞是「自簽已核准」—— 分子只數帶自簽戳記的那一關
    expect(s.detail).toBe(SELF_SIGN_DRAFT_DETAIL(1, 3));
    expect(s.detail).toContain("1/3 關");
    expect(s.detail).not.toContain("3/3");
  });

  test("自簽 + 已送審 → 走正式流程那幾支，不落在這條分支", () => {
    const s = signoffSummary(
      emp(),
      proj(),
      selfSigned({ reviewCommitId: "c1" }),
    );
    expect(s.state).toBe("approved");
    expect(s.headline).not.toBe(SELF_SIGN_DRAFT_HEADLINE);
  });

  test("抽單優先於自簽 —— 停掉的案子先講停掉", () => {
    const s = signoffSummary(
      emp(),
      proj(),
      selfSigned({ withdrawn: true, withdrawReason: "指標還沒對齊" }),
    );
    expect(s.state).toBe("withdrawn");
    expect(s.headline).toBe("此案已抽單");
  });

  test("preview 時細節仍是預覽那句 —— 自簽不得繞過 PREVIEW_DETAIL", () => {
    const s = signoffSummary(emp(), proj(), selfSigned(), { preview: true });
    // 頭條照樣誠實
    expect(s.headline).toBe(SELF_SIGN_DRAFT_HEADLINE);
    // 但「這 N 關送出時才會建立」的警告不能被吃掉
    expect(s.detail).toBe(PREVIEW_DETAIL(1));
    expect(s.state).toBe("draft");
  });

  test("preview + 沒自簽 → 逐字仍是舊的預覽組合", () => {
    const s = signoffSummary(emp(), proj(), kase({ reviewCommitId: null }), { preview: true });
    expect(s.headline).toBe("尚未送審");
    expect(s.detail).toBe(PREVIEW_DETAIL(1));
  });

  /**
   * **P0：升檔轉正之後不准再說「已自簽」。**
   *
   * 可達路徑是正常動線，不是邊角：vibe 專案 → 一鍵自簽 → 在編輯台把路線改成
   * full/lite。`setProjectRoute` 把自簽關卡重設回 pending、清掉 comment，但
   * **log 原樣保留**（spec 要的是可 replay 的錨點紀錄）。頭條若拿 log 當判準，
   * 畫面會變成「已自簽 —— 尚未進入正式審閱」＋「自簽已核准 0/1 關」——
   * 使用者剛做的動作正是把自簽核准丟掉轉進正式流程。
   *
   * 這是 B3 修掉的「自簽了卻說沒送審」的鏡像：沒自簽了卻說已自簽。判準要用
   * 現況（`caseHoldsSelfSign`），不是歷史（`caseHasSelfSign`）。
   */
  test("**P0**：升檔轉正後頭條回到「尚未送審」，細節不出現 0/N", () => {
    const c = selfSigned({ stages: [stage({ id: "cs1", state: "pending", comment: null })] });
    // 前提：log 的自簽紀錄真的還在，否則下面驗的是空集合
    expect(caseHasSelfSign(c)).toBe(true);
    expect(caseHoldsSelfSign(c)).toBe(false);

    const s = signoffSummary(emp(), proj(), c);
    expect(s.headline).not.toBe(SELF_SIGN_DRAFT_HEADLINE);
    expect(s.headline).toBe("尚未送審");
    // 自相矛盾的那句不能出現在任何一處
    expect(s.detail).toBe("流程有 1 關。到編輯台按「送出審閱」之後才會開始跑。");
    expect(s.detail).not.toContain("0/1");
    expect(s.detail).not.toContain("自簽");
    // 行為一個都不動：仍是草稿、計數照舊
    expect(s.state).toBe("draft");
    expect(s.approved).toBe(0);
    expect(s.total).toBe(1);
  });

  /**
   * 升檔只重設「自簽來的」核准 —— 正式簽的留著。這一條擋的是把判準寫成
   * 「stages 全 pending 就當沒自簽」之類的近似解：一關自簽、一關別人正式簽，
   * 升檔後自簽那關回 pending，正式那關仍 approved，頭條照樣不准說已自簽。
   */
  test("**P0**：升檔後只剩正式核准 —— 仍然不說已自簽", () => {
    const c = selfSigned({
      stages: [
        stage({ id: "cs1", state: "pending", comment: null }),
        stage({ id: "cs2", order: 2, name: "設計", state: "approved", comment: "看過了" }),
      ],
    });
    const s = signoffSummary(emp(), proj(), c);
    expect(s.headline).toBe("尚未送審");
    expect(s.approved).toBe(1);
    expect(s.detail).not.toContain("自簽");
  });
});

describe("signoffTimeline", () => {
  const versions = [
    { id: "v2", kind: "merge" as const, at: "2026-08-11T03:00:00.000Z", byId: "u1", byName: "阿明", message: "", docs: {} },
    { id: "v1", kind: "commit" as const, at: "2026-08-11T01:00:00.000Z", byId: "u9", byName: "作者", message: "", docs: {} },
  ];

  test("新的在前", () => {
    const c = kase({
      stages: [stage({ state: "approved", decidedAt: "2026-08-11T02:00:00.000Z", decidedByName: "阿明" })],
    });
    const t = signoffTimeline({ c, versions });
    expect(t.map((e) => e.kind)).toEqual(["merge", "approve", "submit"]);
  });

  test("沒有決策時間的舊資料沉到最後，而不是插進今天的事情中間", () => {
    const c = kase({
      stages: [
        stage({ id: "old", state: "approved", decidedByName: "" }),
        stage({ id: "new", state: "approved", decidedAt: "2026-08-11T02:00:00.000Z", decidedByName: "阿明" }),
      ],
    });
    const t = signoffTimeline({ c, versions: [] });
    expect(t[0]!.at).toBe("2026-08-11T02:00:00.000Z");
    expect(t[1]!.at).toBe("");
  });

  test("簽核意見進紀錄；沒留意見要明講而不是留白", () => {
    const c = kase({
      stages: [stage({ state: "approved", decidedAt: "2026-08-11T02:00:00.000Z", comment: "指標要再具體" })],
    });
    expect(signoffTimeline({ c, versions: [] })[0]!.detail).toBe("指標要再具體");
    const c2 = kase({ stages: [stage({ state: "approved", decidedAt: "2026-08-11T02:00:00.000Z" })] });
    expect(signoffTimeline({ c: c2, versions: [] })[0]!.detail).toBe("（沒有留下意見）");
  });

  test("未核准的關卡不進紀錄 —— 紀錄是已發生的事", () => {
    expect(signoffTimeline({ c: kase(), versions: [] })).toHaveLength(0);
  });

  test("稽核事件只補本地沒有的那幾筆，不重複講同一件事", () => {
    const c = kase({ withdrawn: true, withdrawnAt: "2026-08-11T04:00:00.000Z", withdrawReason: "r" });
    const t = signoffTimeline({
      c,
      versions,
      audit: [
        { at: "2026-08-11T04:00:00.000Z", kind: "review.withdraw", actorName: "阿明" },
        { at: "2026-08-11T01:00:00.000Z", kind: "review.submit", actorName: "作者" },
        { at: "2026-08-11T02:30:00.000Z", kind: "gate.pass", actorName: "阿明" },
      ],
    });
    // withdraw 與 submit 本地都有 → 不重複；gate.pass 逐關已列過 → 略過
    expect(t.filter((e) => e.kind === "audit")).toHaveLength(0);
    expect(t.filter((e) => e.kind === "withdraw")).toHaveLength(1);
  });

  test("本地沒有對應紀錄時，稽核事件補得上", () => {
    const t = signoffTimeline({
      c: kase(),
      versions: [],
      audit: [{ at: "2026-08-11T01:00:00.000Z", kind: "review.submit", actorName: "作者" }],
    });
    expect(t).toHaveLength(1);
    expect(t[0]!.title).toBe("送出審閱");
  });
});


describe("順序閘門", () => {
  const chain = (): CaseStage[] => [
    stage({ id: "a", order: 1, name: "工程", assigneeId: "u2", assigneeName: "小華" }),
    stage({ id: "b", order: 2, name: "設計", assigneeId: "u1", mode: "sequential" }),
  ];

  test("串行關卡被前面擋住時，理由要講前面那一關 —— 不是「這關不是你的」", () => {
    const c = kase({ stages: chain() });
    const r = canSignStage(emp(), proj(), c.stages[1]!, c);
    expect(r.can).toBe(false);
    expect(r.can === false && r.reason).toBe("等「工程」先過");
  });

  test("前面核准後就放行", () => {
    const stages = chain();
    stages[0]!.state = "approved";
    const c = kase({ stages });
    expect(canSignStage(emp(), proj(), stages[1]!, c).can).toBe(true);
  });

  test("並行的不受前面影響", () => {
    const stages = chain();
    stages[1]!.mode = "parallel";
    const c = kase({ stages });
    expect(canSignStage(emp(), proj(), stages[1]!, c).can).toBe(true);
  });

  test("順序閘門比權限先講 —— 診斷要指到真正的原因", () => {
    const stages = chain();
    stages[1]!.assigneeId = "u2"; // 也不是我的
    const c = kase({ stages });
    const r = canSignStage(emp(), proj(), stages[1]!, c);
    expect(r.can === false && r.reason).toBe("等「工程」先過");
  });
});

describe("要求修改", () => {
  test("有人退回時，頭條講的是「要修改」而不是「還差幾關」", () => {
    const c = kase({
      stages: [
        stage({ id: "a", order: 1, state: "approved" }),
        stage({ id: "b", order: 2, name: "資安", state: "changes_requested", comment: "指標沒有量測方式" }),
      ],
    });
    const s = signoffSummary(emp(), proj(), c);
    expect(s.state).toBe("needs_fix");
    expect(s.headline).toContain("要修改");
    expect(s.detail).toContain("指標沒有量測方式");
    expect(s.changesRequested).toHaveLength(1);
  });

  test("changes_requested 的關卡不能再被簽（要等作者重送）", () => {
    const st = stage({ state: "changes_requested" });
    const c = kase({ stages: [st] });
    // 指派給我，但案子在等作者改 —— summary 要看得出球不在簽核者手上
    expect(signoffSummary(emp(), proj(), c).state).toBe("needs_fix");
  });
});

describe("非必簽關卡", () => {
  test("不擋結案", () => {
    const c = kase({
      stages: [
        stage({ id: "a", order: 1, state: "approved", required: true }),
        stage({ id: "b", order: 2, name: "法務", state: "pending", required: false }),
      ],
    });
    expect(signoffSummary(emp(), proj(), c).state).toBe("approved");
  });

  test("必簽沒過就還沒結案", () => {
    const c = kase({
      stages: [
        stage({ id: "a", order: 1, state: "pending", required: true }),
        stage({ id: "b", order: 2, state: "approved", required: false }),
      ],
    });
    expect(signoffSummary(emp(), proj(), c).state).not.toBe("approved");
  });
});

describe("決策紀錄（log）", () => {
  const log = [
    { id: "d1", stageId: "cs1", round: 1, at: "2026-08-11T01:00:00.000Z", byId: "u2", byName: "小華", kind: "changes_requested" as const, comment: "指標沒有量測方式" },
    { id: "d2", stageId: "cs1", round: 2, at: "2026-08-11T05:00:00.000Z", byId: "u2", byName: "小華", kind: "approved" as const, comment: "" },
  ];

  test("**兩輪的意見都留得住** —— 這是舊版最大的洞", () => {
    const c = kase({ log, round: 2, stages: [stage({ state: "approved" })] });
    const t = signoffTimeline({ c, versions: [] });
    expect(t).toHaveLength(2);
    expect(t.map((e) => e.kind)).toEqual(["approved", "changes_requested"]);
    expect(t[1]!.detail).toBe("指標沒有量測方式");
  });

  test("依輪分組，新的一輪在前", () => {
    const c = kase({ log, round: 2, stages: [stage({ state: "approved" })] });
    const g = groupTimelineByRound(signoffTimeline({ c, versions: [] }));
    expect(g.map((x) => x.round)).toEqual([2, 1]);
  });

  test("代簽在紀錄上跟一般核准長得不一樣", () => {
    const c = kase({
      round: 1,
      stages: [stage({ state: "approved" })],
      log: [{ id: "d", stageId: "cs1", round: 1, at: "2026-08-11T01:00:00.000Z", byId: "u1", byName: "阿明", kind: "override" as const, comment: "時程提前，已口頭確認" }],
    });
    const t = signoffTimeline({ c, versions: [] });
    expect(t[0]!.title).toContain("以管理員身分代簽");
    expect(t[0]!.detail).toBe("時程提前，已口頭確認");
  });

  test("保留意見進紀錄但不改狀態", () => {
    const c = kase({
      round: 1,
      stages: [stage({ state: "pending" })],
      log: [{ id: "d", stageId: "cs1", round: 1, at: "2026-08-11T01:00:00.000Z", byId: "u1", byName: "阿明", kind: "comment" as const, comment: "這段我有疑問" }],
    });
    expect(signoffTimeline({ c, versions: [] })[0]!.title).toContain("留下意見");
    expect(c.stages[0]!.state).toBe("pending");
  });

  test("沒有 log 的舊個案退回反推法，不會整段空白", () => {
    const c = kase({ stages: [stage({ state: "approved", decidedAt: "2026-08-11T02:00:00.000Z", decidedByName: "小華" })] });
    const t = signoffTimeline({ c, versions: [] });
    expect(t).toHaveLength(1);
    expect(t[0]!.round).toBe(0);
  });
});

// ── 關卡上的 Agent 分析 ─────────────────────────────────────────

import { analysisVerdict, stageAnalysis } from "../src/lib/signoff";
import type { AgentJob } from "../src/data/types";

function job(p: Partial<AgentJob> = {}): AgentJob {
  return {
    id: "j1",
    agentId: "a1",
    agentName: "Claude · 核准",
    projectId: "p1",
    projectTitle: "案子",
    stageId: "s1",
    task: "review",
    status: "done",
    note: "",
    result: "建議核准\n理由如下",
    createdAt: "2026-08-12T02:00:00Z",
    finishedAt: "2026-08-12T02:01:00Z",
    ...p,
  };
}

describe("stageAnalysis", () => {
  test("取這一關最新的一筆 —— agentJobs 新的在前", () => {
    // 重跑是常態：舊結果屬於舊內容，貼在關卡上的必須是最新那筆
    const jobs = [job({ id: "j2", result: "建議修改\n新的" }), job({ id: "j1" })];
    expect(stageAnalysis(jobs, "p1", "s1")?.id).toBe("j2");
  });

  test("別關、別專案、沒綁關卡的工作單都不算", () => {
    const jobs = [
      job({ stageId: "s2" }),
      job({ projectId: "p2" }),
      job({ stageId: undefined }),
    ];
    expect(stageAnalysis(jobs, "p1", "s1")).toBeNull();
  });
});

describe("analysisVerdict", () => {
  test("第一行照規矩就直接讀出來", () => {
    expect(analysisVerdict("建議核准\n內容完整")).toBe("approve");
    expect(analysisVerdict("建議修改\n成功指標缺量測")).toBe("fix");
  });

  test("模型加了 markdown 裝飾也認得", () => {
    expect(analysisVerdict("**建議核准**\n理由")).toBe("approve");
    expect(analysisVerdict("# 建議修改：三點\n…")).toBe("fix");
    expect(analysisVerdict("「建議核准」\n…")).toBe("approve");
  });

  test("認不出來回 null，不猜 —— 猜錯的章比沒有章糟", () => {
    expect(analysisVerdict("這份 PRD 大致完整，但風險段落略薄。")).toBeNull();
    expect(analysisVerdict("")).toBeNull();
  });

  test("結論不在前幾行就當沒有 —— 埋在文末的結論人也看不到", () => {
    const buried = ["a", "b", "c", "d", "e", "f", "建議核准"].join("\n");
    expect(analysisVerdict(buried)).toBeNull();
  });
});

// ── 權限收斂（D3）────────────────────────────────────────────

describe("canSignStage 是唯一入口", () => {
  const agentClaude = emp({
    id: "a-claude",
    name: "Claude 核准",
    kind: "agent",
    accessRole: "approver",
    agentFamily: "claude",
  });
  const agentCodex = emp({
    id: "a-codex",
    name: "Codex 核准",
    kind: "agent",
    accessRole: "approver",
    agentFamily: "codex",
  });
  /** 有了員工清單，族系比對才查得到「這一關派給誰」 */
  const employees = [agentClaude, agentCodex];

  // ── 主要守門：族系比對的主體是**這一關的執行者** ──────────────
  //
  // 這一組才是真實流程。以前這個 describe 只驗「簽核者本身是同族系 agent」，
  // 而那個 user 在真實流程裡不存在 —— agent 只跑 invokeAgent 產出分析，
  // 按下核准的一律是人。測試因此全綠，守門卻整條沒掛上。

  test("人簽一個派給同族系 agent 的審查關卡 → 擋。這是主要守門", () => {
    const human = emp({ id: "u-me", accessRole: "admin" });
    const p = proj({ authorId: "claude-edit", authorAgentFamily: "claude" });
    const st = stage({ assigneeId: "a-claude", assigneeName: "Claude 核准", kind: "review" });
    const r = canSignStage(human, p, st, kase({ stages: [st] }), { employees });
    expect(r.can).toBe(false);
    // 理由要指得出出路，不然使用者只看到一個永遠按不下去的按鈕
    expect((r as { reason: string }).reason).toContain("改派");
  });

  test("執行者是別的族系 → 放行", () => {
    const human = emp({ id: "u-me", accessRole: "admin" });
    const p = proj({ authorId: "claude-edit", authorAgentFamily: "claude" });
    const st = stage({ assigneeId: "a-codex", kind: "review" });
    expect(canSignStage(human, p, st, kase({ stages: [st] }), { employees }).can).toBe(true);
  });

  test("edit 關卡不受族系限制 —— 族系隔離守的是審查，不是撰寫", () => {
    const human = emp({ id: "u-me", accessRole: "admin" });
    const p = proj({ authorId: "claude-edit", authorAgentFamily: "claude" });
    const st = stage({ assigneeId: "a-claude", kind: "edit", name: "文件補完" });
    expect(canSignStage(human, p, st, kase({ stages: [st] }), { employees }).can).toBe(true);
  });

  test("代簽繞得過關卡歸屬，繞不過執行者的族系", () => {
    const admin = emp({ id: "u-admin", accessRole: "admin" });
    const p = proj({ authorId: "claude-edit", authorAgentFamily: "claude" });

    // 一般人代簽：admin 放行
    const plain = stage({ assigneeId: "someone-else" });
    expect(canSignStage(admin, p, plain, kase({ stages: [plain] }), { override: true }).can).toBe(true);
    // 非 admin 不得代簽
    expect(canSignStage(emp({ accessRole: "approver" }), p, plain, kase({ stages: [plain] }), { override: true }).can).toBe(false);
    // 執行者撞族系：連 admin 代簽都不放行 —— 代簽繞的是「這關不是你的」，
    // 不是「審查者跟作者是同一顆腦袋」
    const claudeStage = stage({ assigneeId: "a-claude", kind: "review" });
    expect(
      canSignStage(admin, p, claudeStage, kase({ stages: [claudeStage] }), { override: true, employees }).can,
    ).toBe(false);
  });

  // ── 第二層：簽核者本身就是同族系 agent ────────────────────────
  //
  // 這條路徑目前沒有 UI 走得到（agent 不按核准），但規則一旦走得到就必須擋。
  // 保留它是為了「規則本身沒錯」，不是因為它驗得到真實流程 —— 真實流程在上面那一組。

  test("簽核者本身是同族系 agent 也要擋（目前無 UI 走得到，但規則要成立）", () => {
    const p = proj({ authorId: "claude-edit", authorAgentFamily: "claude" });
    const st = stage({ assigneeId: "a-claude" });
    const r = canSignStage(agentClaude, p, st, kase({ stages: [st] }));
    expect(r.can).toBe(false);
    expect((r as { reason: string }).reason).toContain("同一種 Agent");
  });

  test("族系隔離排在關卡歸屬之前 —— 講得出真正的原因", () => {
    const p = proj({ authorId: "claude-edit", authorAgentFamily: "claude" });
    // 這一關指派給別人，族系也撞號。兩個理由都成立，要講族系那個
    const st = stage({ assigneeId: "someone-else", assigneeName: "別人" });
    const r = canSignStage(agentClaude, p, st, kase({ stages: [st] }));
    expect((r as { reason: string }).reason).toContain("同一種 Agent");
  });

  test("不同族系的 agent 簽得動", () => {
    const p = proj({ authorId: "claude-edit", authorAgentFamily: "claude" });
    const st = stage({ assigneeId: "a-codex" });
    expect(canSignStage(agentCodex, p, st, kase({ stages: [st] })).can).toBe(true);
  });

  test("沒有簽核權限的角色講得出是角色問題", () => {
    const editor = emp({ id: "u-ed", accessRole: "editor" });
    const st = stage({ assigneeId: "u-ed" });
    const r = canSignStage(editor, proj(), st, kase({ stages: [st] }));
    expect(r.can).toBe(false);
    expect((r as { reason: string }).reason).toContain("無簽核權限");
  });

  test("人不可核准自己寫的（admin 例外）", () => {
    const me = emp({ id: "u1", accessRole: "approver" });
    const p = proj({ authorId: "u1" });
    const st = stage({ assigneeId: "u1" });
    expect(canSignStage(me, p, st, kase({ stages: [st] })).can).toBe(false);
    const admin = emp({ id: "u1", accessRole: "admin" });
    expect(canSignStage(admin, p, st, kase({ stages: [st] })).can).toBe(true);
  });
});

describe("canSignAnyStage", () => {
  test("有一關簽得動就是 true", () => {
    const mine = stage({ id: "s1", assigneeId: "u1" });
    const theirs = stage({ id: "s2", order: 2, assigneeId: "u9", assigneeName: "別人" });
    const c = kase({ stages: [mine, theirs] });
    expect(canSignAnyStage(emp(), proj(), c).can).toBe(true);
  });

  test("一關都簽不動時，講得出第一個理由而不是含糊的「無法簽核」", () => {
    const theirs = stage({ id: "s2", assigneeId: "u9", assigneeName: "別人" });
    const r = canSignAnyStage(emp(), proj(), kase({ stages: [theirs] }));
    expect(r.can).toBe(false);
    expect((r as { reason: string }).reason).toContain("別人");
  });

  test("全部結案講的是「都已結案」，不是「沒有權限」", () => {
    const done = stage({ state: "approved" });
    const r = canSignAnyStage(emp(), proj(), kase({ stages: [done] }));
    expect(r.can).toBe(false);
    expect((r as { reason: string }).reason).toContain("已結案");
  });

  test("沒有個案／沒有關卡各有各的說法", () => {
    expect((canSignAnyStage(emp(), proj(), undefined) as { reason: string }).reason).toContain("還沒有簽核個案");
    expect((canSignAnyStage(emp(), proj(), kase({ stages: [] })) as { reason: string }).reason).toContain("還沒有關卡");
  });
});

// ── vibe 檔的一鍵自簽（最小治理）───────────────────────────────
//
// 自簽不是跳過簽核：它要留得下決策紀錄與帶錨點的稽核事件，轉正時鏈條
// 才接得回去。這裡守純邏輯的三件事：只有 vibe 按得到、擋得住的情況講得
// 出理由、事件 subject 帶 `anc:t=` 前綴（join key 與其他 writer 同形）。

describe("canSelfSign", () => {
  /**
   * `proj()` 預設 `status: "review"`（那是 `canSignStage` 那一批的情境）。
   * 自簽的前提正好相反 —— 已送審就不給自簽，所以這裡一律覆寫成 draft。
   */
  const vibe = (over: Partial<Project> = {}) => proj({ route: "vibe", status: "draft", ...over });

  test("vibe 檔＋有簽核權限 → 可以自簽（豁免的是「人的自審」那一條，族系隔離照擋）", () => {
    expect(canSelfSign(emp({ id: "u9" }), vibe(), kase())).toEqual({ can: true });
    // authorId 就是簽的人 —— 一般簽核會被職責分立擋下，自簽不會
    expect(canSelfSign(emp({ id: "u9" }), vibe({ authorId: "u9" }), kase())).toEqual({
      can: true,
    });
  });

  test("已送出正式審閱就不給自簽 —— 關卡已指派給人，一鍵核准全部等於單方面終結一輪審閱", () => {
    const r = canSelfSign(emp(), vibe({ status: "review" }), kase());
    expect(r.can).toBe(false);
    // 訊息要說得出下一步 —— 而那個下一步只有審閱佇列一條
    expect((r as { reason: string }).reason).toContain("審閱佇列");
    /**
     * **不准再拿抽單當解法。** 舊文案寫「或先抽單把球拿回來再自簽」，而
     * `withdrawCase` 同時寫 `p.status = "withdrawn"` 與 `c.withdrawn = true` ——
     * 照做的人抽完單再按自簽，會被下一條 `c?.withdrawn` 擋掉。訊息明講的那條路
     * 100% 失敗。真路徑的證據在 `vibe-route-store.test.ts`（送審 → 抽單 → 自簽）。
     */
    expect((r as { reason: string }).reason).not.toContain("抽單");
  });

  test("沒有個案也可以自簽 —— 個案由 store 補建", () => {
    expect(canSelfSign(emp(), vibe(), undefined)).toEqual({ can: true });
  });

  test("full / lite 檔不給自簽，理由指向正式簽核", () => {
    for (const route of [undefined, "lite"] as const) {
      const r = canSelfSign(emp(), proj(route ? { route } : {}), kase());
      expect(r.can).toBe(false);
      expect((r as { reason: string }).reason).toContain("試作／探索");
    }
  });

  test("已抽單擋下來，而且講得出還走得通的下一步（重新送審）", () => {
    const r = canSelfSign(emp(), vibe(), kase({ withdrawn: true }));
    expect(r.can).toBe(false);
    expect((r as { reason: string }).reason).toContain("抽單");
    // 使用者正是在「抽單完想自簽」時撞到這裡 —— 只回一句狀態等於把他留在死路上。
    // 重新送審是真的走得通：`submitForReview` 會把 `withdrawn` 清回 false。
    expect((r as { reason: string }).reason).toContain("重新送出正式審閱");
  });

  test("已核准鎖定的案子擋下來", () => {
    const r = canSelfSign(emp(), vibe(), kase({ locked: true }));
    expect(r.can).toBe(false);
    expect((r as { reason: string }).reason).toContain("已核准鎖定");
  });

  test("log 已有自簽決策 → 擋，說「已經自簽過」", () => {
    const signed = kase({
      log: [
        {
          id: "d1",
          stageId: "cs1",
          round: 1,
          at: "2026-09-02T00:00:00Z",
          byId: "u1",
          byName: "阿明",
          kind: "approved",
          comment: `${SELF_SIGN_NOTE} · anc:t=ABCD1234`,
        },
      ],
    });
    const r = canSelfSign(emp(), vibe(), signed);
    expect(r.can).toBe(false);
    expect((r as { reason: string }).reason).toContain("已經自簽過");
  });

  test("全部關卡 skipped 的舊個案仍可自簽 —— allStagesSettled 會誤判 settled，vibe 檔就完全沒有簽核了", () => {
    const r = canSelfSign(emp(), vibe(), kase({ stages: [stage({ state: "skipped" })] }));
    expect(r).toEqual({ can: true });
  });

  test("同族系 agent 不能自簽自己家寫的文件 —— 族系隔離沒有自簽豁免（D3：沒有 admin 例外）", () => {
    const agent = emp({ kind: "agent", agentFamily: "claude", accessRole: "admin" });
    const r = canSelfSign(agent, vibe({ authorAgentFamily: "claude" }), kase());
    expect(r.can).toBe(false);
    expect((r as { reason: string }).reason).toContain("claude");
  });

  test("不同族系的 agent 有簽核權限就可以自簽", () => {
    const agent = emp({ kind: "agent", agentFamily: "codex" });
    expect(canSelfSign(agent, vibe({ authorAgentFamily: "claude" }), kase())).toEqual({
      can: true,
    });
  });

  test("無簽核權限的角色擋下來（editor 可寫不可簽）", () => {
    const r = canSelfSign(emp({ accessRole: "editor" }), vibe(), kase());
    expect(r.can).toBe(false);
    expect((r as { reason: string }).reason).toContain("簽核權限");
  });
});

describe("selfSignSubject", () => {
  test("帶 anc:t= 前綴 —— 與 git 回填 writer 的 subject 同一種形狀", () => {
    expect(selfSignSubject("ABCD1234")).toBe("anc:t=ABCD1234");
  });
});

// ── 自簽判讀 helper（writer 與 reader 同檔）────────────────────────
//
// 判準原本散在三處字串前綴比對（`canSelfSign` / `setProjectRoute` / store 的
// 字串樣板），改格式時沒有任何東西會提醒你還有另外兩處。收編之後這一組
// 是唯一入口，下面第一條合約測試就是「收編有沒有真的成立」的證據。

describe("自簽判讀 helper", () => {
  /** writer 產的那一句，逐字。後面每一條 reader 測試都吃這一句。 */
  const NOTE = selfSignNote(selfSignSubject("Z9K3M7QR"));

  test("**合約**：writer 產的字串被三支 reader 全部認得", () => {
    // 這一條是 writer 與 reader 進同一個檔的全部價值 —— 有人改了 note 的
    // 格式（前綴、分隔符、subject 形狀任一），這裡會紅，而不是等到升檔時
    // 才發現自簽核准沒被重設。
    expect(isSelfSignComment(NOTE)).toBe(true);
    expect(isSelfSignDecision({ kind: "approved", comment: NOTE })).toBe(true);
    expect(isSelfSignStage({ state: "approved", comment: NOTE })).toBe(true);
    // 錨點也要接得回去：三支認得但錨點取不出來，join key 一樣斷掉
    expect(selfSignAnchor(NOTE)).toBe("Z9K3M7QR");
  });

  test("selfSignNote 就是「前綴 · subject」—— store 那句字串樣板的唯一來源", () => {
    expect(NOTE).toBe(`${SELF_SIGN_NOTE} · anc:t=Z9K3M7QR`);
  });

  test("isSelfSignComment：沒有意見／空字串／別人的意見都不是自簽", () => {
    expect(isSelfSignComment(undefined)).toBe(false);
    expect(isSelfSignComment(null)).toBe(false);
    expect(isSelfSignComment("")).toBe(false);
    expect(isSelfSignComment("看過了，沒問題")).toBe(false);
    // 前綴在中間不算 —— 判準是「開頭」，不是「含有」。否則審閱者在意見裡
    // 引用這個詞（「這不是一鍵自簽（試作／探索）」）就會被誤判成自簽核准。
    expect(isSelfSignComment(`不是${NOTE}`)).toBe(false);
  });

  test("isSelfSignDecision：只有 approved 算 —— 帶同一句話的其他決策不算", () => {
    for (const kind of ["changes_requested", "comment", "skipped", "override"] as const) {
      expect(isSelfSignDecision({ kind, comment: NOTE }), kind).toBe(false);
    }
    expect(isSelfSignDecision({ kind: "approved", comment: "一般核准" })).toBe(false);
  });

  test("isSelfSignStage：state 與 comment 兩個條件缺一不可", () => {
    // 這一支是 `setProjectRoute` 早退條件的否定 —— 兩條真值表都要對，
    // 寫反的症狀是「升檔時把別人正式簽的核准也重設掉」（或反過來，
    // 自簽核准原樣帶進正式流程＝通用核准繞道）
    expect(isSelfSignStage({ state: "approved", comment: NOTE })).toBe(true);
    expect(isSelfSignStage({ state: "pending", comment: NOTE })).toBe(false);
    expect(isSelfSignStage({ state: "skipped", comment: NOTE })).toBe(false);
    expect(isSelfSignStage({ state: "approved", comment: "工程看過了" })).toBe(false);
    // 舊個案沒有 comment 欄位 —— 不能丟例外，答案就是 false
    expect(isSelfSignStage({ state: "approved" })).toBe(false);
  });

  test("caseHasSelfSign：有 log 就以 log 為準", () => {
    const d = {
      id: "d1",
      stageId: "cs1",
      round: 1,
      at: "2026-09-02T00:00:00Z",
      byId: "u1",
      byName: "阿明",
      kind: "approved" as const,
      comment: NOTE,
    };
    expect(caseHasSelfSign(kase({ log: [d] }))).toBe(true);
    expect(caseHasSelfSign(kase({ log: [{ ...d, comment: "一般核准" }] }))).toBe(false);
    // log **有內容**但沒有自簽 → false，即使關卡上有自簽戳記。log 是只追加的
    // 真相，關卡狀態只是投影。
    expect(
      caseHasSelfSign(
        kase({
          log: [{ ...d, comment: "一般核准" }],
          stages: [stage({ state: "approved", comment: NOTE })],
        }),
      ),
    ).toBe(false);
  });

  test("caseHasSelfSign：log 空的舊個案退回查 stages —— `[]` 與 undefined 同一路", () => {
    const old = kase({ stages: [stage({ state: "approved", comment: NOTE })] });
    expect(old.log).toBeUndefined();
    expect(caseHasSelfSign(old)).toBe(true);
    expect(caseHasSelfSign(kase({ stages: [stage({ state: "approved" })] }))).toBe(false);
    // 沒有個案就是沒簽過，不丟例外
    expect(caseHasSelfSign(undefined)).toBe(false);

    // ⚠️ `log: []` 必須與 `log: undefined` 走同一條路。`store.ts` 的 `load()`
    // 把每一份個案正規化成 `log: Array.isArray(c.log) ? c.log : []`，所以正式版
    // 根本不存在 `log: undefined` —— 判準寫成 `if (c.log)` 的話 stages 退路是死碼，
    // 而 `signoffTimeline` 用的是長度判斷，同一個個案兩支會給相反答案。
    expect(
      caseHasSelfSign(kase({ log: [], stages: [stage({ state: "approved", comment: NOTE })] })),
    ).toBe(true);
    expect(caseHasSelfSign(kase({ log: [], stages: [stage({ state: "approved" })] }))).toBe(false);
  });

  test("caseHoldsSelfSign：問的是現在還掛不掛著，不是曾經簽過", () => {
    const d = {
      id: "d1",
      stageId: "cs1",
      round: 1,
      at: "2026-09-02T00:00:00Z",
      byId: "u1",
      byName: "阿明",
      kind: "approved" as const,
      comment: NOTE,
    };
    // 自簽當下：兩個時態都是 true
    const signed = kase({ stages: [stage({ state: "approved", comment: NOTE })], log: [d] });
    expect(caseHasSelfSign(signed)).toBe(true);
    expect(caseHoldsSelfSign(signed)).toBe(true);

    // 升檔轉正之後（`setProjectRoute` 重設關卡、保留 log）：歷史仍在，現況沒了
    const promoted = kase({ stages: [stage({ state: "pending" })], log: [d] });
    expect(caseHasSelfSign(promoted)).toBe(true);
    expect(caseHoldsSelfSign(promoted)).toBe(false);

    // log 空的舊個案：現況只看 stages，跟 log 有沒有無關
    expect(
      caseHoldsSelfSign(kase({ log: [], stages: [stage({ state: "approved", comment: NOTE })] })),
    ).toBe(true);
    expect(caseHoldsSelfSign(undefined)).toBe(false);
  });

  test("selfSignAnchor 是 selfSignSubject 的逆向 —— 來回接得起來", () => {
    for (const id of ["ABCD1234", "Z9K3M7QR", "AB12"]) {
      expect(selfSignAnchor(selfSignNote(selfSignSubject(id))), id).toBe(id);
    }
  });

  test("selfSignAnchor 認不出來就回 null，不丟例外", () => {
    expect(selfSignAnchor("")).toBeNull();
    // 沒有分隔符
    expect(selfSignAnchor(SELF_SIGN_NOTE)).toBeNull();
    // 有分隔符但後面不是錨點 subject
    expect(selfSignAnchor(`${SELF_SIGN_NOTE} · 隨手寫的`)).toBeNull();
    // 有前綴但錨點是空的
    expect(selfSignAnchor(`${SELF_SIGN_NOTE} · anc:t=`)).toBeNull();
  });
});
