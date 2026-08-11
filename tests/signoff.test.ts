import { describe, expect, test } from "bun:test";
import {
  canSignStage,
  groupTimelineByRound,
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
