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

  function cardRelease(s: ProjectStats): string {
    const g = s.git;
    const tag = g?.tag || "";
    return `<section class="d-card">
      <p class="d-eyebrow">版號與 Release</p>
      <p class="d-figure">${tag ? escapeHtml(tag) : "無 tag"}</p>
      <p class="d-figure-sub">${
        tag ? `HEAD ${escapeHtml(g?.head || "—")}` : "還沒發過版"
      }　累計 ${g?.commitCount ?? "—"} 個 commit</p>
      <div class="d-reserved">
        <span class="d-reserved-tag">尚未實作</span>
        <p>取號：先佔下一個版號，避免兩邊同時發版撞號。目前只有介面骨架。</p>
        <div class="d-reserved-row">
          <input type="text" class="ask-input" id="dash-next-ver" placeholder="v1.2.0" disabled />
          <button type="button" class="btn btn-sm" id="dash-take-number" disabled>取號</button>
        </div>
      </div>
    </section>`;
  }

  // ── 版面 ────────────────────────────────────────────────────

  function renderState(html: string) {
    const root = document.getElementById("dash-root");
    if (root) root.innerHTML = html;
  }

  function renderStats(s: ProjectStats) {
    renderState(
      `${heroGit(s)}
       <div class="d-grid">${cardStack(s)}${cardSize(s)}${cardRelease(s)}</div>
       <p class="d-measured">量測於 ${new Date(s.measuredAt ?? Date.now()).toLocaleTimeString("zh-TW")}　<span class="mono">${escapeHtml(s.folderPath)}</span></p>`,
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
