/**
 * 範本庫的篩選與排序 —— 純函式，零 I/O、零 DOM。
 *
 * ## 為什麼獨立成一支
 *
 * 「卡片」與「列表」是同一份結果的兩種畫法。判定如果留在
 * `pages/templates.ts` 的渲染函式裡，兩種畫法遲早各自帶一份篩選條件，
 * 而症狀是**切換檢視筆數會變** —— 使用者只會覺得東西不見了，
 * 不會知道是兩份 filter 分岔。所以篩選只有這裡一份，兩邊都呼叫它。
 *
 * ## 排序是三態，不是兩態
 *
 * 點同一個表頭：升冪 → 降冪 → **回到預設順序**。少了第三態就回不去
 * `store.templates` 的原始順序（那是「內建範本的推薦順序」，有意義），
 * 而使用者會開始用重新整理當作復原鍵。
 */
import { templateKind } from "../data/types";
import type { Template, TemplateCat, TemplateKind } from "../data/types";

/** 可排序的欄位。與列表表頭一一對應。 */
export type SortKey = "title" | "cat" | "outline" | "uses" | "source";

export type SortDir = "asc" | "desc";

/** `null` = 沒有排序，維持資料原本的順序 */
export type SortState = { key: SortKey; dir: SortDir } | null;

export type ViewMode = "cards" | "list";

export type TemplateFilter = {
  kind: TemplateKind;
  /** `"all"` 代表不依分類篩 */
  cat: "all" | TemplateCat;
  /** 使用者輸入的搜尋字串，未正規化 */
  q: string;
};

/**
 * 整份範本的段落數。卡片上顯示的「N 個段落」與列表的排序共用這一支，
 * 免得兩邊各數一次而數出不同的值。
 */
export function outlineOf(t: Template): string[] {
  return t.body
    .split("\n")
    .filter((l) => /^#{1,3} /.test(l))
    .map((l) => l.replace(/^#{1,3} /, "").trim())
    .filter(Boolean);
}

export function outlineCount(t: Template): number {
  return templateKind(t) === "full" ? outlineOf(t).length : 0;
}

/**
 * 三個篩選軸的交集。順序刻意由便宜到貴：kind 與 cat 是欄位比對，
 * 搜尋要做兩次 toLowerCase 與 includes。
 *
 * 搜尋同時比對 `title`（英數大小寫不敏感）與 `blurb`（中文原字串比對）——
 * 中文沒有大小寫，對中文做 toLowerCase 只是白花時間。
 */
export function filterTemplates(all: readonly Template[], f: TemplateFilter): Template[] {
  const q = f.q.trim();
  const lower = q.toLowerCase();
  return all.filter((t) => {
    if (templateKind(t) !== f.kind) return false;
    if (f.cat !== "all" && t.cat !== f.cat) return false;
    if (!q) return true;
    return t.title.toLowerCase().includes(lower) || t.blurb.includes(q);
  });
}

/** 排序用的取值。回傳 string 走 localeCompare，number 走相減。 */
function valueOf(t: Template, key: SortKey): string | number {
  switch (key) {
    case "title":
      return t.title;
    case "cat":
      return t.cat;
    case "outline":
      return outlineCount(t);
    case "uses":
      return t.uses;
    case "source":
      return t.source ?? "";
  }
}

/**
 * 排序。**不改動輸入陣列** —— 呼叫端拿到的 `store.templates` 是 state 的一部分，
 * 原地 sort 會靜靜改掉別的畫面看到的順序。
 *
 * 中文用 `localeCompare` 的 `zh-Hant`：預設的字碼點排序會把「一」排在「三」
 * 後面，看起來像沒排序。
 */
export function sortTemplates(list: readonly Template[], sort: SortState): Template[] {
  if (!sort) return [...list];
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = valueOf(a, sort.key);
    const vb = valueOf(b, sort.key);
    if (typeof va === "number" && typeof vb === "number") {
      // 數值相同就用標題當第二鍵，否則同分項目的順序會隨瀏覽器實作飄
      if (va !== vb) return (va - vb) * sign;
      return a.title.localeCompare(b.title, "zh-Hant");
    }
    const cmp = String(va).localeCompare(String(vb), "zh-Hant");
    if (cmp !== 0) return cmp * sign;
    return a.title.localeCompare(b.title, "zh-Hant");
  });
}

/**
 * 點表頭之後的下一個排序狀態。
 *
 * 同一欄：asc → desc → null（回到預設）。換一欄：一律從 asc 開始 ——
 * 沿用上一欄的方向會讓人以為「我沒選方向它卻是降冪」是壞掉了。
 */
export function nextSort(current: SortState, key: SortKey): SortState {
  if (!current || current.key !== key) return { key, dir: "asc" };
  if (current.dir === "asc") return { key, dir: "desc" };
  return null;
}

/** 表頭要畫的箭頭。沒排序的欄位不畫，畫了就等於宣稱它在排序。 */
export function sortIndicator(sort: SortState, key: SortKey): "" | "▲" | "▼" {
  if (!sort || sort.key !== key) return "";
  return sort.dir === "asc" ? "▲" : "▼";
}

// ── 檢視偏好 ────────────────────────────────────────────────────

export const VIEW_KEY = "anchorline:tpl-view";

/** 認不得的值一律回 cards —— 那是原本的行為，未知不該變成新畫面 */
export function asViewMode(raw: string | null | undefined): ViewMode {
  return raw === "list" ? "list" : "cards";
}

// ── 領域包來源篩選 ──────────────────────────────────────────────

export type PackOrigin = "builtin" | "custom" | "override";
export type PackOriginFilter = "all" | PackOrigin;

/**
 * 領域包的來源篩選。這一頁三個分頁裡，只有領域包完全沒有篩選器 ——
 * 而「哪些是我自己改過的」正是這個分頁最常被問的問題。
 */
export function filterByOrigin<T extends { origin: PackOrigin }>(
  packs: readonly T[],
  origin: PackOriginFilter,
): T[] {
  return origin === "all" ? [...packs] : packs.filter((p) => p.origin === origin);
}
