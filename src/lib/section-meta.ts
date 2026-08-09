/**
 * 章節骨架與「使用者標記」的分離。
 *
 * 骨架（title / guide / tips / fields 定義）是領域包的產物，每次載入重算永遠正確。
 * 標記（status / score / checks 勾選）是使用者手動產生的，只有這些需要持久化。
 *
 * 這一層抽出來的唯一理由是可測：`store.ts` 透過 `data/domains/index.ts` 用了
 * `import.meta.glob`，那是 Vite 專屬，`bun test` 載不進來。而這幾個函式正是
 * 資料遷移路徑上最不能出錯的部分——不能因為隔壁有個 glob 就永遠測不到。
 */
import type { Section, SectionMeta } from "../data/types";

export function metaFromSections(sections: Section[]): Record<string, SectionMeta> {
  const out: Record<string, SectionMeta> = {};
  for (const s of sections) {
    out[s.id] = { status: s.status, score: s.score, checks: s.checks.map((c) => ({ ...c })) };
  }
  return out;
}

/**
 * 把使用者標記疊回骨架。
 *
 * 三條規則：骨架沒有的章節，其標記直接丟掉（換領域後的孤兒標記——**標記**可以丟，
 * 正文不行）；checks 以骨架為準，只把 `pass` 疊回去，這樣領域包新增的檢查項
 * 才看得到；骨架有、標記沒有的章節維持骨架預設。
 */
export function applyMeta(
  sections: Section[],
  meta: Record<string, SectionMeta> | undefined,
): Section[] {
  if (!meta) return sections;
  return sections.map((s) => {
    const m = meta[s.id];
    if (!m) return s;
    const passById = new Map(m.checks.map((c) => [c.id, c.pass]));
    return {
      ...s,
      status: m.status,
      score: m.score,
      checks: s.checks.map((c) => ({ ...c, pass: passById.get(c.id) ?? c.pass })),
    };
  });
}

/** 專案宣告的領域名；空的或註冊表裡沒有的一律退回預設，不讓 App 開不起來。 */
export function pickDomain(raw: string | undefined, known: Iterable<string>, fallback: string): string {
  const d = (raw ?? "").trim();
  return d && new Set(known).has(d) ? d : fallback;
}

/**
 * 有正文、但不屬於目前章節集合的 section id。
 * 換領域之後 UI 用它提示「N 個章節不屬於目前領域」——內容還在，只是沒地方顯示。
 */
export function orphanSectionIds(
  sections: Section[],
  sectionValues: Record<string, Record<string, string>>,
): string[] {
  const live = new Set(sections.map((s) => s.id));
  return Object.entries(sectionValues)
    .filter(([id, vals]) => !live.has(id) && Object.values(vals).join("").trim().length > 0)
    .map(([id]) => id);
}
