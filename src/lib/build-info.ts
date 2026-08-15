/**
 * 這一份 build 是哪一份 —— 版號 · commit · build 時間。
 *
 * 起因是一次真實的假 bug：`/Applications/Anchorline.app` 與剛 build 出來的 bundle，
 * Info.plist 版本字串都是 `1.1.0`。忘記換裝跟換裝成功長得一模一樣，於是有一輪驗證
 * 是對著舊版做的，而回報的人自己不知道。版號單獨一項識別不了 build，要配 commit。
 *
 * 值一律是**建置期**由 `vite.config.ts` 的 `define` 打進來的。不在執行期跑 git ——
 * 裝到 `/Applications` 的 bundle 底下沒有 repo 可查，那條路在正式版必然失敗。
 *
 * 檔案切成兩半，界線是刻意的：
 * - 上半是**純函式**，輸入全部從參數進來，測試只釘這一半。
 * - 下半 `resolveBuildInfo()` 是唯一碰 `import.meta.env` 的地方。`bun test` 底下
 *   那些 define 不存在，所以它必須讀得到 undefined 也不炸。
 */

export type BuildInfo = {
  /** 語意版號；dev 會帶 `-dev` 後綴 */
  version: string;
  /** git short hash */
  commit: string;
  /** build 當下工作區有沒有未 commit 的變更 */
  dirty: boolean;
  /** build 時間，ISO 8601；取不到時為空字串 */
  builtAt: string;
};

/** 任何一項取不到時的值。空字串／`undefined` 都不行 —— 那會讓「壞了」看起來像「還沒載入」。 */
export const UNKNOWN_BUILD_FIELD = "unknown";

/**
 * 把 `import.meta.env` 讀出來的值收斂成字串。
 *
 * `vite/client` 的 `ImportMetaEnv` 帶 index signature，型別是 `any`，所以編譯器
 * 不會幫我們擋任何東西 —— 收斂只能在這裡用 runtime 判斷做，這是唯一的邊界。
 */
export function normalizeInjected(raw: unknown, fallback = UNKNOWN_BUILD_FIELD): string {
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  return trimmed === "" ? fallback : trimmed;
}

/**
 * commit 欄位；工作區髒的話補 `+`。
 *
 * 沒有這個標記，「我改了但沒 commit 就 build」跟「乾淨 build」的字串完全相同，
 * 而這正是最容易誤判的那一種情況。
 */
export function formatCommit(commit: string, dirty: boolean): string {
  const base = normalizeInjected(commit);
  // 連 commit 都取不到時再加 `+` 只會變成 `unknown+`，讀起來像另一種錯誤
  if (base === UNKNOWN_BUILD_FIELD) return base;
  return dirty ? `${base}+` : base;
}

/**
 * build 時間 → `MM-DD HH:mm`（本地時區）。
 *
 * 不顯示年份也不顯示秒：這串字要在 28px 高的狀態列裡跟使用者名稱、時鐘擠同一欄，
 * 而它要回答的問題只有「這是不是我剛剛那次 build」——那是分鐘等級的事。
 */
export function formatBuildTime(iso: string): string {
  const normalized = normalizeInjected(iso, "");
  if (normalized === "" || normalized === UNKNOWN_BUILD_FIELD) return UNKNOWN_BUILD_FIELD;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return UNKNOWN_BUILD_FIELD;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

/** 狀態列上那一串：`1.1.0 · 53596f9 · 08-15 08:50` */
export function formatBuildStamp(info: BuildInfo): string {
  return [
    normalizeInjected(info.version),
    formatCommit(info.commit, info.dirty),
    formatBuildTime(info.builtAt),
  ].join(" · ");
}

// ── 以下是唯一的不純段落 ──────────────────────────────────────────

/**
 * 讀建置期注入的值。
 *
 * `vite.config.ts` 的 `define` 在 `vite dev` 與 `vite build` 兩條路徑都會生效，
 * 所以 dev 與 `tauri build` 都拿得到值。第三條路徑（`bun test`、直接跑 tsc）沒有
 * define，整組會落到 `unknown` —— 這是預期行為，不是錯誤。
 */
export function resolveBuildInfo(): BuildInfo {
  const env = import.meta.env as Record<string, unknown>;
  return {
    version: normalizeInjected(env.VITE_BUILD_VERSION),
    commit: normalizeInjected(env.VITE_BUILD_COMMIT),
    // 注入的是字串 `"true"` / `"false"`；讀不到時當乾淨，因為「取不到 git 狀態」
    // 已經由 commit 欄位的 `unknown` 表達了，這裡再標髒是重複且誤導
    dirty: normalizeInjected(env.VITE_BUILD_DIRTY, "false") === "true",
    builtAt: normalizeInjected(env.VITE_BUILD_TIME, ""),
  };
}
