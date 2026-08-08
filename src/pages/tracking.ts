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

  function renderList() {
    const el = document.getElementById("plan-list");
    if (!el) return;
    if (!plans.length) {
      // 說出範圍，否則空清單看起來像壞掉。清單是照當前專案過濾的，
      // 使用者要能一眼看出「是這個專案沒有」而不是「功能沒反應」。
      const name = activeProjectName();
      const scope = name ? `「${name}」` : "當前專案";
      el.innerHTML = `<div style="padding:16px;color:var(--muted)">${scope} 的 plans/ 尚無計劃檔</div>`;
      return;
    }
    el.innerHTML = plans
      .map((p, i) => {
        const pct = planProgressPct(p.meta);
        // 追蹤點與選取態刻意分開：同一列可以同時是「我在看的」和「agent 在寫的」，
        // 也經常不是同一列。
        const dot =
          live && p.path === trackingPath
            ? `<span title="追蹤中 · agent 最近寫入這一份" style="color:var(--accent);margin-left:6px">•</span>`
            : "";
        return `<button type="button" class="tui-plan-item ${i === idx ? "active" : ""}" data-i="${i}">
          <div class="t">${escapeHtml(p.meta.title)}${dot}</div>
          <div class="m">${escapeHtml(p.meta.status)} · ${p.meta.done_steps}/${p.meta.total_steps} · ${pct}%</div>
        </button>`;
      })
      .join("");
    el.querySelectorAll(".tui-plan-item").forEach((btn) => {
      (btn as HTMLButtonElement).onclick = () => {
        select(Number((btn as HTMLElement).dataset.i));
      };
    });
  }

  function renderMain() {
    const p = plans[idx];
    const hd = document.getElementById("plan-hd");
    const sum = document.getElementById("plan-summary");
    const steps = document.getElementById("step-list");
    if (!p) {
      if (hd) hd.textContent = "步驟";
      if (sum) sum.innerHTML = "";
      if (steps) steps.innerHTML = `<div style="padding:20px;color:var(--muted)">無計劃</div>`;
      return;
    }
    const pct = planProgressPct(p.meta);
    if (hd) hd.textContent = `步驟 · ${p.name}`;
    if (sum) {
      sum.innerHTML = `
        <div style="font-weight:600;font-size:14px;color:var(--fg);font-family:var(--font-body)">${escapeHtml(p.meta.title)}</div>
        <div style="color:var(--muted);margin-top:4px">${escapeHtml(p.meta.status)} · 建立 ${escapeHtml(p.meta.created)} · 更新 ${escapeHtml(p.meta.updated)}</div>
        <div class="tui-bar"><i style="width:${pct}%"></i></div>
        <div style="color:var(--muted)">${p.meta.done_steps} done · ${p.meta.pending_steps} pending · ${p.meta.skipped_steps} skipped · ${pct}%</div>
        <div style="margin-top:8px;color:var(--fg-2)">下一步：<strong style="color:var(--accent)">${escapeHtml(p.meta.next_step)}</strong></div>
      `;
    }
    if (steps) {
      if (!p.meta.steps.length) {
        steps.innerHTML = `<div style="padding:16px;color:var(--muted)">此檔無 Plan Steps checkbox</div>`;
      } else {
        steps.innerHTML = p.meta.steps
          .map((s) => {
            const mark = s.state === "done" ? "✔" : s.state === "skipped" ? "—" : "○";
            return `<div class="tui-step ${s.state}"><span class="mark">${mark}</span><span>${escapeHtml(s.text)}</span></div>`;
          })
          .join("");
      }
    }
  }

  function renderGates() {
    const el = document.getElementById("gate-panel");
    if (!el) return;
    const report = evaluatePrdGates(store.get());
    const foot = document.getElementById("tui-footer");
    if (foot) {
      // 空狀態不暴露判定細節（訊號過期？退回段 2？）—— 內部機制對使用者無意義
      const tracked = plans.find((p) => p.path === trackingPath);
      const liveLine = !live
        ? "靜態快照 · 桌面版才能即時追蹤"
        : tracked
          ? `追蹤中 • ${tracked.name}`
          : "等待 agent 開始執行…";
      foot.textContent = `${gateSummaryLine(report)} · j/k 切計劃 · t 跳到追蹤中 · score ${report.score} · ${liveLine}`;
    }
    el.innerHTML =
      `<div style="margin-bottom:8px;color:var(--fg)">score <strong>${report.score}</strong> · block ${report.blocks} · warn ${report.warns}</div>` +
      report.findings
        .map((f) => {
          const cls =
            f.level === "block" ? "pill-draft" : f.level === "warn" ? "pill-review" : "pill-approved";
          const label = f.level === "block" ? "BLOCK" : f.level === "warn" ? "WARN" : "PASS";
          return `<div class="gate-item">
            <span class="pill ${cls} lv">${label}</span>
            <div><div style="color:var(--fg)">${escapeHtml(f.label)}</div>
            <div style="color:var(--muted);margin-top:2px">${escapeHtml(f.detail)}</div></div>
          </div>`;
        })
        .join("");
  }

  function renderLayers() {
    const el = document.getElementById("layer-panel");
    if (!el) return;
    const hasPlan = plans.some((p) => p.meta.total_steps > 0);
    const layers = deriveFlowLayers(store.get(), { hasPlanSteps: hasPlan });
    el.innerHTML = layers
      .map((l) => {
        const mark = l.done ? "●" : l.active ? "▶" : "○";
        const color = l.done ? "var(--success)" : l.active ? "var(--accent)" : "var(--meta)";
        return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-muted)" title="${escapeHtml(l.hint)}">
        <span>${l.code} ${l.name}</span>
        <span style="color:${color}">${mark}</span>
      </div>`;
      })
      .join("");

    const p = plans[idx];
    if (p) {
      el.innerHTML += `
        <div class="tui-meta-card" style="margin:12px 0 0">
          <div class="k">目標</div>
          <div class="v">${escapeHtml(p.meta.goal)}</div>
        </div>
        <div class="tui-meta-card">
          <div class="k">最近決策</div>
          <div class="v">${escapeHtml(p.meta.last_decision)}</div>
        </div>
        <div class="tui-meta-card">
          <div class="k">阻塞</div>
          <div class="v">${p.meta.blockers} 項</div>
        </div>`;
    }
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
