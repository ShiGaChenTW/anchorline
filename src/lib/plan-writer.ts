/**
 * 把勾選寫回 `plans/*.md`。
 *
 * ## 為什麼有一整個檔在處理「寫回去」這件小事
 *
 * 因為 agent 可能同時在重寫同一份 plan。你在 App 裡勾一個步驟、按下去、
 * 整檔覆寫 —— agent 剛剛加的三個步驟就消失了，**而且沒有任何錯誤訊息**。
 * 那比功能沒做更糟：沒做的話你會去終端改，做壞的話你會信任它然後掉東西。
 *
 * ## 守衛用內容雜湊，不用 mtime
 *
 * mtime 看起來是自然選擇（live tracking 就用它），但它答錯了問題：
 * mtime 變了不代表內容變了（touch、同步工具），內容變了在同一秒內
 * mtime 也可能沒變。這裡要問的是「我讀到的那份還在嗎」，那就直接比內容。
 *
 * 代價是每次寫入前要多讀一次檔。一份 plan 幾 KB，那個代價是零。
 *
 * 純函式 + 一個需要注入 reader/writer 的協調函式。
 */
import { ANCHOR_PREFIX, ANCHOR_RE, anchorOf, mintId, type PlanStep } from "./plan-parser";

/** 讀取當下的憑證。寫回去之前拿它跟磁碟上的現況比對。 */
export type PlanGuard = {
  path: string;
  /** 讀到的原文雜湊 */
  hash: string;
  /** 讀到時的錨點集合。衝突訊息要靠它講清楚「多了什麼、少了什麼」 */
  anchors: string[];
};

/** 非密碼學用途：只是要一個穩定、便宜、碰撞機率夠低的內容指紋。 */
export function hashText(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 + c, 2246822519) ^ (h2 >>> 13);
  }
  return ((h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)).padStart(12, "0");
}

export function anchorsOf(text: string): string[] {
  // ponytail: 共用 plan-parser 的 ANCHOR_RE，不再自己抄一份。
  // 兩份正規表示式在改前綴時只改到一份 = 靜默失效的 join key。
  return [...text.matchAll(new RegExp(ANCHOR_RE.source, "g"))].map((m) => m[1]!);
}

export function guardOf(path: string, text: string): PlanGuard {
  return { path, hash: hashText(text), anchors: anchorsOf(text) };
}

/**
 * 磁碟上的現況跟我讀到的那份還是同一個嗎。
 *
 * 回 `null` 代表沒衝突。回字串代表**擋下寫入**，字串是給人看的原因。
 * 訊息要具體：「被改過了」讓人不知道發生什麼事，
 * 「agent 加了 3 個步驟」讓人知道該去看什麼。
 */
export function detectConflict(guard: PlanGuard, freshText: string): string | null {
  if (hashText(freshText) === guard.hash) return null;

  const fresh = new Set(anchorsOf(freshText));
  const mine = new Set(guard.anchors);
  const added = [...fresh].filter((a) => !mine.has(a)).length;
  const removed = [...mine].filter((a) => !fresh.has(a)).length;

  if (added || removed) {
    const parts = [added && `新增 ${added} 個步驟`, removed && `移除 ${removed} 個步驟`].filter(
      Boolean
    );
    return `這份計劃在你編輯期間被改過（${parts.join("、")}）。重新整理後再試。`;
  }
  return "這份計劃的內容在你編輯期間被改過。重新整理後再試。";
}

const CHECKBOX_LINE = /^(\s*-\s*\[)([ vVxX])(\]\s*)(.*)$/;

/**
 * 勾／取消勾一個步驟。**只動那一行的方框字元**，其餘一字不改。
 *
 * 不用「重新產生整份 markdown」是刻意的：那會把使用者手寫的縮排、註解、
 * 空行全部正規化掉，而那些是他的東西不是我們的。
 */
export function toggleStep(text: string, id: string, done: boolean): string {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (anchorOf(line) !== id) continue;
    const m = line.match(CHECKBOX_LINE);
    if (!m) continue;
    lines[i] = `${m[1]}${done ? "x" : " "}${m[3]}${m[4]}`;
    return lines.join("\n");
  }
  return text;
}

/**
 * 在 `## Plan Steps` 區段末尾加一個步驟，自動鑄錨點。
 *
 * 找不到那個區段就不加 —— 硬塞到檔尾會讓步驟落在「決策紀錄」之類的區段裡，
 * parser 讀不到，使用者只會覺得「按了沒反應」。回 `null` 讓呼叫端說清楚。
 */
export function appendStep(
  text: string,
  label: string,
  rand?: () => number
): { text: string; id: string } | null {
  const lines = text.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Plan Steps/i.test(lines[i]!.trim())) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;

  // 區段結尾 = 下一個 `## ` 或檔尾
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i]!.trim().startsWith("## ")) {
      end = i;
      break;
    }
  }
  // 往回找最後一個非空行，插在它後面而不是區段最尾端的空白裡
  let at = end;
  while (at > start + 1 && !lines[at - 1]!.trim()) at--;

  const used = new Set(anchorsOf(text));
  let id = mintId(rand);
  while (used.has(id)) id = mintId(rand);

  lines.splice(at, 0, `- [ ] ${label.trim()} <!-- ${ANCHOR_PREFIX}:t=${id} -->`);
  return { text: lines.join("\n"), id };
}

/**
 * 帶併發保護的寫入。**這是唯一該被 UI 呼叫的入口。**
 *
 * 流程：重讀 → 比對憑證 → 有衝突就擋 → 套用變更 → 寫回。
 * `read` / `write` 注入，所以測得動，也不綁死在 Tauri 上。
 */
export async function safeApply(
  guard: PlanGuard,
  mutate: (text: string) => string | null,
  io: {
    read: (path: string) => Promise<string>;
    write: (path: string, text: string) => Promise<void>;
  }
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  let fresh: string;
  try {
    fresh = await io.read(guard.path);
  } catch (e) {
    return { ok: false, reason: `讀不到檔案：${(e as Error).message}` };
  }

  const conflict = detectConflict(guard, fresh);
  if (conflict) return { ok: false, reason: conflict };

  const next = mutate(fresh);
  if (next === null) return { ok: false, reason: "找不到 ## Plan Steps 區段，沒有地方可以加" };
  if (next === fresh) return { ok: false, reason: "沒有變更" };

  try {
    await io.write(guard.path, next);
  } catch (e) {
    return { ok: false, reason: `寫不進去：${(e as Error).message}` };
  }
  return { ok: true, text: next };
}

/** 給呼叫端組事件用：勾選一個步驟該產生什麼 subject。 */
export function subjectOfStep(step: Pick<PlanStep, "id">): string | null {
  return step.id ? `${ANCHOR_PREFIX}:t=${step.id}` : null;
}
