/**
 * 簽核管理 —— 一個專案的簽核作業台。
 *
 * 跟旁邊三個既有介面的分工：
 *
 * - **審閱佇列（review）** 看的是「內容對不對」：正文、diff、留言。
 * - **管理中心 → 個案（admin）** 是**跨專案**的工作區管理：改派、抽單、重開。
 * - **PRD 審閱監控（write）** 只把簽核狀態當成一張唯讀卡片。
 * - **這一頁** 是「這個案子的簽核本身」：現在卡在誰、逐關簽核並留意見、完整紀錄。
 *
 * ## 版面照 ADHD 那一套
 *
 * 頭條先講「現在卡在誰身上」（整頁唯一有顏色的東西），關卡清單安靜可掃視，
 * 紀錄收在下面。跟 PRD 審閱監控同一套視覺語言，不另做一種。
 */
import { store } from "../data/store";
import { projectDisplayName, resolveEditTarget, stageKind, type AgentJob, type CaseStage, type Project } from "../data/types";
import { askConfirm, askCustom, isDialogOpen } from "../lib/ask";
import { createDialogFlows } from "../lib/dialog-flow";
import {
  agentResultDialogHtml,
  pendingGateHtml,
  pendingGateItems,
  resultConfirmLabel,
  resultDialogTitle,
} from "../lib/agent-result";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import { initHelpOverlay } from "../lib/help-overlay";
import { beginBootOverlay, endBootOverlay, failBootOverlay } from "../lib/loading-overlay";
import { syncRailContext } from "../lib/rail-projects";
import {
  groupTimelineByRound,
  signoffCta,
  signoffStageView,
  signoffSummary,
  signoffTimeline,
  type SignoffStageView,
} from "../lib/signoff";
import {
  ACT_LABEL,
  NEEDS_REASON,
  stageListHtml as stageListHtmlOf,
  type StagePending,
} from "../lib/signoff-stages";
import { initTheme } from "../lib/theme";
import { sinceLabel } from "../lib/time-format";
import { escapeHtml, initMobileNav, toast, updateUserRailFooter } from "../lib/ui";

// 第一行：攔截要先裝好才擋得住後面任何一行的 throw。8 秒硬上限只是最後一道
// 保險——正常路徑由下面的 finally 收掉，這裡防的是「沒 throw 但也不回來」。
beginBootOverlay({ autoHideAfter: 8000 });

if (!requireAuth()) {
  // 導向登入中。**刻意不收遮罩** —— 收了只會讓使用者看到一頁馬上要離開的空殼
} else {
  initTheme();
  initMobileNav("signoff");
  bindLogout();
  initHelpOverlay();

  const root = document.getElementById("sg-root");
  let pending: StagePending | null = null;

  function activeProject(): Project | null {
    const st = store.get();
    const visible = st.projects.filter((p) => (st.showSamples ? true : !p.isSample));
    const picked = visible.find((p) => p.id === st.activeProjectId) ?? visible[0] ?? null;
    if (picked && picked.id !== st.activeProjectId) store.setActiveProject(picked.id);
    return picked;
  }

  function syncChrome(p: Project | null, view: SignoffStageView | null) {
    updateUserRailFooter(toRailUser(store.get().currentUser));
    const name = p ? projectDisplayName(p) : "未選擇專案";
    const sub = document.querySelector<HTMLElement>('[data-od-id="page-sub"]');
    // 副標的數字也要照 `view` 算。讀真的那份個案的話，送審前會顯示
    // 「0/4 關已核准」—— 而那 4 關送出那一刻就會被換成別的幾關，
    // 數字本身就是這個缺陷的一部分，不只是關卡列在說謊
    const stages = view?.stages ?? [];
    if (sub) {
      sub.textContent = p
        ? `${name} · ${
            !stages.length
              ? "尚未建立關卡"
              : view?.preview
                ? `${stages.length} 關（送審後才建立）`
                : `${stages.filter((s) => s.state === "approved").length}/${stages.length} 關已核准`
          }`
        : "先建立或選擇一個專案";
    }
    syncRailContext({
      mode: "簽核管理",
      projectName: name,
      statusLabel: p?.status === "approved" ? "已核准" : p?.status === "review" ? "審閱中" : "草稿",
      statusTone: p?.status === "approved" ? "ok" : p?.status === "review" ? "review" : "draft",
    });
    document.title = `簽核管理 · ${name} · Anchorline`;
  }

  // ── 頭條 ────────────────────────────────────────────────────

  function heroHtml(p: Project, view: SignoffStageView): string {
    const st = store.get();
    const sum = signoffSummary(st.currentUser, p, view.view, { preview: view.preview });
    const pct = sum.total ? Math.round((sum.approved / sum.total) * 100) : 0;
    const tone =
      sum.state === "approved"
        ? "ok"
        : sum.state === "withdrawn" || sum.state === "needs_fix"
          ? "warn"
          : "go";
    // CTA 只在「真的輪到我」時出現。沒有我的關卡卻放一顆主要按鈕，
    // 等於邀請人去按一個註定被擋下來的東西 —— 選哪一顆的判斷住在
    // `signoffCta`（純函式，驗得到「預覽狀態下不得出現核准鈕」），這裡只負責畫
    const pick = signoffCta(sum, { preview: view.preview });
    const cta = !pick
      ? ""
      : pick.kind === "link"
        ? `<a class="btn btn-primary btn-lg" href="${escapeHtml(pick.href)}">${escapeHtml(pick.label)}</a>`
        : `<button type="button" class="btn btn-primary btn-lg" data-sg-act="approved" data-sg-stage="${escapeHtml(pick.stage.id)}">核准「${escapeHtml(pick.stage.name)}」→</button>`;

    return `<section class="ov-hero aiw-hero" data-od-id="sg-hero">
      <p class="ov-hero-kicker">現在卡在誰身上</p>
      <h2 class="ov-hero-name">${escapeHtml(sum.headline)}</h2>
      <div class="ov-meter meter-${tone}" role="img" aria-label="簽核進度 ${pct}%">
        <div class="ov-meter-track"><i style="width:${pct}%"></i></div>
        <span class="ov-meter-value">${sum.approved}<span class="ov-meter-unit">/${sum.total}</span></span>
      </div>
      <p class="ov-hero-why">${escapeHtml(sum.detail)}</p>
      ${cta ? `<p class="ov-hero-cta">${cta}</p>` : ""}
    </section>`;
  }

  // ── 關卡清單 ────────────────────────────────────────────────
  //
  // HTML 本身住在 `lib/signoff-stages.ts`。搬出去的理由寫在那個檔頭：
  // 這一輪的缺陷是「畫面顯示的關卡 ≠ 送審會建立的關卡」，而那個形狀只有
  // 同時持有兩邊的合約測試抓得住 —— 測試要呼叫得到產出 HTML 的那支函式，
  // 它就不能埋在一個要先過 `requireAuth()` 的頁面裡。

  function stageListHtml(p: Project, view: SignoffStageView): string {
    const st = store.get();
    return stageListHtmlOf({
      project: p,
      user: st.currentUser,
      c: st.cases[p.id],
      view,
      jobs: st.agentJobs,
      // `edit` 關卡要講得出「會覆寫哪個欄位」的中文名，而那份章節定義是**專案的**：
      // 拿 active 的 `st.sections` 去查別的專案會查到另一份骨架的欄位名。
      sections: store.sectionsFor(p.id),
      employees: st.employees,
      pending,
      now: Date.now(),
    });
  }

  // ── 簽核紀錄 ────────────────────────────────────────────────

  function timelineHtml(p: Project): string {
    const st = store.get();
    const entries = signoffTimeline({ c: st.cases[p.id], versions: store.prdVersionsOf(p.id) });
    const groups = groupTimelineByRound(entries);

    const rowHtml = (e: (typeof entries)[0]) => `<li class="sg-log sg-log--${e.kind}">
      <span class="sg-log-when mono">${escapeHtml(e.at ? sinceLabel(e.at, Date.now()) : "時間不詳")}</span>
      <span class="sg-log-body">
        <b>${escapeHtml(e.title)}</b>
        <span class="sg-log-who">${escapeHtml(e.who)}</span>
        <span class="sg-log-detail">${escapeHtml(e.detail)}</span>
      </span>
    </li>`;

    // 依輪分組，最新一輪展開，其餘收合 —— 平鋪的時間軸在多輪之後讀不出因果，
    // 「要求修改」會跟三筆核准混在一起，看不出哪幾筆發生在同一份內容上
    const body = groups
      .map(({ round, entries: list }, i) => {
        const title = round ? `第 ${round} 輪` : "版本與稽核";
        return `<details class="sg-round"${i === 0 ? " open" : ""}>
          <summary>${escapeHtml(title)} <span class="aiw-fold-meta">${list.length} 筆</span></summary>
          <ul class="sg-logs">${list.map(rowHtml).join("")}</ul>
        </details>`;
      })
      .join("");

    return `<details class="card aiw-fold" data-od-id="sg-log" open>
      <summary>簽核紀錄 <span class="aiw-fold-meta">${entries.length} 筆</span></summary>
      ${
        entries.length
          ? `${body}<p class="aiw-note">「時間不詳」是這一版之前的舊資料 —— 決策紀錄是後來才開始留的，補不回來。</p>`
          : `<p class="aiw-card-sub">還沒有任何簽核動作。送出審閱之後這裡就會開始長。</p>`
      }
    </details>`;
  }

  // ── 案件操作 ────────────────────────────────────────────────

  function caseOpsHtml(p: Project): string {
    const st = store.get();
    const c = st.cases[p.id];
    const isAdmin = st.currentUser.accessRole === "admin";
    const canWithdraw = isAdmin || st.currentUser.accessRole === "editor";
    if (!c) return "";
    return `<details class="card aiw-fold" data-od-id="sg-ops">
      <summary>案件操作 <span class="aiw-fold-meta">${c.withdrawn ? "已抽單" : c.locked ? "已鎖定" : "進行中"}</span></summary>
      <p class="aiw-card-sub">抽單會把案子停下來，理由一定會留在紀錄裡。重開與套用流程會<strong>清掉所有既有簽章</strong>，只有管理員能做。</p>
      <div class="aiw-actions">
        ${!c.withdrawn && canWithdraw ? `<button type="button" class="btn" id="btn-sg-withdraw">抽單</button>` : ""}
        ${isAdmin ? `<button type="button" class="btn btn-ghost" id="btn-sg-reopen">重開案件</button>` : ""}
        ${isAdmin ? `<button type="button" class="btn btn-ghost" id="btn-sg-apply">套用目前流程</button>` : ""}
        <a class="btn btn-ghost" href="admin.html">編輯簽核流程 →</a>
      </div>
      <div class="sg-withdraw" id="sg-withdraw" hidden>
        <textarea id="sg-withdraw-reason" rows="2" placeholder="抽單理由（必填）"></textarea>
        <div class="sg-sign-actions">
          <button type="button" class="btn btn-sm btn-ghost" id="btn-sg-withdraw-cancel">取消</button>
          <button type="button" class="btn btn-sm" id="btn-sg-withdraw-go">確認抽單</button>
        </div>
      </div>
    </details>`;
  }

  // ── Agent 結果 pop-up ───────────────────────────────────────
  //
  // Wave 1 把「agent 跑完不再靜默改文件」做完了，但 `saveAgentResult` /
  // `discardAgentResult` 在 `src/pages/` 是**零呼叫端** —— 那個功能在 App 裡
  // 按不到。以下是把它按得到的那一段。

  /**
   * 已經自動跳過窗的工作單 id。
   *
   * 沒有這個集合的話，`render()` 每跑一次就重開一次窗 —— 而 `render()` 掛在
   * `store.subscribe` 上，改派、簽核、別的分頁存檔都會觸發它。使用者按下
   * 「稍後再決定」之後，那個窗會在下一次任何狀態變動時再彈回他臉上。
   */
  const autoShown = new Set<string>();

  function jobById(id: string): AgentJob | null {
    return store.get().agentJobs.find((j) => j.id === id) ?? null;
  }

  function stageOfJob(job: AgentJob): CaseStage | undefined {
    if (!job.stageId) return undefined;
    return store.get().cases[job.projectId]?.stages.find((s) => s.id === job.stageId);
  }

  /**
   * `edit` 關卡 pop-up 左欄的現值。
   *
   * 讀 `projectSectionValues[pid]` 而不是 active 的 `sectionValues`：在簽核頁
   * 看的專案不一定是編輯台當下開著的那個，拿 active 那份會顯示**別的專案**的
   * 內容當「現值」—— 而使用者要據此決定要不要覆寫。
   */
  function currentValueFor(job: AgentJob, stage: CaseStage | undefined): string {
    if (!stage || stageKind(stage) !== "edit") return "";
    const t = resolveEditTarget(stage.editTarget);
    return store.get().projectSectionValues[job.projectId]?.[t.sectionId]?.[t.fieldKey] ?? "";
  }

  /**
   * 開一張工作單的結果 pop-up，並把三顆按鈕接回 store。
   *
   * 三態各自不同（`askCustom` 的回傳刻意沒有塌成 boolean）：
   * - 確認 → `saveAgentResult`：`edit` 覆寫欄位、`review` 釘在關卡上
   * - 不採用 → `discardAgentResult`：全文留著，只標成未採用
   * - 取消 → **什麼都不做**，工作單留在 pending，之後還能從「查看結果」再開
   */
  async function showAgentResult(jobId: string): Promise<void> {
    const job = jobById(jobId);
    if (!job) return void toast("找不到這張工作單");
    const stage = stageOfJob(job);
    const kind = stage ? stageKind(stage) : "review";

    const res = await askCustom({
      title: resultDialogTitle(job.agentName, stage?.name ?? "未綁定關卡"),
      confirmLabel: resultConfirmLabel(kind),
      cancelLabel: "稍後再決定",
      extraLabel: "不採用",
      extraDanger: true,
      bodyHtml: agentResultDialogHtml({
        job,
        stage,
        sections: store.sectionsFor(job.projectId),
        currentValue: currentValueFor(job, stage),
        now: Date.now(),
      }),
    });

    // 取消＝還沒決定。不動 state，也不 toast —— 這裡沒有發生任何事
    if (res.action === "cancel") return;

    const r =
      res.action === "confirm" ? store.saveAgentResult(job.id) : store.discardAgentResult(job.id);
    if (!r.ok) {
      toast(r.reason ?? "動作失敗");
      render();
      return;
    }
    toast(
      res.action === "extra"
        ? "已標為不採用 —— 全文留在紀錄裡"
        : kind === "edit"
          ? "已存進文件"
          : "已存到這一關",
    );
    render();
  }

  /**
   * 對話框的排隊。**每一條會呼叫 `askCustom` / `askConfirm` 的路徑都要走它。**
   *
   * 規則見 `lib/dialog-flow.ts`：使用者主動觸發的流程優先，自動跳窗讓位；
   * 而 `askCustom` 因鎖被占而 throw 的錯誤在這裡被接住，不再變成沒人接的
   * `void`（這個 repo 刻意不攔 `unhandledrejection`）。
   */
  const flows = createDialogFlows({ isDialogOpen, onError: (err) => toast(errText(err)) });

  function errText(err: unknown): string {
    return err instanceof Error && err.message ? err.message : "對話框開啟失敗";
  }

  /**
   * 跑完自動跳窗。
   *
   * 硬條件：**不得在已有對話框開著時觸發** —— `askCustom` 遇到 dialog lock 會
   * throw「已有對話框開啟」，而這一支跑在 `render()` 裡。
   * 這裡 return 而不標記 `autoShown`，所以窗關掉之後的下一次 render 會補跳。
   *
   * 第二個硬條件由 `flows.tryAuto` 把關：**使用者主動開的流程正在跑時也要讓位。**
   * 這一條不在這支函式體內是刻意的 —— 缺陷本來就在兩支函式之間，
   * 而在這裡再刻一份旗標只會變成第三個各自為政的判斷。
   */
  function maybeAutoShow(p: Project): void {
    if (isDialogOpen()) return;
    const next = store.pendingAgentJobs(p.id).find((j) => !autoShown.has(j.id));
    if (!next) return;
    // `autoShown.add` 刻意寫在 flow **裡面**：讓位的那一次 flow 根本不執行，
    // 所以「沒開成」永遠不會被記成「已經自動開過」—— 記了的話這一份從此
    // 不再自動跳，而使用者根本沒看到過它
    flows.tryAuto(() => {
      autoShown.add(next.id);
      return showAgentResult(next.id).catch((err) => {
        autoShown.delete(next.id);
        throw err;
      });
    });
  }

  /**
   * S1 結案攔截。
   *
   * store 擋下結案之後，UI 這一層的責任是把那個 reason 變成**現在就處理得掉**的
   * 東西。只 toast 一句的話，使用者唯一能做的是再按一次簽核鈕、再被擋一次。
   *
   * 「查看」鈕借確認鈕那條路把 jobId 交出去：`askCustom` 的對話框只能從內部關閉，
   * 而按下查看的意思本來就是「這個窗的任務結束了，換下一個窗」。
   */
  async function handlePendingGate(p: Project): Promise<void> {
    const jobs = store.pendingAgentJobs(p.id);
    // 閘門與這裡問的是同一支 `pendingAgentJobs`，理論上不會落空；真的落空時
    // 讓使用者再按一次比開一個空清單好
    if (!jobs.length) return void toast("待拍板的分析已經處理完了，請再按一次");
    const stages = store.get().cases[p.id]?.stages ?? [];
    let picked: string | null = jobs[0]!.id;

    const res = await askCustom({
      title: `還有 ${jobs.length} 份分析沒拍板，結案後就存不進去了`,
      confirmLabel: "現在處理第一份",
      cancelLabel: "稍後再說",
      bodyHtml: pendingGateHtml(pendingGateItems(jobs, stages)),
      onMount: (root) => {
        root.querySelectorAll<HTMLElement>("[data-gate-view]").forEach((b) => {
          b.addEventListener("click", () => {
            picked = b.dataset.gateView ?? null;
            root.querySelector<HTMLElement>('[data-dlg="ok"]')?.click();
          });
        });
      },
      read: () => picked,
    });
    if (res.action !== "confirm") return;
    const id = res.value as string | null;
    if (id) await showAgentResult(id);
  }

  // ── Render ──────────────────────────────────────────────────

  /**
   * @param opts.skipAutoShow 這一次 render **不得**觸發自動跳窗。
   *   給的是「使用者剛按下一個動作、而那個動作馬上要開自己的窗」那條路：
   *   讓自動跳窗跑完，鎖就被它同步拿走了（`askCustom` 的 `rejectIfBusy`
   *   在第一個 await 之前），使用者的窗再也開不出來。
   */
  function render(opts?: { skipAutoShow?: boolean }) {
    if (!root) return;
    const p = activeProject();
    // 判斷一律問 `store.submitPlan()` —— 這裡**不重寫一份 `caseHasRun`**。
    // 那正是 W2-A 把判斷抽進 `submitPlan` 要防的分岔，而分岔的症狀就是
    // 這一輪要修的東西：畫面說的跟送審真的會做的不是同一件事。
    const st0 = store.get();
    const view = p
      ? signoffStageView({
          projectId: p.id,
          plan: store.submitPlan(p.id),
          c: st0.cases[p.id],
          employees: st0.employees,
        })
      : null;
    syncChrome(p, view);
    if (!p || !view) {
      root.innerHTML = `<section class="card aiw-card aiw-card--wide">
        <p class="aiw-kicker">簽核管理</p>
        <h2 class="aiw-card-title">還沒有專案</h2>
        <p class="aiw-card-sub">簽核是對著某一個專案做的事，先建一個再回來。</p>
        <p class="aiw-card-link"><a href="projects.html?new=1">新建專案 →</a></p>
      </section>`;
      return;
    }
    root.innerHTML = `${heroHtml(p, view)}${stageListHtml(p, view)}<div class="aiw-folds">${timelineHtml(p)}${caseOpsHtml(p)}</div>`;
    bind(p);
    if (pending) document.getElementById("sg-comment")?.focus();
    // 跑完自動跳窗掛在 render 的最後：工作單完成時 store 會 emit → subscribe →
    // render，所以這裡就是「分析剛跑完」那一刻。自己記 jobId 去重，不是每次都開。
    if (!opts?.skipAutoShow) maybeAutoShow(p);
  }

  function bind(p: Project) {
    document.querySelectorAll<HTMLElement>("[data-sg-analyze]").forEach((b) => {
      b.addEventListener("click", () => {
        const stageId = b.dataset.sgAnalyze!;
        const stage = store.get().cases[p.id]?.stages.find((s) => s.id === stageId);
        const r = store.invokeAgent({
          agentId: b.dataset.sgAgent!,
          projectId: p.id,
          task: "review",
          note: `簽核關卡「${stage?.name ?? stageId}」的審閱分析：請針對這一關的關注點檢視 PRD，第一行給出「建議核准」或「建議修改」。`,
          stageId,
        });
        if (!r.ok) toast(r.reason ?? "無法呼叫 Agent");
        // 成功不用 toast：關卡上會立刻出現「分析中…」，那就是回饋
      });
    });
    // 未拍板的工作單在關卡列上留一顆「查看結果」—— 自動跳窗按過取消之後，
    // 這是唯一回得去的路
    document.querySelectorAll<HTMLElement>("[data-sg-view]").forEach((b) => {
      b.addEventListener("click", () => {
        // 已經有窗開著時什麼都不做：askCustom 會 throw，而點擊處理器沒人接
        if (isDialogOpen()) return;
        flows.runUser(() => showAgentResult(b.dataset.sgView!));
      });
    });
    document.querySelectorAll<HTMLElement>("[data-sg-act]").forEach((b) => {
      b.addEventListener("click", () => {
        pending = {
          stageId: b.dataset.sgStage!,
          kind: b.dataset.sgAct as StagePending["kind"],
        };
        render();
      });
    });
    document.querySelector("[data-sg-cancel]")?.addEventListener("click", () => {
      pending = null;
      render();
    });
    document.querySelectorAll<HTMLElement>("[data-sg-confirm]").forEach((b) => {
      b.addEventListener("click", () => {
        const act = pending;
        if (!act) return;
        const comment = (document.getElementById("sg-comment") as HTMLTextAreaElement | null)?.value ?? "";
        if (NEEDS_REASON.includes(act.kind) && !comment.trim()) {
          toast("這個動作一定要寫理由");
          return;
        }

        let r: { ok: boolean; reason?: string; allDone?: boolean; pendingJobs?: number };
        if (act.kind === "approved") r = store.approveAndLock({ comment, stageIds: [act.stageId] });
        else if (act.kind === "changes_requested") r = store.requestChanges(act.stageId, comment);
        else if (act.kind === "skipped") r = store.skipStage(act.stageId, comment);
        else r = store.addStageComment(act.stageId, comment);

        pending = null;
        if (!r.ok) {
          // S1：被結案閘門擋下時開攔截對話框，不是只 toast 一句。
          // `pendingJobs` 是 store 交出來的數字，UI 不自己算 —— 兩份判斷會分岔，
          // 而症狀是「對話框說沒有待辦，按下去卻還是被擋」。
          if (r.pendingJobs) {
            // 順序與 `skipAutoShow` 兩者缺一不可：
            // `render()` 尾端的自動跳窗會**同步**拿走 `askCustom` 的鎖
            // （`rejectIfBusy` 跑在第一個 await 之前），於是使用者看到的是
            // 另一張工作單的結果窗，而他剛才被擋下的簽核**一句話都沒有**。
            // S1 攔截對話框是這個功能的主要出口，它一定要出現。
            render({ skipAutoShow: true });
            flows.runUser(() => handlePendingGate(p));
            return;
          }
          toast(r.reason ?? "動作失敗");
          render();
          return;
        }
        // 全部必簽關卡結案才合併 —— 合併的是送審當下那份快照
        if (act.kind === "approved" && r.allDone) {
          const m = store.mergeApproved();
          toast(m.ok ? "必簽關卡都過了，已合併回主線" : (m.reason ?? "已核准，但合併失敗"));
        } else {
          toast(`已${ACT_LABEL[act.kind]}`);
        }
        render();
      });
    });

    document.querySelectorAll<HTMLSelectElement>("[data-sg-assign]").forEach((sel) => {
      sel.addEventListener("change", () => {
        const r = store.reassignCaseStage(p.id, sel.dataset.sgAssign!, sel.value || null);
        toast(r.ok ? "已改派" : (r.reason ?? "改派失敗"));
        render();
      });
    });

    const box = document.getElementById("sg-withdraw");
    document.getElementById("btn-sg-withdraw")?.addEventListener("click", () => {
      if (box) box.hidden = false;
      document.getElementById("sg-withdraw-reason")?.focus();
    });
    document.getElementById("btn-sg-withdraw-cancel")?.addEventListener("click", () => {
      if (box) box.hidden = true;
    });
    document.getElementById("btn-sg-withdraw-go")?.addEventListener("click", () => {
      const reason = (document.getElementById("sg-withdraw-reason") as HTMLTextAreaElement | null)?.value.trim() ?? "";
      if (!reason) return void toast("抽單一定要寫理由 —— 之後看紀錄的人需要它");
      const r = store.withdrawCase(p.id, reason);
      toast(r.ok ? "已抽單" : (r.reason ?? "抽單失敗"));
      render();
    });
    // 這兩顆也走 `flows.runUser`：`async` 的 click handler 沒有人接它的 rejection，
    // 而 `askConfirm` 跟 `askCustom` 共用同一把鎖、同一條 throw
    document.getElementById("btn-sg-reopen")?.addEventListener("click", () => {
      flows.runUser(async () => {
        if (!(await askConfirm({ title: "重開案件會清掉所有既有簽章，確定？", danger: true }))) return;
        const r = store.reopenCase(p.id);
        toast(r.ok ? "已重開，所有關卡回到未簽" : (r.reason ?? "重開失敗"));
        render();
      });
    });
    document.getElementById("btn-sg-apply")?.addEventListener("click", () => {
      flows.runUser(async () => {
        if (!(await askConfirm({ title: "套用目前流程會依最新關卡設定重建案件，既有簽章會清掉，確定？", danger: true }))) return;
        const r = store.applyWorkflowToCase(p.id);
        toast(r.ok ? "已套用目前流程" : (r.reason ?? "套用失敗"));
        render();
      });
    });
  }

  document.getElementById("btn-sg-refresh")?.addEventListener("click", () => {
    render();
    toast("已重新整理");
  });

  try {
    render();
    store.subscribe(() => {
      // 別的分頁／別的頁面改了案子就跟著更新，但不要打斷正在打字的意見
      if (!pending) render();
    });
  } catch (err) {
    failBootOverlay(err);
  } finally {
    endBootOverlay();
  }
}
