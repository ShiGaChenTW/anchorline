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
import { askConfirm } from "../lib/ask";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import {
  aiSuggestions,
  localSuggestions,
  type Suggestion,
} from "../lib/dashboard-optimize";
import { initHelpOverlay } from "../lib/help-overlay";
import { diagnoseGit, hasActionableIssue, usesConventionalCommits } from "../lib/git-doctor";
import {
  commitSystemVars,
  buildCommitUser,
  commitCommand,
  isUsableDraft,
  parseCommitDraft,
  parsePorcelain,
  summarizeChanges,
} from "../lib/commit-message";
import { promptSystem, promptTemperature } from "../lib/prompt-registry";
import { AiError, chatCompletion, getAiReadiness } from "../lib/ai-client";
import { policyOf } from "../lib/release";
import { isNative, isUnavailable, native } from "../lib/native";
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
import { coverageLine } from "../lib/governance";
import { canReadCoverage, requestCoverage, type CoverageResult } from "../lib/governance-bridge";
// 靜態 import：這個 module 本來就已經被靜態拉進來（原本的 loadOpenFixes），
// 再對同一個 module 用動態 import 只是多一段 await，省不到任何東西。
import {
  attributePendingUats,
  loadUatScan,
  rollupPendingUats,
  uatRollupText,
  UAT_SUM_TITLE,
  UAT_TRUNCATED_NOTE,
  type UatRollup,
} from "../lib/uat-pending";

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
    return `<section class="d-hero d-ident">
        <p class="d-eyebrow">專案</p>
        <div class="d-ident-name-row">
          <input type="text" id="d-name" class="d-ident-name" value="${escapeHtml(name)}"
                 aria-label="專案名稱" placeholder="未命名專案" />
          <input type="text" id="d-code" class="d-ident-code" value="${escapeHtml(p?.shortCode ?? "")}"
                 maxlength="5" spellcheck="false" autocapitalize="characters"
                 aria-label="專案簡寫" placeholder="簡寫" />
        </div>
        <textarea id="d-desc" class="d-ident-desc" rows="1" aria-label="專案介紹"
                  placeholder="一句話說明這個專案在做什麼">${escapeHtml(desc)}</textarea>
        <div class="d-ident-tags" id="d-tags">${tagsInnerHtml(p)}</div>
      </section>`;
  }

  /**
   * 版號政策 —— 放在**版號紀錄卡**裡。
   *
   * 它原本掛在專案身分卡（名稱／介紹／標籤）底下，但那張卡講的是
   * 「這個專案是什麼」，而政策講的是「這個專案的版號長什麼樣」。
   * 跟版號清單放在一起，看到清單的當下就知道它為什麼是那個形狀。
   *
   * 選了 vX.YY.ZZ 之後只剩一段說明，切回去的按鈕整個拿掉而不是變灰 ——
   * 一顆按下去只會告訴你「不行」的按鈕，每次看到都要重新想一次為什麼。
   */
  /**
   * 沒有 git 統計的兩條路徑（沒綁資料夾、瀏覽器版）也要留住政策入口 ——
   * 版號政策跟綁不綁資料夾無關，藏起來只會讓人以為功能消失了。
   */
  function policyCard(p: Project | null): string {
    if (!p) return "";
    return `<section class="d-card"><p class="d-eyebrow">版號紀錄</p>${policyHtml(p)}</section>`;
  }

  function policyHtml(p: Project | null): string {
    if (!p) return "";
    if (policyOf(p) === "strict") {
      return `<div class="d-policy is-strict">
        <strong>版號採 vX.YY.ZZ</strong>
        <span>X 大型迭代要有 PRD 簽核紀錄 · YY 新功能要走過 OpenSpec · ZZ 小修挑 commit。
        已經用這套發出去的版號帶著這些保證，所以這個選擇不能改回去。</span>
      </div>`;
    }
    return `<div class="d-policy">
      <strong>版號目前不限格式</strong>
      <span>可以用 v1.2.3、2026.08、R42，只擋會出問題的字元。
      也可以改採 <code>vX.YY.ZZ</code>，讓三段各自綁定取號條件 ——
      <b>這個選擇不能改回來。</b></span>
      <button type="button" class="btn btn-sm" id="d-policy-strict">改採 vX.YY.ZZ</button>
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

    // 專案身分與版本控制是**兩件事**：一個是人寫的中繼資料，一個是磁碟量出來的
    // 狀態。擠在同一張卡裡，中間那條分隔線要做整張卡的分節工作，掃過去只會讀到
    // 一坨。拆成上下兩張各半高的卡，各自有自己的框。
    return `<div class="d-top-left">
      ${identHtml(p)}

      <section class="d-hero tone-${head.tone}">
      <p class="d-eyebrow">版本控制</p>
      <div class="d-hero-head">
        <p class="d-hero-figure">${escapeHtml(head.text)}</p>
        ${
          hasActionableIssue(diagnoseGit(g))
            ? `<button type="button" class="btn btn-sm d-fix-btn" id="btn-git-doctor">版控健檢 <span>${diagnoseGit(g).filter((i) => i.level !== "info").length}</span></button>`
            : !g
              ? `<button type="button" class="btn btn-sm btn-primary" id="btn-git-init" title="在這個資料夾執行 git init">git init</button>`
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
          : `<p class="d-hero-sub">按「git init」在這個資料夾建立 <code>.git</code>。只做 init，不會 add、不會 commit。</p>`
      }
      </section>
    </div>`;
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
        ${policyHtml(activeProject())}
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
      ${policyHtml(activeProject())}
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
  /** 治理覆蓋率。資料是非同步來的，先出骨架，讀完再換掉這張卡的內容。 */
  const GOVERNANCE_CARD_ID = "card-governance";

  function governanceInner(r: CoverageResult | null): string {
    if (!canReadCoverage()) {
      return `<p class="d-eyebrow">治理覆蓋率</p>
        <p class="d-figure">—</p>
        <p class="d-figure-sub">桌面版才讀得到稽核軌跡</p>`;
    }
    if (!r) {
      return `<p class="d-eyebrow">治理覆蓋率</p>
        <p class="d-figure">讀取中…</p>
        <p class="d-figure-sub">正在讀 .anchorline/log/</p>`;
    }
    const { coverage: c } = r;
    // 「尚未開始治理」與「零未治理」必須看得出差別 —— 兩者都顯示 0 的話，
    // 什麼都沒做會看起來像做得很乾淨。
    const figure = c.startedIso === null ? "尚未開始" : String(c.ungoverned);
    // 「尚未開始治理」自己不夠用 —— 它沒說下一步是什麼。分成兩種：
    // plan 還沒鑄錨點（去鑄），或錨點有了但沒有工作掛上去（去按交接）。
    const notes = [
      c.startedIso !== null
        ? `自 ${new Date(c.startedIso).toLocaleDateString("zh-TW")} 起算　已治理 ${c.governed} 件`
        : r.knownAnchors > 0
          ? `plans 有 ${r.knownAnchors} 個錨點，但還沒有工作掛上去 —— 用步驟上的「交接」派工就會開始累積`
          : "plans 裡還沒有任何錨點　勾選或編輯步驟時會自動鑄一個",
      r.truncated ? "只讀了最近的分片，實際數量可能更多" : "",
      r.skipped ? `跳過 ${r.skipped} 行讀不懂的資料` : "",
      // W1-3 改了判準：openspec 步驟從此計入已治理。歷史數字因此往上跳
      // 一次是預期行為——不講出來，使用者只會以為資料壞了。
      c.startedIso !== null ? "計分規則 2026-08 起認 openspec 步驟，歷史數字曾因此上調一次" : "",
    ].filter(Boolean);

    return `<p class="d-eyebrow">治理覆蓋率</p>
      <p class="d-figure">${escapeHtml(figure)}</p>
      <p class="d-figure-sub">${escapeHtml(coverageLine(c))}</p>
      ${notes.map((n) => `<p class="d-note">${escapeHtml(n)}</p>`).join("")}`;
  }

  function cardGovernance(r: CoverageResult | null): string {
    return `<section class="d-card" id="${GOVERNANCE_CARD_ID}">${governanceInner(r)}</section>`;
  }

  /** 讀完就只換這張卡，不重畫整頁 —— 重畫會把使用者的捲動位置扔掉。 */
  const FIXES_CARD_ID = "d-open-fixes";

  /**
   * 待修題數（W2-4）——只給一個數字，明細在總覽的「待修」收件匣。
   * 這一頁講的是「這個專案怎麼樣」，所以只掃當前專案的 plans/。
   * 零題整卡不渲染，跟總覽同一條「不留空殼」的規矩。
   */
  function openFixesInner(n: number): string {
    if (!n) return "";
    return `<p class="d-eyebrow">待修</p>
      <p class="d-figure">${n} 題</p>
      <p class="d-note" title="以最新一輪報告為準——被重測取代的舊報告不列入">失敗題明細與交辦在「專案總覽」的待修區塊</p>`;
  }

  function cardOpenFixes(): string {
    return `<section class="d-card" id="${FIXES_CARD_ID}" hidden></section>`;
  }

  /**
   * 跨專案實測進度 —— **一列，不是一張卡**。
   *
   * 三重錯位是這裡唯一要處理的問題：這個數字是**全部專案**、`.d-grid` 裡的
   * 「待修」卡是**本專案**；兩者同單位（題）、集合互斥（未測 vs 已判失敗）、
   * 範圍還是子集關係。三個錯位疊在兩張同款並排的卡上，版面會主動教人讀成
   * 「7 裡面有 2」。所以視覺重量刻意跟卡片拉開（一條細列、虛線框、無底色），
   * 而且**「全部專案」四個字寫在看得見的文字裡**。
   *
   * 範圍寫進 title 是不夠的：側欄那個 badge 的值也是全部專案，卻掛在
   * 「這個專案可以做的事」群組裡、範圍只寫在 title —— 從來沒有人發現。
   */
  const UAT_ROW_ID = "d-uat-row";

  /** 三個分支共用的空殼。掃完才填，零份就一直 hidden —— 不留空殼佔版面。 */
  function uatRow(): string {
    return `<a class="d-uat-row" id="${UAT_ROW_ID}" href="overview.html" hidden title="${escapeHtml(UAT_SUM_TITLE)}"></a>`;
  }

  function uatRowInner(t: UatRollup): string {
    const s = uatRollupText(t);
    return `<span class="d-uat-scope">全部專案實測</span>
      <strong>${escapeHtml(s.lead)}</strong>
      <span class="d-uat-detail">${escapeHtml(s.detail)}　${t.reports} 份報告</span>
      ${s.skipped ? `<span class="d-uat-detail">${escapeHtml(s.skipped)}</span>` : ""}
      ${t.truncated ? `<span class="d-uat-detail">${escapeHtml(UAT_TRUNCATED_NOTE)}</span>` : ""}
      <span class="d-uat-go">看逐份 ›</span>`;
  }

  /**
   * 待修數字卡與實測進度列**共用同一次掃描**。
   *
   * supersede 要在**全集**上解（Cato-03）：取代者可能在別的專案的 plans/，
   * 只掃單一目錄的話，同一個「待修」數字會與總覽不一致——兩張卡都寫
   * 「以最新一輪為準」，其中一張在說謊。掃全部、再按本專案過濾。
   *
   * 兩者掃的是完全相同的目錄與檔案，差別只在一個取 `fail` 一個取 `pending`，
   * 所以走 `loadUatScan` 一次拿兩個視圖（側欄 badge 也吃同一份快取）。
   */
  async function loadUatCards(folderPath?: string): Promise<void> {
    const st = store.get();
    const { uatScanDirs } = await import("../lib/tracking-bridge");
    const scan = await loadUatScan(uatScanDirs(st));

    // 待修卡只在「有選專案且綁了資料夾」時才有意義；沒綁資料夾就沒有本專案
    // 的歸屬可比。實測進度那一列不受影響 —— 它問的是全部專案。
    const p = folderPath ? activeProject() : null;
    const mine = p
      ? attributePendingUats(scan.fixes, [
          { id: p.id, name: projectDisplayName(p), rootPath: folderPath },
        ]).filter((x) => x.projectId === p.id)
      : [];
    const host = document.getElementById(FIXES_CARD_ID);
    if (host && mine.length) {
      host.innerHTML = openFixesInner(mine.length);
      host.hidden = false;
    }

    // 這一列不過濾專案：它回答的就是「所有專案加起來」。
    const rowHost = document.getElementById(UAT_ROW_ID);
    const roll = rollupPendingUats(scan.pending, { truncated: scan.truncated });
    if (rowHost && roll.reports) {
      rowHost.innerHTML = uatRowInner(roll);
      rowHost.hidden = false;
    }
  }

  async function loadGovernance(folderPath: string): Promise<void> {
    const r = await requestCoverage(folderPath);
    const host = document.getElementById(GOVERNANCE_CARD_ID);
    if (host) host.innerHTML = governanceInner(r);
  }

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
       ${uatRow()}
       <div class="d-grid">${cardCommits(s)}${cardGovernance(null)}${cardOpenFixes()}${cardStack(s)}${cardSize(s)}${cardWorkspace(s)}</div>
       <p class="d-measured">量測於 ${new Date(s.measuredAt ?? Date.now()).toLocaleTimeString("zh-TW")}　<span class="mono">${escapeHtml(s.folderPath)}</span></p>`,
    );
    bindIdentEditing();
    document.getElementById("btn-git-doctor")?.addEventListener("click", () => {
      openGitDoctor(s.git);
    });
    document.getElementById("btn-git-init")?.addEventListener("click", () => {
      void runGitInit(s.folderPath);
    });
    void loadGovernance(s.folderPath);
    void loadUatCards(s.folderPath);
  }

  /**
   * 儀表板「不是 git 專案」時的唯一寫入動作。
   *
   * 跟版控健檢不同：健檢只給指令。這裡真的跑 `git init`，因為它可逆
   * （刪掉 .git 就還原）、不外流、參數在 Rust 端寫死。不順便 add / commit。
   */
  async function runGitInit(folderPath: string) {
    const p = activeProject();
    const name = p ? projectDisplayName(p) : folderPath;
    if (
      !(await askConfirm({
        title: `要在「${name}」執行 git init 嗎？`,
        body: `會在這個資料夾建立 .git。只做 git init，不會 add、不會 commit。不想要的話刪掉 .git 就還原了。`,
        confirmLabel: "執行 git init",
      }))
    ) {
      return;
    }
    const btn = document.getElementById("btn-git-init") as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
    try {
      const r = await native.gitInit(folderPath);
      if (isUnavailable(r)) {
        toast(r.message);
        return;
      }
      toast("已 git init");
      cache.delete(folderPath);
      await load(true);
    } catch (e) {
      toast(e instanceof Error ? e.message : "git init 失敗");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function load(force = false) {
    const p = activeProject();
    syncChrome(p);

    if (!p) {
      renderState(
        `${uatRow()}
         <div class="dash-empty"><p>還沒有選擇專案。</p><a class="btn btn-primary" href="overview.html">回總覽</a></div>`,
      );
      // 沒選專案時這一列**最有用**：它是唯一不需要選專案就能回答的問題。
      void loadUatCards();
      return;
    }
    const path = p.importSummary?.rootPath;
    if (!path) {
      // 當場就能解決，不要把人踢去別頁再自己找按鈕 ——
      // 「沒綁資料夾」是這一頁最常見的狀態（多數專案都沒綁）
      renderState(
        `${identHtml(p)}
         ${uatRow()}
         <div class="dash-empty">
          <p>「${escapeHtml(projectDisplayName(p))}」還沒有對應磁碟上的資料夾，所以量不到 git、技術線與容量。</p>
          <button type="button" class="btn btn-primary" id="dash-bind">指定專案資料夾</button>
          <p class="dash-note">綁定只記錄對應關係，不會動到你已經寫好的章節內容。</p>
        </div>
        ${policyCard(p)}`,
      );
      bindIdentEditing();
      // 本專案沒綁資料夾，但**別的**專案可能有實測在等 —— 這一列問的是全部專案，
      // 沒有理由跟著這一頁的空狀態一起消失。
      void loadUatCards();
      document.getElementById("dash-bind")?.addEventListener("click", () => {
        askForProjectFolder(p.id, projectDisplayName(p));
      });
      return;
    }
    if (!isDesktop()) {
      // 這一支分支**刻意不放實測列**：瀏覽器沒有資料通道，掃描一律回空，
      // 而空經過 rollup 會變成「每題都勾完了」—— 一句假的全清。
      // 同一條規矩寫在 welcome.ts 的 canScanPlans 守門上。
      renderState(
        `${identHtml(p)}
         <div class="dash-empty">
          <p>這一頁需要桌面版 App。瀏覽器看不到磁碟，也跑不了 git。</p>
          <p class="dash-note mono">${escapeHtml(path)}</p>
        </div>
        ${policyCard(p)}`,
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

    const codeEl = document.getElementById("d-code") as HTMLInputElement | null;
    if (codeEl && codeEl.dataset.bound !== "1") {
      codeEl.dataset.bound = "1";
      const save = () => {
        const v = codeEl.value.trim();
        if (v === (p.shortCode ?? "")) return;
        const r = store.setProjectShortCode(p.id, v);
        if (!r.ok) {
          toast(r.reason ?? "簡寫不合法");
          codeEl.value = p.shortCode ?? "";
          return;
        }
        const saved = store.get().projects.find((x) => x.id === p.id)?.shortCode ?? "";
        codeEl.value = saved;
        toast(saved ? `簡寫已設為 ${saved}` : "已清除簡寫");
      };
      codeEl.addEventListener("blur", save);
      codeEl.addEventListener("keydown", (e) => {
        if ((e as KeyboardEvent).key === "Enter") {
          e.preventDefault();
          codeEl.blur();
        }
      });
    }

    const policyBtn = document.getElementById("d-policy-strict");
    if (policyBtn && policyBtn.dataset.bound !== "1") {
      policyBtn.dataset.bound = "1";
      policyBtn.addEventListener("click", async () => {
        // 兩段確認：這個決定不可逆，而不可逆的動作值得一次刻意的停頓
        if (
          !(await askConfirm({
            title: [
              `「${projectDisplayName(p!)}」的版號要改採 vX.YY.ZZ。`,
              "",
              "之後取號會多三道閘門：",
              "  X  大型迭代 —— 要有完成的 PRD 簽核紀錄",
              "  YY 新功能  —— 收的內容要有走過 OpenSpec 的 change",
              "  ZZ 小修    —— 挑已經 commit 的項目",
              "",
              "這個選擇不能改回來。已經用這套發出去的版號帶著上面的保證，",
              "退回去之後那些保證沒有東西背書。",
            ].join("\n"),
            danger: true,
          }))
        )
          return;
        const r = store.setVersionPolicy(p!.id, "strict");
        toast(r.ok ? "已改採 vX.YY.ZZ" : (r.reason ?? "切換失敗"));
        if (r.ok) void load(true);
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
   * 「讀改動並產生 commit 訊息」。
   *
   * 三個狀態各自要說得清楚，因為它們的下一步完全不同：
   * AI 沒設定 → 去設定頁；不是桌面版 → 沒有原生橋讀不到 diff；
   * 沒有改動 → 根本不該出現這一區。含糊的一句「產生失敗」會讓人重按五次。
   *
   * 產出一律進可編輯的 textarea。模型看不到執行結果，寫出來的東西要人看過
   * 才算數 —— 這也是為什麼這裡只到「複製指令」為止，不代跑 commit。
   */
  function bindAiCommit(
    back: HTMLElement,
    g: NonNullable<ProjectStats["git"]> | undefined,
    conventional: boolean,
  ) {
    const runBtn = back.querySelector<HTMLButtonElement>("#gd-ai-run");
    if (!runBtn) return;
    const statusEl = back.querySelector<HTMLElement>("#gd-ai-status");
    const result = back.querySelector<HTMLElement>("#gd-ai-result");
    const text = back.querySelector<HTMLTextAreaElement>("#gd-ai-text");
    const say = (m: string, tone: "" | "error" = "") => {
      if (!statusEl) return;
      statusEl.textContent = m;
      statusEl.className = `gd-ai-status${tone ? " is-error" : ""}`;
    };

    runBtn.addEventListener("click", async () => {
      const ready = getAiReadiness();
      if (!ready.ok) {
        say(`${ready.reason}（偏好設定 → AI）`, "error");
        return;
      }
      if (!isNative()) {
        say("讀取改動內容需要桌面版的原生橋。", "error");
        return;
      }
      const root = store.get().projects.find((p) => p.id === store.get().activeProjectId)
        ?.importSummary?.rootPath;
      if (!root) {
        say("這個專案還沒綁定資料夾。", "error");
        return;
      }

      runBtn.disabled = true;
      say("讀取改動內容…");
      try {
        const cs = await native.gitChangeset(root);
        if (isUnavailable(cs)) {
          say(cs.message, "error");
          return;
        }
        const files = parsePorcelain(cs.status);
        if (!files.length) {
          say("沒有偵測到未提交的改動。", "error");
          return;
        }

        say(
          cs.truncated
            ? `${summarizeChanges(files)}（差異過大已截斷）· 產生中…`
            : `${summarizeChanges(files)} · 產生中…`,
        );

        const input = {
          changeset: cs,
          files,
          recentSubjects: (g?.commits ?? []).slice(0, 8).map((c) => c.subject),
          conventional,
          language: store.get().settings.language,
        };
        const raw = await chatCompletion(
          promptSystem("commit-message", commitSystemVars(input)),
          buildCommitUser(input),
          { temperature: promptTemperature("commit-message") },
        );
        const draft = parseCommitDraft(raw);
        if (!isUsableDraft(draft)) {
          say("模型沒有回傳可用的主旨，再試一次。", "error");
          return;
        }
        if (text) text.value = draft.body ? `${draft.subject}\n\n${draft.body}` : draft.subject;
        if (result) result.hidden = false;
        say(cs.truncated ? "產生完成（依截斷後的差異）" : "產生完成");
      } catch (e) {
        say(e instanceof AiError ? e.message : String(e), "error");
      } finally {
        runBtn.disabled = false;
      }
    });

    const copy = async (s: string, btn: HTMLButtonElement) => {
      try {
        await navigator.clipboard.writeText(s);
        const prev = btn.textContent;
        btn.textContent = "已複製";
        window.setTimeout(() => {
          btn.textContent = prev;
        }, 1200);
      } catch {
        toast("複製失敗，請手動選取");
      }
    };
    // 從 textarea 讀而不是從 draft 讀 —— 使用者改過的版本才是他要的那一份
    const draftNow = () => {
      const v = (text?.value ?? "").trim();
      const [subject = "", ...rest] = v.split(/\r?\n/);
      return { subject, body: rest.join("\n").replace(/^\s*\n+/, "").trimEnd() };
    };
    back.querySelector<HTMLButtonElement>("#gd-ai-copy-msg")?.addEventListener("click", (e) => {
      void copy((text?.value ?? "").trim(), e.currentTarget as HTMLButtonElement);
    });
    back.querySelector<HTMLButtonElement>("#gd-ai-copy-cmd")?.addEventListener("click", (e) => {
      void copy(commitCommand(draftNow()), e.currentTarget as HTMLButtonElement);
    });
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
        ${
          (g?.dirtyCount ?? 0) > 0
            ? `<section class="gd-ai" id="gd-ai">
                 <div class="gd-ai-head">
                   <strong>commit 訊息</strong>
                   <span class="gd-ai-sub">${g?.dirtyCount} 個檔案還沒提交。讀實際改動內容產生訊息。</span>
                 </div>
                 <div class="gd-ai-actions">
                   <button type="button" class="btn btn-sm btn-primary" id="gd-ai-run">讀改動並產生</button>
                   <span class="gd-ai-status" id="gd-ai-status"></span>
                 </div>
                 <div id="gd-ai-result" hidden>
                   <textarea id="gd-ai-text" class="gd-ai-text" rows="7" aria-label="commit 訊息，可編輯"></textarea>
                   <div class="gd-ai-actions">
                     <button type="button" class="btn btn-sm" id="gd-ai-copy-msg">複製訊息</button>
                     <button type="button" class="btn btn-sm" id="gd-ai-copy-cmd">複製 git commit 指令</button>
                   </div>
                 </div>
               </section>`
            : ""
        }
        <p class="gd-warn">這些指令不會自動執行 —— 複製到終端機自己跑。改動 repo 的決定留給你。</p>
      </div>
      <footer>
        <button type="button" class="btn btn-primary" data-opt-close>知道了</button>
      </footer>
    `);

    bindAiCommit(back, g, conventional);

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
