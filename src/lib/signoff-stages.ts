/**
 * 簽核頁的關卡清單 —— 純函式，零 I/O、零 DOM。
 *
 * ## 為什麼從 `pages/signoff.ts` 搬出來
 *
 * 這一輪要修的缺陷是「**畫面顯示的關卡 ≠ 送審會建立的關卡**」：`addProject`
 * 建專案時就先開了一個走全域預設流程的個案（工程／設計／資安／法務），而這個
 * 專案真正的骨架要到第一次送審才落地。送審前的簽核頁畫的是前者，送出那一刻
 * 整批被後者換掉 —— 沒有錯誤訊息，看起來完全正常。
 *
 * 這個形狀的缺陷**只有同時持有兩邊的合約測試抓得住**：一邊是這支函式產出的
 * HTML、另一邊是 `store.submitPlan()` 真的會建立的那一份。source-grep 型測試的
 * 解析度到「函式」為止，抓不到函式之間的分岔（Wave 2 的 C-1／C-3 就是這樣漏的）。
 * 而測試呼叫得到這支函式的前提，是它不再埋在一個要先過 `requireAuth()` 的頁面裡。
 *
 * 所以這裡是**唯一一個**產出關卡列的地方，預覽與正式兩條路都走它。
 * 頁面那一層只負責把 store 的東西湊齊交進來。
 */
import type {
  AgentJob,
  CaseRecord,
  CaseStage,
  Employee,
  Project,
  Section,
} from "../data/types";
import { jobLanded } from "../data/types";
import { stageAnalysisRowHtml } from "./agent-result";
import { stageAnalysisJobs, stageRows, type SignoffStageView } from "./signoff";
import { sinceLabel } from "./time-format";
import { escapeHtml } from "./ui";

/** 展開中的決策面板：哪一關、哪一種動作。null = 沒有展開 */
export type StagePending = {
  stageId: string;
  kind: "approved" | "changes_requested" | "comment" | "skipped";
};

export const ACT_LABEL: Record<StagePending["kind"], string> = {
  approved: "核准",
  changes_requested: "要求修改",
  comment: "保留意見",
  skipped: "略過",
};

/** 哪幾種動作必須寫理由 —— 少了理由，紀錄上就只剩一個結果 */
export const NEEDS_REASON: StagePending["kind"][] = ["changes_requested"];

/**
 * 預覽狀態的文案。
 *
 * 三件事**一句都不能少**，因為少哪一句就會退回原本那個缺陷的某一半：
 * 這是預覽（不是已經在跑的流程）、送出審閱時才建立、屆時會逐關問你派給誰。
 *
 * 敢這樣寫是因為畫的就是 `store.submitPlan()` 交出來的那一份 —— 行為先成立，
 * 文案才准講。反過來寫（先寫文案再想辦法讓行為對上）這一輪已經犯過兩次。
 */
export const PREVIEW_COPY = {
  kicker: "關卡（預覽）",
  banner: "這個案子還沒送出審閱，關卡也還沒建立。下面是送出審閱時會照現在的範本建立的那一份 —— 送出時會逐關問你派給誰。",
  note: "所以現在沒有可以簽的關卡。到編輯台按「送出審閱」，這幾關才會真的建立起來。",
  pill: "預覽",
  /** 沒有預設執行者時，寫「送審時指派」而不是「待指派」—— 後者聽起來像已經存在的關卡在等人 */
  unassigned: "送審時指派",
  count: (n: number) => `${n} 關 · 尚未建立`,
};

/**
 * 預覽狀態的關卡列。
 *
 * **刻意不畫任何動作**：`approveAndLock` 對 `status === "draft"` 一律回
 * 「這個案子還沒送出審閱」，所以核准／要求修改／保留意見／略過在這裡是四顆
 * 註定被擋下來的按鈕。改派、執行分析同理 —— 這些關卡的 id 還不存在於
 * `state.cases`，按下去只會拿到一句找不到關卡。
 *
 * 畫得出來的只有「送審時會建立什麼」：第幾關、叫什麼、串行還是並行、
 * 必不必簽、預設派給誰。
 */
export function previewStageListHtml(stages: readonly CaseStage[]): string {
  if (!stages.length) {
    return `<section class="card aiw-card" data-od-id="sg-stages">
      <p class="aiw-kicker">${PREVIEW_COPY.kicker}</p>
      <p class="aiw-card-sub">現在的範本與領域包解析不出任何關卡。到<a href="admin.html">管理中心 → 簽核流程</a>設定。</p>
    </section>`;
  }
  const body = [...stages]
    .sort((a, b) => a.order - b.order)
    .map((s) => {
      const mode = s.mode ?? "parallel";
      const who = s.assigneeId ? s.assigneeName : PREVIEW_COPY.unassigned;
      return `<li class="sg-stage sg-stage--empty">
        <div class="sg-stage-main">
          <span class="sg-stage-n mono">${s.order}</span>
          <span class="sg-stage-name">${escapeHtml(s.name)}
            <span class="sg-mode" title="${mode === "sequential" ? "要等前面的關卡結案" : "隨時可簽"}">${mode === "sequential" ? "串行" : "並行"}</span>
            ${s.required === false ? `<span class="sg-mode">非必簽</span>` : ""}</span>
          <span class="sg-stage-who">${escapeHtml(who)}</span>
          <span class="sg-pill sg-pill--empty">${PREVIEW_COPY.pill}</span>
        </div>
      </li>`;
    })
    .join("");

  return `<section class="card aiw-card aiw-card--wide" data-od-id="sg-stages">
    <div class="aiw-stage-head">
      <p class="aiw-kicker">${PREVIEW_COPY.kicker}</p>
      <span class="aiw-stage-count mono">${PREVIEW_COPY.count(stages.length)}</span>
    </div>
    <p class="aiw-card-sub">${PREVIEW_COPY.banner}</p>
    <ul class="sg-stages">${body}</ul>
    <p class="aiw-note">${PREVIEW_COPY.note}</p>
  </section>`;
}

export type StageListInput = {
  project: Project;
  user: Employee;
  /** **真的**那一份個案。`withdrawn` / `locked` 這種案件層級的旗標一律讀它 */
  c: CaseRecord | undefined;
  /** `signoffStageView()` 的回傳 —— 預覽與否、要畫哪一份關卡 */
  view: SignoffStageView;
  jobs: readonly AgentJob[];
  /** 這個專案的章節定義（`store.sectionsFor(p.id)`），給 `edit` 關卡查欄位中文名 */
  sections: readonly Section[];
  employees: readonly Employee[];
  pending: StagePending | null;
  now: number;
};

export function stageListHtml(opts: StageListInput): string {
  const { project: p, user, c, view, jobs, employees, sections, pending, now } = opts;
  const rows = stageRows(user, p, view.view);
  const isAdmin = user.accessRole === "admin";
  const people = employees.filter((e) => e.active !== false);

  // ── 送審前的預覽 ────────────────────────────────────────────
  //
  // `landsNow === true` ⇔ 眼前這份個案關卡送出那一刻就會被整批換掉。
  // 那份關卡不是這個案子要跑的流程，畫成一般關卡列就是一句不成立的話。
  if (view.preview) return previewStageListHtml(view.stages);

  // `edit` 關卡要講得出「會覆寫哪個欄位」的中文名，而那份章節定義是**專案的**：
  // 拿 active 的 `st.sections` 去查別的專案會查到另一份骨架的欄位名。

  if (!rows.length) {
    return `<section class="card aiw-card" data-od-id="sg-stages">
      <p class="aiw-kicker">關卡</p>
      <p class="aiw-card-sub">這個案子還沒有關卡。到<a href="admin.html">管理中心 → 簽核流程</a>設定，或直接送出審閱。</p>
    </section>`;
  }

  const body = rows
    .map(({ stage: s, label, ability }) => {
      const open = pending?.stageId === s.id;
      const mode = s.mode ?? "parallel";
      const settled = s.state !== "pending" && s.state !== "empty";
      const who = (settled && s.decidedByName) || s.assigneeName || "待指派";
      const when = settled && s.decidedAt ? sinceLabel(s.decidedAt, now) : "";

      // ── Agent 分析 ──────────────────────────────────────────
      // 指派 Agent 原本只是寫個名字，沒有任何東西會因此執行 ——
      // 這一關看起來「已安排」，實際上什麼都沒發生。這裡把兩套接起來：
      // 指派了 Agent 的關卡有「執行分析」，結果貼回關卡上。
      // 執行是手動的（Scott 2026-08-12）：何時燒 API 是使用者的決定。
      const assignee = employees.find((e) => e.id === s.assigneeId);
      const isAgent = assignee?.kind === "agent";
      // 一關可能有不只一張工作單要畫：按過「重新分析」之後前一份仍然 pending，
      // 改派給人之後那些 pending 也還在擋結案。合約住在 `stageAnalysisJobs`：
      // **擋得住結案的，一定在這個陣列裡。**
      const analysisJobs = stageAnalysisJobs({
        jobs,
        projectId: p.id,
        stageId: s.id,
        isAgent,
      });
      // 「重新分析」鈕看的是最新那一張，語意跟改動前一致
      const job = analysisJobs[0] ?? null;
      const busy = job?.status === "queued" || job?.status === "running";
      const analyzeBtn =
        isAgent && !settled && !c?.withdrawn && !c?.locked
          ? `<button type="button" class="btn btn-sm" data-sg-analyze="${escapeHtml(s.id)}"
               data-sg-agent="${escapeHtml(assignee!.id)}"${busy ? " disabled" : ""}>
               ${busy ? "分析中…" : job ? "重新分析" : "執行分析"}</button>`
          : "";
      // 顯示規則整批搬進 `agent-result.ts`：待拍板的**不**在列上攤開全文
      // （攤開的話，一份還沒有人同意的分析看起來就跟已經生效的內容一樣），
      // 已採用的講「存到哪了」，未採用的留一行灰字加可展開的全文。
      const analysisHtml = analysisJobs
        .map((j) =>
          stageAnalysisRowHtml({
            job: j,
            stage: s,
            sections,
            landed: jobLanded(j),
            now,
          }),
        )
        .join("");

      // 三顆動作等重。以前只有「核准」，發現問題時唯一能做的是不按 ——
      // 而那在畫面上跟「還沒輪到他」一模一樣。
      const actions = ability.can
        ? open
          ? ""
          : `<span class="sg-acts">
               <button type="button" class="btn btn-sm btn-primary" data-sg-act="approved" data-sg-stage="${escapeHtml(s.id)}">核准</button>
               <button type="button" class="btn btn-sm" data-sg-act="changes_requested" data-sg-stage="${escapeHtml(s.id)}">要求修改</button>
               <button type="button" class="btn btn-sm btn-ghost" data-sg-act="comment" data-sg-stage="${escapeHtml(s.id)}">保留意見</button>
               ${
                 s.required === false && s.state !== "skipped"
                   ? `<button type="button" class="btn btn-sm btn-ghost" data-sg-act="skipped" data-sg-stage="${escapeHtml(s.id)}">略過</button>`
                   : ""
               }
             </span>`
        : `<span class="sg-why" title="${escapeHtml(ability.reason)}">${escapeHtml(ability.reason)}</span>`;

      const reassign =
        isAdmin && s.state !== "approved" && !c?.locked && !c?.withdrawn
          ? `<select class="sg-assign" data-sg-assign="${escapeHtml(s.id)}" aria-label="改派 ${escapeHtml(s.name)}">
               <option value="">未指派</option>
               ${people
                 .map(
                   (e) =>
                     `<option value="${escapeHtml(e.id)}"${e.id === s.assigneeId ? " selected" : ""}>${escapeHtml(e.name)}</option>`,
                 )
                 .join("")}
             </select>`
          : "";

      const kind = pending?.kind ?? "approved";
      return `<li class="sg-stage sg-stage--${s.state}${open ? " is-signing" : ""}">
        <div class="sg-stage-main">
          <span class="sg-stage-n mono">${s.order}</span>
          <span class="sg-stage-name">${escapeHtml(s.name)}
            <span class="sg-mode" title="${mode === "sequential" ? "要等前面的關卡結案" : "隨時可簽"}">${mode === "sequential" ? "串行" : "並行"}</span>
            ${s.required === false ? `<span class="sg-mode">非必簽</span>` : ""}</span>
          <span class="sg-stage-who">${escapeHtml(who)}${when ? ` · ${escapeHtml(when)}` : ""}</span>
          <span class="sg-pill sg-pill--${s.state}">${escapeHtml(label)}</span>
          ${reassign}
          ${analyzeBtn}
          ${actions}
        </div>
        ${analysisHtml}
        ${
          // **只在意見還代表現況時才貼在列上。** 重送之後關卡退回待簽核，
          // 上一輪的意見卻還掛在那裡，看起來像「這一輪已經有人講過話了」——
          // 它屬於上一輪，位置在下面的紀錄裡。
          s.comment?.trim() && s.state !== "pending" && s.state !== "empty"
            ? `<p class="sg-stage-comment">「${escapeHtml(s.comment.trim())}」</p>`
            : ""
        }
        ${
          open
            ? `<div class="sg-sign-box">
                 <p class="sg-sign-head">${escapeHtml(ACT_LABEL[kind])}${NEEDS_REASON.includes(kind) ? "　<b>理由必填</b>" : ""}</p>
                 <textarea id="sg-comment" rows="3" placeholder="${
                   NEEDS_REASON.includes(kind)
                     ? "要改什麼？作者要靠這句話知道下一步"
                     : "意見（可留白）—— 會進簽核紀錄"
                 }"></textarea>
                 <div class="sg-sign-actions">
                   <button type="button" class="btn btn-sm btn-ghost" data-sg-cancel="1">取消</button>
                   <button type="button" class="btn btn-sm btn-primary" data-sg-confirm="${escapeHtml(s.id)}">確認${escapeHtml(ACT_LABEL[kind])}</button>
                 </div>
               </div>`
            : ""
        }
      </li>`;
    })
    .join("");

  const gating = rows.filter((r) => r.stage.required !== false);
  return `<section class="card aiw-card aiw-card--wide" data-od-id="sg-stages">
    <div class="aiw-stage-head">
      <p class="aiw-kicker">關卡</p>
      <span class="aiw-stage-count mono">${gating.filter((r) => r.stage.state === "approved" || r.stage.state === "skipped").length}/${gating.length} 必簽已結案</span>
    </div>
    <ul class="sg-stages">${body}</ul>
  </section>`;
}
