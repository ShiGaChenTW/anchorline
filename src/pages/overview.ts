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
    return evaluatePrdGates({ ...st, sectionValues: docs } as AppState);
  }

  type Row = {
    p: Project;
    blocks: number;
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

    const review = rows.find((r) => r.p.status === "review" && r.canSubmit);
    if (review) return { row: review, why: "在審閱佇列裡，而且結構檢查已經全過 —— 可以直接核准。" };

    const ready = rows.find((r) => r.p.status === "draft" && r.canSubmit);
    if (ready) return { row: ready, why: "草稿已無阻擋項，差一步就能送審。" };

    const dirty = rows.find((r) => (r.stats?.git?.dirtyCount ?? 0) > 0);
    if (dirty)
      return {
        row: dirty,
        why: `有 ${dirty.stats?.git?.dirtyCount} 個檔案還沒提交 —— 寫了但沒進版控。`,
      };

    const closest = [...rows]
      .filter((r) => r.p.status === "draft")
      .sort((a, b) => a.blocks - b.blocks)[0];
    if (closest)
      return { row: closest, why: `還有 ${closest.blocks} 項阻擋，是所有草稿裡最接近完成的。` };

    return { row: rows[0]!, why: "全部都已核准，沒有待辦。" };
  }

  // ── 卡片 ────────────────────────────────────────────────────

  function hero(rows: Row[]): string {
    const next = pickNext(rows);
    const totalBlocks = rows.reduce((a, r) => a + r.blocks, 0);
    const reviewing = rows.filter((r) => r.p.status === "review").length;

    if (!next) {
      return `<section class="d-hero">
        <p class="d-eyebrow">現在做這一個</p>
        <p class="d-hero-figure">還沒有專案</p>
        <p class="d-hero-sub">側欄上方按「＋」新建，或用「專案匯入」選一個資料夾。</p>
      </section>`;
    }

    return `<section class="d-hero tone-${totalBlocks ? "warn" : "ok"}">
      <p class="d-eyebrow">現在做這一個</p>
      <p class="d-hero-figure">${escapeHtml(projectDisplayName(next.row.p))}</p>
      <p class="d-hero-sub">${escapeHtml(next.why)}</p>
      <p class="d-hero-meta">其餘 ${rows.length - 1} 個專案稍後再看。這裡一次只指一個。</p>
      <dl class="d-facts">
        <div><dt>專案總數</dt><dd>${rows.length}</dd></div>
        <div><dt>審閱中</dt><dd>${reviewing}</dd></div>
        <div><dt>阻擋項合計</dt><dd>${totalBlocks}</dd></div>
        <div><dt>已綁資料夾</dt><dd>${rows.filter((r) => r.bound).length} / ${rows.length}</dd></div>
      </dl>
      <p class="ov-hero-cta">
        <a class="btn btn-primary btn-sm" href="dashboard.html" data-go="${escapeHtml(next.row.p.id)}">打開這個專案</a>
      </p>
    </section>`;
  }

  /** 每個專案一列：狀態、進度、阻擋數。整列可點。 */
  function cardProjects(rows: Row[]): string {
    const sorted = [...rows].sort((a, b) => b.blocks - a.blocks || a.p.pct - b.p.pct);
    return `<section class="d-card d-tall">
      <p class="d-eyebrow">所有專案</p>
      <p class="d-figure">${rows.length}</p>
      <p class="d-figure-sub">依待處理程度排序　阻擋最多的在最上面</p>
      <ul class="ov-rows">${sorted
        .map((r) => {
          const tone = r.blocks ? "blocked" : r.canSubmit ? "ready" : "";
          return `<li class="${tone}">
            <button type="button" class="ov-row" data-go="${escapeHtml(r.p.id)}">
              <span class="ov-row-name">${escapeHtml(projectDisplayName(r.p))}</span>
              <span class="ov-row-state">${
                r.blocks ? `${r.blocks} 阻擋` : r.canSubmit ? "可送審" : "—"
              }</span>
              <span class="ov-bar"><i style="width:${Math.max(2, r.p.pct)}%"></i></span>
              <span class="ov-row-pct mono">${r.p.pct}%</span>
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

  function render() {
    const rows = buildRows();
    updateUserRailFooter(toRailUser(store.get().currentUser));
    syncRailContext({ mode: "全部專案總覽", projectName: `${rows.length} 個專案`, statusLabel: "總覽", statusTone: "draft" });

    const sub = document.querySelector<HTMLElement>('[data-od-id="page-sub"]');
    if (sub) {
      const b = rows.reduce((a, r) => a + r.blocks, 0);
      sub.textContent = b ? `${b} 項阻擋分佈在 ${rows.filter((r) => r.blocks).length} 個專案` : "沒有阻擋項";
    }

    const root = document.getElementById("ov-root");
    if (!root) return;
    root.innerHTML = `<div class="d-top ov-top">${hero(rows)}${cardProjects(rows)}</div>
      <div class="d-grid">${cardStatus(rows)}${cardStack(rows)}${cardUnbound(rows)}</div>`;

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
    toast(`已量測 ${done} 個專案`);
  }

  document.getElementById("btn-measure-all")?.addEventListener("click", () => void measureAll());

  render();
  store.subscribe(render);
}
