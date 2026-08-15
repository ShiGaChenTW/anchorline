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
import { projectDisplayName, type Project } from "../data/types";
import { askConfirm } from "../lib/ask";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import { initHelpOverlay } from "../lib/help-overlay";
import { syncRailContext } from "../lib/rail-projects";
import {
  analysisVerdict,
  groupTimelineByRound,
  signoffSummary,
  signoffTimeline,
  stageAnalysis,
  stageRows,
} from "../lib/signoff";
import { initTheme } from "../lib/theme";
import { sinceLabel } from "../lib/time-format";
import { escapeHtml, initMobileNav, toast, updateUserRailFooter } from "../lib/ui";

if (!requireAuth()) {
  /* redirected */
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
        const verdict = job?.status === "done" ? analysisVerdict(job.result) : null;
        const analysisHtml = !job
          ? ""
          : busy
            ? `<p class="sg-analysis sg-analysis--busy">⏳ ${escapeHtml(job.agentName)} 分析中 —— 完成後結果會出現在這裡。</p>`
            : job.status === "failed"
              ? `<p class="sg-analysis sg-analysis--failed">分析失敗：${escapeHtml(job.result || "沒有留下原因")}　—— 可按「重新分析」再試。</p>`
              : `<details class="sg-analysis sg-analysis--done">
                   <summary>
                     <span class="sg-verdict sg-verdict--${verdict ?? "none"}">${
                       verdict === "approve" ? "建議核准" : verdict === "fix" ? "建議修改" : "無明確結論"
                     }</span>
                     ${escapeHtml(job.agentName)} · ${escapeHtml(job.finishedAt ? sinceLabel(job.finishedAt, Date.now()) : "")}
                     <span class="aiw-fold-meta">看全文</span>
                   </summary>
                   <pre class="sg-analysis-body">${escapeHtml(job.result)}</pre>
                   <p class="aiw-note">這是 Agent 的建議，不是簽章 —— 核准仍然要人按。</p>
                 </details>`;

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

        let r: { ok: boolean; reason?: string; allDone?: boolean };
        if (act.kind === "approved") r = store.approveAndLock({ comment, stageIds: [act.stageId] });
        else if (act.kind === "changes_requested") r = store.requestChanges(act.stageId, comment);
        else if (act.kind === "skipped") r = store.skipStage(act.stageId, comment);
        else r = store.addStageComment(act.stageId, comment);

        pending = null;
        if (!r.ok) {
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

  render();
  store.subscribe(() => {
    // 別的分頁／別的頁面改了案子就跟著更新，但不要打斷正在打字的意見
    if (!pending) render();
  });
}
