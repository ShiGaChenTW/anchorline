# Handoff — AI 按鈕 Prompt 優化

> 建立：2026-08-12。來源盤點：`docs/ai-button-prompts.md`（12 顆 AI 按鈕 × prompt 全文對照）。
> 兩份獨立評估（Claude／Grok）已互相比對，並逐項對照 `src/lib/ai-coach.ts`、
> `src/lib/ai-client.ts`、`src/data/store.ts` 驗證。本文件是給實作 agent 的完整交接。

## 0. 給實作 agent 的任務摘要

依 §4 的實作流程動工，順序 P0 → P1 → P2，每個 Phase 一個 commit。P3 選做。
目標檔案只有：`src/lib/ai-client.ts`、`src/lib/ai-coach.ts`、`src/lib/domain-pack-author.ts`。
不動 UI，除非某項明說需要。所有結論已過程式碼驗證，不需要重新評估，直接實作。

---

## 1. 報告 A — Claude 初評（僅讀盤點文件，未讀碼）

**總評**：#7（dashboard 優化）與 #11（領域包 SCHEMA）是全 repo 最強的兩份 prompt；
其他問題集中在 JSON 可靠性、輸出格式未定義、缺「不改動」出口三類。

高影響：
1. **#2 語調潤色無上下文、無「不用改」出口** — 每欄單獨送原文，看不到章節標題／其他欄位，
   術語會漂移；模型被迫改點什麼，會把寫好的欄位改壞。且每欄一次呼叫，成本高。
2. **#8 agent 進場「Deliver a concise operational result」太空泛** — edit/coach 沒有輸出格式；
   context 截 400 字/欄、總 6000 但沒告訴模型是節錄，approve 會把截斷誤判成沒寫。
3. **JSON 可靠性不一致** — 只有 #11 有解析失敗自動重修，#1/#3/#7/#9 沒有 retry。
   （後經讀碼修正：`extractJsonObject` 已有 fence 剝除＋大括號抽取兜底，嚴重度低於初判，
   但「無自動重試」仍成立。）

中影響：
4. 「Do NOT invent unrelated SaaS/2FA demos」是補丁不是解法 — 改正面接地指令：
   缺資訊寫【待補】而非捏造。
5. 語言指定不夠 — 建議明確「繁體中文（台灣用語）」，避免漏出簡體／大陸用語。
6. **#3 score 與 grade 無對應規則** — 模型每次自己發明門檻，重跑分級會跳。

低影響：#12 重產未鎖 `name`（後驗證為真缺陷，見 §3）；#11 YAML regex 反斜線 escaping
提醒；#7 名稱無長度上限；#1 已填欄位缺「夠好就原樣返回」；#10 不用動。

---

## 2. 報告 B — Grok 評估（有對照實作碼）

**總評**：工程邊界已到位（反幻覺、JSON-only＋解析器兜底、領域包前置、SCHEMA＋修一次），
主要可優化點在：跨章上下文、評分尺、結構化輸出穩定度、任務型非對稱指令。

### 跨按鈕共通問題（優先處理）

1. **結構化任務溫度偏高（影響最大）** — ai-client 預設 temperature ≈ 0.7，
   #1/#3/#7/#9/#11 全是可解析結構任務，0.7 拉高格式漂移。建議分流：
   JSON/YAML/連線 0–0.2；潤色 0.4–0.6；自由 prose agent 0.5–0.7。
   provider 支援時加 response_format / schema。
2. **語系混用** — persona 短語全英文對繁中法遵 PRD 牽引力偏弱；非 en-US 時
   persona/modeHint 用繁中對等句或雙語並列。
3. **withDomain() 一視同仁疊加** — 對 #2 潤色特別有副作用（越潤越像合規說明書）。
   建議：生稿/評估/agent 保留；潤色不疊或只留一句
   `Preserve domain terminology; do not expand compliance content.`
4. **writeFullPrd 沒有跨章上下文（報告未寫、但決定品質的缺口）** — 註解承諾
   「後面的章節要看得到前面寫了什麼」，但 generateAIDraft 只吃當前章節。
   建議 user prompt 注入已寫章節摘要（每節 200–400 字，總預算 2500–3500）。

### 逐顆重點

- **#1 生稿（最高 ROI）**：預設指令過泛（空欄亂填、已填欄被美化變質）→ 明確 fill policy；
  無 JSON few-shot → system 末加 4–6 行 mini example（真 key）；無專案層上下文；
  無欄位長度預算；反 2FA 可泛化成「禁止捏造未在 draft/guide 出現的產品機制」；
  styleSample 4000 字擠掉領域包注意力 → 800–1500 字。
- **#2 潤色**：加保真約束（Preserve numbers, proper nouns, citations, markdown structure；
  Do not add claims/metrics/requirements not in the source）；潤色不疊 domain；可批次；
  add_metrics 無按鈕 → 接 UI 或從 union 拿掉。
- **#3 評估（第二高 ROI）**：量表未定義 → 補 rubric（S 90-100 / A 80-89 / B 65-79 / C <65，
  Grade must match score band，每條 warning 要引用具體缺口，3–7 條，禁 generic advice）；
  user 未帶本機 findings → 帶入並要求「expand or refine, don't contradict without reason」；
  merge 邏輯 AI 有 list 就整包蓋掉本機（code 層）；suggestedPatch 型別存在但 prompt 不產。
- **#7**：已優秀。小優化：agent 視角改結構化（`Agent lens (optional bias only; hard rules
  above still win)`）；加正反例；language 不要 hardcode 繁中；名稱已清楚可回空陣列。
- **#8**：任務契約不對稱 → 按 task type 定輸出契約（edit：具體欄位級改寫、不可宣稱已寫入；
  coach：優點/風險/下三步；approve：現況已 OK）；system 改層級避免「System prompt:」嵌套；
  截斷改「每章固定摘要＋使用者指定章全文」。
- **#9**：name 2-8 characters 對英文過緊 → 「中文 2–6 字 / 英文 1–3 words」；
  styleSample 60–120 words 繁中偏長 → 「80–150 中文字」；可注入 domain displayName；
  brief 可加受眾/禁止事項/用途三個可選欄。
- **#11–#12**：SCHEMA 是整份最強。剩餘槓桿：加最小合法範例（約 30–40 行，最重要）；
  首次 user prompt 結構化 brief（產業/管轄/產品類型/必提法規/不要涵蓋）；
  重修 prompt 可省 token；`n` 從 "08" 起算依賴 base 不變。

### Grok 優先級路線圖

| 優先 | 項目 | 類型 |
|---|---|---|
| P0 | JSON/YAML 任務降溫＋(可) json mode | 參數 |
| P0 | writeFullPrd 注入已寫章節摘要 | 上下文 |
| P1 | #3 評分 rubric＋帶入本機 findings | prompt |
| P1 | #1 fill policy＋mini JSON example | prompt |
| P1 | #11 最小合法領域包 few-shot | prompt |
| P2 | #2 保真約束＋潤色不疊 domain | prompt |
| P2 | #8 task 輸出契約對稱化 | prompt |
| P3 | persona/mode 繁中化、#9 命名規則、#7 微調 | 文案 |

不建議改：領域包疊 system 最前、dashboard 量測欄位硬邊界、驗不過只修一次、連線 probe。

---

## 3. 合併結論（已逐項對照程式碼驗證）

### 3.1 驗證結果

| 主張 | 出處 | 驗證 | 證據 |
|---|---|---|---|
| temperature 預設 0.7 進所有 JSON 任務 | Grok | ✅ 成立 | `ai-client.ts:114/160/206` `s.temperature ?? 0.7` |
| Anthropic 新模型不收 temperature、被 400 打回後重試不帶 | 補充 | ✅ | `ai-client.ts:215` — 降溫對此路徑無感，受益者為 Gemini/OpenAI/Ollama |
| writeFullPrd 註解承諾跨章呼應、實作沒給 | Grok | ✅ 成立 | 註解 `ai-coach.ts:376`，`generateAIDraft` 只收 currentValues |
| #3 merge：AI 回非空陣列即整包蓋掉本機 findings | Grok | ✅ 成立 | `ai-coach.ts:184-186` |
| suggestedPatch 型別存在但 prompt 不產 | Grok | ✅ 成立 | `ai-coach.ts:27` |
| 本機評估已有分級門檻 | 合併 | ✅ | `ai-coach.ts:128`：≥90 S / ≥80 A / ≥65 B |
| extractJsonObject 有 fence 剝除＋大括號抽取兜底 | Grok | ✅ | `ai-client.ts:284`（Claude 初評「祈禱式約束」過重，收回） |
| #12 重產不鎖 `name` 會斷引用 | Claude | ✅ 成立 | `project.domain` 存 name 字串（`store.ts:90`）、`settings.aiWriting.byDomain` 以 name 為 key（`store.ts:1022`）；name 變了舊專案 fallback generic、每域寫作設定孤兒化 |

### 3.2 對 Grok 建議的三個修正

1. **json mode 要分家**：OpenAI 相容用 `response_format`；Gemini 用
   `generationConfig.responseMimeType: "application/json"`；Anthropic 無原生 JSON mode，
   不做 tool-use 模擬（成本不值），Anthropic 路徑只靠降溫＋extractJsonObject。
2. **#11 重修「省 token 不餵全文」不採納**：SCHEMA 要求輸出完整檔案，不給上一版全文，
   模型重修容易把沒壞的部分重寫走樣。維持「錯誤原文＋上一版全文」。
3. **#3 rubric 用更硬的版本**：AI 只回 `score`（0-100），`grade` 由程式用本機同一套門檻
   （`ai-coach.ts:128`）計算——本機與 AI 兩軌自動一致，少一個模型會答錯的欄位。

### 3.3 合併優先序（最終版）

- **P0**：溫度分流（＋OpenAI/Gemini json mode）；writeFullPrd 注入已寫章節摘要。
- **P1**：#3（score-only＋程式算 grade、帶入本機 findings、merge 改聯集不蓋寫）；
  #1 fill policy＋mini JSON example；#11 最小合法範例 few-shot。
- **P2**：#2 保真約束＋潤色不疊 domain＋補章節/欄位上下文；#8 三種 task 輸出契約＋
  截斷告知句；**#12 重產鎖 `name`**（Grok 漏掉、已驗證的真缺陷）。
- **P3**：persona/modeHint 繁中化、#9 尺寸校準（name 規則、styleSample 80–150 中文字）、
  #7 微調（agent lens 結構化、名稱長度上限）、#11 regex 反斜線提醒、
  styleSample 截 4000 → 1500。

---

## 4. 實作流程（給實作 agent）

規則：bun/bunx、TypeScript。每 Phase 完成後 `bun run build`（或 repo 現有 check 指令）
確認過編譯，一個 Phase 一個 commit。

### Phase 1 — P0（改 ai-client.ts、ai-coach.ts）

**1a. 溫度分流。**
- `chatCompletion` / `chatCompletionStream` 加可選參數 `opts?: { temperature?: number; jsonMode?: boolean }`，
  有給 temperature 就覆蓋 `s.temperature ?? 0.7`。
- `jsonMode` 為 true 時：OpenAI 相容路徑帶 `response_format: { type: "json_object" }`
  （Ollama/自訂端點不支援時會 400，需 try 一次失敗即降級重送不帶——沿用 Anthropic
  temperature 打回重試的既有模式）；Gemini 帶 `generationConfig.responseMimeType: "application/json"`；
  Anthropic 忽略此旗標。
- 呼叫端指定：`generateAIDraft`、`critiqueSectionWithAI`、`suggestWriteProfile`、
  `dashboard-optimize` 的 aiSuggestions、`domain-pack-author` 的 authorDomainPack
  → `{ temperature: 0.2 }`（JSON/YAML 任務；YAML 不開 jsonMode）；
  `polishTextWithAI` → `{ temperature: 0.5 }`；`runAgentTask` 不帶（沿用設定值）。

**1b. writeFullPrd 跨章上下文。**
- `generateAIDraft` 加可選參數 `projectContext?: string`，非空時插進 user prompt
  （`Current draft:` 之前）：
  ```
  Project context (already written sections, excerpts — keep new content consistent with these):
  {projectContext}
  ```
- `writeFullPrd` 迴圈內累積：每寫完（或跳過但有內容的）一節，取該節各欄位串接後
  截 300 字，組成 `## {章節標題}\n{摘錄}`；總預算 3000 字，超過丟最舊的章節。
  傳給下一節的 `generateAIDraft`。

### Phase 2 — P1（改 ai-coach.ts、domain-pack-author.ts）

**2a. #3 評估重構。**
- system：JSON 骨架移除 `grade`，只要求 `score`；加一行
  `Each warning/suggestion must point at a concrete gap in the given content; 3-7 items; no generic advice.`
- grade 由程式算，門檻與 `critiqueSectionLocal` 完全一致（抽成共用函式）。
- user prompt 帶入本機 findings：
  ```
  Local rule findings (expand or refine; do not contradict without stating why):
  - warn: ...
  - pass: ...
  ```
- merge 改聯集：AI 的 warnings/suggestions 與本機的**合併去重**，本機 warn 永不消失；
  strengths 可用 AI 版取代。

**2b. #1 fill policy＋mini example。**
- system 移除反 2FA 句，換：
  ```
  Fill policy:
  - Empty fields: fill from section guide, tips, project context, and existing draft.
  - Non-empty fields: keep substance; only refine clarity unless User instruction asks a rewrite.
  - Do not invent product features, vendors, metrics, or regulations not grounded in the provided context; write 【待補】 for unknowns.
  Example output (keys must match exactly):
  {"<key1>":"...","<key2>":"- ...\n- ..."}
  ```
  其中 `<key1>/<key2>` 取該章實際前兩個欄位 key 動態組出。
- styleSample 截斷 4000 → 1500。

**2c. #11 最小合法範例。**
- SCHEMA 常數尾端附一份約 30 行的最小合法領域包（frontmatter 全欄位、1 個 section、
  1 條 gate、prompt 用 `|` 多行、含帶冒號需引號的中文字串示範），標題
  `以下是一份最小合法範例（結構示範，內容請勿照抄）：`。

### Phase 3 — P2

**3a. #2 潤色**（ai-coach.ts）：
- `polishTextWithAI` 加參數帶入章節標題與欄位 label，user prompt 改為
  `Section: {title} / Field: {label}\n\n{text}`。
- system 加：
  ```
  Preserve numbers, proper nouns, regulation citations, and markdown structure.
  Do not add claims, metrics, or requirements not in the source.
  If the text is already good, return it unchanged.
  ```
- 潤色路徑不套 `withDomain()`，改為固定一句
  `Preserve domain terminology; do not expand compliance content.`
- `add_metrics` 從 mode union 移除（無按鈕使用）。

**3b. #8 agent 進場**（ai-coach.ts）：
- system 改層級（去掉「System prompt:」嵌套）：
  ```
  You are {name}, a PRD collaborator.
  Role: {role}
  Standing instructions:
  {agentPrompt}

  Language: ...
  Task type: {task}
  Output contract by task:
  - edit: propose concrete field-level rewrites as markdown; never claim files were changed
  - coach: strengths, risks, next 3 actions; cite section titles
  - approve: APPROVE or REJECT with reasons; no invented signatures
  ```
- user prompt 的 Context 標頭加：
  `(truncated excerpts; do not treat missing text as absent content)`。

**3c. #12 鎖 name**（domain-pack-author.ts）：refine 的 user prompt 加一句
`frontmatter 的 name 欄位必須與上一版完全相同，不可更改。`

### Phase 4 — P3（選做，一個 commit）

persona/modeHint 依 language 出繁中版；#9 name 規則改「中文 2–6 字或英文 1–3 words」、
styleSample 改「80–150 個中文字（或 60–120 English words）」；#7 agent 視角改
`Agent lens (optional bias only; hard rules above still win): {brief}`、名稱上限 ≤ 16 字；
SCHEMA 加一行 regex 反斜線在 YAML 需雙寫的提醒。

### 驗收

1. `bun run build`（或 repo 的 typecheck 指令）全綠。
2. 若 repo 有測試，跑既有測試；`extractJsonObject` 與新共用 grade 函式加最小單元測試。
3. 手動 smoke（有 API Key 時）：設定頁「測試連線」→ editor 任一章「一鍵生稿」→
   「本機＋AI 評估」確認本機 warn 不再被 AI 結果蓋掉。
4. 更新 `docs/ai-button-prompts.md` 中受影響的 prompt 全文，保持盤點文件與實作同步。
