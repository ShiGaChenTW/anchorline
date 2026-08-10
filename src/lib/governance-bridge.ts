/**
 * 治理覆蓋率的 I/O 端。判定全在 `governance.ts`（純函式），這裡只負責取資料。
 *
 * 與 `tracking-bridge` / `status-bridge` 同一個形狀：一個 `canX()` 給畫面決定
 * 要不要顯示，一個 `requestX()` 真的去要。
 */
import { dedupe, parseLog } from "./event-log";
import { governanceCoverage, EMPTY_COVERAGE, type GovernanceCoverage } from "./governance";
import { isNative, native } from "./native";

export type CoverageResult = {
  coverage: GovernanceCoverage;
  /** 因為分片數或位元組上限少讀了。統計會偏低，畫面必須講出來。 */
  truncated: boolean;
  /** 壞掉而被跳過的行數。JSONL 壞一行只影響一行，這是它相對 SQLite 的優點。 */
  skipped: number;
};

export const EMPTY_RESULT: CoverageResult = {
  coverage: EMPTY_COVERAGE,
  truncated: false,
  skipped: 0,
};

/** 只有桌面版讀得到磁碟上的稽核軌跡。 */
export function canReadCoverage(): boolean {
  return isNative();
}

/**
 * 讀一個專案的治理覆蓋率。
 *
 * 讀不到就回空結果，不 throw —— 這張卡片是附加資訊，不該讓整頁儀表板掛掉。
 * 「沒開通治理」與「讀取失敗」在畫面上都是「尚未開始治理」，兩者都不是錯誤。
 */
export async function requestCoverage(projectRoot: string): Promise<CoverageResult> {
  if (!canReadCoverage() || !projectRoot) return EMPTY_RESULT;
  try {
    const { text, truncated } = await native.readLog(projectRoot);
    const { events, skipped } = parseLog(text);
    return { coverage: governanceCoverage(dedupe(events)), truncated, skipped };
  } catch {
    return EMPTY_RESULT;
  }
}
