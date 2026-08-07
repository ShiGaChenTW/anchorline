/**
 * 歡迎畫面（試作）—— 開啟 App 時顯示目前專案的 onefetch 資訊。
 *
 * 用 `onefetch --output json` 而不是解析終端輸出：ANSI 色碼與方塊字元
 * 拿到瀏覽器裡重組是自找麻煩，而且 onefetch 改版就會壞。
 *
 * ADHD 取捨：
 * - 預設每次開啟都跳 —— 「你上次離開後這個專案長怎樣」是每次回來都想知道的事，
 *   而不是一天一次。要靜音由使用者自己勾「今天不再顯示」，是他的決定不是我的。
 * - Esc／點背景就關，不強迫讀完。
 * - 內容是「你上次離開後這個專案長怎樣」，不是操作教學（那是首次導覽的事）。
 * - 沒有 onefetch、沒綁資料夾、不是 git 專案 → 安靜不顯示，不要為了跳而跳。
 */

const SHOWN_KEY = "specforge:welcome-shown-date";

/** onefetch 的 infoFields 是一個 { TypeName: {...} } 陣列 */
type InfoField = Record<string, Record<string, unknown>>;

export type Onefetch = {
  title?: { gitUsername?: string; gitVersion?: string };
  infoFields?: InfoField[];
};

function field<T = Record<string, unknown>>(o: Onefetch, name: string): T | null {
  for (const f of o.infoFields ?? []) {
    if (name in f) return f[name] as T;
  }
  return null;
}

/** 挑出要顯示的幾項。onefetch 給的欄位很多，全列出來就是一面數字牆。 */
export function summarize(o: Onefetch): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const push = (label: string, value: unknown) => {
    const v = value == null ? "" : String(value).trim();
    if (v) out.push({ label, value: v });
  };

  const head = field<{ headRefs?: { shortCommitId?: string; refs?: string[] } }>(o, "HeadInfo");
  push("HEAD", head?.headRefs
    ? `${head.headRefs.shortCommitId ?? ""}${head.headRefs.refs?.length ? ` (${head.headRefs.refs.join(", ")})` : ""}`
    : "");

  const pending = field<{ added?: number; deleted?: number; modified?: number }>(o, "PendingInfo");
  if (pending) {
    const n = (pending.added ?? 0) + (pending.deleted ?? 0) + (pending.modified ?? 0);
    push("未提交", n ? `${n} 項變更` : "無");
  }

  push("版本", field<{ version?: string }>(o, "VersionInfo")?.version);
  push("建立於", field<{ creationDate?: string }>(o, "CreatedInfo")?.creationDate);
  push("最後變更", field<{ lastChange?: string }>(o, "LastChangeInfo")?.lastChange);
  push("Commits", field<{ numberOfCommits?: number }>(o, "CommitsInfo")?.numberOfCommits);

  const loc = field<{ linesOfCode?: number }>(o, "LocInfo")?.linesOfCode;
  push("程式碼行數", typeof loc === "number" ? loc.toLocaleString("en-US") : loc);

  const size = field<{ repoSize?: string; fileCount?: number }>(o, "SizeInfo");
  push("儲存庫大小", size?.repoSize
    ? `${size.repoSize}${size.fileCount ? ` · ${size.fileCount} 檔` : ""}`
    : "");

  const deps = field<{ numOfDependencies?: number; dependencyManager?: string }>(o, "DependenciesInfo");
  push("相依套件", deps?.numOfDependencies
    ? `${deps.numOfDependencies}${deps.dependencyManager ? `（${deps.dependencyManager}）` : ""}`
    : "");

  push("遠端", field<{ repoUrl?: string }>(o, "UrlInfo")?.repoUrl);
  return out;
}

export type LangSlice = { language: string; percentage: number };

export function languages(o: Onefetch): LangSlice[] {
  const li = field<{ languagesWithPercentage?: LangSlice[] }>(o, "LanguagesInfo");
  return (li?.languagesWithPercentage ?? []).slice(0, 6);
}

export function repoName(o: Onefetch): string {
  return field<{ repoName?: string }>(o, "ProjectInfo")?.repoName ?? "專案";
}

/** 使用者今天勾過「不再顯示」才靜音。沒勾就每次開啟都跳。 */
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

export function renderWelcome(o: Onefetch, projectTitle: string) {
  document.getElementById("welcome-root")?.remove();
  const rows = summarize(o);
  const langs = languages(o);

  const root = document.createElement("div");
  root.id = "welcome-root";
  root.className = "modal-back open";
  root.innerHTML = `
    <div class="modal welcome-modal" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <header>
        <div>
          <h3 id="welcome-title">${escapeHtml(projectTitle)}</h3>
          <p class="sub mono">${escapeHtml(repoName(o))}${
            o.title?.gitUsername ? ` · ${escapeHtml(o.title.gitUsername)}` : ""
          }</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-welcome="close">關閉</button>
      </header>
      <div class="body">
        ${
          langs.length
            ? `<div class="dash-bar" role="img" aria-label="語言佔比">${langs
                .map(
                  (l, i) =>
                    `<span class="dash-bar-seg seg-${i % 6}" style="width:${l.percentage}%" title="${escapeHtml(l.language)} ${l.percentage.toFixed(1)}%"></span>`,
                )
                .join("")}</div>
              <ul class="dash-legend welcome-langs">${langs
                .map(
                  (l, i) =>
                    `<li><span class="dash-dot seg-${i % 6}"></span>${escapeHtml(l.language)} <span class="mono">${l.percentage.toFixed(1)}%</span></li>`,
                )
                .join("")}</ul>`
            : ""
        }
        <dl class="dash-dl welcome-dl">${rows
          .map(
            (r) =>
              `<div><dt>${escapeHtml(r.label)}</dt><dd class="mono">${escapeHtml(r.value)}</dd></div>`,
          )
          .join("")}</dl>
        <p class="dash-note">資料來自 <code>onefetch</code>。</p>
      </div>
      <footer class="welcome-foot">
        <label class="welcome-mute">
          <input type="checkbox" data-welcome="mute" />
          <span>今天不再顯示</span>
        </label>
        <span class="spacer"></span>
        <a class="btn" href="dashboard.html">看完整儀表板</a>
        <button type="button" class="btn btn-primary" data-welcome="close">開始工作</button>
      </footer>
    </div>
  `;
  document.body.appendChild(root);

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
 * 啟動時嘗試顯示。任何一個前提不成立就安靜跳過：
 * 已經跳過、不是桌面版、沒綁資料夾、沒裝 onefetch、不是 git 專案。
 */
export function initWelcome(folderPath: string | undefined, projectTitle: string) {
  if (!folderPath || mutedToday()) return;

  const w = window as Window & {
    __SPECFORGE_NATIVE__?: boolean;
    webkit?: { messageHandlers?: { specforge?: { postMessage: (m: unknown) => void } } };
  };
  const bridge = w.webkit?.messageHandlers?.specforge;
  if (!bridge) return; // 瀏覽器版沒有 onefetch，安靜跳過

  const timer = window.setTimeout(() => {
    window.removeEventListener("specforge-native", onNative);
  }, 10000);

  function onNative(e: Event) {
    const p = (e as CustomEvent<{ type?: string; raw?: string }>).detail;
    if (p?.type === "onefetchError") {
      window.clearTimeout(timer);
      window.removeEventListener("specforge-native", onNative);
      return; // 安靜失敗：沒裝 onefetch 不該變成一則錯誤訊息
    }
    if (p?.type !== "onefetch" || !p.raw) return;
    window.clearTimeout(timer);
    window.removeEventListener("specforge-native", onNative);
    try {
      renderWelcome(JSON.parse(p.raw) as Onefetch, projectTitle);
    } catch {
      /* JSON 壞掉就不顯示 */
    }
  }

  window.addEventListener("specforge-native", onNative);
  try {
    bridge.postMessage({ action: "onefetch", folderPath });
  } catch {
    window.clearTimeout(timer);
    window.removeEventListener("specforge-native", onNative);
  }
}

// ponytail: 欄位挑選寫死在 summarize()，不做可設定。
// onefetch 給二十幾個欄位，全列出來就是一面數字牆 —— 挑過才是這個畫面的價值。
