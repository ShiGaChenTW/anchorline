# Plan — Agent 後端可管理化（CLI 清單 ＋ API 清單）

**建立時間：** 2026-08-26 13:23
**最後更新：** 2026-08-26 15:35
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
這六個 CLI 預設多半能讀檔、跑 bash。旗標選錯，WebView 就多了一條任意程式碼執行路徑，
D1 守的東西全白費。實作者**必須實跑 `<tool> --help` 確認**非互動 + 禁工具的旗標組合，
把確認到的實際旗標寫進 BRIDGE.md 表格。**不准憑印象寫旗標。**

**D3 — timeout ＋ 輸出上限。**
現有 `exec::run()` 是同步 `cmd.output()`，無逾時。LLM CLI 動輒數十秒到數分鐘，
照抄會把 App 凍住。要 async command + 逾時（預設 180s，逾時 kill）+ stdout 上限（1 MB，超出截斷並標示）。

**D4 — 瀏覽器沒有 CLI。**
`native.isNative() === false` 時 CLI 後端一律不可選，UI 要**講得出原因**（「需要桌面版」），
不是灰掉了事。`bunx vite` 開發時整條 CLI 路不存在，這是預期行為。

## Plan Steps

### W1 — 資料層（純 TS）✅ 完成，主 session 已獨立驗證
- [x] `types.ts`：新增 `AgentBackend = { id, label, kind: "api" | "cli", … }`
      —— api 分支帶 `provider/model/endpoint/apiKey/localModelName/temperature`；
      cli 分支帶 `tool: "claude"|"codex"|"grok"|"pi"|"hermes"|"agy"` 與可選 `pathOverride`。放進 `AISettings.backends: AgentBackend[]`
- [x] `Employee` 加 `backendId?: string`
- [x] **相容 migration**：舊設定的單一 `model/provider/apiKey/endpoint` 讀進來時轉成清單第一筆
      `id: "default"`；`backendId` 未設的 agent 一律解析到它。**漏了這步所有既有 agent 直接壞掉**
- [x] `src/lib/agent-backend.ts`：`resolveBackend(agentId): AgentBackend`、`listBackends()`、CRUD、id 唯一性
- [x] store：`addBackend / updateBackend / removeBackend / setAgentBackend`；刪除仍被綁著的後端要擋
- [x] 測試：migration、解析回退、刪除守門、id 衝突

### W2 — 原生層（Rust）✅ 完成，主 session 已獨立驗證
- [x] `exec.rs`：`run_stdin(bin, args, stdin, timeout, max_bytes)` —— 逾時 kill、輸出截斷
- [x] `commands.rs`：`agent_cli_run(tool, prompt) -> R<String>`，白名單 `claude codex grok pi hermes agy`，
      **每個工具的旗標寫死在 Rust**；工具沒裝回 `unavailable` 形狀（不是 reject，見 BRIDGE §2）
- [x] `set_cli_path` / `probe_clis` 的 `ALLOWED` 一併加入這六個工具（目前只有 5 個舊工具）
- [x] `lib.rs` 註冊新 command
- [x] `native.ts` 加型別化入口 `agentCliRun`
- [x] **`docs/BRIDGE.md` 修訂**：§3.1 表格加六個工具與實測旗標、§3.3 那條禁令改寫成 D1 的新契約、§4 加新 action
- [x] Rust 測試：白名單拒絕未知工具、逾時真的會 kill、輸出上限真的會截斷

### W3 — 接線 ✅ 完成，主 session 已獨立驗證（`4d57b1e`）
- [x] `ai-client.chatCompletion` / `chatCompletionStream` 加 **optional** `backend` 參數，
      不傳＝現行全域行為。**其餘 6 個既有呼叫端零改動**
- [x] `ai-coach.runAgentTask` 多收 backend 並往下傳
- [x] `store.invokeAgent`：從 `agent.backendId` 解析後端；CLI 後端在瀏覽器→`ok:false` 講清楚原因；
      CLI 沒裝→`failed` 訊息帶安裝提示。**現有的落地契約（`landed: "pending"`）不准動**
- [x] 測試：兩種後端各自的成功／失敗訊息、非 native 時的守門

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
- 13:41 — 白名單定為 `claude / codex / grok / pi / hermes / agy`（六個都實測 `command -v` 找得到），
  排除 `gemini`（未安裝）與 `opencode`（Scott 未選）
- 13:23 — 選「修訂 BRIDGE.md」，排除「實作先做、文件後補」：那份文件是契約測試的依據，分岔＝測試在測舊契約

## 阻塞 / 待決議

- ~~CLI 白名單~~ — 13:41 Scott 拍板：`claude / codex / grok / pi / hermes / agy`。
  `gemini` 這台機器上根本沒裝，`opencode` 不進。**`pi` 與 `hermes` 不在 `AgentFamily` 聯集裡**，
  族系隔離閘門（同族不得審查自己家族寫的文件）會把它們一起歸進 `other` 而過度攔截 —— 要一併補進去
- ~~工作樹 dirty~~ — 13:35 已由另一個 session commit（`a7893e6` / `ab0606f`），工作樹乾淨

## W1 收貨紀錄（2026-08-26 14:12）

worktree：`.claude/worktrees/agent-a575eb39ef6951334`，**未 commit**。
改動範圍與授權完全吻合：只動 `src/data/{types,store}.ts`，新增 `src/lib/agent-backend.ts`
與兩個測試檔。零 `src-tauri/`、零 `src/pages/`、零 `ai-client`。

**主 session 自己跑的數字（不是採信 agent 的回報）：**
`bunx tsc --noEmit` exit 0；`bun test` **1884 pass / 0 fail / 92 files**。
基線 1829/90 → +55 全是新增，測試檔零刪除。

**它做的一個規格外判斷，我同意：** `default` 後端是全域 AI 設定的**投影**，不落地存進
`settings.backends`。複製會製造兩份真相 —— 使用者在設定頁換金鑰，agent 讀的是舊副本，
唯一症狀是 401，畫面上什麼都看不出來。代價是 **W4 必須讀 `store.listBackends()`，
不能讀 `settings.backends`**（後者刻意不含 default）。

## W2 收貨紀錄（2026-08-26 14:38）

W2 沒開 worktree，直接寫在主樹。改動：`src-tauri/src/{exec,commands,lib}.rs`、
`src/lib/native.ts`、`docs/BRIDGE.md`。

**白名單實測後從六個縮到四個：`claude` / `grok` / `pi` / `agy`。**
驗證方法是 canary——放一份內容已知的檔案，叫模型讀它，**吐得出原值就是沒擋住**。

| 出局 | 實測 |
|---|---|
| `codex` | `codex exec --sandbox read-only --ephemeral --ignore-user-config`（最嚴格的非互動組合）下**實際執行 `/bin/zsh -lc "sed -n …"` 並回傳 canary 原值**。`read-only` 限制寫入，不限制執行與讀取；沒有任何停用工具的旗標 |
| `hermes` | `--safe-mode -t ""` 仍讀走 canary。`-t` 是「啟用哪些 toolset」，空字串不等於清空。另外它只吃 argv，本來就違反 stdin 契約 |

**這條我自己重跑過一次**（2026-08-26 14:35，canary `CANARY-VALUE-7Q4XZ`），
codex 逐字重現：`/bin/zsh -lc "sed -n '1,200p' secret.txt"` → 回傳 canary。
不是採信 agent 的報告。

**兩個「看起來對但是 no-op」的旗標**，是「不准憑印象寫旗標」這條規矩的實證：
`grok --tools ""` 與 `grok --disallowed-tools 'Bash,Read,…'` 都**靜默失效**
（grok 內建工具名跟 Claude 那套不同，名字對不上等於沒設）。真正有效的是 `--deny '*'`。

⚠️ **`agy` 的守門不在我們手上。** 它靠 headless 模式問不了人就自動拒絕——那是
fail-closed 的**預設值**，不是鎖；使用者在自己的 `settings.json` 加 `permissions.allow`
就會被放行（驗證當下該檔不存在）。升級 agy 之後要重驗。已寫進 BRIDGE.md。

**主 session 自己跑的合併後數字：**
`bunx tsc --noEmit` exit 0；`bun test` **1884 pass / 0 fail / 92 files**；
`cargo check` 乾淨；`cargo test` **68 passed / 0 failed**。

## W3 收貨紀錄（2026-08-26 15:35 · `4d57b1e`）

前端白名單已砍成四個。`AgentFamily` 的 `hermes` 保留 —— 族系跟 CLI 白名單是兩件事。
舊存檔裡的 codex/hermes CLI 後端由 migration 整筆丟掉、agent 回退 default。

**它做的一個判斷，我同意：CLI 後端在 HTTP 層是明確拒絕，不是降級。**
`getAiReadiness(backend)` 對 `kind === "cli"` 一律 `ok:false`，兩支 chat 函式開頭就問它。
最關鍵的理由不是技術而是帳單：**使用者綁本機 CLI 的理由通常就是 API 額度用完，
靜默回退全域設定會安靜地把帳單記回去，而這種錯誤沒有畫面症狀，月底才會出現。**

另一個沒寫進規格但對的細節：`settingsFor()` 用「全域展開再覆寫」而不是憑空造一份，
所以後端沒填的 `localModelName` / `temperature` 會落回全域值 —— 否則綁一個只填 model
的後端會把 temperature 靜默重設成 0.7，症狀只有「輸出風格突然變了」。

`landed: "pending"` 的落地契約與族系隔離閘門**一個字未動**（diff 逐行確認）。
六個既有 `chatCompletion` 呼叫端零改動。

**主 session 自己跑的數字：** `bunx tsc --noEmit` exit 0；
`bun test` **1907 pass / 0 fail / 93 files**（1884 → +23，測試檔零刪除）。

## ~~前後端白名單不一致~~ —— 已解（W3）

前端 `CLI_TOOLS`（`src/lib/agent-backend.ts`）是六個，Rust 白名單是四個。
現在選 `codex` / `hermes` 會被 Rust 擋下回「不認識的 agent CLI」——**failed loud，不是靜默**，
而且 W4 的 UI 還沒做，使用者看不到。但這個狀態不能留到 W4。

要 Scott 拍板的是：前端直接砍成四個（推薦），還是保留六個並在 UI 上標示兩個「因安全實測出局」。

## 三份 CLI 清單必須一致（W3/W4 要收的線頭）

這批做完，「哪些 CLI 可以用」會同時存在三個地方：

1. `src/lib/agent-backend.ts` 的 `CLI_TOOLS`（前端六個）
2. W2 在 Rust 端的白名單（真正的守門）
3. **`src/lib/agent-handoff.ts:70` 的 `RUNNER`** —— 早就存在，且**只有四個鍵**
   （`claude / codex / gemini / other`），連 `gemini` 這台機器沒裝的都在

第 3 個是既有缺陷，W1 查到、我已獨立確認：`src/pages/tracking.ts:1521` 把較寬的
`AgentFamily` 用 `as AgentFamilyId` 硬轉進去，而 `agent-handoff.ts:153` 的
`RUNNER[input.family](prompt)` 沒有 fallback。**專案作者族系是 `grok`／`agy`／`gpt`／`local`
時，交辦當場 TypeError**；`pi`／`hermes` 讓命中面再寬兩個。這不是這批造成的，但這批讓它更容易被踩到。

另一條同類的：`normalizeAgentFamily`（`src/lib/permissions.ts:131`）只是 `family ?? "other"`，
不檢查是否真在聯集裡。手改成 `"Pi"` 會被當成合法值一路穿過去，而族系隔離用 `===` 比 ——
**這條是 fail open**（該擋的沒擋），跟 pi/hermes 那條方向相反、一樣沒有畫面症狀。

## 結束摘要

（工作結束時補上）

## W4 派工（2026-08-26 · Engineer · worktree）

額度閘門：`AgentQuota.ts` — Engineer `routable: true`（anthropic，與主 session 同池）。

**一次派兩件**：W4 UI ＋ 兩個既有地雷（`RUNNER` 沒 fallback、第三份 CLI 清單）。
合併理由：W4 讓使用者能選後端之後，`onHandoffStep` 那條被觸發的機率變高，
分兩次派會讓第二次動到第一次剛改過的檔。

### 主 session 先讀出來的事實（brief 建立在這些之上，不是回憶）

- `store.addBackend / updateBackend / removeBackend / setAgentBackend / listBackends / resolveBackend`
  在 `src/data/store.ts:3508-3625` **已完整存在且有測試**（`tests/agent-backend-store.test.ts`）。
  W4 是接線，不是再寫一層邏輯
- `updateBackend("default", …)` 已經正確地轉寫全域設定，且會拒絕 `label` 與 CLI 欄位
- `removeBackend` 已擋「仍被 agent 綁著」並回傳是誰在用
- `native.probeClis()` → `Record<string, string|null>`；`native.setCliPath(tool, path)`；
  `native.agentCliRun(tool, prompt)`（`src/lib/native.ts:352-363`）

### 這次發現的規格缺口（比 handoff 記的更精確）

**`pathOverride` 是 per-backend，但 `setCliPath` 是 per-tool 全域。**
兩個都綁 `claude` 的 CLI 後端各填一個 pathOverride，原生端只存得下一個。
`agentCliRun(tool, prompt)` 也不吃路徑。這是 W1/W2 沒對上的接縫，不是 W4 造成的。

**`RUNNER` 的 TypeError 比 handoff 寫的更廣。** `AgentFamilyId` 是四個
（`agent-handoff.ts:20`），`AgentFamily` 是十個（`types.ts:23`）。
`tracking.ts:1521` 用 `as` 硬轉，所以 `grok`/`pi`/`hermes`/`agy`/`gpt`/`local` **六個**
族系都會讓 `RUNNER[family]` 是 undefined 而當場 TypeError，不是四個。

**`RUNNER` 與 CLI 執行白名單是兩件事，不要對齊。**
`RUNNER` 產生的是給人貼進終端的字串，App 不執行它；四個工具的白名單管的是
原生 spawn。`RUNNER` 留著 `gemini` 沒有安全問題（頂多指令貼過去失敗）。
真正要修的是「總函式 ＋ fallback」，不是砍清單。
