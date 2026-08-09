# prd-agent 導入 Anchorline — 可行性評估

> 建立：2026-08-09 · 狀態：評估完成，待決策
> 來源：`~/Documents/00_Inbox/Coding/Project_PRD-Agent/docs/PRD-Migration.md`
> 對象：`Project_Anchorline`（Tauri × MIT，見 `SCOPE.md`）

---

## 0. 只讀這一段就夠

**「以插件方式導入」這個前提不成立。** Anchorline 沒有應用層 plugin runtime — 14 個寫死的
Vite entry、一份 localStorage store、`sections` 是全域單例。要插件化得先蓋一套載入器，
那比要導入的東西（530 行）還大。

**但這件事本身值得做，只是形狀不同。** prd-agent 的價值它自己講得很清楚（§1.2）：
不在程式碼，在三份資料資產。而 Anchorline 已經有更好的管線 —
`chatCompletion()` 多供應商、`prd-gates.ts` 結構 gate、簽核鏈、錨點、稽核軌跡。

**結論：不移植管線，只導入領域資產。** 而且對應關係乾淨到近乎巧合：

| prd-agent | Anchorline | 對應品質 |
|---|---|---|
| `questions[]`（frontmatter） | `Section.fields: FieldDef[]` | **1:1**（`id→key`、`prompt→label/hint`、`required→gate`） |
| `required_sections[]` | `AppState.sections: Section[]` | **1:1** |
| `prompts/<domain>.txt` | `ai-coach` 的 system prompt 前綴 | 直接串接 |
| 模板正文（§9.2 D-1 的死資料） | `Section.guide` / `Section.tips` | **導入即修好 D-1** |
| `litellm.completion` | `chatCompletion(system, user)` | 已存在，更廣（Gemini/OpenAI/Anthropic/Ollama） |
| slug / metadata.json / history | `projects` / `releases` / `event-log` | **冗餘，丟掉** |

---

## 1. 現況盤點（Anchorline 這一側）

### 1.1 沒有插件系統

`rg -i plugin` 在 `node_modules` 外只命中 `vite.config.ts` 的 build-time plugin。
應用層完全沒有註冊表、沒有動態載入、沒有擴充點。

### 1.2 PRD 模型是「全域 7 章 × 欄位袋」

```
AppState.sections: Section[]                    ← 全域單例，非 per-project
  summary / problem / goals / metrics / stories / scope / open   （seed.ts:343–500）

AppState.sectionValues[sectionId][fieldKey]      ← per-project（projectSectionValues 對調）
Section.fields: FieldDef[] { key, label, hint, type, rows }
Section.guide / tips / example / checks
```

`prd-gates.ts` 把章節 id 寫死（`summary`/`goals`/`metrics`/`problem`/`open`），
規則是通用 PM 品質（Non-Goals ≥ 3、指標要有數字），**沒有任何領域知識**。

### 1.3 `Template` 不是結構，是片語庫

`{ id, cat, title, blurb, uses, body }` — 只能整段 markdown 插進編輯器
（`templates.ts:147` → `store.setPendingInsert`）。**它承載不了 prd-agent 的模板語意**，
不要被同名誤導。

### 1.4 LLM 層已經比 prd-agent 完整

`ai-client.ts` 的 `chatCompletion(system, user)` 就是 prd-agent FR-6 需要的形狀。
`ai-coach.ts` 已有三個成熟用法：`critiqueSectionWithAI`（評分）、
`generateAIDraft`（回傳欄位鍵 JSON patch）、`runAgentTask`。

---

## 2. 為什麼不能照 PRD-Migration.md 的 P0–P5 做

那份文件假設的目標是「行為等價的獨立系統」。Anchorline 不是那個目標。

**照著做的失效模式**：prd-agent 是**一次性整份生成**，產出是不透明的 markdown
（§2.2 明寫「零後處理」）。Anchorline 是**逐章結構化撰寫**，靠 `sectionValues`
的欄位粒度餵 gate、簽核、錨點與稽核軌跡。把整份 blob 塞進來，
`evaluatePrdGates()` 讀不到任何欄位 → 全部 block → 治理鏈斷在入口。

**§10 驗收矩陣有 12/15 條直接作廢。** 只有三條在新脈絡下還成立：

| 仍適用 | 為什麼 |
|---|---|
| A-2 | frontmatter 解析仍要做（領域包用同格式） |
| A-7 | `_base + <domain>` 兩層 prompt 疊加語意保留 |
| A-13 | 舊 `examples/` 三份要能被讀進來 |

作廢的：A-1（`list-domains` CLI 不存在）、A-4/A-5（`--answer` preset 不存在）、
A-6（user prompt 逐字契約 — 新系統的 prompt 組裝完全不同）、A-8（Langfuse metadata，
見 §4 風險）、A-9/A-10/A-11/A-12（slug / metadata.json / history 全部被
`projects`＋`event-log` 取代）、A-14/A-15（Anchorline 自己的規矩）。

**這一節省下的工，比整份評估的成本高。**

---

## 3. 建議做法：領域包（Domain Pack）as data，分兩步

> ⚠️ **本節已被取代**（2026-08-09）：Scott 明確要求做多產業／多領域。
> 「只做 Step 1」的建議作廢，完整架構評估見
> `Pm-Spec__2026-08-09__domain-pack-architecture-eval.md`。
> 本節保留為決策脈絡。§1、§2、§4 仍有效。

不蓋 plugin 系統。用 Anchorline 已有的資料驅動位置塞領域知識。

### Step 1 — 領域 prompt 注入（低成本、先拿價值）

**做什麼**：新增 `src/data/domains/<name>.md`（沿用 prd-agent 的 frontmatter 格式），
在 `ai-coach.ts` 的三個 system prompt 前面接上該領域的法遵 prompt。
專案上加一個 `Project.domain?: string`，設定面在既有的專案編輯 modal 加一個下拉。

**改動面**：1 個新資料夾 + `types.ts` 一個欄位 + `ai-coach.ts` 約 20 行 + 一個下拉。

**拿到什麼**：KYC 分類、AML STR、個資法 §27、金管會函令、聯徵通報 這些
know-how 立刻進到 AI 助教與草稿生成 — 那正是 prd-agent §1.2 說的核心價值。
`generateAIDraft` 產的是 FinTech PM 寫的東西，不是通用 PM。

**順帶修掉 D-1**：模板正文在 prd-agent 裡是死資料（載入從不進 prompt）。
搬到 `Section.guide` / `Section.tips` 之後它天然會被用到 —
`generateAIDraft` 已經在 user prompt 裡送 `guide` 與 `tips`（`src/lib/ai-coach.ts:203-204`）。
這個 bug 不會跟著搬過來。

### Step 2 — 領域章節與 gate（確認 Step 1 有用之後才做）

**做什麼**：領域包除了 prompt，再供 `sections` 覆寫（新增／改欄位）與額外 gate 規則。
`evaluatePrdGates()` 從寫死 id 改成「通用規則 + 領域規則」兩段。

**成本明顯較高**：`sections` 目前是全域單例，要改成隨 `activeProjectId` 解析；
`prd-gates.ts` 216 行要重構成可組合；`seed.ts` 的種子資料要跟著調。
**這是 Step 1 之後再決定的事，不要一起做。**

### 明確不做

- **plugin runtime / 動態載入器** — 單一消費者不值得
- CLI（`new` / `list-domains` / `history`）— Anchorline 是桌面 App，`src/cli/` 只有 tracking TUI
- slug 演算法（含 D-2 中英混合掉字）、`metadata.json`、`outputs/` 掃描 — 全部被既有結構取代
- Langfuse — 見 §4

---

## 4. 風險與坑

| # | 風險 | 嚴重度 | 處置 |
|---|---|---|---|
| R-1 | **Langfuse 觀測會消失**。prd-agent 的 trace 是 LiteLLM Proxy 給的，Anchorline 直打供應商，沒有 proxy | Medium | 接受。要保留就得在 `ai-client.ts` 加一條 LiteLLM Proxy 路徑（它本來就是 OpenAI 相容，`endpoint` 填 `http://localhost:4000/v1` 即可打通） |
| R-2 | **CORS**：WKWebView 直打供應商已知會炸；`ai-client.ts:192` 的 `anthropic-dangerous-direct-browser-access` 就是為此存在 | Low | 已被現有程式處理 |
| R-3 | 領域章節（Step 2）動到全域 `sections`，會波及 review／tracking／export 四頁 | **High** | 所以拆兩步。Step 1 不碰 `sections` |
| R-4 | Anchorline 的 gate 是通用 PM 品質，FinTech 領域 gate（如「必須有 KYC 章節」）與現有規則的優先序未定義 | Medium | Step 2 才需要決策 |
| R-5 | 三份 `examples/` 是 prd-agent 格式（`prd.md` + `metadata.json`），Anchorline 的 `folder-import.ts` 用另一套 slot 比對 | Low | 手動轉一次即可，不值得寫轉換器 |

---

## 5. 待你決定

| # | 問題 | 我的建議 |
|---|---|---|
| Q1 | 接受「不做 plugin、只導入領域資產」這個改寫嗎？ | **是**。原始問句的前提不成立，硬做插件是把 530 行的東西包成 2000 行 |
| Q2 | 只做 Step 1，還是 Step 1+2 一起排？ | **只做 Step 1**。Step 2 動全域 `sections`，是 R-3；先讓領域 prompt 上線，用實際產出判斷值不值得 |
| Q3 | 要不要把 LiteLLM Proxy 補回 `ai-client.ts` 以保住 Langfuse？ | 想留觀測就做，成本很低（填 endpoint 即可）。不留就明確寫進文件，別讓它變成第二個 M-6（設定存在但不影響行為） |
| Q4 | prd-agent 這個 repo 之後怎麼處置？ | 資產搬完後降級為歷史脈絡。**不要維持兩套** — 那是 C0（開很多坑收不完） |

---

## 6. 一句話

**prd-agent 值得導入的是它的領域知識，不是它的程式。Anchorline 已經有更好的管線，
缺的只是那幾份 FinTech 法遵 prompt。**

---

## 結束摘要（2026-08-09）

**結論成立，且被實作驗證了。** 「以插件方式導入」的前提確實不成立（Anchorline 沒有
plugin runtime），而「只搬領域資產、不搬管線」的替代方案已完整落地 —— 見
`Pm-Spec__2026-08-09__domain-pack-architecture-eval.md` 的結束摘要。

本文 §2 的判斷（`PRD-Migration.md` §10 的 15 條驗收有 12 條作廢）在實作後回頭看是對的：
最終一條 prd-agent 的程式都沒有移植，只搬了 templates / prompts 的**知識內容**，
而且那些內容還必須大幅改寫（prd-agent 的 lending / payment / wealth prompt
各只有一行英文佔位符，不是可用的領域知識）。
