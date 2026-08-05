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
