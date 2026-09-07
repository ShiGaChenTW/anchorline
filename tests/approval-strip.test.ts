/**
 * 審閱頁核准列 —— `lib/approval-strip.ts` 的合約。
 *
 * ## 這一輪要修的缺陷
 *
 * 一鍵自簽（vibe 檔，按一下把自己簽得動的關卡全簽掉）與四個人真的逐關看過
 * 再簽，在這條列上**一個字都不差**：兩邊都顯示「3 / 3 已簽」。看的人沒有
 * 任何辦法分辨那份核准是誰給的。
 *
 * ## 兩組測試各守一件事
 *
 * 1. **位元組相同** —— 這是一次搬移（`pages/review.ts` → `lib/`），非自簽情境
 *    的輸出必須跟搬移前逐字相同。下面的 `legacyStripHtml()` 是搬移前那段程式碼
 *    的複本，比對的是字串本身而不是「看起來一樣」。搬移順手改樣式是這一類重構
 *    最常見的暗傷：diff 看起來只是換個檔案，畫面卻悄悄變了。
 *
 * 2. **`stages` 缺席就安靜不標** —— `Approval` 是 `CaseStage` 的有損鏡像
 *    （`store.ts` 的 `approvalsFromCase()` 壓掉了 `skipped` 與
 *    `changes_requested`，而且根本沒有 `comment` 欄），任何從 `Approval`
 *    反推自簽的寫法都是猜的。猜錯的方向是把一場真正的多方簽核標成自簽 ——
 *    那是這條列存在的理由被反過來用，所以寧可少標。
 */
import { describe, expect, test } from "bun:test";
import { approvalStripHtml, SELF_SIGN_CARD_NOTE } from "../src/lib/approval-strip";
import { selfSignNote, selfSignSubject } from "../src/lib/signoff";
import { escapeHtml } from "../src/lib/ui";
import type { Approval, CaseStage } from "../src/data/types";

// ── fixtures ────────────────────────────────────────────────

const A = (over: Partial<Approval> & Pick<Approval, "id">): Approval => ({
  role: "工程",
  name: "阿哲",
  state: "approved",
  ...over,
});

/** 只帶 `approvalStripHtml` 讀得到的三個欄位 —— 渲染端本來就只拿得到投影物件 */
const S = (id: string, state: CaseStage["state"], comment?: string) => ({ id, state, comment });

const SELF_COMMENT = selfSignNote(selfSignSubject("t-42"));

/**
 * 搬移前 `pages/review.ts:431-455` 那段程式碼的**逐字複本**。
 *
 * 刻意不 import 新模組來產這一份 —— 它的存在意義就是「不受新模組影響的
 * 第二個來源」。改新模組時這一份不會跟著動，比對才有意義。
 */
function legacyStripHtml(approvals: Approval[], open: number, withdrawn: boolean): string {
  const cards = approvals
    .map((a) => {
      const cls =
        a.state === "approved" ? "is-approved" : a.state === "pending" ? "is-pending" : "is-empty";
      const stateLabel =
        a.state === "approved" ? "已簽" : a.state === "pending" ? "審閱中" : "待指派";
      return `<div class="approval-card ${cls}" data-od-id="approval-${a.id}">
        <span class="st" aria-hidden="true"></span>
        <span class="role">${escapeHtml(a.role)}</span>
        <span class="name">${escapeHtml(a.name || stateLabel)}</span>
      </div>`;
    })
    .join("");

  const signed = approvals.filter((a) => a.state === "approved").length;
  return (
    cards +
    `<div class="approval-meta" data-od-id="approval-meta">
      <span>${signed} / ${approvals.length} 已簽</span>
      <span>開放留言 ${open}</span>
      ${withdrawn ? '<span style="color:var(--danger)">已抽單</span>' : ""}
    </div>`
  );
}

// ── 搬移：位元組相同 ────────────────────────────────────────

describe("抽出後與搬移前逐字相同", () => {
  const suites: { name: string; approvals: Approval[]; open: number; withdrawn: boolean }[] = [
    { name: "空清單", approvals: [], open: 0, withdrawn: false },
    {
      name: "三態混合",
      approvals: [
        A({ id: "s1", role: "工程", name: "阿哲", state: "approved" }),
        A({ id: "s2", role: "設計", name: "小美", state: "pending" }),
        A({ id: "s3", role: "法務", name: "", state: "empty" }),
      ],
      open: 3,
      withdrawn: false,
    },
    {
      name: "已抽單",
      approvals: [A({ id: "s1", state: "pending", name: "" })],
      open: 1,
      withdrawn: true,
    },
    {
      name: "需要跳脫的角色與姓名",
      approvals: [A({ id: "s<1>", role: "工程 & <安全>", name: '"小明"' })],
      open: 0,
      withdrawn: false,
    },
  ];

  for (const s of suites) {
    test(s.name, () => {
      const next = approvalStripHtml({
        approvals: s.approvals,
        openComments: s.open,
        withdrawn: s.withdrawn,
        selfSigned: false,
      });
      expect(next).toBe(legacyStripHtml(s.approvals, s.open, s.withdrawn));
    });
  }

  test("有 stages 但沒有任何自簽戳記時也逐字相同", () => {
    const approvals = [A({ id: "s1", state: "approved" }), A({ id: "s2", state: "pending" })];
    const next = approvalStripHtml({
      approvals,
      stages: [S("s1", "approved", "看過了，沒問題"), S("s2", "pending")],
      openComments: 2,
      withdrawn: false,
      selfSigned: true,
    });
    expect(next).toBe(legacyStripHtml(approvals, 2, false));
  });
});

// ── 既有行為 ────────────────────────────────────────────────

describe("卡片與 meta", () => {
  test("狀態 class 逐一對應", () => {
    const html = approvalStripHtml({
      approvals: [
        A({ id: "s1", state: "approved" }),
        A({ id: "s2", state: "pending" }),
        A({ id: "s3", state: "empty" }),
      ],
      openComments: 0,
      withdrawn: false,
      selfSigned: false,
    });
    expect(html).toContain('class="approval-card is-approved"');
    expect(html).toContain('class="approval-card is-pending"');
    expect(html).toContain('class="approval-card is-empty"');
  });

  test("沒有姓名時退成狀態詞，不留空白", () => {
    const html = approvalStripHtml({
      approvals: [A({ id: "s1", name: "", state: "empty" })],
      openComments: 0,
      withdrawn: false,
      selfSigned: false,
    });
    expect(html).toContain('<span class="name">待指派</span>');
  });

  test("meta 帶已簽數、總數與開放留言數", () => {
    const html = approvalStripHtml({
      approvals: [A({ id: "s1", state: "approved" }), A({ id: "s2", state: "pending" })],
      openComments: 7,
      withdrawn: false,
      selfSigned: false,
    });
    expect(html).toContain("<span>1 / 2 已簽</span>");
    expect(html).toContain("<span>開放留言 7</span>");
    expect(html).not.toContain("已抽單");
  });

  test("已抽單時 meta 多一段", () => {
    const html = approvalStripHtml({
      approvals: [],
      openComments: 0,
      withdrawn: true,
      selfSigned: false,
    });
    expect(html).toContain("已抽單");
  });
});

// ── 自簽標記 ────────────────────────────────────────────────

describe("自簽標記", () => {
  const approvals = [
    A({ id: "s1", role: "AI 結構審查", name: "Scott", state: "approved" }),
    A({ id: "s2", role: "我核准", name: "Scott", state: "approved" }),
  ];
  const stages = [S("s1", "approved", SELF_COMMENT), S("s2", "approved", "同事看過了")];

  test("自簽的那一張帶 is-self-signed", () => {
    const html = approvalStripHtml({
      approvals,
      stages,
      openComments: 0,
      withdrawn: false,
      selfSigned: true,
    });
    expect(html).toContain('data-od-id="approval-s1"');
    expect(html).toContain("is-self-signed");
    // 只有 s1 被標 —— 這條列上同時存在自簽與真核准時，兩者要分得開
    expect(html.match(/is-self-signed/g)).toHaveLength(1);
    const s2 = html.slice(html.indexOf('data-od-id="approval-s2"'));
    expect(s2).not.toContain("is-self-signed");
  });

  test("自簽卡片帶誠實文案", () => {
    const html = approvalStripHtml({
      approvals,
      stages,
      openComments: 0,
      withdrawn: false,
      selfSigned: true,
    });
    expect(html).toContain(`<span class="ap-selfsign">${SELF_SIGN_CARD_NOTE}</span>`);
    expect(SELF_SIGN_CARD_NOTE).toContain("自簽");
    expect(SELF_SIGN_CARD_NOTE).toContain("草稿");
  });

  test("⚠️ stages 缺席時一律安靜不標", () => {
    const html = approvalStripHtml({
      approvals,
      openComments: 0,
      withdrawn: false,
      selfSigned: true,
    });
    expect(html).not.toContain("is-self-signed");
    expect(html).not.toContain("ap-selfsign");
    expect(html).not.toContain(SELF_SIGN_CARD_NOTE);
  });

  test("個案層級說沒自簽過時不標，即使關卡上有戳記", () => {
    const html = approvalStripHtml({
      approvals,
      stages,
      openComments: 0,
      withdrawn: false,
      selfSigned: false,
    });
    expect(html).not.toContain("is-self-signed");
  });

  test("關卡還沒核准就不算自簽，就算意見欄是自簽字樣", () => {
    const html = approvalStripHtml({
      approvals: [A({ id: "s1", state: "pending" })],
      stages: [S("s1", "pending", SELF_COMMENT)],
      openComments: 0,
      withdrawn: false,
      selfSigned: true,
    });
    expect(html).not.toContain("is-self-signed");
  });

  test("stages 來自別的個案（id 對不上）時不標", () => {
    const html = approvalStripHtml({
      approvals,
      stages: [S("other-1", "approved", SELF_COMMENT)],
      openComments: 0,
      withdrawn: false,
      selfSigned: true,
    });
    expect(html).not.toContain("is-self-signed");
  });

  test("stages 是空陣列時不標，也不當成錯誤", () => {
    const html = approvalStripHtml({
      approvals,
      stages: [],
      openComments: 0,
      withdrawn: false,
      selfSigned: true,
    });
    expect(html).not.toContain("is-self-signed");
  });

  test("自簽卡片仍保留原本的狀態 class，不是換掉它", () => {
    const html = approvalStripHtml({
      approvals: [A({ id: "s1", state: "approved" })],
      stages: [S("s1", "approved", SELF_COMMENT)],
      openComments: 0,
      withdrawn: false,
      selfSigned: true,
    });
    expect(html).toContain('class="approval-card is-approved is-self-signed"');
  });
});
