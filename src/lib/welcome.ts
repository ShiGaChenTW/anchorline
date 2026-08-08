/**
 * 歡迎畫面 —— 開 App 時的第一眼。
 *
 * 這是 **App 的**歡迎畫面，不是某個 repo 的。所以上半是「你是誰、這個 App
 * 是什麼版本、你手上有幾個專案」，下半是 `fastfetch` 給的機器狀態。
 * 原本用 onefetch 顯示單一 repo 的 git 資訊 —— 那件事儀表板已經做得更好，
 * 而且開 App 的當下你還沒決定要進哪個專案。
 *
 * 用 `fastfetch --format json` 而不是解析終端輸出：ANSI 色碼與方塊字元
 * 拿到瀏覽器裡重組是自找麻煩，而且 fastfetch 改版就會壞。
 *
 * ADHD 取捨：
 * - 預設每次開啟都跳 —— 一句問候 + 你手上有幾件事，是每次回來都該先看到的。
 *   要靜音由使用者自己勾「今天不再顯示」，是他的決定不是我的。
 * - Esc／點背景就關，不強迫讀完。
 * - 沒裝 fastfetch 也照跳，只是下半留白 —— 問候與專案數不該被一個外部工具綁架。
 */
import { isUnavailable, native } from "./native";
import { store } from "../data/store";

const SHOWN_KEY = "anchorline:welcome-shown-date";
/**
 * 「這次啟動已經跳過了」。
 * 用 sessionStorage 而不是 localStorage —— 這個 App 是多頁式的，換頁就是一次
 * 真的 page load，用 localStorage 會變成每點一次側欄就彈一次。
 * sessionStorage 在同一個 WebView session 內跨頁保留、App 整個關掉才清空，
 * 正好就是「開啟當下跳一次，關掉再開才會再跳」的語意。
 */
const SESSION_KEY = "anchorline:welcome-seen-session";
const APP_VERSION = "1.1.0";

/** fastfetch --format json 是一個 [{type, result}] 陣列 */
export type FastfetchEntry = { type?: string; result?: unknown; error?: string };

function pick(list: FastfetchEntry[], type: string): Record<string, unknown> | null {
  const hit = list.find((e) => e.type === type && e.result != null);
  return hit ? (hit.result as Record<string, unknown>) : null;
}

function bytes(n: number): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / Math.pow(1024, i);
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

/** fastfetch 的 uptime 是毫秒 */
function uptimeLabel(ms: number): string {
  const min = Math.floor(ms / 60000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d) return `${d} 天 ${h} 小時`;
  if (h) return `${h} 小時 ${m} 分`;
  return `${m} 分`;
}

/**
 * 挑出要顯示的幾項。fastfetch 給二十幾個模組，全列出來就是一面數字牆。
 * 挑過才是這個畫面的價值。
 */
export function summarizeSystem(list: FastfetchEntry[]): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const push = (label: string, value: unknown) => {
    const v = value == null ? "" : String(value).trim();
    if (v) out.push({ label, value: v });
  };

  push("機型", pick(list, "Host")?.name);
  push("系統", pick(list, "OS")?.prettyName);

  const cpu = pick(list, "CPU");
  const cores = cpu?.cores as { logical?: number } | undefined;
  push("處理器", cpu?.cpu ? `${cpu.cpu}${cores?.logical ? ` · ${cores.logical} 核` : ""}` : "");

  const mem = pick(list, "Memory") as { total?: number; used?: number } | null;
  if (mem?.total) {
    const pct = mem.used ? Math.round((mem.used / mem.total) * 100) : 0;
    push("記憶體", `${bytes(mem.used ?? 0)} / ${bytes(mem.total)}（${pct}%）`);
  }

  const disks = pick(list, "Disk") as unknown as
    | { bytes?: { used?: number; total?: number } }[]
    | null;
  const root = Array.isArray(disks) ? disks[0] : null;
  if (root?.bytes?.total) {
    const free = (root.bytes.total ?? 0) - (root.bytes.used ?? 0);
    push("磁碟", `剩 ${bytes(free)} / ${bytes(root.bytes.total)}`);
  }

  const up = pick(list, "Uptime")?.uptime;
  push("開機時間", typeof up === "number" ? uptimeLabel(up) : "");

  const pkg = pick(list, "Packages") as { all?: number; brew?: number } | null;
  push("套件", pkg?.all ? `${pkg.all}${pkg.brew ? `（brew ${pkg.brew}）` : ""}` : "");

  const bat = pick(list, "Battery") as unknown as { capacity?: number }[] | null;
  const cap = Array.isArray(bat) ? bat[0]?.capacity : undefined;
  push("電池", typeof cap === "number" ? `${Math.round(cap)}%` : "");

  const ip = pick(list, "LocalIp") as unknown as { ipv4?: string }[] | null;
  push("區網 IP", Array.isArray(ip) ? ip[0]?.ipv4 : "");

  // 不放 Shell：fastfetch 讀的是父行程，從 App 裡叫出來會顯示 Anchorline 自己 —— 誤導。
  return out;
}

/** 依時間問候。凌晨還在寫 PRD 的人值得被特別對待。 */
export function greeting(h = new Date().getHours()): string {
  if (h < 5) return "夜深了";
  if (h < 11) return "早安";
  if (h < 14) return "午安";
  if (h < 18) return "下午好";
  return "晚安";
}

function seenThisLaunch(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}
function markSeenThisLaunch() {
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    /* private mode */
  }
}

/** 使用者今天勾過「不再顯示」才靜音。沒勾就每次啟動都跳。 */
function mutedToday(): boolean {
  try {
    return localStorage.getItem(SHOWN_KEY) === new Date().toDateString();
  } catch {
    return true;
  }
}
function setMutedToday(muted: boolean) {
  try {
    if (muted) localStorage.setItem(SHOWN_KEY, new Date().toDateString());
    else localStorage.removeItem(SHOWN_KEY);
  } catch {
    /* private mode */
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderWelcome(list: FastfetchEntry[] | null) {
  document.getElementById("welcome-root")?.remove();

  const st = store.get();
  const who = (st.currentUser?.name ?? "").trim();
  const projects = st.projects.filter((p) => !p.isSample || st.showSamples);
  const open = projects.filter((p) => p.status === "draft" || p.status === "review").length;
  const rows = list ? summarizeSystem(list) : [];

  const root = document.createElement("div");
  root.id = "welcome-root";
  root.className = "modal-back open";
  root.innerHTML = `
    <div class="modal welcome-modal" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <header class="welcome-head">
        <div class="welcome-mark" aria-hidden="true">PR</div>
        <div class="welcome-hello">
          <h3 id="welcome-title">${escapeHtml(greeting())}${who ? `，${escapeHtml(who)}` : ""}</h3>
          <p class="welcome-appline">
            <span>PRD 開發監控台</span>
            <span class="welcome-ver mono">v${escapeHtml(APP_VERSION)}</span>
          </p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-welcome="close">關閉</button>
      </header>
      <div class="body">
        <div class="welcome-counts">
          <div class="welcome-count">
            <strong>${projects.length}</strong>
            <span>管理中的專案</span>
          </div>
          <div class="welcome-count">
            <strong>${open}</strong>
            <span>草稿／審閱中</span>
          </div>
        </div>
        ${
          rows.length
            ? `<dl class="dash-dl welcome-dl">${rows
                .map(
                  (r) =>
                    `<div><dt>${escapeHtml(r.label)}</dt><dd class="mono">${escapeHtml(r.value)}</dd></div>`,
                )
                .join("")}</dl>
              <p class="dash-note">系統資訊來自 <code>fastfetch</code>。</p>`
            : `<p class="dash-note">沒抓到系統資訊。裝了 <code>brew install fastfetch</code> 之後這裡會顯示機器狀態。</p>`
        }
      </div>
      <footer class="welcome-foot">
        <label class="welcome-mute">
          <input type="checkbox" data-welcome="mute" />
          <span>今天不再顯示</span>
        </label>
        <span class="spacer"></span>
        <a class="btn" href="overview.html">看全部專案</a>
        <button type="button" class="btn btn-primary" data-welcome="close">開始工作</button>
      </footer>
    </div>
  `;
  document.body.appendChild(root);
  markSeenThisLaunch();

  // 勾了就當天靜音，取消勾選就馬上還原 —— 誤按不該要等到明天。
  const mute = root.querySelector('[data-welcome="mute"]') as HTMLInputElement | null;
  mute?.addEventListener("change", () => setMutedToday(mute.checked));

  const close = () => {
    root.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKey);
  root.querySelectorAll('[data-welcome="close"]').forEach((b) =>
    b.addEventListener("click", close),
  );
  // 點背景也關 —— 不強迫讀完
  root.addEventListener("click", (e) => {
    if (e.target === root) close();
  });
  (root.querySelector('[data-welcome="close"]') as HTMLElement | null)?.focus();
}

/**
 * 啟動時嘗試顯示。
 * 三個前提會擋下來：這次啟動已經跳過、今天勾過靜音、不是桌面版。
 * fastfetch 抓不到不算前提 —— 問候與專案數本來就不需要它。
 */
export function initWelcome() {
  if (seenThisLaunch() || mutedToday()) return;

  void (async () => {
    const r = await native.fastfetch();
    renderWelcome(isUnavailable(r) ? null : (JSON.parse(r.raw) as FastfetchEntry[]));
  })().catch(() => renderWelcome(null));

}
