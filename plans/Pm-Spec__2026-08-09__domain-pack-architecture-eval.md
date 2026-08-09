# 領域包（Domain Pack）架構評估 — 讓 Anchorline 支援多產業／多領域

> 建立：2026-08-09 · 狀態：評估完成，待決策
> 目標：沿用 PRD-Agent 的「加資料檔＝加領域，零程式碼」契約，導入 Anchorline
> **本文取代** `Pm-Spec__2026-08-09__fintech-prd-agent-import-eval.md` §3 的「只做 Step 1」建議

---

## 0. 只讀這一段就夠

**好消息比預期大。** Anchorline 的 `Section` 型別**已經是完整的領域包資料結構** —
`guide` / `tips` / `example` / `fields[]` / `checks[]` 全都在裡面（`src/data/types.ts:149`）。
`SEED_SECTIONS` 只是其中一個寫死的實例。**章節領域化不是新架構，是把寫死的那份變成可選的那份。**

而且編輯台已經把存取收斂成單一入口：`src/pages/editor.ts:163` 的 `sections()`，14 個使用點全走它。
per-project 章節解析在編輯台是**一行**。

**壞消息是 gate。** PRD-Agent 能做到零程式碼加領域，是因為它的產出是不透明 markdown，
**沒有任何程式對章節做判斷**。Anchorline 有 `canApprove` 硬閘門（`prd-gates.ts:206`）。
所以真正要設計的不是章節格式，是**領域規則用什麼表達**。這是本文的核心。

**而且 `prd-gates.ts` 零測試覆蓋** — `tests/` 22 個測試檔裡沒有 prd-gates、ai-coach、export、seed。
要重構的最危險的檔案，一條測試都沒有。

**結論：可行，且比第一輪估的乾淨。但順序必須是「先補 gate 測試 → 再抽領域包」，不能反過來。**

---

## 1. 為什麼章節領域化比想像中容易

### 1.1 型別已經到位

```ts
// src/data/types.ts:149
type Section = {
  id, n, title, desc, status,
  guide: string,        // ← PRD-Agent 模板正文的歸宿（順帶修好 D-1）
  tips: string[],       // ← 起手骨架來源（writing-assist.ts:39）
  example: string,
  fields: FieldDef[],   // ← PRD-Agent questions[] 的 1:1 對應
  checks: CheckDef[],   // ← 人工勾選清單
  score: number,
}
```

PRD-Agent 的 `questions[] → FieldDef[]`：`id→key`、`prompt→label`、（無對應）`→hint`、`required→gate 規則`。
PRD-Agent 的 `required_sections[] → Section[]`。**不需要新型別。**

### 1.2 存取已經收斂

| 位置 | 現況 | 改動 |
|---|---|---|
| `editor.ts:163 sections()` | 14 個使用點的唯一入口 | **一行**：改成依 `activeProject.domain` 解析 |
| `sectionValues` | **已經 per-project**（`projectSectionValues[projectId]`，`store.ts:311`） | 不用改 |
| `store.updateSection` (`store.ts:1028`) | 已允許執行期改章節 | 型別本來就容得下非種子章節 |

### 1.3 唯一的結構性阻礙

`mergeSectionsWithSeed()`（`store.ts:100`）把載入的章節**強制併回 `SEED_SECTIONS`**。
這是「全域只有一組章節」這個假設的唯一落地點。要改成 `mergeSectionsWithDomain(sections, domainId)`。

---

## 2. 核心設計決策：領域 gate 用什麼表達

這是本評估唯一真正困難的地方。

**問題**：領域知識裡有可驗證的硬規則（「數位帳戶 PRD 必須列出 KYC 風險等級對應」）。
若這種規則寫成 TypeScript，**「零程式碼加領域」契約當場破功** —
新增一個產業要改 `prd-gates.ts`，那跟現在沒兩樣。

**三個選項：**

| | 做法 | 能力 | 決定性 | 零程式碼 |
|---|---|---|---|---|
| (a) | 宣告式規則（存在性／長度／regex／欄位間關係） | 受限 | ✅ 可 replay | ✅ |
| (b) | 領域 gate 交給 LLM 判定 | 強 | ❌ 不可 replay | ✅ |
| (c) | **宣告式做 block，LLM 做 warn** | 夠用 | ✅ block 可 replay | ✅ |

**建議 (c)。** 理由不是折衷，是 Anchorline 的論述前提：治理鏈的說服力來自**可重播**
（`src/lib/replay.ts` 存在就是這個意思）。一個 LLM 判定的 `block` 無法 replay，
那條治理鏈就不能拿去給人看。而 LLM 做 `warn` 這條路已經鋪好了 —
`critiqueSectionWithAI`（`ai-coach.ts:122`）現成。

**宣告式規則的最小語法**（涵蓋 PRD-Agent 五個領域的實際需求）：

```yaml
gates:
  - id: kyc-risk-tiers
    level: block          # block | warn
    section: kyc_aml
    field: identity_flow  # 省略 = 全章節文字合併
    require: present      # present | minLength:N | match:<regex> | bullets:>=N
    detail: 需列出風險等級對應（KYC1/2/3）
```

`present` / `minLength` / `match` / `bullets` 四個 predicate 就能表達現有 `prd-gates.ts`
全部 8 條規則（我對照過：`summary-incomplete`=present×3、`non-goals-min`=bullets:>=3、
`goals-thin`=minLength:20、`metrics-missing`=minLength:30、`metrics-vague`=match、
`summary-tech-boundary`=match、`problem-thin`=minLength:40、`open-no-deadline`=match）。

**這代表現有 gate 可以整份降級成資料** — 通用 7 章變成 `_base` 領域包，跟 FinTech 包同格式。
不是「加一層領域覆寫」，是「原本那份也是領域包，只是叫 generic」。

---

## 3. 領域包檔案格式

一個領域 = **一個檔**（比 PRD-Agent 的 `.md` + `.txt` 兩檔更好：
prompt 內嵌就不會出現 D-1 那種「資產載入但從未使用」的漂移，因為它跟章節在同一個檔裡）。

`src/data/domains/digital_account.md`：

```markdown
---
name: digital_account
display_name: 數位帳戶 / 數位銀行
industry: fintech
extends: _base                    # 繼承通用 7 章，只加／覆寫差異
prompt: |
  （原 prompts/digital_account.txt 整段：KYC 分類、AML STR、
   個資法 §27、金管會函令、聯徵通報）
sections:
  - id: kyc_aml
    n: "03"
    title: KYC / AML 合規要點
    desc: 身分驗證 · 風險等級 · 交易監控
    guide: 明確列出身分驗證流程、風險等級對應、交易監控規則
    tips:
      - 風險等級要對應到可執行的差異化措施
      - STR 通報門檻與流程負責人要寫明
    fields:
      - key: identity_flow
        label: 身分驗證流程
        hint: 到 KYC 分類層級
        type: textarea
        rows: 6
gates:
  - { id: kyc-risk-tiers, level: block, section: kyc_aml, field: identity_flow,
      require: "match:風險等級|risk tier|KYC ?[123]", detail: 需列出風險等級對應 }
---

（正文：不使用。全部語意都在 frontmatter — 刻意不留 body，避免重蹈 D-1）
```

沿用 PRD-Agent 的 frontmatter 慣例有兩個實際好處：格式你已經熟，
以及舊 `templates/*.md` 可以半自動轉換。

---

## 4. 工作分解與工作量

| # | 工作 | 內容 | 風險 |
|---|---|---|---|
| **W-A** | **先補 gate 測試** | 對 `evaluatePrdGates()` 現有 8 條規則寫 characterization test（鎖住現況行為，不是鎖住「正確」行為） | — |
| **W-B** | gate 引擎宣告式化 | `prd-gates.ts` 216 行 → 規則直譯器 + `_base` 規則資料。W-A 的測試必須全綠 | **High**，但 W-A 蓋住 |
| **W-C** | 領域包 loader | frontmatter 解析（`gray-matter` 或既有 markamd）、`extends` 合併、`Project.domain` 欄位 | Low |
| **W-D** | store 改造 | `mergeSectionsWithSeed` → `mergeSectionsWithDomain`；既有專案全部標記 `domain: generic`；`editor.ts:163` 一行 | **Medium**（動持久化） |
| **W-E** | UI | 建立專案時選領域、孤兒章節提示、編輯台章節導覽動態化 | Low |
| **W-F** | 領域包內容 | 把 PRD-Agent 五個領域（digital_account / lending / payment / wealth / generic）轉成領域包 | Low（資料活） |

**必須是這個順序。** W-A 不做就直接動 W-B，是零覆蓋重構 216 行的簽核硬閘門。

---

## 5. 風險

| # | 風險 | 嚴重度 | 處置 |
|---|---|---|---|
| **R-1** | **切換領域產生孤兒內容**：`sectionValues` 綁 sectionId，換領域＝章節集合變了 | **High** | **不刪孤兒**，UI 顯示「N 個章節不屬於目前領域」。求職／顧問場景一定會「寫到一半發現選錯領域」，鎖死不可改比孤兒更痛 |
| **R-2** | 持久化遷移：既有 localStorage 的 `sections` 陣列沒有 domain 概念 | **High** | `storage-migrate.ts` 已有一次性遷移的成熟樣板（複製不搬移、不刪舊 key）。照抄那個模式 |
| **R-3** | `prd-gates.ts` 零測試 | **High** | W-A。不可跳過 |
| **R-4** | 其餘寫死 section id 的 7 個檔 | Medium | 分兩類處理，見下表 |
| **R-5** | 宣告式 gate 表達力不足，某個領域規則寫不出來 | Medium | 逃生門：該規則降級為 `warn` 走 LLM。**不要**為單一規則開 TypeScript 後門，那是契約破口的起點 |
| **R-6** | 領域包變多後 `_base` 繼承鏈失控 | Low | 只允許一層 `extends`，不做多重繼承 |

**R-4 的兩類：**

| 必須改（規則綁 section id） | 可留 fallback（章節不存在時自然降級） |
|---|---|
| `prd-gates.ts:56,99,120,139,165,176` | `review.ts:139-148,200,206`（已用 `?? ""`） |
| `ai-coach.ts:66,82,87,92`（本機 linter） | `projects.ts:840`（建案寫 summary） |
| `store.ts:1876-1882`（check 自動勾選） | `file-tree.ts:37-41`（檔案 slot 映射） |
| | `export.ts:196`（排除清單） |
| | `store.ts:668-671`（匯入寫 summary/problem） |

---

## 6. 待你決定

| # | 問題 | 我的建議 |
|---|---|---|
| **Q1** | 領域 gate 走 (a) 純宣告式 / (b) 純 LLM / (c) 宣告式 block + LLM warn？ | **(c)**。Anchorline 賣的是可重播的治理鏈，LLM 判定的 block 破壞這個賣點 |
| **Q2** | 通用 7 章是「特例」還是「叫 generic 的領域包」？ | **後者**。前者會長出兩套規則系統，一年後你會恨它 |
| **Q3** | 專案的 domain 建立後可否更改？ | **可改，孤兒章節保留不刪**，UI 提示。理由見 R-1 |
| **Q4** | 領域包放哪？`src/data/domains/`（編譯進 bundle）還是使用者資料夾（Tauri 讀檔）？ | **先 `src/data/domains/`**。使用者自訂領域是下一個里程碑；現在做等於同時蓋一套領域編輯器 |
| **Q5** | 先做哪幾個領域？ | **generic + digital_account 兩個就夠驗證架構**。五個一起搬是資料工，不是架構工，等 W-A~W-E 綠了再批次做 |
| **Q6** | 「產業」與「領域」要不要分兩層（fintech → digital_account）？ | **先不分**。`industry` 欄位先當標籤存著、只做篩選用，不進繼承鏈。真的長到 20 個領域再說 |

---

## 7. 一句話

**Anchorline 的 `Section` 型別本來就長成領域包的樣子，缺的只是別再寫死一份。
真正要新設計的只有一樣東西：領域規則怎麼表達，才能既擋得住簽核、又不用改程式。**

---

## 結束摘要（2026-08-09）· 狀態：**已實作完成**

W-A → W-F 全數完成，另加 G1–G6 補洞。`bun test` **439 綠 / 0 紅**、`tsc` 乾淨、`vite build` 通過，
並在真 Chrome 上逐項實機驗證。

### 交付物

| 檔案 | 作用 |
|---|---|
| `src/lib/gate-rules.ts` | 宣告式規則直譯器（4 predicate）+ 教練用 `runSectionCoach` |
| `src/lib/prd-gates.ts` | `BASE_GATE_SPEC` 資料 + AppState 轉接（216 → 168 行，邏輯全移出） |
| `src/lib/domain-pack.ts` | frontmatter 解析、一層 `extends`、章節疊加 |
| `src/lib/section-meta.ts` | 章節骨架／使用者標記分離（可測，不含 glob） |
| `src/lib/user-domains.ts` | 使用者自帶領域包（資料夾 → localStorage 快取 → 解析） |
| `src/data/domains/*.md` | 5 個內建領域包（_base / generic / digital_account / lending / payment / wealth） |
| `tests/{prd-gates,domain-pack,section-meta}.test.ts` | 118 條 |

### §2 的核心決策回顧

**Q1 選 (c)（宣告式 block + LLM warn）是對的。** 四個 predicate（`present` / `minLength` /
`match` / `bullets`）表達得出 **5 個領域包全部 20 條 gate 規則**，一條例外都沒有。
後來為了寫作教練加了 `hints`（同語言、不進 gate），仍然沒有第三套規則系統。

**Q2/Q3/Q4/Q6 的處置**：Q2 generic 也是領域包（成立）· Q3 領域可改、孤兒保留（成立，
UI 有提示）· **Q4 改變**：Scott 要求做使用者自帶領域包，已實作（設定頁選資料夾）·
Q6 `industry` 只當標籤（維持）。

### 實作中被推翻或修正的判斷

1. **§4 的 W-B「High 風險」被 W-A 的 33 條 characterization test 完全吃掉** ——
   重構一次過，零回歸。先補測試是這次最划算的一步。
2. **`_base` 不該帶產業身分。** 照抄 prd-agent 的 `_base.txt`（「資深 FinTech 產品經理」）
   會和 generic 的「不要硬套產業語彙」互相矛盾，兩段還會一起送進模型。身分屬於領域包。
3. **prd-agent 的 lending / payment / wealth prompt 是佔位符不是資產。** 各只有一行英文，
   實際的法遵內容（民法 §205、電支條例 §22–24、信託業法 §18、催收委外要點）是這次補的。
4. **§5 的 R-4「其餘 7 個檔可留 fallback」判斷過於樂觀。** 其中
   `ai-coach.ts` 的本機規則檢查是實質缺口（沒 API Key 的人在領域章節上完全沒有教練），
   已改為與 gate 共用同一份領域包規則。

### 只有實機才抓得到的三個 bug

單元測試與 typecheck 都是綠的，這三個只有真的開瀏覽器才現形：

1. **`migrateProject` 白名單漏 `domain`** —— 換過的領域每次重新載入悄悄變回 generic。
   那個函式上方第 267 行的註解就是上一次 `tags` 掉了留下的，這是第二次踩同一個坑。
2. **CSS 用了不存在的 token（`var(--line)`，正確是 `--border`）** —— 無法解析的 `var()`
   讓整條 `border` 宣告失效，computed style 回 `0px none`。CSS 不報錯、build 不失敗、
   typecheck 管不到。
3. **`resolveDomain` 沒把 `hints` 帶過去** —— base 的軟提示在任何領域下都消失，
   gate 全綠、測試全綠，只有教練欄默默少講幾句話。

三個都已補測試或以 computed style 驗證。

### 還沒做

- **LiteLLM Proxy / Langfuse 觀測**（第一份評估的 Q3，未決）。
- **`refreshUserDomains()` 只重讀已知檔名**，資料夾裡「新增」的檔要重新選一次資料夾才會進來。
  刻意的：背景自動掃整個資料夾等於每次開 App 都做一次不必要的磁碟走訪。
- `plans/*.md` 會被三個頁面 `import.meta.glob` 打包進 App 產物（既有設計，17 檔 208K）。
