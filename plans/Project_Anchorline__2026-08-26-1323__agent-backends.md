# Plan — Agent 後端可管理化（CLI 清單 ＋ API 清單）

**建立時間：** 2026-08-26 13:23
**最後更新：** 2026-08-26 13:23
**狀態：** 進行中

## 目標

讓「呼叫 agent 進場」不再只有一條全域 HTTP 通路。改成兩張**使用者自己管得動的後端清單**
（CLI 後端 / API 後端），每個 agent 綁一個後端；簽核頁與版本頁的呼叫照原路走，只是通路變成可選。

**為什麼現在做（不是理論需求）：** R1 地基探測 48 次呼叫裡 **13 次失敗全是 OpenRouter 額度用盡（HTTP 402）**，
而走 opencode CLI 免費通道的 16 次 **16/16 全成功**（`plans/r1-foundation-probe__2026-08-26.md` §通道表）。
API 金鑰會沒錢、會過期；CLI 通路吃的是既有訂閱。**現在的 App 只有前者，沒錢就整個功能停擺。**

## 現況（已查證，實作前不必再查一次）

| 事實 | 位置 |
|---|---|
| 簽核頁呼叫 agent 的入口 | `src/pages/signoff.ts:432` → `store.invokeAgent`（`src/data/store.ts:3656`） |
| 真正打模型的地方 | `ai-coach.runAgentTask` → `ai-client.chatCompletion`（`src/lib/ai-client.ts:311`） |
| 全部 provider 都是 HTTP `fetch` | `ai-client.ts` — `ollama` 也是打 :11434，不是 spawn |
| 沒設 Key 就直接失敗 | `store.ts:3762` `isAiConfigured()` → `mark("failed", …)`，無 fallback |
| AI 設定是**單一份全域** | `types.ts:576` `AISettings`（一個 model / provider / apiKey / endpoint） |
| `chatCompletion` 讀全域 `settings()`，**沒有 per-call 後端參數** | `ai-client.ts:311-318` |
| agent 身上沒有任何後端欄位 | `types.ts:660-666` `Employee.agentPrompt / agentRoleBrief / agentEnabled` |
| `tauri-plugin-shell` 刻意不引入 | `src-tauri/Cargo.toml:34` 有註解說明原因 |
| **但原生端早有 CLI 橋** | `src-tauri/src/exec.rs` `locate()` / `run()`；白名單 `git openspec gh onefetch fastfetch` |
| CLI 路徑覆寫 UI 已存在 | `commands.rs:2280 set_cli_path` / `2297 probe_clis`、`native.ts:341-342` |

## 四個必須守住的設計決策

**D1 — prompt 走 stdin，永不進 argv。**
`docs/BRIDGE.md` §3.3 白紙黑字禁止「執行前端傳來的任意 prompt／指令」。這條**要修訂，不是繞過**：
新契約是「把一段文字餵給白名單內、旗標寫死的 CLI」。前端能決定的只有 `backendId`（列舉）
與 stdin 內容。旗標、子指令、工作目錄全部在 Rust 端寫死。**BRIDGE.md 沒改到＝實作與契約分岔，這批不算完成。**

**D2 — CLI 必須跑在「不能用工具」的模式。**
`claude` / `codex` / `opencode` 預設都能讀檔、跑 bash。旗標選錯，WebView 就多了一條任意程式碼執行路徑，
D1 守的東西全白費。實作者**必須實跑 `<tool> --help` 確認**非互動 + 禁工具的旗標組合，
把確認到的實際旗標寫進 BRIDGE.md 表格。**不准憑印象寫旗標。**

**D3 — timeout ＋ 輸出上限。**
現有 `exec::run()` 是同步 `cmd.output()`，無逾時。LLM CLI 動輒數十秒到數分鐘，
照抄會把 App 凍住。要 async command + 逾時（預設 180s，逾時 kill）+ stdout 上限（1 MB，超出截斷並標示）。

**D4 — 瀏覽器沒有 CLI。**
`native.isNative() === false` 時 CLI 後端一律不可選，UI 要**講得出原因**（「需要桌面版」），
不是灰掉了事。`bunx vite` 開發時整條 CLI 路不存在，這是預期行為。

## Plan Steps

### W1 — 資料層（純 TS，可與 W2 並行）
- [ ] `types.ts`：新增 `AgentBackend = { id, label, kind: "api" | "cli", … }`
      —— api 分支帶 `provider/model/endpoint/apiKey/localModelName/temperature`；
      cli 分支帶 `tool`（列舉）與可選 `pathOverride`。放進 `AISettings.backends: AgentBackend[]`
- [ ] `Employee` 加 `backendId?: string`
- [ ] **相容 migration**：舊設定的單一 `model/provider/apiKey/endpoint` 讀進來時轉成清單第一筆
      `id: "default"`；`backendId` 未設的 agent 一律解析到它。**漏了這步所有既有 agent 直接壞掉**
- [ ] `src/lib/agent-backend.ts`：`resolveBackend(agentId): AgentBackend`、`listBackends()`、CRUD、id 唯一性
- [ ] store：`addBackend / updateBackend / removeBackend / setAgentBackend`；刪除仍被綁著的後端要擋
- [ ] 測試：migration、解析回退、刪除守門、id 衝突

### W2 — 原生層（Rust，可與 W1 並行）
- [ ] `exec.rs`：`run_stdin(bin, args, stdin, timeout, max_bytes)` —— 逾時 kill、輸出截斷
- [ ] `commands.rs`：`agent_cli_run(tool, prompt) -> R<String>`，白名單 `claude codex gemini opencode`，
      **每個工具的旗標寫死在 Rust**；工具沒裝回 `unavailable` 形狀（不是 reject，見 BRIDGE §2）
- [ ] `set_cli_path` / `probe_clis` 的 `ALLOWED` 一併加入這四個工具（目前只有 5 個舊工具）
- [ ] `lib.rs` 註冊新 command
- [ ] `native.ts` 加型別化入口 `agentCliRun`
- [ ] **`docs/BRIDGE.md` 修訂**：§3.1 表格加四個工具與實測旗標、§3.3 那條禁令改寫成 D1 的新契約、§4 加新 action
- [ ] Rust 測試：白名單拒絕未知工具、逾時真的會 kill、輸出上限真的會截斷

### W3 — 接線（依賴 W1 ＋ W2）
- [ ] `ai-client.chatCompletion` / `chatCompletionStream` 加 **optional** `backend` 參數，
      不傳＝現行全域行為。**其餘 6 個既有呼叫端零改動**
- [ ] `ai-coach.runAgentTask` 多收 backend 並往下傳
- [ ] `store.invokeAgent`：從 `agent.backendId` 解析後端；CLI 後端在瀏覽器→`ok:false` 講清楚原因；
      CLI 沒裝→`failed` 訊息帶安裝提示。**現有的落地契約（`landed: "pending"`）不准動**
- [ ] 測試：兩種後端各自的成功／失敗訊息、非 native 時的守門

### W4 — UI（依賴 W1，probe 依賴 W2）
- [ ] 設定頁兩張清單的 CRUD：API 後端（金鑰遮罩）／ CLI 後端（顯示 `probeClis` 偵測到的路徑、可指定路徑）
- [ ] agents 頁：每個 agent 一個「後端」下拉，選項來自清單；顯示目前解析結果
- [ ] 金鑰**不得**出現在匯出、log、event JSONL

## 派工

- W1、W2 檔案不重疊（`src/data/*` vs `src-tauri/*` + `native.ts` + `BRIDGE.md`），**並行派 Engineer**
- W3、W4 等 W1/W2 驗收後再派
- 主 session 當 PM，不寫 code
- 額度閘門 2026-08-26 13:20：Engineer/Forge/Cato routable，Bellows exhausted、Anvil unavailable

## 決策紀錄

- 13:23 — 選「兩張清單 + agent 綁 backendId」，排除「只加一個 CLI provider 到 AIProvider 聯集」：
  後者仍是單一全域設定，換一個 agent 就得整份改，等於沒解決額度耗盡時的切換問題
- 13:23 — 選 stdin 傳 prompt，排除 argv：argv 會讓 BRIDGE §3.1「參數寫死」失守
- 13:23 — 選「修訂 BRIDGE.md」，排除「實作先做、文件後補」：那份文件是契約測試的依據，分岔＝測試在測舊契約

## 阻塞 / 待決議

- **待 Scott 拍板**：CLI 白名單要放哪幾個工具。目前提案 `claude / codex / gemini / opencode`
  （opencode 是 R1 實測 16/16 全成功的免費通道）。多一個工具就多一條原生執行路徑，不是零成本
- 工作樹目前 dirty（一份 UAT md 已改、`docs/brainstorm/` 未追蹤）——派工前不清掉的話，
  agent 的 diff 會跟這些混在一起

## 結束摘要

（工作結束時補上）
