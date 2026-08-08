/**
 * 決策紀錄（ADR）—— Q3「為什麼會變成這樣」。
 *
 * ## 為什麼讀 ISA 而不是另建 decisions/
 *
 * 這台機器上的工作流已經全面走 ISA，而 ISA 的 `## Decisions` 與 `## Changelog`
 * 就是 ADR：前者是「當時做了什麼選擇、為什麼」，後者是 Deutsch 的
 * conjecture / refutation / learning 三段式。另建一套 `decisions/` 等於要人
 * 同一件事寫兩次，而寫兩次的下場永遠是其中一份過期。
 *
 * 代價是綁定 ISA 格式。所以解析器**對缺漏容忍**：認不得的行就跳過，
 * 不要求檔案長得完美。
 *
 * 2026 年 ADR 復甦的理由很直白：AI agent 現在寫掉大部分程式碼，而看不到
 * 「為什麼」的 agent 會很開心地把理由重構掉。這個檔就是那道防線。
 *
 * 純函式、零 I/O。
 */

export type Decision = {
  /** ISA 的 Decisions 是 `- YYYY-MM-DD — 內容`；抓不到日期就留空 */
  date: string;
  text: string;
  /** `refined:` 前綴代表這是對先前理解的修正，不是新決定 */
  refined: boolean;
};

/** Deutsch 三段式。四個欄位缺一不可，缺的就不是一筆完整的 changelog。 */
export type ChangelogEntry = {
  conjectured: string;
  refutedBy: string;
  learned: string;
  criterionNow: string;
};

function sectionOf(text: string, heading: string): string[] {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let inside = false;
  for (const raw of lines) {
    const s = raw.trimEnd();
    if (/^##\s+/.test(s.trim())) {
      inside = s.trim().replace(/^##\s+/, "").toLowerCase() === heading.toLowerCase();
      continue;
    }
    if (inside) out.push(s);
  }
  return out;
}

/** `- **2026-08-09** — 內容` 或 `- 2026-08-09 — 內容`，兩種都吃。 */
const DECISION_RE = /^-\s+(?:\*\*)?(\d{4}-\d{2}-\d{2}|\d{2}:\d{2})?(?:\*\*)?\s*(?:[—–-]\s*)?(.*)$/;

export function parseDecisions(isaText: string): Decision[] {
  const out: Decision[] = [];
  for (const line of sectionOf(isaText, "Decisions")) {
    const s = line.trim();
    if (!s.startsWith("- ")) continue;
    const m = s.match(DECISION_RE);
    if (!m) continue;
    const body = (m[2] ?? "").trim();
    if (!body) continue;
    out.push({
      date: m[1] ?? "",
      text: body.replace(/^refined:\s*/i, ""),
      refined: /^refined:/i.test(body),
    });
  }
  return out;
}

/**
 * Changelog 的三段式。**四個欄位齊全才算一筆**——半筆 C/R/L 比沒有更糟，
 * 它看起來像有解釋，實際上沒有。
 */
export function parseChangelog(isaText: string): ChangelogEntry[] {
  const lines = sectionOf(isaText, "Changelog");
  const out: ChangelogEntry[] = [];
  let cur: Partial<ChangelogEntry> = {};

  const grab = (s: string, key: string): string | null => {
    const re = new RegExp(`\\*\\*${key}\\*\\*\\s*:?\\s*(.*)$`, "i");
    return s.match(re)?.[1]?.trim() ?? null;
  };

  for (const raw of lines) {
    const s = raw.trim().replace(/^-\s*/, "");
    const c = grab(s, "conjectured");
    if (c !== null) {
      if (isComplete(cur)) out.push(cur as ChangelogEntry);
      cur = { conjectured: c };
      continue;
    }
    const r = grab(s, "refuted_by");
    if (r !== null) cur.refutedBy = r;
    const l = grab(s, "learned");
    if (l !== null) cur.learned = l;
    const n = grab(s, "criterion_now");
    if (n !== null) cur.criterionNow = n;
  }
  if (isComplete(cur)) out.push(cur as ChangelogEntry);
  return out;
}

function isComplete(e: Partial<ChangelogEntry>): boolean {
  return Boolean(e.conjectured && e.refutedBy && e.learned && e.criterionNow);
}

/**
 * 決策 → 事件輸入。`subject` 指向受影響的 task／section，證據區才串得起來。
 *
 * `event_id` 由日期＋內容雜湊而成——**這是唯一一處允許從內容推導 id 的地方**，
 * 因為 ISA 的決策沒有自己的錨點，而重複解析同一份 ISA 必須得到同一筆事件。
 * 代價是改一個錯字會產生新事件；對決策紀錄來說，那其實是想要的行為。
 */
export function decisionEventSeeds(
  decisions: Decision[],
  project: string,
  subjectOf: (d: Decision) => string = () => "isa"
): { id: string; project: string; kind: "decision.record"; subject: string; ts: string; text: string }[] {
  return decisions.map((d) => ({
    id: `dec-${stableHash(`${d.date}|${d.text}`)}`,
    project,
    kind: "decision.record" as const,
    subject: subjectOf(d),
    ts: d.date.includes("-") ? `${d.date}T00:00:00Z` : new Date().toISOString(),
    text: d.text,
  }));
}

function stableHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
