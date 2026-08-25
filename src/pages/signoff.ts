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
import { jobLanded, projectDisplayName, resolveEditTarget, stageKind, type AgentJob, type CaseStage, type Project } from "../data/types";
import { askConfirm, askCustom, isDialogOpen } from "../lib/ask";
import {
  agentResultDialogHtml,
  pendingGateHtml,
  pendingGateItems,
  resultConfirmLabel,
  resultDialogTitle,
  stageAnalysisRowHtml,
} from "../lib/agent-result";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import { initHelpOverlay } from "../lib/help-overlay";
import { beginBootOverlay, endBootOverlay, failBootOverlay } from "../lib/loading-overlay";
import { syncRailContext } from "../lib/rail-projects";
import {
  groupTimelineByRound,
  signoffSummary,
  signoffTimeline,
  stageAnalysis,
  stageRows,
} from "../lib/signoff";
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
  /** 展開中的決策面板：哪一關、哪一種動作。null = 沒有展開 */
  type Pending = { stageId: string; kind: "approved" | "changes_requested" | "comment" | "skipped" };
  let pending: Pending | null = null;

  function activeProject(): Project | null {
    const st = store.get();
    const visible = st.projects.filter((p) => (st.showSamples ? true : !p.isSample));
    const picked = visible.find((p) => p.id === st.activeProjectId) ?? visible[0] ?? null;
    if (picked && picked.id !== st.activeProjectId) store.setActiveProject(picked.id);
    return picked;
  }

  function syncChrome(p: Project | null) {
    updateUserRailFooter(toRailUser(store.get().currentUser));
    const name = p ? projectDisplayName(p) : "未選擇專案";
    const sub = document.querySelector<HTMLElement>('[data-od-id="page-sub"]');
    const c = p ? store.get().cases[p.id] : undefined;
    if (sub) {
      sub.textContent = p
        ? `${name} · ${c?.stages.length ? `${c.stages.filter((s) => s.state === "approved").length}/${c.stages.length} 關已核准` : "尚未建立關卡"}`
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

  function heroHtml(p: Project): string {
    const st = store.get();
    const sum = signoffSummary(st.currentUser, p, st.cases[p.id]);
    const pct = sum.total ? Math.round((sum.approved / sum.total) * 100) : 0;
    const tone =
      sum.state === "approved"
        ? "ok"
        : sum.state === "withdrawn" || sum.state === "needs_fix"
          ? "warn"
          : "go";
    // CTA 只在「真的輪到我」時出現。沒有我的關卡卻放一顆主要按鈕，
    // 等於邀請人去按一個註定被擋下來的東西
    // 被退回時球在作者身上，主要動作是「去改」而不是「去簽」
    const cta =
      sum.state === "needs_fix"
        ? `<a class="btn btn-primary btn-lg" href="editor.html">去編輯台修改 →</a>`
        : sum.state === "approved"
          ? // 全過之後路不能斷在句號上 —— 下一步是拿這份簽核紀錄去取版號
            `<a class="btn btn-primary btn-lg" href="releases.html">前往版本取號 →</a>`
          : sum.mine.length
            ? `<button type="button" class="btn btn-primary btn-lg" data-sg-act="approved" data-sg-stage="${escapeHtml(sum.mine[0]!.id)}">核准「${escapeHtml(sum.mine[0]!.name)}」→</button>`
            : sum.state === "draft"
              ? `<a class="btn btn-primary btn-lg" href="editor.html">去編輯台送審 →</a>`
              : "";

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

  const ACT_LABEL: Record<Pending["kind"], string> = {
    approved: "核准",
    changes_requested: "要求修改",
    comment: "保留意見",
    skipped: "略過",
  };

  /** 哪幾種動作必須寫理由 —— 少了理由，紀錄上就只剩一個結果 */
  const NEEDS_REASON: Pending["kind"][] = ["changes_requested"];

  function stageListHtml(p: Project): string {
    const st = store.get();
    const c = st.cases[p.id];
    const rows = stageRows(st.currentUser, p, c);
    const isAdmin = st.currentUser.accessRole === "admin";
    const people = st.employees.filter((e) => e.active !== false);
    // `edit` 關卡要講得出「會覆寫哪個欄位」的中文名，而那份章節定義是**專案的**：
    // 拿 active 的 `st.sections` 去查別的專案會查到另一份骨架的欄位名。
    const sections = store.sectionsFor(p.id);

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
        const when = settled && s.decidedAt ? sinceLabel(s.decidedAt, Date.now()) : "";

        // ── Agent 分析 ──────────────────────────────────────────
        // 指派 Agent 原本只是寫個名字，沒有任何東西會因此執行 ——
        // 這一關看起來「已安排」，實際上什麼都沒發生。這裡把兩套接起來：
        // 指派了 Agent 的關卡有「執行分析」，結果貼回關卡上。
        // 執行是手動的（Scott 2026-08-12）：何時燒 API 是使用者的決定。
        const assignee = st.employees.find((e) => e.id === s.assigneeId);
        const isAgent = assignee?.kind === "agent";
        const job = isAgent ? stageAnalysis(st.agentJobs, p.id, s.id) : null;
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
        const analysisHtml = stageAnalysisRowHtml({
          job,
          stage: s,
          sections,
          landed: job ? jobLanded(job) : "pending",
          now: Date.now(),
        });

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
   * 跑完自動跳窗。
   *
   * 硬條件：**不得在已有對話框開著時觸發** —— `askCustom` 遇到 dialog lock 會
   * throw「已有對話框開啟」，而這一支跑在 `render()` 裡，沒有人接得住那個 throw。
   * 這裡 return 而不標記 `autoShown`，所以窗關掉之後的下一次 render 會補跳。
   */
  function maybeAutoShow(p: Project): void {
    if (isDialogOpen()) return;
    const next = store.pendingAgentJobs(p.id).find((j) => !autoShown.has(j.id));
    if (!next) return;
    autoShown.add(next.id);
    void showAgentResult(next.id);
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

  function render() {
    if (!root) return;
    const p = activeProject();
    syncChrome(p);
    if (!p) {
      root.innerHTML = `<section class="card aiw-card aiw-card--wide">
        <p class="aiw-kicker">簽核管理</p>
        <h2 class="aiw-card-title">還沒有專案</h2>
        <p class="aiw-card-sub">簽核是對著某一個專案做的事，先建一個再回來。</p>
        <p class="aiw-card-link"><a href="projects.html?new=1">新建專案 →</a></p>
      </section>`;
      return;
    }
    root.innerHTML = `${heroHtml(p)}${stageListHtml(p)}<div class="aiw-folds">${timelineHtml(p)}${caseOpsHtml(p)}</div>`;
    bind(p);
    if (pending) document.getElementById("sg-comment")?.focus();
    // 跑完自動跳窗掛在 render 的最後：工作單完成時 store 會 emit → subscribe →
    // render，所以這裡就是「分析剛跑完」那一刻。自己記 jobId 去重，不是每次都開。
    maybeAutoShow(p);
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
        void showAgentResult(b.dataset.sgView!);
      });
    });
    document.querySelectorAll<HTMLElement>("[data-sg-act]").forEach((b) => {
      b.addEventListener("click", () => {
        pending = {
          stageId: b.dataset.sgStage!,
          kind: b.dataset.sgAct as Pending["kind"],
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
            render();
            void handlePendingGate(p);
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
    document.getElementById("btn-sg-reopen")?.addEventListener("click", async () => {
      if (!(await askConfirm({ title: "重開案件會清掉所有既有簽章，確定？", danger: true }))) return;
      const r = store.reopenCase(p.id);
      toast(r.ok ? "已重開，所有關卡回到未簽" : (r.reason ?? "重開失敗"));
      render();
    });
    document.getElementById("btn-sg-apply")?.addEventListener("click", async () => {
      if (!(await askConfirm({ title: "套用目前流程會依最新關卡設定重建案件，既有簽章會清掉，確定？", danger: true }))) return;
      const r = store.applyWorkflowToCase(p.id);
      toast(r.ok ? "已套用目前流程" : (r.reason ?? "套用失敗"));
      render();
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
