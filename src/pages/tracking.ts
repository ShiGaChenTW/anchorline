import { store } from "../data/store";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import { deriveFlowLayers } from "../lib/flow-layers";
import { initHelpOverlay } from "../lib/help-overlay";
import { evaluatePrdGates, gateSummaryLine } from "../lib/prd-gates";
import { parsePlanMeta, planProgressPct, type PlanMeta } from "../lib/plan-parser";
import { initTheme } from "../lib/theme";
import { sortByRecency, trackingTarget } from "../lib/tracking";
import { canScanPlans, plansDirsOf, requestTrackingScan } from "../lib/tracking-bridge";
import { escapeHtml, initMobileNav, toast, updateUserRailFooter } from "../lib/ui";
import { byNewest, dedupe, parseLog, type LogEvent } from "../lib/event-log";
import { hookInstallSnippet } from "../lib/event-writer";
import {
  buildResumeCard,
  exportCsv,
  exportMarkdown,
  filterForExport,
  kindLabel,
  todayLine,
  todaySummary,
} from "../lib/log-views";
import { buildReplay, replayMarkdown } from "../lib/replay";

/**
 * Vite 編譯期嵌入本 repo 自己的 plans/*.md。
 *
 * 這是**降級路徑**：瀏覽器拿不到 mtime，所以拿不到追蹤目標，只能顯示靜態快照。
 * 桌面版走 tracking-bridge 讀使用者實際綁定的專案資料夾，那條路才是活的。
 */
const planFiles = import.meta.glob("../../plans/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * 編譯期嵌入本 repo 自己的稽核軌跡 —— 與上面的 planFiles 同一套降級策略。
 *
 * 瀏覽器讀不到磁碟，所以看到的是建置當下的快照；桌面版走 bridge 讀
 * 使用者實際綁定專案的 `.specforge/log/`，那條路才是活的。
 * 兩條路都存在，介面才不會在瀏覽器裡變成一個永遠空白的區塊。
 */
const logFiles = import.meta.glob("../../.specforge/log/*.jsonl", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** 壞行由 parseLog 跳過，不會毀掉整份。 */
let auditEvents: LogEvent[] = dedupe(
  Object.values(logFiles).flatMap((t) => parseLog(t).events)
);

/** 讓桌面版把讀到的 JSONL 交進來，覆蓋編譯期快照。 */
export function loadAuditLog(text: string): number {
  const { events, skipped } = parseLog(text);
  auditEvents = dedupe(events);
  return skipped;
}

type PlanEntry = {
  id: string;
  name: string;
  /** 絕對路徑。降級路徑沒有真實路徑，退回用檔名當 key */
  path: string;
  /** 降級路徑為 NaN —— sortByRecency 與 trackingTarget 都會略過 */
  mtimeMs: number;
  raw: string;
  meta: PlanMeta;
};

const __authed = requireAuth();
if (__authed) {
  initTheme();
  initMobileNav("tracking");
  bindLogout();
  initHelpOverlay();

  let plans: PlanEntry[] = [];
  /** 使用者選的。按鍵／點擊才變 */
  let idx = 0;
  /** 系統判定的。隨檔案活動變，永遠不寫進 idx —— 那會把使用者正在讀的畫面搶走 */
  let trackingPath: string | null = null;
  /** 有沒有真實 mtime 可用。決定要不要顯示追蹤點，而不是顯示一個永遠不亮的點 */
  let live = false;
  let lastSig = "";

  /** 當前選取專案的名稱，給空狀態文案用。找不到就回空字串。 */
  function activeProjectName(): string {
    const st = store.get();
    const p = st.projects.find((x) => x.id === st.activeProjectId);
    // 與側欄同一套規則：自訂名優先，否則用 title（匯入時通常是資料夾名）。
    return p?.customName || p?.title || "";
  }

  /** 降級路徑：編譯期嵌入的靜態快照，沒有 mtime 就沒有追蹤目標 */
  function loadStatic() {
    plans = Object.entries(planFiles)
      .map(([p, raw]) => {
        const name = p.split("/").pop() ?? p;
        return { id: name, name, path: name, mtimeMs: NaN, raw, meta: parsePlanMeta(raw, name) };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
    live = false;
    trackingPath = null;
    restoreIdx();
  }

  /** 活路徑：原生橋回報「當前選取專案」plans/ 的真實 mtime */
  async function loadLive(): Promise<boolean> {
    const st = store.get();
    const dirs = plansDirsOf(st.projects, st.activeProjectId);
    // 選取的專案沒綁資料夾 —— 清單就該是空的，不是退回全部專案。
    // 回 false 會讓呼叫端落到靜態快照，那是「本 repo 自己的 plans」，
    // 一樣不屬於當前專案，所以這裡自己把清單清乾淨並直接收工。
    if (!dirs.length) {
      plans = [];
      live = false;
      trackingPath = null;
      restoreIdx();
      return true;
    }
    let scan;
    try {
      scan = await requestTrackingScan(dirs);
    } catch {
      return false; // 橋壞了／逾時 —— 不是錯誤，退回靜態快照
    }
    if (!scan.files.length) return false;

    plans = sortByRecency(
      scan.files.map((f) => ({
        id: f.path,
        name: f.name,
        path: f.path,
        mtimeMs: f.mtimeMs,
        raw: f.text,
        meta: parsePlanMeta(f.text, f.name),
      })),
    );
    live = true;
    // 每次重繪重算，不快取 —— 快取只會製造「追蹤點卡住不動」這類 bug
    trackingPath = trackingTarget({ files: plans, signal: scan.signal }, Date.now());
    restoreIdx();
    return true;
  }

  /** 清單重載後把選取黏回同一份檔案，而不是同一個索引 */
  let selectedPath = "";
  function restoreIdx() {
    const i = plans.findIndex((p) => p.path === selectedPath);
    idx = i >= 0 ? i : 0;
    selectedPath = plans[idx]?.path ?? "";
  }

  async function loadPlans() {
    if (canScanPlans() && (await loadLive())) return;
    loadStatic();
  }

  /**
   * 畫面去重：輪詢每秒觸發，無變化時重畫會讓捲動位置跳掉、也白燒 CPU。
   * 比對 (檔案 + mtime + 選取 + 追蹤) 的指紋，相同就跳過。
   */
  function signature(): string {
    return `${idx}|${trackingPath}|${plans.map((p) => `${p.path}:${p.mtimeMs}`).join(",")}`;
  }

  function syncUser() {
    const u = store.get().currentUser;
    updateUserRailFooter(toRailUser(u));
  }

  /**
   * 計劃清單依狀態分組。
   *
   * 13 份計劃裡有 9 份是 `未知 · 0/0 · 0%`（沒有 Plan Steps 區段的筆記檔），
   * 全部平鋪等重量，等於把「哪一份在動」藏進雜訊裡。分組後預設只看到
   * 追蹤中／進行中，沒有步驟的收進可展開的那一組 —— 需要時打開就有，
   * 不需要時不佔視野。
   */
  type Group = { key: string; label: string; items: { p: PlanEntry; i: number }[]; open: boolean };

  function groupPlans(): Group[] {
    const tracked: Group["items"] = [];
    const active: Group["items"] = [];
    const done: Group["items"] = [];
    const noSteps: Group["items"] = [];
    plans.forEach((p, i) => {
      const entry = { p, i };
      if (live && p.path === trackingPath) tracked.push(entry);
      else if (p.meta.total_steps === 0) noSteps.push(entry);
      else if (p.meta.done_steps >= p.meta.total_steps) done.push(entry);
      else active.push(entry);
    });
    return [
      { key: "tracked", label: "agent 正在寫", items: tracked, open: true },
      { key: "active", label: "進行中", items: active, open: true },
      { key: "done", label: "已完成", items: done, open: done.length <= 4 },
      { key: "none", label: "沒有步驟的檔案", items: noSteps, open: false },
    ].filter((g) => g.items.length);
  }

  function planRow({ p, i }: { p: PlanEntry; i: number }): string {
    const pct = planProgressPct(p.meta);
    const isTracked = live && p.path === trackingPath;
    return `<button type="button" class="tk-row${i === idx ? " on" : ""}${isTracked ? " tracked" : ""}" data-i="${i}">
      <span class="tk-row-t">${escapeHtml(p.meta.title)}</span>
      <span class="tk-row-m">
        ${
          p.meta.total_steps
            ? `<span class="tk-mini"><i style="width:${pct}%"></i></span><span class="tk-num">${p.meta.done_steps}/${p.meta.total_steps}</span>`
            : `<span class="tk-num tk-num--none">沒有步驟</span>`
        }
      </span>
    </button>`;
  }

  function renderList() {
    const el = document.getElementById("plan-list");
    if (!el) return;
    if (!plans.length) {
      const name = activeProjectName();
      const scope = name ? `「${name}」` : "當前專案";
      el.innerHTML = `<div class="tk-empty">
        <p>${escapeHtml(scope)} 的 <code>plans/</code> 還沒有計劃檔。</p>
        <p class="tk-empty-how">在專案資料夾建一個 <code>plans/</code>，放入含 <code>## Plan Steps</code> 的 markdown，這裡就會列出進度。</p>
      </div>`;
      return;
    }

    el.innerHTML = groupPlans()
      .map(
        (g) => `<details class="tk-group" ${g.open ? "open" : ""}>
          <summary><span>${g.label}</span><span class="tk-count">${g.items.length}</span></summary>
          <div class="tk-rows">${g.items.map(planRow).join("")}</div>
        </details>`,
      )
      .join("");

    el.querySelectorAll<HTMLButtonElement>(".tk-row").forEach((btn) => {
      btn.onclick = () => select(Number(btn.dataset.i));
    });
  }

  /**
   * 「現在該做什麼」。
   *
   * 這一頁原本最上面寫的是 `下一步：—`，等於花掉最顯眼的位置說「不知道」。
   * 改成永遠給一個具體動作：有未完成步驟就指那一步，沒有步驟就說怎麼補，
   * 全做完就指向下一個該處理的計劃。找不到事做才是好消息，也要說出來。
   */
  function nextActionHtml(p: PlanEntry | undefined): string {
    if (!p) return "";
    const pending = p.meta.steps.find((s) => s.state === "pending");
    if (pending) {
      return `<p class="tk-do-what">${escapeHtml(pending.text)}</p>
        <p class="tk-do-why">這是這份計劃第一個還沒完成的步驟。</p>`;
    }
    if (!p.meta.total_steps) {
      return `<p class="tk-do-what">這份檔案還沒有可追蹤的步驟</p>
        <p class="tk-do-why">加一個 <code>## Plan Steps</code> 區段，底下用 <code>- [ ]</code> 列步驟，進度就會自動算。</p>`;
    }
    const nextPlan = groupPlans().find((g) => g.key === "active")?.items[0];
    return `<p class="tk-do-what tk-do-clear">這份做完了</p>
      <p class="tk-do-why">${
        nextPlan
          ? `下一份可以接「${escapeHtml(nextPlan.p.meta.title)}」。`
          : "沒有其他進行中的計劃了。"
      }</p>`;
  }

  function renderMain() {
    const p = plans[idx];
    const hd = document.getElementById("plan-hd");
    const sum = document.getElementById("plan-summary");
    const steps = document.getElementById("step-list");
    if (!p) {
      if (hd) hd.textContent = "還沒選計劃";
      if (sum) sum.innerHTML = "";
      if (steps) steps.innerHTML = `<div class="tk-empty"><p>從左邊挑一份計劃。</p></div>`;
      return;
    }
    const pct = planProgressPct(p.meta);
    if (hd) hd.innerHTML = `<span class="mono">${escapeHtml(p.name)}</span>`;

    if (sum) {
      sum.innerHTML = `
        <h2 class="tk-title">${escapeHtml(p.meta.title)}</h2>
        <div class="tk-do">
          <p class="tk-do-k">現在該做什麼</p>
          ${nextActionHtml(p)}
        </div>
        <div class="tk-prog">
          <div class="tk-bar"><i style="width:${pct}%"></i></div>
          <p class="tk-prog-m">
            <strong>${p.meta.done_steps}/${p.meta.total_steps}</strong> 完成
            ${p.meta.skipped_steps ? ` · 跳過 ${p.meta.skipped_steps}` : ""}
            · 更新 ${escapeHtml(p.meta.updated)}
          </p>
        </div>
      `;
    }

    if (steps) {
      if (!p.meta.steps.length) {
        steps.innerHTML = `<div class="tk-empty">
          <p>這個檔案沒有 <code>## Plan Steps</code> 區段，所以算不出進度。</p>
          <p class="tk-empty-how">格式是這樣：</p>
          <pre class="tk-code"><code>## Plan Steps
- [ ] 第一步
- [x] 已完成的那一步</code></pre>
        </div>`;
      } else {
        // 未完成的排前面：要動手的事不該混在一堆勾好的後面往下找
        const order = { pending: 0, skipped: 1, done: 2 } as const;
        const sorted = p.meta.steps
          .map((s, n) => ({ s, n }))
          .sort((a, b) => order[a.s.state] - order[b.s.state] || a.n - b.n);
        steps.innerHTML = sorted
          .map(
            ({ s }) => `<div class="tk-step ${s.state}">
              <span class="tk-step-mark" aria-hidden="true"></span>
              <span class="tk-step-t">${escapeHtml(s.text)}</span>
            </div>`,
          )
          .join("");
      }
    }
  }

  /**
   * 結構檢查。
   *
   * 原本一次列 7 條（1 BLOCK + 4 WARN + 2 PASS）。同時要記住七件事已經超過
   * 工作記憶能扛的量，而且 PASS 是「不用做的事」—— 把它排在待處理項目旁邊
   * 只會稀釋注意力。改成：只展開最該先處理的那一條，其餘收起來；PASS 不列。
   */
  function renderGates() {
    const el = document.getElementById("gate-panel");
    if (!el) return;
    const report = evaluatePrdGates(store.get());
    const foot = document.getElementById("tui-footer");
    if (foot) {
      const tracked = plans.find((p) => p.path === trackingPath);
      const liveLine = !live
        ? "靜態快照 · 桌面版才能即時追蹤"
        : tracked
          ? `追蹤中 · ${tracked.name}`
          : "等待 agent 開始執行…";
      foot.innerHTML = `<span>${escapeHtml(gateSummaryLine(report))}</span>
        <span class="tk-foot-sp"></span>
        <span class="tk-keys"><kbd>j</kbd><kbd>k</kbd> 切計劃　<kbd>t</kbd> 跳到追蹤中</span>
        <span class="tk-foot-live">${escapeHtml(liveLine)}</span>`;
    }

    const actionable = report.findings.filter((f) => f.level !== "pass");
    if (!actionable.length) {
      el.innerHTML = `<div class="tk-gate-ok">結構檢查全部通過。</div>`;
      return;
    }
    const [first, ...rest] = actionable.sort((a, b) =>
      a.level === b.level ? 0 : a.level === "block" ? -1 : 1,
    );
    const card = (f: (typeof actionable)[number]) => `<div class="tk-gate tk-gate--${f.level}">
      <p class="tk-gate-lv">${f.level === "block" ? "先處理" : "該處理"}</p>
      <p class="tk-gate-t">${escapeHtml(f.label)}</p>
      <p class="tk-gate-d">${escapeHtml(f.detail)}</p>
    </div>`;

    el.innerHTML = `${card(first)}${
      rest.length
        ? `<details class="tk-gate-rest"><summary>還有 ${rest.length} 項<span class="tk-count">${rest.length}</span></summary>${rest
            .map(card)
            .join("")}</details>`
        : ""
    }`;
  }

  /**
   * L1–L6 進度。三張空的中繼卡（目標／最近決策／阻塞）原本永遠佔著位置，
   * 內容多半是「—」。改成有值才畫。
   */
  function renderLayers() {
    const el = document.getElementById("layer-panel");
    if (!el) return;
    const hasPlan = plans.some((p) => p.meta.total_steps > 0);
    const layers = deriveFlowLayers(store.get(), { hasPlanSteps: hasPlan });
    el.innerHTML = `<div class="tk-layers">${layers
      .map(
        (l) =>
          `<div class="tk-layer${l.done ? " done" : l.active ? " active" : ""}" title="${escapeHtml(l.hint)}">
            <span class="tk-layer-c">${l.code}</span>
            <span class="tk-layer-n">${escapeHtml(l.name)}</span>
          </div>`,
      )
      .join("")}</div>`;

    const p = plans[idx];
    if (!p) return;
    const facts: [string, string][] = [];
    const goal = (p.meta.goal || "").trim();
    const dec = (p.meta.last_decision || "").trim();
    if (goal && goal !== "—") facts.push(["目標", goal]);
    if (dec && dec !== "—") facts.push(["最近決策", dec]);
    if (p.meta.blockers > 0) facts.push(["阻塞", `${p.meta.blockers} 項`]);
    if (!facts.length) return;
    el.innerHTML += `<dl class="tk-facts">${facts
      .map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`)
      .join("")}</dl>`;
  }

  /**
   * 稽核軌跡的三層。**預設停在第一層。**
   *
   * 一條無限捲動的事件流對 ADHD 使用者是注意力黑洞：進得去出不來，看完沒有產出。
   * 整理資料很爽，但那不是做事。所以時間軸要點兩下才到，而打開時看到的是
   * 「回到工作」三行——context recovery，不是稽核。兩個價值主張分開。
   */
  function renderAudit() {
    const el = document.getElementById("audit-panel");
    if (!el) return;
    const p = plans[idx];
    if (!p) {
      el.innerHTML = "";
      return;
    }

    const now = Date.now();
    const openTasks = p.meta.steps
      .filter((s) => s.state === "pending")
      .map((s) => ({ id: s.id, text: s.text }));
    const card = buildResumeCard(auditEvents, openTasks, now);
    const groups = todaySummary(auditEvents, now);

    const empty = !auditEvents.length;
    el.innerHTML = `<section class="tk-audit">
      <div class="tk-hd">稽核軌跡</div>

      <div class="tk-resume">
        <p class="tk-resume-a">上次動 ${escapeHtml(card.lastActive)}</p>
        <p class="tk-resume-b">${escapeHtml(card.lastDone)}</p>
        <p class="tk-resume-c">${escapeHtml(card.nextOpen)}</p>
      </div>

      ${
        empty
          ? `<p class="tk-audit-empty">還沒有事件。裝上 Claude Code hook 之後，agent 每次編輯都會留下一筆。
             <button type="button" class="btn btn-sm" id="btn-hook-snippet">複製安裝指令</button></p>`
          : `<details class="tk-audit-more">
              <summary>${escapeHtml(todayLine(groups))}</summary>
              <details class="tk-audit-timeline">
                <summary>完整時間軸（${auditEvents.length} 筆）</summary>
                <ul class="tk-timeline">${byNewest(auditEvents)
                  .slice(0, 200)
                  .map(
                    (e) =>
                      `<li><span class="mono">${escapeHtml(e.ts.slice(0, 16).replace("T", " "))}</span>
                       <b>${escapeHtml(kindLabel(e.kind))}</b>
                       <span class="muted">${escapeHtml(e.subject)}</span></li>`
                  )
                  .join("")}</ul>
                <p class="tk-audit-actions">
                  <button type="button" class="btn btn-sm" id="btn-export-md">匯出 Markdown</button>
                  <button type="button" class="btn btn-sm" id="btn-export-csv">匯出 CSV</button>
                  <button type="button" class="btn btn-sm" id="btn-export-replay">治理鏈 replay</button>
                </p>
              </details>
            </details>`
      }
    </section>`;

    document.getElementById("btn-hook-snippet")?.addEventListener("click", () => {
      // 只複製，不代寫 ~/.claude/settings.json —— 那是使用者的全域設定
      void navigator.clipboard?.writeText(hookInstallSnippet());
      toast("已複製。貼進 ~/.claude/settings.json 的 hooks 區段");
    });
    document.getElementById("btn-export-md")?.addEventListener("click", () => {
      download(`稽核軌跡-${p.name}.md`, exportMarkdown(filterForExport(auditEvents, {}), `稽核軌跡 · ${p.meta.title}`));
    });
    document.getElementById("btn-export-csv")?.addEventListener("click", () => {
      download(`稽核軌跡-${p.name}.csv`, exportCsv(filterForExport(auditEvents, {})));
    });
    // 治理鏈 replay：作品用。撰寫者族系從專案的 authorAgentFamily 來，
    // 職務分離違規會被標出來 —— 一條沒有標示違規的治理鏈沒有說服力。
    document.getElementById("btn-export-replay")?.addEventListener("click", () => {
      const st = store.get();
      const proj = st.projects.find((x) => x.id === st.activeProjectId);
      const r = buildReplay(auditEvents, `prd:${proj?.id ?? ""}`, proj?.authorAgentFamily ?? null, Date.now());
      download(`治理鏈-${p.name}.md`, replayMarkdown(r, `治理鏈 · ${proj ? proj.title : p.meta.title}`));
    });
  }

  function download(name: string, text: string) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    toast(`已匯出 ${name}`);
  }

  function render(force = false) {
    const sig = signature();
    if (!force && sig === lastSig) return;
    lastSig = sig;
    syncUser();
    renderList();
    renderMain();
    renderGates();
    renderLayers();
    renderAudit();
  }

  function select(i: number) {
    idx = Math.max(0, Math.min(plans.length - 1, i));
    selectedPath = plans[idx]?.path ?? "";
    render();
  }

  async function refresh(force = false) {
    await loadPlans();
    render(force);
  }

  document.getElementById("btn-refresh")?.addEventListener("click", () => {
    void refresh(true).then(() =>
      toast(live ? "已重新掃描各專案 plans/" : "靜態快照 · 桌面版才能即時追蹤"),
    );
  });

  document.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (t.matches("input, textarea, select")) return;
    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      select(idx + 1);
    }
    if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      select(idx - 1);
    }
    if (e.key === "r") {
      e.preventDefault();
      void refresh(true);
      toast("重新整理");
    }
    // 判定是自動的，呈現是手動的 —— 畫面永遠不自己跳去追蹤目標
    if (e.key === "t") {
      e.preventDefault();
      const i = plans.findIndex((p) => p.path === trackingPath);
      if (live && i >= 0) select(i);
      else toast(live ? "等待 agent 開始執行…" : "靜態快照 · 桌面版才能即時追蹤");
    }
    if (e.key === "?") {
      e.preventDefault();
      toast("j/k 切計劃 · t 跳到追蹤中 · r 重新整理 · 右欄為 PRD 結構 gate（送審阻擋用）");
    }
  });

  // ponytail: 只做 1 秒輪詢，不掛 fs watcher。mtime 重比較本來就得每秒做一次，
  // 畫面去重讓沒變化的那幾百次輪詢不產生任何 DOM 動作。瀏覽器沒有資料通道，不輪詢。
  if (canScanPlans()) window.setInterval(() => void refresh(), 1000);

  void refresh(true);
  store.subscribe(() => render(true));
}
