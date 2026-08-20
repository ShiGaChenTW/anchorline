/**
 * Function wish list 的檔案形狀與狀態轉換。
 *
 * 純函式、零 I/O。OpenSpec 區塊的清單是這份 markdown 的視圖；
 * 寫進 spec 之後的願望進 Archive，Active 只留還沒寫的。
 *
 * 檔名與落點由原生端寫死（`.anchorline/function-wishlist.md`），
 * 這裡只認內文。前端若自己組路徑，等於把「可建新檔」的能力
 * 從那條窄通道放出去。
 */

export const WISHLIST_REL = ".anchorline/function-wishlist.md";
export const WISHLIST_LS_PREFIX = "anchorline:function-wishlist:";
export const WISH_HANDOFF_KEY = "anchorline:openspec-wish";
export const WISH_ARCHIVED_STATUS = "已寫 spec";

export type WishlistItem = {
  id: string;
  text: string;
  created: string;
  /** 在 Archive 才有 */
  status?: string;
  archived?: string;
};

export type WishlistDoc = {
  active: WishlistItem[];
  archive: WishlistItem[];
};

export type WishHandoff = {
  projectId: string;
  items: { id: string; text: string }[];
};

export function emptyWishlist(): WishlistDoc {
  return { active: [], archive: [] };
}

/**
 * 專案簡寫：只收 1–5 個英文字母，存成大寫。
 * 多一個字、夾數字或符號都拒——默默截斷會讓人以為 ALONG 設成了 ALONG。
 */
export function normalizeShortCode(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  if (!/^[A-Z]{1,5}$/.test(s)) return null;
  return s;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatWishId(code: string, n: number): string {
  return `${code}-${String(n).padStart(3, "0")}`;
}

/** 這個 id 是不是 `簡寫-流水號`（如 SNOTE-001）。認不得就不是這個簡寫名下的號。 */
export function wishNumberOf(id: string, code: string): number | null {
  if (!code) return null;
  const m = new RegExp(`^${escapeRe(code)}-(\\d+)$`, "i").exec(id);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

export function occupiedWishNumbers(
  doc: WishlistDoc,
  code: string,
  extra: readonly string[] = [],
): number[] {
  const ids = [...doc.active, ...doc.archive].map((it) => it.id).concat([...extra]);
  const out: number[] = [];
  for (const id of ids) {
    const n = wishNumberOf(id, code);
    if (n != null) out.push(n);
  }
  return out;
}

/** 最小的沒被佔用的正整數。刪掉的號會從這裡回來。 */
export function nextWishNumber(occupied: readonly number[]): number {
  const used = new Set(occupied);
  let n = 1;
  while (used.has(n)) n += 1;
  return n;
}

/**
 * 點「新增」時取號。extra 放還沒存檔的草稿 id，避免連點兩次拿到同一個號。
 * 簡寫不合法就回 null，呼叫端去請人先設簡寫。
 */
export function takeWishId(
  doc: WishlistDoc,
  code: string,
  extra: readonly string[] = [],
): string | null {
  const normalized = normalizeShortCode(code);
  if (!normalized) return null;
  const n = nextWishNumber(occupiedWishNumbers(doc, normalized, extra));
  return formatWishId(normalized, n);
}

export function wishlistPath(rootPath: string): string {
  const base = rootPath.replace(/\/+$/, "");
  return `${base}/${WISHLIST_REL}`;
}

export function wishlistLsKey(projectId: string): string {
  return `${WISHLIST_LS_PREFIX}${projectId}`;
}

/** `w-YYYYMMDDtHHMMSS-xxxx` —— 檔案裡當 heading，所以只准 [a-z0-9-] */
export function mintWishId(
  now: Date = new Date(),
  rand: () => string = () => Math.random().toString(16).slice(2, 6),
): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}t${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  const suffix = (rand() || "0000").replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 6) || "0000";
  return `w-${stamp}-${suffix}`;
}

const ID_RE = /^[A-Za-z0-9._-]+$/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 本地時間，給 `created` / `archived` 當人讀的時間戳 */
export function localStamp(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}T${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
}

function normalizeText(raw: string): string {
  return raw.replace(/\r\n/g, "\n").replace(/\s+$/g, "").replace(/^\s+/, "");
}

export function addWish(
  doc: WishlistDoc,
  text: string,
  id: string,
  now: Date = new Date(),
): WishlistDoc | null {
  const trimmed = normalizeText(text);
  if (!trimmed) return null;
  const taken = [...doc.active, ...doc.archive].some((it) => it.id === id);
  if (!id.trim() || taken) return null;
  const item: WishlistItem = { id: id.trim(), text: trimmed, created: localStamp(now) };
  return { ...doc, active: [...doc.active, item] };
}

/** 從 Active 或 Archive 拿掉。號因此釋出，下次新增可以再取。封存不算移除。 */
export function removeWish(doc: WishlistDoc, id: string): WishlistDoc | null {
  const inActive = doc.active.some((it) => it.id === id);
  const inArchive = doc.archive.some((it) => it.id === id);
  if (!inActive && !inArchive) return null;
  return {
    active: doc.active.filter((it) => it.id !== id),
    archive: doc.archive.filter((it) => it.id !== id),
  };
}

export function updateWish(doc: WishlistDoc, id: string, text: string): WishlistDoc | null {
  const trimmed = normalizeText(text);
  if (!trimmed) return null;
  const patch = (list: WishlistItem[]) =>
    list.map((it) => (it.id === id ? { ...it, text: trimmed } : it));
  if (doc.active.some((it) => it.id === id)) return { ...doc, active: patch(doc.active) };
  if (doc.archive.some((it) => it.id === id)) return { ...doc, archive: patch(doc.archive) };
  return null;
}

/**
 * 正式寫進 spec 之後走這條：從 Active 搬到 Archive，標「已寫 spec」。
 * 已經在 Archive 的呼叫是 no-op（回同一份 doc）。
 */
export function archiveWish(doc: WishlistDoc, id: string, now: Date = new Date()): WishlistDoc | null {
  const hit = doc.active.find((it) => it.id === id);
  if (!hit) {
    if (doc.archive.some((it) => it.id === id)) return doc;
    return null;
  }
  const moved: WishlistItem = {
    ...hit,
    status: WISH_ARCHIVED_STATUS,
    archived: localStamp(now),
  };
  return {
    active: doc.active.filter((it) => it.id !== id),
    archive: [...doc.archive, moved],
  };
}

export function serializeWishlist(doc: WishlistDoc): string {
  const lines = [
    "# Function wish list",
    "",
    "Active 是還沒寫成 spec 的願望；Archive 是已寫 spec、封存的。",
    "這一檔由 Anchorline 維護——可以手改願望正文，不要改 `###` 的 id。",
    "",
    "## Active",
    "",
  ];
  if (!doc.active.length) lines.push("（沒有）", "");
  for (const it of doc.active) {
    lines.push(`### ${it.id}`, "", `created: ${it.created}`, "", it.text, "");
  }
  lines.push("## Archive", "");
  if (!doc.archive.length) lines.push("（沒有）", "");
  for (const it of doc.archive) {
    lines.push(`### ${it.id}`, "");
    lines.push(`created: ${it.created}`);
    lines.push(`status: ${it.status ?? WISH_ARCHIVED_STATUS}`);
    if (it.archived) lines.push(`archived: ${it.archived}`);
    lines.push("", it.text, "");
  }
  return lines.join("\n").replace(/\n+$/, "\n");
}

const META_RE = /^(created|status|archived):\s*(.*)$/;

function parseSection(body: string): WishlistItem[] {
  const text = body.replace(/\r\n/g, "\n");
  const chunks = text.split(/^### /m).slice(1);
  const out: WishlistItem[] = [];
  for (const chunk of chunks) {
    const nl = chunk.indexOf("\n");
    const id = (nl < 0 ? chunk : chunk.slice(0, nl)).trim();
    if (!ID_RE.test(id)) continue;
    const rawBody = nl < 0 ? "" : chunk.slice(nl + 1);
    const lines = rawBody.replace(/\n+$/, "").split("\n");
    let i = 0;
    // 開頭空行
    while (i < lines.length && lines[i] === "") i++;
    const meta: Record<string, string> = {};
    while (i < lines.length) {
      const m = META_RE.exec(lines[i] ?? "");
      if (!m) break;
      meta[m[1]!] = m[2]!.trim();
      i++;
    }
    while (i < lines.length && lines[i] === "") i++;
    const itemText = normalizeText(lines.slice(i).join("\n"));
    if (!itemText) continue;
    out.push({
      id,
      text: itemText,
      created: meta.created || "",
      ...(meta.status ? { status: meta.status } : {}),
      ...(meta.archived ? { archived: meta.archived } : {}),
    });
  }
  return out;
}

function sectionBody(src: string, heading: string, nextHeadings: string[]): string {
  const re = new RegExp(`^## ${heading}\\s*$`, "im");
  const m = re.exec(src);
  if (!m || m.index === undefined) return "";
  const start = m.index + m[0].length;
  let end = src.length;
  for (const nxt of nextHeadings) {
    const nre = new RegExp(`^## ${nxt}\\s*$`, "im");
    nre.lastIndex = start;
    const n = nre.exec(src);
    if (n && n.index >= start && n.index < end) end = n.index;
  }
  return src.slice(start, end);
}

export function parseWishlist(raw: string): WishlistDoc {
  if (!raw.trim()) return emptyWishlist();
  const src = raw.replace(/\r\n/g, "\n");
  return {
    active: parseSection(sectionBody(src, "Active", ["Archive"])),
    archive: parseSection(sectionBody(src, "Archive", [])),
  };
}

export function titleFromWishes(items: readonly { text: string }[]): string {
  const first = items[0]?.text.trim().split("\n")[0]?.trim() ?? "";
  return first.slice(0, 40);
}

export function briefFromWishes(items: readonly { text: string }[]): string {
  return items
    .map((it, i) => `${i + 1}. ${it.text.trim()}`)
    .join("\n\n");
}

export function parseWishHandoff(raw: string | null): WishHandoff | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<WishHandoff>;
    if (typeof v.projectId !== "string" || !Array.isArray(v.items)) return null;
    const items = v.items
      .map((it) => ({
        id: typeof it?.id === "string" ? it.id : "",
        text: typeof it?.text === "string" ? it.text : "",
      }))
      .filter((it) => it.text.trim());
    if (!items.length) return null;
    return { projectId: v.projectId, items };
  } catch {
    return null;
  }
}

export function writeWishHandoff(h: WishHandoff, storage: Pick<Storage, "setItem"> | null = defaultSession()): void {
  storage?.setItem(WISH_HANDOFF_KEY, JSON.stringify(h));
}

export function readWishHandoff(storage: Pick<Storage, "getItem"> | null = defaultSession()): WishHandoff | null {
  return parseWishHandoff(storage?.getItem(WISH_HANDOFF_KEY) ?? null);
}

function defaultSession(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}
