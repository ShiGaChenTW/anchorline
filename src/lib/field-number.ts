/**
 * 子章節（欄位）編號 —— `01` 章的第 1 個欄位是 `011`。
 *
 * 這個編號是 PRD 裡講得出口的座標（「012 給誰還沒寫」）。它原本只活在
 * 大綱裡，編輯區、AI 潤色工作台、審閱正文各自只顯示名稱 —— 同一個欄位
 * 在不同畫面有沒有編號，取決於你在哪裡看到它，座標就失去意義了。
 * 收在一個函式裡，每個顯示點用同一套算法。
 *
 * 編號從欄位在 `section.fields` 的**位置**算，不存在欄位上 ——
 * 插入或刪除欄位時順延是自動的，存起來反而要遷移。
 */
import type { Section } from "../data/types";

/** `011`、`012`… 位置從 0 起算 */
export function fieldNo(sectionN: string, index: number): string {
  return `${sectionN}${index + 1}`;
}

/** `011 專案功能說明與願景` —— 找不到 key 就退回原標籤，不長出假編號 */
export function numberedFieldLabel(section: Section, key: string): string {
  const i = section.fields.findIndex((f) => f.key === key);
  const f = section.fields[i];
  if (!f) return key;
  return i >= 0 ? `${fieldNo(section.n, i)} ${f.label}` : f.label;
}
