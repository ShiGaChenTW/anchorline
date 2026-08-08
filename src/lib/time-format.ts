/** 側欄卡片用：相對／本地時間顯示 */

export function formatLastUpdate(isoOrLabel?: string | null): string {
  if (!isoOrLabel) return "尚無更新";
  // 已是中文相對字串
  if (/剛剛|分鐘|小時|昨天|天前|週前|月前/.test(isoOrLabel) && !isoOrLabel.includes("T")) {
    return isoOrLabel;
  }
  const d = new Date(isoOrLabel);
  if (Number.isNaN(d.getTime())) return isoOrLabel;

  const now = Date.now();
  const diff = Math.max(0, now - d.getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return "剛剛更新";
  if (min < 60) return `${min} 分鐘前更新`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小時前更新`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "昨天更新";
  if (day < 7) return `${day} 天前更新`;

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const thisYear = new Date().getFullYear();
  if (y === thisYear) return `${m}/${dd} ${hh}:${mm} 更新`;
  return `${y}/${m}/${dd} 更新`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 「多久以前」——時間盲對策的共用格式。
 *
 * 與 `formatLastUpdate` 的差別有二，兩者都是刻意的：
 * 1. **`nowMs` 可注入**，所以測得動。`formatLastUpdate` 內建 `Date.now()`，寫不了測試。
 * 2. **超過一週不退回絕對日期。** ADHD 的核心缺損是時間盲——「2026-07-03」要人自己
 *    心算才知道多久，「38 天」不用。焦點卡與 PR 雷達要的是後者。
 *
 * @param nowMs 必須可注入
 */
export function sinceLabel(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return "從未";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "從未";
  const diff = Math.max(0, nowMs - t);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "剛剛";
  if (min < 60) return `${min} 分鐘前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小時前`;
  return `${Math.floor(hr / 24)} 天前`;
}

/** 與 `sinceLabel` 同源，但只回天數 —— 給排序與門檻判斷用。 */
export function daysSince(iso: string | null | undefined, nowMs: number): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Math.floor(Math.max(0, nowMs - t) / 86400000);
}
