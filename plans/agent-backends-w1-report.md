# W1 報告 — agent 後端清單的資料層

**執行者：** Engineer
**工作樹：** `/Users/scottchen/Documents/20_Projects/Project_Anchorline/.claude/worktrees/agent-a575eb39ef6951334`
**規格：** `plans/Project_Anchorline__2026-08-26-1323__agent-backends.md` §W1
**狀態：** 完成，未 commit（改動留在工作樹）
**日期：** 2026-08-26

---

## A. 改了哪些檔

| 檔案 | 動作 | 內容 |
|---|---|---|
| `src/data/types.ts` | 修改 | 新增 `AgentCliTool` / `ApiBackend` / `CliBackend` / `AgentBackend`；`AISettings.backends?`；`Employee.backendId?`；`AgentFamily` 補 `pi` / `hermes`；`AGENT_FAMILY_LABEL` 補兩筆 |
| `src/lib/agent-backend.ts` | **新增** | 純函式層：推導、收斂、解析、驗證 |
| `src/data/store.ts` | 修改 | `load()` / `importState()` 接上 migration；新增 6 個後端方法 |
| `tests/agent-backend.test.ts` | **新增** | 純函式層 32 條 |
| `tests/agent-backend-store.test.ts` | **新增** | store 面 23 條（含 2 條 F0 形狀防護） |

**沒有動**：`src/lib/ai-client.ts`、`src/lib/ai-coach.ts`、`store.invokeAgent` 的執行路徑（W3）、
任何 `src/pages/*`（W4）、`src-tauri/`（另一個 agent）。**沒有刪任何測試檔，沒有 commit / push / 開分支。**

`bun install` 跑過一次 —— 工作樹沒有 `node_modules`，不裝的話 `bun test` 會在 `yaml` 這個
相依上直接掛掉。`bun.lock` 未變動（見 `git status`）。

---

## B. migration 的實際形狀

### 核心決定：`default` 是全域設定的**投影**，不是清單裡存下來的一筆

規格寫「轉成 `backends` 的第一筆」。我實作成「**推導**成第一筆」，沒有把它寫進
`settings.backends` 落地。理由是複製會產生兩份真相：

> 使用者在設定頁改金鑰改到的是全域那份，agent 讀的是副本那份，
> 於是「我明明換了金鑰」卻仍然 401 —— 而畫面上完全看不出差別。

所以：

- `settings.backends` **只存使用者自己新增的後端**，永遠不含 `id: "default"`
- `listBackends(settings)` = `[defaultBackendOf(settings), ...migrateBackends(settings.backends)]`
- 存檔裡若混進一筆 `id: "default"`（舊格式或手改），**丟掉**，改用推導出來的那筆
- `updateBackend("default", patch)` **寫回全域設定**，不另存副本

觀察得到的行為與規格要求完全一致（清單第一筆是 default、未設 `backendId` 的 agent 解析到它），
差別只在儲存形狀。**⚠️ 給 W4 的一條**：設定頁與 agents 頁一律讀 `store.listBackends()`，
不要直接讀 `settings.backends` —— 那份不含 default。

### 解析永遠給得出一個後端

`resolveBackend` 不回 `null`。三種情況都回退到 `default`：

1. agent 不存在
2. agent 沒設 `backendId` ← **升級當下所有既有 agent 都是這個狀態**
3. `backendId` 指到一個已經被刪掉／不存在的 id

第 2 條是既有使用者升級後 agent 還能跑的唯一理由。

### 收斂規則（`migrateBackends`，吃 `unknown`）

來源是 localStorage 與匯入的備份，兩者都可以被手改。認不得的形狀**丟掉而不修補**：

| 情況 | 處理 |
|---|---|
| 不是陣列 | 回 `[]` |
| `id` 空白／超過 64 字 | 丟掉 |
| `id === "default"` | 丟掉（推導出來的） |
| `id` 重複（trim 後比較） | 只留第一筆 |
| `kind` 不是 `api` / `cli` | 丟掉 |
| `kind: "cli"` 但 `tool` 不在白名單 | 丟掉（**不修補** —— 修不成有意義的東西，留著等於白名單形同虛設） |
| `kind: "api"` 缺欄位 | 補空字串，`provider` 收斂成 `auto` |

`withMigratedBackends(settings)` 是「吃舊 settings 回新 settings」的那支，
`load()` 與 `importState()` **共用同一支**。

---

## C. store API

```
listBackends(): AgentBackend[]                       // default 一定在第一筆
resolveBackend(agentId): AgentBackend                // 永遠有答案
addBackend(b): { ok, reason? }
updateBackend(id, patch: BackendPatch): { ok, reason? }
removeBackend(id): { ok, reason? }
setAgentBackend(agentId, backendId | null): { ok, reason? }
```

**刪除守門**（規格明列的那條）：`removeBackend` 擋下仍被綁著的後端，
理由字串**逐一列出 agent 名字** —— `「後端測試 Agent 一號」、「後端測試 Agent 二號」仍在使用這個後端，請先改綁其他後端`。
靜默刪掉的話那些 agent 會留著懸空 id；解析雖然會回退（不會爆），
但使用者從此看到的是「我明明選了 X」而它走的是 API —— 那種不一致沒有錯誤訊息，只有帳單。

`default` 不可刪（它是所有回退的終點）、不可改成 CLI、不可單獨命名。

---

## D. 規格沒寫、我自己下的判斷

1. **`default` 不落地存下來**（見 §B）。規格字面是「轉成第一筆」，我改成「推導成第一筆」。
2. **`updateBackend("default", …)` 寫回全域設定。** 否則 W4 的設定頁會出現一個看得到、改不動的項目。
3. **`updateBackend` 拒絕跨 kind 的欄位**（對 CLI 後端傳 `model` 會 `ok:false`），而不是默默忽略。
   默默忽略的話 UI 接錯欄位不會有任何症狀。
4. **`id` 只擋空白／超長／保留字／衝突，不限字元集。** 使用者要用中文 id 是他的事；
   限字元集只會在 W4 製造無法解釋的表單錯誤。上限 64 字。
5. **沒設 `backendId` 的 agent 不算 `default` 的使用者**（`backendUsers` 不回傳他們）。
   他們是回退過來的，而 `default` 本來就不可刪，不必靠這支擋。
6. **`addBackend` / `updateBackend` 內部走 `migrateBackends` 收斂**，而不是自己驗一套。
   兩套驗證的症狀是「加得進去、重新載入之後消失」。
7. **`BackendPatch` 不含 `id` / `kind`** —— 兩者都不可改，要換就是刪掉重建。

---

## E. F0 反模式（「新參數只有測試在傳」）怎麼擋的

`load()` 與 `importState()` 只在模組第一次 import 時跑，測試共用同一個 process
搶不到那個時機（`tests/version-policy-reload.test.ts` 檔頭講的就是這件事）。
所以**行為測不到那兩條路**。用這個 repo 既有的 source-grep 形狀防護
（`tests/wave2-review-fixes.test.ts:386` 的同一招）補上：

- `withMigratedBackends(` 在 `store.ts` 出現次數**必須剛好 2**（兩個呼叫端，import 那行不帶括號不計）
- `importState` 內 `withMigratedBackends(` 必須寫在 `...newState` **之後**（順序反了等於沒做）

其餘 23 條 store 測試全部打的是 `store.*` 方法本身，不是純函式核心。

---

## F. 白名單與 `AgentFamily`（協調者 2026-08-26 追加）

### CLI 白名單改成六個

`AgentCliTool = "claude" | "codex" | "grok" | "pi" | "hermes" | "agy"`。
拿掉 `gemini`（這台機器沒裝）與 `opencode`（沒被選上）。
`src/lib/agent-backend.ts` 的 `CLI_TOOLS` 與 `CLI_LABEL` 同步，
測試釘住「就是這六個，不多不少」，並驗 `isCliTool("opencode") === false`。

### `AgentFamily` 補 `pi` / `hermes`

補完跑 `bunx tsc --noEmit`，**窮舉點只爆出兩處**，兩處都已補齊：

```
src/data/types.ts(896,14): error TS2739: Type '{ claude…other: string; }' is missing
  the following properties from type 'Record<AgentFamily, string>': pi, hermes
src/lib/agent-backend.ts(58,3): error TS2353: Object literal may only specify known
  properties, and 'gemini' does not exist in type 'Record<AgentCliTool, string>'
```

- `AGENT_FAMILY_LABEL`（`types.ts`）補 `pi: "Pi"` / `hermes: "Hermes"`
- `CLI_LABEL`（`agent-backend.ts`）是白名單改動連帶的，不是族系的

另外加了一條執行期測試釘 `AGENT_FAMILY_LABEL.pi` / `.hermes` ——
`Record<AgentFamily, string>` 是編譯期保護，但只要有人用 `as` 繞過去就擋不住。

### ⚠️ 兩個「靠 `default:` 吞掉」的線頭（**我沒有動，都在 W1 邊界外**）

**F-1｜`normalizeAgentFamily` 不驗證聯集，族系閘門會 fail-open。**
`src/lib/permissions.ts:131` 全文是 `return family ?? "other"` —— 它只補 null，
**不檢查值在不在聯集裡**。localStorage 或匯入的備份塞一個 `"Pi"`（大寫）進來會原樣通過，
型別上卻標成 `AgentFamily`。後果與 pi/hermes 那個洞**方向相反**：
族系隔離閘門是拿 `===` 在比，一個沒被正規化的字串跟誰都不相等，
於是閘門**不會擋**（fail-open），而不是誤擋。同樣沒有任何畫面症狀。
修法是把聯集做成 `as const` 陣列 + `includes` 收斂，一併給 `migrateProject` 的
`authorAgentFamily` 用（`store.ts:573` 目前也是裸 `as AgentFamily` 轉型）。

**F-2｜`AgentFamilyId` 是第二套、更窄的族系聯集，靠 `as` 跨接會炸。**
`src/lib/agent-handoff.ts:20` 另外定義了
`AgentFamilyId = "claude" | "codex" | "gemini" | "other"`，
而 `RUNNER` 是 `Record<AgentFamilyId, …>`，第 153 行 `RUNNER[input.family](prompt)` 直接索引、
**無 fallback**。`src/pages/tracking.ts:1521` 用
`family: (proj.authorAgentFamily as AgentFamilyId) ?? "claude"` 把 `AgentFamily` 硬轉過去 ——
`as` 讓 tsc 看不見。所以由 `grok` / `agy` / `gpt` / `local` 撰寫的專案按下交接就會
`RUNNER[…]` 拿到 `undefined` 而丟 TypeError。**這是既有 bug，不是我改出來的**，
但補 `pi` / `hermes` 讓命中面多了兩個族系。
修法：`buildHandoff` 收 `AgentFamily`，內部收斂成 `AgentFamilyId`（認不得的一律落 `other`，
那條路本來就只給 prompt 不給 runner）。`??` 在這裡也救不了 —— `as` 之後值不是 null 而是個不在 Record 裡的鍵。

兩條都建議進 W3/W4 之後的獨立一批，不要塞進這一批。

---

## G. 自己實跑的結果

工作樹狀態（`git status --short`）：

```
 M src/data/store.ts
 M src/data/types.ts
?? plans/agent-backends-w1-report.md
?? src/lib/agent-backend.ts
?? tests/agent-backend-store.test.ts
?? tests/agent-backend.test.ts
```

### `bunx tsc --noEmit`

```
TSC_EXIT=0
（零行輸出）
```

### `bun test`

```
TEST_EXIT=0
 1884 pass
 0 fail
 4456 expect() calls
Ran 1884 tests across 92 files. [1.50s]
```

**基線比對（開工前，同一個工作樹跑過一次）：** `1829 pass / 0 fail / 90 files`。
現在是 `1884 pass / 0 fail / 92 files` —— **+55 條全部是新增的，既有測試零刪除、零失敗**。
（新增 55 = 純函式層 32 ＋ store 層 23。）

> `ditto: Cannot get the real path…` 那行是 `tests/install-app.test.ts` 既有的
> stderr 噪音，基線就在，與這批無關。

---

## H. 交給下一批的介面

W3 需要的東西已經齊了，一行就接得上：

```ts
const backend = store.resolveBackend(agent.id);   // 永遠有值
if (backend.kind === "cli") { /* 走 W2 的 agentCliRun，非 native 要擋 */ }
else { /* 走既有的 chatCompletion，把 backend 當 optional 參數傳下去 */ }
```

W4 需要的：`store.listBackends()`（**不要**讀 `settings.backends`）、
`backendLabel(b)`、`backendIdError(id, list, selfId?)` 給表單即時驗證、
`store.removeBackend()` 回的 `reason` 直接就是可以顯示的中文句子。
