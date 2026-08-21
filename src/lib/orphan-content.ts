/**
 * 孤兒正文 —— 有內容、但不屬於目前章節結構的那些欄位。
 *
 * `applyFullTemplate()`（套整份 PRD 範本）與 `setProjectDomain()`（換領域包）
 * 都會置換整份骨架，而且**刻意不刪正文**：刪掉的話使用者一個誤按就永久失去
 * 寫過的東西。代價是那些內容從此沒有任何畫面顯示 —— 編輯台不畫、審閱頁不算
 * 分，只有匯出 Markdown 時才會突然冒出來。
 *
 * 這一層把「看不見的東西」重新算成一份可以逐段處理的清單。抽成純函式的理由
 * 跟 `section-meta.ts` 一樣：`store.ts` 透過 `data/domains` 用了 Vite 專屬的
 * `import.meta.glob`，`bun test` 載不進來，而這裡正是最不能算錯的部分。
 *
 * 這一版**不做自動配對**。猜「三行摘要」該搬到「問題」是猜使用者的意圖，
 * 猜錯的代價是他得先把我們搬錯的東西搬回去 —— 比不猜還貴。
 */
import type { Section } from "../data/types";

/** 一段孤兒正文。以「欄位」為單位，不是以「章節」為單位。 */
export interface OrphanEntry {
  /** 原本所屬的章節 id —— 已經不在目前骨架裡 */
  sectionId: string;
  /** 原本所屬的欄位 key */
  fieldKey: string;
  /** 原文，不 trim：顯示要跟使用者寫的一模一樣 */
  text: string;
}

/** 搬移／刪除時指名一段孤兒或一個落點 */
export interface OrphanRef {
  sectionId: string;
  fieldKey: string;
}

/**
 * 有正文、但（章節、欄位）這一組不在目前骨架裡的所有欄位。
 *
 * 以欄位為單位判斷，不是以章節為單位：範本或領域包可能保留同一個
 * `sectionId` 但拿掉／改名其中某個欄位，這時候整節不能因為 id 還在就整批
 * 放過 —— 那個被拿掉的欄位一樣要算孤兒，不然它會卡在一個誰都不會再檢查的
 * 地方：畫面不畫（欄位不在目前這節的定義裡），孤兒面板也不列（因為當初判斷
 * 只看了章節 id）。空白值（含全空白）一律不算 —— 那不是內容，列出來只會讓
 * 「有 N 段內容不見了」這句話變成謊話。
 */
export function findOrphans(
  sections: Section[],
  values: Record<string, Record<string, string>>,
): OrphanEntry[] {
  const liveFields = new Map<string, Set<string>>();
  for (const s of sections) liveFields.set(s.id, new Set(s.fields.map((f) => f.key)));
  const out: OrphanEntry[] = [];
  for (const [sectionId, fields] of Object.entries(values)) {
    if (!fields) continue;
    const keys = liveFields.get(sectionId);
    for (const [fieldKey, text] of Object.entries(fields)) {
      if (keys?.has(fieldKey)) continue;
      if (typeof text !== "string" || !text.trim()) continue;
      out.push({ sectionId, fieldKey, text });
    }
  }
  return out;
}

/**
 * 「使用者現在看到的值」：草稿蓋過已存的，兩邊都沒有這個欄位就不存在。
 *
 * 孤兒偵測要照這份疊過的值判斷，不能只看已存的那份 —— 使用者換骨架前打了
 * 字但還沒按存檔，那段字一樣要算孤兒，不然它會卡在兩邊都找不到的地方：
 * 編輯台不畫（欄位不在新骨架），孤兒面板也不列（只掃了已存的 bag）。
 */
export function visibleValues(
  saved: Record<string, Record<string, string>>,
  drafts: Record<string, Record<string, string>>,
): Record<string, Record<string, string>> {
  const ids = new Set([...Object.keys(saved), ...Object.keys(drafts)]);
  const out: Record<string, Record<string, string>> = {};
  for (const id of ids) {
    const merged = { ...(saved[id] ?? {}), ...(drafts[id] ?? {}) };
    if (Object.keys(merged).length) out[id] = merged;
  }
  return out;
}

/**
 * 把一段內容併進既有內容的尾巴。
 *
 * 目標非空時中間空一行（Markdown 的段落分隔）；目標是空的就直接放進去 ——
 * 補一個前導空行等於在使用者的文件開頭留一個他沒有打的空白段落。
 * 只處理接縫：內文中間的空行原封不動。
 */
export function appendInto(current: string, incoming: string): string {
  const base = current.replace(/\s+$/, "");
  const add = incoming.replace(/^\s+/, "").replace(/\s+$/, "");
  if (!add) return base;
  if (!base) return add;
  return `${base}\n\n${add}`;
}

/**
 * 一段孤兒在畫面上該怎麼稱呼。
 *
 * `sectionId` / `fieldKey` 是內部名稱，對使用者沒有意義。能在候選章節池裡
 * 找到同 id 的就用「編號 標題」，找不到就**照實顯示原始 id** —— 編一個好看
 * 的名字出來會讓使用者以為那是他自己命名的章節。
 *
 * **candidate pool 不能是呼叫端目前的骨架。** 孤兒的定義就是「id 不在目前
 * 骨架裡」，拿目前骨架當池子送進來，`find` 保證每次都落空——呼叫端要傳一個
 * 更大的池子（例如所有已知領域包攤平後的字典）才有機會真的查到。換領域包
 * 造成的孤兒查得到；套一次性範本造成的孤兒本來就不屬於任何領域包，查不到
 * 是誠實的結果。
 */
export function labelForOrphan(
  entry: OrphanEntry,
  known: Section[],
): { section: string; field: string } {
  const s = known.find((x) => x.id === entry.sectionId);
  const f = s?.fields.find((x) => x.key === entry.fieldKey);
  return {
    section: s ? `${s.n} ${s.title}`.trim() : entry.sectionId,
    field: f?.label ?? entry.fieldKey,
  };
}

/**
 * 從正文袋裡拿掉一個欄位。整節只剩空殼時連節一起拿掉 —— 留著會讓
 * `findOrphans` 之外的地方（例如「這個專案有幾節寫過」）繼續看到一個幽靈。
 */
export function withoutField(
  values: Record<string, Record<string, string>>,
  ref: OrphanRef,
): Record<string, Record<string, string>> {
  const cur = values[ref.sectionId];
  if (!cur || !(ref.fieldKey in cur)) return values;
  const next = { ...cur };
  delete next[ref.fieldKey];
  const out = { ...values };
  if (Object.keys(next).length) out[ref.sectionId] = next;
  else delete out[ref.sectionId];
  return out;
}
