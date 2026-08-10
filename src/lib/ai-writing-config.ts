/**
 * AI 撰寫設定的繼承與遷移。
 *
 * 純函式：不認得 store、不碰 DOM，所以可以直接在 bun test 裡跑。
 * 繼承規則只有一條 —— 領域自己有值就用自己的，沒有就用通用的。
 */
import type { DomainWriteConfig } from "../data/types";

export const BASE_DOMAIN = "generic";

export type ResolvedWriting = {
  globalInstruction: string;
  styleSample: string;
  sectionPrompts: Record<string, string>;
};

/** 可繼承的單值欄位 */
export type InheritableField = "globalInstruction" | "styleSample";

function base(byDomain: Record<string, DomainWriteConfig>): DomainWriteConfig {
  return byDomain[BASE_DOMAIN] ?? {};
}

/**
 * 這個欄位目前是不是沿用通用版本。
 * 通用領域本身永遠算「自訂」—— 它就是基底，沒有上游可繼承。
 */
export function isInherited(
  byDomain: Record<string, DomainWriteConfig>,
  domain: string,
  field: InheritableField,
): boolean {
  if (domain === BASE_DOMAIN) return false;
  return byDomain[domain]?.[field] === undefined;
}

/** 某章節的提示詞是不是沿用通用版本 */
export function isSectionInherited(
  byDomain: Record<string, DomainWriteConfig>,
  domain: string,
  sectionId: string,
): boolean {
  if (domain === BASE_DOMAIN) return false;
  return byDomain[domain]?.sectionPrompts?.[sectionId] === undefined;
}

/** 通用版本的值（顯示在「沿用中」欄位下方，讓使用者看得到自己繼承到什麼） */
export function baseValue(
  byDomain: Record<string, DomainWriteConfig>,
  field: InheritableField,
): string {
  return base(byDomain)[field] ?? "";
}

export function baseSectionValue(
  byDomain: Record<string, DomainWriteConfig>,
  sectionId: string,
): string {
  return base(byDomain).sectionPrompts?.[sectionId] ?? "";
}

/** 實際送進 prompt 的設定 */
export function resolveWriting(
  byDomain: Record<string, DomainWriteConfig>,
  domain: string,
): ResolvedWriting {
  const b = base(byDomain);
  const d = domain === BASE_DOMAIN ? b : (byDomain[domain] ?? {});
  const sections: Record<string, string> = {};
  // 先鋪通用，再讓領域覆蓋 —— 領域限定章節通用沒有，直接落在後半段
  for (const [k, v] of Object.entries(b.sectionPrompts ?? {})) {
    if (v !== undefined) sections[k] = v;
  }
  if (domain !== BASE_DOMAIN) {
    for (const [k, v] of Object.entries(d.sectionPrompts ?? {})) {
      if (v !== undefined) sections[k] = v;
    }
  }
  return {
    globalInstruction: d.globalInstruction ?? b.globalInstruction ?? "",
    styleSample: d.styleSample ?? b.styleSample ?? "",
    sectionPrompts: sections,
  };
}

/** 設一個欄位。傳 undefined = 改回沿用通用 */
export function setField(
  byDomain: Record<string, DomainWriteConfig>,
  domain: string,
  field: InheritableField,
  value: string | undefined,
): Record<string, DomainWriteConfig> {
  const next = { ...byDomain, [domain]: { ...(byDomain[domain] ?? {}) } };
  if (value === undefined) delete next[domain][field];
  else next[domain][field] = value;
  return next;
}

export function setSectionPrompt(
  byDomain: Record<string, DomainWriteConfig>,
  domain: string,
  sectionId: string,
  value: string | undefined,
): Record<string, DomainWriteConfig> {
  const cur = byDomain[domain] ?? {};
  const prompts = { ...(cur.sectionPrompts ?? {}) };
  if (value === undefined) delete prompts[sectionId];
  else prompts[sectionId] = value;
  return { ...byDomain, [domain]: { ...cur, sectionPrompts: prompts } };
}

/**
 * 從舊格式遷移。
 *
 * 舊格式有兩代：最早是頂層的 globalInstruction/styleSample/sectionPrompts，
 * 後來包成 profiles[]。兩代都收進 generic —— 使用者當時寫的東西是通用寫法，
 * 沒有理由憑空綁到某個領域上。
 *
 * 多個角色只保留當時生效的那個。這在正常情況下不會丟到東西：新增角色的按鈕
 * 一直是壞的（用了 Tauri 不支援的 window.prompt），所以實務上不存在第二個角色。
 */
export function migrateAiWriting(raw: unknown): {
  byDomain: Record<string, DomainWriteConfig>;
  overwriteFilled: boolean;
} {
  const r = (raw ?? {}) as Record<string, unknown>;
  const overwriteFilled = r.overwriteFilled === true;

  // 已經是新格式
  if (r.byDomain && typeof r.byDomain === "object") {
    const byDomain = r.byDomain as Record<string, DomainWriteConfig>;
    return { byDomain: { [BASE_DOMAIN]: {}, ...byDomain }, overwriteFilled };
  }

  const profiles = Array.isArray(r.profiles) ? (r.profiles as Record<string, unknown>[]) : [];
  const active =
    profiles.find((p) => p.id === r.activeProfileId) ?? profiles[0] ?? (r as Record<string, unknown>);

  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const generic: DomainWriteConfig = {
    globalInstruction: str(active.globalInstruction) ?? str(r.globalInstruction) ?? "",
    styleSample: str(active.styleSample) ?? str(r.styleSample) ?? "",
    sectionPrompts:
      (active.sectionPrompts as Record<string, string> | undefined) ??
      (r.sectionPrompts as Record<string, string> | undefined) ??
      {},
  };

  return { byDomain: { [BASE_DOMAIN]: generic }, overwriteFilled };
}
