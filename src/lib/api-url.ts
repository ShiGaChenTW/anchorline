/**
 * 供應商 API 的 URL 組法。
 *
 * 抽出來的理由是可測：`ai-client.ts` 匯入 store（連帶 `import.meta.glob`），
 * `bun test` 載不進去。而 URL 組錯的症狀特別難認——使用者只會看到一個
 * 404 或「連線失敗」，不會知道是自己在端點結尾多打了一個斜線。
 */

/** 去掉結尾斜線。`https://x/v1/` 與 `https://x/v1` 必須是同一件事。 */
export function trimBase(endpoint: string, fallback: string): string {
  return (endpoint?.trim() || fallback).replace(/\/+$/, "");
}

/**
 * Anthropic Messages 端點。
 *
 * 三種使用者會填的寫法都要對：
 *   https://api.anthropic.com          → 補 /v1/messages
 *   https://api.anthropic.com/v1/      → 只補 /messages（不能變成 /v1/v1/messages）
 *   https://proxy/anthropic/v1/messages → 原樣使用
 */
export function anthropicMessagesUrl(endpoint: string): string {
  const base = trimBase(endpoint, "https://api.anthropic.com");
  if (base.includes("/messages")) return base;
  return base.endsWith("/v1") ? `${base}/messages` : `${base}/v1/messages`;
}

/** Anthropic 模型列表端點。同樣不可重複 /v1。 */
export function anthropicModelsUrl(endpoint: string): string {
  const base = trimBase(endpoint, "https://api.anthropic.com");
  if (base.includes("/models")) return base;
  return base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;
}

/** Gemini base。使用者可能填到 /v1beta，也可能只填主機。 */
export function geminiBase(endpoint: string): string {
  const base = trimBase(endpoint, "https://generativelanguage.googleapis.com/v1beta");
  return /\/v\d[a-z]*$/.test(base) ? base : `${base}/v1beta`;
}
