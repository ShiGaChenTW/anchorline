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

export type WishKind = "feature" | "bug" | "maintenance";

export const WISH_KIND_LABEL: Record<WishKind, string> = {
  feature: "新功能",
  bug: "Bug 修復",
  maintenance: "維護／重構",
};

export const WISH_KINDS: WishKind[] = ["feature", "bug", "maintenance"];

export function parseWishKind(raw: string | undefined | null): WishKind | null {
  const s = (raw ?? "").trim();
  if (s === "feature" || s === "bug" || s === "maintenance") return s;
  return null;
}

export type WishlistItem = {
  id: string;
  text: string;
  created: string;
  /** 對應 OpenSpec 入口第 1 步的類型 */
  kind?: WishKind;
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
  kind: WishKind;
  items: { id: string; text: string; kind?: WishKind }[];
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

/**
 * 專案簡寫改名：既有願望的 id（`舊簡寫-001` 這種）跟著換成新簡寫，流水號不變。
 *
 * 為什麼要主動搬，不能放著不管：簡寫是 wish list 取號的前綴，id 不會因為
 * 專案設定改了就自動重算——放著不管，舊願望會變成沒人認得的孤兒 id，
 * 而新願望從新簡寫的 001 開始編，兩批號碼各管各的，看起來像兩個專案。
 */
export function renameWishlistCode(doc: WishlistDoc, oldCode: string, newCode: string): WishlistDoc {
  const rename = (it: WishlistItem): WishlistItem => {
    const n = wishNumberOf(it.id, oldCode);
    return n == null ? it : { ...it, id: formatWishId(newCode, n) };
  };
  return { active: doc.active.map(rename), archive: doc.archive.map(rename) };
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
  kind: WishKind = "feature",
): WishlistDoc | null {
  const trimmed = normalizeText(text);
  if (!trimmed) return null;
  const taken = [...doc.active, ...doc.archive].some((it) => it.id === id);
  if (!id.trim() || taken) return null;
  const item: WishlistItem = { id: id.trim(), text: trimmed, created: localStamp(now), kind };
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

export function updateWish(
  doc: WishlistDoc,
  id: string,
  text: string,
  kind?: WishKind,
): WishlistDoc | null {
  const trimmed = normalizeText(text);
  if (!trimmed) return null;
  const patch = (list: WishlistItem[]) =>
    list.map((it) =>
      it.id === id ? { ...it, text: trimmed, ...(kind ? { kind } : {}) } : it,
    );
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
    lines.push(`### ${it.id}`, "", `created: ${it.created}`);
    if (it.kind) lines.push(`kind: ${it.kind}`);
    lines.push("", it.text, "");
  }
  lines.push("## Archive", "");
  if (!doc.archive.length) lines.push("（沒有）", "");
  for (const it of doc.archive) {
    lines.push(`### ${it.id}`, "");
    lines.push(`created: ${it.created}`);
    if (it.kind) lines.push(`kind: ${it.kind}`);
    lines.push(`status: ${it.status ?? WISH_ARCHIVED_STATUS}`);
    if (it.archived) lines.push(`archived: ${it.archived}`);
    lines.push("", it.text, "");
  }
  return lines.join("\n").replace(/\n+$/, "\n");
}

const META_RE = /^(created|status|archived|kind):\s*(.*)$/;

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
    const kind = parseWishKind(meta.kind);
    out.push({
      id,
      text: itemText,
      created: meta.created || "",
      ...(kind ? { kind } : {}),
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

/**
 * OpenSpec 入口「帶入願望」下拉的選項文字。
 * id 認人、類型決定第 1 步選哪張卡、正文第一行認內容 ——
 * 三個都在同一行，使用者才選得到對的那一條，不必先回編輯台比對。
 */
export function wishOptionLabel(it: { id: string; text: string; kind?: WishKind }): string {
  const kind = it.kind ? WISH_KIND_LABEL[it.kind] : "未分類";
  return `${it.id} · ${kind} · ${titleFromWishes([it])}`;
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
      .map((it) => {
        const kind = parseWishKind(typeof it?.kind === "string" ? it.kind : "");
        return {
          id: typeof it?.id === "string" ? it.id : "",
          text: typeof it?.text === "string" ? it.text : "",
          ...(kind ? { kind } : {}),
        };
      })
      .filter((it) => it.text.trim());
    if (!items.length) return null;
    const kind = parseWishKind(typeof v.kind === "string" ? v.kind : "") ?? items[0]?.kind ?? "feature";
    return { projectId: v.projectId, kind, items };
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

// ── 願望正文裡的截圖 ──────────────────────────────────────────────────
//
// 圖檔落在 `.anchorline/wishlist-assets/`，正文裡放一行相對 markdown
// （`![截圖](wishlist-assets/ANCHL-002-01.png)`）。**不另存一份圖片清單**：
// 「圖要依正文順序排列」這個要求，只要 ref 就在正文裡就自動成立；
// 額外維護一個 evidence 陣列反而要再想辦法把順序對回正文。
//
// 刪圖＝在正文刪掉那一行。孤兒檔留在 assets 目錄裡，不做刪檔——
// 正文是唯一的紀錄，多一個檔案不會讓任何判定出錯。

/** 相對 `.anchorline/function-wishlist.md` 的資產目錄 */
export const WISH_ASSET_DIR = "wishlist-assets";

const WISH_IMAGE_NAME_RE = /^[A-Za-z0-9]{1,8}-\d{3}-\d{2,}\.(?:png|jpg|jpeg|webp)$/;
const WISH_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp"]);

export function isWishImageName(name: string): boolean {
  return WISH_IMAGE_NAME_RE.test(name.trim());
}

export function wishImageRel(name: string): string {
  return `${WISH_ASSET_DIR}/${name}`;
}

/** 圖檔絕對路徑。目錄由原生端寫死，這裡只給 UI 顯示用。 */
export function wishImagePath(rootPath: string, name: string): string {
  const base = rootPath.replace(/\/+$/, "");
  return `${base}/.anchorline/${WISH_ASSET_DIR}/${name}`;
}

/** 正文裡插的那一行 */
export function wishImageMarkdown(name: string): string {
  return `![截圖](${wishImageRel(name)})`;
}

/**
 * 下一張圖的檔名：`<願望編號>-<兩位流水號>.<副檔名>`（ANCHL-002-01.png）。
 * 流水號看的是整份清單已用掉的名字，不是這一則的——同一個編號被移除又取回時，
 * 只看這一則會撞到還躺在磁碟上的舊檔並覆蓋掉它。
 */
export function nextWishImageName(
  wishId: string,
  used: readonly string[],
  ext = "png",
): string {
  const head = wishId.trim();
  const safeExt = WISH_IMAGE_EXTS.has(ext.toLowerCase()) ? ext.toLowerCase() : "png";
  const re = new RegExp(`^${escapeRe(head)}-(\\d{2,})\\.`, "i");
  let max = 0;
  for (const name of used) {
    const m = re.exec(name);
    if (!m) continue;
    const n = Number(m[1]);
    if (n > max) max = n;
  }
  return `${head}-${String(max + 1).padStart(2, "0")}.${safeExt}`;
}

const WISH_IMAGE_REF_RE = /!\[[^\]]*\]\(([^)\s]+)\)/g;

/** 一段正文裡引用到的圖檔名，依出現順序 */
export function wishImageNamesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(WISH_IMAGE_REF_RE)) {
    const name = (m[1] ?? "").split("/").pop() ?? "";
    if (isWishImageName(name)) out.push(name);
  }
  return out;
}

/** 整份清單已經用掉的圖檔名（含封存），給 `nextWishImageName` 當基準 */
export function usedWishImageNames(doc: WishlistDoc): string[] {
  return [...doc.active, ...doc.archive].flatMap((it) => wishImageNamesIn(it.text));
}

export type WishSegment =
  | { kind: "text"; text: string }
  | { kind: "image"; name: string; alt: string };

/**
 * 正文 → 文字與圖交錯的片段，順序就是正文順序。清單那一格照這個順序畫，
 * 使用者看到的排列才會跟他打的字一致。
 */
export function splitWishText(text: string): WishSegment[] {
  const out: WishSegment[] = [];
  let last = 0;
  const re = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
  for (const m of text.matchAll(re)) {
    const name = (m[2] ?? "").split("/").pop() ?? "";
    if (!isWishImageName(name)) continue;
    const at = m.index ?? 0;
    const before = text.slice(last, at);
    if (before.trim()) out.push({ kind: "text", text: before.trim() });
    out.push({ kind: "image", name, alt: (m[1] ?? "").trim() || name });
    last = at + m[0].length;
  }
  const tail = text.slice(last);
  if (tail.trim()) out.push({ kind: "text", text: tail.trim() });
  return out;
}

/**
 * 在游標位置插一段字，回新的正文與插完後的游標位置。
 * 貼多張圖時呼叫端會連續呼叫，游標一路往後推，圖才會照貼上的順序排。
 */
export function insertAtCaret(
  text: string,
  start: number,
  end: number,
  insert: string,
): { text: string; caret: number } {
  const a = Math.max(0, Math.min(start, text.length));
  const b = Math.max(a, Math.min(end, text.length));
  const before = text.slice(0, a);
  const after = text.slice(b);
  // 圖自己一行：貼在句子中間時不要把那一行的字擠到圖旁邊
  const head = before && !before.endsWith("\n") ? "\n" : "";
  const tail = after.startsWith("\n") || !after ? "\n" : "\n\n";
  const chunk = `${head}${insert}${tail}`;
  return { text: `${before}${chunk}${after}`, caret: before.length + chunk.length };
}
