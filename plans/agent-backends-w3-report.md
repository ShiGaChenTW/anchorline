# W3 收貨報告 —— 前端白名單對齊 ＋ 接線

**完成時間：** 2026-08-26
**工作樹：** 主樹 `~/Documents/20_Projects/Project_Anchorline`，**未 commit、未 push、未開分支**

---

## 我自己跑出來的數字

| 指令 | exit code | 結果 |
|---|---|---|
| `bunx tsc --noEmit` | **0** | 無輸出 |
| `bun test` | **0** | **1907 pass / 0 fail / 4528 expect / 93 files** |

基線是 1884 pass / 0 fail / 92 files。**+23 pass、+1 file、測試檔零刪除。**

23 的組成（加總對得起來，不是估的）：新測試檔 `tests/agent-backend-wiring.test.ts` 21 條，
`tests/agent-backend.test.ts` 補 2 條（codex／hermes 出局、前端與 native 白名單逐字相同）。
21 + 2 = 23。

---

## 改了哪些檔

| 檔案 | 改什麼 |
|---|---|
| `src/data/types.ts` | `AgentCliTool` 六個 → 四個，補上「為什麼出局」的實測理由 |
| `src/lib/agent-backend.ts` | `CLI_TOOLS` 六個 → 四個；`CLI_LABEL` 移除 codex／hermes |
| `src/lib/ai-client.ts` | `ChatOpts.backend`；`settingsFor()` / `readinessOf()`；`getAiReadiness(backend?)`、`isAiConfigured(backend?)`；兩支 chat 函式改吃 `opts.backend` |
| `src/lib/ai-coach.ts` | 抽出 `agentTaskPrompt()`；`runAgentTask` 多收 `backend` 並往下傳 |
| `src/data/store.ts` | `invokeAgent`：`resolveBackend` 分流、非 native 守門、CLI 分支 |
| `tests/agent-backend.test.ts` | 六→四；補 2 條 |
| `tests/agent-backend-store.test.ts` | 測試夾具的 `codex` → `agy`；補「codex／hermes 現在跟 bash 同待遇」 |
| `tests/{agent-result-landing,pending-gate,workflow-skeletons,wave1-review-fixes}.test.ts` | 各補一個 `agentTaskPrompt` mock stub（理由見下） |
| `tests/agent-backend-wiring.test.ts` | **新增**，21 條 |

**沒有動：** `src-tauri/`、`docs/BRIDGE.md`、`src/pages/*`、`plans/uat-簽核流程重新設計-wave-2-實測.md`。
`ai-optimize` / `ai-interview` / `uat-format-panel` / `dashboard-optimize` / `pages/*` 那六個既有
`chatCompletion` 呼叫端**一行都沒改**。

---

## 任務 A：白名單砍成四個

`claude` / `grok` / `pi` / `agy`。`codex` 與 `hermes` 從 `AgentCliTool` 與 `CLI_TOOLS` 移除，
理由（canary 實測擋不住工具）寫進 `AgentCliTool` 的註解，指向 BRIDGE.md §3.1。

**`AgentFamily` 的 `codex` / `hermes` 保留未動**，`AGENT_FAMILY_LABEL` 也沒動 ——
族系是「這個 agent 是哪一家的」，CLI 白名單是「這台機器可以生出哪些子行程」。
`tests/agent-backend.test.ts` 原有的「pi 與 hermes 有自己的族系標籤」那條仍然綠。

**收窄的副作用（我自己判斷、規格沒寫）：** 舊存檔裡 `tool: "codex"` 的 CLI 後端，
`migrateBackends` 會**整筆丟掉**（`isCliTool` 不認得），綁著它的 agent 依 `resolveBackend`
既有的回退規則落回 default。我選丟掉而不是保留：留著一個原生端一定會拒絕的選項，
只是把失敗延到使用者按下去之後。已補測試釘住這個行為。

---

## 任務 B：接線

**1. `ai-client`** —— `backend` 放進 `ChatOpts` 而不是多一個位置參數。
`chatCompletionStream` 的 opts 已經在第五位，再往後接會讓只想指定 backend 的呼叫端被迫寫
`undefined, undefined`；放進 opts 則兩支簽名一致，而且既有呼叫端零改動。
`settingsFor(backend?)` 不給就回全域設定（既有行為），給 API 後端就用
「base 展開再覆寫六個欄位」—— 展開而不是憑空造，是為了讓後端沒填的
`localModelName` / `temperature` 落回全域值，否則綁一個只填 model 的後端會把全域
temperature 靜默重設成 0.7。

**2. `ai-coach`** —— `runAgentTask(opts & { backend? })`，往下傳進 `chatCompletion`。
另外把提示詞抽成 `agentTaskPrompt()` 並匯出。抽出來不是為了整潔，是**防分岔**：
CLI 那條路如果自己拼一份 prompt，兩邊會慢慢長歪，症狀是「同一個 agent 換個後端講的話不一樣」，
沒有錯誤訊息、只會被當成模型差異。

**3. `store.invokeAgent`** —— 用 `resolveBackend(agent.id, state.employees, state.settings)` 取得後端
（**沒有讀 `settings.backends`**），插在所有既有閘門**之後**、建立工作單**之前**。

---

## 五個硬條件逐條回覆

**1. `landed: "pending"` 沒被動。** `mark()` 一個字都沒改，CLI 成功路徑走的就是
`mark("done", text)`，落地仍由 `saveAgentResult` / `discardAgentResult` 拍板。
測試逐字比對 `sectionValues` / `projectSectionValues` / `comments` 三份快照，
API 與 CLI 兩條路各驗一次。

**2. 瀏覽器沒有 CLI，回 `{ ok: false, reason }`。** 訊息帶得出後端顯示名、
「需要桌面版 App」、以及兩條下一步（換桌面版／改綁 API 後端）。
**而且連工作單都不開** —— 這個判斷跟輸入無關、跟環境有關，跑之前就知道答案，
開一張注定失敗的工作單只會在歷史裡留一筆假的嘗試紀錄。測試同時驗
「回 ok:false」「jobs 數量不變」「原生橋一次都沒被碰」。

**3. CLI 沒裝走 `mark("failed", …)`。** `isUnavailable(res)` 判斷後直接 `mark("failed", …)`，
**刻意不 throw** —— throw 會被下面的 catch 包成通用的「進場失敗：<訊息>」，
而使用者需要知道的是要裝什麼、去哪裡指定路徑。訊息含工具名、原生端的原始訊息、
`PATH`、安裝提示、以及改綁 API 後端的退路。測試驗 `status === "failed"` 且
`landed === undefined`（失敗的工作單不進待落地狀態）。

**4. 串流與 jsonMode —— 我選「明確拒絕」，不是降級。**

理由：降級要嘛是「等 CLI 跑完再一次 `onDelta` 全文」，要嘛是「jsonMode 靜默忽略」。
前者騙得過畫面卻騙不過使用者的判斷 —— 串流存在的理由是「證明系統在動、方向不對
可以提早喊停」，一次吐完這兩件事都沒有，等於留一個看起來有在動的假指標。
後者則是把「這條路做不到 provider 層級 JSON」變成下游解析器的隨機失敗。

實作上不是在每個入口各擋一次，而是**讓 CLI 後端根本進不了 HTTP 層**：
`getAiReadiness(backend)` 對 `kind === "cli"` 一律回 `ok: false`，
`chatCompletion` / `chatCompletionStream` 兩支開頭都問它，於是三種組合
（串流、jsonMode、一般呼叫）都在發出任何請求之前 throw `AiError("not_configured")`。

還有一個沒被要求但我認為更重要的理由：**不能靜默回退到全域設定**。
使用者綁本機 CLI 的理由通常就是 API 額度用完，回退會安靜地把帳單記回去 ——
這種錯誤沒有畫面症狀，只會在月底出現。所以是拒絕，不是回退。
測試把 `fetch` 換掉並數次數，三條各驗「throw」＋「fetch 呼叫次數為 0」，
串流那條額外驗 `onDelta` 一次都沒被呼叫。

**5. 族系隔離閘門沒鬆動。** 那段程式碼一個字都沒改，而且新的後端解析與非 native 守門
**插在它之後**。測試在瀏覽器與桌面版兩種環境各驗一次同族審查仍被擋，
比對的是理由本身（`不可再擔任審查`）而不只是 `ok === false` ——
特別確認桌面版那條不會變成「需要桌面版 App」，也確認原生橋一次都沒被碰到。

---

## 兩個已知陷阱

**`default` 是投影。** 全程只走 `resolveBackend()` / `store.listBackends()`，
沒有任何一行讀 `settings.backends`。測試驗「改了全域金鑰，`runAgentTask` 收到的
default 後端 `apiKey` 跟著變」。

**「新參數只有測試在傳」（F0）。** 這是我花最多力氣防的一條。
測試不驗「`runAgentTask` 收不收得下 backend」——那是型別的事，加了參數沒人傳在型別上
完全合法。改成**攔住 `runAgentTask` 去看 `store.invokeAgent` 到底傳了什麼**：
沒設 `backendId` 的 agent 必須收到 `id: "default"` 且 `apiKey` 是當下的全域金鑰；
綁自訂 API 後端的 agent 必須收到那一筆而不是全域那份。兩條都是對生產呼叫端的斷言。

---

## 規格沒寫、我自己下的判斷

1. **`backend` 放進 `ChatOpts` 而不是新增位置參數** —— 理由見上（串流那支簽名）。
2. **抽出 `agentTaskPrompt()` 讓兩條通路共用提示詞** —— 規格說 store 走
   `native.agentCliRun(tool, prompt)` 但沒說 prompt 從哪來。自己拼一份會分岔。
3. **CLI 的 stdin 內容是 `${system}\n\n---\n\n${user}`** —— `agent_cli_run` 只有一條 stdin，
   沒有 system／user 兩個角色。分隔線是給模型看的排版，不是格式契約。
4. **CLI 跑完沒有輸出 → `failed`** —— 規格沒提。標 done 會留一張沒東西可存的待落地工作單。
5. **`res.truncated` 時在結果尾端附「（輸出超過原生端上限，已截斷）」** ——
   不講的話下游只會看到「內容怪怪的」然後去查模型。沿用 Anthropic `max_tokens` 那條的既有做法。
6. **API 路的失敗訊息改成帶後端顯示名**（原本寫死「尚未設定 API Key」），
   並且問的是 `isAiConfigured(backend)` 而不是全域 —— agent 綁了一個沒填金鑰的後端時，
   全域那份填得再完整也不該讓它跑起來然後拿 401 回來。
7. **舊存檔的 codex／hermes CLI 後端整筆丟掉**（見任務 A）。

---

## 一個踩到的坑，值得留紀錄

改完第一次跑全批，4 條紅、單檔跑全綠 —— 正是這個 repo 檔頭警告過的那種失敗。

原因：`mock.module` 在 bun 是全域的，`agent-result-landing` / `pending-gate` /
`workflow-skeletons` / `wave1-review-fixes` 四份都 mock 了 `../src/lib/ai-coach`，
而它們的 mock 只有 `{ isAiConfigured, runAgentTask }`。W3 讓 `invokeAgent` 的 CLI 分支
多用了一個 `agentTaskPrompt`，於是誰最後註冊誰生效，CLI 那條路就炸在
`agentTaskPrompt is not a function`。

修法是四份各補一個**回傳值逐字相同**的 stub（沿用這個 repo 對 `AGENT_OUTPUT` 已有的同一條約定），
並在註解裡寫明「五個 mock 這份必須逐字相同」。

我新增的那份 `ai-coach` mock 也刻意做成既有四份的**超集**：`runAgentTask` 回同一個
`AGENT_OUTPUT` 字串、`isAiConfigured` 一樣恆真，只是額外攔下 `backend`。
`native` 那份 mock 同理是**整份透傳**（先把真模組快照起來再展開，只換 `isNative` 與
`agentCliRun` 兩個鉤子，預設值等同真實環境）—— 給部分物件的話，別的測試檔一呼叫
`native.writeExport` 就炸在 undefined，而那種失敗同樣只在整批跑時出現。

---

## 我沒做的事

- **實機 UAT 沒跑。** CLI 通路的真實行為（真的 spawn `grok` / `claude` / `pi` / `agy`）
  在 `bun test` 裡驗不到，那需要桌面版 App。UAT 題目尚未產出。
- **W4 的 UI 沒動。** 設定頁兩張清單、agents 頁的後端下拉都還沒有，
  所以現在**使用者沒有任何介面可以建立 CLI 後端或綁定它** —— 這批的能力要等 W4 才看得到。
- **`agent-handoff.ts:70` 的 `RUNNER` 那個既有缺陷沒修**（第三份 CLI 清單、
  `RUNNER[input.family]` 沒有 fallback 會 TypeError）。那不在 W3 授權範圍內，
  但它仍然是開著的，而且這批讓 `pi` / `hermes` 族系更容易被建出來。建議排進 W4 或另開一批。
