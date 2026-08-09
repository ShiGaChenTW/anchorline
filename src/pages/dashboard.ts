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
import {
  aiSuggestions,
  localSuggestions,
  type Suggestion,
} from "../lib/dashboard-optimize";
import { initHelpOverlay } from "../lib/help-overlay";
import { diagnoseGit, hasActionableIssue, usesConventionalCommits } from "../lib/git-doctor";
import type { GitIssue } from "../lib/git-doctor";
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
import { attachDiffSummary } from "../lib/diff-summary";

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
    document.title = `${name} · 儀表板 · Anchorline`;
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
  /**
   * 標籤列的內容。抽出來是因為新增／移除後只重畫這一塊 ——
   * 整張卡重畫要有 ProjectStats，而打標籤跟磁碟量測無關。
   */
  /**
   * 名稱／介紹／標籤。三個都是人寫的中繼資料，跟磁碟量測無關 ——
   * 所以量不到 git 的時候（沒綁資料夾、瀏覽器版）也一樣要能編輯。
   * 之前它埋在 heroGit() 裡，等於「沒有資料夾就不能打標籤」。
   */
  function identHtml(p: Project | null): string {
    const name = p ? projectDisplayName(p) : "未選擇專案";
    const desc = p?.description ?? "";
    return `<div class="d-ident">
        <p class="d-eyebrow">專案</p>
        <input type="text" id="d-name" class="d-ident-name" value="${escapeHtml(name)}"
               aria-label="專案名稱" placeholder="未命名專案" />
        <textarea id="d-desc" class="d-ident-desc" rows="1" aria-label="專案介紹"
                  placeholder="一句話說明這個專案在做什麼">${escapeHtml(desc)}</textarea>
        <div class="d-ident-tags" id="d-tags">${tagsInnerHtml(p)}</div>
      </div>`;
  }

  function tagsInnerHtml(p: Project | null): string {
    const tags = p?.tags ?? [];
    return `${tags
      .map(
        (t) => `<span class="d-tag">
          <a href="projects.html?tag=${encodeURIComponent(t)}" title="找出所有「${escapeHtml(t)}」的專案">${escapeHtml(t)}</a>
          <button type="button" data-tag-remove="${escapeHtml(t)}" aria-label="移除標籤 ${escapeHtml(t)}">×</button>
        </span>`,
      )
      .join("")}
      <input type="text" id="d-tag-input" class="d-tag-input" list="d-tag-options"
             placeholder="＋ 標籤" aria-label="新增標籤" autocomplete="off" />
      <datalist id="d-tag-options">${store
        .allTags()
        .map((t) => `<option value="${escapeHtml(t.tag)}"></option>`)
        .join("")}</datalist>`;
  }

  /** 只重畫標籤列並把游標放回輸入框 —— 連打好幾個標籤時不該每次都要重新點 */
  function refreshTags(focus = true) {
    const host = document.getElementById("d-tags");
    if (!host) return;
    host.innerHTML = tagsInnerHtml(activeProject());
    if (focus) (document.getElementById("d-tag-input") as HTMLInputElement | null)?.focus();
  }

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
    const p = activeProject();

    return `<section class="d-hero tone-${head.tone}">
      ${identHtml(p)}

      <p class="d-eyebrow">版本控制</p>
      <div class="d-hero-head">
        <p class="d-hero-figure">${escapeHtml(head.text)}</p>
        ${
          hasActionableIssue(diagnoseGit(g))
            ? `<button type="button" class="btn btn-sm d-fix-btn" id="btn-git-doctor">版控健檢 <span>${diagnoseGit(g).filter((i) => i.level !== "info").length}</span></button>`
            : ""
        }
      </div>
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
   * 版號紀錄 —— 目前版本要一眼認出來。
   * ADHD：清單裡「我在哪」如果要靠比對雜湊字串才找得到，等於沒標。
   */
  function cardTags(s: ProjectStats): string {
    const g = s.git;
    if (!g) {
      return `<section class="d-card">
        <p class="d-eyebrow">版號紀錄</p>
        <p class="d-figure">不是 git 專案</p>
        <p class="d-figure-sub">起了版控之後這裡會列出版號。</p>
      </section>`;
    }
    const tags = g.tags ?? [];
    const current = tags[0];

    // 使用者自己取的版號優先顯示 —— git tag 是「已經標下去的」，
    // releases 是「決定了但可能還沒標」，後者才是現在在推的那一版。
    const mine = store.releasesOf();
    const headline = mine[0]?.version || current?.name || "尚無版號";

    return `<section class="d-card">
      <div class="d-hero-head">
        <p class="d-eyebrow">版號紀錄</p>
        <a class="btn btn-sm d-take-btn" href="releases.html" title="自己決定版號與這一版收哪些功能">版本取號</a>
      </div>
      <p class="d-figure">${escapeHtml(headline)}</p>
      <p class="d-figure-sub">${
        mine.length
          ? `你取的版號 ${mine.length} 個　git tag ${tags.length} 個`
          : current
            ? `目前版本　共 ${tags.length} 個 tag`
            : "還沒發過版"
      }</p>
      ${
        tags.length
          ? `<ul class="d-tags">${tags
              .map(
                (t, i) =>
                  `<li class="${i === 0 ? "is-current" : ""}">
                     <span class="d-tag-head">
                       <span class="d-tag-name">${escapeHtml(t.name)}</span>
                       ${i === 0 ? `<span class="d-tag-badge">目前版本</span>` : ""}
                       <span class="d-tag-hash mono">${escapeHtml(t.hash)}</span>
                       <span class="d-tag-at">${escapeHtml(t.at.slice(0, 10))}</span>
                     </span>
                     ${
                       t.subject
                         ? `<span class="d-tag-note">${escapeHtml(t.subject)}</span>`
                         : ""
                     }
                   </li>`,
              )
              .join("")}</ul>`
          : `<p class="d-note-empty">用 <code>git tag v1.0.0</code> 標一版之後，這裡會列出版號與它的說明。</p>`
      }
    </section>`;
  }

  /** commit 紀錄 —— HEAD 那筆要標出來 */
  function cardCommits(s: ProjectStats): string {
    const g = s.git;
    const commits = g?.commits ?? [];
    const tagByHash = new Map((g?.tags ?? []).map((t) => [t.hash, t.name]));

    return `<section class="d-card d-tall">
      <p class="d-eyebrow">提交紀錄</p>
      <p class="d-figure">${g?.commitCount ?? "—"}</p>
      <p class="d-figure-sub">個 commit　最近 ${commits.length} 筆</p>
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
      ${commits.length ? "" : `<p class="d-note-empty">讀不到提交紀錄。</p>`}
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

  // ── 版面 ────────────────────────────────────────────────────

  function renderState(html: string) {
    const root = document.getElementById("dash-root");
    if (root) root.innerHTML = html;
  }

  function renderStats(s: ProjectStats) {
    renderState(
      `<div class="d-top">${heroGit(s)}${cardTags(s)}</div>
       <div class="d-grid">${cardCommits(s)}${cardStack(s)}${cardSize(s)}${cardWorkspace(s)}</div>
       <p class="d-measured">量測於 ${new Date(s.measuredAt ?? Date.now()).toLocaleTimeString("zh-TW")}　<span class="mono">${escapeHtml(s.folderPath)}</span></p>`,
    );
    bindIdentEditing();
    document.getElementById("btn-git-doctor")?.addEventListener("click", () => {
      openGitDoctor(s.git);
    });
  }

  async function load(force = false) {
    const p = activeProject();
    syncChrome(p);

    if (!p) {
      renderState(
        `<div class="dash-empty"><p>還沒有選擇專案。</p><a class="btn btn-primary" href="overview.html">回總覽</a></div>`,
      );
      return;
    }
    const path = p.importSummary?.rootPath;
    if (!path) {
      // 當場就能解決，不要把人踢去別頁再自己找按鈕 ——
      // 「沒綁資料夾」是這一頁最常見的狀態（多數專案都沒綁）
      renderState(
        `<section class="d-hero">${identHtml(p)}</section>
         <div class="dash-empty">
          <p>「${escapeHtml(projectDisplayName(p))}」還沒有對應磁碟上的資料夾，所以量不到 git、技術線與容量。</p>
          <button type="button" class="btn btn-primary" id="dash-bind">指定專案資料夾</button>
          <p class="dash-note">綁定只記錄對應關係，不會動到你已經寫好的章節內容。</p>
        </div>`,
      );
      bindIdentEditing();
      document.getElementById("dash-bind")?.addEventListener("click", () => {
        askForProjectFolder(p.id, projectDisplayName(p));
      });
      return;
    }
    if (!isDesktop()) {
      renderState(
        `<section class="d-hero">${identHtml(p)}</section>
         <div class="dash-empty">
          <p>這一頁需要桌面版 App。瀏覽器看不到磁碟，也跑不了 git。</p>
          <p class="dash-note mono">${escapeHtml(path)}</p>
        </div>`,
      );
      bindIdentEditing();
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

  /**
   * 名稱與介紹就地編輯：blur 或 Enter 存檔，沒有儲存按鈕。
   * 存檔不重繪整頁 —— 重繪會把游標踢掉，那是最惱人的編輯體驗。
   */
  function bindIdentEditing() {
    const p = activeProject();
    if (!p) return;

    const nameEl = document.getElementById("d-name") as HTMLInputElement | null;
    if (nameEl && nameEl.dataset.bound !== "1") {
      nameEl.dataset.bound = "1";
      const save = () => {
        const v = nameEl.value.trim();
        if (v === projectDisplayName(p)) return;
        const r = store.renameProject(p.id, v);
        if (!r.ok) {
          toast(r.reason ?? "改名失敗");
          nameEl.value = projectDisplayName(p);
          return;
        }
        toast("已更新專案名稱");
      };
      nameEl.addEventListener("blur", save);
      nameEl.addEventListener("keydown", (e) => {
        if ((e as KeyboardEvent).key === "Enter") {
          e.preventDefault();
          nameEl.blur();
        }
      });
    }

    const tagWrap = document.getElementById("d-tags");
    if (tagWrap && tagWrap.dataset.bound !== "1") {
      tagWrap.dataset.bound = "1";
      const current = () => activeProject()?.tags ?? [];

      tagWrap.addEventListener("click", (e) => {
        const btn = (e.target as HTMLElement).closest("[data-tag-remove]") as HTMLElement | null;
        if (!btn) return;
        const t = btn.dataset.tagRemove ?? "";
        store.setProjectTags(p.id, current().filter((x) => x !== t));
        refreshTags(false);
        toast(`已移除標籤「${t}」`);
      });

      // 事件委派掛在容器上：新增／移除後整個 #d-tags 會重建，
      // 監聽掛在 input 本身的話第一次之後就全失效（用 focusout，blur 不冒泡）。
      const inputNow = () => document.getElementById("d-tag-input") as HTMLInputElement | null;
      const commit = () => {
        const input = inputNow();
        if (!input) return;
        // 逗號分隔一次貼多個 —— 從別處複製標籤時最省事
        const parts = input.value.split(/[,、]/).map((x) => x.trim()).filter(Boolean);
        if (!parts.length) return;
        input.value = "";
        store.setProjectTags(p.id, [...current(), ...parts]);
        refreshTags();
      };

      tagWrap.addEventListener("keydown", (e) => {
        const ke = e as KeyboardEvent;
        const input = inputNow();
        if (!input || ke.target !== input) return;
        if (ke.key === "Enter" || ke.key === ",") {
          e.preventDefault();
          commit();
          return;
        }
        // 空輸入按倒退鍵 = 刪掉最後一個，跟一般 tag 輸入框的手感一致
        if (ke.key === "Backspace" && !input.value && current().length) {
          e.preventDefault();
          store.setProjectTags(p.id, current().slice(0, -1));
          refreshTags();
        }
      });
      tagWrap.addEventListener("focusout", commit);
      // 從 datalist 選一個就直接成立，不必再按 Enter
      tagWrap.addEventListener("change", commit);
    }

    const descEl = document.getElementById("d-desc") as HTMLTextAreaElement | null;
    if (descEl && descEl.dataset.bound !== "1") {
      descEl.dataset.bound = "1";
      // 依內容長高，才不會在沒寫東西時留一塊固定兩行的空白
      const autosize = () => {
        descEl.style.height = "auto";
        descEl.style.height = `${descEl.scrollHeight}px`;
      };
      autosize();
      descEl.addEventListener("input", autosize);
      // 專案介紹是 blur 才存 —— 中間那段「改了但還沒離開欄位」正是需要標出來的
      attachDiffSummary(descEl, () => store.get().projects.find((x) => x.id === p.id)?.description ?? "");
      descEl.addEventListener("blur", () => {
        if (descEl.value.trim() === (p.description ?? "")) return;
        store.setProjectDescription(p.id, descEl.value);
        toast("已更新專案介紹");
      });
      // ⌘↵ 存檔並離開；單純 Enter 要能換行
      descEl.addEventListener("keydown", (e) => {
        const ke = e as KeyboardEvent;
        if (ke.key === "Enter" && (ke.metaKey || ke.ctrlKey)) {
          e.preventDefault();
          descEl.blur();
        }
      });
    }
  }

  // ── 優化 Dashboard：找 agent 檢查欄位內容 ──────────────────

  /** 目前可用的 agent（管理中心啟用中的） */
  function availableAgents() {
    return store
      .get()
      .employees.filter((e) => e.kind === "agent" && e.active !== false && e.agentEnabled !== false);
  }

  function optimizeModal(inner: string): HTMLElement {
    document.getElementById("opt-modal")?.remove();
    const back = document.createElement("div");
    back.className = "modal-back open";
    back.id = "opt-modal";
    back.innerHTML = `<div class="modal opt-modal" role="dialog" aria-modal="true" aria-labelledby="opt-title">${inner}</div>`;
    document.body.appendChild(back);
    back.querySelectorAll("[data-opt-close]").forEach((b) =>
      b.addEventListener("click", () => back.remove()),
    );
    back.addEventListener("click", (e) => {
      if (e.target === back) back.remove();
    });
    return back;
  }

  /**
   * 版控健檢。
   *
   * **只給指令，不執行。** git commit / push / remote add 都會改動使用者的
   * repo，而且 push 出去收不回來。一個從 WebView 按下去就悄悄改 repo 的
   * 按鈕，出錯時使用者連發生了什麼都不知道 —— 所以這裡的產物是可複製的
   * 文字，執行的決定留在人身上。
   *
   * 判斷邏輯在 lib/git-doctor.ts（純函式、22 個測試）。
   */
  function openGitDoctor(g: NonNullable<ProjectStats["git"]> | undefined) {
    const issues = diagnoseGit(g);
    const conventional = usesConventionalCommits((g?.commits ?? []).map((c) => c.subject));

    const card = (i: GitIssue) => `
      <li class="gd-item gd-${i.level}">
        <div class="gd-head">
          <span class="gd-tag">${i.level === "block" ? "先處理" : i.level === "warn" ? "該處理" : "知道就好"}</span>
          <strong>${escapeHtml(i.title)}</strong>
        </div>
        <p class="gd-why">${escapeHtml(i.why)}</p>
        <pre class="gd-cmd"><code>${i.commands.map((c) => escapeHtml(c)).join("\n")}</code></pre>
        <button type="button" class="btn btn-sm gd-copy" data-gd-copy="${escapeHtml(i.commands.join("\n"))}">複製指令</button>
      </li>`;

    const back = optimizeModal(`
      <header>
        <div>
          <h3 id="opt-title">版控健檢</h3>
          <p class="sub">找出這個 repo 現在的版控問題，並給出對應指令。</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-opt-close>關閉</button>
      </header>
      <div class="body">
        ${
          issues.length
            ? `<ul class="gd-list">${issues.map(card).join("")}</ul>
               ${
                 conventional
                   ? `<p class="gd-note">偵測到這個 repo 使用 conventional commits，提交訊息建議沿用 <code>type(scope): 說明</code>。</p>`
                   : ""
               }`
            : `<p class="gd-none">目前沒有發現版控問題。</p>`
        }
        <p class="gd-warn">這些指令不會自動執行 —— 複製到終端機自己跑。改動 repo 的決定留給你。</p>
      </div>
      <footer>
        <button type="button" class="btn btn-primary" data-opt-close>知道了</button>
      </footer>
    `);

    back.querySelectorAll<HTMLButtonElement>("[data-gd-copy]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(btn.dataset.gdCopy ?? "");
          const prev = btn.textContent;
          btn.textContent = "已複製";
          window.setTimeout(() => {
            btn.textContent = prev;
          }, 1200);
        } catch {
          toast("複製失敗，請手動選取");
        }
      });
    });
  }

  /** 第一步：選 agent */
  function openOptimize() {
    const p = activeProject();
    if (!p) {
      toast("先選一個專案");
      return;
    }
    const agents = availableAgents();

    optimizeModal(`
      <header>
        <div>
          <h3 id="opt-title">優化 Dashboard</h3>
          <p class="sub">檢查專案名稱與介紹是否還說得通。其餘欄位是磁碟量測結果，不會被改動。</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-opt-close>關閉</button>
      </header>
      <div class="body">
        <p class="d-eyebrow">選一個 agent</p>
        <div class="opt-agents">
          <button type="button" class="opt-agent is-local" data-agent="">
            <span class="opt-agent-name">本機規則檢查</span>
            <span class="opt-agent-brief">不呼叫 API，永遠可用。只挑「拿量測結果就能判斷」的問題。</span>
          </button>
          ${agents
            .map(
              (a) => `<button type="button" class="opt-agent" data-agent="${escapeHtml(a.id)}">
                <span class="opt-agent-name">${escapeHtml(a.name)}</span>
                <span class="opt-agent-brief">${escapeHtml(a.agentRoleBrief || a.title || "AI agent")}</span>
              </button>`,
            )
            .join("")}
        </div>
        ${agents.length ? "" : `<p class="d-note-empty">管理中心還沒有啟用的 agent，可以先用本機規則檢查。</p>`}
      </div>
    `);

    document.querySelectorAll<HTMLButtonElement>(".opt-agent").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.agent || "";
        const agent = id ? availableAgents().find((a) => a.id === id) : null;
        void runOptimize(agent?.name ?? "本機規則檢查", agent?.agentRoleBrief ?? "", !!agent);
      });
    });
  }

  /** 第二步：跑檢查，列出建議 */
  async function runOptimize(agentName: string, brief: string, useAi: boolean) {
    const p = activeProject();
    if (!p) return;
    const stats = p.importSummary?.rootPath ? (cache.get(p.importSummary.rootPath) ?? null) : null;

    optimizeModal(`
      <header><div><h3 id="opt-title">${escapeHtml(agentName)} 檢查中…</h3></div></header>
      <div class="body"><p class="d-note-empty">正在比對欄位內容與量測結果。</p></div>
    `);

    // 本機規則永遠先跑：AI 失敗時仍有東西可看
    let list: Suggestion[] = localSuggestions(p, stats);
    let aiError = "";
    if (useAi) {
      try {
        list = [...list, ...(await aiSuggestions(p, stats, brief))];
      } catch (e) {
        aiError = e instanceof Error ? e.message : "AI 呼叫失敗";
      }
    }

    renderSuggestions(agentName, list, aiError, !stats);
  }

  /** 第三步：使用者逐項確認才寫入 */
  function renderSuggestions(
    agentName: string,
    list: Suggestion[],
    aiError: string,
    noStats: boolean,
  ) {
    const notes = [
      aiError ? `AI 部分失敗：${escapeHtml(aiError)}　以下只有本機規則的結果。` : "",
      noStats ? "這個專案還沒量測過磁碟，判斷依據較少。可先按「重新量測」。" : "",
    ].filter(Boolean);

    const back = optimizeModal(`
      <header>
        <div>
          <h3 id="opt-title">${escapeHtml(agentName)} 的建議</h3>
          <p class="sub">${list.length ? `${list.length} 項　勾選要套用的，沒勾的不會動` : "沒有需要調整的欄位"}</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-opt-close>關閉</button>
      </header>
      <div class="body">
        ${notes.length ? `<ul class="opt-notes">${notes.map((n) => `<li>${n}</li>`).join("")}</ul>` : ""}
        ${
          list.length
            ? `<ul class="opt-list">${list
                .map(
                  (x, i) => `<li>
                    <label class="opt-item">
                      <input type="checkbox" data-opt-pick="${i}" ${x.current === x.proposed ? "" : "checked"} />
                      <span class="opt-item-body">
                        <span class="opt-item-head">
                          <span class="opt-item-field">${escapeHtml(x.label)}</span>
                          <span class="opt-item-src">${escapeHtml(x.source)}</span>
                        </span>
                        <span class="opt-why">${escapeHtml(x.why)}</span>
                        ${
                          x.current === x.proposed
                            ? `<span class="opt-noop">這一項只是提醒，沒有可直接套用的新內容 —— 請自己改。</span>`
                            : `<span class="opt-diff">
                                 <span class="opt-before">${escapeHtml(x.current)}</span>
                                 <span class="opt-after">${escapeHtml(x.proposed)}</span>
                               </span>`
                        }
                      </span>
                    </label>
                  </li>`,
                )
                .join("")}</ul>`
            : `<p class="d-note-empty">名稱與介紹目前和量測到的事實一致，沒有要改的。</p>`
        }
      </div>
      <footer>
        <button type="button" class="btn" data-opt-close>取消</button>
        <button type="button" class="btn btn-primary" id="opt-apply" ${list.length ? "" : "disabled"}>套用勾選的</button>
      </footer>
    `);

    back.querySelector("#opt-apply")?.addEventListener("click", () => {
      const p = activeProject();
      if (!p) return;
      let n = 0;
      back.querySelectorAll<HTMLInputElement>("[data-opt-pick]").forEach((cb) => {
        if (!cb.checked) return;
        const x = list[Number(cb.dataset.optPick)];
        if (!x || x.current === x.proposed) return;
        if (x.field === "name") store.renameProject(p.id, x.proposed);
        else store.setProjectDescription(p.id, x.proposed);
        n++;
      });
      back.remove();
      if (n) {
        toast(`已套用 ${n} 項`);
        load(true);
      } else {
        toast("沒有勾選任何可套用的項目");
      }
    });
  }

  document.getElementById("btn-optimize")?.addEventListener("click", openOptimize);

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
