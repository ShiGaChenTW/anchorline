# AI 按鈕 × Prompt 對照表

> 盤點日期：2026-08-12；同日依 `docs/handoff-ai-prompt-optimization.md` §4 完成 P0–P2
> 優化後同步更新。涵蓋 repo 內所有「按下去會呼叫 LLM」的按鈕（共 12 顆，4 個頁面），
> 以及每顆按鈕實際送出的 system / user prompt 全文。
> Prompt 原始碼集中在四個檔案：`src/lib/ai-coach.ts`、`src/lib/dashboard-optimize.ts`、
> `src/lib/domain-pack-author.ts`、`src/lib/ai-client.ts`（純函式在 `src/lib/ai-shared.ts`）。

## 總覽

| # | 頁面 · 按鈕 | 觸發函式 | 領域包疊加 | 採樣 |
|---|---|---|---|---|
| 1 | editor · 一鍵生稿 | `generateAIDraft`（ai-coach.ts） | ✅ | 0.2 + json |
| 2 | editor · 語調潤色 | `polishTextWithAI`（ai-coach.ts） | ✗（只留術語守則一句） | 0.5 |
| 3 | editor · 本機＋AI 評估 | `critiqueSectionWithAI`（ai-coach.ts） | ✅ | 0.2 + json |
| 4 | editor · 指令輸入框「送出」 | `generateAIDraft`（同 #1，帶自訂指令） | ✅ | 0.2 + json |
| 5 | editor · 撰寫初版（全部章節） | `writeFullPrd`（ai-coach.ts）→ 逐節呼叫 #1 | ✅ | 0.2 + json |
| 6 | editor · 只寫這一節 | `writeFullPrd`（單節） | ✅ | 0.2 + json |
| 7 | dashboard · 優化 Dashboard → 選一個 agent | `aiSuggestions`（dashboard-optimize.ts） | ✅ | 0.2 + json |
| 8 | agents · ▶ 呼叫進場 | `runAgentTask`（ai-coach.ts，經 store.ts） | ✅ | 設定值 |
| 9 | settings · AI 撰寫「產生建議」 | `suggestWriteProfile`（ai-coach.ts） | — | 0.2 + json |
| 10 | settings · 測試連線 | `testAiConnection`（ai-client.ts） | — | 設定值 |
| 11 | settings · 領域包產生器「產生」 | `authorDomainPack`（domain-pack-author.ts） | — | 0.2 |
| 12 | settings · 領域包產生器「依指示重產」 | `authorDomainPack`（帶 prior + instruction） | — | 0.2 |

**採樣分流（`ChatOpts`，ai-client.ts）**：可解析的結構任務（JSON/YAML）指定
`temperature: 0.2`，覆蓋設定頁的預設（0.7）；「json」表示同時開 `jsonMode`——
OpenAI 相容路徑帶 `response_format: {type:"json_object"}`（端點不支援時自動降級
重送不帶）、Gemini 帶 `responseMimeType: "application/json"`、Anthropic 無原生
JSON mode 忽略此旗標（該路徑靠降溫＋`extractJsonObject` 兜底）。潤色 0.5；
「設定值」= 沿用偏好設定的 temperature。#11–#12 是 YAML 不開 jsonMode。

**領域包疊加（`withDomain()`，ai-coach.ts）**：#1、#3–#8 的 system prompt 最前面會插入
目前專案領域包的 `prompt` 欄位（KYC 分類、AML STR、個資法 §27、金管會函令等法遵知識），
格式為 `{領域包 prompt}\n\n---\n\n{原 system prompt}`。#2 潤色刻意不疊（越潤越像合規
說明書），改為 system 內固定一句 `Preserve domain terminology; do not expand compliance
content.`；#9–#12 不疊。

**不算在內的**：tracking 頁「交接」按鈕只複製指令到剪貼簿給外部 agent，不呼叫模型；
dashboard 優化裡的「本機規則檢查」選項不打 API；editor 的「本機＋AI 評估」在未設 API Key
時也只跑本機規則。

---

## 1. editor · 一鍵生稿（`btn-ai-draft`）

逐欄生成／改寫目前章節內容。回傳 JSON patch，逐欄寫進草稿。

**System prompt**（`{語言}` = zh-TW 或 English；`{persona}` 依偏好設定）：

```
You are a PRD co-author for Anchorline / 產品規格。
Write in {語言}. Style: {persona}.
Return ONLY a JSON object whose keys are exactly the field keys listed.
Values are markdown-friendly plain text for each field.
Stay on-topic with the section title and existing draft.
Fill policy:
- Empty fields: fill from section guide, tips, project context, and existing draft.
- Non-empty fields: keep substance; only refine clarity unless User instruction asks a rewrite.
- Do not invent product features, vendors, metrics, or regulations not grounded in the provided context; write 【待補】 for unknowns.
Example output (keys must match exactly):
{"<該章第 1 個欄位 key>":"...","<第 2 個欄位 key>":"- ...\n- ..."}
JSON only, no markdown fences.
```

有設定寫作風格範例時，尾端追加：

```
Match the tone and structure of this sample the user provided:
"""
{styleSample，截 1500 字}
"""
```

persona 對應（`personaHint()`）：

| persona | 文字 |
|---|---|
| executive | `executive-ready, business risk and outcomes first` |
| technical | `technical architect, APIs and boundaries first` |
| concise | `concise bullets, minimal filler` |
| （預設） | `detailed specification with examples` |

**User prompt**：

```
Section {編號} {標題}
Guide: {section.guide}
Tips: {section.tips，以「；」串接}

Fields:
- {key}（{label}）：{hint 或 type}
（每欄一行）

{writeFullPrd 逐節累積傳入已寫章節摘錄時：}
Project context (already written sections, excerpts — keep new content consistent with these):
## {章節編號} {章節標題}
{該節欄位串接摘錄，每節截 300 字，總預算 3000 字，超過丟最舊}

Current draft:
### {key}
{目前內容，空欄標「（空）」}
（每欄一段）

{有全域寫作指令時：}
Workspace guidance (applies to every section):
{globalInstruction}

User instruction: improve and fill empty fields based on existing context.
Return JSON with keys: {全部欄位 key，逗號串接}
```

## 2. editor · 語調潤色（`btn-ai-polish`）

對本章每個非空欄位各呼叫一次。mode 由 persona 決定：concise → `concise`、
technical → `technical`、其餘 → `executive`。

**System prompt**（不疊 withDomain，見總覽）：

```
You polish PRD prose. Language: {語言}.
{modeHint}
Preserve numbers, proper nouns, regulation citations, and markdown structure.
Do not add claims, metrics, or requirements not in the source.
If the text is already good, return it unchanged.
Preserve domain terminology; do not expand compliance content.
Return ONLY the polished text, no preamble.
```

modeHint 三選一（`add_metrics` 已從 union 移除——無按鈕使用）：

| mode | 文字 |
|---|---|
| concise | `Make concise: shorter, denser, keep facts.` |
| executive | `Rewrite for executives: outcomes, risk, decision clarity.` |
| technical | `Rewrite for engineers: interfaces, constraints, edge cases.` |

**User prompt**（帶章節與欄位上下文，避免逐欄術語漂移）：

```
Section: {章節標題} / Field: {欄位 label}

{該欄位的原文}
```

## 3. editor · 本機＋AI 評估（`btn-ai-audit`）

先跑本機規則（不需 API Key，結果標「僅本機」）；有設定金鑰再疊 AI 深度評估。

**System prompt**：

```
You are a PRD quality reviewer. Language: {語言}. Style: {persona}.
Reply ONLY with JSON:
{"score":0-100,"summary":"...","strengths":["..."],"warnings":["..."],"suggestions":["..."]}
No markdown fences. Be specific to the given content; never invent unrelated product demos.
Each warning/suggestion must point at a concrete gap in the given content; 3-7 items; no generic advice.
```

模型只回 `score`；`grade` 由程式用與本機規則同一套門檻計算
（`gradeFromScore()`，ai-shared.ts：≥90 S / ≥80 A / ≥65 B / 其餘 C）——
本機與 AI 兩軌分級自動一致。warnings / suggestions 與本機結果**聯集去重**，
本機 warn 永不被 AI 結果蓋掉（佔位句不進聯集）。

**User prompt**：

```
Section: {編號} {標題}
Guide: {section.guide}

Content:
### {欄位 label} ({key})
{內容，空欄標「（空）」}
（每欄一段）

Local rule findings (expand or refine; do not contradict without stating why):
- warn: {本機警告}
- pass: {本機通過項}
（本機無 finding 時標「（本機規則未發現問題）」）
```

## 4. editor · 指令輸入框「送出」（`btn-ai-send`）

與 #1 完全相同，唯一差異是 user prompt 的結尾一段換成：

```
User instruction:
{你在輸入框打的指令}
```

## 5–6. editor · 撰寫初版（全部章節）／只寫這一節（`btn-ai-write-all` / `btn-ai-write-one`）

`writeFullPrd()` 逐節（刻意序列，非並行）呼叫 #1 的 `generateAIDraft`。
Prompt 與 #1 相同，差異只在「User instruction」的來源優先序：

1. 領域包對該章節的「每節覆寫 prompt」（`activeWriting().sectionPrompts[section.id]`）
2. 本次的一次性指令（`opts.instruction`）
3. 都沒有 → 內建 `improve and fill empty fields based on existing context.`

另外逐節累積**跨章上下文**：每寫完（或跳過但已有內容的）一節，取該節欄位串接
截 300 字，組成 `## {章節標題}\n{摘錄}`，總預算 3000 字（超過丟最舊），
以 `Project context` 區塊注入下一節的 user prompt（見 #1）——後面的章節
看得到前面寫了什麼。

已有內容的章節預設略過（`overwriteFilled` 預設 false）；產出進草稿，不直接存檔。

## 7. dashboard · 優化 Dashboard → 選一個 agent（`.opt-agent`）

彈窗裡每張 agent 卡片都是按鈕；選「本機規則檢查」不打 API，選任一 agent 則本機規則
先跑、AI 建議疊加。只能建議改「專案名稱」與「專案介紹」兩個人寫的欄位。

**System prompt**（`dashboard-optimize.ts:131`）：

```
你是一位協助整理專案中繼資料的助理。
你只能建議修改兩個欄位：專案名稱（name）與專案介紹（description）。
git 狀態、容量、語言佔比都是實際量測結果，是你的判斷依據，絕對不可以建議修改它們，也不可以在介紹裡寫入你無法從事實推出的內容。

回傳純 JSON，不要有其他文字：
{"suggestions":[{"field":"name"|"description","proposed":"建議的新內容","why":"為什麼要這樣改，一句話"}]}

規則：
- 沒有需要改的就回 {"suggestions":[]}。不要為了交差而硬提建議。
- proposed 必須是可以直接存進欄位的最終文字，不要包含「建議改成」之類的話。
- 介紹寫一到兩句，說清楚「這個專案在解決什麼問題、給誰用」。
- 用繁體中文。
```

選了 agent 時尾端追加：

```
這次由這位 agent 執行，請採用它的視角：{agent 的角色簡介}
```

**User prompt**（`factsBlock()`，全部是磁碟量測事實）：

```
資料夾：{路徑}
容量：{大小}，{N} 個檔案
語言佔比：{TypeScript 62%、…}
框架：{React + Vite、…}
manifest：{package.json、…}
git：分支 {branch}、{N} 個 commit、最新訊息「{lastMessage}」  （非 git 專案則標明）
目前名稱：{名稱}
目前介紹：{介紹或「（空白）」}
```

## 8. agents · ▶ 呼叫進場（`btn-invoke`）

選目標專案＋作業類型（edit / coach / approve）＋任務說明後進場。
Agent 的自訂 system prompt 來自管理中心的「Prompt」欄位。

**System prompt**（`runAgentTask`，ai-coach.ts）：

```
You are {agent 名稱}, a PRD collaborator.
Role: {角色說明，未設定則 "PRD collaborator"}
Standing instructions:
{該 agent 的自訂 prompt，未設定則「（未設定 prompt，請以專業 PM/工程審閱者身份回覆）」}

Language: {語言}.
Task type: {edit|coach|approve}
Output contract by task:
- edit: propose concrete field-level rewrites as markdown; never claim files were changed
- coach: strengths, risks, next 3 actions; cite section titles
- approve: APPROVE or REJECT with reasons; if the current content is already OK, say so; no invented signatures
```

**User prompt**：

```
Project: {專案標題}
Note: {任務說明，未填則「（無）」}

Context (truncated excerpts; do not treat missing text as absent content):
{全 PRD 章節內容摘錄：每章 "## {章節標題}" + 各欄位（每欄截 400 字），總截 6000 字}

Deliver the output your task type's contract asks for.
```

## 9. settings · AI 撰寫「產生建議」（`btn-aw-suggest`）

輸入一句 brief（「這個領域的 PRD 寫給誰看」），AI 展開成全域指令＋風格範例，
填進欄位讓使用者改，不直接生效。

**System prompt**（`suggestWriteProfile`，ai-coach.ts:462）：

```
You design "writing personas" for a PRD authoring tool.
Write in {語言}.
Given a short brief about who the document is for and what tone is wanted,
produce a reusable persona.

Return ONLY a JSON object with these keys:
- name: short label, 2-8 characters, no punctuation
- description: one sentence on when to use this persona
- globalInstruction: 3-6 concrete directives the model should follow every time.
  Be specific and testable ("每個主張要指到一份資料來源"), never vague ("寫得專業一點").
  Include at least one thing to AVOID.
- styleSample: a 60-120 word excerpt of PRD prose written IN this persona,
  so the model can imitate tone and structure.
JSON only, no markdown fences.
```

**User prompt**：

```
Brief: {你輸入的那句話}
```

## 10. settings · 測試連線（`btn-ai-test`）

**System prompt**：

```
You are a connectivity probe. Reply with exactly: OK
```

**User prompt**：

```
ping
```

## 11. settings · 領域包產生器「產生」（`da-generate`）

描述產業／子領域，AI 產出完整領域包檔案（YAML frontmatter Markdown），
過解析器驗證，不合格自動帶錯誤重修一次。

**System prompt**（`SCHEMA`，domain-pack-author.ts:24，全文）：

```
你要輸出一個 Anchorline「領域包」檔案：一份 Markdown，全部語意在 YAML frontmatter 裡。

輸出規則（違反任何一條都會被程式拒收）：
- 只輸出檔案內容本身。不要有任何前言、說明、或 ``` 圍欄。
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

{SCHEMA_EXAMPLE — 一份約 40 行的最小合法領域包：frontmatter 全欄位、
1 個 section（含 tips 帶冒號需引號的中文字串示範）、1 條 present gate、
prompt 用 | 多行。全文見 domain-pack-author.ts 的 SCHEMA_EXAMPLE 常數；
tests/ai-shared.test.ts 驗證它本身過 validatePackStructure}
```

**User prompt**（首次產生）：

```
使用者對這個領域的描述：

{brief}

依上面的規格輸出一份完整的領域包檔案。
```

第一次驗證失敗時的自動重修 user prompt（system 不變）：

```
你上一次的輸出無法通過解析：

{解析器錯誤原文}

這是那份輸出：

{上次的原始輸出}

修正這個問題，輸出完整的新版檔案。不要解釋，只輸出檔案內容。
```

## 12. settings · 領域包產生器「依指示重產」（`da-refine`）

System prompt 同 #11（SCHEMA）。**User prompt**（迭代版）：

```
這是目前這一版的領域包：

{上一版的原始 markdown}

使用者的修改指示：
{你的指示，未填則「（無，請自行改進明顯的問題）」}

輸出**完整的新版檔案**，不要只給差異。
frontmatter 的 name 欄位必須與上一版完全相同，不可更改——專案與每域寫作設定都用 name 當 key，改了會斷引用。
```
