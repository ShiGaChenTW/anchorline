/**
 * AI 撰寫設定的繼承與遷移。
 *
 * 純函式：不認得 store、不碰 DOM，所以可以直接在 bun test 裡跑。
 *
 * 規則只有一條 —— **預設是自訂且空白，沿用通用必須明示**。
 * 所以沿用狀態存在 `inherit` 清單裡，不從「欄位是不是 undefined」推斷；
 * 用推斷的話，一個從沒設定過的領域會自動變成繼承，那不是預設行為。
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

/** 章節的 inherit key。加前綴才不會跟欄位名撞在一起 */
export function sectionKey(sectionId: string): string {
  return `sec:${sectionId}`;
}

function base(byDomain: Record<string, DomainWriteConfig>): DomainWriteConfig {
  return byDomain[BASE_DOMAIN] ?? {};
}

function inheritSet(byDomain: Record<string, DomainWriteConfig>, domain: string): Set<string> {
  return new Set(byDomain[domain]?.inherit ?? []);
}

/**
 * 這個欄位目前是不是沿用通用版本。
 * 通用領域本身永遠不是 —— 它就是基底，沒有上游可繼承。
 */
export function isInherited(
  byDomain: Record<string, DomainWriteConfig>,
  domain: string,
  field: InheritableField,
): boolean {
  if (domain === BASE_DOMAIN) return false;
  return inheritSet(byDomain, domain).has(field);
}

/** 某章節的提示詞是不是沿用通用版本 */
export function isSectionInherited(
  byDomain: Record<string, DomainWriteConfig>,
  domain: string,
  sectionId: string,
): boolean {
  if (domain === BASE_DOMAIN) return false;
  return inheritSet(byDomain, domain).has(sectionKey(sectionId));
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

/**
 * 實際送進 prompt 的設定。
 *
 * 沒標成沿用的欄位一律用領域自己的值，**不回退到通用** ——
 * 回退等於偷偷把預設變成繼承，跟畫面上顯示的「自訂」對不起來。
 */
export function resolveWriting(
  byDomain: Record<string, DomainWriteConfig>,
  domain: string,
): ResolvedWriting {
  const b = base(byDomain);
  if (domain === BASE_DOMAIN) {
    return {
      globalInstruction: b.globalInstruction ?? "",
      styleSample: b.styleSample ?? "",
      sectionPrompts: cleanPrompts(b.sectionPrompts),
    };
  }

  const d = byDomain[domain] ?? {};
  const inh = inheritSet(byDomain, domain);
  const sections: Record<string, string> = {};

  // 領域自己的章節提示詞
  for (const [k, v] of Object.entries(d.sectionPrompts ?? {})) {
    if (v !== undefined && !inh.has(sectionKey(k))) sections[k] = v;
  }
  // 標成沿用的章節改抓通用值
  for (const key of inh) {
    if (!key.startsWith("sec:")) continue;
    const id = key.slice(4);
    const v = base(byDomain).sectionPrompts?.[id];
    if (v !== undefined) sections[id] = v;
  }

  return {
    globalInstruction: inh.has("globalInstruction")
      ? (b.globalInstruction ?? "")
      : (d.globalInstruction ?? ""),
    styleSample: inh.has("styleSample") ? (b.styleSample ?? "") : (d.styleSample ?? ""),
    sectionPrompts: sections,
  };
}

function cleanPrompts(p: Record<string, string | undefined> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p ?? {})) if (v !== undefined) out[k] = v;
  return out;
}

/** 寫入某領域的自訂值。不動 inherit 狀態 —— 切換來源是另一個動作。 */
export function setField(
  byDomain: Record<string, DomainWriteConfig>,
  domain: string,
  field: InheritableField,
  value: string,
): Record<string, DomainWriteConfig> {
  return { ...byDomain, [domain]: { ...(byDomain[domain] ?? {}), [field]: value } };
}

export function setSectionPrompt(
  byDomain: Record<string, DomainWriteConfig>,
  domain: string,
  sectionId: string,
  value: string,
): Record<string, DomainWriteConfig> {
  const cur = byDomain[domain] ?? {};
  return {
    ...byDomain,
    [domain]: { ...cur, sectionPrompts: { ...(cur.sectionPrompts ?? {}), [sectionId]: value } },
  };
}

/**
 * 切換某個 key 是否沿用通用。
 *
 * 刻意**不刪自訂內容** —— 切成沿用再切回來，原本寫的東西還在。
 * 刪掉的話等於使用者每次好奇按一下就損失一段文字。
 */
export function setInherit(
  byDomain: Record<string, DomainWriteConfig>,
  domain: string,
  key: string,
  on: boolean,
): Record<string, DomainWriteConfig> {
  if (domain === BASE_DOMAIN) return byDomain;
  const cur = byDomain[domain] ?? {};
  const set = new Set(cur.inherit ?? []);
  if (on) set.add(key);
  else set.delete(key);
  return { ...byDomain, [domain]: { ...cur, inherit: [...set] } };
}

/**
 * 從舊格式遷移。
 *
 * 舊格式有三代：最早是頂層的 globalInstruction/styleSample/sectionPrompts，
 * 接著包成 profiles[]，然後是 byDomain（當時「欄位缺席」代表沿用）。
 * 前兩代都收進 generic —— 使用者當時寫的東西是通用寫法，
 * 沒有理由憑空綁到某個領域上。
 *
 * 第三代不特別回填 inherit：那一版只活了幾分鐘，而且缺席欄位在新模型下
 * 是「自訂且空白」，最壞情況是某個領域少繼承一段指令，看得見也改得回來。
 */
export function migrateAiWriting(raw: unknown): {
  byDomain: Record<string, DomainWriteConfig>;
  overwriteFilled: boolean;
} {
  const r = (raw ?? {}) as Record<string, unknown>;
  const overwriteFilled = r.overwriteFilled === true;

  if (r.byDomain && typeof r.byDomain === "object") {
    const byDomain = r.byDomain as Record<string, DomainWriteConfig>;
    return { byDomain: { [BASE_DOMAIN]: {}, ...byDomain }, overwriteFilled };
  }

  const profiles = Array.isArray(r.profiles) ? (r.profiles as Record<string, unknown>[]) : [];
  const active =
    profiles.find((p) => p.id === r.activeProfileId) ??
    profiles[0] ??
    (r as Record<string, unknown>);

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
