/**
 * UAT 報告格式規格 —— 種子內容與純函式。
 *
 * ## 單一真相在檔案，不在這裡
 *
 * 真正生效的規格是 `~/.anchorline/uat-format.md`。出題 skill 在出題**之前**
 * 會讀那個檔，所以「使用者在設定頁按存檔」與「skill 跟著改」之間不需要任何
 * 同步機制 —— 沒有副本就沒有不一致。
 *
 * 這個檔裡的 `UAT_FORMAT_DEFAULT` 只是**種子**：檔案不存在時填進 textarea
 * 當起點，以及「還原預設」要還原成什麼。它不會被自動寫到磁碟上 ——
 * 一載入設定頁就自動建檔，會讓每台機器的內容都凍結在「當時那一版的預設」，
 * 之後升級這個種子就再也推不動任何人。
 *
 * 純函式、零 I/O、不碰 DOM —— 所以測得動（見 `tests/uat-format.test.ts`）。
 */

/**
 * 預設規格種子。
 *
 * 內容的來源是 Uat skill 的出題品質門檻與 `uat-parser.ts` 的實際檔案方言。
 * **兩者必須一致**：這份文件描述的結構若與 `serializeUatReport` 產出的不同，
 * agent 會照著寫出解析不了的報告，而症狀是「題目全部消失」而不是錯誤訊息。
 */
export const UAT_FORMAT_DEFAULT = `# UAT 報告格式規格

這份文件是**出題 agent 的規格書**。產生實測清單前先讀它，照著出題。
使用者在 Anchorline 的「偏好設定 → UAT 格式」編輯這份文件，存檔後立即生效 ——
不必重開 App，也不必重啟 agent。

## 出題品質門檻

每一題必須同時滿足下面五條。這是這份規格的核心，不是建議：

1. **流程可重現** —— 步驟具體到「照著做就能做出來」。
   寫「進結帳頁，選一鍵付款」，不寫「測試結帳」。
2. **一步一行、一個原子動作** —— \`steps\` 陣列一步一個元素。
   禁止用「→」把多步串成一句：序列化時元素內的換行會被壓掉，塞進去的多步救不回來；
   而且失敗時使用者說不出是卡在哪一步。
3. **預期可判定** —— 看得出通過或失敗。
   寫「3 秒內顯示成功頁，訂單出現在歷史清單」，不寫「運作正常」。
4. **一題一行為** —— 一題混兩個行為，失敗時不知道是誰失敗。拆開。
5. **依操作動線排序** —— 主幹先通，不要照程式碼結構排。

題數對齊這次改動的範圍：小改 3–6 題，整頁功能 8–15 題。
**不要為了看起來完整而灌水** —— 每多一題就多一次使用者的時間。

## 題目寫法

- 標題是一句話的行為描述，不是模組名。寫「單頁結帳成功路徑」，不寫「結帳模組」。
- 需要前置環境（登入、開啟某個開關、準備測試資料）時，把它寫成該題流程的**第一步**，
  不要另外出一題「前置作業」—— 結果欄是使用者的裁決，不是出題工具的暫存區。
- 已經在前一輪通過、這一輪不重測的項目：**不要出題**。出成題再預填「不測」
  等於替使用者先做了裁決。

## 檔案結構（解析器認的方言）

報告檔由 CLI 產生，agent 不手寫這個檔。列在這裡是為了讓你知道每個欄位的去處：

\`\`\`markdown
# UAT: <報告標題>

**建立時間：** <ISO 時間>
**最後更新：** <ISO 時間>
**狀態：** 進行中

## T1 <題目標題> <!-- anc:t=<錨點> -->

**流程：**
1. <第一步>
2. <第二步>

**預期：**
<可判定的預期結果>

**結果：** 未測

**說明：**
（無）
\`\`\`

- \`anc:t=\` 錨點是每一題的身分，鑄出來就不再變。**沒有錨點的題勾不了。**
- \`**結果：**\` 只有五個值：\`未測\` / \`通過\` / \`失敗\` / \`不測\` / \`暫時跳過\`。
  認不得的詞一律退回「未測」——讓題目重新出現，比讓它安靜地消失安全。
- **「失敗」與「不測」必須填說明。** 這條規則由 \`setVerdict\` 執法，不要繞過它手改結果行。

## 讀回結果

使用者測完後直接讀那份 \`plans/uat-*.md\`：\`**結果：**\` 行是裁決，
\`**說明：**\` 是原因。**失敗題的說明就是修復工單的起點。**

修復時每一題的 commit 訊息獨立一行帶上該題的 \`anc:t=<錨點>\`（原樣照抄），
修復才串得回那一題的治理鏈。
`;

/**
 * 快照檔名規則。**與 Rust 端的 `valid_history_name` 是同一條規則的兩份實作。**
 *
 * 為什麼前端也要有一份：Rust 那份是**守門員**（前端繞過去也擋得住），
 * 這一份是**體貼**（送出前就知道點不開，不必等一個回傳 null 的往返）。
 * 兩份都在，安全性由 Rust 那份負責 —— 這一份刪掉不會有洞，只會變慢一點。
 */
export const HISTORY_NAME_RE = /^[0-9]{8}-[0-9]{6}(-[0-9]+)?\.md$/;

export function isHistoryName(name: string): boolean {
  return HISTORY_NAME_RE.test(name);
}

/**
 * 快照檔名 → 可讀的本地時間。
 *
 * 檔名的時間戳是 **UTC**（Rust 端沒有時區資料庫，見 `uat_format_stamp`），
 * 所以這裡不從檔名推時間，而是把 `mtimeMs` 轉成本地時區。檔名只當識別碼用。
 * 拿不到 mtime（0）時退回顯示檔名本身 —— 顯示 1970 年會比顯示檔名更誤導。
 */
export function snapshotLabel(name: string, mtimeMs: number): string {
  return mtimeMs ? localTime(mtimeMs) : name;
}

/** 毫秒 → 本地時間字串。全檔唯一的時間格式化點。 */
function localTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export type UatFormatSource = "manual" | "ai";

export type UatFormatLogEntry = {
  ts: string;
  source: UatFormatSource;
  note: string;
};

export const SOURCE_LABEL: Record<UatFormatSource, string> = {
  manual: "手動編輯",
  ai: "AI 調整",
};

/**
 * 變更紀錄 jsonl → 條目陣列，**新到舊**。
 *
 * 壞行跳過而不是整份放棄：這個檔是 append-only，一行寫壞（磁碟滿、程式被砍在
 * 半途）不該讓前面幾十筆正確的紀錄一起消失。認不得的 `source` 一律當手動 ——
 * 跟 UAT 結果詞的處理同一條規矩：往安全、往「不宣稱」的方向退。
 */
export function parseFormatLog(text: string): UatFormatLogEntry[] {
  const out: UatFormatLogEntry[] = [];
  for (const raw of (text || "").split(/\r?\n/)) {
    const s = raw.trim();
    if (!s) continue;
    let o: { ts?: unknown; source?: unknown; note?: unknown };
    try {
      o = JSON.parse(s);
    } catch {
      continue;
    }
    if (!o || typeof o !== "object" || typeof o.ts !== "string") continue;
    out.push({
      ts: o.ts,
      source: o.source === "ai" ? "ai" : "manual",
      note: typeof o.note === "string" ? o.note : "",
    });
  }
  return out.reverse();
}

/** ISO 時間戳 → 本地時間字串。認不得的字串原樣回傳，不要編一個時間出來。 */
export function formatLogTime(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : localTime(t);
}

/** AI 調整的變更說明：使用者的指示原文，截到 120 字 */
export function aiNote(instruction: string): string {
  const s = instruction.trim().replace(/\s+/g, " ");
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

/**
 * 剝掉模型自己加上的 markdown 圍欄。
 *
 * prompt 已經寫了「不要用圍欄包裹」，但那是**請求不是保證** —— 模型照樣會包，
 * 而包了之後存進去的規格第一行就是 ```markdown，下一次 AI 調整再包一層。
 * 幾輪之後檔案裡全是圍欄。在寫檔之前剝掉一次，成本是十行。
 *
 * 只剝「整份被一組圍欄包住」的情況。內文本來就有的程式碼區塊要留著 ——
 * 預設規格裡就有一個示範檔案結構的區塊，剝過頭會把它吃掉。
 */
export function stripFence(text: string): string {
  const s = text.trim();
  const m = s.match(/^(`{3,}|~{3,})[^\n]*\n([\s\S]*)$/);
  if (!m) return s;
  const fence = m[1]!;
  const body = m[2]!;
  // 收尾的圍欄必須至少跟開頭一樣長，而且是最後一個非空行
  const closing = new RegExp(`\\n?[ \\t]*${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`);
  if (!closing.test(body)) return s;
  return body.replace(closing, "").trim();
}

/**
 * 組出 AI 調整的 user 訊息。當前內容在前、指示在後 —— 指示壓軸最不容易被忽略。
 *
 * system prompt 不在這裡，在 `prompt-registry.ts` 的 `uat-format-adjust`：
 * 那是靜態指令，使用者要能在設定頁看到並覆寫它。這裡組的是動態內容
 * （當下的規格全文與這一次的指示），那些不是使用者要調的東西。
 */
export function aiAdjustUser(current: string, instruction: string): string {
  return [
    "以下是目前的規格文件：",
    "",
    current,
    "",
    "---",
    "",
    `使用者的修訂指示：${instruction.trim()}`,
    "",
    "請回傳完整的修訂後 markdown 全文（不是差異、不是片段）。",
  ].join("\n");
}
