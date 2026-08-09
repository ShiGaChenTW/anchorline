/**
 * 領域包（Domain Pack）loader。
 *
 * 一個領域＝一個 `.md`：frontmatter 放章節、gate 規則與領域 prompt，正文不使用。
 * 沿用 prd-agent 的 frontmatter 慣例，但把 prompt 收進同一個檔——prd-agent 拆成
 * `templates/*.md` + `prompts/*.txt` 兩份，結果模板正文載入後從未進 prompt
 * （它自己的 D-1），因為沒有人會記得同步兩個檔。一個檔就不會有這個問題。
 *
 * 為什麼是 `.md` 而不是 `.ts`：下一個里程碑是讓使用者把領域包丟進資料夾就生效。
 * 那時檔案從 Tauri readFile 進來，走的是同一個 `parseDomainPack()`。
 * 現在寫成 `.ts` 等於預約一次全部重打的搬遷。
 *
 * 這個檔刻意不碰檔案系統，也不碰 `import.meta.glob`——註冊表在
 * `src/data/domains/index.ts`，解析與合併留在這裡才測得動。
 */
import { parse as parseYaml } from "yaml";
import type { FieldDef, Section } from "../data/types";
import type { GateGroup, GateSpec } from "./gate-rules";

export class DomainPackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainPackError";
  }
}

/** frontmatter 直譯後的原始形狀。章節在這裡是「部分」——會疊到 base 上。 */
export type DomainPack = {
  name: string;
  displayName: string;
  /** 產業標籤。目前只供篩選，不進繼承鏈（一層 extends 就夠了）。 */
  industry?: string;
  /** 一層繼承，不做多重繼承——繼承鏈是最容易長歪的東西 */
  extends?: string;
  /** 疊在 base prompt 之後的領域知識（法遵、術語、必須涵蓋的面向） */
  prompt?: string;
  /** 依 id 疊加：base 有同 id 就覆寫該欄位，沒有就追加到尾端 */
  sections?: SectionPatch[];
  /** 追加的 gate group（不覆寫 base 規則，只增加） */
  gates?: GateGroup[];
  /** 只給寫作教練看的軟提示，不進 gate、不影響簽核 */
  hints?: GateGroup[];
};

export type SectionPatch = Partial<Omit<Section, "id" | "fields">> & {
  id: string;
  fields?: FieldDef[];
};

/** 解析完成、可以直接餵給 UI 與 gate 的結果 */
export type ResolvedDomain = {
  name: string;
  displayName: string;
  industry?: string;
  /** base prompt + 領域 prompt，以 `\n\n` 相接（沿用 prd-agent 的疊加語意） */
  prompt: string;
  sections: Section[];
  gateSpec: GateSpec;
};

// ── 解析 ────────────────────────────────────────────────────

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** 章節缺欄位時的填充值。UI 讀得到 `tips.map` 比讀到 undefined 好。 */
function normalizeSection(p: SectionPatch, order: number): Section {
  return {
    id: p.id,
    n: p.n ?? String(order + 1).padStart(2, "0"),
    title: p.title ?? p.id,
    desc: p.desc ?? "",
    status: p.status ?? "empty",
    guide: p.guide ?? "",
    tips: p.tips ?? [],
    example: p.example ?? "",
    fields: (p.fields ?? []).map((f) => ({ ...f, value: f.value ?? "" })),
    checks: p.checks ?? [],
    score: p.score ?? 0,
  };
}

export function parseDomainPack(raw: string, sourceHint = "<inline>"): DomainPack {
  const m = FRONTMATTER.exec(raw);
  if (!m) throw new DomainPackError(`${sourceHint}：缺少 --- frontmatter ---`);

  let data: unknown;
  try {
    data = parseYaml(m[1]);
  } catch (e) {
    throw new DomainPackError(`${sourceHint}：YAML 解析失敗 — ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new DomainPackError(`${sourceHint}：frontmatter 必須是物件`);
  }

  const pack = data as DomainPack;
  if (!pack.name?.trim()) throw new DomainPackError(`${sourceHint}：缺少 name`);
  if (!pack.displayName?.trim()) {
    throw new DomainPackError(`${sourceHint}：缺少 displayName`);
  }
  for (const s of pack.sections ?? []) {
    if (!s?.id?.trim()) throw new DomainPackError(`${sourceHint}：sections 有一筆缺少 id`);
  }
  for (const g of pack.gates ?? []) {
    for (const r of g?.rules ?? []) {
      if (!r?.id?.trim()) throw new DomainPackError(`${sourceHint}：gates 有一條規則缺少 id`);
      if (!r.section?.trim()) throw new DomainPackError(`${sourceHint}：規則 ${r.id} 缺少 section`);
    }
  }
  return pack;
}

// ── 合併與解析 ──────────────────────────────────────────────

/** 章節依 id 疊加：命中就覆寫欄位，沒命中就追加。順序以 base 為準，新章節接在後面。 */
export function applySectionPatches(base: Section[], patches: SectionPatch[]): Section[] {
  const out = base.map((s) => ({ ...s }));
  for (const p of patches) {
    const i = out.findIndex((s) => s.id === p.id);
    if (i >= 0) out[i] = { ...out[i], ...p, fields: p.fields ?? out[i].fields };
    else out.push(normalizeSection(p, out.length));
  }
  return out;
}

/**
 * 把一個領域包解析成可用的章節與 gate。
 *
 * `baseSections` / `baseGates` 由呼叫端給——loader 不該知道 `SEED_SECTIONS`
 * 從哪來，那是 store 的事。
 */
export function resolveDomain(
  name: string,
  registry: Record<string, DomainPack>,
  base: { sections: Section[]; gates: GateSpec; prompt?: string },
): ResolvedDomain {
  const pack = registry[name];
  if (!pack) throw new DomainPackError(`找不到領域包「${name}」`);

  const parentName = pack.extends;
  if (parentName) {
    if (!registry[parentName]) throw new DomainPackError(`領域包「${name}」繼承了不存在的「${parentName}」`);
    if (registry[parentName].extends) {
      throw new DomainPackError(`領域包「${name}」的繼承超過一層（${parentName} 還有 extends）— 只允許一層`);
    }
  }

  const chain = parentName ? [registry[parentName], pack] : [pack];
  let sections = base.sections;
  const groups = [...base.gates.groups];
  // hints 也要一路帶過去。漏掉這一行的症狀是「base 的軟提示在任何領域下都消失」——
  // gate 全綠、測試全綠，只有教練欄默默少講幾句話。
  const hints = [...(base.gates.hints ?? [])];
  const prompts = [base.prompt?.trim()].filter(Boolean) as string[];

  for (const p of chain) {
    if (p.sections?.length) sections = applySectionPatches(sections, p.sections);
    if (p.gates?.length) groups.push(...p.gates);
    if (p.hints?.length) hints.push(...p.hints);
    if (p.prompt?.trim()) prompts.push(p.prompt.trim());
  }

  return {
    name: pack.name,
    displayName: pack.displayName,
    industry: pack.industry,
    prompt: prompts.join("\n\n"),
    sections,
    gateSpec: { groups, hints, emptySections: base.gates.emptySections },
  };
}

// ── 結構驗證（AI 產出／使用者貼上時用）──────────────────────

export type ValidatedPack = { ok: true; pack: DomainPack } | { ok: false; reason: string };

/**
 * 比 `parseDomainPack` 更嚴的一層：規則指向不存在的章節或欄位、id 撞號、
 * regex 編不過。
 *
 * 為什麼不併進 `parseDomainPack`：那支要能解析**部分**的包（章節疊在 base 上，
 * 規則可以指向 base 的章節）。這一支檢查的是「這份包自己是完整自洽的」，
 * 用在 AI 產出與使用者貼上的內容——那些沒有經過人眼審過。
 *
 * 放在這個檔而不是 `domain-pack-author.ts`：那個檔 import 了 ai-client → store
 * → `import.meta.glob`，`bun test` 載不進來。閘門必須測得到。
 */
export function validatePackStructure(raw: string): ValidatedPack {
  let pack: DomainPack;
  try {
    pack = parseDomainPack(raw, "AI 產出");
  } catch (e) {
    return { ok: false, reason: e instanceof DomainPackError ? e.message : String(e) };
  }
  if (pack.name.startsWith("_")) {
    return { ok: false, reason: `name 不可用 _ 開頭（目前是 ${pack.name}）——那是內部保留的前綴` };
  }

  const sections = new Map((pack.sections ?? []).map((s) => [s.id, new Set((s.fields ?? []).map((f) => f.key))]));
  const ids = new Set<string>();
  for (const g of [...(pack.gates ?? []), ...(pack.hints ?? [])]) {
    for (const r of g.rules ?? []) {
      if (ids.has(r.id)) return { ok: false, reason: `規則 id 重複：${r.id}` };
      ids.add(r.id);
      const keys = sections.get(r.section);
      if (!keys) return { ok: false, reason: `規則 ${r.id} 指向不存在的章節 ${r.section}` };
      for (const k of r.fields ?? []) {
        if (!keys.has(k)) return { ok: false, reason: `規則 ${r.id} 指向章節 ${r.section} 不存在的欄位 ${k}` };
      }
      if (r.require?.kind === "match") {
        try {
          new RegExp(r.require.re, r.require.flags);
        } catch {
          return { ok: false, reason: `規則 ${r.id} 的正規表達式無效：${r.require.re}` };
        }
      }
    }
    if (g.pass && ids.has(g.pass.id)) return { ok: false, reason: `pass id 與規則 id 重複：${g.pass.id}` };
    if (g.pass) ids.add(g.pass.id);
  }
  return { ok: true, pack };
}
