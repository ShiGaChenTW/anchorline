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
  /**
   * 開 App 時自動重掃資料夾。預設關。
   *
   * 開了之後在資料夾裡新增 `.md` 就會自動出現，不必回設定頁按重新讀取；
   * 代價是每次開 App 多一次磁碟走訪。關著的時候快取就是唯一真相，
   * 想更新按「重新讀取」即可。
   */
  autoRescan?: boolean;
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

export function autoRescanEnabled(): boolean {
  return readCache()?.autoRescan === true;
}

export function setAutoRescan(on: boolean) {
  const c = readCache();
  if (!c) return;
  writeCache({ ...c, autoRescan: on });
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

/**
 * 整個資料夾重掃——新增、修改、刪除都會反映。
 *
 * 借用 `tracking_scan`：它做的事就是「列出這幾個資料夾裡的 `.md`，連內容一起回來」，
 * 正好是這裡要的，不必為此新增一個 Rust command。代價是綁上它的上限
 * （單檔 512KB、總計 300 檔）與「只掃第一層、不遞迴」的行為——
 * 領域包資料夾不該長到需要突破這兩條。若哪天 `tracking_scan` 開始按 plan
 * 格式過濾，這裡會跟著壞，所以在那邊改動時要記得回頭看這一段。
 */
export async function refreshUserDomains(): Promise<ScanResult> {
  const dir = userDomainsDir();
  if (!dir) return { ok: false, reason: "尚未指定領域包資料夾" };
  if (!isNative()) return { ok: false, reason: "自訂領域包需要桌面版" };
  const scan = await native.trackingScan([dir]);
  return ingest(
    dir,
    scan.files.map((f) => ({ path: f.path, name: f.name, text: f.text })),
  );
}

/**
 * 開 App 時的自動對齊。沒開選項就什麼都不做——
 * 回傳「內容有沒有變」，呼叫端據此決定要不要重繪。
 */
export async function autoRescanUserDomains(): Promise<boolean> {
  if (!autoRescanEnabled()) return false;
  const before = JSON.stringify(readCache()?.sources ?? {});
  const r = await refreshUserDomains();
  if (!r.ok) return false;
  return JSON.stringify(readCache()?.sources ?? {}) !== before;
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
  writeCache({ dir, sources, scannedAt: new Date().toISOString(), autoRescan: readCache()?.autoRescan });
  return { ok: true, dir, count: Object.keys(sources).length, errors };
}

/**
 * 收一份單一領域包（AI 產生的，或使用者貼進來的）。
 *
 * 有指定資料夾且在桌面版時**寫進磁碟**，不是只放記憶體——否則開了自動重掃之後
 * 這份包會在下一次開 App 時消失（重掃以磁碟為準）。那是最難查的一種資料遺失：
 * 使用者記得自己加過，App 說沒有。
 */
export async function addUserPack(
  filename: string,
  raw: string,
): Promise<{ ok: true; persisted: "disk" | "cache" } | { ok: false; reason: string }> {
  let name: string;
  try {
    name = parseDomainPack(raw, filename).name;
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  const file = filename.toLowerCase().endsWith(".md") ? filename : `${name}.md`;
  const cache = readCache();
  const dir = cache?.dir ?? "";

  if (dir && isNative()) {
    try {
      await native.writeFile(`${dir}/${file}`, raw);
      await refreshUserDomains();
      return { ok: true, persisted: "disk" };
    } catch (e) {
      return { ok: false, reason: `寫入資料夾失敗：${e instanceof Error ? e.message : String(e)}` };
    }
  }

  writeCache({
    dir,
    sources: { ...(cache?.sources ?? {}), [file]: raw },
    scannedAt: new Date().toISOString(),
    autoRescan: cache?.autoRescan,
  });
  return { ok: true, persisted: "cache" };
}
