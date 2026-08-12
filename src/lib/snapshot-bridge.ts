/**
 * 專案分析報告的 I/O 端。判定全在 `project-snapshot.ts`（純函式），這裡只取資料。
 *
 * ## 為什麼要共用
 *
 * 兩個地方需要分析報告：OpenSpec 入口的 change 撰寫、PRD 審閱監控的章節撰寫。
 * 兩邊各寫一份的話，「什麼算落後」「檔名長什麼樣」會慢慢分岔，
 * 而症狀是同一個專案在兩頁顯示不同的報告狀態。
 *
 * 也因為共用，**讀一次資料夾兩邊都算數** —— 不必為了另一頁再掃一遍。
 */
import { isNative, isUnavailable, native } from "./native";
import {
  buildSnapshot,
  formatBytes,
  latestSnapshot,
  SNAPSHOT_DIR,
  snapshotFileName,
  staleness,
  type Staleness,
} from "./project-snapshot";

export type SnapshotState = {
  /** 這個專案需不需要分析報告。false = 新專案（沒綁資料夾），走問答 */
  required: boolean;
  /**
   * 有資料夾但這裡讀不到（瀏覽器版沒有原生橋）。
   *
   * 這跟「新專案」是兩件事，原本混在一起講 —— 一個綁好資料夾的專案在
   * 瀏覽器裡會被說成「新專案，沒有資料夾可讀」，那是假的。
   * 讀不到就不能強制，但要說出真正的原因。
   */
  unavailable: boolean;
  /** 最新一份報告的時間。null = 沒有 */
  at: Date | null;
  name: string;
  /**
   * 檔案大小。掃描快到像是沒執行過（595 個檔不到一秒），只有檔名的話
   * 沒有任何東西能證明裡面有內容 —— 大小是最便宜的那個證據。
   */
  bytes: number;
  /** 完整路徑，給「開啟」用。`.anchorline` 是隱藏資料夾，Finder 找不到。 */
  path: string;
  /** 有報告時才算得出來 */
  stale: Staleness | null;
};

export const NO_SNAPSHOT: SnapshotState = {
  required: false,
  unavailable: false,
  at: null,
  name: "",
  bytes: 0,
  path: "",
  stale: null,
};

/**
 * 讀目前狀態。
 *
 * 讀不到一律當「沒有報告」，不是錯誤 —— 但既有專案沒有報告要擋住撰寫，
 * 所以這個回傳值會直接決定按鈕能不能按。
 */
export async function readSnapshotState(
  rootPath: string | undefined,
  commitTimes: readonly string[] = [],
  nowMs: number = Date.now(),
): Promise<SnapshotState> {
  if (!rootPath) return NO_SNAPSHOT;
  if (!isNative()) return { ...NO_SNAPSHOT, required: true, unavailable: true };
  const none: SnapshotState = { ...NO_SNAPSHOT, required: true };
  try {
    const latest = latestSnapshot(await native.listSnapshots(rootPath));
    if (!latest) return none;
    return {
      required: true,
      unavailable: false,
      at: latest.at,
      name: latest.name,
      bytes: latest.bytes,
      path: `${rootPath}/${SNAPSHOT_DIR}/${latest.name}`,
      stale: staleness(latest.at, commitTimes, nowMs),
    };
  } catch {
    return none;
  }
}

/** 在 Finder／編輯器裡打開那份報告。`.anchorline` 是隱藏資料夾，翻不到。 */
export async function openSnapshot(path: string): Promise<void> {
  if (!path || !isNative()) return;
  await native.openPath(path);
}

export type ScanResult =
  | { ok: true; files: number; truncated: boolean; path: string }
  | { ok: false; reason: string };

/** 掃描並寫出一份新的分析報告。**不覆寫** —— 同一分鐘內重複按會被原生端擋下。 */
export async function makeSnapshot(
  rootPath: string,
  projectName: string,
  at: Date = new Date(),
): Promise<ScanResult> {
  const scan = await native.scanProject(rootPath);
  if (isUnavailable(scan)) return { ok: false, reason: scan.message };
  const md = buildSnapshot({
    projectName,
    rootPath,
    at,
    files: scan.files,
    gitLine: "",
    truncated: scan.truncated,
  });
  const w = await native.writeSnapshot(rootPath, snapshotFileName(projectName, at), md);
  if (isUnavailable(w)) return { ok: false, reason: w.message };
  return { ok: true, files: scan.files.length, truncated: scan.truncated, path: w.path };
}

/** 讀回報告全文，給模型當背景。呼叫端負責夾長度（`clampForContext`）。 */
export async function readSnapshotText(rootPath: string, name: string): Promise<string> {
  if (!name || !isNative()) return "";
  try {
    const r = await native.readFile(`${rootPath}/.anchorline/context/${name}`);
    return r.text;
  } catch {
    return "";
  }
}

/**
 * 一句話說明目前狀態。兩頁共用，免得同一件事在兩邊講法不同。
 *
 * 有報告時一定帶**大小**：讀 595 個檔不到一秒，畫面上只跳出一個檔名，
 * 看起來就像什麼都沒做。大小是最便宜的「它真的產出來了」的證據。
 */
export function snapshotLine(s: SnapshotState, ageLabel: string): string {
  if (!s.required) return "新專案，沒有資料夾可讀 —— 用問答提供背景。";
  // 讀不到就不能強制，但要說出真正的原因，不要假裝它是新專案
  if (s.unavailable) return "瀏覽器版讀不到資料夾，無法產出分析報告 —— 桌面版才有這道前置。";
  if (!s.at) return "還沒分析過這個專案 —— 先產出一次分析報告才能撰寫。";
  const size = s.bytes ? ` · ${formatBytes(s.bytes)}` : "";
  if (s.stale?.stale) {
    const c = s.stale.commitsBehind;
    return `分析報告是 ${ageLabel}產的${c ? `，之後又有 ${c} 筆 commit` : ""}${size}。要不要重新分析？`;
  }
  return `分析報告 ${ageLabel}${size}（${s.name}）`;
}
