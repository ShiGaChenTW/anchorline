/**
 * SSE 串流的切行邏輯。
 *
 * 獨立成一支的理由跟 prd-versions / comment-scope 一樣：`ai-client.ts` 的相依鏈
 * 用到 Vite 專屬的 `import.meta.glob`，在 bun test 裡載不進來。
 *
 * 而這段邏輯正是最該被測的那種 —— SSE 的 chunk 邊界**不保證落在換行上**，
 * 一個 JSON 物件可能被切成兩半。緩衝到看見 `\n` 才處理是唯一正確的做法；
 * 少了它會在長回應時隨機噴 parse 錯誤，難重現也難歸因。
 */

/** 取出所有「已完整」的事件，回傳尚未收完的半行 */
export function drainSseLines(buf: string): { events: unknown[]; rest: string } {
  const events: unknown[] = [];
  let rest = buf;
  let nl: number;
  while ((nl = rest.indexOf("\n")) >= 0) {
    const line = rest.slice(0, nl).trim();
    rest = rest.slice(nl + 1);
    if (!line || line.startsWith(":")) continue;
    const payload = line.startsWith("data:") ? line.slice(5).trim() : line;
    if (!payload || payload === "[DONE]") continue;
    try {
      events.push(JSON.parse(payload));
    } catch {
      /* event: 名稱之類的非 JSON 行直接略過 */
    }
  }
  return { events, rest };
}
