/**
 * 實測說明欄的記憶體草稿層（W1-1）。
 *
 * 症狀（2026-08-15 實機重現）：A 題打完說明、直接按 B 題的結果鈕——結果鈕的
 * `mousedown preventDefault`（Cato F1 修法）讓 A 的 blur 不觸發，寫檔成功後的
 * `render(true)` 重建 DOM，A 還沒存的字無聲消失。寫入失敗那一路（衝突 toast 後
 * `refresh(true)`）同樣會沖掉。草稿層在重繪之間保住畫面上的字。
 *
 * **刻意不用 localStorage**：跨報告/跨 session 會殘留陳舊草稿（見
 * NEXT-VERSION-PLAN 裁決「說明草稿 localStorage 持久化：砍」）。App 關掉就丟，
 * 跟「還沒按存的編輯器內容」同一個心智模型。
 *
 * key 帶報告路徑：錨點每輪重鑄仍是 8 字元隨機值，理論上可撞；帶路徑後
 * 切換報告絕不可能吃到別份的草稿。
 */
const drafts = new Map<string, string>();

function keyOf(path: string, id: string): string {
  return `${path}\n${id}`;
}

/** 使用者打字時同步呼叫（`input` 事件）。 */
export function setNoteDraft(path: string, id: string, value: string): void {
  drafts.set(keyOf(path, id), value);
}

/**
 * 重繪時呼叫：拿磁碟值對帳。
 *
 * 磁碟已經追上草稿（blur 或勾選把它寫回去了）→ 草稿完成使命，自清並回
 * `undefined`；還沒追上 → 回草稿，呼叫端把它塞回 textarea。自清是唯一的
 * 清除路徑——寫檔成功與否都會走到下一次重繪，這裡收斂就不會漏。
 */
export function reconcileNoteDraft(
  path: string,
  id: string,
  diskValue: string,
): string | undefined {
  const k = keyOf(path, id);
  const draft = drafts.get(k);
  if (draft === undefined) return undefined;
  if (draft === diskValue) {
    drafts.delete(k);
    return undefined;
  }
  return draft;
}

/** 測試用：清空全部草稿。 */
export function clearAllNoteDrafts(): void {
  drafts.clear();
}
