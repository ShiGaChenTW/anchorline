/** Rough token estimate (~1 token per 4 chars). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Format a token count for compact display: 938, 1.2k, 23k. */
export function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}
