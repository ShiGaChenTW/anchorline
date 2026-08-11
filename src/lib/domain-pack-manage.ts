/**
 * 領域包的管理面：列出、取原始碼、存、移除。
 *
 * 為什麼不直接寫在頁面裡：存一個領域包不是「寫檔」一個動作，是四步
 * （驗證 → 落地 → 重載註冊表 → 讓 store 重算章節）。少最後一步的症狀是
 * 「存好了但 PRD 章節沒變，重開才對」——看起來像沒存到。這四步只能有一份。
 *
 * 這一層不碰 DOM，所以 `bun test` 測得到；頁面只負責畫。
 */
import { BUILTIN_PACKS, builtinSource, domainPacks, isUserPack } from "../data/domains";
import { store } from "../data/store";
import { parseDomainPack, validatePackStructure } from "./domain-pack";
import {
  addUserPack,
  canUseUserDomains,
  getUserPacks,
  removeUserPack,
  userDomainsDir,
  userPackSource,
} from "./user-domains";

/** 一個包在畫面上要講清楚的三件事：是誰、從哪來、能不能改 */
export type ManagedPack = {
  name: string;
  displayName: string;
  industry?: string;
  /** builtin＝內建；custom＝自訂；override＝自訂且蓋掉同名內建 */
  origin: "builtin" | "custom" | "override";
  /** 內部包（`_base` / `_template`）不出現在領域下拉，但要能編 */
  internal: boolean;
  sections: number;
  gates: number;
};

export function listManagedPacks(): ManagedPack[] {
  return Object.values(domainPacks())
    .map((p) => ({
      name: p.name,
      displayName: p.displayName,
      industry: p.industry,
      origin: !isUserPack(p.name)
        ? ("builtin" as const)
        : p.name in BUILTIN_PACKS
          ? ("override" as const)
          : ("custom" as const),
      internal: p.name.startsWith("_"),
      sections: p.sections?.length ?? 0,
      gates: (p.gates ?? []).reduce((n, g) => n + (g.rules?.length ?? 0), 0),
    }))
    .sort((a, b) => Number(a.internal) - Number(b.internal) || a.name.localeCompare(b.name));
}

export function packErrors(): { file: string; message: string }[] {
  return getUserPacks().errors;
}

/** 編輯用的原始碼：自訂的拿自訂那份，內建的拿 bundle 裡那份當底稿 */
export function packSource(name: string): string | null {
  return userPackSource(name)?.raw ?? builtinSource(name);
}

export type SaveResult =
  | { ok: true; name: string; persisted: "disk" | "cache"; overrides: boolean }
  | { ok: false; reason: string };

/**
 * 存一份領域包（新增與編輯是同一條路 —— 差別只在原本有沒有同名的）。
 *
 * 驗證用 `validatePackStructure` 而不是只 `parseDomainPack`：後者只保證 YAML
 * 讀得動，前者連「gate 指到不存在的章節」這種存得進去、卻在送審時才爆的錯
 * 都會擋下來。
 */
export async function savePack(raw: string): Promise<SaveResult> {
  const v = validatePackStructure(raw, "這份領域包");
  if (!v.ok) return { ok: false, reason: v.reason };

  const name = v.pack.name;
  const file = userPackSource(name)?.file ?? `${name}.md`;
  const r = await addUserPack(file, raw);
  if (!r.ok) return r;

  store.refreshDomainPacks();
  return { ok: true, name, persisted: r.persisted, overrides: name in BUILTIN_PACKS };
}

export type RemoveResult =
  | { ok: true; name: string; stillOnDisk: boolean; revealsBuiltin: boolean }
  | { ok: false; reason: string };

/**
 * 移除一個自訂包。內建包不能移除 —— 它在 bundle 裡，「移除」只會是個假動作。
 * 移除覆寫版則會讓內建的那一份重新生效，這件事要講出來。
 */
export function removePack(name: string): RemoveResult {
  if (!isUserPack(name)) return { ok: false, reason: "內建領域包不能移除，只能用同名的自訂包覆寫" };
  const r = removeUserPack(name);
  if (!r.ok) return r;
  store.refreshDomainPacks();
  return { ok: true, name, stillOnDisk: r.stillOnDisk, revealsBuiltin: name in BUILTIN_PACKS };
}

/** 使用這份領域包的專案數 —— 移除前要知道會影響誰 */
export function projectsUsing(name: string): number {
  return store.get().projects.filter((p) => p.domain === name).length;
}

/** 畫面抬頭那一行：資料夾在哪、能不能寫 */
export function storageNote(): string {
  const dir = userDomainsDir();
  if (!canUseUserDomains()) return "瀏覽器版：自訂領域包存在這台瀏覽器裡，換裝置不會跟著走。";
  return dir
    ? `自訂領域包資料夾：${dir}`
    : "尚未指定資料夾 — 新增的領域包會先存在本機快取，指定資料夾後才會落地成 .md。";
}

/** 新增時的空白底稿。用內建範本，使用者才有東西可以照著改。 */
export { renamePackSource as blankPackSource } from "./domain-pack";

/** 給頁面顯示「這份包長什麼樣」用，不進 gate */
export function summarize(raw: string): { ok: true; sections: number; gates: number } | { ok: false } {
  try {
    const p = parseDomainPack(raw, "<edit>");
    return {
      ok: true,
      sections: p.sections?.length ?? 0,
      gates: (p.gates ?? []).reduce((n, g) => n + (g.rules?.length ?? 0), 0),
    };
  } catch {
    return { ok: false };
  }
}
