import { describe, expect, test } from "bun:test";
import {
  canSignAnyStage,
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
