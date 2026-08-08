# 升級評估 — 從 PRD 工作台到開發專案工作台

> 對象：`PM-SPEC+SCVB`（SpecForge）v1.1.0
> 日期：2026-08-09
> 範圍：現況盤點 · 第一性拆解 · 市場對標 · Skills 盤點 · 三階段路線
> 本輪**不改任何 `src/` 程式碼**，只出判斷。

---

> ## ⬛ 只讀這一段就夠
>
> **缺的不是資料庫，是一把 join key**（checkbox 沒有穩定 ID，所以 git／簽核／openspec／進度四份資料永遠對不上）。
> **「開發 LOG」的正確名字是稽核軌跡**——那是市場空隙，也是你的主場。
> **App 要當唯讀聚合器，不當任務管理器**（你實際在 Claude Code／Orca 裡工作）。
>
> **現在做這一件事**：Phase 0 + Phase 1.3 —— 穩定 ID + 單專案焦點卡。約 2 天，不寫磁碟、不改 bridge、不需要任何決策。
> 想多做半天就加 **Phase 1.7 跨 repo PR 雷達**（§十一）——`gh` 已裝已 auth，而你現在有一個 PR 開了 38 天沒動、完全不在視野裡。
>
> §八 的四個問題**已經替你決定好了**，你只要看一眼、不同意再說。其餘章節是佐證，想查再翻。

---

## 一、一句話結論

**缺的不是一個資料庫，是一把 join key。**

App 已經看得到 git、看得到 `plans/*.md` 的 checkbox、看得到 `openspec/` 的檔案清單、看得到誰簽了核。但這四件事之間**沒有任何欄位可以互相對上**——checkbox 的身分是「那一行的文字」，commit 的身分是 hash，簽核的身分是 localStorage 裡的 stage id。沒有共同鍵，就永遠只能各自顯示，拼不出「這個任務由誰在什麼時候做完，證據是哪個 commit，當初為什麼這樣決定」。

補上穩定 ID（`sf:` 錨點慣例**本專案已經有了**，在 `src/lib/openspec-import.ts`），再加一條落在磁碟上的 append-only 事件流，進度追蹤、開發 LOG、證據連結、稽核報告會一起掉出來。其餘都是 UI。

第二個結論：**「開發 LOG 資料庫」的正確名字是「AI 開發稽核軌跡」。** 那才是差異化所在，也是你（FinTech / 支付 PM）唯一比市場上每一個 AI 工作台都懂的東西。

---

## 二、現況盤點

### 2.1 八個頁面各自回答什麼

| 頁面 | 回答的問題 | 進度追蹤相關 | LOG 相關 |
|---|---|---|---|
| `login.html` | 我是誰（人／Agent） | — | 有 actor 概念，但不留痕 |
| `projects.html` | 有哪些專案、匯入評分 | `importSummary.progressPct` | — |
| `editor.html` | PRD 怎麼寫、gate 過了沒 | 章節 `score` / `checks` | — |
| `templates.html` | 有什麼範本 | — | — |
| `review.html` | 簽核到哪一關 | `CaseStage.state` | ❌ 簽核動作不留痕 |
| `tracking.html` | 這份 plan 做到哪 | ✅ checkbox 百分比 | — |
| `admin.html` | 人員／流程／個案 | — | — |
| `agents.html` | Agent prompt / 進場作業 | `AgentJob.status` | ❌ 只在 localStorage |
| `overview` / `dashboard` / `releases` | 專案統計、版本 | git 狀態、`Release` | ❌ 版本取號不留痕 |

### 2.2 已經有、而且做得對的部分

| 能力 | 位置 | 評價 |
|---|---|---|
| **Live tracking 判定** | `src/lib/tracking.ts`（純函式 + snapshot） | ✅ 設計精良，`SPEC-live-tracking.md` 是可移植規格等級的文件 |
| **git 深度讀取** | `mac-app-build/main.swift:369-468` | ✅ 已抓 commits(40) / branches / tags / worktrees / ahead-behind |
| **`sf:` 錨點回讀** | `src/lib/openspec-import.ts` | ✅ **穩定 ID 的雛形已存在**，只用在章節檢查項 |
| **agent 族系職務分離** | `types.ts:66 authorAgentFamily` | ✅ **市場上沒有的東西**，同族 agent 不能核准自己寫的文件 |
| **git 健檢不執行寫入** | `src/lib/git-doctor.ts` | ✅ 只產生建議指令，邊界清楚 |
| **bridge 命令注入防護** | `main.swift:243-249` | ✅ 只跑寫死的 git 子指令 |

### 2.3 結構缺口（按嚴重度）

| # | 缺口 | 證據 | 影響 |
|---|---|---|---|
| **G1** | **plan checkbox 無穩定 ID** | `src/lib/plan-parser.ts`（173 行）以行文字識別步驟 | 改個錯字 = 換一個任務。無法 join 任何東西 |
| **G2** | **零持久事件流** | 簽核／抽單／取號／`agentJobs`（`types.ts:301`）全在 `store.ts` 的 localStorage | 重灌即消失，不可稽核、不可 diff、不可匯出 |
| **G3** | **零決策紀錄** | 全 repo 無 ADR 目錄 | agent 看不到「為什麼」，會把理由重構掉 |
| **G4** | **git commits 上限 40 且不落地** | `GitStats.commits`（`project-stats.ts:22`） | 只能看近況，做不出時間軸 |
| **G5** | **無跨專案 rollup** | `tracking.html` 一次一份 plan | 多專案並行時（你的常態）沒有總覽 |
| **G6** | **live tracking 段 1 寫入端已停用** | `SPEC-live-tracking.md` §10（`launch_tui.ts` 2026-07-31 退場） | 多專案同時活動時無法消歧，只能靠 mtime |
| **G7** | **`openspec` 只知道有哪些檔、不知道狀態** | 2026-08-08 報告 §四 | 「下一步做什麼」答不出來 |

### 2.4 能力邊界：瀏覽器版 vs 桌面版

| 能力 | 瀏覽器版 | 桌面版（Swift bridge） |
|---|---|---|
| 讀磁碟檔案 | ❌（僅 `webkitdirectory` 一次性匯入） | ✅ `readFile` |
| 寫磁碟檔案 | ❌ | ⚠️ `writeFile` — **僅覆寫家目錄下既有的白名單副檔名檔案，不建新檔**（`main.swift:104-150`） |
| 跑 git | ❌ | ✅ `projectStats`（寫死子指令） |
| 跑外部 CLI | ❌ | ✅ `runTool`（現有 `onefetch` / `fastfetch`） |
| 取 mtime | ❌ | ✅ `trackingScan` |

現有 bridge action 共 9 個：`pickFolder` / `pickProjectFolder` / `projectStats` / `onefetch` / `fastfetch` / `trackingScan` / `readFile` / `writeFile` / `openPath`。

> ⚠️ **`isEditablePath` 是自訂政策，不是系統沙盒限制**（App 未啟用 App Sandbox 才能跑 `git`）。要落地 `.specforge/log.jsonl` 就必須放寬「檔案必須已存在」這一條。這是 Phase 2 的必改點，也是**需要你點頭的第一件事**。

---

## 三、第一性拆解

### 3.1 「開發專案工作台」到底在回答什麼

四個問題，缺一不可：

| # | 問題 | 現況 |
|---|---|---|
| Q1 | **下一步做什麼？** | 🟡 部分（gate 未過項、plan 下一個未勾） |
| Q2 | **現在到哪了？** | 🟡 部分（單一 plan 百分比、git dirty/ahead） |
| Q3 | **為什麼變成這樣？** | ❌ 完全沒有 |
| Q4 | **實際發生了什麼？** | ❌ 完全沒有 |

Q1/Q2 是**狀態**，Q3/Q4 是**歷史**。目前的 App 是純狀態機，沒有記憶。「升級成開發專案工作台」的實質內容就是：**加上記憶。**

### 3.2 「專案進度追蹤」的不可再分組成

| # | 組成 | 現況 | 缺口 |
|---|---|---|---|
| 1 | **工作單元有身分** | 行文字 | **G1 — 這是槓桿點** |
| 2 | **每個單元有狀態** | 二元 `[ ]` / `[x]` | 缺 doing / blocked |
| 3 | **單元 → 證據的映射** | 無 | commit / 檔案 / 測試 |
| 4 | **rollup 函式** | 計數 | 無加權、無跨專案 |
| 5 | **「現在是哪一個」指標** | ✅ `trackingTarget()` | 段 1 寫入端待補 |

**五項裡有四項都卡在第 1 項。** 給 checkbox 一個穩定 ID，第 3 項（證據）與第 4 項（rollup）立刻可做，第 2 項（多狀態）也才有地方掛。

### 3.3 「開發 LOG 資料庫」的不可再分組成

| # | 組成 | 設計判定 |
|---|---|---|
| 1 | **append-only 事件流** | `{ts, project, actor, kind, subject, ref, payload}` |
| 2 | **耐久儲存** | 專案內 `.specforge/log.jsonl`（**不是 localStorage**） |
| 3 | **查詢／索引** | JSONL 全掃即可。單人專案量級是萬筆，不需要 DB |
| 4 | **呈現表面** | Timeline 頁 + 篩選 + 匯出（Markdown / CSV） |

> **為什麼是 JSONL 不是 SQLite**：git 可以 diff、agent 可以用一行 shell 追加、壞掉只壞一行、不需要 native 依賴、匯出即檔案本身。SQLite 的查詢優勢在單人專案的量級（< 10 萬筆）換不到任何東西，卻換來「二進位檔進 git」和「agent 寫不進去」兩個真痛。**ponytail：JSONL 全掃，超過 10 萬筆再談索引。**

### 3.4 約束分類

| 約束 | 類型 | 挑戰 |
|---|---|---|
| WebView 看不到磁碟 | **HARD**（瀏覽器版） | 桌面版 bridge 已繞過 |
| localStorage 5–10MB | **HARD** | 直接排除「事件放 localStorage」 |
| `isEditablePath` 不建新檔 | **SOFT**（自訂政策） | 可放寬，範圍限縮在 `<project>/.specforge/` |
| `base:"./"` file:// 相容 | **SOFT** | 不影響 |
| 零新增重依賴 | **SOFT** | JSONL 方案不需要新依賴 |
| 單人 / 多專案並行 / agent 是主要開發者 | **HARD**（情境） | LOG 的主體是 agent 不是人 |
| 「使用者願意在 App 內管理任務」 | **假設 — 判定為假** | 你實際在 Claude Code / Orca 裡工作 |

**最後一條是整份評估的方向決定。** 如果 App 想擁有任務，它會跟你每天真正使用的工具競爭並且輸掉；如果它只讀取已經存在的事實，採用成本是零。**選聚合器，不選任務管理器。**

---

## 四、市場對標

> **時效聲明**：以下所有市場事實均為 **as of 2026-08-09**，來自附錄的一手／二手連結。凡標「判定」的欄位是本報告的推論，不是被引用來源的主張——兩者請分開看待。

### 4.1 Spec-driven development（規格驅動）

2026 年幾乎每個 AI 編碼工具都出了自己的 SDD 版本：GitHub Spec Kit、AWS Kiro、OpenSpec、BMAD、Tessl、Google Antigravity。分兩派——**living specs**（OpenSpec、Tessl、Augment Intent，規格與程式碼持續對齊）與 **spec-first scaffolding**（Spec Kit、Kiro、Traycer，規格是啟動文件）。

| 工具 | 定位 | 對本專案 | 判定 |
|---|---|---|---|
| **OpenSpec** | repo 內 living spec + delta 追蹤，`--json` 狀態 | 2026-08-08 報告已定案：**接 CLI，不重造 parser** | **接** |
| **GitHub Spec Kit** | 開源、model-agnostic、constitution-driven | 與 SpecForge 的 gate 概念重疊；可借「constitution」= 你的結構 gate 語彙 | **借概念** |
| **AWS Kiro** | agentic IDE，整套 SDD | 是 IDE 不是工作台，正面競爭 IDE 沒有勝算 | **避** |
| **Tessl** | `.tessl/` tiles 教會任何 MCP agent 走 SDD；Spec Registry 一萬多份外部函式庫 spec | 它的 tiles 模式值得學：**產品是「裝進別人 repo 的約定」而不是 App** | **借模式** |
| **BMAD-Method** | 多角色 agent 流程（PM/Architect/Dev） | 與 `agents.html` 的角色分工重疊，但它沒有簽核鏈 | **借角色定義** |

**定位結論**：SpecForge 產出的是 **PRD（探索素材）**，OpenSpec 追蹤的是 **實作契約**。這是兩個 artifact，不是同一份文件的兩種格式（2026-08-08 報告 §五已定）。工作台的角色是**同時顯示這兩層**，而不是把 PRD 轉成 spec。

### 4.2 Git-native 任務管理 —— 最直接的「進度追蹤」答案

| 工具 | 說明 | 判定 |
|---|---|---|
| **[Backlog.md](https://github.com/MrLesk/Backlog.md)** | 任務 = repo 內的 `.md` 檔（`task-<id> - <title>.md`）；terminal Kanban + web UI + **MCP server**；100% 離線；支援 Claude Code / Gemini CLI / Codex / Kiro；**內建 decision log** | **接，絕對不抄** |

這是本次評估最重要的一個發現。Backlog.md 已經把「git-native 任務 + 穩定 ID + decision log + agent 可讀寫」整套做完，而且它的儲存就是 markdown 檔案——**你可以直接讀。**

**具體接法**：專案匯入掃描時偵測 `backlog/` 目錄，有就把它當成該專案的任務真相來源（優先於 `plans/*.md` 的 checkbox）；沒有就退回現有 plan-parser。兩者統一成同一個內部 `Task` 型別。這比自己在 `store.ts` 裡蓋一張 tasks 表便宜一個數量級，而且解決了 G1（Backlog.md 的檔名就是穩定 ID）。

### 4.3 AI Agent 工作台 —— 真正的競品

| 工具 | 說明 | 判定 |
|---|---|---|
| **Vibe Kanban** | CLI + web，Kanban 管平行 agent，支援 Claude Code / Codex / Amp / Cursor / Gemini。**2026-07 官方宣布 sunsetting，轉社群維護** | **避（執行編排）／注意市場空隙** |
| **Conductor** | macOS App，平行跑 Claude Code / Codex，每個 agent 一個獨立 git worktree，中央 dashboard 看進度、審 PR | **避** — 你已經在用 Orca 做同一件事 |
| **Nimbalyst**（前身 Crystal，2026-02 轉手） | 跨平台，Monaco 編輯器 + markdown/mockup/diagram/資料模型/簡報視覺編輯 + iOS App | **避** — 範圍過大 |

**市場空隙**：Vibe Kanban 退場、Conductor 只做編排、Nimbalyst 往通用編輯器走——**沒有一家在做「PRD → gate → 簽核 → 實作 → 稽核」的治理鏈**。它們全部從「怎麼讓 agent 跑得更多」出發，沒有一個從「怎麼證明這些 agent 做的事是被治理過的」出發。

那正好是你的位置。而且 `authorAgentFamily`（同族 agent 不得核准自己撰寫的文件）是我在這一輪掃描裡**沒有在任何一家看到的機制**。這是可以拿出去講的東西。

### 4.4 決策紀錄（ADR）—— Q3「為什麼」的答案

| 工具 | 說明 | 判定 |
|---|---|---|
| **adr-tools**（Nat Pryce） | bash CLI，Nygard 格式 markdown | **借格式** |
| **[Log4brains](https://adr.github.io/adr-tooling/)** | Node 工具，把 `docs/adr/` 產成可搜尋靜態站 | **借渲染想法** |
| **純 `docs/adr/*.md`** | 2026 主流建議：先用純檔案，痛了再上工具 | **抄（最省）** |

2026 年 ADR 復甦的原因很直白：**AI agent 現在寫掉大部分程式碼，而看不到「為什麼」的 agent 會很開心地把理由重構掉。** 這句話對本專案是雙重相關——既是你要解決的問題，也是你要展示的論點。

### 4.5 AI Agent 可觀測性 —— 借 schema，不借工具

Datadog MCP Server、Braintrust、Loop AI 等企業級 agent 觀測平台，對單人專案是嚴重過度。但它們的結構化日誌 schema 值得整碗端走：

> `run_id` · `step` · `tool_name` · `input` · `output` · `latency_ms` · `token_cost` · `timestamp` · `status`
> 加上 **decision boundary**（agent 評估了哪些選項、選了哪個）與 **reasoning block**（為什麼）。

**判定：借 schema，避工具。** 下面 §6.3 的事件 schema 就是照這個削出來的。

### 4.6 對標總表

| 類別 | 代表 | 抄 / 接 / 避 | 一句話理由 |
|---|---|---|---|
| Spec-driven | OpenSpec | **接**（CLI `--json`） | 狀態真相已經是機器可讀的 |
| Spec-driven | Spec Kit / Kiro / BMAD | **借概念** | 它們是 IDE / 流程，不是工作台 |
| Spec-driven | Tessl | **借模式** | 「裝進別人 repo 的約定」比「一個 App」有生命力 |
| Git-native 任務 | **Backlog.md** | **接**（讀它的 `.md`） | 進度追蹤這題它已經解完了 |
| Agent 工作台 | Vibe Kanban / Conductor / Nimbalyst | **避** | 執行編排是紅海，且你已用 Orca |
| 決策紀錄 | 純 `docs/adr/` | **抄** | 最省，且 agent 直接可讀 |
| Agent 觀測 | Datadog / Braintrust | **借 schema** | 企業級工具，schema 免費 |

---

## 五、Skills 盤點（本機已安裝）

| Skill | 與本升級的關係 | 接線方式 |
|---|---|---|
| **`agenttask-tui`** | **`plans/*.md` 進度文檔的產生者**——你的 CLAUDE.md 規則就是靠它建檔 | 它建的檔就是 App 讀的檔。Phase 0 的穩定 ID 錨點應該**同時改這個 skill 的模板**，否則新檔案不會帶 ID |
| **`ShipUpdate`** | commit → push → PR → Linear 的收尾流程 | **天然的事件產生器**。收尾時多寫一行 `log.jsonl`，Timeline 就有「這段工作在此結束」 |
| **`orca-cli` / `orca-linear`** | worktree、terminal、Linear 票務 | worktree 路徑可餵給 `trackingScan`；Linear 票 ID 可當事件的 `ref` |
| **`ISA`** | Ideal State Artifact 的十二段規格 | ISA 的 `## Decisions` / `## Changelog` **就是 ADR**。Phase 3 可以直接讀 ISA 而不另建格式 |
| **`context-search` / `cs`** | 跨 session 找先前工作 | Timeline 的「找回上次做到哪」可借它的兩段式檢索設計 |
| **`tui-design`** | 終端 UI 設計 | `bun run track` 的 TUI 若要擴充成多專案總覽時用 |
| **`review` / `code-review`** | 程式碼審查 | 審查結果可入事件流（`kind: "review"`） |
| Claude Code 市集 dashboard / timeline skills | 產 HTML 儀表板與 roadmap | **避** — 它們是一次性 HTML 產生器，沒有持久儲存，解決不了 G2 |

### 5.1 最關鍵的一條線：寫入端契約已經寫好了

`SPEC-live-tracking.md` §9 已經定義了 Claude Code hook 的最小寫入契約（原本是給 `active` 訊號檔用的）。**同一個機制可以直接拿來當 LOG 的寫入端**——一行 shell，任何能跑 shell 的東西都能當 writer。

```jsonc
// ~/.claude/settings.json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [{
        "type": "command",
        "command": "r=\"${CLAUDE_PROJECT_DIR:-$PWD}\"; d=\"$r/.specforge/log\"; mkdir -p \"$d\"; f=\"${CLAUDE_TOOL_FILE#$r/}\"; printf '{\"v\":1,\"ts\":\"%s\",\"actor\":{\"kind\":\"hook\",\"family\":\"claude\"},\"kind\":\"file.edit\",\"subject\":\"%s\"}\\n' \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\" \"$f\" >> \"$d/$(date -u +%Y-%m).jsonl\""
      }]
    }]
  }
}
```

順帶把 G6（live tracking 段 1 寫入端停用）一起補回來：同一個 hook 多寫一次 `active` 訊號檔即可。

> ⚠️ 注意 CLAUDE.md 已記載：`launch_tui.ts` 因單實例守衛失效被停用（每次編輯開一個新 Ghostty 視窗）。**新的 writer 必須是純檔案追加，絕不能開視窗或起進程。** 上面這行符合。

---

## 六、升級路線（三階段，每階段獨立可 demo）

### Phase 0 — 補上 join key（約 1 天）

唯一目標：讓工作單元有穩定身分。

**主鍵裁決（必須先定，否則同一專案兩套主鍵）**：
- 專案有 `backlog/` → **以 Backlog.md 的 task id 為主鍵**，`sf:` 錨點不介入。
- 沒有 → `sf:t=<ULID>` 錨點為主鍵。
- 內部 `Task` 型別統一欄位 `{ id, source: "backlog" | "sf", ... }`。

**ID 必須是不透明的**（ULID／隨機），**絕不可由行文字 hash 推導**——改一個錯字就換 ID，join 當場斷裂。這一條推翻了「無錨點時退回行文字雜湊」的直覺做法。

```markdown
- [ ] 建立事件 schema <!-- sf:t=01K2Q9V4B7XM8N -->
```

**誰鑄造 ID？**（不指名這一項，Phase 0 交付不出來，Phase 1/2 全部懸空）
| 來源 | 鑄造者 |
|---|---|
| 新 plan 檔 | `agenttask-tui` skill 的建檔模板直接帶錨點 |
| 既有 9 份 plan | **lazy 鑄造**——第一次被 App 讀到時才補，不做一次性回填 |
| App 內新增步驟 | 桌面版 `writeFile`（既有 action 已足夠，檔案已存在） |

> **為什麼不做一次性回填腳本**（原設計已改）：「先做 30 分鐘無趣雜事才能開始」是 ADHD 最會卡死的形狀，而且它讓 Phase 0 從「改一個 parser」變成「跑一個會改 9 個檔的腳本」，心理成本高、心理報酬零。lazy 鑄造的代價只是「舊 plan 的事件要等第一次開啟後才接得上」——完全可接受。

**錨點遺失偵測**：agent 重寫整份 plan 會抹掉錨點。`plan-parser.ts` 需回報「本檔有 N 步驟無 ID」，總覽頁顯示警告並提供「重鑄」按鈕。無聲重鑄是錯的——會產生孤兒事件。

**Demo**：`bun run track` 顯示每個步驟的穩定 ID；重寫 plan 後 App 顯示錨點遺失警告。

**停損條件**：若回填腳本在既有 9 份 plan 上產生 > 20% 的錨點衝突或格式破壞，停手，改用「只有新 plan 帶 ID」的漸進策略。

---

### Phase 1 — 進度追蹤（約 2 天）

全部**唯讀**，不寫任何磁碟，風險最低。

| # | 工作 | 解決 |
|---|---|---|
| 1.1 | 新 bridge action `openspecStatus`：`openspec list --json` + 逐一 `openspec status --change <id> --json`；找不到執行檔就回 `openspecMissing`（比照 fastfetch） | G7 |
| 1.2 | 新 bridge action `backlogScan`：偵測 `backlog/` 並讀取任務 `.md`；統一成內部 `Task` 型別 | G1 / 直接接 Backlog.md |
| 1.3 | **單專案焦點卡 + 其他摺疊**（原設計為「跨專案總覽表」，已依 §十 ADHD 重審改寫）：預設**只**顯示 `trackingTarget()` 指到的那一個專案，大卡；其餘收成一行「其他 4 個專案 ▸」。焦點卡四個欄位封頂：**下一步 / 進度 / 上次動多久前 / 待推 commit 數** | G5 |
| 1.4 | 補回 live tracking 段 1 寫入端（見 §5.1 hook） | G6 |
| 1.5 | 進度加權：openspec artifact 狀態（`done/ready/blocked/skipped`）納入完成度計算 | Q1「下一步」 |
| 1.7 | **跨 repo PR 雷達**（§十一 L1）：新 bridge action `ghStatus`，焦點卡下方一行「你有 N 個 PR 開著，最久的 X 天」。60s 週期、stale 標示、fail-soft | §十一 |
| 1.6 | **首屏刷新策略**（不定會在 Phase 2 返工）：`trackingScan` 已是輪詢式；建議 1s 週期 + 畫面去重（沿用 `SPEC-live-tracking.md` §6 的做法），**不引入 FSEvents**——多專案監看的生命週期管理成本遠高於一次 `stat` | Vision 首屏承諾 |

**首屏 rollup 演算法**（必須寫死，否則各頁各算）：
```
專案完成度 = 0.5 × (plan checkbox 完成率)
           + 0.5 × (openspec artifacts done / total)
無 openspec 時 → 100% 取 plan；無 plan 時 → 100% 取 openspec；兩者皆無 → 顯示「無進度來源」而不是 0%
```

**外部依賴實測（2026-08-09）**：
- ✅ `openspec` **v1.6.0 已安裝**，`openspec status --change <id> --json` 旗標確認存在（`--change` / `--json` / `--schema` / `--store`）。Phase 1.1 的契約風險已排除。
- ❌ `backlog` **未安裝**。Phase 1.2 不需要 CLI（直接讀 `backlog/*.md`），但要先確認你是否打算採用；不採用就整段跳過，Phase 0 的 `sf:` 錨點成為唯一主鍵。
- 兩者都必須做 **JSON 形狀 snapshot 測試**（`tests/` 已有 7 個測試檔的慣例），上游改格式時要紅燈而不是靜默壞掉。

**Demo**：打開 App 第一屏，五個專案，一眼看到哪個在動、各自下一步是什麼。
**這一階段自己就是完整產品**，不做 Phase 2 也成立。
**停損條件**：若總覽頁在 5 個專案下單次刷新超過 500ms，停手改為手動刷新，不要往 FSEvents 加碼。

---

### Phase 2 — 開發 LOG（稽核軌跡）（約 3 天）

#### 6.1 儲存 —— 月分片，不是單一大檔

```
<project>/.specforge/
├── log/
│   ├── 2026-08.jsonl     # append-only，按月分片
│   └── 2026-09.jsonl
├── .gitattributes        # *.jsonl merge=union
└── config.json           # 專案層設定（選用）
```

**為什麼分片**：agent 是主要開發者（C5），掛上 `PostToolUse` hook 後量級推估為每專案每日 300–1000 筆、約 200B/筆 → **每年 20–70MB／專案**。單檔 parse 沒問題，**單檔 commit 才是問題**——git 每次 commit 存整顆 blob，一個持續長大的檔案每天 commit 一次會讓 repo 爆炸。月分片同時解決 git 膨脹、掃描邊界、保存期限三件事。

**`.gitattributes: *.jsonl merge=union`**：append-only 檔在分支合併時 100% 衝突在檔尾。union 合併 + 事件自帶時間戳可重排 = 一行解法。

**SQLite 的正確位置**：不是替代品，是**可拋棄的衍生索引**——由 JSONL 重建、進 `.gitignore`、可隨時刪。這樣日後上 SQLite 是加法不是遷移，格式決策不會反咬。

#### 6.2 需要放寬的 bridge 政策 ⚠️ 需你拍板

新增 **`appendFile`** action。這必須是**真 O_APPEND**，不可用 `readFile` → 字串相接 → `writeFile` 模擬——三類 writer 併發時，讀寫整檔會直接吃掉事件。

`isEditablePath` 不是「放寬」，是**新增一條精確謂詞**：

```
appendAllowed(path) :=
     realpath(path) 仍位於某個「已註冊專案根目錄」之內   // 擋 symlink 逃逸
  && 相對路徑符合 .specforge/**
  && 副檔名 ∈ {.jsonl}
  && 動作為 append（append 與 write 分成兩個 action，append 永不覆寫、永不刪除）
  && 單筆單行、< 4KB                                    // 保住 append 的原子性
```

「已註冊專案根目錄」= 使用者透過 `pickProjectFolder` 綁定過的清單，不接受 JS 傳任意路徑。

#### 6.3 事件 schema

```jsonc
{
  "v": 1,                                  // schema_version — append-only 格式的唯一逃生口
  "event_id": "01K2Q9V4B7XM8N",            // ULID。hook 會重複觸發，去重靠這個
  "ts": "2026-08-09T14:23:11Z",            // ISO-8601 UTC，不存時區
  "project": "PM-SPEC-SCVB",
  "actor": {
    "kind": "human" | "agent" | "hook" | "ci",
    "family": "claude" | "codex" | null,   // 沿用 AgentFamily —— 差異化靠這欄
    "name": "Scott"
  },
  "run_id": "01K2Q9…",                     // 一次 agent session
  "parent_run_id": null,                   // 子 agent
  "kind": "prd.section.edit" | "gate.pass" | "gate.fail"
        | "review.submit" | "review.approve" | "review.withdraw"
        | "task.done" | "commit" | "release.tag"
        | "agent.job.start" | "agent.job.done"
        | "pr.open" | "pr.review" | "pr.merge" | "pr.checks.fail"   // §十一 L2
        | "decision.record" | "file.edit",
  "subject": "sf:t=01K2Q9V4B7XM8N",        // join key：task id / section id / commit hash
  "ref": "https://github.com/.../commit/abc123",
  "payload": { }                           // kind 專屬，欄位白名單（見下）
}
```

設計取捨：
- **`subject` 是 join key**，所有 kind 共用同一欄位名，Timeline 才串得起來。
- **`payload` 走欄位白名單，不是自由形狀、不是黑名單**（見 6.4）。
- **parser 必須跳過解析不了的行**（crash 造成的半行），不是丟例外。整份 log 因為一行壞掉而讀不出來是最糟的失敗模式。

#### 6.4 ⚠️ 機密外洩 —— append-only 的致命面

log 若進 git（「是專案的一部分」），**agent 的 tool call 參數裡會有 API key、token、私有路徑**。append-only 意味著洩漏出去連刪都刪不掉，只能 rewrite history。硬規則：

- **`payload` 用欄位白名單**（明列可記錄的欄位），不是黑名單。黑名單永遠漏。
- **命令字串預設不記錄原文**：只記 `cmd_hash` + 前 16 字元前綴。
- **路徑一律相對於專案根目錄**，不記絕對路徑。
- 新增拍板項：**log 進 git 還是 `.gitignore`？**（見 §8）

#### 6.4 三類 writer

| Writer | 觸發 | 實作 |
|---|---|---|
| **App 內動作** | 送審 / 核准 / 抽單 / 版本取號 / gate 通過 | `store.ts` 的對應 action 呼叫 `appendFile` |
| **Claude Code hook** | agent 每次編輯 / session 結束 | §5.1 那一行 shell |
| **git 回填** | 首次啟用時 | 讀 `git log --pretty` 全量，轉成 `kind:"commit"` 事件寫入（一次性，冪等靠 `subject`=hash 去重）→ 順帶解決 G4 的 40 筆上限 |

#### 6.5 呈現 —— 預設不是時間軸

一條無限捲動的事件流對 ADHD 使用者是注意力黑洞：進得去出不來，而且看完沒有產出。所以分成三層，預設停在第一層。

| 層 | 內容 | 何時出現 |
|---|---|---|
| **① 回到工作**（預設） | 三行：「上次動 2 小時前 · 最後做完 X · 下一個未完成是 Y」+ 一個「繼續」按鈕 | 打開就是這個 |
| **② 今天做了什麼** | 當日事件摘要，依 `kind` 折疊成 ≤4 組 | 點一下 |
| **③ 完整時間軸** | 時間軸 + 依 `actor.kind` / `kind` / `project` 篩選 | 再點一下，或匯出稽核報告時 |

- **稽核報告匯出**：Markdown 與 CSV。給一份 PRD 選一段期間，匯出「誰在什麼時候對這份文件做了什麼」
- **任務詳情的證據區**：點一個 task ID，列出所有 `subject` 相同的事件（commit、編輯、簽核）

> **稽核軌跡有兩個價值主張，別混在一起講**：對外是**稽核**（作品價值、企業會付錢的東西）；對內是 **context recovery**（「我上次做到哪、為什麼停下來」）。後者才是你每天會用到的那個，而且它正是 ADHD 最痛的地方——回到被中斷的工作。第 ① 層就是為它存在的。

**Demo**：一份 PRD 從撰寫 → gate → 簽核 → change → commits → release 的完整 replay，匯出成一頁稽核報告。
**停損條件**：若 `appendFile` 無法做到真 O_APPEND（Swift `FileHandle.seekToEnd` + `write` 已足夠，但若因沙盒或權限做不到），停手改成 **hook 單獨寫檔、App 只讀**（§8 選項 b）——這個降級版本仍能交付 Timeline 與稽核匯出，只是少了 App 內動作那一類事件。

---

### Phase 3 — 決策紀錄與作品化（約 2 天）

- `decisions/NNNN-<slug>.md`（Nygard 格式），App 內可讀可改（現有 `readFile`/`writeFile` 已足夠，不需再放寬政策）
- 每次新增 decision 產生 `kind:"decision.record"` 事件，`subject` 指向受影響的 task / section → Q3「為什麼」接上 Q4「發生了什麼」
- **替代方案**：直接讀 `ISA` skill 產出的 `## Decisions` / `## Changelog` 區段，不另建格式（若你的工作流已全面走 ISA，這個更省）
- **作品化**：把上面那份 replay 做成公開可看的案例頁 → 直通 G0（公開顧問作品）

**停損條件**：若 Phase 2 的 Timeline 上線兩週後你自己沒有主動打開過，停手——這代表定位判斷（監控台 vs 任務管理器）本身錯了，Phase 3 做下去只會放大錯誤。

---

## 七、不做清單

| 不做 | 為什麼 |
|---|---|
| **App 內做 Kanban 任務 CRUD / 拖拉** | Backlog.md、Linear、GitHub Projects 已解；且會與你每天實際用的 Claude Code / Orca 競爭並輸掉。**⚠️ §12.1 已部分翻案**：勾選／新增步驟可以做，Kanban 仍然不做 |
| **把事件流放 localStorage** | 5–10MB 硬上限、不可 diff、不可稽核、重灌即消失 |
| **自建 `openspec/specs/*.md` parser** | 2026-08-08 報告已定案：上游格式會演進，會變成維護第二套 parser。**⚠️ §12.3 已部分翻案**：目錄結構與 tasks checkbox 可以自己解，`spec.md` 內文永遠不解 |
| **做 agent 執行 / worktree 編排** | Conductor / Nimbalyst 的紅海，且你已在用 Orca |
| **上 SQLite** | 單人專案量級（< 10 萬筆）換不到查詢優勢，卻換來「二進位進 git」與「agent 寫不進去」 |
| **一次做完三階段** | C0（開很多坑收不完）＋ C1（完美主義卡發布）。Phase 1 自己就是完整產品 |
| **在 App 內做 openspec archive** | 破壞性操作，會改寫真相來源，交給 CLI |

---

## 八、四個已經替你做好的決定

> 開放問題對 ADHD 使用者是四個開放迴圈，會直接卡住整條路線。所以以下**不是選擇題，是預設值**——你只要看一眼，不同意再說。理由都寫在旁邊，反對成本很低。

| # | 決定 | 預設 | 理由 | 反對的話會怎樣 |
|---|---|---|---|---|
| 1 | log 進不進 git | **(c) 分兩份**——脫敏摘要進 git，完整原始流 `.gitignore` | 進 git 才有作品價值；append-only + 機密不可撤銷，所以原始流不能進 | 選 (a) 全進 git → §6.4 白名單必須先寫完才能開第一個 writer |
| 2 | bridge 開不開 `.specforge/` 追加 | **(a) 開放**，用 §6.2 的謂詞嚴格限縮 | 不開放就少掉「App 內動作」整類事件，簽核軌跡會有洞 | 選 (b) hook 單寫 → Phase 2 仍可交付，只是簽核事件缺席 |
| 3 | 採不採用 Backlog.md | **不採用**（目前未安裝） | 「要先 `brew install` 才會動」的功能，對 ADHD 使用者等於不存在——這是 `dashboard-optimize.ts:11` 自己寫的原則 | 想採用 → Phase 1.2 加回，它的 task id 變主鍵 |
| 4 | ADR 用 `decisions/` 還是讀 ISA | **讀 ISA**（`## Decisions` / `## Changelog`） | 你的工作流已全面走 ISA，零額外格式、零新習慣 | 要當公開作品 → 改獨立 `decisions/`，但那是 Phase 3 才需要 |

**只有 #1 和 #2 會影響 Phase 2 的第一行程式碼。#3 #4 可以邊做邊改。**

---

## 九、如果只做一件事

**Phase 0 + Phase 1.3（穩定 ID + 跨專案總覽頁）。**

- 兩天內可完成，不寫磁碟、不改 bridge 政策、不需要上面任何一個決策
- 立刻回答你每天早上第一個問題：「哪個專案在動、下一步是什麼」
- 而且它是後面所有東西的地基——沒有穩定 ID，Phase 2 的 `subject` 欄位就沒有東西可填

---

## 十、ADHD 視角重審（2026-08-09 追加）

> 方法：impeccable `critique` 的認知負荷檢核（8 項）＋ IterativeDepth 四透鏡。
> ⚠️ **DEGRADED: single-context** —— 目標是文件與尚未實作的設計，無可渲染 UI 供 detect.mjs／瀏覽器稽核。

### 10.1 最重的一條：這份報告違反了它所評估的那個專案的設計信條

專案裡已經有一整套 ADHD 設計資產，而報告初版一個字都沒引用：

| 檔案 | 行數 | 已寫下的主張 |
|---|---|---|
| `src/lib/adhd-ui.ts` | 631 | 每頁只強調「現在下一步」；次要按鈕收進「更多」；降低同時可見選項 |
| `src/lib/focus-mode.ts` | 157 | **「工作記憶容量約 4 個開放迴圈，原介面同框約 30 個」**；**「時間盲是 ADHD 的核心缺損，原介面零時間資訊」**；**「ADHD 對看得到在動的東西的反應遠強於對數字目標」** |
| `src/lib/attention-motion.ts` | 139 | 單次 flash／pulse，不做常駐娛樂動效；尊重 `prefers-reduced-motion` |
| `src/lib/dashboard-optimize.ts` | 177 | **「一個要靠設定金鑰才會動的按鈕，對 ADHD 使用者等於不存在」** |

**這四條就是本專案的 ADHD 設計憲法。** 任何新頁面都應該先過這四條，再談功能。

### 10.2 認知負荷檢核

| 檢核項 | 報告（初版） | 跨專案總覽表（初版設計） |
|---|---|---|
| Single focus | ✗ 九章＋附錄，「只做一件事」埋在第 440 行 | ✗ 五個專案平權並列 |
| Chunking ≤4 | ✗ G1–G7（7）、市場 6 類 24 項、不做清單 7 條 | ✗ 5 列 > 4 |
| Grouping | ✓ | ✓ |
| Visual hierarchy | ✓（勉強） | ✗ 「正在動」只靠一個灰色 `•` |
| One thing at a time | ✗ §八 四個拍板項並列 | ✗ |
| Minimal choices ≤4 | ⚠️ 4 題 × 3 選項 = 12 種組合 | ✗ 5 個可點目標 |
| Working memory | ✗ Phase 2 要你記得 §2.4 §3.3 §五 | ✓ |
| Progressive disclosure | ✗ 全攤平 | ✗ 全展開 |
| **失敗數** | **5/8 → critical** | **6/8 → critical** |

### 10.3 四透鏡發現

| 透鏡 | 發現 | 已改 |
|---|---|---|
| **時間盲** | 初版總覽頁**零時間資訊**——重蹈 `focus-mode.ts` 已修過的錯 | ✅ 焦點卡強制「上次動多久前」；Phase 2 事件流補「本週投入」 |
| **工作記憶** | 5 專案 × 5 欄 = 25 個同時可見資訊點 | ✅ 改單焦點卡 + 摺疊，欄位封頂 4 個（§Phase 1.3） |
| **啟動障礙** | Phase 0 的一次性回填腳本＝「先做 30 分鐘雜事才能開始」 | ✅ 改 lazy 鑄造（§Phase 0） |
| **過度專注** | Timeline + 稽核軌跡是 hyperfocus 陷阱——整理資料很爽，但不是做事 | ✅ 預設停在「回到工作」三行，時間軸要點兩下才到（§6.5） |

### 10.4 尚未改、但你該知道的三件事

1. **Phase 2 的 hook 要手動編 `~/.claude/settings.json`。** 依 `dashboard-optimize.ts:11` 的原則，這等於「不存在」。**但 App 不該自動改使用者的 settings.json**（太侵入）。折衷：App 內偵測 hook 是否已裝，未裝就顯示一個「複製這行」的按鈕 + 一句話說明。這是 Phase 2 必須加的一個小工作項。

2. **「會動的東西 > 數字目標」還沒兌現。** 焦點卡目前的設計仍是靜態數字。建議：正在動的專案卡，在 `trackingScan` 偵測到 mtime 變化的那一刻跑一次 `attention-motion.ts` 的單次 pulse（**不是常駐動畫**——那違反 `attention-motion.ts` 自己的規則）。成本很低，效果對 ADHD 很大。

3. **每階段缺「完成的儀式」。** 已有停損條件（何時停手），但沒有 done signal（何時算贏）。C1（完美主義卡發布）的對策不是停損，是**明確的結束**。建議每階段補一條：Phase 0 = 截一張帶 ID 的 `bun run track` 圖；Phase 1 = 截焦點卡發一則貼文；Phase 2 = 匯出一份稽核報告 PDF。**產出物離開電腦，那一階段才算完成。**

### 10.5 一句話

初版報告的內容判斷是對的，形狀是錯的——它用「顧問交付物」的形狀寫給一個 ADHD 讀者，而它評估的那個 App 早就知道該怎麼做。改法不是刪內容，是**加一層漸進揭露**：頂部三行 TL;DR、拍板題改成預設值、深水區留在原地供查閱。

---

## 十一、功能評估：GitHub 狀態追蹤 · PR 同步（2026-08-09 追加）

### 11.1 實測現況

| 項目 | 實測結果（2026-08-09） |
|---|---|
| `gh` CLI | ✅ **2.96.0 已裝、已 auth**（`ShiGaChenTW`，keyring） |
| Token scopes | `repo` · `workflow` · `read:org` · `gist` — PR 與 Actions 都夠 |
| **本 repo 的 PR** | ❌ **歷來 0 個**。68 commits、1 個 merge commit、無 `.github/workflows` |
| **跨 repo 的 PR** | ✅ 8 個近期 PR（含 `HKUDS/DeepTutor`、`dcolinmorgan/herdr-push` 兩個上游貢獻） |
| **現在開著的 PR** | 🔴 **`Terminal-Widget#1`，開了 38 天沒動**（1166 行、MERGEABLE、零 review） |
| 跨 repo 查詢成本 | `gh search prs --author=@me --state=open` → **1.9 秒** |

**兩個直接推論：**

1. **「要先設定才會動」這條不成立。** `gh` 已裝已 auth，不像 Backlog.md 需要 `brew install`。§八 #3 拒絕 Backlog.md 的那個理由在這裡不適用——**這個功能可以做**。
2. **PR 追蹤的價值不在單一 repo，在跨 repo。** 只看 PM-SPEC+SCVB 會判定這功能沒用（0 個 PR，直推 main）。放大到你所有 repo，它立刻變成最有價值的一個——而且已經有一個掛了 38 天的活證據，**它現在完全不在你的視野裡**。

### 11.2 第一性：PR 是什麼，App 已經有哪些對應物

PR 由四件事組成，其中三件 App 已經有同構概念：

| PR 的組成 | App 既有對應 | 狀態 |
|---|---|---|
| 一組 commits 的提案 | `GitStats.commits`（40 筆） | 有，但不知道哪些屬於哪個 PR |
| **一個人類審查關卡** | **`CaseStage` 簽核關卡** | **概念同構，完全沒接** |
| 一組自動檢查 | 結構 gate（擋送審） | 概念同構（gate 擋送審／checks 擋 merge） |
| 一個對外可見狀態 | — | 完全缺 |

**戰略判定**：這不是「加一個功能」，是**補上治理鏈缺的那一段**。報告的鏈是 `PRD → gate → 簽核 → change → commits → release`；真實世界裡 commits 與 release 之間站著 PR，而 PR 正是「人類審查」與「agent 產出」的交界點——SpecForge 的主題本身。

**由此掉出第二個差異化點**：把 `authorAgentFamily` 的職務分離規則延伸到 PR review ——**「這個 PR 由 Claude 寫的，就不能由 Claude 核准」**。GitHub 原生做不到：它只有 CODEOWNERS 與 branch protection，沒有 agent 族系的概念。這跟 §4.3 的「治理鏈」是同一個賣點的兩個面。

### 11.3 建議範圍：三層，只做前兩層

| 層 | 內容 | CLI | 判定 | 落點 |
|---|---|---|---|---|
| **L1 跨 repo PR 雷達**（讀） | 焦點卡**下方**獨立一行：「你有 2 個 PR 開著，最久的 38 天 ▸」 | `gh search prs --author=@me --state=open --json …` | **做** | Phase 1，+0.5 天 |
| **L2 單專案 PR 狀態**（讀） | PR 清單 + `reviewDecision` + `statusCheckRollup`（CI 燈）+ 接進事件流 | `gh pr list --json …` | **做** | Phase 2，+1 天 |
| **L3 雙向同步**（寫） | App 簽核 → 直接 `gh pr review --approve` / 發 comment | — | **不做** | — |

#### 為什麼 L3 不做

`git-doctor.ts` 開頭已經替這個問題立過界線，原文照抄即可：

> 「這裡只**產生建議指令**，不執行任何 git 寫入。（…）一個從 WebView 按下去就悄悄改 repo 的按鈕，出錯時使用者連發生了什麼都不知道。」

`gh pr review --approve` 跟 `git push` 是同一類——**不可逆的對外動作**。同一套邏輯必須套用，否則專案內兩套標準。

**折衷（與 git-doctor 完全一致）**：App 把簽核結果 render 成一段 markdown，人自己複製貼到 PR。零風險、九成價值。這是 L3 唯一該做的部分。

### 11.4 工程細節

- **新 bridge action `ghStatus`**，子指令寫死，比照 `main.swift:243-249` 的 `git()` 注入防護。倉庫路徑當工作目錄傳入，不接受 JS 傳參數字串。
- 🔴 **網路呼叫不可進 1 秒刷新迴圈**（實測 1.9 秒）。分層刷新：
  | 資料 | 週期 |
  |---|---|
  | 本地 git / plan mtime | 1s（沿用 `trackingScan`） |
  | GitHub 狀態 | **60s + 手動刷新 + stale 標示**（「PR 狀態於 3 分鐘前取得」） |
- **Rate limit**：`gh search` 走 Search API（30 req/min），比 REST 嚴。60s 週期安全，但多專案**必須共用一次查詢**，不可各自打。
- **Fail-soft 全覆蓋**：離線 / 未 auth / rate limit / 非 GitHub remote，一律比照 `openspecMissing`、`fastfetch` 的處理——安靜降級，不當錯誤。
- **事件流天然接得上**：schema 的 `ref` 欄位（§6.3）本來就是為 PR URL 設計的。新增 kind：`pr.open` / `pr.review` / `pr.merge` / `pr.checks.fail`。

### 11.5 ADHD 角度（延續 §十）

| 檢核 | 處置 |
|---|---|
| **焦點卡欄位封頂 4 個** | PR 雷達**不擠進卡內**，放在卡下方獨立一行。§十 才剛立的規則，不能自己先破 |
| **時間盲** | 顯示「**38 天沒動**」，不是「2026-07-03」 |
| **C0 開很多坑收不完** | 「有個 PR 開著沒人理」正是 C0 的具體形狀。這功能的真正價值是**把不在視野裡的開放迴圈拉回視野** |
| **過度專注陷阱** | ❌ **不要做 PR diff 檢視器**。看 diff 去 GitHub 或 IDE；在這裡做只會變成「在工作台裡讀 code」的黑洞 |
| **§八 維持 4 題** | L3 的取捨已在 11.3 直接判定為「不做」，不升格成第 5 個拍板題——四個開放迴圈已是上限 |

### 11.6 停損條件

L1 上線兩週後，若你沒有因為它去處理任何一個 PR → 停手，不做 L2。這代表 PR 不是你實際的瓶頸，繼續投入只是在餵過度專注。

---

## 十二、重審三個「不做」項（2026-08-09 追加）

> 起因：Scott 要求評估把 §七 不做清單裡的三項加回來。
> 結論：**一項維持不做，兩項縮小範圍後翻案。** 翻案的理由是新事實，不是他問了第二次。

### 12.1 任務 CRUD — **部分翻案**

**改變判斷的新事實**：§八 #3 決定不採用 Backlog.md（目前未安裝），所以**現在沒有任何東西補這個位置**。原本的理由是「Backlog.md 已解決」，前提沒了。而 P0 做完之後，每個步驟有穩定 id，寫回檔案的成本從「要先設計識別機制」降到「改一行字」。

**該做的**：在 Task Tracking 頁勾／取消勾一個步驟、在末尾新增一個步驟（自動鑄錨點），寫回 `plans/*.md`。`isEditablePath` 已經允許（家目錄下、`.md` 在白名單、檔案已存在），**不需要放寬任何權限**。

**仍然不該做**：Kanban 欄位、拖曳、優先級、指派、到期日、篩選器。那些是 Linear 的形狀，做進來就是同時維護兩套任務系統。

**真正的風險不是範圍，是併發**。你在 App 裡勾一個步驟的同時，agent 可能正在重寫同一份 plan。整檔覆寫會靜靜吃掉 agent 剛寫的東西，而且**沒有任何錯誤訊息**——這比功能沒做還糟。緩解：寫入前先重讀、比對 mtime 與錨點集合，不一致就擋下並顯示「這份計劃在你編輯期間被改過」。這條沒做就別上。

**成本**：勾選＋新增約 0.5 天，併發保護約 0.5 天。**保護那半天是硬性的，不是可選的。**

### 12.2 Agent 編排 — **維持不做**

**沒有新事實。** Orca 就是這個 repo 所在的工作區；Conductor 與 Nimbalyst 在同一條路上跑得更遠。要做到堪用需要 worktree 生命週期、進程監管、輸出串流、失敗回收——幾個月的工程量，換一個比你每天已經在用的東西更差的版本。

**而且有一道硬牆**：要從 App 派工，就得讓原生端執行 JS 傳來的任意 prompt 字串。`main.swift` 全檔的注入防護就建立在「只跑寫死的子指令，不接受任何來自 JS 的參數字串」（`main.swift:243-249`）。開這個口等於把 WebView 變成任意程式碼執行的入口，而這個 App 會讀你所有專案資料夾。

> 附帶一提：`agentJobs` 在資料模型裡（`types.ts:21`）但**沒有任何 dispatch**，`store.ts` 只有 push／更新狀態。它現在是一份紀錄，不是一個佇列。

**該做的替代**：**產生指令讓人自己貼**——`git-doctor.ts` 與 §十一 L3 已經用過兩次的同一個模式。App 知道專案路徑、知道下一個 `ready` 的 artifact、知道哪個 agent 族系不能碰這份文件，它可以吐出一行：

```bash
cd <project> && claude -p "依 openspec 寫 design.md（change: add-dark-mode）"
```

零新增攻擊面、零新依賴、九成價值。**成本約 0.3 天。**

### 12.3 自建 openspec parser — **部分翻案，但界線要畫死**

**改變判斷的新事實**：`openspec status` 只在桌面版跑得起來（`canQueryStatus()` 要 bridge）。**瀏覽器版對 openspec 完全瞎眼**，而治理鏈 replay（P3-4）如果要當公開作品頁，它跑在瀏覽器裡。

**關鍵區分是我上一版沒講清楚的**：

| 解析對象 | 穩定度 | 判定 |
|---|---|---|
| `openspec/changes/<id>/` 底下有哪些檔 | **極穩定**，就是目錄結構 | ✅ 可以自己解 |
| `tasks.md` 的 checkbox 數量 | **穩定**，而且 `openspec-import.ts` 已經在解（`sf:c=` 錨點） | ✅ 可以自己解 |
| `spec.md` 的 Requirement / Scenario / delta | **會演進**，RFC 2119 語法與 ADDED/MODIFIED/REMOVED 區段都是上游的活規格 | ❌ 永遠呼叫 CLI |

前兩項就是「這個 change 走到哪、下一步寫哪個檔」的九成資訊，而它們的形狀比 spec 內文穩定一個數量級。

**兩個真相來源打架怎麼辦**：CLI 在就一律以 CLI 為準，fallback 只在 CLI 缺席時上場，而且畫面要標明「估算（未安裝 openspec）」。不標就會變成「有時候準有時候不準」，那是最難除錯的形狀。

**成本**：約 0.5 天（純函式 + 測試）。**不得超過 80 行**——超過就表示開始解內文了。

### 12.4 總表

| 功能 | 上一版 | 本次 | 範圍 | 成本 |
|---|---|---|---|---|
| 任務 CRUD | ❌ 不做 | ⚠️ **縮小後做** | 勾選／新增步驟寫回檔案 **+ 併發保護** | 1 天 |
| Agent 編排 | ❌ 不做 | ❌ **維持不做** | 改為產生交接指令 | 0.3 天 |
| 自建 openspec parser | ❌ 不做 | ⚠️ **縮小後做** | 只解目錄結構與 tasks checkbox，≤80 行 | 0.5 天 |

**合計約 1.8 天。** 要塞進來就得從 Phase 2 挪——建議延後「稽核報告 CSV 匯出」與「PR 事件接入」，那兩項現在沒有消費者。

**什麼會讓我再翻一次**：
- 任務 CRUD → 如果你決定採用 Backlog.md，這整項立刻退回「不做」，改讀它的檔
- openspec parser → 如果 fallback 與 CLI 出現過一次結果不一致而你沒立刻發現，砍掉 fallback

---

## 附錄：來源

- [Backlog.md — git-native markdown 任務管理](https://github.com/MrLesk/Backlog.md) · [HN 討論](https://news.ycombinator.com/item?id=44483530)
- [spec-compare — 6 種 spec-driven 工具比較](https://github.com/cameronsjo/spec-compare)
- [9 Best AI Tools for Spec-Driven Development in 2026（MarkTechPost）](https://www.marktechpost.com/2026/05/08/9-best-ai-tools-for-spec-driven-development-in-2026-kiro-bmad-gsd-and-more-compare/)
- [Best Spec-Driven Development Tools（Augment Code）](https://www.augmentcode.com/tools/best-spec-driven-development-tools)
- [Conductor vs Vibe Kanban vs Nimbalyst 比較](https://nimbalyst.com/compare/nimbalyst-vs-conductor-vs-vibe-kanban/)
- [vibe-kanban alternatives（含 sunsetting 說明）](https://aq.dev/alternatives/vibe-kanban/)
- [9 Open-Source Agent Orchestrators for AI Coding](https://www.augmentcode.com/tools/open-source-agent-orchestrators)
- [ADR Tooling 官方清單](https://adr.github.io/adr-tooling/)
- [Architecture Decision Records: the complete guide 2026](http://docs.align.tech/blog/architecture-decision-records-complete-guide/)
- [AI Agent Logging & Audit Trails](https://www.buildmvpfast.com/blog/ai-agent-logging-audit-trail-debugging-compliance-2026)
- [Best Claude Code Skills & Plugins 2026](https://dev.to/raxxostudios/best-claude-code-skills-plugins-2026-guide-4ak4)
- 專案內既有文件：`plans/2026-08-08_openspec-tracking-adoption-report.md`、`SPEC-live-tracking.md`
