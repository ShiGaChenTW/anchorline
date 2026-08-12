/**
 * AI 功能的純函式集中地。
 *
 * 為什麼獨立成檔：`ai-client` / `ai-coach` 都 import store →
 * `import.meta.glob`，`bun test` 載不動它們——而這兩個函式
 * （JSON 抽取的兜底、分級門檻）正是最需要被測到的決定性邏輯。
 * 原模組照舊 re-export，呼叫端不用改。
 */

/** 嘗試從模型輸出抽出 JSON 物件 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || text.trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 分級門檻的唯一出處。AI 評估只回 score，grade 一律由這裡算——
 * 讓模型自己發明門檻，同一份內容重跑分級會跳。
 */
export function gradeFromScore(score: number): "S" | "A" | "B" | "C" {
  return score >= 90 ? "S" : score >= 80 ? "A" : score >= 65 ? "B" : "C";
}
