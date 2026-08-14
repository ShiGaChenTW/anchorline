/**
 * 「還沒測完的實測報告」—— dashboard 側的一個問題，兩個消費者。
 *
 * ## 為什麼抽出來而不是各自數一次
 *
 * 總覽的「待實測」區塊與側欄 badge 回答的是同一個問題（「有幾份報告在等我
 * 動手」），而那個問題的判定條件有三條：是實測方言、狀態進行中、至少有一題
 * 有錨點。在兩個地方各寫一次，第一次改判定條件就會出現「側欄說 2、點進去
 * 只有 1」—— 而那種不一致沒有任何錯誤訊息，只會讓人不再相信那個數字。
 *
 * ## 方言判定與 tracking 頁一字不差
 *
 * `f.kind !== "openspec" && (isUatText || 檔名 uat-*)` 這一串是從 `tracking.ts`
 * 抄過來的**同一條規則**：兩邊分岔的症狀是「總覽列出來的報告，點進去在
 * Task Tracking 裡不是實測分組」。
 *
 * 只有 `loadPendingUats` 碰橋，判定本身是純函式。
 */
import { canScanPlans, requestTrackingScan, type ScannedPlan } from "./tracking-bridge";
import { isUatText, parseUatReport, uatProgress } from "./uat-parser";

export type PendingUat = {
  /** 絕對路徑。著陸網址與去重都用它 */
  path: string;
  /** 檔名 */
  name: string;
  title: string;
  closed: number;
  total: number;
  mtimeMs: number;
};

/**
 * 掃描結果 → 待實測清單。
 *
 * 「待實測」= 進行中 **且** 至少有一題有錨點。後半是必要的：沒有錨點的題
 * 勾不了（寫回時定位不到那一行），把一份全無錨點的遺留檔列進待辦，等於
 * 給使用者一個點進去也做不了事的項目 —— tracking 頁把那種檔歸進
 * 「沒有步驟的檔案」，這裡的判定要跟它一致。
 */
export function pendingUatsFrom(files: ScannedPlan[]): PendingUat[] {
  const out: PendingUat[] = [];
  for (const f of files) {
    if (f.kind === "openspec") continue;
    if (!isUatText(f.text) && !/^uat-/i.test(f.name)) continue;
    const r = parseUatReport(f.text, f.path);
    if (r.status !== "進行中") continue;
    if (!r.items.some((x) => x.id)) continue;
    const prog = uatProgress(r);
    out.push({
      path: f.path,
      name: f.name,
      title: r.title,
      closed: prog.closed,
      total: prog.total,
      mtimeMs: f.mtimeMs,
    });
  }
  // 最近動過的排前面。NaN（降級路徑沒有真實 mtime）沉底而不是把整個排序弄壞。
  return out.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
}

/**
 * 掃一次磁碟。**非桌面版一律回空陣列** —— 瀏覽器沒有資料通道，
 * 回空是誠實的「這裡看不到」，不是「沒有待實測」。
 *
 * 呼叫端自己算 `plansDirsOf`：這一支刻意不碰 store，才能在測試裡直接餵資料。
 * 橋壞了／逾時也回空陣列 —— 一個 badge 不值得讓整頁噴錯。
 */
export async function loadPendingUats(plansDirs: string[]): Promise<PendingUat[]> {
  if (!canScanPlans() || !plansDirs.length) return [];
  try {
    const scan = await requestTrackingScan(plansDirs, []);
    return pendingUatsFrom(scan.files);
  } catch {
    return [];
  }
}
