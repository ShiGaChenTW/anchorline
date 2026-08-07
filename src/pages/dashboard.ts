/**
 * 專案儀表板 —— 每個專案一頁，回答四個問題：
 *
 *   1. 我現在該做什麼？        git 狀態一句話（不是一排等你解讀的數字）
 *   2. 這版要叫什麼？          版號與 Release（含「取號」骨架）
 *   3. 這專案是什麼做的？      語言佔比 + 框架
 *   4. 它有多大？              資料夾容量與檔案分佈
 *
 * ADHD 排版原則：每張卡片一個結論放最上面，細節退到下面。
 * 不做「十二個小數字磚」——那是把解讀成本丟回給使用者。
 */
import { store } from "../data/store";
import { projectDisplayName, type Project } from "../data/types";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import { buildFileTree, renderFileTreeHtml } from "../lib/file-tree";
import { initHelpOverlay } from "../lib/help-overlay";
import { askForProjectFolder } from "../lib/project-folder";
import { syncRailContext } from "../lib/rail-projects";
import {
  formatBytes,
  frameworks,
  gitHeadline,
  isDesktop,
  languageBreakdown,
  requestProjectStats,
  type ProjectStats,
} from "../lib/project-stats";
import { initTheme } from "../lib/theme";
import { escapeHtml, initMobileNav, toast, updateUserRailFooter } from "../lib/ui";

if (!requireAuth()) {
  /* redirected */
} else {
  initTheme();
  initMobileNav("dashboard");
  bindLogout();
  initHelpOverlay();

  /** 量測結果只留在記憶體：磁碟隨時會變，存起來只會顯示過期數字 */
  const cache = new Map<string, ProjectStats>();
  let busy = false;

  function activeProject(): Project | null {
    const st = store.get();
    const visible = st.projects.filter((p) => (st.showSamples ? true : !p.isSample));
    return visible.find((p) => p.id === st.activeProjectId) ?? visible[0] ?? null;
  }

  function syncChrome(p: Project | null) {
    updateUserRailFooter(toRailUser(store.get().currentUser));
    const name = p ? projectDisplayName(p) : "未選擇專案";
    const h1 = document.querySelector<HTMLElement>('[data-od-id="page-title"]');
    if (h1) h1.textContent = name;
    const sub = document.querySelector<HTMLElement>('[data-od-id="page-sub"]');
    if (sub) sub.textContent = p?.sourceFolder ? p.sourceFolder : "尚未綁定資料夾";
    syncRailContext({
      mode: "專案儀表板",
      projectName: name,
      statusLabel: p?.status === "approved" ? "已核准" : p?.status === "review" ? "審閱中" : "草稿",
      statusTone: p?.status === "approved" ? "ok" : p?.status === "review" ? "review" : "draft",
      meta: p?.sourceFolder,
    });
    document.title = `${name} · 儀表板 · PRD開發監控台`;
  }

  // ── 各張卡片 ────────────────────────────────────────────────

  /** 一個列表元件供技術線與容量共用：兩者資料形狀相同，長不一樣就是雜亂的來源 */
  function statRows(
    rows: { swatch?: number; label: string; value: string; sub?: string }[],
  ): string {
    return `<ul class="d-rows">${rows
      .map(
        (r) => `<li>
          ${r.swatch != null ? `<span class="d-swatch s${r.swatch}"></span>` : ""}
          <span class="d-rows-label">${escapeHtml(r.label)}</span>
          <span class="d-rows-value">${escapeHtml(r.value)}</span>
          ${r.sub ? `<span class="d-rows-sub">${escapeHtml(r.sub)}</span>` : ""}
        </li>`,
      )
      .join("")}</ul>`;
  }

  /** 頭條：整頁唯一該先被讀到的東西，佔滿一行 */
  function heroGit(s: ProjectStats): string {
    const g = s.git;
    const head = gitHeadline(g);
    const facts = g
      ? [
          ["分支", g.branch || "—"],
          ["HEAD", g.head || "—"],
          ["累計 commit", String(g.commitCount)],
          [
            "與 origin",
            g.ahead < 0 ? "未追蹤遠端" : `領先 ${g.ahead} · 落後 ${g.behind}`,
          ],
        ]
      : [];
    return `<section class="d-hero tone-${head.tone}">
      <p class="d-eyebrow">版本控制</p>
      <p class="d-hero-figure">${escapeHtml(head.text)}</p>
      ${
        g
          ? `<p class="d-hero-sub">${escapeHtml(g.lastMessage || "（無 commit 訊息）")}</p>
             <p class="d-hero-meta">${escapeHtml(g.author || "—")} · ${escapeHtml(
               g.lastAt ? g.lastAt.slice(0, 16).replace("T", " ") : "—",
             )}${g.remote ? ` · ${escapeHtml(g.remote.replace(/^https:\/\//, ""))}` : " · 未設定 origin"}</p>
             <dl class="d-facts">${facts
               .map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`)
               .join("")}</dl>`
          : `<p class="d-hero-sub">用 <code>git init</code> 起版控後，這裡會顯示提交與推送狀態。</p>`
      }
    </section>`;
  }

  function cardStack(s: ProjectStats): string {
    const langs = languageBreakdown(s);
    const fws = frameworks(s);
    const top = langs[0];
    return `<section class="d-card">
      <p class="d-eyebrow">技術線</p>
      <p class="d-figure">${top ? escapeHtml(top.lang) : "—"}</p>
      <p class="d-figure-sub">${top ? `佔 ${top.pct}%　共 ${langs.length} 類` : "沒有偵測到程式碼檔案"}</p>
      ${
        langs.length
          ? `<div class="d-bar" role="img" aria-label="語言佔比：${langs
              .map((l) => `${l.lang} ${l.pct}%`)
              .join("、")}">${langs
              .map((l, i) => `<span class="d-bar-seg s${i}" style="flex:${l.pct}"></span>`)
              .join("")}</div>
             ${statRows(
               langs.map((l, i) => ({
                 swatch: i,
                 label: l.lang,
                 value: `${l.pct}%`,
                 sub: formatBytes(l.bytes),
               })),
             )}`
          : ""
      }
      ${
        fws.length
          ? `<p class="d-sub-h">框架與工具</p>
             <div class="d-chips">${fws
               .map((f) => `<span class="d-chip" title="偵測自 ${escapeHtml(f.from)}">${escapeHtml(f.label)}</span>`)
               .join("")}</div>`
          : ""
      }
    </section>`;
  }

  function cardSize(s: ProjectStats): string {
    const tops = Object.entries(s.extBytes ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    return `<section class="d-card">
      <p class="d-eyebrow">資料夾容量</p>
      <p class="d-figure">${formatBytes(s.totalBytes)}</p>
      <p class="d-figure-sub">${s.fileCount} 個檔案　已排除 node_modules、.git、dist 等</p>
      ${statRows(
        tops.map(([ext, bytes]) => ({
          label: `.${ext}`,
          value: formatBytes(bytes),
          sub: `${s.extCount[ext] ?? 0} 檔`,
        })),
      )}
    </section>`;
  }

  /**
   * 版號與 commit —— 目前版本要一眼認出來。
   * ADHD：清單裡「我在哪」如果要靠比對雜湊字串才找得到，等於沒標。
   */
  function cardHistory(s: ProjectStats): string {
    const g = s.git;
    if (!g) {
      return `<section class="d-card d-tall">
        <p class="d-eyebrow">版號與 commit</p>
        <p class="d-figure">不是 git 專案</p>
        <p class="d-figure-sub">起了版控之後這裡會列出版號與提交紀錄。</p>
      </section>`;
    }

    const tags = g.tags ?? [];
    const commits = g.commits ?? [];
    const current = tags[0]?.name || "";
    /** tag 掛在哪個 commit 上，畫列表時要標出來 */
    const tagByHash = new Map(tags.map((t) => [t.hash, t.name]));

    return `<section class="d-card d-tall">
      <p class="d-eyebrow">版號與 commit</p>
      <p class="d-figure">${escapeHtml(current || "尚無版號")}</p>
      <p class="d-figure-sub">${
        current
          ? `目前版本　共 ${tags.length} 個 tag　${g.commitCount} 個 commit`
          : `還沒發過版　${g.commitCount} 個 commit`
      }</p>

      ${
        tags.length
          ? `<ul class="d-tags">${tags
              .slice(0, 6)
              .map(
                (t, i) =>
                  `<li class="${i === 0 ? "is-current" : ""}">
                     <span class="d-tag-name">${escapeHtml(t.name)}</span>
                     ${i === 0 ? `<span class="d-tag-badge">目前版本</span>` : ""}
                     <span class="d-tag-hash mono">${escapeHtml(t.hash)}</span>
                     <span class="d-tag-at">${escapeHtml(t.at.slice(0, 10))}</span>
                   </li>`,
              )
              .join("")}</ul>`
          : ""
      }

      <p class="d-sub-h">提交紀錄</p>
      <ol class="d-commits">${commits
        .map((c) => {
          const isHead = /\bHEAD\b/.test(c.refs);
          const tagOnIt = tagByHash.get(c.hash);
          return `<li class="${isHead ? "is-head" : ""}">
            <span class="d-commit-rail" aria-hidden="true"></span>
            <span class="d-commit-hash mono">${escapeHtml(c.hash)}</span>
            <span class="d-commit-subject">${escapeHtml(c.subject || "（無訊息）")}</span>
            ${isHead ? `<span class="d-commit-flag">HEAD</span>` : ""}
            ${tagOnIt ? `<span class="d-commit-tag">${escapeHtml(tagOnIt)}</span>` : ""}
            <span class="d-commit-at">${escapeHtml((c.at || "").slice(0, 10))}</span>
          </li>`;
        })
        .join("")}</ol>
      ${commits.length ? "" : `<p class="d-figure-sub">讀不到提交紀錄。</p>`}
    </section>`;
  }

  /** agent 家族 → 顯示名。authorAgentFamily 是既有欄位。 */
  const AGENT_LABEL: Record<string, string> = {
    claude: "Claude",
    codex: "Codex",
    grok: "Grok",
    agy: "Antigravity",
    gemini: "Gemini",
  };

  /**
   * 工作區狀態：worktree、branch、專案階段、由誰起的。
   * 這四件事的共同問題是「散在四個地方，沒人一起看」。
   */
  function cardWorkspace(s: ProjectStats): string {
    const g = s.git;
    const p = activeProject();
    const wts = g?.worktrees ?? [];
    const brs = g?.branches ?? [];
    const extra = Math.max(0, wts.length - 1); // 第一筆是主工作區

    const statusLabel =
      p?.status === "approved"
        ? "已核准"
        : p?.status === "review"
          ? "審閱中"
          : p?.status === "withdrawn"
            ? "已抽單"
            : "草稿";
    const fam = p?.authorAgentFamily ?? null;
    const starter = fam ? (AGENT_LABEL[fam] ?? fam) : p?.owner || "—";
    const starterKind = fam ? "agent" : "人員";

    return `<section class="d-card">
      <p class="d-eyebrow">工作區狀態</p>
      <p class="d-figure">${extra ? `${extra} 個平行 worktree` : "只有主工作區"}</p>
      <p class="d-figure-sub">${brs.length || "—"} 條本地分支　規格狀態：${escapeHtml(statusLabel)}</p>

      <dl class="d-facts d-facts--stack">
        <div><dt>建立者</dt><dd>${escapeHtml(starter)}<span class="d-kind">${starterKind}</span></dd></div>
        <div><dt>目前分支</dt><dd class="mono">${escapeHtml(g?.branch || "—")}</dd></div>
      </dl>

      ${
        wts.length
          ? `<p class="d-sub-h">Worktree</p>
             <ul class="d-rows d-rows--plain">${wts
               .map((w, i) => {
                 const name = w.path.split("/").filter(Boolean).pop() || w.path;
                 return `<li class="${i === 0 ? "is-primary" : ""}">
                   <span class="d-rows-label">${escapeHtml(name)}${i === 0 ? "<span class='d-tag-badge'>主</span>" : ""}</span>
                   <span class="d-rows-value mono">${escapeHtml(w.branch || "—")}</span>
                   <span class="d-rows-sub mono">${escapeHtml(w.head || "")}</span>
                 </li>`;
               })
               .join("")}</ul>`
          : ""
      }

      ${
        brs.length
          ? `<p class="d-sub-h">分支</p>
             <ul class="d-rows d-rows--plain">${brs
               .slice(0, 6)
               .map(
                 (b) => `<li class="${b.current ? "is-primary" : ""}">
                   <span class="d-rows-label">${escapeHtml(b.name)}${b.current ? "<span class='d-tag-badge'>目前</span>" : ""}</span>
                   <span class="d-rows-sub">${escapeHtml((b.at || "").slice(0, 10))}</span>
                 </li>`,
               )
               .join("")}</ul>`
          : ""
      }
    </section>`;
  }

  /** 綠框：專案檔案樹。沿用編輯台那份 buildFileTree，不另外做一套。 */
  function cardTree(): string {
    const p = activeProject();
    const tree = p ? buildFileTree(p, store.get().sections) : null;
    return `<section class="d-card">
      <p class="d-eyebrow">專案檔案</p>
      <div class="d-tree">${renderFileTreeHtml(tree, store.get().activeSectionId ?? "")}</div>
    </section>`;
  }

  // ── 版面 ────────────────────────────────────────────────────

  function renderState(html: string) {
    const root = document.getElementById("dash-root");
    if (root) root.innerHTML = html;
  }

  function renderStats(s: ProjectStats) {
    renderState(
      `<div class="d-top">${heroGit(s)}${cardHistory(s)}</div>
       <div class="d-grid">${cardStack(s)}${cardSize(s)}${cardTree()}${cardWorkspace(s)}</div>
       <p class="d-measured" data-equalize>量測於 ${new Date(s.measuredAt ?? Date.now()).toLocaleTimeString("zh-TW")}　<span class="mono">${escapeHtml(s.folderPath)}</span></p>`,
    );
  }

  async function load(force = false) {
    const p = activeProject();
    syncChrome(p);

    if (!p) {
      renderState(
        `<div class="dash-empty"><p>還沒有選擇專案。</p><a class="btn btn-primary" href="projects.html">回專案列表</a></div>`,
      );
      return;
    }
    const path = p.importSummary?.rootPath;
    if (!path) {
      // 當場就能解決，不要把人踢去別頁再自己找按鈕 ——
      // 「沒綁資料夾」是這一頁最常見的狀態（多數專案都沒綁）
      renderState(
        `<div class="dash-empty">
          <p>「${escapeHtml(projectDisplayName(p))}」還沒有對應磁碟上的資料夾，所以量不到 git、技術線與容量。</p>
          <button type="button" class="btn btn-primary" id="dash-bind">指定專案資料夾</button>
          <p class="dash-note">綁定只記錄對應關係，不會動到你已經寫好的章節內容。</p>
        </div>`,
      );
      document.getElementById("dash-bind")?.addEventListener("click", () => {
        askForProjectFolder(p.id, projectDisplayName(p));
      });
      return;
    }
    if (!isDesktop()) {
      renderState(
        `<div class="dash-empty">
          <p>這一頁需要桌面版 App。瀏覽器看不到磁碟，也跑不了 git。</p>
          <p class="dash-note mono">${escapeHtml(path)}</p>
        </div>`,
      );
      return;
    }

    const cached = !force && cache.get(path);
    if (cached) {
      renderStats(cached);
      return;
    }

    if (busy) return;
    busy = true;
    renderState(`<div class="dash-empty"><p>正在量測資料夾…</p></div>`);
    try {
      const s = await requestProjectStats(path);
      cache.set(path, s);
      renderStats(s);
    } catch (e) {
      renderState(
        `<div class="dash-empty"><p>${escapeHtml(e instanceof Error ? e.message : "量測失敗")}</p></div>`,
      );
      toast(e instanceof Error ? e.message : "量測失敗");
    } finally {
      busy = false;
    }
  }

  document.getElementById("btn-refresh-stats")?.addEventListener("click", () => {
    toast("重新量測中…");
    load(true);
  });

  load();

  // 綁完資料夾就自己重量一次，不用使用者再按「重新量測」
  let lastFolder = activeProject()?.importSummary?.rootPath ?? "";
  store.subscribe(() => {
    const now = activeProject()?.importSummary?.rootPath ?? "";
    syncChrome(activeProject());
    if (now !== lastFolder) {
      lastFolder = now;
      load(true);
    }
  });
}
