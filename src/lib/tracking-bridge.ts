/**
 * Live tracking 的資料通道（桌面版）。
 *
 * 瀏覽器看不到磁碟，而整個判定只靠 mtime —— 所以 web 端的 tracking 能不能成立，
 * 完全取決於這條橋。形狀照抄 `project-stats.ts` 的 requestProjectStats。
 */
import { isNative, native } from "./native";
import type { TrackingSignal } from "./tracking";

export type ScannedPlan = {
  /** 絕對路徑 */
  path: string;
  name: string;
  mtimeMs: number;
  text: string;
  /**
   * `plan` = `plans/*.md`；`openspec` = `openspec/changes/<id>/tasks.md`。
   * 兩種檔的內文方言不同，前端要靠這個欄位選 parser —— 在前端用路徑再猜一次，
   * 等於同一個判斷寫兩個地方，而且改一邊不會有人發現。
   */
  kind?: "plan" | "openspec";
  /** openspec 專用：變更代號（目錄名）。tasks.md 沒有 H1，靠它當標題 */
  change?: string;
};

export type TrackingScan = {
  files: ScannedPlan[];
  signal: TrackingSignal | null;
};

export function canScanPlans(): boolean {
  return isNative();
}

/** 向原生橋要一次掃描。逾時由 Tauri 的 IPC 自己處理，這裡不再自訂計時器。 */
export async function requestTrackingScan(
  plansDirs: string[],
  openspecRoots: string[] = [],
): Promise<TrackingScan> {
  const r = await native.trackingScan(plansDirs, openspecRoots);
  return { files: r.files as ScannedPlan[], signal: r.signal ?? null };
}

type ProjectLike = { id?: string; importSummary?: { rootPath: string } };

/**
 * 要掃描的 `plans/` 目錄。
 *
 * **限定在當前選取的專案**，不是全部專案。Task Tracking 讀出來的清單直接就是
 * 使用者眼前的工作範圍 —— 混進別的專案的 plan，等於要人在自己的清單裡先做一次
 * 過濾，而工作區側欄早就已經表達過「我現在在看哪個專案」了。
 *
 * 沒有 `activeProjectId`（或它指向一個不存在／沒綁資料夾的專案）時回傳空陣列，
 * **不退回「全部專案」**。空清單是誠實的「這個專案沒有東西可追蹤」；退回全部
 * 則是把 bug 重新包裝成功能，而且退回的那一刻使用者不會知道範圍變了。
 *
 * 需要跨專案範圍的呼叫端（收件匣／badge）用 `plansDirsOfAll`，不要放寬這一支。
 */
export function plansDirsOf(projects: ProjectLike[], activeProjectId?: string | null): string[] {
  const scoped = activeProjectId
    ? projects.filter((p) => p.id === activeProjectId)
    : [];
  const dirs = scoped
    .map((p) => (p.importSummary?.rootPath ?? "").replace(/\/+$/, ""))
    .filter(Boolean)
    .map((root) => `${root}/plans`);
  return [...new Set(dirs)];
}

/**
 * 要掃描的 `plans/` 目錄 —— **全部專案，不分是否選取**。
 *
 * 與 `plansDirsOf` 是同一件事的兩種範圍，各自服務的問題不同：
 *
 * - `plansDirsOf`（Task Tracking 頁）：「我這個專案有什麼要追蹤」。清單就是
 *   眼前的工作範圍，混進別的專案等於要人在自己的清單裡先做一次過濾。
 * - `plansDirsOfAll`（總覽收件匣、側欄 badge）：「**所有**專案有幾份報告在等我」。
 *   收件匣的意義正是在人還沒切到那個專案時就告訴他有事 —— agent 幫 B 專案出的
 *   實測題，人正在 A 專案工作時如果數不進來，那份報告就只剩「喚醒導頁」那一次
 *   曝光機會，錯過一次就等於從系統裡消失。
 *
 * 所以兩支要並存，不是把 `plansDirsOf` 的限定拿掉就好 —— 拿掉的那一刻
 * Task Tracking 會回到「選了 A 卻列出 B、C、D」的老 bug。
 *
 * 沒綁資料夾的專案略過：沒有 rootPath 就沒有 `plans/` 可掃，硬拼會得到
 * 字串 `"/plans"`，掃它不報錯，只是安靜地掃錯地方。
 */
export function plansDirsOfAll(projects: ProjectLike[]): string[] {
  const dirs = projects
    .map((p) => (p.importSummary?.rootPath ?? "").replace(/\/+$/, ""))
    .filter(Boolean)
    .map((root) => `${root}/plans`);
  // 去重：同一個資料夾綁在兩個專案上時，重複目錄會讓同一份報告被掃回兩次，
  // badge 的數字直接翻倍。
  return [...new Set(dirs)];
}

/**
 * 要掃 OpenSpec 的專案根目錄。
 *
 * 跟 `plansDirsOf` 同一條規矩：**只看當前選取的專案**，沒有就回空陣列。
 * 傳的是專案根目錄而不是 `openspec/changes`，因為「往下一層、跳過 archive」
 * 那段邏輯屬於 Rust（它才知道哪些是目錄），前端不該自己拼那條路徑。
 */
export function openspecRootsOf(
  projects: ProjectLike[],
  activeProjectId?: string | null,
): string[] {
  const scoped = activeProjectId ? projects.filter((p) => p.id === activeProjectId) : [];
  return [
    ...new Set(
      scoped.map((p) => (p.importSummary?.rootPath ?? "").replace(/\/+$/, "")).filter(Boolean),
    ),
  ];
}
