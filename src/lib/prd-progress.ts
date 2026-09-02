/**
 * PRD 完成度 —— 由章節內容推導出來的那個百分比。
 *
 * `Project.pct` 從產品上線至今從來不是推導的：建案寫死 18、Markdown 匯入寫死 8、
 * 資料夾匯入借用掃描分數，之後唯一的更新是 `approveAndLock` 的 `allDone ? 100`。
 * 於是 `flow-layers.ts` 的 L4（`draft && pct >= 25`）在送審之前**永遠不亮** ——
 * 而且不報錯，只是不亮，所以沒有人回報過。這一支是那個數字的唯一產地。
 *
 * **分母一律由呼叫端傳進來**（store 側是 `sectionsForProject()`）：路線會改變
 * 章節數（full 15 / lite 8 / vibe 3），寫死任何一個數字都會讓另外兩檔算錯，
 * 而算錯的症狀同樣是「百分比不動」而非錯誤訊息。
 */
import { CUSTOM_SECTION_ID } from "../data/seed";

/**
 * 一節要有多少字才算「有實質內容」。
 *
 * 不用「非空白就算」：一個字元、一個破折號都會讓百分比跳一格，而 pct 要回答的是
 * 「這份 PRD 寫了多少」，不是「有沒有人碰過鍵盤」。
 *
 * 也刻意不對齊 gate 的門檻（`goals-thin` 是 20、`metrics-missing` 是 30）：
 * gate 回答「合格了沒」，pct 回答「進行到哪」，兩者不是同一個問題 —— 借 gate 的
 * 數字會讓進度條在使用者把每一節都補到合格之前一路停在 0，那正是這次要修的病。
 *
 * 12 大約是一句最短的中文句子，且低於任何一條 gate 的 minLength。
 */
export const SECTION_SUBSTANCE_MIN = 12;

/** 這一節所有欄位的實際字數（各自去頭尾空白後相加，欄位之間不補字） */
export function sectionTextLength(values: Record<string, string> | undefined): number {
  if (!values) return 0;
  return Object.values(values).reduce((n, v) => n + String(v ?? "").trim().length, 0);
}

/** 這一節算不算「有實質內容」 */
export function sectionHasSubstance(
  values: Record<string, string> | undefined,
  min: number = SECTION_SUBSTANCE_MIN,
): boolean {
  return sectionTextLength(values) >= min;
}

/**
 * 章節完成度，0–100 的整數。
 *
 * 自訂章節**不進分母也不進分子**：它是選填的自由區，空著是常態。算進去的話
 * 每份 PRD 的上限都變成「除非你寫了自訂章節，否則到不了 100%」。這與
 * `evaluatePrdGates` 把自訂章節排除在「空白章節數」之外是同一個判斷。
 *
 * 沒有任何可計數的章節時回 0，不是 NaN —— 這個值會直接進 `style="width:N%"`。
 */
export function derivePrdPct(
  sections: readonly { id: string }[],
  values: Record<string, Record<string, string>> | undefined,
  min: number = SECTION_SUBSTANCE_MIN,
): number {
  const counted = sections.filter((s) => s.id !== CUSTOM_SECTION_ID);
  if (!counted.length) return 0;
  const filled = counted.filter((s) => sectionHasSubstance(values?.[s.id], min)).length;
  return Math.round((filled / counted.length) * 100);
}
