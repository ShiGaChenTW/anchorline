/**
 * 原生 bridge 的**唯一**入口。契約見 `docs/BRIDGE.md`。
 *
 * ## 為什麼要有這一層
 *
 * 舊的 WKWebView 橋是 `postMessage` + 全域 `specforge-native` 事件，每個呼叫端
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
  return invoke<T>(cmd, args);
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
  trackingScan: (plansDirs: string[]) => call<NativeTrackingScan>("tracking_scan", { plansDirs }),

  readFile: (path: string) => call<{ path: string; text: string }>("read_file", { path }),
  writeFile: (path: string, text: string) => call<{ path: string }>("write_file", { path, text }),
  appendFile: (path: string, line: string) => call<{ path: string }>("append_file", { path, line }),
  openPath: (path: string) => call<{ path: string }>("open_path", { path }),

  openspecStatus: (folderPath: string) =>
    callMaybe<{ folderPath: string; list: string; statuses: string[] }>("openspec_status", {
      folderPath,
    }),
  ghStatus: () => callMaybe<{ raw: string; fetchedAt: string }>("gh_status"),
  onefetch: (folderPath: string) => callMaybe<{ raw: string }>("onefetch", { folderPath }),
  fastfetch: () => callMaybe<{ raw: string }>("fastfetch"),

  /** 探測順序的第一步：使用者自己指定路徑（BRIDGE.md §5） */
  setCliPath: (tool: string, path: string | null) => call<boolean>("set_cli_path", { tool, path }),
  probeClis: () => call<Record<string, string | null>>("probe_clis"),

  ping: () => call<{ native: boolean; capabilities: string[] }>("ping"),
};
