/**
 * 原生 bridge 的**唯一**入口。契約見 `docs/BRIDGE.md`。
 *
 * ## 為什麼要有這一層
 *
 * 舊的 WKWebView 橋是 `postMessage` + 全域 `anchorline-native` 事件，每個呼叫端
 * 都要自己 addEventListener、自己比對 `type`、自己設逾時。八個檔案寫了八次
 * 同一段樣板，而且那個模式有個**已知缺陷**：請求與回應沒有關聯 id，
 * 同一個 action 併發兩次會拿錯結果。
 *
 * Tauri 的 `invoke()` 回 Promise，關聯是語言層級的，那個缺陷自然消失。
 * 把它收在這裡，八個呼叫端就只剩「我要什麼」，不再有「怎麼拿」。
 *
 * ## unavailable 不是錯誤
 *
 * CLI 沒裝、資料夾不是 git 專案 —— 那些是**狀態**。Rust 端會 Ok 一個
 * `{ unavailable: true, message }`，這裡原樣傳回去讓呼叫端判斷。
 * 用 throw 表達會讓每個呼叫端都要包 try/catch，然後畫面就會跳紅字。
 */
import { invoke } from "@tauri-apps/api/core";

/** Rust 端「不是錯誤的缺席」形狀 */
export type Unavailable = { unavailable: true; message: string };

export function isUnavailable(v: unknown): v is Unavailable {
  return typeof v === "object" && v !== null && (v as Unavailable).unavailable === true;
}

/**
 * Tauri 只把 `__TAURI_INTERNALS__` 注入**頂層 frame**，iframe 裡沒有。
 *
 * 偏好設定是用 iframe 載入 `settings.html` 的（見 `settings-modal.ts`），
 * 所以設定頁裡的任何原生功能都會誤判成「這裡不是桌面版」——症狀是按鈕
 * 直接灰掉，而且完全不像橋接問題。這個坑之所以到現在才爆，是因為在此之前
 * 每一個 `isNative()` 呼叫點都剛好只出現在頂層頁面。
 *
 * iframe 與父層同源（都是 `tauri://localhost`），所以直接把父層的 internals
 * 借過來用。修在這裡而不是在呼叫端加 workaround：native 偵測只有一個擁有者，
 * 下一個放進設定頁的原生功能不該再踩一次。
 *
 * 匯出是為了測試——它跑在模組載入時，正式路徑不需要有人呼叫它。
 */
export function adoptParentInternals(w: {
  parent?: unknown;
  top?: unknown;
  [k: string]: unknown;
}): boolean {
  if (!w || "__TAURI_INTERNALS__" in w) return false;
  for (const frame of [w.parent, w.top]) {
    if (!frame || frame === w) continue;
    try {
      const internals = (frame as Record<string, unknown>).__TAURI_INTERNALS__;
      if (internals) {
        w.__TAURI_INTERNALS__ = internals;
        return true;
      }
    } catch {
      // 跨來源存取被擋。iframe 不同源就真的沒有原生通道，維持 false 是對的。
    }
  }
  return false;
}

if (typeof window !== "undefined") {
  adoptParentInternals(window as unknown as Record<string, unknown>);
}

/**
 * 跑在 Tauri 殼裡嗎。
 *
 * 判斷 `__TAURI_INTERNALS__` 而不是 user agent —— UA 會被改，內部物件不會。
 */
export function isNative(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * 呼叫一個 action。
 *
 * @param cmd Rust command 名稱（snake_case，見 BRIDGE.md §4）
 * @throws 不在 Tauri 裡、或 Rust 端回 Err 時 throw。**unavailable 不會 throw。**
 */
export async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isNative()) {
    throw new Error("需要桌面版 App：瀏覽器沒有原生通道");
  }
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    // Tauri 的 `Err(String)` reject 出來的是**字串，不是 Error**。
    // 而全 app 的呼叫端都寫 `e instanceof Error ? e.message : "某某失敗"`，
    // 於是每一個真正的失敗原因都在這裡被換成通用文案 —— OpenSpec 點檔案
    // 只顯示「讀取失敗」、完全查不出是路徑被擋還是 OS 不給讀，就是這樣來的。
    // 在唯一的出入口收斂成 Error，所有呼叫端不必改就拿得到真訊息。
    throw normalizeBridgeError(cmd, e);
  }
}

/** 把 Rust 端各種形狀的 reject 收斂成帶得動訊息的 Error */
function normalizeBridgeError(cmd: string, e: unknown): Error {
  if (e instanceof Error) return e;
  if (typeof e === "string") return new Error(e);
  if (e && typeof e === "object") {
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === "string") return new Error(msg);
    try {
      return new Error(JSON.stringify(e));
    } catch {
      /* 有循環參照就走下面的泛用訊息 */
    }
  }
  return new Error(`${cmd} 失敗（原生端沒有給訊息）`);
}

/**
 * 呼叫一個可能不可用的 action。
 *
 * 把 throw 也折成 unavailable —— 對呼叫端來說「CLI 沒裝」與「橋壞了」
 * 的處理方式一樣：顯示原因、不要當掉。
 */
export async function callMaybe<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T | Unavailable> {
  try {
    return await call<T | Unavailable>(cmd, args);
  } catch (e) {
    return { unavailable: true, message: (e as Error).message };
  }
}

// ── 型別化的十五個入口 ────────────────────────────────────────────────
// 呼叫端只用這些，不直接碰 call()。名字與 BRIDGE.md §4 對齊。

export type ScannedFile = { path: string; name: string; size: number; text: string };
export type FolderPick = {
  cancelled: boolean;
  folderName: string;
  folderPath: string;
  files: ScannedFile[];
};
export type PlanStat = { path: string; name: string; mtimeMs: number; text: string };
export type NativeTrackingScan = {
  files: PlanStat[];
  signal: { raw: string; mtimeMs: number } | null;
};

export const native = {
  pickFolder: () => call<FolderPick>("pick_folder"),
  pickProjectFolder: () => call<FolderPick>("pick_project_folder"),

  projectStats: (folderPath: string) => call<unknown>("project_stats", { folderPath }),
  trackingScan: (plansDirs: string[], openspecRoots: string[] = []) =>
    call<NativeTrackingScan>("tracking_scan", { plansDirs, openspecRoots }),
  /**
   * 取走一份 UAT 交件。**無參數** —— 交件檔的路徑在 Rust 端寫死，前端不能說
   * 要讀哪個檔（見 `commands.rs` 的 `uat_handoff_take`）。回 `null` 代表沒有待辦。
   *
   * 走 `callMaybe` 而不是 `call`：這支每次視窗聚焦都會被呼叫，而「沒有待辦」
   * 與「不在桌面版」都是狀態不是例外。用 throw 表達會讓一個背景輪詢在瀏覽器裡
   * 每次聚焦都丟一個沒人接的 rejection。
   */
  uatHandoffTake: () => callMaybe<string | null>("uat_handoff_take"),

  readFile: (path: string) => call<{ path: string; text: string }>("read_file", { path }),
  writeFile: (path: string, text: string) => call<{ path: string }>("write_file", { path, text }),
  /** 這個資料夾在 Rust 端有授權嗎（前端的 localStorage 可能與它不同步） */
  isRootRegistered: (dir: string) => call<boolean>("is_root_registered", { dir }),
  /** 領域包專用：唯一能建新檔的寫入路徑，檔名在 Rust 端驗證 */
  writeDomainPack: (dir: string, name: string, text: string) =>
    call<{ path: string }>("write_domain_pack", { dir, name, text }),
  appendFile: (path: string, line: string) => call<{ path: string }>("append_file", { path, line }),
  /**
   * 稽核軌跡的讀取端。傳的是**專案根目錄**，不是檔案路徑 —— 前端不能指定
   * 要讀哪個檔，Rust 只會給 `<root>/.anchorline/log/` 底下的分片。
   *
   * `truncated` 為 true 代表因為分片數或位元組上限而少讀了。那不是錯誤，
   * 但統計會偏低，畫面必須講出來。
   */
  readLog: (projectRoot: string) =>
    call<{ text: string; shards: string[]; truncated: boolean }>("read_log", { projectRoot }),
  openPath: (path: string) => call<{ path: string }>("open_path", { path }),

  openspecStatus: (folderPath: string) =>
    callMaybe<{ folderPath: string; list: string; statuses: string[] }>("openspec_status", {
      folderPath,
    }),
  /**
   * 未提交的改動內容。**唯讀** —— `status --porcelain` 與兩種 `diff`，
   * 沒有任何會改動 repo 的子指令（BRIDGE.md §4.14）。
   *
   * 路徑要是已註冊的專案根目錄，否則回 Missing。
   */
  gitChangeset: (folderPath: string) =>
    callMaybe<{ status: string; stat: string; patch: string; truncated: boolean }>(
      "git_changeset",
      { folderPath },
    ),
  /** 這個資料夾有沒有 openspec 骨架。純檔案系統檢查，不呼叫 CLI —— 
      「CLI 不在」與「沒 init 過」是兩件事。 */
  openspecProbe: (folderPath: string) =>
    call<{ initialized: boolean }>("openspec_probe", { folderPath }),
  /**
   * `openspec init`。**這是唯一會寫入使用者專案的 action**（BRIDGE.md §4.7c）。
   * 呼叫端要先跟使用者確認。
   */
  openspecInit: (folderPath: string) => callMaybe<{ raw: string }>("openspec_init", { folderPath }),
  /** 專案分析報告用的資料夾掃描。副檔名白名單 + 上限，`truncated` 要顯示出來。 */
  scanProject: (folderPath: string) =>
    callMaybe<{ files: { path: string; text: string }[]; truncated: boolean }>("scan_project", {
      folderPath,
    }),
  listSnapshots: (folderPath: string) =>
    call<{ name: string; mtimeMs: number; bytes: number }[]>("list_snapshots", { folderPath }),
  /** **不覆寫**：同名存在就回 Missing。報告蓋掉就沒有東西可以比對變化。 */
  writeSnapshot: (folderPath: string, name: string, text: string) =>
    callMaybe<{ path: string }>("write_snapshot", { folderPath, name, text }),
  /** 匯出檔進 `<root>/.anchorline/exports/`。**允許覆寫** —— 匯出是可重生的成品。 */
  writeExport: (folderPath: string, name: string, text: string) =>
    callMaybe<{ path: string }>("write_export", { folderPath, name, text }),
  ghStatus: () => callMaybe<{ raw: string; fetchedAt: string }>("gh_status"),
  onefetch: (folderPath: string) => callMaybe<{ raw: string }>("onefetch", { folderPath }),
  fastfetch: () => callMaybe<{ raw: string }>("fastfetch"),

  /** 探測順序的第一步：使用者自己指定路徑（BRIDGE.md §5） */
  setCliPath: (tool: string, path: string | null) => call<boolean>("set_cli_path", { tool, path }),
  probeClis: () => call<Record<string, string | null>>("probe_clis"),

  ping: () => call<{ native: boolean; capabilities: string[] }>("ping"),
};
