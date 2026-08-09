/**
 * 使用者自帶的領域包：指一個資料夾，裡面的 `.md` 就是領域。
 *
 * 為什麼原始碼要快取進 localStorage 而不是每次開 App 重讀磁碟：
 * store 在模組載入時就同步跑 `load()` 去解析每個專案的章節，而讀檔是非同步的。
 * 沒有快取的話，第一幀所有自訂領域的專案都會退回 generic，等檔案讀回來才跳成
 * 正確章節——那個閃爍看起來就像資料掉了。快取讓第二次之後完全不閃，
 * 背景再非同步重讀一次對齊磁碟。
 *
 * 快取存的是**原始 markdown**不是解析結果：解析器改版後舊快取仍然可用，
 * 存解析結果的話格式一變就得寫遷移。
 */
import { type DomainPack, parseDomainPack } from "./domain-pack";
import { isNative, native } from "./native";

const KEY = "anchorline:user-domains:v1";

export type UserDomainCache = {
  dir: string;
  /** 檔名 → 原始 markdown */
  sources: Record<string, string>;
  scannedAt: string;
};

export function readCache(): UserDomainCache | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as UserDomainCache;
    return c && typeof c.dir === "string" && c.sources ? c : null;
  } catch {
    return null;
  }
}

function writeCache(c: UserDomainCache) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* 配額或隱私模式：自訂領域這次就只在記憶體裡，下次重讀 */
  }
}

export function clearUserDomains() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export type ParsedUserPacks = {
  packs: Record<string, DomainPack>;
  /** 解析失敗的檔案；要顯示給使用者，不能默默吞掉 */
  errors: { file: string; message: string }[];
};

/** 解析快取裡的原始碼。壞掉的檔案不會拖垮其他檔案。 */
export function parseCache(cache: UserDomainCache | null): ParsedUserPacks {
  const packs: Record<string, DomainPack> = {};
  const errors: { file: string; message: string }[] = [];
  for (const [file, raw] of Object.entries(cache?.sources ?? {})) {
    try {
      const pack = parseDomainPack(raw, file);
      packs[pack.name] = pack;
    } catch (e) {
      errors.push({ file, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { packs, errors };
}

/** 同步取用（給 store 在模組載入時用） */
export function getUserPacks(): ParsedUserPacks {
  return parseCache(readCache());
}

export function userDomainsDir(): string {
  return readCache()?.dir ?? "";
}

export type ScanResult =
  | { ok: true; dir: string; count: number; errors: { file: string; message: string }[] }
  | { ok: false; reason: string };

/** 只在桌面版可用——瀏覽器沒有資料夾存取權 */
export function canUseUserDomains(): boolean {
  return isNative();
}

/** 請使用者指一個資料夾，把裡面的 .md 收進快取 */
export async function pickUserDomainsFolder(): Promise<ScanResult> {
  if (!isNative()) return { ok: false, reason: "自訂領域包需要桌面版" };
  const pick = await native.pickFolder();
  if (pick.cancelled) return { ok: false, reason: "已取消" };
  return ingest(pick.folderPath, pick.files);
}

/** 用已知路徑重掃（開 App 時背景對齊磁碟） */
export async function refreshUserDomains(): Promise<ScanResult> {
  const dir = userDomainsDir();
  if (!dir) return { ok: false, reason: "尚未指定領域包資料夾" };
  if (!isNative()) return { ok: false, reason: "自訂領域包需要桌面版" };
  // pickFolder 會開對話框，重掃不能用它。逐檔讀已知檔名即可——
  // 新增的檔案要等下一次手動選資料夾才會進來，這是刻意的：
  // 背景自動掃整個資料夾等於每次開 App 都做一次不必要的磁碟走訪。
  const cache = readCache();
  const sources: Record<string, string> = {};
  const errors: { file: string; message: string }[] = [];
  for (const file of Object.keys(cache?.sources ?? {})) {
    try {
      sources[file] = (await native.readFile(`${dir}/${file}`)).text;
    } catch (e) {
      errors.push({ file, message: e instanceof Error ? e.message : String(e) });
    }
  }
  if (!Object.keys(sources).length) return { ok: false, reason: "資料夾裡沒有讀得到的領域包" };
  writeCache({ dir, sources, scannedAt: new Date().toISOString() });
  return { ok: true, dir, count: Object.keys(sources).length, errors };
}

function ingest(dir: string, files: { path: string; name: string; text: string }[]): ScanResult {
  const md = files.filter((f) => f.name.toLowerCase().endsWith(".md"));
  if (!md.length) return { ok: false, reason: "資料夾裡沒有 .md 檔" };

  const sources: Record<string, string> = {};
  const errors: { file: string; message: string }[] = [];
  for (const f of md) {
    try {
      parseDomainPack(f.text, f.name); // 先驗證再收，壞的不進快取
      sources[f.name] = f.text;
    } catch (e) {
      errors.push({ file: f.name, message: e instanceof Error ? e.message : String(e) });
    }
  }
  if (!Object.keys(sources).length) {
    return { ok: false, reason: `${md.length} 個 .md 都不是有效的領域包` };
  }
  writeCache({ dir, sources, scannedAt: new Date().toISOString() });
  return { ok: true, dir, count: Object.keys(sources).length, errors };
}
