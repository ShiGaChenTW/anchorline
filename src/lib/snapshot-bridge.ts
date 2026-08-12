/**
 * 專案快照的 I/O 端。判定全在 `project-snapshot.ts`（純函式），這裡只取資料。
 *
 * ## 為什麼要共用
 *
 * 兩個地方需要快照：OpenSpec 入口的 change 撰寫、PRD 審閱監控的章節撰寫。
 * 兩邊各寫一份的話，「什麼算落後」「檔名長什麼樣」會慢慢分岔，
 * 而症狀是同一個專案在兩頁顯示不同的快照狀態。
 *
 * 也因為共用，**讀一次資料夾兩邊都算數** —— 不必為了另一頁再掃一遍。
 */
import { isNative, isUnavailable, native } from "./native";
import {
  buildSnapshot,
  latestSnapshot,
  snapshotFileName,
  staleness,
  type Staleness,
} from "./project-snapshot";

export type SnapshotState = {
  /** 這個專案需不需要快照。false = 新專案（沒綁資料夾），走問答 */
  required: boolean;
  /**
   * 有資料夾但這裡讀不到（瀏覽器版沒有原生橋）。
   *
   * 這跟「新專案」是兩件事，原本混在一起講 —— 一個綁好資料夾的專案在
   * 瀏覽器裡會被說成「新專案，沒有資料夾可讀」，那是假的。
   * 讀不到就不能強制，但要說出真正的原因。
   */
  unavailable: boolean;
  /** 最新快照的時間。null = 沒有 */
  at: Date | null;
  name: string;
  /** 有快照時才算得出來 */
  stale: Staleness | null;
};

export const NO_SNAPSHOT: SnapshotState = { required: false, unavailable: false, at: null, name: "", stale: null };

/**
 * 讀目前狀態。
 *
 * 讀不到一律當「沒有快照」，不是錯誤 —— 但既有專案沒有快照要擋住撰寫，
 * 所以這個回傳值會直接決定按鈕能不能按。
 */
export async function readSnapshotState(
  rootPath: string | undefined,
  commitTimes: readonly string[] = [],
  nowMs: number = Date.now(),
): Promise<SnapshotState> {
  if (!rootPath) return NO_SNAPSHOT;
  if (!isNative()) return { ...NO_SNAPSHOT, required: true, unavailable: true };
  try {
    const latest = latestSnapshot(await native.listSnapshots(rootPath));
    if (!latest) return { required: true, unavailable: false, at: null, name: "", stale: null };
    return {
      required: true,
      unavailable: false,
      at: latest.at,
      name: latest.name,
      stale: staleness(latest.at, commitTimes, nowMs),
    };
  } catch {
    return { required: true, unavailable: false, at: null, name: "", stale: null };
  }
}

export type ScanResult =
  | { ok: true; files: number; truncated: boolean; path: string }
  | { ok: false; reason: string };

/** 掃描並寫出一份新快照。**不覆寫** —— 同一分鐘內重複按會被原生端擋下。 */
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

/** 讀回快照全文，給模型當背景。呼叫端負責夾長度（`clampForContext`）。 */
export async function readSnapshotText(rootPath: string, name: string): Promise<string> {
  if (!name || !isNative()) return "";
  try {
    const r = await native.readFile(`${rootPath}/.anchorline/context/${name}`);
    return r.text;
  } catch {
    return "";
  }
}

/** 一句話說明目前狀態。兩頁共用，免得同一件事在兩邊講法不同。 */
export function snapshotLine(s: SnapshotState, ageLabel: string): string {
  if (!s.required) return "新專案，沒有資料夾可讀 —— 用問答提供背景。";
  // 讀不到就不能強制，但要說出真正的原因，不要假裝它是新專案
  if (s.unavailable) return "瀏覽器版讀不到資料夾，無法建立快照 —— 桌面版才有這道前置。";
  if (!s.at) return "還沒讀過這個專案 —— 先讀一次資料夾才能撰寫。";
  if (s.stale?.stale) {
    const c = s.stale.commitsBehind;
    return `快照是 ${ageLabel}做的${c ? `，之後又有 ${c} 筆 commit` : ""}。要不要重讀？`;
  }
  return `快照 ${ageLabel}（${s.name}）`;
}
