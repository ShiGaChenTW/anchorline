/**
 * 全部專案總覽 —— 沿用專案儀表板的設計邏輯（小標 → 大字 → 細節），
 * 但回答的是跨專案的問題。
 *
 * ADHD 的核心取捨：**頭條只指一個專案。**
 * 十三個專案各有進度、gate、未提交數，全列出來就是十三個開放迴圈。
 * 頭條算出「現在最該碰哪一個」並附上理由，其餘退成可掃視的清單。
 */
import { store } from "../data/store";
import type { AppState, Project } from "../data/types";
import { projectDisplayName } from "../data/types";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import { initHelpOverlay } from "../lib/help-overlay";
import { hideLoading, showLoading } from "../lib/loading-overlay";
import { evaluatePrdGates } from "../lib/prd-gates";
import {
  formatBytes,
  isDesktop,
  languageBreakdown,
  requestProjectStats,
  type ProjectStats,
} from "../lib/project-stats";
import { syncRailContext } from "../lib/rail-projects";
import { initTheme } from "../lib/theme";
import { escapeHtml, initMobileNav, toast, updateUserRailFooter } from "../lib/ui";
import { buildFocusCard, type FocusCard } from "../lib/focus-card";
import { fetchStaleLabel, GH_REFRESH_MS, prRadarLine, type GhResult } from "../lib/gh-status";
import { canQueryStatus, getGhStatusCached, requestOpenspecStatus } from "../lib/status-bridge";
import { openspecProgressPct } from "../lib/openspec-status";
import { coverageLine, rollupCoverage } from "../lib/governance";
import { canReadCoverage, requestCoverage, type CoverageResult } from "../lib/governance-bridge";

if (!requireAuth()) {
  /* redirected */
} else {
  initTheme();
  initMobileNav("overview");
  bindLogout();
  initHelpOverlay();

  /** 量測結果只留記憶體：磁碟隨時在變 */
  const statsCache = new Map<string, ProjectStats>();
  let measuring = false;
  /** 跨 repo PR。全 App 共用一份（見 status-bridge 的快取），60 秒才重新打一次 */
  let ghResult: GhResult | null = null;
  /**
   * 焦點專案的 openspec 進度。**只查焦點那一個**——首屏只畫一張卡，
   * 為了看不見的十個專案各跑一次 CLI 是純粹的浪費。
   */
  let openspecPct: number | null = null;
  let openspecFor = "";

  /** 「其他資訊」摺疊狀態。每次回來都要重新收合比一開始就展開更煩。 */
  const MORE_KEY = "anchorline:ov:more";
  function moreOpen(): boolean {
    try {
      return localStorage.getItem(MORE_KEY) === "1";
    } catch {
      return false;
    }
  }

  function visibleProjects(): Project[] {
    const st = store.get();
    return st.projects.filter((p) => (st.showSamples ? true : !p.isSample));
  }

  /**
   * 每個專案各自的 gate。evaluatePrdGates 讀 state.sectionValues，
   * 所以拿該專案的正文袋換掉再算 —— 不然十三個專案會算出同一份結果。
   */
  function gateOf(p: Project) {
    const st = store.get();
    const docs = st.projectSectionValues?.[p.id] ?? (p.id === st.activeProjectId ? st.sectionValues : {});
    // sections 也要換成該專案自己的——「多個章節仍空白」那條規則讀 sections[].status，
    // 拿 active 專案的章節去算別的專案，領域不同時數量就對不上
    return evaluatePrdGates(
      { ...st, sectionValues: docs, sections: store.sectionsFor(p.id) } as AppState,
      store.gateSpecFor(p.id),
    );
  }

  type Row = {
    p: Project;
    blocks: number;
    /** 動過但沒過 —— 真正需要你回去改的 */
    activeBlocks: number;
    /** 還沒開始寫 —— 是「未起步」，不是「被擋住」 */
    untouchedBlocks: number;
    warns: number;
    canSubmit: boolean;
    bound: boolean;
    stats: ProjectStats | null;
  };

  function buildRows(): Row[] {
    return visibleProjects().map((p) => {
      const g = gateOf(p);
      const root = p.importSummary?.rootPath ?? "";
      return {
        p,
        blocks: g.blocks,
        activeBlocks: g.activeBlocks,
        untouchedBlocks: g.untouchedBlocks,
        warns: g.warns,
        canSubmit: g.canSubmit,
        bound: !!root,
        stats: root ? (statsCache.get(root) ?? null) : null,
      };
    });
  }

  /**
   * 「現在最該碰哪一個」。排序理由要說得出口，不是加權亂數：
   *   1. 審閱中且可核准 —— 別人在等你，最貴
   *   2. 草稿且已無阻擋 —— 差臨門一腳就能送審
   *   3. 有未提交變更 —— 東西寫了沒進版控
   *   4. 阻擋項最少的草稿 —— 最接近完成
   */
  function pickNext(rows: Row[]): { row: Row; why: string } | null {
    if (!rows.length) return null;

    // 審閱中的一律優先，**不再要求 canSubmit**。
    // 舊版跳過「審閱中但結構沒過」的專案，結果戰情列把「等你核准」標成
    // 最響的紅字，焦點卡卻指向別的專案 —— 畫面上最大聲的訊號和唯一的 CTA
    // 互相矛盾。別人在等你這件事本身就是最貴的，擋住了就講為什麼擋住。
    const review = rows.find((r) => r.p.status === "review");
    if (review)
      return {
        row: review,
        why: review.canSubmit
          ? "在審閱佇列裡，而且結構檢查已經全過 —— 可以直接核准。"
          : review.activeBlocks
            ? `別人在等這一份，但還有 ${review.activeBlocks} 項要改才能核准。`
            : "別人在等這一份，但 PRD 還沒開始寫 —— 先補三行摘要。",
      };

    const ready = rows.find((r) => r.p.status === "draft" && r.canSubmit);
    if (ready) return { row: ready, why: "草稿已無阻擋項，差一步就能送審。" };

    const dirty = rows.find((r) => (r.stats?.git?.dirtyCount ?? 0) > 0);
    if (dirty)
      return {
        row: dirty,
        why: `有 ${dirty.stats?.git?.dirtyCount} 個檔案還沒提交 —— 寫了但沒進版控。`,
      };

    // 排序與文案都用 activeBlocks。
    // 用 blocks 會把「還沒開始寫」算成阻擋，講出來的理由跟戰情列對不起來 ——
    // 同一畫面兩個數字不一致，就是逼使用者用工作記憶去對帳。
    const closest = [...rows]
      .filter((r) => r.p.status === "draft")
      .sort((a, b) => a.activeBlocks - b.activeBlocks || b.p.pct - a.p.pct)[0];
    if (closest) {
      if (closest.activeBlocks)
        return { row: closest, why: `還有 ${closest.activeBlocks} 項要改，是所有草稿裡最接近完成的。` };
      if (closest.untouchedBlocks)
        return { row: closest, why: `PRD 還沒開始寫 —— 先補三行摘要，其餘章節會跟著好填。` };
      return { row: closest, why: "進度最前面的草稿，繼續往下填。" };
    }

    return { row: rows[0]!, why: "全部都已核准，沒有待辦。" };
  }

  // ── 戰情列 ──────────────────────────────────────────────────

  /**
   * 「今天」的四個數字。KPI stat tile：label + value，沒有圖表。
   *
   * ADHD 取捨有兩層。第一層是**分流**：「還沒開始寫 PRD」跟「寫了但沒過」
   * 混成同一個「阻擋」總數，會讓首屏長出一個誇大的數字（實測 6 個專案
   * 灌出 12 項，其中大半是空白文件產生的）。未起步不是被擋住。
   *
   * 第二層是**只讓一個 tile 響**：四個都標紅等於沒有優先序，等於還是要
   * 自己挑。所以 tone 只給「真的需要你現在動手」的那一個，其餘保持中性。
   */
  type Tile = { label: string; value: string; hint: string; tone: "" | "warn" | "danger" };

  function warRoom(rows: Row[]): string {
    const review = rows.filter((r) => r.p.status === "review").length;
    const active = rows.reduce((a, r) => a + r.activeBlocks, 0);
    const notStarted = rows.filter((r) => r.untouchedBlocks > 0).length;
    const dirty = rows.reduce((a, r) => a + (r.stats?.git?.dirtyCount ?? 0), 0);
    // GhResult 是 union：unavailable 分支沒有 prs，要先收窄
    const prs = ghResult?.available ? ghResult.prs.length : 0;

    // 只有最上游那一個掛 tone —— 別人在等你 > 你被擋住 > 東西沒進版控
    const hot = review ? 0 : active ? 1 : dirty ? 2 : -1;

    const tiles: Tile[] = [
      { label: "等你核准", value: String(review), hint: "別人在等", tone: "" },
      { label: "阻擋", value: String(active), hint: "寫了但沒過", tone: "" },
      { label: "還沒開始", value: String(notStarted), hint: "個專案沒 PRD", tone: "" },
      { label: "未提交", value: String(dirty), hint: dirty ? "個檔案" : "都乾淨", tone: "" },
      { label: "PR 開著", value: String(prs), hint: prs ? "待處理" : "沒有", tone: "" },
    ];
    if (hot >= 0) tiles[hot]!.tone = hot === 0 ? "danger" : "warn";

    return `<section class="ov-war" aria-label="今天的狀況">
      ${tiles
        .map(
          (t) => `<div class="ov-tile${t.tone ? ` is-${t.tone}` : ""}">
            <p class="ov-tile-label">${escapeHtml(t.label)}</p>
            <p class="ov-tile-value">${escapeHtml(t.value)}</p>
            <p class="ov-tile-hint">${escapeHtml(t.hint)}</p>
          </div>`,
        )
        .join("")}
    </section>`;
  }

  // ── 卡片 ────────────────────────────────────────────────────

  function hero(rows: Row[]): string {
    const next = pickNext(rows);
    const totalBlocks = rows.reduce((a, r) => a + r.blocks, 0);

    if (!next) {
      return `<section class="d-hero">
        <p class="d-eyebrow">現在做這一個</p>
        <p class="d-hero-figure">還沒有專案</p>
        <p class="d-hero-sub">側欄上方按「＋」新建，或用「專案匯入」選一個資料夾。</p>
      </section>`;
    }

    const card = focusCardOf(next.row);
    const pct = Math.max(0, Math.min(100, Number.isFinite(next.row.p.pct) ? next.row.p.pct : 0));
    // meter 的填色帶嚴重度；軌道是同 ramp 的淺階，狀態才讀得出整條
    const tone = next.row.activeBlocks ? "warn" : pct >= 95 ? "ok" : "go";

    return `<section class="ov-hero tone-${totalBlocks ? "warn" : "ok"}">
      <p class="ov-hero-kicker">現在做這一個</p>
      <h2 class="ov-hero-name">${escapeHtml(projectDisplayName(next.row.p))}</h2>

      <div class="ov-meter meter-${tone}" role="img"
           aria-label="完成度 ${pct}%">
        <div class="ov-meter-track"><i style="width:${pct}%"></i></div>
        <span class="ov-meter-value">${pct}<span class="ov-meter-unit">%</span></span>
      </div>

      <p class="ov-hero-why">${escapeHtml(next.why)}</p>

      <p class="ov-hero-cta">
        <a class="btn btn-primary btn-lg" href="dashboard.html" data-go="${escapeHtml(next.row.p.id)}">打開這個專案 →</a>
      </p>

      <dl class="ov-hero-facts">${card.fields
        .filter((f) => f.label !== "進度")
        .map((f) => `<div><dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(f.value)}</dd></div>`)
        .join("")}</dl>
      ${
        card.unanchored
          ? `<p class="ov-warn">⚠ ${card.unanchored} 個步驟沒有錨點，接不上事件流 —— 在終端跑 <code>bun run track</code> 按 i 補鑄。</p>`
          : ""
      }
    </section>`;
  }

  /**
   * 焦點卡的四個欄位。**恰好四個，順序固定**，由 `focus-card.ts` 的
   * `FOCUS_FIELD_CAP` 與其測試執法。
   *
   * 原本這裡是「專案總數 / 審閱中 / 阻擋項合計 / 已綁資料夾」—— 四個聚合計數，
   * 而且**零時間資訊**。`focus-mode.ts` 開頭就寫著「時間盲是 ADHD 的核心缺損，
   * 原介面零時間資訊」；那個已經在編輯台修好的問題，原封不動留在首屏。
   * 第三欄「上次動」就是為了補這一刀。
   */
  function focusCardOf(row: Row): FocusCard {
    const git = row.stats?.git;
    // 最後活動 = plan 檔與最後一次 commit 取較新者。兩個都可能不存在。
    const candidates = [row.p.lastFileAt, git?.lastAt].filter(Boolean) as string[];
    const lastActiveIso =
      candidates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;

    return buildFocusCard(
      {
        projectId: row.p.id,
        name: projectDisplayName(row.p),
        // 用 activeBlocks，不用 blocks：戰情列講「阻擋 0」而這裡講「補齊 4 項阻擋」
        // 就是同一畫面兩個數字打架 —— 正是這次要消滅的東西。
        nextStep: row.activeBlocks
          ? `補齊 ${row.activeBlocks} 項`
          : row.untouchedBlocks
            ? "先寫三行摘要"
            : row.canSubmit
              ? "送出審閱"
              : "繼續填章節",
        planPct: Number.isFinite(row.p.pct) ? row.p.pct : null,
        // 只有焦點專案查得到；其餘給 null，rollup 會讓 plan 佔滿
        openspecPct: row.p.id === openspecFor ? openspecPct : null,
        lastActiveIso,
        ahead: git?.ahead ?? -1,
        unanchored: 0,
        isTracking: false,
      },
      Date.now()
    );
  }

  /**
   * PR 雷達 —— 焦點卡**下方**獨立一行，不擠進卡片。
   *
   * 卡片欄位封頂 4 個，這是第 5 個資訊。硬塞進去就破了自己剛立的規則，
   * 而且 PR 是跨 repo 的，本來就不屬於「這一個專案」的卡片。
   */
  function prRadar(): string {
    if (!ghResult) return "";
    const now = Date.now();
    const line = prRadarLine(ghResult, now);
    const stale = fetchStaleLabel(ghResult, now);
    return `<p class="ov-pr-radar">${escapeHtml(line)}${
      stale ? ` <span class="muted">· ${escapeHtml(stale)}</span>` : ""
    }</p>`;
  }

  /** 每個專案一列：狀態、進度、阻擋數。整列可點。 */
  /**
   * 其他專案。焦點那一個不重複出現在這裡 —— 它已經是上面整張卡。
   * 狀態欄改講具體狀態，不再把「還沒開始」講成「N 阻擋」。
   */
  function cardProjects(rows: Row[]): string {
    const focusId = pickNext(rows)?.row.p.id;
    const rest = rows.filter((r) => r.p.id !== focusId);
    if (!rest.length) return "";
    const sorted = [...rest].sort((a, b) => b.activeBlocks - a.activeBlocks || b.p.pct - a.p.pct);

    const stateOf = (r: Row): { text: string; tone: string } => {
      if (r.p.status === "approved") return { text: "已核准", tone: "ready" };
      if (r.p.status === "review") return { text: "等你核准", tone: "review" };
      if (r.activeBlocks) return { text: `${r.activeBlocks} 項要改`, tone: "blocked" };
      if (r.untouchedBlocks) return { text: "還沒開始", tone: "idle" };
      if (r.canSubmit) return { text: "可送審", tone: "ready" };
      return { text: "進行中", tone: "" };
    };

    return `<section class="ov-others">
      <p class="ov-others-head">其他 ${rest.length} 個專案</p>
      <ul class="ov-rows">${sorted
        .map((r) => {
          const s = stateOf(r);
          const pct = Math.max(0, Math.min(100, r.p.pct));
          return `<li>
            <button type="button" class="ov-row" data-go="${escapeHtml(r.p.id)}">
              <span class="ov-row-name">${escapeHtml(projectDisplayName(r.p))}</span>
              <span class="ov-row-state tone-${s.tone}">${escapeHtml(s.text)}</span>
              <span class="ov-bar"><i style="width:${Math.max(2, pct)}%"></i></span>
              <span class="ov-row-pct">${pct}%</span>
              ${r.bound ? "" : `<span class="ov-row-flag">未綁資料夾</span>`}
            </button>
          </li>`;
        })
        .join("")}</ul>
    </section>`;
  }

  function cardStatus(rows: Row[]): string {
    const buckets: [string, number, string][] = [
      ["草稿", rows.filter((r) => r.p.status === "draft").length, "s0"],
      ["審閱中", rows.filter((r) => r.p.status === "review").length, "s1"],
      ["已核准", rows.filter((r) => r.p.status === "approved").length, "s2"],
      ["已抽單", rows.filter((r) => r.p.status === "withdrawn").length, "s5"],
    ];
    const total = buckets.reduce((a, b) => a + b[1], 0) || 1;
    const avg = rows.length
      ? Math.round(rows.reduce((a, r) => a + r.p.pct, 0) / rows.length)
      : 0;

    return `<section class="d-card">
      <p class="d-eyebrow">狀態分佈</p>
      <p class="d-figure">${avg}%</p>
      <p class="d-figure-sub">平均完成度</p>
      <div class="d-bar" role="img" aria-label="狀態分佈">${buckets
        .filter((b) => b[1])
        .map(([, n, c]) => `<span class="d-bar-seg ${c}" style="flex:${n}"></span>`)
        .join("")}</div>
      <ul class="d-rows">${buckets
        .map(
          ([label, n, c]) =>
            `<li><span class="d-swatch ${c}"></span><span class="d-rows-label">${label}</span><span class="d-rows-value">${n}</span><span class="d-rows-sub">${Math.round((n / total) * 100)}%</span></li>`,
        )
        .join("")}</ul>
    </section>`;
  }

  /** 跨專案的技術線與容量：只算量測過的 */
  function cardStack(rows: Row[]): string {
    const measured = rows.filter((r) => r.stats);
    const byLang: Record<string, number> = {};
    let bytes = 0;
    let files = 0;
    for (const r of measured) {
      bytes += r.stats!.totalBytes;
      files += r.stats!.fileCount;
      for (const l of languageBreakdown(r.stats!)) byLang[l.lang] = (byLang[l.lang] ?? 0) + l.bytes;
    }
    const total = Object.values(byLang).reduce((a, b) => a + b, 0);
    const langs = Object.entries(byLang)
      .map(([lang, b]) => ({ lang, bytes: b, pct: total ? Math.round((b / total) * 1000) / 10 : 0 }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 6);

    return `<section class="d-card">
      <p class="d-eyebrow">技術線與容量</p>
      <p class="d-figure">${measured.length ? formatBytes(bytes) : "—"}</p>
      <p class="d-figure-sub">${
        measured.length
          ? `${files} 個檔案　已量測 ${measured.length} / ${rows.filter((r) => r.bound).length} 個綁定專案`
          : "還沒量測。按上方「量測全部」。"
      }</p>
      ${
        langs.length
          ? `<div class="d-bar" role="img" aria-label="跨專案語言佔比">${langs
              .map((l, i) => `<span class="d-bar-seg s${i}" style="flex:${l.pct}"></span>`)
              .join("")}</div>
             <ul class="d-rows">${langs
               .map(
                 (l, i) =>
                   `<li><span class="d-swatch s${i}"></span><span class="d-rows-label">${escapeHtml(l.lang)}</span><span class="d-rows-value">${l.pct}%</span><span class="d-rows-sub">${formatBytes(l.bytes)}</span></li>`,
               )
               .join("")}</ul>`
          : ""
      }
    </section>`;
  }

  /** 沒綁資料夾的專案 —— 它們量不到任何東西，這本身就是待辦 */
  function cardUnbound(rows: Row[]): string {
    const unbound = rows.filter((r) => !r.bound);
    return `<section class="d-card">
      <p class="d-eyebrow">待補資料夾</p>
      <p class="d-figure">${unbound.length}</p>
      <p class="d-figure-sub">${
        unbound.length
          ? "這些專案量不到 git、技術線與容量"
          : "所有專案都綁好了"
      }</p>
      ${
        unbound.length
          ? `<ul class="d-rows">${unbound
              .slice(0, 10)
              .map(
                (r) =>
                  `<li><span class="d-rows-label">${escapeHtml(projectDisplayName(r.p))}</span><span class="d-rows-sub">${r.p.pct}%</span></li>`,
              )
              .join("")}</ul>`
          : ""
      }
    </section>`;
  }

  // ── 版面 ────────────────────────────────────────────────────

  // ── 治理覆蓋率（跨專案）────────────────────────────────────
  //
  // 讀磁碟的稽核軌跡，所以是非同步的：先出骨架，讀完再換掉這一區。
  // 快取只留記憶體 —— 跟其他量測一樣，存起來只會顯示過期數字。
  const GOVERNANCE_ID = "ov-governance";
  const coverageCache = new Map<string, CoverageResult>();

  function governanceInner(rows: Row[]): string {
    if (!canReadCoverage()) {
      return `<p class="d-eyebrow">治理覆蓋率</p>
        <p class="d-figure">—</p>
        <p class="d-figure-sub">桌面版才讀得到稽核軌跡</p>`;
    }
    const bound = rows.filter((r) => r.p.importSummary?.rootPath);
    const loaded = bound.filter((r) => coverageCache.has(r.p.importSummary!.rootPath!));
    if (!bound.length) {
      return `<p class="d-eyebrow">治理覆蓋率</p>
        <p class="d-figure">—</p>
        <p class="d-figure-sub">還沒有專案綁定資料夾</p>`;
    }
    if (loaded.length < bound.length) {
      return `<p class="d-eyebrow">治理覆蓋率</p>
        <p class="d-figure">讀取中…</p>
        <p class="d-figure-sub">${loaded.length} / ${bound.length} 個專案</p>`;
    }

    const roll = rollupCoverage(
      loaded.map((r) => ({
        ...coverageCache.get(r.p.importSummary!.rootPath!)!.coverage,
        projectId: r.p.id,
        projectName: projectDisplayName(r.p),
      })),
    );
    const truncated = loaded.some((r) => coverageCache.get(r.p.importSummary!.rootPath!)!.truncated);

    // 尚未開始治理的專案不進總數也不進明細 —— 把它們算成 0 會讓「還沒導入」
    // 看起來跟「導入得很乾淨」一樣，那是獎勵什麼都沒做。
    const sub = roll.active.length
      ? `橫跨 ${roll.active.length} 個已開通治理的專案　已治理 ${roll.governed} 件`
      : "還沒有任何專案開始治理";

    return `<p class="d-eyebrow">治理覆蓋率</p>
      <p class="d-figure">${roll.ungoverned} 件未治理</p>
      <p class="d-figure-sub">${escapeHtml(sub)}</p>
      ${roll.notStarted ? `<p class="d-note">另有 ${roll.notStarted} 個專案尚未開始治理，不列入計算</p>` : ""}
      ${truncated ? `<p class="d-note">部分專案只讀了最近的分片，實際數量可能更多</p>` : ""}
      ${
        roll.active.length
          ? `<details class="ov-gov-detail">
              <summary>看各專案 ▸</summary>
              <ul class="d-rows">${roll.active
                .map(
                  (r) => `<li>
                    <span class="d-rows-label">${escapeHtml(r.projectName)}</span>
                    <span class="d-rows-value">${r.ungoverned}</span>
                    <span class="d-rows-sub">${escapeHtml(coverageLine(r))}</span>
                  </li>`,
                )
                .join("")}</ul>
            </details>`
          : ""
      }`;
  }

  /** 逐專案讀，每讀完一個就重畫這一區 —— 十三個專案不該等最慢的那個。 */
  async function loadGovernance(rows: Row[]): Promise<void> {
    for (const r of rows) {
      const root = r.p.importSummary?.rootPath;
      if (!root || coverageCache.has(root)) continue;
      coverageCache.set(root, await requestCoverage(root));
      const host = document.getElementById(GOVERNANCE_ID);
      if (host) host.innerHTML = governanceInner(rows);
    }
  }

  function render() {
    const rows = buildRows();
    updateUserRailFooter(toRailUser(store.get().currentUser));
    syncRailContext({ mode: "全部專案總覽", projectName: `${rows.length} 個專案`, statusLabel: "總覽", statusTone: "draft" });

    // 副標不再喊全域阻擋總數 —— 那個數字跟 hero 裡的「還有 N 項阻擋」
    // 和狀態列的檢查結果是三個不同範圍，擺在同一畫面只會逼人對帳。
    // 首屏只留一個時間錨點：ADHD 的時間盲需要「多久沒動」而不是「幾項待辦」。
    const sub = document.querySelector<HTMLElement>('[data-od-id="page-sub"]');
    if (sub) {
      sub.textContent = rows.length ? `${rows.length} 個專案在追蹤中` : "還沒有專案";
    }

    const root = document.getElementById("ov-root");
    if (!root) return;
    // 其餘卡片收進 <details>：預設只看得到焦點卡 + PR 雷達。
    // 展開狀態存 localStorage —— 每次回來都要重新收合，比一開始就展開更煩。
    // 不用 .d-top —— 那是兩欄 grid（hero + 專案清單），第二個孩子搬進 details
    // 之後 hero 會被 align-items:stretch 拉成一整列的高度，中間開一個大洞。
    // 版面順序 = 回答問題的順序：
    //   今天怎麼樣（戰情列）→ 現在做哪一個（焦點）→ 其他還有什麼（清單）
    // 清單改成常駐而不是收在 <details>：原本首屏下半是一大片空白，
    // 而空白對 ADHD 不是留白，是「還沒載完？我漏看什麼？」的不確定感。
    // 真正的次要資訊（狀態分佈／技術線／待補資料夾）才留在摺疊裡。
    root.innerHTML = `${warRoom(rows)}
      <div class="ov-focus">${hero(rows)}</div>
      ${prRadar()}
      <div class="ov-pair">
        <section class="d-card ov-gov" id="${GOVERNANCE_ID}">${governanceInner(rows)}</section>
        ${cardProjects(rows)}
      </div>
      <details class="ov-more"${moreOpen() ? " open" : ""}>
        <summary>更多統計 ▸</summary>
        <div class="d-grid">${cardStatus(rows)}${cardStack(rows)}${cardUnbound(rows)}</div>
      </details>`;

    void loadGovernance(rows);

    root.querySelector<HTMLDetailsElement>(".ov-more")?.addEventListener("toggle", (e) => {
      try {
        localStorage.setItem(MORE_KEY, (e.target as HTMLDetailsElement).open ? "1" : "0");
      } catch {
        /* 隱私模式寫不了 —— 摺疊狀態不值得為它報錯 */
      }
    });

    // 任何 data-go 都是「切到那個專案並打開它的儀表板」
    root.querySelectorAll<HTMLElement>("[data-go]").forEach((el) => {
      el.addEventListener("click", (e) => {
        const id = el.dataset.go;
        if (!id) return;
        e.preventDefault();
        store.setActiveProject(id);
        location.href = "dashboard.html";
      });
    });
  }

  /** 逐一量測綁定的專案。序列跑，不要一次併發十三個 git 程序。 */
  async function measureAll() {
    if (measuring) return;
    if (!isDesktop()) {
      toast("需要桌面版 App：瀏覽器看不到磁碟，也跑不了 git");
      return;
    }
    const targets = visibleProjects()
      .map((p) => p.importSummary?.rootPath)
      .filter((x): x is string => !!x);
    if (!targets.length) {
      toast("沒有已綁定資料夾的專案");
      return;
    }

    measuring = true;
    // 逐個專案跑 git／onefetch，真的會等 —— 這裡本來只有按鈕上的文字在變，
    // 而使用者的眼睛在畫面中央，不在那顆按鈕上
    showLoading(`專案統計中`, { minMs: 600 });
    const btn = document.getElementById("btn-measure-all") as HTMLButtonElement | null;
    let done = 0;
    for (const path of targets) {
      if (btn) btn.textContent = `量測中 ${done + 1}/${targets.length}`;
      try {
        statsCache.set(path, await requestProjectStats(path));
      } catch {
        /* 單一專案失敗不該中斷整批 */
      }
      done++;
      render();
    }
    if (btn) btn.textContent = "量測全部";
    measuring = false;
    hideLoading();
    toast(`已量測 ${done} 個專案`);
  }

  document.getElementById("btn-measure-all")?.addEventListener("click", () => void measureAll());

  /**
   * PR 雷達的刷新。**刻意不進 render()**：render 會被 store 訂閱觸發很多次，
   * 而 `gh search prs` 實測 1.9 秒且走 Search API（30 req/min）。
   * 60 秒一次由 status-bridge 的快取把關，這裡只負責把結果推回畫面。
   */
  async function refreshGh() {
    if (!canQueryStatus()) return;
    try {
      ghResult = await getGhStatusCached();
    } catch {
      ghResult = null; // 逾時就不畫那一行，不要跳錯誤打斷使用者
    }
    render();
  }

  /**
   * 焦點專案的 openspec 狀態。跟著 render 走而不是自己輪詢——
   * 它只在「焦點換了」時才需要重查，而焦點是使用者行為驅動的。
   */
  async function refreshOpenspec() {
    if (!canQueryStatus()) return;
    const next = pickNext(buildRows());
    const root = next?.row.p.importSummary?.rootPath;
    if (!next || !root) return;
    if (next.row.p.id === openspecFor) return; // 沒換焦點就不重查
    const r = await requestOpenspecStatus(root);
    openspecFor = next.row.p.id;
    openspecPct = r.available ? openspecProgressPct(r.changes) : null;
    render();
  }

  /**
   * 進頁的載入遮罩。
   *
   * 每次點「專案總覽」都會看到 —— 這一頁一進來就同時在抓 openspec、PR、
   * 治理覆蓋率，畫面會先畫一版再跳一次。與其讓數字自己變，不如把那幾秒
   * 明確標成「還在算」。
   *
   * 6 秒硬上限：其中任何一個查詢卡住（gh 逾時、bridge 沒回應）都不該
   * 讓整頁永遠關不掉。上限到了就放行，畫面本來就已經有可讀的內容。
   *
   * 最短 1.1 秒：桌面版在沒有綁定資料夾的專案上，兩個查詢都會立刻回來，
   * 原本 450ms 的遮罩快到根本看不見 —— 「有出現但你沒看到」跟「沒出現」
   * 對使用者是同一件事。
   */
  showLoading("專案統計中", { minMs: 1100, autoHideAfter: 6000 });

  render();
  store.subscribe(render);
  store.subscribe(() => void refreshOpenspec());
  void Promise.allSettled([refreshOpenspec(), refreshGh()]).then(() => hideLoading());
  window.setInterval(() => void refreshGh(), GH_REFRESH_MS);
}
