/**
 * 剪貼簿裡的圖。
 *
 * 兩條路都要走：paste 事件帶得到 `clipboardData`（⌘V 的正常情況），
 * 而「按鈕貼上」沒有事件，只能問 `navigator.clipboard.read()`——後者在
 * 權限被拒時會 throw，當成沒圖處理，不要讓畫面跳紅字。
 *
 * `items` 與 `files` 兩邊都掃：截圖工具（CleanShot 這類）放的是檔案，
 * 只看 `items` 會漏掉。
 */
export async function blobsFromClipboard(e?: ClipboardEvent): Promise<Blob[]> {
  const out: Blob[] = [];
  const fromEvent = e?.clipboardData;
  if (fromEvent) {
    for (const item of Array.from(fromEvent.items)) {
      if (!item.type.startsWith("image/")) continue;
      const f = item.getAsFile();
      if (f) out.push(f);
    }
    if (fromEvent.files?.length) {
      for (const f of Array.from(fromEvent.files)) {
        if (f.type.startsWith("image/")) out.push(f);
      }
    }
  }
  if (out.length) return out;
  if (!navigator.clipboard?.read) return [];
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith("image/"));
      if (!type) continue;
      out.push(await item.getType(type));
    }
  } catch {
    /* 權限被拒就當沒圖 */
  }
  return out;
}

/** 剪貼簿事件裡有沒有圖 —— 沒有就讓瀏覽器照常貼文字 */
export function clipboardHasImage(e: ClipboardEvent): boolean {
  const d = e.clipboardData;
  if (!d) return false;
  return (
    Array.from(d.items).some((it) => it.type.startsWith("image/")) ||
    Array.from(d.files ?? []).some((f) => f.type.startsWith("image/"))
  );
}
