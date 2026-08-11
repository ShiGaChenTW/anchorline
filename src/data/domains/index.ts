/**
 * 領域包註冊表 = 內建（編譯進 bundle）+ 使用者自帶（資料夾）。
 *
 * 領域包這條路上唯一碰 `import.meta.glob` 的地方（頁面層另有三處在 glob
 * `plans/*.md`，與這裡無關）。glob 只在 Vite 下存在，`bun test` 讀不到，
 * 所以解析與合併全留在 `lib/domain-pack.ts`；測試直接讀這個目錄下的 `.md`，
 * 測到的就是實際會上線的那幾份。
 *
 * 新增一個內建領域 = 在這個目錄放一個 `.md`。這個檔不用改。
 */
import { type DomainPack, parseDomainPack } from "../../lib/domain-pack";
import { getUserPacks } from "../../lib/user-domains";

const RAW = import.meta.glob("./*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export const BUILTIN_PACKS: Record<string, DomainPack> = Object.fromEntries(
  Object.entries(RAW).map(([path, raw]) => {
    const pack = parseDomainPack(raw, path);
    return [pack.name, pack];
  }),
);

/**
 * 內建包的原始 markdown。編輯內建包 = 拿這份當底稿改成自訂包（同名覆寫）。
 *
 * 沒有這個出口的話，「編輯內建領域」只能從空白範本重寫一遍 —— 使用者最想做的
 * 事（拿 digital_account 改成自己銀行的規矩）反而是最難做的。
 */
const BUILTIN_SOURCE: Record<string, string> = Object.fromEntries(
  Object.entries(RAW).map(([path, raw]) => [parseDomainPack(raw, path).name, raw]),
);

export function builtinSource(name: string): string | null {
  return BUILTIN_SOURCE[name] ?? null;
}

/**
 * 使用者自帶的包**覆寫**同名內建包。
 *
 * 拒絕同名比較安全，但也擋掉了最合理的用法：拿內建的 digital_account 改一版
 * 成自己銀行的規矩。覆寫是刻意的，代價是 UI 必須標示來源——靜默影子才危險。
 */
let userPacks = getUserPacks().packs;

export function reloadUserPacks() {
  userPacks = getUserPacks().packs;
}

export function domainPacks(): Record<string, DomainPack> {
  return { ...BUILTIN_PACKS, ...userPacks };
}

export function isUserPack(name: string): boolean {
  return name in userPacks;
}

/** 給下拉選單用：跳過 `_` 開頭的內部包（沿用 prd-agent 的慣例） */
export function listDomains(): { name: string; displayName: string; industry?: string; custom: boolean }[] {
  return Object.values(domainPacks())
    .filter((p) => !p.name.startsWith("_"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ name, displayName, industry }) => ({ name, displayName, industry, custom: isUserPack(name) }));
}

export const DEFAULT_DOMAIN = "generic";
