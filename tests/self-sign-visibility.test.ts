/**
 * 自簽在畫面上看不看得出來 —— B2a。
 *
 * ## 這一輪修的缺陷
 *
 * ```
 * A. vibe 專案一鍵自簽後，signoff.html 的關卡列：  ⬤ 已核准   ← 跟多方簽核一模一樣
 * B. 那一關的意見欄印的是：  「一鍵自簽（試作／探索） · anc:t=Z9K3M7QR」
 * C. 簽核紀錄的那一筆：      核准「我核准」 + 同一串 join key
 * ```
 *
 * B 與 C 印的是 `selfSignAnchor` 要讀的**內部 join key**，不是寫給人看的句子；
 * A 則是把「作者蓋自己的章」畫成「有人審過了」。三處都要分岔，而且要一起分岔：
 * 只改其中一處，剩下兩處仍在說同一句假話。
 *
 * ## 為什麼測得到
 *
 * 全 repo 沒有 DOM 測試環境，所以這三處都寫成「吃 plain data、回字串」的純
 * 函式：`stageListHtml`（關卡列）、`signoffTimeline`（分類）、`timelineRowHtml`
 * （紀錄列，這一輪才從 `pages/signoff.ts` 搬出來）。搬不出來的話「自簽」兩個字
 * 只能靠 CSS `content:` 注入 —— 那是把使用者讀得到的文案藏進樣式表。
 */
import { describe, expect, test } from "bun:test";
import {
  caseHasSelfSign,
  SELF_SIGN_DRAFT_HEADLINE,
  SELF_SIGN_HUMAN,
  selfSignNote,
  selfSignSubject,
  signoffSummary,
  signoffTimeline,
} from "../src/lib/signoff";
import { timelineRowHtml } from "../src/lib/signoff-log";
import { stageListHtml } from "../src/lib/signoff-stages";
import type {
  CaseDecision,
  CaseRecord,
  CaseStage,
  Employee,
  Project,
} from "../src/data/types";

const ANCHOR = "Z9K3M7QR";
/** 走 writer 產出，不手打字串 —— 這一整份測的就是 writer 與三支 reader 對得起來 */
const NOTE = selfSignNote(selfSignSubject(ANCHOR));

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
    owner: "阿明",
    ownerId: "u1",
    authorId: "u1",
    authorAgentFamily: null,
    mine: true,
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
    name: "我核准",
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

function decision(p: Partial<CaseDecision> = {}): CaseDecision {
  return {
    id: "d1",
    stageId: "cs1",
    round: 1,
    at: "2026-09-02T00:00:00Z",
    byId: "u1",
    byName: "阿明",
    kind: "approved",
    comment: "",
    ...p,
  } as CaseDecision;
}

/** 關卡列的完整輸入 —— 只有 `stages` 會變，其餘都是不影響這一題的常數 */
function listHtml(stages: CaseStage[]): string {
  const c = kase({ stages });
  return stageListHtml({
    project: proj(),
    user: emp(),
    c,
    view: { preview: false, stages, view: c },
    jobs: [],
    sections: [],
    employees: [emp()],
    pending: null,
    now: Date.parse("2026-09-02T01:00:00Z"),
  });
}

const selfSigned = stage({
  state: "approved",
  comment: NOTE,
  decidedAt: "2026-09-02T00:00:00Z",
  decidedByName: "阿明",
});
const humanApproved = stage({
  id: "cs2",
  order: 2,
  name: "資安",
  state: "approved",
  comment: "看過了，沒問題",
  decidedAt: "2026-09-02T00:00:00Z",
  decidedByName: "小華",
});

// ── 關卡列 ──────────────────────────────────────────────────

describe("關卡列把自簽標出來", () => {
  test("自簽的關卡整列帶 sg-stage--self-signed", () => {
    expect(listHtml([selfSigned])).toContain("sg-stage--self-signed");
  });

  test("自簽的關卡名旁邊帶「自簽」徽章", () => {
    expect(listHtml([selfSigned])).toContain(`<span class="sg-selfsign"`);
    expect(listHtml([selfSigned])).toContain(">自簽</span>");
  });

  test("意見欄改印人話，不是內部 join key", () => {
    const html = listHtml([selfSigned]);
    expect(html).toContain(SELF_SIGN_HUMAN);
    expect(html).not.toContain("一鍵自簽");
  });

  test("錨點用等寬字排**裸 id**，不印 anc:t= 前綴", () => {
    const html = listHtml([selfSigned]);
    expect(html).toContain(`錨點 <span class="mono">${ANCHOR}</span>`);
    expect(html).not.toContain("anc:t=");
  });

  test("認不出錨點的自簽仍印人話，只是少一條錨點 —— 不該整列掛掉", () => {
    const broken = stage({ state: "approved", comment: "一鍵自簽（試作／探索）" });
    const html = listHtml([broken]);
    expect(html).toContain(SELF_SIGN_HUMAN);
    expect(html).toContain("sg-stage--self-signed");
    expect(html).not.toContain(`class="mono">${ANCHOR}`);
  });

  test("一般核准的關卡完全不受影響 —— 沒有 class、沒有徽章，意見逐字照舊", () => {
    const html = listHtml([humanApproved]);
    expect(html).not.toContain("sg-stage--self-signed");
    expect(html).not.toContain("sg-selfsign");
    expect(html).not.toContain(SELF_SIGN_HUMAN);
    expect(html).toContain("「看過了，沒問題」");
  });

  test("同一張列表上兩者並排時，只有自簽那一列被標出來", () => {
    const html = listHtml([selfSigned, humanApproved]);
    expect(html.match(/sg-stage--self-signed/g)).toHaveLength(1);
    expect(html.match(/sg-selfsign/g)).toHaveLength(1);
    expect(html).toContain("「看過了，沒問題」");
  });

  test("帶自簽註記但還沒核准的關卡不算自簽 —— state 與 comment 缺一不可", () => {
    const html = listHtml([stage({ state: "pending", comment: NOTE })]);
    expect(html).not.toContain("sg-stage--self-signed");
    expect(html).not.toContain("sg-selfsign");
  });
});

// ── 時間軸分類 ──────────────────────────────────────────────

describe("signoffTimeline 把自簽分成獨立的 kind", () => {
  test("自簽決策的 kind 是 selfsign，不是 approved", () => {
    const c = kase({ log: [decision({ comment: NOTE })] });
    expect(signoffTimeline({ c, versions: [] })[0]!.kind).toBe("selfsign");
  });

  test("標題講「自簽核准」而不是「核准」", () => {
    const c = kase({ log: [decision({ comment: NOTE })] });
    expect(signoffTimeline({ c, versions: [] })[0]!.title).toBe("自簽核准「我核准」");
  });

  test("detail 是人話，anchor 是裸 id —— 兩者分欄，不混成一句", () => {
    const c = kase({ log: [decision({ comment: NOTE })] });
    const e = signoffTimeline({ c, versions: [] })[0]!;
    expect(e.detail).toBe(SELF_SIGN_HUMAN);
    expect(e.anchor).toBe(ANCHOR);
  });

  test("一般核准逐字不變 —— kind 仍是 approved、意見原樣、沒有 anchor", () => {
    const c = kase({ log: [decision({ comment: "指標要再具體" })] });
    const e = signoffTimeline({ c, versions: [] })[0]!;
    expect(e.kind).toBe("approved");
    expect(e.title).toBe("核准「我核准」");
    expect(e.detail).toBe("指標要再具體");
    expect(e.anchor).toBeUndefined();
  });

  test("沒有 log 的舊個案走反推路徑，一樣分類成 selfsign", () => {
    const c = kase({ stages: [selfSigned] });
    const e = signoffTimeline({ c, versions: [] })[0]!;
    expect(e.kind).toBe("selfsign");
    expect(e.detail).toBe(SELF_SIGN_HUMAN);
    expect(e.anchor).toBe(ANCHOR);
  });

  test("守門：自簽走過的時間軸整段不含 anc:t= 也不含前綴", () => {
    for (const c of [kase({ log: [decision({ comment: NOTE })] }), kase({ stages: [selfSigned] })]) {
      const dump = JSON.stringify(signoffTimeline({ c, versions: [] }));
      expect(dump).not.toContain("anc:t=");
      expect(dump).not.toContain("一鍵自簽");
    }
  });
});

// ── 紀錄列 ──────────────────────────────────────────────────

describe("timelineRowHtml", () => {
  const NOW = Date.parse("2026-09-02T01:00:00Z");
  const row = (over: Partial<Parameters<typeof timelineRowHtml>[0]> = {}) =>
    timelineRowHtml(
      {
        kind: "selfsign",
        at: "2026-09-02T00:00:00Z",
        who: "阿明",
        title: "自簽核准「我核准」",
        detail: SELF_SIGN_HUMAN,
        round: 1,
        anchor: ANCHOR,
        ...over,
      },
      NOW,
    );

  test("自簽的列帶 sg-log--selfsign", () => {
    expect(row()).toContain(`class="sg-log sg-log--selfsign"`);
  });

  test("自簽的列帶「自簽」徽章", () => {
    expect(row()).toContain(`<span class="sg-selfsign">自簽</span>`);
  });

  test("錨點用等寬字排裸 id，整列不含 anc:t=", () => {
    expect(row()).toContain(`錨點 <span class="mono">${ANCHOR}</span>`);
    expect(row()).not.toContain("anc:t=");
  });

  test("沒有錨點時只印人話，不留一個空的等寬欄", () => {
    const html = row({ anchor: null });
    expect(html).toContain(SELF_SIGN_HUMAN);
    expect(html).not.toContain(`錨點 <span class="mono">`);
  });

  test("一般核准的列逐字照舊 —— class 照 kind、沒有徽章、意見跳脫後直接印", () => {
    const html = row({ kind: "approved", title: "核准「我核准」", detail: "看過了", anchor: undefined });
    expect(html).toContain(`class="sg-log sg-log--approved"`);
    expect(html).not.toContain("sg-selfsign");
    expect(html).toContain("<span class=\"sg-log-detail\">看過了</span>");
  });

  test("沒有時間的舊資料仍寫「時間不詳」", () => {
    expect(row({ at: "" })).toContain("時間不詳");
  });
});

// ── 端到端合約 ──────────────────────────────────────────────

describe("writer 產出的 note 走完三支 reader 都不外洩 join key", () => {
  test("關卡列、時間軸、紀錄列三處都認得，而且三處都不印 anc:t=", () => {
    const c = kase({ stages: [selfSigned], log: [decision({ comment: NOTE })] });
    const entries = signoffTimeline({ c, versions: [] });
    const surfaces = [
      listHtml([selfSigned]),
      JSON.stringify(entries),
      entries.map((e) => timelineRowHtml(e, Date.parse("2026-09-02T01:00:00Z"))).join(""),
    ];
    for (const s of surfaces) {
      expect(s).toContain(SELF_SIGN_HUMAN);
      expect(s).not.toContain("anc:t=");
      expect(s).not.toContain("一鍵自簽");
    }
  });
});

/**
 * **P0：`log: []` 的舊個案不准在同一頁上給出兩種答案。**
 *
 * `store.ts` 的 `load()` 把每一份個案正規化成
 * `log: Array.isArray(c.log) ? c.log : []`，所以**正式版沒有 `log: undefined`**。
 * 一個 08-19 之前的舊個案（關卡上有自簽戳記、從來沒寫過 log）重載回來就長這樣：
 * stages 帶自簽 comment、`log` 是 `[]`。
 *
 * `[]` 是 truthy，於是判準寫法不同的兩支 reader 會分家：
 *
 * ```
 * caseHasSelfSign   if (c.log)          → 走 log → 空 → false   ← 說沒自簽
 * signoffTimeline   if (c?.log?.length) → 退回 stages → 印自簽   ← 說有自簽
 * stageListHtml     isSelfSignStage(s)  → 印自簽徽章             ← 說有自簽
 * ```
 *
 * 三處同時在畫面上，使用者一次讀到三種答案。這一組把它們釘在一起：判準改了
 * 其中一支就會紅。
 */
describe("P0：log 被正規化成 `[]` 的舊個案，全畫面同一個答案", () => {
  /** 08-19 之前的舊個案重載後的樣子：stages 有自簽戳記，log 是 `load()` 補的空陣列 */
  const legacy = () => kase({ reviewCommitId: null, log: [], stages: [selfSigned] });

  test("caseHasSelfSign 認得 —— `[]` 與 undefined 走同一條退路", () => {
    expect(caseHasSelfSign(legacy())).toBe(true);
    // 對照組：log 缺欄的個案本來就認得，兩者答案必須相同
    expect(caseHasSelfSign(kase({ reviewCommitId: null, stages: [selfSigned] }))).toBe(true);
  });

  test("關卡列、時間軸、頭條三者一致：都說這是自簽", () => {
    const c = legacy();
    // ① 關卡列的徽章
    expect(listHtml([selfSigned])).toContain("sg-selfsign");
    // ② 時間軸分類成 selfsign（退回掃 stages 的那條路）
    const entries = signoffTimeline({ c, versions: [] });
    expect(entries[0]!.kind).toBe("selfsign");
    // ③ 頭條 —— 自簽核准現在還掛在關卡上，所以講的是「已自簽」
    expect(signoffSummary(emp(), proj(), c).headline).toBe(SELF_SIGN_DRAFT_HEADLINE);
  });

  test("沒自簽的舊個案也要三者一致 —— 一律說沒有", () => {
    const clean = stage({ state: "approved", comment: "看過了，沒問題" });
    const c = kase({ reviewCommitId: null, log: [], stages: [clean] });
    expect(caseHasSelfSign(c)).toBe(false);
    expect(listHtml([clean])).not.toContain("sg-selfsign");
    // 反推路徑的一般核准是 `approve`（log 路徑才是 `approved`）—— 重點是
    // 「不是 selfsign」，逐字釘住是為了讓改 kind 的人看得到這裡也吃到
    expect(signoffTimeline({ c, versions: [] })[0]!.kind).toBe("approve");
    expect(signoffSummary(emp(), proj(), c).headline).toBe("尚未送審");
  });
});
