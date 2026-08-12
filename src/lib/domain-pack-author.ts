/**
 * 用 LLM 跟使用者協作產出領域包。
 *
 * 設計上只有一條規則：**模型的輸出一律先過 `parseDomainPack()` 才算數。**
 * 生成領域包和生成散文不同——這份 markdown 會決定哪些條件擋簽核，
 * 一個縮排寫歪的 YAML 不是「品質差一點」，是整個領域包不存在。
 * 所以驗證不是加分項，是這個模組唯一真正在做的事；
 * 驗不過就把錯誤原文餵回去讓它自己修，修不好就誠實說失敗。
 *
 * 為什麼不做成聊天介面：使用者要的是一份可以存檔、可以版控、可以手改的 `.md`，
 * 不是一段對話。「描述 → 產生 → 看 → 說哪裡不對 → 再產生」四步就夠了，
 * 每一步的產物都是完整的檔案。
 *
 * 模型呼叫由呼叫端注入而不是 import `ai-client`：那條 import 會把 store 與
 * `import.meta.glob` 一起拖進來，`bun test` 就載不動這個檔——而重試迴圈
 * （驗不過 → 把錯誤餵回去 → 再驗）正是最需要被測到的一段。
 * 這也沿用 prd-agent「prompter 可注入」的設計。
 */
import { type DomainPack, validatePackStructure as validate } from "./domain-pack";

export { validatePackStructure as validate } from "./domain-pack";

/**
 * SCHEMA 尾端附的最小合法範例。
 *
 * 抽成獨立常數的唯一理由：測試要能把它餵進 validatePackStructure()。
 * 一份教模型格式的範例如果自己就驗不過，教出來的全是驗不過的包——
 * 而這種錯不會有任何執行期症狀，只會默默拉高產包失敗率。
 */
export const SCHEMA_EXAMPLE = `---
name: example_pack
displayName: 範例領域
industry: 範例產業
extends: _base
prompt: |
  - 必須涵蓋：主管機關申報義務（範例法 §12）
  - 引用法規要寫具體條號，例如「範例法施行細則 §3」
sections:
  - id: reg_report
    n: "08"
    title: 申報義務
    desc: 向主管機關申報的範圍與時限
    guide: 寫清楚要向誰申報、期限幾個工作日、漏報的後果
    tips:
      - "注意：期限以工作日計，不含例假日"
    example: 重大事故於知悉後 5 個工作日內向主管機關完成申報
    fields:
      - key: report_scope
        label: 申報範圍
        hint: 哪些事件觸發申報義務
        type: textarea
        rows: 4
gates:
  - rules:
      - id: reg_report_present
        level: block
        label: 申報範圍不可空白
        detail: 缺 {count} 個欄位：{missing}
        section: reg_report
        fields: [report_scope]
        require: { kind: present }
    pass: { id: reg_report_ok, label: 申報章節齊備, detail: 申報範圍已填寫 }
---`;

/** 模型每次都要重讀一次的規格。長，但比讓它猜便宜。 */
const SCHEMA = `你要輸出一個 Anchorline「領域包」檔案：一份 Markdown，全部語意在 YAML frontmatter 裡。

輸出規則（違反任何一條都會被程式拒收）：
- 只輸出檔案內容本身。不要有任何前言、說明、或 \`\`\` 圍欄。
- 第一行必須是 ---，frontmatter 之後必須有一行 --- 收尾。
- frontmatter 是合法 YAML。中文字串若含 : 或 # 請加引號。

frontmatter 欄位：
  name         必填。英數與底線的識別碼，例如 insurance。不可用 _ 開頭。
  displayName  必填。中文顯示名稱。
  industry     選填。產業標籤字串。
  extends      固定填 _base。
  prompt       必填。多行字串（用 |）。疊在 AI system prompt 最前面的領域知識：
               必須涵蓋哪些面向、引用哪些法規條號。不要寫「請寫得專業」這種廢話。
  sections     選填。新增的 PRD 章節陣列。每項：
               id（英數底線，唯一）、n（顯示編號字串，從 "08" 起算，不可重號）、
               title、desc、guide（怎樣算寫得合格）、tips（字串陣列）、
               example（可照抄改寫的短例）、
               fields（陣列：key 唯一 / label / hint / type 為 textarea 或 text / rows 數字）、
               checks（選填陣列：id / label / pass: false）
  gates        選填。擋簽核的硬規則。每項是一個 group：
               { rules: [ { id, level, label, detail, section, fields, require } ], pass?: {id,label,detail} }
               level 為 block（擋送審）或 warn（只提醒）。
               id 全域唯一。section 必須是上面 sections 裡真實存在的 id。
               fields 是該 section 裡真實存在的 key 陣列；省略代表整章合併判定。
               detail 可用 {count} 與 {missing} 兩個佔位符。
  hints        選填。只給寫作教練看、不擋簽核。語法與 gates 完全相同。

require 只有四種，不可組合、不可自創：
  { kind: present }                      指定欄位都不可空白
  { kind: minLength, n: 30 }             文字長度下限
  { kind: match, re: "甲|乙", flags: i } 正規表達式要命中（flags 選填）
  { kind: bullets, min: 3 }              列點條目數下限

領域規則的品質要求：
- 每一條 block 都要對應一個真實的失效後果（裁罰、申訴、上線後才發現）。
  寫不出後果的，改成 warn 或不要寫。
- 需要人類判斷力的事（「論述是否充分」）不要寫成 gate——那交給 AI 助教。
  gate 只放「用關鍵字、長度、條目數就能決定性判斷」的東西。
- 章節只加通用 7 章（三行摘要／問題陳述／目標與非目標／成功指標／使用者故事／
  範圍與階段／開放問題）沒有對應物的。重複開一份只會讓同一件事有兩個地方可寫。
- 全部使用繁體中文。引用法規寫出具體條號或函令名稱。

長度限制（超過會被模型的輸出上限切斷，整份作廢）：
- 章節最多 4 個。挑最重要的，不要把所有想得到的都放進去。
- 每個章節的 guide 最多 3 行、tips 最多 4 條、example 最多 3 行、欄位最多 4 個。
- prompt 最多 20 行。條列必須涵蓋的法規面向即可，不要展開成教學。
- gates 最多 6 條。

以下是一份最小合法範例（結構示範，內容請勿照抄）：

${SCHEMA_EXAMPLE}`;

export type AuthorInput = {
  /** 使用者對這個產業／子領域的描述 */
  brief: string;
  /** 上一版的原始 markdown（迭代時帶上） */
  prior?: string;
  /** 使用者對上一版的修改指示 */
  instruction?: string;
};

export type AuthorResult =
  | { ok: true; raw: string; pack: DomainPack; repaired: boolean }
  | { ok: false; reason: string; raw?: string };

/**
 * 從模型的回覆裡把領域包檔案挖出來。
 *
 * 叫它「只輸出檔案內容」是沒有用的——實測它會加 ``` 圍欄、會在前面寫
 * 「好的，以下是…」、會在後面補一段說明。這些都不是品質問題，是模型的常態。
 * 解析器對磁碟上的檔案應該嚴格（第一行就要是 `---`），但對模型輸出嚴格
 * 只會換來一個「產生失敗：缺少 frontmatter」，而內容其實好好的躺在那裡。
 *
 * 挖的方式：先脫圍欄，再從第一行單獨的 `---` 開始取，取到收尾的 `---` 之後
 * 的所有內容（正文不使用，但留著讓使用者看得到模型寫了什麼）。
 */
export function extractPackSource(text: string): string {
  const fenced = text.match(/```(?:markdown|md|yaml)?\s*\n([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : text).replace(/\r\n/g, "\n").trim();
  if (body.startsWith("---\n")) return body;

  // frontmatter 不在開頭：找第一行單獨的 ---，從那裡開始
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.trim() === "---");
  if (start < 0) return body; // 真的沒有，讓解析器去報「缺少 frontmatter」
  return lines.slice(start).join("\n").trim();
}

const stripFence = extractPackSource;

function userPrompt(input: AuthorInput): string {
  if (input.prior) {
    return `這是目前這一版的領域包：

${input.prior}

使用者的修改指示：
${input.instruction || "（無，請自行改進明顯的問題）"}

輸出**完整的新版檔案**，不要只給差異。
frontmatter 的 name 欄位必須與上一版完全相同，不可更改——專案與每域寫作設定都用 name 當 key，改了會斷引用。`;
  }
  return `使用者對這個領域的描述：

${input.brief}

依上面的規格輸出一份完整的領域包檔案。`;
}

/**
 * 產生並驗證。第一次驗不過時，把解析器的錯誤原文餵回去修一次。
 *
 * 只修一次：修兩次以上通常代表 brief 本身有問題，繼續燒 token 不會變好，
 * 讓使用者看到錯誤自己調描述比較快。
 */
export type Complete = (
  system: string,
  user: string,
  opts?: { temperature?: number; jsonMode?: boolean },
) => Promise<string>;

// YAML 是縮排敏感的結構輸出，降溫減少格式漂移；但它不是 JSON，不開 jsonMode。
const AUTHOR_OPTS = { temperature: 0.2 };

export async function authorDomainPack(input: AuthorInput, complete: Complete): Promise<AuthorResult> {
  let raw: string;
  try {
    raw = stripFence(await complete(SCHEMA, userPrompt(input), AUTHOR_OPTS));
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }

  const cut = looksTruncated(raw);
  if (cut) return { ok: false, reason: cut, raw };

  const first = validate(raw, "AI 產出");
  if (first.ok) return { ok: true, raw, pack: first.pack, repaired: false };

  let fixed: string;
  try {
    fixed = stripFence(
      await complete(
        SCHEMA,
        `你上一次的輸出無法通過解析：

${first.reason}

這是那份輸出：

${raw}

修正這個問題，輸出完整的新版檔案。不要解釋，只輸出檔案內容。`,
        AUTHOR_OPTS,
      ),
    );
  } catch (e) {
    return { ok: false, reason: `${first.reason}（重試也失敗：${e instanceof Error ? e.message : String(e)}）`, raw };
  }

  const cut2 = looksTruncated(fixed);
  if (cut2) return { ok: false, reason: cut2, raw: fixed };

  const second = validate(fixed, "AI 產出");
  if (second.ok) return { ok: true, raw: fixed, pack: second.pack, repaired: true };
  return { ok: false, reason: `修正後仍無法解析：${second.reason}`, raw: fixed };
}

/**
 * 開頭有 `---` 但找不到收尾的 `---` = 回應在半路被切斷。
 *
 * 這個區分很重要：解析器對兩種情況都只會說「缺少 frontmatter」，於是所有人
 * 去查格式，而真正的原因是輸出長度上限。實測一份五章的領域包會被 4096 tokens
 * 切在半句話——訊息指錯方向，就會白花一整輪。
 */
export function looksTruncated(source: string): string | null {
  const lines = source.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const closing = lines.slice(1).findIndex((l) => l.trim() === "---");
  if (closing >= 0) return null;
  return "產出被截斷了（frontmatter 沒有收尾的 ---）。多半是回應超過長度上限——把描述縮小，或分成兩個領域分別產生。";
}
