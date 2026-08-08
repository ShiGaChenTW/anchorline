/**
 * openspec / gh 的資料通道（桌面版）。形狀照抄 `tracking-bridge.ts`。
 *
 * ## 分層刷新 —— 這是本檔存在的主要理由
 *
 * `trackingScan` 是本地 stat，1 秒一次沒問題。`gh search prs` 實測 **1.9 秒**，
 * 而且走 Search API（30 req/min）。把它放進同一個 1 秒迴圈會做到兩件壞事：
 * 畫面卡住，以及很快撞到 rate limit。
 *
 * 所以：本地資料 1 秒、GitHub 60 秒、而且**多專案共用同一次查詢**
 * （`gh search --author=@me` 本來就是跨 repo 的，沒有理由每個專案各打一次）。
 * 取得時間一律回傳給 UI 標新鮮度——網路資料不標新鮮度，使用者會以為是即時的。
 */
import { GH_REFRESH_MS, parsePrSearch, type GhResult } from "./gh-status";
import {
  parseOpenspecList,
  parseOpenspecStatus,
  type OpenspecChange,
  type OpenspecResult,
} from "./openspec-status";
import { isNative, isUnavailable, native } from "./native";

export function canQueryStatus(): boolean {
  return isNative();
}

/** 一個專案的 openspec 狀態。CLI 不在／不是 openspec 專案 → available:false，不是錯誤。 */
export async function requestOpenspecStatus(folderPath: string): Promise<OpenspecResult> {
  const r = await native.openspecStatus(folderPath);
  if (isUnavailable(r)) return { available: false, reason: r.message };

  // list 只用來確認有 change；判讀一律走 status，兩邊不重複解析
  const listed = parseOpenspecList(r.list ?? "");
  const changes = (r.statuses ?? [])
    .map(parseOpenspecStatus)
    .filter((c): c is OpenspecChange => c !== null);
  // status 全掛但 list 有東西 → 誠實回報，別假裝沒有 change
  if (!changes.length && listed.length) {
    return { available: false, reason: `${listed.length} 個 change 讀不到狀態` };
  }
  return { available: true, changes };
}

/** 跨 repo 的 open PR。`gh search` 本來就是跨 repo，所以全 App 共用一次查詢。 */
export async function requestGhStatus(): Promise<GhResult> {
  const r = await native.ghStatus();
  if (isUnavailable(r)) return { available: false, reason: r.message };
  return {
    available: true,
    prs: parsePrSearch(r.raw ?? ""),
    fetchedAt: r.fetchedAt ?? new Date().toISOString(),
  };
}

/**
 * GitHub 狀態的單一快取。
 *
 * 全域一份是刻意的：`gh search --author=@me` 的結果與「現在看哪個專案」無關，
 * 每個專案各存一份只會讓同一份資料被打 N 次。
 */
let ghCache: { at: number; result: GhResult } | null = null;
let ghInflight: Promise<GhResult> | null = null;

/**
 * 拿 GitHub 狀態，60 秒內重複呼叫直接回快取。
 *
 * `ghInflight` 去重同時發出的請求——1 秒迴圈裡三個元件各叫一次的話，
 * 沒有它就是三個 process 同時在跑 gh。
 *
 * @param nowMs 可注入，測試才驗得了過期邏輯
 */
export async function getGhStatusCached(
  nowMs: number = Date.now(),
  fetcher: () => Promise<GhResult> = requestGhStatus
): Promise<GhResult> {
  if (ghCache && nowMs - ghCache.at < GH_REFRESH_MS) return ghCache.result;
  if (ghInflight) return ghInflight;
  ghInflight = fetcher()
    .then((result) => {
      ghCache = { at: nowMs, result };
      return result;
    })
    .catch((e: Error) => {
      // 失敗不寫快取——下一輪應該重試，而不是把錯誤黏 60 秒
      const fail: GhResult = { available: false, reason: e.message };
      return fail;
    })
    .finally(() => {
      ghInflight = null;
    });
  return ghInflight;
}

/** 測試與「手動刷新」按鈕用。 */
export function invalidateGhCache(): void {
  ghCache = null;
}
