import { store } from "../data/store";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import { deriveFlowLayers } from "../lib/flow-layers";
import { initHelpOverlay } from "../lib/help-overlay";
import { evaluatePrdGates, gateSummaryLine } from "../lib/prd-gates";
import {
  ANCHOR_PREFIX,
  parsePlanMeta,
  planProgress,
  stripAnchor,
  type PlanMeta,
} from "../lib/plan-parser";
import { buildHandoff, type AgentFamilyId } from "../lib/agent-handoff";
import { initTheme } from "../lib/theme";
import { sortByRecency, trackingTarget } from "../lib/tracking";
import {
  canScanPlans,
  openspecRootsOf,
  plansDirsOf,
  requestTrackingScan,
} from "../lib/tracking-bridge";
import {
  escapeHtml,
  initMobileNav,
  toast,
  updateUserRailFooter,
} from "../lib/ui";
import { byNewest, dedupe, parseLog, type LogEvent } from "../lib/event-log";
import { hookInstallSnippet, logEvent } from "../lib/event-writer";
import { canEditFiles, readFile, writeFile } from "../lib/file-editor";
import { guardOf, safeApply, toggleStep } from "../lib/plan-writer";
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
import {
  isUatText,
  parseUatReport,
  setVerdict,
  uatProgress,
  UAT_VERDICTS,
  VERDICT_LABELS,
  VERDICT_NEEDS_NOTE,
  type UatItem,
  type UatReport,
  type UatVerdict,
} from "../lib/uat-parser";
import { UAT_HANDOFF_EVENT, UAT_QUERY_KEY } from "../lib/uat-handoff";

/** 壞行由 parseLog 跳過，不會毀掉整份。 */
let auditEvents: LogEvent[] = [];

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
  /**
   * 實測報告方言才有。Rust 掃描一律把 `plans/*.md` 標成 `kind: "plan"`，
   * 方言由前端的 `isUatText` 判 —— 掃描層不必知道有第三種方言，
   * 而「這份是不是 UAT」只看得出來的地方就是內文的 H1。
   */
  uat?: UatReport;
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

  /**
   * 事件的 subject（`anc:t=XXXX`）→ 那個步驟在 plan 裡的原文。
   *
   * 漂移偵測不靠比對，靠並排：把「計劃說要做什麼」與「實際做了什麼」擺在
   * 同一列，判斷交給讀的人。多數漂移是正當的（開始做 X、發現 Y 才對、於是
   * 做 Y），所以自動標紅會在多數情況下誤報，然後被學會忽略。
   *
   * 找遍所有計劃而不只是當前這份 —— 事件可能來自別份 plan 的步驟。
   */
  function stepTextOf(subject: string): string {
    const id = subject.replace(/^(?:anc|sf):t=/, "");
    if (id === subject) return "";
    for (const p of plans) {
      const hit = p.meta.steps.find((st) => st.id === id);
      if (hit) return hit.text;
      // 實測題也會被事件指到（`uat.verdict`）。少了這一段，時間軸上那些筆
      // 只剩一串錨點，讀的人不知道當初問的是什麼題目。
      const q = p.uat?.items.find((x) => x.id === id);
      if (q) return q.title;
    }
    return "";
  }

  /** 當前選取專案的名稱，給空狀態文案用。找不到就回空字串。 */
  function activeProjectName(): string {
    const st = store.get();
    const p = st.projects.find((x) => x.id === st.activeProjectId);
    // 與側欄同一套規則：自訂名優先，否則用 title（匯入時通常是資料夾名）。
    return p?.customName || p?.title || "";
  }

  /**
   * 讀不到任何東西時的狀態。
   *
   * 舊版會退回「本 repo 自己編譯進來的 plans」——那在別人的機器上是
   * 一份完全不相干的清單，看起來像功能其實是 bug。誠實的空清單比較好。
   */
  function loadEmpty() {
    plans = [];
    live = false;
    trackingPath = null;
    restoreIdx();
  }

  /** 活路徑：原生橋回報「當前選取專案」plans/ 的真實 mtime */
  async function loadLive(): Promise<boolean> {
    const st = store.get();
    const dirs = plansDirsOf(st.projects, st.activeProjectId);
    const osRoots = openspecRootsOf(st.projects, st.activeProjectId);
    // 選取的專案沒綁資料夾 —— 清單就該是空的，不是退回全部專案。
    // 這裡回 true（不是 false）：清空就是正確結果，已經收工了。回 false 會讓
    // `loadPlans()` 再跑一次 `loadEmpty()`，白做一輪。
    if (!dirs.length && !osRoots.length) {
      plans = [];
      live = false;
      trackingPath = null;
      restoreIdx();
      return true;
    }
    let scan;
    try {
      scan = await requestTrackingScan(dirs, osRoots);
    } catch {
      // 橋壞了／逾時。呼叫端會 `loadEmpty()` —— 沒有靜態快照可退，本 repo 自己的
      // plans/ 不屬於當前專案，拿來墊只會顯示別人的進度。空清單才是誠實的。
      return false;
    }
    if (!scan.files.length) return false;

    plans = sortByRecency(
      scan.files.map((f) => {
        // UAT 是唯一由前端判的方言：它跟 plan 住在同一個目錄、同一個副檔名，
        // 分辨得出來的只有內文。openspec 的 tasks.md 不可能是 UAT，先排除，
        // 省掉對每份 tasks.md 都跑一次判別。
        //
        // 檔名 `uat-` 開頭也算：實測發現手寫的實測檔常常只有檔名對、H1 沒有
        // `# UAT:` 前綴（2026-08-14 Border Loom 那份表格版就是）。把它當普通
        // plan 顯示會引導人去加 Plan Steps —— 錯的方向；歸進實測報告分組，
        // 空狀態才有機會教正確的方言。
        const uat =
          f.kind !== "openspec" && (isUatText(f.text) || /^uat-/i.test(f.name))
            ? parseUatReport(f.text, f.path)
            : undefined;
        return {
          id: f.path,
          name: f.name,
          path: f.path,
          mtimeMs: f.mtimeMs,
          raw: f.text,
          // 方言由 Rust 端標好帶過來，前端不再用路徑猜一次
          meta: parsePlanMeta(f.text, f.name, { dialect: f.kind ?? "plan", change: f.change }),
          ...(uat ? { uat } : {}),
        };
      }),
    );
    live = true;
    // 每次重繪重算，不快取 —— 快取只會製造「追蹤點卡住不動」這類 bug
    trackingPath = trackingTarget(
      { files: plans, signal: scan.signal },
      Date.now(),
    );
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
    loadEmpty();
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
  type Group = {
    key: string;
    label: string;
    items: { p: PlanEntry; i: number }[];
    open: boolean;
  };

  function groupPlans(): Group[] {
    const uat: Group["items"] = [];
    const tracked: Group["items"] = [];
    const active: Group["items"] = [];
    const done: Group["items"] = [];
    const noSteps: Group["items"] = [];
    plans.forEach((p, i) => {
      const entry = { p, i };
      // 實測報告自成一組，而且排在最上面。它們是**等人動手**的東西，
      // 混進「進行中」會跟一堆等 agent 動手的計劃長得一樣重要。
      // 也不進「agent 正在寫」那一桶 —— 剛被寫出來的報告確實是最新的檔，
      // 但那一桶的語意是「別碰，agent 在動」，對實測報告剛好是相反的指示。
      if (p.uat) {
        // 三種去向：可勾且沒測完 → 最上面等人動手；測完 → 已結束（做完的事
        // 霸著最顯眼的位置，會把「等你動手」稀釋成「一疊做完的」）；
        // 一題錨點都沒有（遺留表格版之類）→「沒有步驟的檔案」——它不可操作，
        // 釘在最高優先組只是一份關不掉的幽靈報告。
        const anchored = p.uat.items.some((x) => x.id);
        if (!anchored) noSteps.push(entry);
        else if (p.uat.status === "已完成") done.push(entry);
        else uat.push(entry);
      } else if (live && p.path === trackingPath) tracked.push(entry);
      else if (p.meta.total_steps === 0) noSteps.push(entry);
      // 分桶要跟進度條同源。用 done_steps 的話，有放棄步驟的 plan 進度條到 100%
      // 卻永遠留在「進行中」——同一張卡上兩個地方說反話。
      else if (planProgress(p.meta).closed >= p.meta.total_steps)
        done.push(entry);
      else active.push(entry);
    });
    return [
      { key: "uat", label: "實測報告", items: uat, open: true },
      { key: "tracked", label: "agent 正在寫", items: tracked, open: true },
      { key: "active", label: "進行中", items: active, open: true },
      // 「已結束」而非「已完成」：這桶也收全部放棄的 plan，說完成就是在騙人
      { key: "done", label: "已結束", items: done, open: done.length <= 4 },
      { key: "none", label: "沒有步驟的檔案", items: noSteps, open: false },
    ].filter((g) => g.items.length);
  }

  function planRow({ p, i }: { p: PlanEntry; i: number }): string {
    // 進度的分子分母跟中欄同源：UAT 走 uatProgress（已結 = 任何非未測的結果），
    // plan 走 planProgress。在這裡自己數一次是進度條說反話的經典來源。
    const prog = p.uat ? uatProgress(p.uat) : planProgress(p.meta);
    const total = p.uat ? p.uat.items.length : p.meta.total_steps;
    const pct = prog.pct;
    const isTracked = live && p.path === trackingPath;
    // OpenSpec 的檔案全部叫 tasks.md，清單上靠標題（變更代號）區分還不夠 ——
    // 標一下來源，才知道勾選會寫回哪一個工具管的檔案
    const src = p.uat
      ? `<span class="tk-row-src">實測</span>`
      : p.meta.dialect === "openspec"
        ? `<span class="tk-row-src">OpenSpec</span>`
        : "";
    const title = p.uat ? p.uat.title : p.meta.title;
    return `<button type="button" class="tk-row${i === idx ? " on" : ""}${isTracked ? " tracked" : ""}" data-i="${i}">
      <span class="tk-row-t">${escapeHtml(title)}${src}</span>
      <span class="tk-row-m">
        ${
          total
            ? `<span class="tk-mini"><i style="width:${pct}%"></i></span><span class="tk-num">${prog.closed}/${prog.total}</span>`
            : `<span class="tk-num tk-num--none">${p.uat ? "沒有題目" : "沒有步驟"}</span>`
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

  /**
   * 四顆結果鈕。**從詞彙表減掉 `pending` 得來，不另外手寫一份** ——
   * `pending`（未測）是初始態不是選項，而重抄一份清單的代價是詞彙表增修時
   * 按鈕不會跟著長，UI 與檔案格式就開始各說各話。
   */
  const VERDICT_BUTTONS = UAT_VERDICTS.filter((v) => v !== "pending");

  /** 「失敗、不測」這串字從規則本身長出來，不是文案裡寫死的。 */
  const NEEDS_NOTE_HINT = [...VERDICT_NEEDS_NOTE]
    .map((v) => VERDICT_LABELS[v])
    .join("、");

  /** `**最後更新：**` 用的時間戳。格式對齊 `plans/` 既有檔：本地時間、到分鐘。 */
  function nowStamp(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /** 讀某一題說明欄當下的值（可能還沒存）。找不到那張卡就當空字串。 */
  function noteValueOf(id: string): string {
    return (
      document.querySelector<HTMLTextAreaElement>(
        `textarea[data-note="${CSS.escape(id)}"]`,
      )?.value ?? ""
    );
  }

  /**
   * 把擋存的原因放在被擋的那一題旁邊。**不用 toast。**
   *
   * toast 會在幾秒後消失，而且不會說是哪一題 —— 一份 12 題的報告裡，
   * 「必須寫原因」這句話沒有位置資訊等於沒說。
   */
  function showItemError(id: string, msg: string) {
    const el = document.querySelector<HTMLElement>(
      `[data-err="${CSS.escape(id)}"]`,
    );
    if (!el) {
      // 卡片已經被重繪掉了。至少要說出來，不要靜靜地什麼都沒發生
      toast(msg);
      return;
    }
    el.textContent = msg;
    el.classList.add("on");
  }

  /**
   * 「現在該做什麼」的實測報告版。
   *
   * 全部測完不是終點：**失敗題才是這份報告真正的產出**，所以測完之後
   * 這一格要指向那幾題，而不是恭喜一句就沒了。
   */
  function nextUatHtml(r: UatReport): string {
    if (!r.items.length) {
      return `<p class="tk-do-what">這份報告沒有題目</p>
        <p class="tk-do-why">每一題是一個 <code>## </code> 區段，帶 <code>anc:t=</code> 錨點。用 Uat skill 重新出題會產生正確的格式。</p>`;
    }
    const pending = r.items.find((x) => x.verdict === "pending");
    if (pending) {
      return `<p class="tk-do-what">${escapeHtml(pending.title)}</p>
        <p class="tk-do-why">這是第一題還沒測的。照著流程做一次，再回來選結果。</p>`;
    }
    const failed = r.items.filter((x) => x.verdict === "fail").length;
    if (failed) {
      return `<p class="tk-do-what">全部測完，其中 ${failed} 題失敗</p>
        <p class="tk-do-why">失敗題的說明就是修復工單的起點 —— 交給 agent 時把那幾段一起帶上。</p>`;
    }
    return `<p class="tk-do-what tk-do-clear">全部測完，沒有失敗</p>
      <p class="tk-do-why">結果已經寫回這份 markdown，agent 直接讀得到。</p>`;
  }

  /** 一題一張卡。沒有錨點的題勾不了 —— 跟 plan 步驟同一條規矩。 */
  function uatCard(it: UatItem): string {
    const editable = canEditFiles();
    const body = [
      it.steps.length
        ? `<p class="tk-uat-k">流程</p>
           <ol class="tk-uat-steps">${it.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>`
        : "",
      it.expected
        ? `<p class="tk-uat-k">預期</p><p class="tk-uat-exp">${escapeHtml(it.expected)}</p>`
        : "",
    ].join("");

    // 沒有錨點 = 寫回時定位不到那一行，也接不上事件流。UI 直接反映這個限制，
    // 而不是給一顆按下去沒反應的鈕。
    if (!it.id) {
      return `<article class="tk-uat">
        <header class="tk-uat-hd">
          <h3 class="tk-uat-t">${escapeHtml(it.title)}</h3>
          <span class="tk-uat-tag tk-v--${it.verdict}">${VERDICT_LABELS[it.verdict]}</span>
        </header>
        ${body}
        <p class="tk-uat-warn">這一題沒有 <code>anc:t=</code> 錨點，勾了沒有地方可以寫回去。請讓出題的 agent 重出一份報告。</p>
      </article>`;
    }

    const id = escapeHtml(it.id);
    const acts = VERDICT_BUTTONS.map(
      (v) =>
        `<button type="button" class="tk-vb tk-vb--${v}${it.verdict === v ? " on" : ""}"
           data-verdict="${v}" data-item="${id}" aria-pressed="${it.verdict === v}"${editable ? "" : " disabled"}
         >${VERDICT_LABELS[v]}</button>`,
    ).join("");

    return `<article class="tk-uat${it.verdict === "pending" ? "" : " closed"}">
      <header class="tk-uat-hd">
        <h3 class="tk-uat-t">${escapeHtml(it.title)}</h3>
        <span class="tk-uat-tag tk-v--${it.verdict}">${VERDICT_LABELS[it.verdict]}</span>
      </header>
      ${body}
      <div class="tk-uat-acts" role="group" aria-label="結果">${acts}</div>
      <label class="tk-uat-note">
        <span class="tk-uat-k">說明<em>（${NEEDS_NOTE_HINT}必填）</em></span>
        <textarea data-note="${id}" rows="2" placeholder="測不過的話，寫下看到什麼、跟預期差在哪"${editable ? "" : " disabled"}>${escapeHtml(it.note)}</textarea>
      </label>
      <p class="tk-uat-err" data-err="${id}" role="alert"></p>
    </article>`;
  }

  /**
   * 實測報告的中欄。**換一整套渲染器，不是在 plan 那套上加 if。**
   *
   * plan 的步驟是兩態 checkbox，UAT 一題是五態外加一格自由文字。把兩者塞進
   * 同一個渲染器，結果會是兩邊都長出對方的分支，然後沒有人敢動它。
   */
  function renderUat(r: UatReport, sum: HTMLElement | null, steps: HTMLElement | null) {
    const prog = uatProgress(r);
    if (sum) {
      sum.innerHTML = `
        <h2 class="tk-title">${escapeHtml(r.title)}</h2>
        <div class="tk-do">
          <p class="tk-do-k">現在該做什麼</p>
          ${nextUatHtml(r)}
        </div>
        <div class="tk-prog">
          <div class="tk-bar"><i style="width:${prog.pct}%"></i></div>
          <p class="tk-prog-m">
            <strong>${prog.closed}/${prog.total}</strong> 已結
            · 更新 ${escapeHtml(r.updated)}
          </p>
        </div>
        ${
          r.unanchored && r.items.some((x) => x.id)
            ? `<p class="tk-uat-warn">有 ${r.unanchored} 題沒有錨點，那些題勾不了。</p>`
            : ""
        }
        ${
          canEditFiles()
            ? ""
            : `<p class="tk-uat-warn">瀏覽器只能看。勾選要寫回 <code>plans/</code> 底下的檔案，那需要桌面版。</p>`
        }
      `;
    }
    if (!steps) return;
    // 「沒有題目」與「有題但全部沒錨點」走同一條路：後者一題都勾不了，
    // 渲染九張不可操作的卡（附九個警告）不如直接教正確格式。
    if (!r.items.some((x) => x.id)) {
      steps.innerHTML = `<div class="tk-empty">
        <p>${r.items.length ? "這份檔案不是實測方言，題目讀不出錨點，勾不了。" : "這份實測報告沒有題目。"}</p>
        <p class="tk-empty-how">格式是這樣：</p>
        <pre class="tk-code"><code>## T1 單頁結帳成功路徑 &lt;!-- anc:t=XXXX --&gt;

**流程：**
1. 開 app，加入任一商品

**預期：**
3 秒內顯示成功頁

**結果：** 未測

**說明：**
（無）</code></pre>
      </div>`;
      return;
    }

    // 未測的排前面：要動手的事不該混在一堆已結的後面往下找。與 plan 步驟同一條規矩。
    const sorted = r.items
      .map((it, n) => ({ it, n }))
      .sort(
        (a, b) =>
          Number(a.it.verdict !== "pending") - Number(b.it.verdict !== "pending") ||
          a.n - b.n,
      );
    steps.innerHTML = sorted.map(({ it }) => uatCard(it)).join("");

    steps.querySelectorAll<HTMLButtonElement>("[data-verdict]").forEach((btn) => {
      // 按結果鈕不奪走 textarea 焦點。否則「打完原因直接按失敗」會先觸發
      // blur 寫入、再觸發 click 寫入 —— 兩次寫共用同一份 guard 快照，
      // 後到的那次（正是使用者要的結果）被當成陳舊寫入擋掉（Cato F1）。
      // 擋掉 blur 之後，click 這一路就是唯一寫入者。
      btn.onmousedown = (e) => e.preventDefault();
      btn.onclick = () => {
        const id = btn.dataset.item!;
        // 說明從畫面上讀，不是從 r 讀 —— 使用者很可能剛打完原因就直接按「失敗」，
        // 那段字還沒經過 blur 存回去
        void onSetVerdict(id, btn.dataset.verdict as UatVerdict, noteValueOf(id));
      };
    });

    steps
      .querySelectorAll<HTMLTextAreaElement>("textarea[data-note]")
      .forEach((ta) => {
        const original = ta.value;
        ta.onblur = () => {
          // 只在真的改過時寫回。每次失焦都寫一次的話，「點進去看一眼」也會動到
          // mtime，把這份報告一路推上 live tracking 的追蹤位。
          if (ta.value === original) return;
          const it = r.items.find((x) => x.id === ta.dataset.note);
          if (!it?.id) return;
          void onSetVerdict(it.id, it.verdict, ta.value);
        };
      });
  }

  function renderMain() {
    const p = plans[idx];
    const hd = document.getElementById("plan-hd");
    const sum = document.getElementById("plan-summary");
    const steps = document.getElementById("step-list");
    if (!p) {
      if (hd) hd.textContent = "還沒選計劃";
      if (sum) sum.innerHTML = "";
      if (steps)
        steps.innerHTML = `<div class="tk-empty"><p>從左邊挑一份計劃。</p></div>`;
      return;
    }
    if (hd) hd.innerHTML = `<span class="mono">${escapeHtml(p.name)}</span>`;
    if (p.uat) {
      renderUat(p.uat, sum, steps);
      return;
    }

    const prog = planProgress(p.meta);
    const pct = prog.pct;

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
            <strong>${prog.closed}/${prog.total}</strong> 已結
            ${p.meta.skipped_steps ? ` · 其中跳過 ${p.meta.skipped_steps}` : ""}
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
        const isOs = p.meta.dialect === "openspec";
        let lastGroup = "";
        steps.innerHTML = sorted
          .map(({ s }) => {
            // OpenSpec 的 `## N. <群組>` 是它的分段方式，攤平成一長條會讓
            // 「1.1 / 2.3 / 3.5」這種編號失去脈絡。排序後同群的會散開，
            // 所以只在群組換人時插一行標題。
            const head =
              isOs && s.group && s.group !== lastGroup
                ? ((lastGroup = s.group), `<div class="tk-step-group">${escapeHtml(s.group)}</div>`)
                : "";
            // 有錨點才能勾 —— 沒有 id 就沒有辦法在寫回時定位到那一行，
            // 也接不上事件流。UI 直接反映這個限制，而不是勾了沒反應。
            const can =
              Boolean(s.id) && s.state !== "skipped" && canEditFiles();
            const mark = can
              ? `<button type="button" class="tk-step-mark tk-step-toggle" data-step="${escapeHtml(s.id!)}" data-done="${s.state === "done" ? "1" : "0"}" aria-label="${s.state === "done" ? "取消勾選" : "標記完成"}"></button>`
              : `<span class="tk-step-mark" aria-hidden="true"></span>`;
            // 交接鍵只出現在還沒做完、而且有錨點的步驟上。沒有錨點的話交出去
            // 也串不回來，給一個做不到事的按鈕比不給更糟。
            // OpenSpec 的步驟沒有錨點（編號不是 join key），交出去串不回來，
            // 所以不給交接鍵 —— 給一個做不到事的按鈕比不給更糟。
            const handoff =
              !isOs && s.id && s.state === "pending"
                ? `<button type="button" class="tk-step-handoff" data-handoff="${escapeHtml(s.id)}"
                     title="複製交接指令（含錨點 ${escapeHtml(s.id)}）">交接</button>`
                : "";
            return `${head}<div class="tk-step ${s.state}">
              ${mark}
              ${isOs && s.id ? `<span class="tk-step-no mono">${escapeHtml(s.id)}</span>` : ""}
              <span class="tk-step-t">${escapeHtml(s.text)}</span>
              ${handoff}
            </div>`;
          })
          .join("");

        steps
          .querySelectorAll<HTMLButtonElement>(".tk-step-toggle")
          .forEach((btn) => {
            btn.onclick = () =>
              void onToggleStep(btn.dataset.step!, btn.dataset.done !== "1");
          });
        steps
          .querySelectorAll<HTMLButtonElement>(".tk-step-handoff")
          .forEach((btn) => {
            btn.onclick = () => void onHandoffStep(btn.dataset.handoff!);
          });
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
    const report = evaluatePrdGates(store.get(), store.activeGateSpec());
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
    const card = (
      f: (typeof actionable)[number],
    ) => `<div class="tk-gate tk-gate--${f.level}">
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
    const layers = deriveFlowLayers(store.get(), {
      hasPlanSteps: hasPlan,
      gateSpec: store.activeGateSpec(),
    });
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
      .map(
        ([k, v]) =>
          `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`,
      )
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
                  .map((e) => {
                    // 步驟原文擺在事件旁邊。**這是漂移唯一看得見的地方。**
                    // 只顯示 subject 的話，讀的人不知道那個步驟當初說要做什麼，
                    // 就算「plan 寫 A、commit 做 B」擺在眼前也認不出來。
                    // 兩行並排，人眼半秒就分辨得出 —— 不需要模型，不會誤報。
                    const step = stepTextOf(e.subject);
                    const did = String(e.payload?.title ?? "");
                    return `<li><span class="mono">${escapeHtml(e.ts.slice(0, 16).replace("T", " "))}</span>
                       <b>${escapeHtml(kindLabel(e.kind))}</b>
                       <span class="muted">${escapeHtml(e.subject)}</span>
                       ${step ? `<span class="tk-tl-plan" title="plan 步驟原文">計劃：${escapeHtml(step)}</span>` : ""}
                       ${did ? `<span class="tk-tl-did" title="實際發生的事">實際：${escapeHtml(did)}</span>` : ""}</li>`;
                  })
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

    document
      .getElementById("btn-hook-snippet")
      ?.addEventListener("click", () => {
        // 只複製，不代寫 ~/.claude/settings.json —— 那是使用者的全域設定
        void navigator.clipboard?.writeText(hookInstallSnippet());
        toast("已複製。貼進 ~/.claude/settings.json 的 hooks 區段");
      });
    document.getElementById("btn-export-md")?.addEventListener("click", () => {
      download(
        `稽核軌跡-${p.name}.md`,
        exportMarkdown(
          filterForExport(auditEvents, {}),
          `稽核軌跡 · ${p.meta.title}`,
        ),
      );
    });
    document.getElementById("btn-export-csv")?.addEventListener("click", () => {
      download(
        `稽核軌跡-${p.name}.csv`,
        exportCsv(filterForExport(auditEvents, {})),
      );
    });
    // 治理鏈 replay：作品用。撰寫者族系從專案的 authorAgentFamily 來，
    // 職務分離違規會被標出來 —— 一條沒有標示違規的治理鏈沒有說服力。
    document
      .getElementById("btn-export-replay")
      ?.addEventListener("click", () => {
        const st = store.get();
        const proj = st.projects.find((x) => x.id === st.activeProjectId);
        const r = buildReplay(
          auditEvents,
          `prd:${proj?.id ?? ""}`,
          proj?.authorAgentFamily ?? null,
          Date.now(),
        );
        download(
          `治理鏈-${p.name}.md`,
          replayMarkdown(r, `治理鏈 · ${proj ? proj.title : p.meta.title}`),
        );
      });
  }

  function download(name: string, text: string) {
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    toast(`已匯出 ${name}`);
  }

  /**
   * 勾／取消勾一個步驟。
   *
   * **每一次都重讀磁碟再比對**（`safeApply`）。agent 可能正在重寫同一份 plan，
   * 而整檔覆寫吃掉它剛寫的東西是不會有錯誤訊息的 —— 那比功能沒做更糟。
   */
  /**
   * 把一個步驟交接給 agent。**只複製指令，不執行。**
   *
   * 這是 `agent-handoff.ts` 檔頭那條界線的實作：要從 App 派工，就得讓原生端
   * 執行前端傳來的任意字串，而 `exec.rs` 全檔的安全模型建立在相反的前提上。
   * 成本是多一次貼上，換來的是攻擊面為零。
   *
   * 錨點跟著指令一起走 —— 那是這顆按鈕存在的理由。agent 把它寫進 commit
   * 訊息之後，回填的事件才掛得回這一行 plan 步驟。
   */
  async function onHandoffStep(id: string) {
    const p = plans[idx];
    const step = p?.meta.steps.find((s) => s.id === id);
    const st = store.get();
    const proj = st.projects.find((x) => x.id === st.activeProjectId);
    const root = proj?.importSummary?.rootPath;
    if (!step || !root) {
      toast("這個專案還沒綁定資料夾，交接指令需要專案路徑");
      return;
    }

    const { command, blocked } = buildHandoff({
      projectRoot: root,
      task: stripAnchor(step.text),
      // 交給誰由使用者的預設族系決定；擋同族核准的規則在 buildHandoff 裡。
      family: (proj.authorAgentFamily as AgentFamilyId) ?? "claude",
      authorFamily: proj.authorAgentFamily ?? null,
      anchor: id,
    });
    if (blocked) {
      toast(blocked);
      return;
    }

    try {
      await navigator.clipboard.writeText(command);
      toast(`交接指令已複製（錨點 ${id}）。貼進終端前先看一眼。`);
    } catch {
      // 剪貼簿被拒是常見的（權限、非安全來源）。不要吞掉 —— 使用者會以為
      // 複製成功然後貼到一個空的東西。
      toast("複製失敗，請手動從主控台取得指令");
      console.log(command);
    }
  }

  async function onToggleStep(id: string, done: boolean) {
    const p = plans[idx];
    if (!p) return;
    const guard = guardOf(p.path, p.raw);
    const r = await safeApply(guard, (text) => toggleStep(text, id, done, p.meta.dialect), {
      read: readFile,
      write: writeFile,
    });
    if (!r.ok) {
      toast(r.reason);
      await refresh(true); // 衝突時把畫面拉回磁碟現況，不要停在舊的
      return;
    }
    // 寫成功才記事件。順序反過來的話，log 會有一筆沒發生的事
    const st = store.get();
    const proj = st.projects.find((x) => x.id === st.activeProjectId);
    const root = proj?.importSummary?.rootPath;
    if (root && done) {
      const u = st.currentUser;
      logEvent(root, {
        project: proj!.id,
        actor: {
          kind: u.kind === "agent" ? "agent" : "human",
          family: u.agentFamily ?? null,
          name: u.name,
        },
        kind: "task.done",
        // openspec 的編號不是錨點，寫成 `anc:t=1.1` 會讓事件流以為那是 join key，
        // 之後任何依錨點聚合的查詢都會把它跟真正的步驟混在一起
        subject:
          p.meta.dialect === "openspec"
            ? `openspec:${p.meta.title}/${id}`
            : `${ANCHOR_PREFIX}:t=${id}`,
        payload: { title: p.meta.steps.find((s) => s.id === id)?.text ?? "" },
      });
    }
    await refresh(true);
  }

  /**
   * 寫回一題的實測結果。
   *
   * 與 `onToggleStep` 同一條路徑（guardOf → safeApply → logEvent），三處不同：
   *
   * 1. mutate 換成 `setVerdict`（它自己執法「失敗／不測必填說明」）
   * 2. 被必填規則擋下時**不重新整理** —— 重載會把使用者剛打到一半的說明沖掉，
   *    而那正是他被要求補的東西
   * 3. 訊息落在那一題旁邊，不是 toast。只有真的併發衝突才用 toast，
   *    因為那是整份檔的事，不是某一題的事
   */
  async function onSetVerdict(id: string, verdict: UatVerdict, note: string) {
    const p = plans[idx];
    if (!p?.uat) return;
    const before = p.uat.items.find((x) => x.id === id);

    // UI 先擋一次，不用等一趟磁碟往返才知道說明沒填。**訊息跟判定都從 parser 拿**，
    // 不在這裡再寫一份規則 —— 兩份會在規則改動時各自漂移，而漂移的那一份
    // 通常是 UI，症狀是「按了說可以，存下去卻被拒絕」。
    // setVerdict 是純函式，對一份幾 KB 的報告多跑一次的成本是零。
    const dry = setVerdict(p.raw, id, verdict, note);
    if (!dry.ok) {
      showItemError(id, dry.reason);
      return;
    }

    // safeApply 對 mutate 回 null 只有一句寫死的 plan 專用訊息（「找不到
    // ## Plan Steps 區段」），那對實測報告是錯的。真正的原因用閉包帶出來。
    let blocked = "";
    const guard = guardOf(p.path, p.raw);
    const r = await safeApply(
      guard,
      (text) => {
        const res = setVerdict(text, id, verdict, note, { now: nowStamp() });
        if (!res.ok) {
          blocked = res.reason;
          return null;
        }
        return res.text;
      },
      { read: readFile, write: writeFile },
    );
    if (!r.ok) {
      if (blocked) {
        showItemError(id, blocked);
        return;
      }
      toast(r.reason);
      await refresh(true); // 衝突時把畫面拉回磁碟現況，不要停在舊的
      return;
    }

    // 寫成功才記事件。順序反過來的話，log 會有一筆沒發生的事
    const st = store.get();
    const proj = st.projects.find((x) => x.id === st.activeProjectId);
    const root = proj?.importSummary?.rootPath;
    if (root) {
      const u = st.currentUser;
      const actor = {
        kind: u.kind === "agent" ? ("agent" as const) : ("human" as const),
        family: u.agentFamily ?? null,
        name: u.name,
      };
      logEvent(root, {
        project: proj!.id,
        actor,
        kind: "uat.verdict",
        subject: `${ANCHOR_PREFIX}:t=${id}`,
        // **說明欄不進 payload。** 那是自由文字，而稽核軌跡是 append-only：
        // 寫進去就刪不掉了。結果詞是五選一的固定字彙，那個可以記。
        payload: { title: before?.title ?? "", verdict: VERDICT_LABELS[verdict] },
      });
      // 報告層級只在「這一次把它推成已完成」時記一筆。每次勾都判一次的話，
      // 一份已經測完的報告，之後每改一題結果都會再記一筆「完成」。
      const after = parseUatReport(r.text, p.path);
      if (after.status === "已完成" && p.uat.status !== "已完成") {
        const done = uatProgress(after);
        logEvent(root, {
          project: proj!.id,
          actor,
          kind: "uat.report.done",
          // 報告不是一個錨點，它是一個檔。形狀對齊 openspec 那條
          // （`openspec:<標題>/<編號>`）—— 前綴講清楚這個 join key 是哪一種。
          subject: `uat:${p.name}`,
          payload: { title: after.title, count: done.total, pct: done.pct },
        });
      }
    }
    await refresh(true);
  }

  /**
   * 說明欄正在打字時不要重畫。
   *
   * 每秒輪詢一有變化就重建 DOM，而重建等於把還沒存的字吃掉 —— 使用者不會
   * 知道發生了什麼，只會看到自己打的東西消失。只擋輪詢那一路（`force` 為假），
   * 存檔後的強制重繪仍然要跑，否則結果不會更新。
   */
  function isEditingNote(): boolean {
    const a = document.activeElement;
    return a instanceof HTMLTextAreaElement && a.hasAttribute("data-note");
  }

  function render(force = false) {
    const sig = signature();
    if (!force && (sig === lastSig || isEditingNote())) return;
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

  /**
   * 喚醒鏈的著陸點：`tracking.html?uat=<報告路徑>`。
   *
   * **不是「找不到就算了」。** CLI 剛寫好的檔不一定已經在掃描結果裡 —— 掃描
   * 每秒一次，而 App 很可能是被 `open -a` 冷啟動的，第一輪掃描甚至還沒跑。
   * 所以等它出現，等到就選中，有上限。
   *
   * 等不到一定要說出來。導了頁卻什麼都沒發生，使用者不會去想「大概不在這個
   * 專案的 plans/ 裡」，他只會覺得這個功能壞了。
   */
  const UAT_LANDING_MS = 8000;
  let pendingUat: { path: string; until: number } | null = null;

  function clearUatQuery() {
    const u = new URL(location.href);
    if (!u.searchParams.has(UAT_QUERY_KEY)) return;
    // 參數只用一次：留著的話，重新整理會再選中一次那份可能早就看完的報告
    u.searchParams.delete(UAT_QUERY_KEY);
    history.replaceState(null, "", `${u.pathname}${u.search}${u.hash}`);
  }

  function consumePendingUat() {
    if (!pendingUat) return;
    const want = pendingUat.path;
    const base = want.split("/").pop() ?? want;
    // 先比完整路徑，比不到再比檔名。CLI 給的路徑與 Rust 掃描回來的路徑可能
    // 一個走了 symlink 一個沒走（`/tmp` 與 `/private/tmp` 是最常見的一對），
    // 而嚴格比對的失敗模式是「靜靜地什麼都沒選中」—— 那是這裡最不能接受的結果。
    let i = plans.findIndex((p) => p.path === want);
    if (i < 0) i = plans.findIndex((p) => p.name === base);
    if (i >= 0) {
      pendingUat = null;
      clearUatQuery();
      select(i);
      return;
    }
    if (!canScanPlans()) {
      // 瀏覽器沒有資料通道，再等下去也不會有東西 —— 不要讓它空轉到逾時
      pendingUat = null;
      clearUatQuery();
      toast("瀏覽器讀不到磁碟，實測報告要用桌面版才打得開");
      return;
    }
    if (Date.now() > pendingUat.until) {
      pendingUat = null;
      clearUatQuery();
      toast(`這份實測報告不在目前專案的 plans/ 裡：${base}`);
    }
  }

  async function refresh(force = false) {
    await loadPlans();
    consumePendingUat();
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
      else
        toast(live ? "等待 agent 開始執行…" : "靜態快照 · 桌面版才能即時追蹤");
    }
    if (e.key === "?") {
      e.preventDefault();
      toast(
        "j/k 切計劃 · t 跳到追蹤中 · r 重新整理 · 右欄為 PRD 結構 gate（送審阻擋用）",
      );
    }
  });

  /**
   * 交件對齊專案。掃描只看「當前選取的專案」，報告卻可能屬於任何一個已匯入
   * 專案 —— 多專案交替開發時這是常態不是例外。路徑前綴對得到就直接切過去；
   * 對不到就立刻講清楚缺哪個資料夾，不要讓人白等 8 秒換一句沒出路的 toast。
   */
  function alignProjectForUat(path: string): boolean {
    const st = store.get();
    const hit = st.projects.find((p) => {
      const root = (p.importSummary?.rootPath ?? "").replace(/\/+$/, "");
      return root && path.startsWith(`${root}/`);
    });
    if (hit) {
      if (hit.id !== st.activeProjectId) {
        store.setActiveProject(hit.id);
        toast(`已切換到專案「${hit.customName || hit.title || "未命名"}」`);
      }
      return true;
    }
    const dir = path.replace(/\/plans\/[^/]+$/, "");
    toast(`這份報告的專案還沒匯入：${dir}。到「專案清單」匯入後再開一次。`);
    return false;
  }

  // 已經停在這一頁時，喚醒鏈用事件交件而不是導頁 —— 導頁會整頁重載，把捲動
  // 位置、展開狀態、還沒存的說明欄全部丟掉，而使用者正在做的事很可能就是
  // 勾上一份報告。
  window.addEventListener(UAT_HANDOFF_EVENT, (e) => {
    const path = (e as CustomEvent<{ reportPath?: string }>).detail?.reportPath;
    if (!path) return;
    if (!alignProjectForUat(path)) return;
    pendingUat = { path, until: Date.now() + UAT_LANDING_MS };
    void refresh(true);
  });

  // ponytail: 只做 1 秒輪詢，不掛 fs watcher。mtime 重比較本來就得每秒做一次，
  // 畫面去重讓沒變化的那幾百次輪詢不產生任何 DOM 動作。瀏覽器沒有資料通道，不輪詢。
  if (canScanPlans()) window.setInterval(() => void refresh(), 1000);

  const uatParam = new URLSearchParams(location.search).get(UAT_QUERY_KEY);
  if (uatParam) {
    if (alignProjectForUat(uatParam)) {
      pendingUat = { path: uatParam, until: Date.now() + UAT_LANDING_MS };
    } else {
      // 對不到專案就不要留著參數 —— 重新整理再吃一次同樣的死路
      clearUatQuery();
    }
  }

  void refresh(true);
  store.subscribe(() => render(true));
}
