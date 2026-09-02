/**
 * 審閱頁頂端那條核准列 —— 純函式，零 I/O、零 DOM。
 *
 * ## 為什麼從 `pages/review.ts` 搬出來
 *
 * 這一輪要修的缺陷是「**一鍵自簽跟真正的多方簽核在這條上長得一模一樣**」：
 * vibe 檔按一下就把所有關卡簽掉，畫面上顯示的是「3 / 3 已簽」，跟四個人真的
 * 逐關看過再簽的結果一個字都不差。看的人沒有任何辦法分辨。
 *
 * 分辨的邏輯要能被測試釘住，前提是它不再埋在一個要先過 `requireAuth()` 的
 * 頁面裡 —— 全 repo 沒有 DOM 測試環境，`renderApprovals()` 那種「讀 store、寫
 * `innerHTML`」的函式在 `bun test` 裡根本呼叫不到。所以這裡只吃 plain data、
 * 只回字串；DOM 副作用（`#approvals-summary`／`#status-pill`／`#btn-approve`）
 * 留在頁面那一層，那些不是 HTML producer 的事。
 *
 * ## 為什麼不放進 `signoff-stages.ts`
 *
 * 那個檔的合約講的是「**送審會建立的關卡**」，與 `store.submitPlan()` 逐字對帳。
 * 核准列畫的是 `state.approvals` —— 一份由 `approvalsFromCase()` 產生的、
 * **有損的**關卡鏡像。把兩者放同一個檔，等於邀請後人拿其中一邊的合約去驗另一邊。
 *
 * ## ⚠️ `Approval` 是有損鏡像，所以自簽一定要靠 `stages`
 *
 * `store.ts` 的 `approvalsFromCase()` 把 `skipped` 壓成 `empty`、
 * `changes_requested` 壓成 `pending`，而且只有 active 個案會被同步。
 * `Approval` 上**沒有** `comment`，也就沒有 `SELF_SIGN_NOTE` 可比對 ——
 * 任何「從 `Approval` 反推自簽」的寫法都是猜的。
 *
 * 所以判準是：**`stages` 缺席就安靜不標**。寧可少標一次，也不要把一場真正的
 * 多方簽核誤標成自簽 —— 那是這條列存在的理由被反過來用。
 */
import type { Approval, CaseStage } from "../data/types";
import { isSelfSignStage } from "./signoff";
import { escapeHtml } from "./ui";

/**
 * 自簽卡片上多出來的那一行。
 *
 * 三件事一句都不能少：這是自簽（不是別人核准的）、性質是試作／探索、
 * 專案的實際狀態仍是草稿。少哪一句，這張卡片就退回原本那個「看起來像已核准」
 * 的樣子 —— 底紋只提示「這張不一樣」，說清楚哪裡不一樣的是這句話。
 */
export const SELF_SIGN_CARD_NOTE = "已自簽（試作／探索）—— 專案仍是草稿";

export type ApprovalStripInput = {
  /** `state.approvals`。畫幾張卡片、每張什麼狀態，一律以這份為準 */
  approvals: Approval[];
  /**
   * 這個專案的個案關卡，用來回答「這張卡片是自簽的嗎」。
   *
   * **optional 是刻意的**：沒有個案（種子資料）、或 active 個案不是這個專案時
   * 就是拿不到。拿不到的答案是「不知道」，不是「不是自簽」也不是「是」——
   * 呼叫端不必自己編一份空陣列來假裝知道。
   *
   * 對帳靠 `id`：`approvalsFromCase()` 直接把 `stage.id` 抄成 `approval.id`，
   * 所以 id 對不上就代表這兩份根本不是同一個個案，也就不會誤標。
   */
  stages?: Pick<CaseStage, "id" | "state" | "comment">[];
  /** 這個專案未解決的留言數（**不是**全域的） */
  openComments: number;
  withdrawn: boolean;
  /**
   * 這個個案有沒有自簽過 —— 呼叫端請傳 `caseHasSelfSign(caseRec)`。
   *
   * 它是 log 優先的答案（升檔會把關卡狀態重設回 pending，log 不會），而
   * `stages` 回答的是「**哪一關**」。兩個證人都點頭才標：任一邊說不，就當
   * 不知道。兩個方向的分歧都收斂成「不標」，因為誤標的代價是把真簽核講成假的。
   */
  selfSigned: boolean;
};

/** 這條列上哪幾張卡片是自簽來的。id 集合，空集合代表「不標」 */
function selfSignedIds(input: ApprovalStripInput): Set<string> {
  const out = new Set<string>();
  if (!input.selfSigned || !input.stages) return out;
  for (const s of input.stages) if (isSelfSignStage(s)) out.add(s.id);
  return out;
}

/**
 * 核准列的完整 HTML（卡片 + 右側 meta）。
 *
 * 非自簽情境下的輸出與搬出來之前 `renderApprovals()` 產的字串**逐字相同** ——
 * `tests/approval-strip.test.ts` 握著一份搬移前的複本做位元組比對。
 */
export function approvalStripHtml(input: ApprovalStripInput): string {
  const { approvals, openComments, withdrawn } = input;
  const selfIds = selfSignedIds(input);

  const cards = approvals
    .map((a) => {
      const cls =
        a.state === "approved" ? "is-approved" : a.state === "pending" ? "is-pending" : "is-empty";
      const stateLabel =
        a.state === "approved" ? "已簽" : a.state === "pending" ? "審閱中" : "待指派";
      const self = selfIds.has(a.id);
      return `<div class="approval-card ${cls}${self ? " is-self-signed" : ""}" data-od-id="approval-${a.id}">
        <span class="st" aria-hidden="true"></span>
        <span class="role">${escapeHtml(a.role)}</span>
        <span class="name">${escapeHtml(a.name || stateLabel)}</span>${
          self ? `\n        <span class="ap-selfsign">${escapeHtml(SELF_SIGN_CARD_NOTE)}</span>` : ""
        }
      </div>`;
    })
    .join("");

  const signed = approvals.filter((a) => a.state === "approved").length;
  return (
    cards +
    `<div class="approval-meta" data-od-id="approval-meta">
      <span>${signed} / ${approvals.length} 已簽</span>
      <span>開放留言 ${openComments}</span>
      ${withdrawn ? '<span style="color:var(--danger)">已抽單</span>' : ""}
    </div>`
  );
}
