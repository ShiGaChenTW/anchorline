# OpenSpec 文件追蹤導入報告

> 來源：`fission-ai/openspec` 完整倉庫傾印（5.9 MB / 154,589 行）
> 對象：PRD 開發監控台（SpecForge）
> 日期：2026-08-08

---

## 一、一句話結論

**目前 App 裡叫「OpenSpec」的東西，跟 OpenSpec 實際上是什麼，只有名字一樣。**

我們把七個 PRD 章節對應到一份想像中的 `PRD.md` 標題；OpenSpec 根本沒有 `PRD.md`。它的核心是 `openspec/specs/`（真相）與 `openspec/changes/`（提案），兩者用 **delta（ADDED / MODIFIED / REMOVED）** 銜接，並由 CLI 提供 `--json` 的結構化狀態。

好消息是：**要接的東西已經存在，而且是我們最缺的那一塊 —— 一個可查詢的、機器可讀的進度真相來源**（`openspec status --json`）。不需要我們自己猜。

---

## 二、OpenSpec 的檔案架構

```
openspec/
├── config.yaml                  # 專案設定：預設 schema、context、per-artifact rules
├── specs/                       # ← 真相：系統「現在」怎麼運作
│   ├── auth/spec.md
│   ├── payments/spec.md
│   └── ui/spec.md
└── changes/                     # ← 提案：還沒併入真相的修改
    ├── add-dark-mode/
    │   ├── proposal.md          # why + scope + approach
    │   ├── design.md            # how（技術取捨、架構決策）
    │   ├── tasks.md             # 實作 checklist（階層編號 1.1 / 1.2）
    │   ├── .openspec.yaml       # schema / created / skip_specs / retire_capabilities
    │   └── specs/               # delta specs
    │       └── ui/spec.md
    └── archive/
        └── 2025-01-24-add-2fa/  # 完成後帶日期前綴搬進來，全文保留
```

### 兩個資料夾的分工

| | `specs/` | `changes/` |
|---|---|---|
| 回答什麼 | 系統現在怎麼運作 | 我們想改成什麼 |
| 生命週期 | 長期累積 | 開 → 實作 → archive 後併回 `specs/` |
| 併行 | 單一真相 | 多個 change 可同時存在互不衝突 |

### spec.md 的格式

```markdown
## Purpose
這個 domain 在管什麼。

## Requirements

### Requirement: User Authentication
The system SHALL issue a JWT token upon successful login.

#### Scenario: Valid credentials
- GIVEN a user with valid credentials
- WHEN the user submits login form
- THEN a JWT token is returned
```

三層固定：`## Purpose` → `### Requirement:` → `#### Scenario:`，動詞用 RFC 2119（MUST / SHALL / SHOULD / MAY）。

**spec 是行為契約，不是實作計畫。** 判準很乾脆：如果實作換掉、對外可觀察行為沒變，那它就不該寫進 spec，該去 `design.md` 或 `tasks.md`。

### delta spec 的格式

```markdown
## ADDED Requirements
### Requirement: Two-Factor Authentication
...

## MODIFIED Requirements
### Requirement: Session Expiration
The system MUST expire sessions after 15 minutes.
(Previously: 30 minutes)

## REMOVED Requirements
### Requirement: Remember Me
```

| 區段 | archive 時的行為 |
|---|---|
| `## ADDED Requirements` | 附加到主 spec |
| `## MODIFIED Requirements` | 取代既有 requirement |
| `## REMOVED Requirements` | 從主 spec 刪除；宣告 `retire_capabilities: true` 時，刪掉最後一條會連 spec 檔一起退場 |
| `## Purpose` | 只在該 spec 尚不存在時用來種下 Purpose |

---

## 三、OpenSpec 的流程

```
1. propose   /opsx:propose   建立 change 資料夾
2. artifacts /opsx:ff        依 schema 相依性產出 proposal → specs → design → tasks
3. apply     /opsx:apply     照 tasks 實作，邊做邊勾
4. verify    /opsx:verify    （選用）確認實作符合 spec
5. archive   /opsx:archive   delta 併入 specs/，change 搬進 archive/
```

### schema 是相依圖，不是關卡

```yaml
artifacts:
  - id: proposal   requires: []
  - id: specs      requires: [proposal]
  - id: design     requires: [proposal]
  - id: tasks      requires: [specs, design]
```

原文寫得很清楚：**"Dependencies are enablers, not gates."** 它們說的是「現在可以做什麼」，不是「你必須先做什麼」。design 可以整個跳過。

> ⚠️ **這一點跟我們現在的設計直接衝突。** 我們的結構檢查 gate 是「擋住送審」的關卡，OpenSpec 的相依是「提示下一步」的建議。導入時必須決定要不要把 gate 的語氣改掉，否則兩套心智模型會在同一個畫面上打架。

### 四條設計原則

```
fluid not rigid         — 沒有階段關卡
iterative not waterfall — 邊做邊學，邊學邊改
easy not complex        — 幾秒鐘就裝好
brownfield-first        — 為既有程式碼設計，不是只給新專案
```

### brownfield 的關鍵一句

> "You do not document your whole codebase to start. You write specs only for what you're about to change."

`openspec/specs/` 一開始幾乎是空的，靠每次 archive 累積。文件明確反對一次性把既有 PRD 大量轉換 —— 那會產生「沒人信任的大而過期的 spec」。

**這對我們是個定位訊號**：我們的 PRD 工作台產出的是那份 40 頁 PRD，而 OpenSpec 說「那是不同的 artifact，做不同的事」。它建議 PRD 當**探索的素材**，而不是要被轉換的 spec。

---

## 四、現況盤點

| 項目 | 現況 | 與 OpenSpec 的落差 |
|---|---|---|
| `SECTION_TO_OPENSPEC`（`file-tree.ts:145`） | 7 個章節 → `PRD.md › ## Executive Summary` 等 | ❌ **OpenSpec 沒有 `PRD.md`**。這張對應表是憑空的 |
| `exportOpenspecBundle`（`export.ts:272`） | 下載 `openspec-<slug>-<ts>-{PRD,tasks,proposal}.md` 三個平鋪檔 | ❌ 不是資料夾結構、沒有 `specs/` delta、沒有 `.openspec.yaml` |
| `buildOpenspecProposal` | 產出 `## Why` / `## What Changes` / `## Capabilities` / `## Impact` | ⚠️ 接近舊版 OpenSpec 慣例，但現行文件的 proposal 是 `## Intent` / `## Scope` / `## Approach` |
| `openspec-import.ts`（tasks.md 回讀） | 用 `<!-- sf:c=section/check -->` 錨點回讀 checkbox | ✅ **方向正確**，是目前唯一真正接上的一段 |
| 編輯台 OpenSpec 區塊（今天做的） | 掃 `importSummary.allPaths` 找 `openspec/` 檔案並分群 | ✅ 正確但淺 —— 只知道「有哪些檔」，不知道狀態 |
| 結構檢查 gate | 擋住送審 | ⚠️ 與 "enablers, not gates" 衝突 |

### 一句話

我們有**匯出**（形狀錯）和**回讀**（形狀對），但沒有**追蹤**。而追蹤正是 OpenSpec 已經幫我們做好的部分。

---

## 五、導入建議

### 核心判斷

**不要自己解析 `openspec/` 的檔案內容來推狀態。** OpenSpec CLI 已經提供 `--json`，自己解析等於維護一份會跟上游分岔的第二實作。我們的原生橋已經在跑 `git` 和 `fastfetch`，多跑一個 `openspec` 是同一件事。

```bash
openspec status --change add-dark-mode --json
```

```json
{
  "changeName": "add-dark-mode",
  "schemaName": "spec-driven",
  "isPlanningComplete": false,
  "applyRequires": ["tasks"],
  "artifacts": [
    {"id": "proposal", "outputPath": "proposal.md",    "status": "done",    "requires": []},
    {"id": "specs",    "outputPath": "specs/**/*.md",  "status": "done",    "requires": ["proposal"]},
    {"id": "design",   "outputPath": "design.md",      "status": "ready",   "requires": ["proposal"]},
    {"id": "tasks",    "outputPath": "tasks.md",       "status": "blocked", "requires": ["specs","design"], "missingDeps": ["design"]}
  ]
}
```

四種狀態 `done / ready / blocked / skipped`，而且**依相依順序排列 —— 第一個 `ready` 就是下一步該寫的 artifact**。這正是 ADHD 介面最需要的一句話：「你現在該做這個」。

### 分三階段

#### 階段一：追蹤（低風險，高價值）

1. Swift 端新增 `openspecStatus` action：
   - `openspec list --json` → 有哪些 change
   - 對每個 change 跑 `openspec status --change <id> --json`
   - 找不到 `openspec` 執行檔就回 `openspecMissing`，畫面顯示安裝提示（跟 fastfetch 同一套處理）
2. 編輯台 OpenSpec 區塊改成顯示 change 清單 + 四格 artifact 狀態燈
3. 頭條顯示第一個 `ready` 的 artifact：「下一步：寫 design.md」

> 這一階段**完全不寫入**任何檔案，只讀。風險最低，而且立刻回答「這個專案的 OpenSpec 進度到哪」。

#### 階段二：修正匯出形狀

4. `SECTION_TO_OPENSPEC` 廢除或重寫。PRD 章節不對應 OpenSpec 標題，它對應的是 **exploration 素材**
5. `exportOpenspecBundle` 改成產出**資料夾結構**而不是三個平鋪檔：
   ```
   openspec/changes/<change-id>/
   ├── proposal.md        # ## Intent / ## Scope / ## Approach
   ├── design.md          # 從「範圍與里程碑」+「開放問題」推
   ├── tasks.md           # 沿用現有階層編號 + sf: 錨點
   └── specs/<domain>/spec.md   # delta，含 ## ADDED Requirements
   ```
6. `proposal.md` 的區段名改成現行文件的 `## Intent` / `## Scope` / `## Approach`

> ⚠️ 桌面 App 目前**不寫磁碟**（資料夾一律由 NSOpenPanel 建立）。要落地成資料夾就必須打破這個界線，這是一個需要你點頭的決策，不是我可以自己決定的。
> 折衷做法：仍然用下載，但下載成一個保留路徑的 `.zip`。

#### 階段三：雙向與定位

7. `tasks.md` 回讀擴充：目前只回讀章節檢查項，可再加上 change 層級的 artifact 狀態
8. 決定 gate 的語氣：要不要從「擋住送審」改成「提示下一步」，與 OpenSpec 的 enabler 模型對齊
9. 明確定位：**PRD 工作台產出 PRD；OpenSpec 追蹤實作**。兩者不是同一份文件的兩種格式

---

## 六、不建議做的事

| 不做 | 為什麼 |
|---|---|
| 自己解析 `spec.md` 的 Requirement / Scenario | 上游格式會演進，我們會變成維護第二套 parser。要細節就呼叫 CLI |
| 把整份 PRD 一次轉成 `openspec/specs/` | 官方文件明確反對：「會產生沒人信任的大而過期的 spec」 |
| 在 App 內實作 archive（delta 併回 specs） | 這是會改寫真相來源的破壞性操作。交給 CLI |
| 讓 agent 勾 checkbox 就通過簽核 | 已經是現有的邊界（`openspec-import.ts` 只回報 `ignoredApprovals`），維持 |
| 用 PRD 章節假裝成 OpenSpec 結構 | 今天已經修掉一次了，別再回去 |

---

## 七、需要你決定的三件事

1. **桌面 App 要不要開始寫磁碟？**
   階段二的資料夾落地繞不開這題。選項：(a) 開放寫入、(b) 下載 zip、(c) 只讀不寫、匯出交給 agent

2. **gate 的語氣要不要改？**
   OpenSpec 是 "enablers, not gates"，我們是硬關卡。兩套並存會讓人搞不清楚到底能不能送審

3. **PRD 與 OpenSpec 的關係怎麼定位？**
   官方立場是「PRD 是探索素材，不是要被轉換的 spec」。如果接受這個立場，「匯出成 OpenSpec」這個功能本身就要重新想 —— 它可能該變成「用這份 PRD 開一個 change」

---

## 八、階段一可以馬上動

如果只挑一件事做，就是**階段一的第 1、3 步**：接上 `openspec status --json`，讓編輯台的 OpenSpec 區塊回答「下一步該寫哪個 artifact」。

- 不寫磁碟、不改既有語氣、不需要任何上面三個決策
- 直接把今天做的「有哪些檔」升級成「進度到哪、下一步做什麼」
- 沒裝 `openspec` 就安靜顯示安裝提示，跟 fastfetch 同一套處理

---

## 附錄：關鍵指令

| 指令 | 用途 | Agent 可用 |
|---|---|---|
| `openspec init` | 建立 `openspec/` 與 AI 工具整合 | ✗ 互動式 |
| `openspec list` | 列出 changes / specs | ✓ `--json` |
| `openspec show <item>` | 讀內容 | ✓ `--json` |
| `openspec status --change <id>` | artifact 進度 | ✓ `--json` |
| `openspec validate --all` | 檢查結構問題 | ✓ `--json` |
| `openspec instructions` | 下一步該做什麼 | ✓ `--json` |
| `openspec archive` | 併入 specs、搬進 archive | ✗ 破壞性 |

斜線指令（AI 端）：`/opsx:explore`、`/opsx:propose`、`/opsx:ff`、`/opsx:apply`、`/opsx:verify`、`/opsx:archive`、`/opsx:onboard`
