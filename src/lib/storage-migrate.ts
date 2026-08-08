/**
 * 一次性 localStorage key 遷移：`specforge:*` → `anchorline:*`
 *
 * 改名 SpecForge → Anchorline 動到了每一個 storage key。沒有這段的話，
 * 改名當天使用者開起來會看到空的專案清單與空的 PRD 內文 —— 資料其實還在，
 * 只是掛在沒有人再去讀的舊 key 上。那比真的掉資料更糟：他會以為掉了。
 *
 * 在 module scope 執行（不是匯出一個要記得呼叫的函式）。ES module 的 import
 * 會在匯入端的程式碼之前求值，所以只要 theme.ts 匯入它，就保證跑在任何
 * 頁面程式碼讀 storage 之前。
 *
 * ponytail: 舊 key 用複製不用搬移，且不刪除 —— 萬一要退版，舊版本還讀得到。
 * 確認不再需要之後（下一個 minor）整段連同這個檔一起刪掉。
 */
const OLD = "specforge:";
const NEW = "anchorline:";
const DONE = "anchorline:storage-migrated:v1";

export function migrateStorageKeys(store: Storage): number {
  if (store.getItem(DONE)) return 0;

  let moved = 0;
  // 先收集再寫入 —— 邊列舉邊 setItem 會讓 key(i) 的索引在迭代中位移
  const pending: Array<[string, string]> = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key?.startsWith(OLD)) continue;
    const next = NEW + key.slice(OLD.length);
    if (store.getItem(next) !== null) continue; // 新 key 已有值，不覆蓋
    const val = store.getItem(key);
    if (val !== null) pending.push([next, val]);
  }

  for (const [key, val] of pending) {
    try {
      store.setItem(key, val);
      moved++;
    } catch {
      // 配額爆了就停手：搬一半好過搬到一半炸掉整個開機流程
      break;
    }
  }

  store.setItem(DONE, String(moved));
  return moved;
}

if (typeof localStorage !== "undefined") {
  try {
    migrateStorageKeys(localStorage);
  } catch {
    // 隱私模式／storage 被停用 —— 不是錯誤，只是沒有東西可以搬
  }
}
