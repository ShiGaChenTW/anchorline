/**
 * 「整份 PRD 範本」→ 章節骨架。
 *
 * ## 為什麼需要這一步
 *
 * `full` 範本在資料上只是一段 Markdown（`Template.body`），而 PRD 章節是
 * 一組有 id／編號／標題／欄位的結構。以前兩者沒有橋：選了整份範本，那段
 * Markdown 會被**整坨倒進最後一章「自訂章節」的一個 textarea**，等於把一份
 * 十節的 PRD 塞進一格。範本的編號與命名全部丟失。
 *
 * 這支就是那座橋：讀 Markdown 的標題階層，產出 `Section[]`。
 *
 * ## 編號與命名一律照範本
 *
 * `## 1. 問題` → `n = "1"`、`title = "問題"`。範本自己寫了什麼編號就用什麼，
 * 不重新編號 —— 使用者選這份範本就是要它的規格，我們把 `01` 硬套回去等於
 * 沒有採用它。沒寫編號的（`## 問題`）才依序補 `01`、`02`。
 *
 * 純函式，零 I/O、零 DOM。
 */
import type { FieldDef, Section } from "../data/types";

/** `## 1. 問題` / `### 2.1 邊界` / `## 問題` 都要吃 */
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
/** 標題前綴的編號：`1.`、`2.1`、`3)`、`第 4 章`（取數字部分） */
const NUM_PREFIX_RE = /^\s*(?:第\s*)?(\d+(?:[.\-]\d+)*)\s*[.、)）:：章節]?\s*(.*)$/;

export type ParsedSection = {
  id: string;
  n: string;
  title: string;
  /** 這一節標題底下、下一個同級或更高級標題之前的原文 */
  body: string;
  /** 標題階層（`##` = 2）。決定誰是子章節 */
  level: number;
};

/**
 * 把整份範本切成章節。
 *
 * **取最淺的那一層當章節**：有些範本用 `#` 當文件標題、`##` 當章節；有些
 * 直接用 `#` 當章節。硬寫死 `##` 會讓第二種範本切出 0 節（然後靜默退回
 * 「整坨倒進一格」的舊行為，而且沒有人會發現）。
 *
 * 文件層級的單一 `#` 標題（整份只有一個、而且在最前面）視為文件名，不算章節。
 */
export function splitTemplate(md: string): ParsedSection[] {
  const lines = (md ?? "").split(/\r?\n/);
  const heads: { level: number; text: string; line: number }[] = [];
  let inFence = false;
  lines.forEach((raw, i) => {
    // 程式碼區塊裡的 `#` 是註解不是標題
    if (/^\s*```/.test(raw)) inFence = !inFence;
    if (inFence) return;
    const m = raw.match(HEADING_RE);
    if (m) heads.push({ level: m[1]!.length, text: m[2]!.trim(), line: i });
  });
  if (!heads.length) return [];

  const levels = [...new Set(heads.map((h) => h.level))].sort((a, b) => a - b);
  let sectionLevel = levels[0]!;
  // 只有一個最淺標題 = 文件名，章節在下一層
  if (heads.filter((h) => h.level === sectionLevel).length === 1 && levels.length > 1) {
    sectionLevel = levels[1]!;
  }

  const picked = heads.filter((h) => h.level <= sectionLevel);
  const out: ParsedSection[] = [];
  const usedIds = new Set<string>();

  picked.forEach((h, i) => {
    if (h.level < sectionLevel) return; // 文件名那一行
    const end = picked[i + 1]?.line ?? lines.length;
    const body = lines.slice(h.line + 1, end).join("\n").trim();
    const m = h.text.match(NUM_PREFIX_RE);
    const hasNum = Boolean(m?.[1]);
    const title = (hasNum ? m![2] : h.text).trim() || h.text.trim();
    const n = hasNum ? m![1]! : String(out.length + 1).padStart(2, "0");
    out.push({ id: uniqueId(title, n, usedIds), n, title, body, level: h.level });
  });

  return out;
}

/**
 * 章節 id。
 *
 * 用 slug 而不是流水號：id 是正文的鍵（`projectSectionValues[sectionId]`），
 * 流水號會在使用者刪掉一節之後把後面每一節的正文都錯位一格。
 * 中文標題產不出 ASCII slug 時退回 `sec-<編號>`，仍然穩定。
 */
function uniqueId(title: string, n: string, used: Set<string>): string {
  const ascii = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  let base = ascii || `sec-${n.replace(/\./g, "-")}`;
  let id = base;
  let k = 2;
  while (used.has(id)) id = `${base}-${k++}`;
  used.add(id);
  return id;
}

/**
 * 範本 → 可以直接餵給編輯台的 `Section[]`。
 *
 * 每一節給**一個 textarea 欄位**，內容預填範本原文。不去猜範本裡的
 * 「欄位」該怎麼切 —— 範本的內文形式差異極大（表格、清單、散文），
 * 猜錯的成本是使用者得先把我們切壞的東西拼回去。要細分欄位，
 * 之後在編輯台手動加，那是他自己的決定。
 */
export function sectionsFromTemplate(md: string, opts: { title?: string } = {}): Section[] {
  const parsed = splitTemplate(md);
  if (!parsed.length) return [];
  return parsed.map((p) => {
    const field: FieldDef = {
      key: "body",
      label: p.title,
      hint: "",
      type: "textarea",
      rows: 12,
      value: "",
    };
    return {
      id: p.id,
      n: p.n,
      title: p.title,
      desc: opts.title ? `來自範本「${opts.title}」` : "來自整份 PRD 範本",
      status: "empty",
      guide: p.body ? p.body.slice(0, 400) : "",
      tips: [],
      example: p.body,
      fields: [field],
      checks: [],
      score: 0,
    };
  });
}

/** 章節原文（範本的示範內容）→ 預填草稿用的欄位值 */
export function seedValuesFromTemplate(md: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const p of splitTemplate(md)) out[p.id] = { body: p.body };
  return out;
}

// ── 套用前的影響評估 ──────────────────────────────────────────

export type ApplyPlan = {
  /** 套用後會有的章節 */
  incoming: { id: string; n: string; title: string }[];
  /** 目前的章節，以及它會不會被換掉、裡面有沒有寫過東西 */
  current: { id: string; n: string; title: string; hasContent: boolean; kept: boolean }[];
  /**
   * 有內容、但套用後不存在的章節數。
   *
   * 這是唯一真正會痛的一件事：那些字不會被刪，但畫面上再也看不到它們
   * （只有匯出時才會冒出來）。使用者按下去之前必須知道這個數字。
   */
  orphans: number;
};

/**
 * 套用會發生什麼事 —— 純函式，給預覽畫面用。
 *
 * 比對用 **id**，不是標題：標題一樣但 id 不同的兩節，正文本來就不通用。
 */
export function planApply(
  current: readonly { id: string; n: string; title: string }[],
  incoming: readonly { id: string; n: string; title: string }[],
  values: Record<string, Record<string, string>> = {},
): ApplyPlan {
  const nextIds = new Set(incoming.map((s) => s.id));
  const hasText = (id: string) =>
    Object.values(values[id] ?? {}).some((v) => String(v ?? "").trim().length > 0);

  const rows = current.map((s) => ({
    id: s.id,
    n: s.n,
    title: s.title,
    hasContent: hasText(s.id),
    kept: nextIds.has(s.id),
  }));

  return {
    incoming: incoming.map((s) => ({ id: s.id, n: s.n, title: s.title })),
    current: rows,
    orphans: rows.filter((r) => !r.kept && r.hasContent).length,
  };
}
