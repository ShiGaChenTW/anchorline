/**
 * Live Tracking —— 判定「哪一份 plan 是 agent 此刻正在動的」。
 * 規格：`SPEC-live-tracking.md`。
 *
 * ## 為什麼是純函式 + snapshot
 *
 * 原規格的簽章 `trackingTarget(watchedFiles, signalPath, now)` 把 `stat()` 做在函式裡，
 * 這隱含了同步 fs —— CLI 可以，WKWebView 裡的 web 端拿不到（只能非同步 bridge 往返）。
 * 於是判定邏輯會被迫在兩端各寫一次，正是 spec §7 警告的漂移。
 *
 * 這裡把 I/O 全推到呼叫端：各端自己組 snapshot（CLI 用 node:fs、桌面版用 Swift bridge），
 * 判定只對 snapshot 做純運算。spec §7 的判別式「第二個消費端還寫不寫得出這段邏輯」
 * 因此是「寫不出來」—— 它拿不到 fs，只能呼叫這裡。
 *
 * ## 與規格的一處刻意偏離
 *
 * 段 1 的「raw 存在於檔案系統」在這裡是「raw 出現在 snapshot.files 裡」。
 * 訊號指向一個沒被監看的 .md 時，規格會回傳它，這裡會退回段 2。
 * ponytail: 追蹤一個畫不出來的目標沒有意義 —— 消費端拿到路徑也沒有它的內容可顯示。
 */

/** 30 分鐘。訊號檔是外部寫的，寫入端隨時可能死掉卻把檔案留在磁碟上。 */
export const FRESHNESS_WINDOW_MS = 30 * 60 * 1000;

/** 「plan 檔」的判準。換格式時段 1 的副檔名檢查與各端的目錄掃描要一起改。 */
export const PLAN_EXT = ".md";

/** 目錄約定名。段 1 的目錄分支依賴它。 */
export const PLANS_DIR_NAME = "plans";

export type PlanStat = {
  /** 絕對路徑 */
  path: string;
  /** epoch ms。取不到就別放進 snapshot，或放 NaN —— 兩者都會被略過 */
  mtimeMs: number;
};

export type TrackingSignal = {
  /** 訊號檔全文。只有第一行有意義 */
  raw: string;
  /** 訊號檔自己的 mtime，新鮮度由它決定，不是內容裡的時間戳 */
  mtimeMs: number;
};

export type TrackingSnapshot = {
  files: PlanStat[];
  signal?: TrackingSignal | null;
};

function normalizeDir(p: string): string {
  return p.replace(/\/+$/, "");
}

function dirnameOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "" : p.slice(0, i);
}

function usable(f: PlanStat): boolean {
  return Boolean(f?.path) && Number.isFinite(f.mtimeMs);
}

/** 依 mtime 新到舊。CLI 與 web 共用，避免兩端各自排序而漂移。 */
export function sortByRecency<T extends PlanStat>(files: T[]): T[] {
  return [...files].filter(usable).sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * 段 1 —— 明確訊號。
 * 回傳 `null` 代表「我沒答案」，不代表「答案是空的」。所有失敗路徑都走這裡，
 * 由呼叫端穿透到段 2。這是雙態設計的已知表達力缺口（見 spec §8 註）。
 */
function fromSignal(snap: TrackingSnapshot, nowMs: number): string | null {
  const sig = snap.signal;
  if (!sig || !Number.isFinite(sig.mtimeMs)) return null;
  if (nowMs - sig.mtimeMs > FRESHNESS_WINDOW_MS) return null;

  const raw = normalizeDir((sig.raw ?? "").split("\n")[0]?.trim() ?? "");
  if (!raw) return null;

  const files = snap.files.filter(usable);

  // ① 直接指向 plan 檔
  if (raw.endsWith(PLAN_EXT)) {
    return files.some((f) => f.path === raw) ? raw : null;
  }

  // ② 指向專案根目錄或 plans/ 本身 —— 不重複附加 plans
  const plansDir =
    raw === PLANS_DIR_NAME || raw.endsWith(`/${PLANS_DIR_NAME}`)
      ? raw
      : `${raw}/${PLANS_DIR_NAME}`;

  const inDir = files.filter((f) => dirnameOf(f.path) === plansDir);
  if (!inDir.length) return null;
  return sortByRecency(inDir)[0]!.path;
}

/**
 * 兩段式判定。全程 fail-soft —— 任一步失敗都不是錯誤，是「退回段 2」。
 * 這個函式沒有任何 throw 路徑。
 *
 * @param nowMs 必須可注入，否則新鮮度邏輯無法測試
 */
export function trackingTarget(snap: TrackingSnapshot, nowMs: number): string | null {
  const sig = fromSignal(snap, nowMs);
  if (sig) return sig;
  return sortByRecency(snap.files)[0]?.path ?? null;
}
