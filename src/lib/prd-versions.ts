/**
 * PRD 版本線的純邏輯。
 *
 * git 心智模型：working copy →（送審）commit →（核准）merge。
 *
 * 為什麼獨立成一支而不是寫在 store 裡：`store.ts` 的相依鏈用到 Vite 專屬的
 * `import.meta.glob`，在 bun test 裡載不進來 —— 所以 store 至今零測試。
 * 版本語意（哪一份是主線、這一輪改了什麼、送審該不該被擋）是最不該靠
 * 手動點擊驗證的部分，把它放在純函式裡才進得了測試網。
 */
import { markChangedLines, type LineMark } from "./file-history";
import type { PrdVersion } from "../data/types";

/** 整份 PRD：sectionId → fieldKey → 內容 */
export type Docs = Record<string, Record<string, string>>;
/** 草稿袋：形狀同 Docs，但只含「改過的欄位」 */
export type Drafts = Record<string, Record<string, string>>;

/** 主線 = 最近一次核准合併。沒有就代表這份 PRD 還沒被核准過。 */
export function pickBaseline(versions: readonly PrdVersion[]): PrdVersion | null {
  return versions.find((v) => v.kind === "merge") ?? null;
}

/** 審閱者看的那一份 = 最近一次送審的快照 */
export function pickLatestCommit(versions: readonly PrdVersion[]): PrdVersion | null {
  return versions.find((v) => v.kind === "commit") ?? null;
}

/**
 * 把草稿疊在已儲存的正文上，得到「畫面上現在顯示的內容」。
 * 不改動任何一邊 —— 呼叫端拿去算 diff 或渲染。
 */
export function applyDrafts(saved: Docs, drafts: Drafts): Docs {
  if (!Object.keys(drafts).length) return saved;
  const out: Docs = { ...saved };
  for (const [sid, fields] of Object.entries(drafts)) {
    out[sid] = { ...(saved[sid] ?? {}), ...fields };
  }
  return out;
}

/**
 * 草稿寫入的正規化：跟已儲存值相同就不該留在草稿裡。
 *
 * 少了這一步，「改了又改回去」會永遠停在 dirty 狀態 —— 使用者看著一模一樣
 * 的文字卻被擋著不能送審，而且找不到哪裡不一樣。
 */
export function nextDraftValue(
  sectionDraft: Record<string, string> | undefined,
  key: string,
  value: string,
  savedValue: string,
): Record<string, string> | undefined {
  const sec = { ...(sectionDraft ?? {}) };
  if (value === savedValue) delete sec[key];
  else sec[key] = value;
  return Object.keys(sec).length ? sec : undefined;
}

export type FieldDiff = {
  sectionId: string;
  key: string;
  before: string;
  after: string;
  marks: LineMark[];
};

/**
 * 兩份快照之間的差異，逐欄位。
 *
 * 涵蓋三種：改過的欄位、新增的欄位（before 為空）、被清空的欄位
 * （after 為空）。整個章節被移除時，它底下每個有內容的欄位各算一筆 ——
 * 審閱者需要看到「這一節整個不見了」，而不是靜悄悄少一段。
 */
export function diffDocs(before: Docs, after: Docs): FieldDiff[] {
  const out: FieldDiff[] = [];
  const sectionIds = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const sectionId of [...sectionIds].sort()) {
    const b = before[sectionId] ?? {};
    const a = after[sectionId] ?? {};
    const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
    for (const key of [...keys].sort()) {
      const bv = b[key] ?? "";
      const av = a[key] ?? "";
      if (bv === av) continue;
      out.push({ sectionId, key, before: bv, after: av, marks: markChangedLines(bv, av) });
    }
  }
  return out;
}

/** 這一輪相對主線改了幾個欄位 —— 給送審前的確認畫面用 */
export function changedFieldCount(before: Docs, after: Docs): number {
  return diffDocs(before, after).length;
}

/**
 * 送審前的把關。
 *
 * 有未儲存的草稿一律擋下：送出一份「跟你螢幕上看到的不一樣」的版本，
 * 是最難察覺也最貴的錯誤 —— 審閱者核准的東西跟作者以為送出的東西不同，
 * 而兩邊都不會發現。
 */
export function canCommit(opts: {
  hasUnsaved: boolean;
  changedFields: number;
}): { ok: boolean; reason?: string } {
  if (opts.hasUnsaved) {
    return { ok: false, reason: "還有未儲存的變更 —— 先儲存，送審才會包含它們" };
  }
  if (opts.changedFields === 0) {
    return { ok: false, reason: "跟主線沒有差異，沒有東西可以送審" };
  }
  return { ok: true };
}
