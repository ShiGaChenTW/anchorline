# Wave 2 規格 — 簽核流程重新設計的三個 UI

- 母規格：`plans/Project_Anchorline__2026-08-25-2325__signoff-redesign.md`
- 冷啟動：`plans/handoff-main-session__2026-08-26__signoff-redesign.md`
- 開立：2026-08-26 · PM：Miles（主 session，不寫 code）

## Scott 這一輪拍板的三件事

| # | 問題 | 決定 |
|---|------|------|
| S1 | F3-2「鎖定後不得落地」的陷阱 | **擋在結案那一端**：還有 pending 工作單時不讓案子鎖定，結案前先逼使用者把每一份分析拍板成 saved 或 discarded。把陷阱拆掉，不是解釋陷阱 |
| S2 | 指派對話框何時出現 | **只在第一次落地流程時**。已落地的重送審直接送，改派走簽核頁的 `reassignCaseStage`（那條路會留紀錄） |
| S3 | W2-C 範圍 | **做完整檢視＋編輯** |

## W2-0 — 共用地基（先做，A/B 都靠它）

### `src/lib/ask.ts` 加 `askCustom`

W2-A 要「逐關一個下拉」，W2-B 要「全文＋結論＋三顆按鈕」。兩者都不是
confirm/text/alert，但**都必須沿用這支的 dialog lock、focus trap、Escape、
以及「對話框開著時頁面熱鍵不外流」** —— 那四件事正是 8/16 那批修掉的東西，
另外手刻兩個 modal 等於把它們重新犯一遍。

```ts
export interface AskCustomOptions extends AskOptions {
  /** 對話框內容 HTML。呼叫端自己負責 escape */
  bodyHtml: string;
  /** 第三顆按鈕（例如「不採用」）。按下時 action = "extra" */
  extraLabel?: string;
  extraDanger?: boolean;
  /** 對話框掛上 DOM 之後呼叫一次，用來綁事件／設預設值 */
  onMount?: (root: HTMLElement) => void;
  /** 按下確認時從 DOM 讀出結果。只有 action === "confirm" 會呼叫 */
  read?: (root: HTMLElement) => unknown;
}
export async function askCustom(
  opts: AskCustomOptions,
): Promise<{ action: "confirm" | "cancel" | "extra"; value?: unknown }>;
```

硬條件：
- 走現有 `openDialog` 的同一條路，**不要複製一份 DOM 骨架**。`openDialog` 已經
  是 kind 分派，加一個 `"custom"` kind 即可
- `bodyHtml` 內若含 `<select>` / `<textarea>`，`trapFocus` 的選擇器已涵蓋，不用改
- `danger` 時 Enter 不確認的既有規則保留；**custom kind 一律不讓 Enter 觸發確認**
  （裡面有 select，Enter 是選單的按鍵，不該同時送出整個對話框）
- 併發鎖與 `releaseDialogLock` 的時機比照現有三支
- 純函式部分（`mapOutcome` 的 custom 分支、labels）要能在 headless bun test 下測到

### store 端：pending 工作單的查詢與閘門（S1）

1. 新增查詢（純讀，不改 state）：
   ```ts
   pendingAgentJobs(projectId: string): AgentJob[]
   ```
   回傳該專案**綁了關卡**、`status === "done"`、`jobLanded(j) === "pending"`
   且 `result.trim()` 非空的工作單，新到舊。

2. `approveAndLock` 與 `skipStage`：**這一步會讓 `allDone` 變 true 時**，
   若 `pendingAgentJobs(project.id).length > 0` → **不簽、不鎖**，回傳
   ```ts
   { ok: false, reason: "還有 N 份 Agent 分析沒拍板 —— 結案後就永遠落不了地了", pendingJobs: N }
   ```
   閘門放在**算出 nextStages、判斷 allDone 之後、寫進 state 之前**。
   不是 allDone 的簽核照常放行 —— 中途簽一關不該被擋。

3. 為什麼閘門在 store 而不是只在 UI：`skipStage` 與 `approveAndLock` 是兩條路，
   只擋 UI 的話另一條會靜默走過去。UI 那一層負責把這個 reason 變成
   「現在就處理」的對話框，不是只 toast 一句。

## W2-A — 編輯台送審前的關卡指派對話框

檔案：`src/pages/editor.ts`（`btn-submit` handler，約 1338 行）、`src/data/store.ts`

### 為什麼一定要有

五類骨架的 `defaultAssigneeId` **全部是 `null`**（`seed.ts:365+`）。
所以現在第一次送審落地下來的關卡，`caseFromWorkflow` 會全部給
`state: "empty"` / `assigneeName: "待指派"` —— 一個沒有任何人在上面的流程。
Wave 1 備好的 `assignments` 參數就是為了補這個洞，而 `editor.ts:1372`
目前只傳兩個參數。**這是 Wave 1 F0 那個失敗模式的同一形狀，只是還沒發生。**

### store 新增：`submitPlan`

UI 需要知道「這次送審會不會建立關卡、會建哪幾關」，而那個判斷目前埋在
`submitForReview` 裡（`project.workflowStages` → `touched`(`caseHasRun`) → `resolveWorkflowFor`）。
**不要在 UI 重寫一份那個判斷** —— 兩份判斷會分岔，而症狀是「對話框問了指派，
送審卻沒套用」。抽一支共用的：

```ts
submitPlan(projectId?: string): { landsNow: boolean; stages: WorkflowStageDef[] }
```
- `landsNow: true` ⇔ `submitForReview` 這一次會走 `caseFromWorkflow`
  （即 `!touched`），也就是 `assignments` 真的會生效的那一次
- `stages` = 那一次會用的 `landed` 陣列
- `submitForReview` 自己也改用這支算，**兩邊共用同一段判斷**（這是重點，
  不是順手重構）

### 對話框

`landsNow === false` → **完全不開對話框**，維持現行行為直接送審（S2）。

`landsNow === true` → 開 `askCustom`：

- 標題：`送出審閱前，先決定每一關派給誰`
- 副標：`這份流程是照「<範本分類>」骨架加上領域包算出來的，送出後就跟著這個案子走。之後要改人請到簽核頁改派。`
- 每一關一列，顯示：`order`、關卡名、`kind` 標籤（`review`→「審閱」／`edit`→「改稿」）、
  `required === false` → 「非必簽」、`mode`（串行／並行）
- **`edit` 關卡要多一行警語**：`這一關存檔時會整段覆寫「<editTarget 的欄位中文名>」`
  （`editTarget` 缺值時寫「開放問題」）。使用者在指派的當下就該知道哪一關會動內文
- 每一列一個 `<select>`：
  - `— 不指派 —`（value `""`，對應 `assignments[id] = null`）
  - `我（<currentUser.name>）`
  - 其餘 `active !== false` 的 employees，agent 與人分成兩個 `<optgroup>`
- 預設選取：`defaultAssigneeId` 有值就用它；否則依 `defaultActor` ——
  `human` → `currentUser.id`，`agent` → 第一個 `active !== false` 且 `kind === "agent"` 的 employee；
  都找不到 → 不指派
- 按鈕：確認 = `送出審閱`，取消 = `取消`
- 取消 → **不 commit、不送審**，toast `已取消送審`

### 順序（重要）

現行 handler 是：未存檔確認 → gate 檢查 → `commitForReview` → `submitForReview`。
指派對話框放在 **gate 檢查之後、`commitForReview` 之前**。
放在 commit 之後的話，使用者一按取消就留下一個沒人要的 commit 版本。

### 交出去的東西

`store.submitForReview(undefined, commit.version!.id, assignments)`。

## W2-B — 簽核頁的 Agent 結果 pop-up

檔案：`src/pages/signoff.ts`、`src/data/store.ts`（S1 閘門）

### 現況

`signoff.ts:358` 呼叫 `invokeAgent`，跑完的結果目前**只**用 `stageAnalysis()`
在關卡列下面攤成一個 `<details>` 全文。`saveAgentResult` / `discardAgentResult`
在 `src/pages/` **零呼叫端** —— 也就是 Wave 1 做的「人拍板才落地」在 App 裡按不到。

### 要做的

1. **跑完自動跳窗。** 關卡上的工作單從 `queued`/`running` 變成 `done`
   （且 `jobLanded === "pending"`、`result` 非空）時，自動開一次 pop-up。
   同一張工作單只自動開一次（記 jobId，別在每次 `render()` 都重開）。
2. **手動再開。** 未拍板的工作單在關卡列上留一顆「查看結果」，按了重開同一個窗。
3. **pop-up 內容**（用 `askCustom`）：
   - 標題：`<agentName> 的分析 — 關卡「<stage.name>」`
   - 結論徽章：沿用 `analysisVerdict(job.result)`（建議核准／建議修改／無明確結論）
   - **全文**，`<pre>` 可捲動，`escapeHtml`
   - **`edit` 關卡必須顯示現值 vs 新值兩欄**（規格 ⚠️ 硬條件 1）：
     左欄 = `state.projectSectionValues[pid][sectionId][fieldKey]` 的現值
     （空的話寫「（目前是空的）」），右欄 = `job.result`。
     並寫死一行紅字：`存檔會把左邊整段換成右邊，不是合併。`
     欄位標題用 `editTarget` 對應的中文名（查得到就用，查不到就顯示 id）
   - `review` 關卡只顯示全文，並保留現有那句「這是 Agent 的建議，不是簽章」
   - 按鈕三顆：確認 = `存進文件`（`edit`）／`存到這一關`（`review`）；
     extra = `不採用`（`extraDanger: true`）；取消 = `稍後再決定`
4. **接回 store**：確認 → `saveAgentResult(job.id)`；不採用 → `discardAgentResult(job.id)`；
   取消 → 什麼都不做（工作單留在 pending）。兩支都回 `{ok, reason}`，
   失敗一律 `toast(reason)`，成功後 `render()`。
5. **關卡列的顯示改掉**：
   - `landed === "pending"` → 顯示「待拍板」徽章 + 「查看結果」鈕，**不**攤開全文
     （全文在 pop-up 裡看；列上同時攤一份會讓「還沒拍板」看起來像已經生效）
   - `landed === "saved"` → 顯示 `CaseStage.agentResult`（`review` 關卡）
     或「已寫入〈欄位名〉」（`edit` 關卡）
   - `landed === "discarded"` → 一行灰字「這份分析未採用」+ 可展開全文。
     **全文留著**是 `discardAgentResult` 的設計意圖，別在 UI 把它藏掉
6. **S1 的結案攔截**：`approveAndLock` / `skipStage` 回傳 `pendingJobs > 0` 的失敗時，
   不要只 toast。開一個對話框：`還有 N 份分析沒拍板，結案後就存不進去了`，
   列出那 N 張（agent 名 + 關卡名 + 結論徽章），每張一顆「查看」；
   使用者逐一拍板完，再按原本那顆簽核鈕。

### 硬條件

- `askCustom` 的 `bodyHtml` 一律 `escapeHtml`，agent 全文是外部輸入
- 自動跳窗**不得**在 dialog 已開時觸發（`isDialogOpen()` 檢查），
  否則 `askCustom` 會 throw「已有對話框開啟」

## W2-C — 管理中心：簽核流程檢視與編輯

檔案：`src/pages/admin.ts`、`src/data/store.ts`、對應的 admin HTML

現況：`admin.ts:213–295` 已經有全域 `workflowStages` 的完整編輯器，但它
**看不到也改不到 Wave 1 新加的三個欄位**（`kind` / `defaultActor` / `editTarget`），
而且完全不知道五類骨架與專案落地流程的存在。

### C-1 · 既有全域關卡編輯器補三個欄位

每一列加：
- `kind` 下拉：`審閱（只出意見）` / `改稿（會改 PRD 內文）`
- `defaultActor` 下拉：`Agent` / `我`
- `editTarget`：**只在 `kind === "edit"` 時出現**，兩個下拉（章節 / 欄位），
  選項來自現有章節定義；不選 → 存成 undefined（落地時退回「開放問題」）
- 存檔一併帶進 `store.updateWorkflowStage`

### C-2 · 五類範本骨架的檢視與編輯

新增一塊「PRD 範本的簽核骨架」，五個分類（lean / narrative / enterprise /
agile / technical）各一個可收合區，內容用 C-1 同一套列元件。

store 新增：
```ts
workflowSkeletons(): Record<FullCat, WorkflowStageDef[]>   // 目前生效的（覆寫優先，否則 seed）
setWorkflowSkeleton(cat: FullCat, stages: WorkflowStageDef[]): { ok: boolean; reason?: string }
resetWorkflowSkeleton(cat: FullCat): void                   // 還原成 seed
```
- 覆寫存在 `AppState.workflowSkeletons?: Partial<Record<FullCat, WorkflowStageDef[]>>`，
  跟其他 state 一樣進 localStorage
- `resolveWorkflowFor` 改讀 `workflowSkeletons()` 而不是直接讀 `SEED_WORKFLOW_SKELETONS`。
  **`resolveWorkflow` 那支純函式的第三個參數就是為此留的，不要改它的簽名**
- `setWorkflowSkeleton` 要擋：關卡陣列為空 → 拒絕；`hasHumanApproval()` 為 false →
  拒絕並回 `"骨架一定要留一關由人核准 —— 少了它，這一類 PRD 就再也沒有人簽過"`
- 每一類旁邊標「目前有 N 個專案落地了這一份」與一句
  **「改這裡只影響之後第一次送審的專案。已經落地的案子不會重算（D2）。」**

### C-3 · 專案落地流程的檢視

新增一塊「各專案已落地的流程」：列出所有 `project.workflowStages` 有值的專案，
可展開看它那一份關卡（**唯讀**）。每個專案一顆「重新套用範本」：
- `askConfirm({ danger: true })`，文案講清楚**會清掉這個案子既有的簽核狀態**
- 只有 `accessRole === "admin"` 看得到
- store 新增 `reapplyWorkflow(projectId): { ok, reason? }`：
  案子 `locked` 或 `withdrawn` → 拒絕；否則清掉 `project.workflowStages`，
  下次送審重新解析。**不要順手把個案的 stages 也砍掉** ——
  那是 `submitForReview` 的 `touched` 判斷要處理的事

## 驗收（每一波都要）

- `bunx tsc --noEmit` exit 0
- `bun test` 全綠，基準 **1612 pass / 82 files**，不得退步、不得刪測試換綠
- 新增測試至少要蓋到：
  - `askCustom` 的 lock / outcome 語意（headless，純函式層）
  - `submitPlan` 的三條分支（已落地 / 跑過但沒落地 / 全新）
  - **`editor.ts` 真的有把第三個參數傳進 `submitForReview`**
    （Wave 1 F0 的教訓：新參數只有測試在傳。用 `templateWorkflowArg()` 那招——
    抽一支生產端與測試端共用的函式，讓測試驗得到生產呼叫端存不存在）
  - `pendingAgentJobs` 的篩選條件、以及 allDone 時被閘門擋下 / 非 allDone 時放行
  - `setWorkflowSkeleton` 的兩條拒絕路徑
- **不要為了讓測試綠而改測試的斷言。** 測試改了就要在回報裡逐條說明改了什麼、為什麼

## 進度

- [~] W2-0 共用地基
  - [x] `askCustom`（2026-08-26 · W2-A agent）—— `openDialog` 加 `"custom"` kind，
        沿用同一個 dialog lock／focus trap／Escape／熱鍵隔離
  - [x] `pendingAgentJobs` + 結案閘門（2026-08-26 · W2-B agent）—— 篩選條件抽成
        `types.pendingAgentJobsOf` 純函式，store 與簽核頁共用；閘門放在
        `approveAndLock` **與** `skipStage` 兩條路上
- [x] W2-A 送審指派對話框（2026-08-26；`bunx tsc --noEmit` exit 0、
      `bun test` 1651 pass / 0 fail / 83 files，基準 1612/82 → +39 測試、零退步、
      `bunx vite build` 成功。**未 commit**，交 PM 驗）
- [x] W2-B Agent 結果 pop-up（2026-08-26；`bunx tsc --noEmit` exit 0、
      `bun test` **1695 pass / 0 fail / 85 files**，基準 1651/83 → +44 測試、零退步、
      `bunx vite build` 成功。**未 commit**，交 PM 驗）
- [x] W2-C 管理中心流程檢視／編輯（2026-08-26；`bunx tsc --noEmit` exit 0、
      `bun test` **1739 pass / 0 fail / 86 files**，基準 1695/85 → +44 測試、零退步、
      `bunx vite build` 成功。**另做了實機驗證**（Interceptor 開真 Chrome 跑過
      C-1 存檔往返與 C-2 兩條拒絕路徑，見筆記）。**未 commit**，交 PM 驗）
  - [x] C-1 全域關卡編輯器補 `kind` / `defaultActor` / `editTarget`
  - [x] C-2 五類骨架檢視與編輯（覆寫進 `AppState.workflowSkeletons`）
  - [x] C-3 專案落地流程唯讀檢視 + admin 專屬「重新套用範本」
- [ ] 跨 context 審查（Cato / Forge）
- [ ] 實機 UAT 出題

---

## W2-A 實作筆記

> 2026-08-26 · 實作者：Engineer（子代理）。記下**補的決定**與**與規格的落差**。
> 未 commit、未 push，交 PM 驗。

### 規格沒講、實作時補的決定

1. **`mapOutcome` 的 custom 分支多收一個參數。** 原簽名是 `(kind, outcome, raw?)`，
   `raw` 是文字輸入框的值。custom 的結果來自呼叫端的 `read(root)`，跟 `raw`
   不是同一件事，硬塞進 `raw` 會讓 `askText` 的空字串語意跟 custom 的 value
   共用一個位置。改成 `(kind, outcome, raw?, customValue?)`，兩者各走各的。
   既有三個 kind 的回傳值逐字不變（有測試釘：`custom 的 value 不會漏進其他 kind`）。

2. **custom 的預設焦點給內容區第一個 `select`／`textarea`／`input`，不是「確認」鈕。**
   規格只說「Enter 不確認」。但焦點停在確認上的話，一份**沒動過的預設指派**
   看起來像已經填完了 —— 而預設值是系統猜的，不是使用者選的。這一條沒有自動化
   覆蓋（需要 DOM），列進 UAT。

3. **`onMount` 在預設焦點之後才呼叫。** 這樣呼叫端要改焦點時它的決定會贏。
   W2-A 自己沒用到 `onMount`（預設值直接以 `selected` 屬性烘進 HTML），
   但 W2-B 的三顆按鈕 pop-up 可能會用到，順序先定死。

4. **`buildAssignments` 會檢查 `defaultAssigneeId` 指到的帳號還在不在、有沒有停用。**
   規格只說「`defaultAssigneeId` 有值就用它」。指到停用帳號時照用的話，那一關
   會派給一個永遠不會動它的人。改成退回依 `defaultActor` 猜。

5. **停用的 agent 不算「第一個 agent」。** 同上，規格寫的是「第一個 `active !== false`
   且 `kind === "agent"`」，實作照做，但這條在測試裡單獨釘了一次，因為
   `active` 省略要視為啟用（既有資料的形狀），寫成 `e.active === true` 就會全滅。

6. **`editTargetLabel` 查不到欄位時顯示 `sectionId.fieldKey`，不猜一個名字。**
   規格說「查得到就用，查不到就顯示 id」。這裡把「`editTarget` 缺值」與
   「`editTarget` 有值但章節被刪掉」分成兩條：前者寫「開放問題」（跟
   `saveAgentResult` 的退路是同一個欄位），後者顯示 id。混在一起的話，
   一個指向已刪章節的關卡會顯示「開放問題」—— 而它存檔時其實會寫到別的地方。

7. **`FULL_CAT_LABEL` 新開一份，沒有複用 `templates.ts` 的 `CAT_LABEL`。**
   後者是頁面私有的、而且含七個章節分類。副標只需要五類整份範本的名字，
   從頁面往外匯出會把 `templates.ts` 變成別人的依賴。

8. **CSS 新增 `.assign-*` 一組（`shared.css` 檔尾 47 行）。** 規格沒提樣式。
   清單掛 `max-height: 46vh` + 自己的捲軸，不讓整個 modal 捲 —— enterprise
   五關加領域包時，捲整個 modal 會讓「送出審閱」鈕掉出視窗外。

### 實作時發現、自己的測試抓到的一個 bug

`assignOptionGroups` 第一版用 `e.id !== me?.id` 排除目前使用者。目前使用者被停用時
`me` 是 `null`，`me?.id` 是 `undefined`，等於**沒排除** —— 一個不能被指派的人
反而出現在「人」那一組裡。改成比 `currentUser?.id`。
（測試：`目前使用者被停用時不出現在「我」，也不漏到 humans`）

### 與規格的落差 / 沒做的事

- **規格說「`landsNow === false` → 完全不開對話框」，實作多加了一個條件**：
  `plan.stages.length === 0` 時也不開。空流程的對話框是一個沒有任何一列的空窗，
  按確認送出一個空的 `{}`。這種專案理論上不存在（五類骨架都至少兩關），
  但 `resolveWorkflow` 的自訂範本路徑（`Template.stages`）給得出空陣列。
- **`askCustom` 的 `extraLabel` / `extraDanger` / `onMount` 三個欄位 W2-A 沒有用到**，
  依規格實作並在 `mapOutcome` 層測了三態語意，但**沒有 DOM 層的測試**
  （這個 repo 不為單一檔案引入 happy-dom）。真正按下「不採用」的路徑要等 W2-B
  接上才會被走到，UAT 要涵蓋。
- **沒做實機 UAT。** 對話框的 DOM 行為（焦點、Escape、Tab trap、Enter 不送出、
  select 展開時的鍵盤）零自動化覆蓋，全部要靠實機。建議 UAT 題目：
  1. 全新專案第一次送審 → 對話框出現，每一關預設已選好人（不是「不指派」）
  2. 對話框內按 Enter → **不得**送出（裡面有 select）
  3. 按取消 → 不送審、不留下新版本快照（去版本清單確認）
  4. enterprise 專案 → 「文件補完」那一列有黃色警語且指名欄位
  5. 改幾關的指派後送出 → 簽核頁上顯示的是改後的人
  6. 已送過審的專案再送一次 → **不**跳對話框，直接送出
  7. Tab 在對話框內循環、Escape 關閉且不觸動背後頁面的熱鍵

### 沒碰的東西（另外兩批的地盤）

`src/pages/signoff.ts`、`src/pages/admin.ts`、`pendingAgentJobs`、
`saveAgentResult`、`discardAgentResult`、`approveAndLock`、`skipStage` 全部未動。

---

## W2-B 實作筆記

> 2026-08-26 · 實作者：Engineer（子代理）。記下**補的決定**與**與規格的落差**。
> 未 commit、未 push，交 PM 驗。

### 交付前實跑的輸出

```
bunx tsc --noEmit   → exit 0
bun test            → 1695 pass / 0 fail / 3953 expect / 85 files（基準 1651/83）
bunx vite build     → ✓ built in 899ms
git diff --stat     → 7 檔 +423/-36，另新增 3 個未追蹤檔
                      （src/lib/agent-result.ts、tests/agent-popup.test.ts、
                        tests/pending-gate.test.ts）
```

### 規格沒講、實作時補的決定

1. **`pendingAgentJobs` 的篩選條件抽成純函式住在 `types.ts`。**
   規格說「store 新增查詢」。照字面做的話，`landed` 欄位缺失（升級前的舊工作單）
   與空結果這兩條分支**用公開 API 造不出來** —— store hydrate 時的移轉就會把舊單
   補成 `saved`，而 `invokeAgent` 的模型輸出是 mock 給的固定字串。那兩條分支會
   變成只有註解、沒有測試。改成 `types.isPendingAgentJob` / `pendingAgentJobsOf`
   純函式，store 只負責把 state 交給它。放 `types.ts` 而不是新 lib 是因為它是
   `jobLanded` 的鄰居而且零依賴 —— 放 `lib/agent-result.ts` 會把 `ui.ts`
   拉進 store 的相依圖。

2. **`jobLanded(j) === "pending"`，不是 `j.landed === "pending"`。**
   這是整批最容易寫錯的一行，測試單獨釘了一次。舊工作單沒有 `landed`，
   `jobLanded` 算它們 `saved`。直接比欄位的話那批舊單全變成擋門的幽靈，而且
   **永遠拍不掉**（`saveAgentResult` 對它們回「已經存過了」），案子再也結不了。

3. **閘門擋下時「完全沒發生」。** 規格說「不簽、不鎖」。實作把閘門放在
   `nextStages`／`allDone` 都算完之後、寫進 state 之前，所以連「簽了一半」都
   不會留下。測試對 `cases[pid]` 做**逐字**比對，不是只看 `locked`。
   代價：`approveAndLock({})`（不帶 stageIds、一次簽掉所有簽得動的）被擋時，
   那幾關的簽章一起退掉。這是對的 —— 部分寫入會讓使用者下一次按下去時面對
   一個他沒印象簽過的狀態。

4. **`skipStage` 的閘門在內建骨架裡打不到，但還是要放。**
   `allStagesSettled` 只看必簽關卡，所以略過一個非必簽關卡**永遠**不會把
   `allDone` 從 false 翻成 true。真正打得到的形狀是「整份流程都是非必簽」——
   那時 `allStagesSettled` 回 `stages.length > 0`，略過就結案。
   prod 種子的「法務」正是 `required:false`，不是假想形狀。測試用
   `setWorkflowStages` 組了這份流程來實測，並在 `afterAll` 還原全域流程
   （store 是跨檔共用的單例，不還原會污染別的測試檔）。

5. **`edit` 關卡的退路收斂成 `types.resolveEditTarget`。**
   `editTarget` 省略時退回「開放問題」原本在 `store.saveAgentResult` 寫死一份、
   `submit-assign` 的警語寫死一份，而 W2-B 的前後對照會是第三份。三份分岔的
   症狀是最惡劣的一種：指派時的警語說會覆寫 A 欄、pop-up 左欄顯示 A 欄的現值、
   而存檔寫進 B 欄 —— 三個畫面各自都「對」，只有文件是錯的。

6. **pop-up 左欄的現值讀 `projectSectionValues[pid]`，不是 active 的 `sectionValues`。**
   簽核頁看的專案不一定是編輯台當下開著的那個。拿 active 那份會顯示**別的專案**
   的內容當「現值」，而使用者要據此決定要不要覆寫。

7. **關卡名用 `store.sectionsFor(p.id)` 查，不是 `st.sections`。** 同上理由：
   不同專案的骨架不一樣，欄位中文名會查到另一份骨架的。

8. **「查看結果」鈕帶 jobId 而不是 stageId。** 同一關重跑過好幾次，待拍板的是
   **某一張工作單**，不是那一關。

9. **`cancelled` 的工作單多一句「這次分析已取消」。** 改版前的 `else` 分支會把
   取消的工作單當成完成的來攤全文。

10. **自動跳窗掛在 `render()` 最後，用 `Set<jobId>` 去重。** 工作單完成時 store
    會 emit → subscribe → render，所以那裡就是「分析剛跑完」那一刻。去重集合
    少了的話，`render()` 每跑一次（改派、簽核、別的分頁存檔都會觸發）就把窗
    推回使用者臉上。`isDialogOpen()` 擋下的那次**不標記**，所以窗關掉之後的
    下一次 render 會補跳。

11. **S1 攔截對話框的「查看」鈕借確認鈕那條路把 jobId 交出去。**
    `askCustom` 的對話框只能從內部關閉，而按下查看的意思本來就是「這個窗的
    任務結束了，換下一個窗」。`onMount` 綁 click → 設 `picked` → 觸發
    `[data-dlg="ok"]`，`read` 回傳 `picked`。**這是第一次真的走 `onMount` /
    `extraLabel` / `extraDanger` 這三條路**（W2-A 只實作沒使用），三個欄位
    都照 W2-A 定下的語意運作，沒有需要改 `ask.ts`。

### 自己抓到的一個 bug（既有測試抓到的）

`tests/wave1-review-fixes.test.ts` 的 F3-2「已核准鎖定的專案，落地不了」原本紅了。
**不是我的閘門寫錯 —— 是那支測試的前置正好是 S1 要拆掉的那個陷阱**：它先跑
agent（留一張 pending）、再把案子全簽掉鎖定，而 S1 的整個用意就是不讓這件事發生。

處理方式：**只改前置順序，零個斷言被改動。** 改成先簽核鎖定、再跑 agent
（`invokeAgent` 沒有 locked 守衛，所以這個狀態仍然到得了）。
`saveAgentResult` 的閘門本身完全沒動 —— 它是最後一道防線，S1 只是讓人比較不會
撞上它。逐條說明：

| 檔案 | 改了什麼 | 為什麼 |
|------|---------|--------|
| `tests/wave1-review-fixes.test.ts:373-390` | 把 `invokeAgent` + `waitForJob` 兩段從 `approveAndLock` 迴圈**之前**移到**之後**；補一段註解說明原因 | S1 讓「有 pending 分析時鎖定案子」不再可達。斷言（`save.ok === false`、內文逐字不變）與 `expect(proj(id).status).toBe("approved")` **一字未改** |

**沒有任何斷言被刪除或弱化。**

### 與規格的落差 / 順手修掉的一處

- **規格沒提 `review.ts`，但它是 `approveAndLock` 的另一個呼叫端。**
  那裡對「失敗 + 我是 admin」的既有反應是問「要不要以管理員身分代簽」——
  S1 的拒絕會誤觸這條路：使用者白寫一段代簽理由，送出後被同一個閘門再擋一次，
  而理由那一欄會讓他以為問題出在權限。加了 `!r.pendingJobs` 一個條件排除，
  並補了一條 source-grep 測試。**只動這一行**，`review.ts` 其餘未碰。
- **S1 攔截對話框的確認鈕預設處理「第一份」**，規格只說「每張一顆查看」。
  沒有預設動作的話，那個窗的確認鈕沒有意義（只剩取消）。
- **`skipStage` 被擋下時 UI 走的是同一個攔截對話框**（`signoff.ts` 的 `r.pendingJobs`
  分支涵蓋四種動作），規格只講了核准那一路。

### 沒碰的東西（W2-C 的地盤）

`src/pages/admin.ts`、`src/pages/editor.ts`、`src/lib/submit-assign.ts` 的行為
（只把寫死的 `FALLBACK_EDIT_TARGET` 換成共用函式，`editTargetLabel` 的回傳值
逐字不變，既有測試全綠）、`store.submitPlan` / `submitForReview`、
全域 `workflowStages` 的 CRUD —— 全部未動。
`tests/pending-gate.test.ts` 有呼叫 `setWorkflowStages` 來組測試用流程，
但**只是呼叫既有 API**，且 `afterAll` 還原。

### 建議的 UAT 題目

DOM 行為（焦點、Escape、Tab trap、自動跳窗時機）零自動化覆蓋，全部要靠實機：

1. 指派一個 agent 到某一關 → 按「執行分析」→ 跑完**自動跳窗**，不必手動點
2. 那個窗按「稍後再決定」→ 關掉；**不會**自己再跳回來（改派別的關卡、
   切分頁回來都不該重跳）
3. 關卡列上出現「待拍板」徽章與「查看結果」鈕，而且**列上看不到全文**
4. 按「查看結果」→ 同一個窗重開
5. enterprise 專案的「文件補完」（`edit` 關卡）→ 窗內是**兩欄**，左欄是
   PRD 現在的「開放問題」內容、右欄是 agent 產出，中間那句紅字看得到
6. 先在編輯台把「開放問題」打幾行字 → 跑 `edit` 關卡的分析 → pop-up 左欄
   要顯示**那幾行字**（不是空的、不是別的專案的）
7. 按「存進文件」→ 回編輯台確認那一段**整段被換掉**（不是被追加）
8. `review` 關卡按「存到這一關」→ 關卡列顯示分析全文，PRD 內文**不變**
9. 按「不採用」→ 關卡列一行灰字「這份分析未採用」，**展開仍看得到全文**
10. **S1 主戲**：跑一份分析不拍板 → 去簽最後一關 → 出現攔截對話框，
    列出那一份、按「查看」直接開結果窗；處理完再簽一次才過得去
11. 攔截對話框按「稍後再說」→ 案子**沒有**被鎖定（去看關卡狀態）
12. pop-up 內按 Enter → **不得**送出（`askCustom` 一律不讓 Enter 確認）
13. pop-up 內 Tab 循環、Escape 關閉且不觸動背後簽核頁的熱鍵
14. 分析全文很長時，`<pre>` 自己捲，整個 modal 不捲（按鈕要一直看得到）

---

## W2-C 實作筆記

> 2026-08-26 · 實作者：Engineer（子代理）。記下**補的決定**與**與規格的落差**。
> 未 commit、未 push，交 PM 驗。

### 交付前實跑的輸出

```
bunx tsc --noEmit   → exit 0
bun test            → 1739 pass / 0 fail / 4054 expect / 86 files（基準 1695/85）
bunx vite build     → ✓ built in 1.00s
git diff --stat     → 5 檔 +649/-50，另新增 2 個未追蹤檔
                      （src/lib/workflow-admin.ts、tests/workflow-skeletons.test.ts）
```

**既有測試零改動、零刪除、零弱化。** 這一批沒有動到任何一支既有測試檔
（W2-B 那張「改了哪一行、為什麼」的表在這裡是空的）。

### 實機驗證（這一批多做的一件事）

規格只要求三個自動化閘門，但 C-1 的整個失敗模式就是「測試全綠、App 裡是零」——
只靠測試證明不了它。所以用 Interceptor 開真 Chrome（自己的 dev server，port 5199，
不是 5173）實跑了一遍，逐條記結果：

| 驗的事 | 結果 |
|--------|------|
| 五個分頁與兩個新面板都在 | `["people","workflow","skeletons","landed","cases"]`，5 個骨架收合區 |
| C-1 存檔往返 | 把「工程」關卡改成 `edit` + `human` + 覆寫「三行摘要／專案功能說明與願景」→ 存檔 → **localStorage 讀回 `kind:"edit"`、`defaultActor:"human"`、`editTarget:{sectionId:"summary",fieldKey:"vision"}`** |
| `kind` 切換即時反應 | `st-edit-wrap` 的 `display` 從 `["none","none"]` 變 `["",""]`，沒有重畫整列 |
| 章節換了欄位選項跟著換 | 選 summary → 欄位下拉變成 `["","vision","what","who","why","tech"]` |
| C-2 覆寫真的存下去 | 改 lean 第一關名字 → `workflowSkeletons.lean` 出現在 localStorage，收合區標題多一個「已自訂」 |
| **C-2 拒絕路徑（真的按下去）** | 刪 lean 的「我核准」→ toast 逐字是「骨架一定要留一關由人核准 —— 少了它，這一類 PRD 就再也沒有人簽過」，而且 `lean` 兩關**一關都沒少** |
| 還原成預設 | 按下去 → `workflowSkeletons` 變回 `{}` |
| `kind` 改回 review 會清掉 editTarget | revert 之後讀回的物件**沒有** `editTarget` 這個 key |
| D2 警語真的看得到 | 每一類收合區內第一行，黃色左邊框 |
| 版面沒爆 | `document.scrollWidth === clientWidth`（無橫向捲動），每個欄位 140px，review 關卡的兩個「覆寫*」label 寬度是 0（正確隱藏） |

截圖：`~/Downloads/interceptor-capture-20260826-030350-23458.png`。
⚠️ 截圖中央那個「夜深了，測試人」浮層是 App 自己的每日問候 modal，**與這一批無關**。

### 規格沒講、實作時補的決定

1. **產生 HTML 的 class 與讀回用的選擇器收斂成一份常數（`STAGE_FIELD_SEL`）。**
   這個檔裡有兩段程式必須逐字一致。兩邊各自打字面值的話，改了一邊沒改另一邊 ——
   表單畫得出來、按下儲存卻讀回空字串，於是那一關被**靜默**改成預設值
   （`kind` 退回 review、`editTarget` 被清掉）。沒有錯誤訊息，而使用者以為自己
   存好了一個會改內文的關卡。測試對這條迴路下手（「產出的 class 涵蓋 reader
   要查的每一個」），是整支測試的樞紐。

2. **DOM 讀回拆成 `readStageForm`（純查詢，零判斷）+ `stagePatchFrom`（純函式）。**
   這個 repo 沒有 happy-dom，DOM 那半測不到。所以把**所有判斷**推進純函式那半，
   讓 DOM 那半退化成「查選擇器、取 value」—— 測不到的部分裡就沒有任何會錯的東西。

3. **`editTarget` 章節與欄位「缺一不可」，只選一個一律退回 undefined。**
   規格說「不選 → 存成 undefined」。但只選章節不選欄位是第三種狀態，規格沒講。
   存成 `{sectionId, fieldKey: ""}` 的話，落地時 `resolveEditTarget` **不會**退回
   「開放問題」（它只認 undefined），而是往一個不存在的 key 寫 —— agent 跑完、
   使用者按下存檔，內容進到一個畫面上永遠顯示不出來的地方。

4. **`kind` 改回 `review` 時強制清掉 `editTarget`。** 規格只說 edit 時才出現。
   留著的話，使用者把改稿關卡改回審閱之後那個目標還躺在資料裡；下次再切回改稿
   就會沿用一個他以為已經取消掉的欄位。

5. **`editTarget` 那兩個下拉永遠在 DOM 裡，只用 `style.display` 藏。**
   不在 DOM 裡的話，切 `kind` 就得整列重畫，而重畫會把同一列還沒存的其他修改
   （關卡名打到一半）一起丟掉。

6. **`FULL_CATS` 新開在 `types.ts`，沒有複用 `submit-assign.ts` 的 `FULL_CAT_LABEL` keys。**
   後者所在的檔 import 了 `ui.ts`（`escapeHtml`）。store 要用這份列舉來合併骨架
   覆寫 —— 從那裡拿等於把 DOM 工具拉進 store 的相依圖，headless 測試會在 import
   時就炸。`types.ts` 零依賴。（W2-B 為了同一個理由把 `pendingAgentJobsOf` 放在
   `types.ts`，這是同一條線。）

7. **骨架編輯**不用草稿狀態**，每一次操作（改一列／新增／刪除／上下移）都是一次
   完整的 `setWorkflowSkeleton`。** 好處是每個操作都過同一組驗證：刪到剩零關、
   把「我核准」刪掉，當場被擋並說出理由。UI 這一層**刻意不自己先擋一次** ——
   兩份規則會分岔，而分岔的那一天，畫面上按得下去的東西 store 會拒絕，
   看起來像存檔壞了。

8. **`resetWorkflowSkeleton` 是把 key 刪掉，不是複製一份種子進去。**
   複製一份的話，之後種子骨架任何一次修正都到不了這個使用者手上：他的
   localStorage 裡凍著一份「還原當下」的複本，而畫面上跟真的還原一模一樣。
   同理 `AppState.workflowSkeletons` 是 `Partial` 而不是存滿五類。

9. **`load()` 加一支 `sanitizeSkeletons`。** `...parsed` 本來就會把這個欄位帶過來，
   但 localStorage 是使用者改得到的，而這份資料**直接決定送審落地哪幾關**。
   `{lean: []}` 會讓 lean 專案送審後拿到零關卡流程，而 `allStagesSettled` 對
   零關卡回 false —— 案子從此結不了，也沒有任何一顆按鈕解得開。認不得的分類
   一併丟掉（留著會變成管理中心看得到、卻對不上任何編輯器的孤兒）。

10. **`liveSkeletons()` 每次呼叫都重算、而且回傳複本。** 快取的話，管理中心改完
    骨架、下一個專案送審跑的還是舊的。複本則是因為 `resolveWorkflow` 的結果會被
    寫進 `project.workflowStages` 再繼續改（指派執行者），共用參考會讓改一個專案
    動到 state 裡的骨架本身。

11. **落地計數排除 `templateStages` 的專案。** 自訂範本自帶骨架的專案落地的是
    **範本自己那一份**，不是五類裡的任何一份。算進去的話，使用者改了 lean 骨架，
    計數裡卻掛著一個毫無關係的專案。沒有 `templateCat` 的算 lean，跟
    `resolveWorkflow` 的 `FALLBACK_CAT` 一致。

12. **`reapplyWorkflow` 加了 admin 檢查（規格只說 UI 只給 admin 看）。**
    `applyWorkflowToCase` 與 `reopenCase` 兩支性質相同的 API 都在 store 端擋，
    只在 UI 藏按鈕的話，那條規則會在下一個呼叫端出現時消失。

13. **`.st-field-label` 取代原本每個 label 上抄一份的行內樣式。** 不只是重複：
    `background` 簡寫會把 select 的自繪箭頭洗掉（`admin.html` 檔頭那段註解記的
    就是同一個坑），而每加一個欄位就要再抄一次。

### 與規格的落差 / 沒做的事

- **`reapplyWorkflow` 對「已經跑過的案子」實際上不會讓下次送審重新解析。**
  規格說「清掉 `project.workflowStages`，下次送審重新解析」，也說「不要順手把
  個案的 stages 也砍掉 —— 那是 `submitForReview` 的 `touched` 判斷要處理的事」。
  照做了，但兩件事合起來的結果是：`caseHasRun(live)` 為 true 時，`submitPlanFor`
  走的是 `workflowFromCase(live)`（從個案反推），**不會**回頭讀骨架。所以
  「重新套用範本」只對**還沒有任何簽核痕跡**的案子真的生效。
  **這是規格內部的一個張力，不是我改壞的**，我照規格的字面實作並在這裡指出來 ——
  要真的重套一個跑過的案子，得配合現有的「個案調整 → 套用目前流程」
  （`applyWorkflowToCase`），或由 Scott 拍板讓 `reapplyWorkflow` 也重建個案。
  **行為維持原樣，等 Scott 決定。**

  ✅ **文案已對齊（2026-08-26 第二輪，PM 退件後修）。** 見下方「第二輪修正」。
- **`editTarget` 的章節選項來源是「目前 active 專案解析出來的章節」。**
  全域關卡與五類骨架都是**跨專案**的，而章節清單是某一個專案的（領域包會加章節：
  通用 8 章、payment 12 章）。用 `SEED_SECTIONS` 的話 payment 專屬章節根本選不到，
  而那正是最需要被 edit 關卡改寫的幾章，所以選了現在這條。已知後果：選一個別的
  領域沒有的章節時，落地端查不到欄位 —— 那時 `editTargetLabel` 顯示 id 而不是
  猜一個名字，所以看得出來。**列進 UAT。**
- **沒有 DOM 層的自動化測試**（這個 repo 不為單一檔案引入 happy-dom）。
  `readStageForm`、`bindStageRowFields` 的即時切換、`<details>` 展開狀態在
  `store.subscribe(render)` 重畫後的保留 —— 這三件事靠上面那張實機驗證表
  與 UAT，沒有自動化覆蓋。
- **五類骨架沒有「新增一整類」或「改分類名稱」。** 規格只要求五類的檢視與編輯，
  `FullCat` 是聯合型別，加一類要動型別與種子，不屬於這一批。
- **`reapplyWorkflow` 沒寫 event log。** `EventKind` 沒有對應的種類，硬借一個現有的
  （`review.withdraw`？`decision.record`？）會讓任何依 kind 聚合的治理統計把它
  算成別的東西。要留紀錄就該新增一個 kind，那不屬於這一批。

### 建議的 UAT 題目

上面那張實機驗證表已經蓋掉存檔往返與兩條拒絕路徑，所以這裡只列**機器驗不到**的：

1. 管理中心 → 簽核流程設計 → 任一關卡把「關卡型態」改成「改稿」→
   兩個「覆寫章節／覆寫欄位」下拉**當場出現**（不必重新整理）
2. 同一列**先把關卡名改到一半**、再切換關卡型態 → 打到一半的名字**不得**消失
3. 選了「覆寫章節」之後，「覆寫欄位」的選項換成那一章的欄位（不是上一章的）
4. 只選章節、不選欄位 → 儲存 → 重新整理，那一關**不得**顯示成有覆寫目標
5. PRD 範本的簽核骨架 → 展開「完整型」→ 那一份有 5 關，其中「文件補完」是改稿關卡
6. 改完某一類骨架 → **回頭看已經送過審的專案**，流程**完全沒變**（D2 主戲；
   而且畫面上那句警語要在使用者找別的開關之前就看得到）
7. 改完骨架 → 開一個**新專案**、套同一類範本、第一次送審 → 落地的是**改後**的關卡
8. 某一類旁邊的「目前有 N 個專案落地了這一份」→ 送審一個該類專案之後 N 要 +1
9. 展開一個收合區 → 在**另一個分頁**做任何會觸發 render 的事（例如切換人員啟用）
   → 回來時那個收合區**還是展開的**
10. 各專案已落地的流程 → 展開任一專案 → 內容**唯讀**（沒有任何下拉可以改人）
11. 以**非管理員**身分登入 → 「重新套用範本」那顆鈕**看不到**
12. 對已鎖定的案子按「重新套用範本」→ 被擋，訊息說得出「已鎖定的流程是紀錄」
13. 對已抽單的案子按 → 訊息指向「重開案件」
14. 對話框內 Tab 循環、Escape 關閉且不觸動背後管理中心的熱鍵

### 沒碰的東西（另外兩批的地盤）

`src/pages/signoff.ts`、`src/pages/editor.ts`、`src/lib/agent-result.ts`、
`src/lib/submit-assign.ts`（只 **import** 了它的 `editTargetLabel`，一行未改）、
`saveAgentResult` / `discardAgentResult` / `approveAndLock` / `skipStage` /
`submitPlan` / `submitForReview` / `pendingAgentJobs` —— 全部未動。
`resolveWorkflow` 的簽名逐字不變，只是 `resolveWorkflowFor` 開始把第三個參數
真的餵進去（那個參數本來就是為此留的）。


---

## W2-C 第二輪修正 —— 「重新套用範本」的文案在說謊

> 2026-08-26 · PM 退件：筆記裡把限制寫對了，但**畫面上的文案跟那個發現相反**。
> 只改文案與可用性，**`reapplyWorkflow` 的行為一行未動**（那是 Scott 的決定）。

### 問題

PM 用探針實跑（lean 專案 → 送審 → 簽掉第一關 → `reapplyWorkflow`）：
`approved` 原封不動、下次送審 `landsNow: false`。而 `admin.ts` 的 `askConfirm` 說：

> 「這個案子既有的簽核狀態會被清掉：下次送出審閱時，流程會照現在的範本骨架與
> 領域包重新解析，關卡與已簽的紀錄都會換一份。」

兩句都是假的。**一顆 `danger: true` 的按鈕在對使用者說「我會破壞你的東西」，
而它什麼都沒做** —— 使用者要嘛不敢按一顆其實無害的鈕，要嘛按了以為重套好了。
比功能沒做到更糟：功能沒做到，使用者至少知道自己沒做到。

### 改了什麼

| 改動 | 內容 |
|------|------|
| 文案抽成 `REAPPLY_COPY`（`workflow-admin.ts`） | 常數化才測得到「使用者實際看到的那幾個字」，而不是測一段離畫面很遠的邏輯 |
| 分兩種案子 | `landsNow === true` → 「這個案子還沒有任何簽核痕跡，所以重套是有效的……」；`landsNow === false` → 明講不生效，並**指路到「個案調整 → 套用目前流程」** |
| 跑過的案子把鈕停用 | 鈕文字改成「重新套用範本（對這個案子不生效）」，旁邊 `.lf-note` 講原因。**不是整塊拿掉** —— 管理員找的就是這顆鈕，整塊消失只會讓他以為功能不見了然後去別的地方翻 |
| 判斷來源 | 一律 `store.submitPlan(pid).landsNow`。**沒有在 UI 重寫一份 `caseHasRun`** —— 那正是 W2-A 抽 `submitPlan` 要防的分岔，而分岔的症狀就是這一輪在修的東西 |
| 點擊時再問一次 | `disabled` 只是 DOM 狀態不是守衛；畫面可能是上一次 render 留下的，而案子在那之後跑過了 |
| toast | 「已清掉落地流程 —— 下次送審**會照現在的骨架**重新解析」（只有有效的案子按得到，所以這句成立） |

### 新增測試（+6，合計 50 條）

- **`跑過的案子：重套之後仍不重解析，且既有簽章原封不動`** —— 用程式重現 PM 的探針：
  送審 → `approveAndLock` 簽掉第一關 → `reapplyWorkflow` → 斷言
  `workflowStages` 清掉了、`submitPlan().landsNow === false`、`stages` 的狀態**逐字**不變。
  **這一條是把限制變成寫下來的合約**，之後有人要改行為會先撞到它。
- 對照組：沒跑過的案子重套之後 `landsNow === true`（證明這顆鈕不是永遠無效）
- `文案不再宣稱會清掉簽核狀態` —— 直接斷言那兩句假話不在原始碼裡
- 兩種文案各自的斷言（有效那份要講「還沒有任何簽核痕跡」；不生效那份要含「不生效」與「套用目前流程」）
- `reapplyEffective` 走 `store.submitPlan`，且全檔不含 `caseHasRun(`
- 停用分支含 `disabled` + `ranNote`；點擊分支含再問一次的守衛

### 實機驗證（兩個分支都跑過）

| 情境 | 結果 |
|------|------|
| 已簽掉一關的案子 | 鈕 `disabled: true`，文字「重新套用範本（對這個案子不生效）」，旁邊完整說明並指向「個案調整 → 套用目前流程」 |
| 沒有簽核痕跡的案子 | 鈕可按，對話框逐字是「這個案子還沒有任何簽核痕跡，所以重套是有效的：清掉它身上那份落地流程之後，下次送出審閱會照現在的範本骨架與領域包重新解析一份新的關卡。」 |
| 按下確認 | toast「已清掉落地流程 —— 下次送審會照現在的骨架重新解析」，`workflowStages` key 真的不見，該專案從落地清單消失（正確 —— 它不再是落地狀態） |

### 第二輪的三個閘門

```
bunx tsc --noEmit   → exit 0
bun test            → 1745 pass / 0 fail / 4072 expect / 86 files（第一輪 1739，+6）
bunx vite build     → ✓ built in 1.14s
```

既有測試仍然**零改動、零刪除、零弱化**。`reapplyWorkflow` 的實作一行未動。

---

## 審查修復（C-1／C-2／C-3／C-4）

> 2026-08-26 · 對 `plans/review-wave2-cato.md` 的四條缺陷。
> **D-1（`discardAgentResult` 的閘門）與 D-2（`setWorkflowSkeleton` 的角色閘門）
> 一行未動** —— 已上呈 Scott 拍板。`reapplyWorkflow` 的行為與 S1 閘門本身也未動。

### C-1（major）自動跳窗吃掉 dialog lock，S1 攔截對話框整個不出現

**根因一句話**：`askCustom` 的 `rejectIfBusy()` 跑在第一個 `await` 之前，所以
`render()` 尾端的 `maybeAutoShow` 會**同步**把鎖拿走，緊接著的
`void handlePendingGate(p)` 直接 throw，而它是裸 `void`、沒有人接
（`loading-overlay.ts:103` 明講這個 repo 刻意不攔 `unhandledrejection`）。

**怎麼修**

| 動作 | 內容 |
|------|------|
| 新增 `src/lib/dialog-flow.ts` | `createDialogFlows({ isDialogOpen, onError })` → `{ runUser, tryAuto, isBusy }`。**零 DOM、零 store**，只管「誰先拿到那把鎖」 |
| 規則 | **使用者的動作優先。** `runUser` 期間 `tryAuto` 一律回 `false` 並且**完全不執行** flow；自動跳窗只是提醒，它把鎖搶走的代價是使用者剛按下的動作整個沒有回應 |
| 錯誤一律收在一處 | `askCustom` 因鎖被占而 throw 的每一條路徑都走 `runUser`／`tryAuto`，錯誤進 `onError` → `toast`。`signoff.ts` 現在**零裸 `void` 對話框呼叫** |
| `render(opts?: { skipAutoShow?: boolean })` | 閘門被擋下那條路改成 `render({ skipAutoShow: true }); flows.runUser(() => handlePendingGate(p));`。順序與旗標**缺一不可** |
| 自動跳窗的去重 | `autoShown.add()` 搬進 flow **裡面** —— 讓位的那一次 flow 不執行，所以「沒開成」永遠不會被記成「已經自動開過」；真的開失敗則在 `catch` 裡 `delete` 回去 |
| 兩顆 `askConfirm`（重開案件／套用目前流程） | `async` 的 click handler 沒有人接它的 rejection，而 `askConfirm` 跟 `askCustom` 共用同一把鎖 —— 也改走 `runUser` |

**為什麼抽成獨立模組**：缺陷**不在任何一支函式體內，在兩支之間**。`signoff.ts` 是有
DOM 副作用的頁面腳本，headless 匯入不了；source-grep 的解析度到「函式」為止，
而既有的 `test("自動跳窗有 isDialogOpen 守門…")` 兩個字串都驗到了、測試綠、缺陷還在。
把「順序」搬進純函式，它才變成餵得了替身的東西。

**哪條測試釘住它**（`tests/wave2-review-fixes.test.ts`）

- `閘門擋下時 S1 對話框真的被呼叫到，期間來的 render 讓位` —— **主測**。
  替身唯一必須忠實的地方是「鎖是同步拿的」；斷言 `calls` 逐字等於
  `["open:gate", "close:gate"]`，而且期間插進來的一次 `render()`（模擬別的分頁
  改狀態 → `store.subscribe`）沒有開出第二個窗
- `反例：自動跳窗先跑就吃掉鎖，而那個 throw 一定要有人接` —— 這條**證明機制是真的**，
  同時釘住「即使順序錯了，錯誤也被 `onError` 接住，不會沉到 console」
- `使用者的流程在跑時，自動跳窗一律讓位而且 flow 完全不執行`
- `同步 throw 的流程也接得住，而且鎖的計數要放掉`（計數沒放掉的症狀是
  「跑完分析再也不會跳窗」）
- 生產接線三條：`render({ skipAutoShow: true })` + `flows.runUser(() => handlePendingGate(p))`
  在閘門那個分支裡、全檔 `not.toContain("void showAgentResult(")` /
  `not.toContain("void handlePendingGate(")`、`flows.runUser(` **計數 === 4**

**建議的 UAT 題目**

1. 專案留兩份待拍板分析 → 重開簽核頁 → 自動跳出第一份 → 按「稍後再決定」→
   去簽最後一關。**預期**：跳出「還有 2 份分析沒拍板」的清單對話框（不是另一張
   工作單的結果窗），清單裡兩份都在。
2. 承上，在攔截對話框裡按其中一份的「查看」→ 預期直接換成那份的結果窗，
   拍板後回到簽核頁，關卡列上該份的狀態已更新。
3. 攔截對話框按「稍後再說」→ 預期回到簽核頁、沒有任何窗自動彈出來搶焦點；
   再按一次核准仍然擋得下來、對話框仍然開得出來。

### C-3（major）待拍板的工作單會從關卡列消失，而閘門照樣擋

**根因一句話**：畫面用兩個窄化決定畫哪一張（`stageAnalysis` 只回**最新一筆**、
`isAgent` 看**當下的**指派對象），而擋結案的 `isPendingAgentJob` 兩個都不看。

**怎麼修**：新增 `stageAnalysisJobs({ jobs, projectId, stageId, isAgent })`
（`src/lib/signoff.ts`，純函式），合約只有一句 ——
**只要一張工作單擋得住結案，它就一定在回傳的陣列裡**。
`signoff.ts` 改成 `analysisJobs.map(stageAnalysisRowHtml).join("")`，
每一張 pending 的都有自己的「查看結果」鈕。

顯示用的那一張（「重新分析」鈕的 disabled 狀態）仍然是 `[0]`，語意跟改動前一致；
`isAgent === false` 且沒有任何 pending 時照舊什麼都不畫 —— **不是改成永遠都畫**。

**刻意沒做的兩件事**：不放寬閘門、不把工作單藏起來。兩條都是讓畫面說謊來換
一時的一致，而簽核紀錄講實話正是這整套東西的賣點。
另外「重新分析」鈕**沒有**因為前一份未拍板而停用 —— 停用會把使用者關在門外，
而現在前一份看得到也按得到，問題已經沒了。要不要停用是產品決定，留給 Scott。

**哪條測試釘住它**

- `合約：擋得住結案的每一張，關卡列產出的 HTML 裡都有拍板入口` ——
  **這條同時持有兩邊**：對每一個 `isPendingAgentJob(j)` 為真的 job，
  斷言產出 HTML 含 `data-sg-view="<jobId>"`。舊的分工是兩邊各有完整測試、
  卻沒有一條測試問「擋得住的那些，畫得出來嗎」
- `(a) 按過「重新分析」之後，前一張仍然畫得出來`
- `(b) 把關卡改派給人之後，pending 的那張不得跟著消失`
- `改派給人且沒有任何 pending 時仍然什麼都不畫`（防過度修正）
- `指派 agent 時，最新那張非 pending 的照舊要畫`
- 生產接線：`not.toContain("isAgent ? stageAnalysis(")`

**建議的 UAT 題目**

4. 關卡指派給 Agent → 執行分析 → **不要拍板**，直接按「重新分析」→ 跑完。
   **預期**：關卡列上**兩列**分析都在，各自有「查看結果」；結案被擋時說的
   「2 份」跟畫面上看得到的份數一致。
5. 承上，把那一關**改派給人**。**預期**：待拍板的那幾列仍然在、仍然按得到拍板
   （不是整行消失）。
6. 兩份都拍板（採用或不採用）之後再簽最後一關 → 預期順利結案。

### C-4（minor）匯入的工作區 JSON 會讓管理中心整頁停止 render

**根因一句話**：`importState` 完全沒有收斂，而 `load()` 那條路有
`migrateProject` / `sanitizeSkeletons` —— **兩條吃同一份資料，只有一條在把關**；
缺 `kind` 的關卡定義會讓 `escapeHtml(STAGE_KIND_LABEL[s.kind])` 丟 TypeError，
`renderLandedFlows` 炸掉 → `render()` 中斷 → `renderCases()` 不再執行，
而它掛在 `store.subscribe` 上，之後**每次狀態變動都再炸一次**。

**怎麼修**（兩道，缺一不可）

1. **收斂**：新增 `sanitizeStageDef` / `sanitizeStageDefs`（`store.ts`，已匯出）。
   `kind` 退回 `review`（假設「只出意見」比假設「會覆寫內文」安全）、
   `defaultActor` 退回 `human`、`mode` 退回 `parallel`（`sequential` 會讓升級後
   跑到一半的案子突然多出順序閘門）、`order` 非數字時用索引。
   **用 spread 覆寫而不是逐欄位重建** —— `migrateProject` 上面那串
   「第三、五、六、七次踩同一個坑」講的就是逐欄位重建會讓沒列到的欄位無聲消失。
   接上 `migrateProject`（`workflowStages` / `templateStages`）、`sanitizeSkeletons`、
   以及 `importState`。順帶把 `load()` 的個案補值抽成 `normalizeCases`，
   兩條路共用同一支。
2. **查表退路**：`stageKindLabel` / `stageActorLabel` / `stageModeLabel`
   （`workflow-admin.ts`），`admin.ts` 全面改用。
   一份已經躺在 localStorage 裡的舊資料不會因為我們今天加了收斂就自動變乾淨，
   所以第二道不是多餘的。

**哪條測試釘住它**

- `缺 kind / defaultActor 的舊匯出檔補得回合法值`
- `查表一律有退路 —— 缺值不得變成 undefined.replace`
- `order 是一段 HTML 時收斂成數字`
- `不認得的欄位原樣帶過`（防「修 A 壞 B」：逐欄位重建會讓未來欄位消失）
- `migrateProject 的 workflowStages / templateStages 都走收斂`
- `importState 真的接上了三支收斂函式` —— F0 形狀防護，而且斷言收斂寫在
  `...newState` **之後**（順序反了等於什麼都沒做）
- `normalizeCases 是 load 與 importState 共用的同一支`（計數 === 3）

### C-2（minor）`submit-assign.ts` 的 `${s.order}` 沒 escape

**根因一句話**：這批新增的 `bodyHtml` 路徑上唯一一處沒有 escape 的插值，
而型別謊報的值從匯入那條路進得來。

**怎麼修**：`escapeHtml(String(s.order))`。順手把 `admin.ts` 的三處序號
（`padStart` 兩處 + 個案關卡列一處）與 `submit-assign.ts` 的
`KIND_LABEL` / `MODE_LABEL` 查表也補上退路。

**哪條測試釘住它**：`型別謊報的 order 不得原樣進到 bodyHtml`
（斷言 `not.toContain("<img src=x")` 且 `toContain("&lt;img src=x")`）＋
`正常的數字序號照樣印得出來`（防過度 escape）。

**建議的 UAT 題目**

7. 設定 → 匯入一份**缺 `kind` / `defaultActor` 的舊工作區 JSON**（或手改一份，
   把某關的 `order` 換成 `"><img src=x onerror=alert(1)>`）→ 開管理中心。
   **預期**：落地流程與個案兩個區塊都畫得出來、切換分頁與改任何狀態都不會白頁；
   該關卡顯示「審閱（只出意見）／我」。
8. 承上，對那個專案按「送出審閱」→ **預期**：指派對話框正常開啟，序號欄位
   顯示的是那串字的**文字**，沒有任何彈窗或版面破圖。

### 測試守門的補強（報告 §E）

補的**不是更多 grep**：

- **時序替身**取代「兩支函式各自都有那個字串」的 grep（C-1）
- **同時持有兩邊的合約測試**取代「兩邊各有完整測試」（C-3）
- **型別謊報的輸入**取代「所有測試餵型別正確的物件」（C-4）

**唯一改動的既有測試**：`tests/workflow-skeletons.test.ts:593`
`expect(ADMIN_SRC).toContain("stagePatchFrom(readStageForm(el))")`
→ `expect((ADMIN_SRC.match(/stagePatchFrom\(readStageForm\(/g) ?? []).length).toBe(2)`。
理由是報告 §E 點名的具體弱點：`admin.ts` 有**兩個**儲存點，只要求出現一次的話，
其中一處退回舊寫法照樣綠。**斷言只變嚴，沒有放寬**；測試名稱同步加註「兩個儲存點都要」。
其餘既有測試零改動、零刪除。

### 三個閘門（實跑輸出）

```
bunx tsc --noEmit   → exit 0
bun test            → 1769 pass / 0 fail / 4131 expect / 87 files
                      （修復前 1745 / 86；+24 條、+1 檔，測試檔數與斷言數皆未減少）
bunx vite build     → ✓ built in 1.00s
```

未 commit、未 push。`plans/review-wave2-cato.md` 的 D-1／D-2／D-3／D-4 一行未動。

---

## D-3 決議：`reapplyWorkflow` 連個案一起重建

> 2026-08-26 · 實作者：Engineer（子代理）。Scott 拍板讓那顆鈕對**跑過的案子**也真的生效。
> 未 commit、未 push。

### 一句話

原本「重新套用範本」只清 `project.workflowStages`，對跑過簽核的案子是個 no-op；
現在它**連個案一起重建**，`caseHasRun` 的四個判準隨新個案歸零，下次送審真的照
骨架重解析 —— 代價是既有簽章與簽核紀錄一起消失，**而畫面上現在也是這樣講的**。

### 行為怎麼改的

`src/data/store.ts` 的 `reapplyWorkflow`，在原本的「拿掉 `workflowStages` key」之外多兩件事：

| 動作 | 內容 |
|------|------|
| 重建個案 | `caseFromWorkflow(projectId, resolveWorkflowFor(p), state.employees)` 覆蓋 `state.cases[projectId]` |
| 同步鏡像 | 是 active 專案時呼叫 `syncApprovalsFromActiveCase()` —— 不同步的話簽核頁還掛著剛被清掉的那幾個「已簽」 |

**閘門一條都沒放寬**：`accessRole !== "admin"`、`c?.locked`、`c?.withdrawn || p.status === "withdrawn"`
逐字保留，而且各補了一條「拒絕就是完全沒發生」的斷言。

**為什麼不是 `caseForProject()`（`reopenCase` 走的那支）。** 它走 `workflowFor()`
→ 落地那份、否則**全域** `state.workflowStages`；而這顆鈕承諾的是**骨架 + 領域包**
（`resolveWorkflowFor`），也就是 `submitPlanFor` 下次真的會用的那一份。用
`caseForProject` 的話，管理員眼前這份個案會在下次送審被靜默換成另一份關卡 ——
同一類「畫面說的跟實際發生的不是同一件事」。

**重建的原語仍然只有一支。** `reopenCase`、`applyWorkflowToCase`、這裡，三個呼叫端
最後都落在 `caseFromWorkflow`；差別只在「餵哪一份流程定義」。**沒有多開第三條
清簽章的路** —— 沒有任何一行是手動把 `state` 改成 `pending`、把 `log` 濾掉。
測試 `重建的關卡照現在的骨架，不是全域流程` 釘的就是「餵的是哪一份」。

`resolveWorkflowFor` 是純算出來的、不看 `p.workflowStages`，所以先算後刪或先刪後算
結果相同 —— 這一段**不依賴順序**，程式碼裡也這樣註明，免得下一個人以為順序是護欄。

### `CaseRecord.log` 的去留：**不留**，兩個獨立的理由

PM 的判斷是「應該留著」，理由是 `signoffTimeline` 靠它講得出「第 1 輪誰要求修改」。
我讀完 `caseHasRun` 與 `groupTimelineByRound` 之後**不同意**，理由兩條，任一條單獨成立：

1. **留著這顆鈕就又變回 no-op。** `caseHasRun` 第二個判準直接讀它 ——
   `c.log?.some(d => d.kind !== "comment")`。一筆核准就足以讓 `landsNow` 維持 false，
   也就是這次改動要解決的那件事原封不動地回來。要留就得改 `caseHasRun`，
   而那支管的是**每一次送審**，不是這一批的地盤（PM 也明列為不要碰的東西）。

2. **留著會讓紀錄說謊 —— 比刪掉更糟。** 兩層：
   - 關卡 id 是 `cs-<stageDefId>-<projectId>`，而重套的前提就是骨架換了 →
     def id 換了 → `signoffTimeline` 的 `stageName.get(d.stageId) ?? "（已移除的關卡）"`
     對留下來的**每一筆**都取到退路值。PM 擔心的那個畫面會全中。
   - 更硬的一層：重建出來的個案是 `round: 1`，而舊紀錄帶著 1..N。
     `groupTimelineByRound` 只依 `round` 分組，所以重套**之前**的決策會被併進
     **現在這一輪**的那一組。讀起來就是「這幾筆是在現在這份流程上發生的」——
     那不是保留歷史，是把歷史接到一份它沒發生過的流程上。

**考慮過並否決的第三條路**：把 log 搬到 `caseHasRun` 讀不到的側欄位（例如 `archivedLog`）。
那需要新欄位、時間軸合併、輪次偏移、以及一份「當時關卡叫什麼名字」的快照 ——
是一個獨立功能（「案件歷程封存」），不是這一批順手能做對的事。做半套的側欄位
只會產出上面第 2 點那個畫面，然後看起來像做了。

**所以連帶消失的東西，文案必須逐一講到**：既有簽章、`log`（誰在第幾輪核准／
要求修改）、以及已經存進關卡的 `agentResult`（`caseHasRun` 第四個判準，重建一樣帶走）。

⚠️ **一個已知的連帶後果**：關卡 id 換掉之後，`state.agentJobs` 裡還 pending 的工作單
會指向不存在的關卡。結案閘門 `pendingAgentJobsOf` 只依 `projectId` 過濾，所以**擋得住
結案這件事沒有變**，而攔截對話框走 `agent-result.ts` 的
`stages.find(...)?.name ?? "（已移除的關卡）"`，那幾張仍然列得出來、拍得了板。
不是斷頭路，但畫面上會出現「（已移除的關卡）」字樣 —— 列進 UAT（U-3）。

### 文案新的兩種講法（逐字）

常數在 `src/lib/workflow-admin.ts` 的 `REAPPLY_COPY`。`ranNote` **改名為 `ranWarn` 並反轉語意**
—— 同名反義是留給下一個人的陷阱，改名逼每一個引用點都被重看一次。

**A. 沒有簽核痕跡（`landsNow === true`）**

- `freshButton`：「重新套用範本」
- `freshTitle`：「重新套用範本流程？」
- `freshBody`：
  > 這個案子還沒有任何簽核痕跡，所以重套不會弄丟東西：清掉它身上那份落地流程、並把個案重建成照現在的範本骨架與領域包解析出來的關卡。下次送出審閱就用這一份。
- `okToast`：「已重新套用範本 —— 個案已照現在的骨架重建，下次送審用這一份」

**B. 已經跑過簽核（`landsNow === false`）—— 破壞性**

- `ranButton`：「重新套用範本（會清掉既有簽章）」 ← **後果寫在鈕上，不等對話框才講**
- `ranWarn`（貼在鈕旁邊的 `.lf-note`，按之前就讀得到）：
  > 這個案子已經跑過簽核 —— 重新套用會把既有簽章、簽核紀錄與已存的 agent 分析一起清掉，而且救不回來。
- `ranTitle`：「重新套用範本？既有簽章會被清掉」
- `ranBody`：
  > 這個案子已經跑過簽核。重新套用會把個案整份重建成照現在的範本骨架與領域包解析出來的關卡，所以既有的簽章、每一筆簽核紀錄（誰在第幾輪核准或要求修改）、以及已經存進關卡的 agent 分析都會一起消失 —— 而且救不回來：沒有復原，重簽一次也回不到原本那份紀錄。確定要換掉這個案子的流程再按。
- `ranOkToast`：「已重新套用範本 —— 既有簽章與簽核紀錄已清掉，個案照現在的骨架重建」

**刻意沒寫的一句話。** 上一版的 `ranNote` 指路到「個案調整 → 套用目前流程」。
那句話現在**不能寫**：`applyWorkflowToCase` 走的是 `caseForProject()`，同樣整份重建，
簽章與 log 一樣不留（它自己的 `askConfirm` 就寫著「會重置簽核狀態」）。
這個 repo 裡**沒有**任何一條路能換掉關卡又保住簽核紀錄 —— 寫一句指向不存在的退路，
就是把上一輪那個缺陷換個方向再犯一次。測試 `文案不得暗示有一條「換關卡又保住紀錄」的路`
把這件事釘住。

**畫面上的兩處反轉**（`src/pages/admin.ts`）：

| 上一輪 | 這一輪 |
|--------|--------|
| 跑過的案子 `disabled`，鈕字「重新套用範本（對這個案子不生效）」 | 按得到，鈕字「重新套用範本（會清掉既有簽章）」，兩條都是 `--danger` 色 |
| 點擊時若不生效 → `toast(ranNote)` 後 return | 點擊時重問一次，**答案決定跳哪一份對話框與哪一句 toast**（不是決定要不要擋） |

「點下去再問一次」的理由沒變、而且更要緊了：畫面可能是上一次 render 留下的，
案子在那之後跑過了 —— 那時該跳的是破壞性那份，不是「不會弄丟東西」那份。

### 被反轉／改動的既有測試（逐條）

檔案都是 `tests/workflow-skeletons.test.ts`。

| # | 原本 | 改成 | 為什麼 |
|---|------|------|--------|
| 1 | `test("不動個案的 stages")`，註解寫「順手砍掉的話……那正是簽核紀錄的全部價值」 | 更名 `test("沒有簽核痕跡的案子：重建出來的關卡逐字等於原本那一份")`，**斷言一個字沒改** | 斷言仍然成立（重建走同一支 `caseFromWorkflow`、同一份 `resolveWorkflowFor`，關卡 id 是算出來的 → deep-equal）。改的只有名稱與理由：舊註解的理由被 Scott 推翻，留著就是**一句跟程式碼相反的話**。跟文案說謊同一個缺陷，只是換到註解上。它現在防的是「骨架沒變時不得無故換掉關卡 id」 |
| 2 | `test("跑過的案子：重套之後仍不重解析，且既有簽章原封不動")` —— 斷言 `landsNow === false`、`stages` 逐字不變 | `test("跑過的案子：重套之後下次送審重新解析，且簽章／紀錄確實被清掉")` —— 斷言 `landsNow` 從 false → **true**、`approved` 歸零、`log` 為 `[]`、`reviewCommitId` 為 `null`、無 `agentResult` | **PM 指定的那一條。** 舊斷言鎖的是「這顆鈕是 no-op」這個限制，Scott 決定推翻它 |
| 3 | `test("文案不再宣稱會清掉簽核狀態 —— 那句話是假的")` —— `not.toContain("簽核狀態會被清掉")` 等三條 | `test("有簽章可清的那份才准講「清掉簽章」，沒有的那份不准嚇人")` | 上一輪禁那句話是因為它**當時是假的**；現在真的會清，**不能再禁**。禁的對象換成「講錯地方」：`freshBody` 是給沒有簽章的案子看的，在那裡喊「會清掉簽章」是另一個方向的說謊。同時新增 `ADMIN_SRC` 全檔不得再出現「對這個案子不生效」 |
| 4 | `test("有效／不生效兩種案子各有自己的文案，而且不生效那份指得出路")` —— 斷言 `ranNote` 含「不生效」「套用目前流程」 | `test("兩種案子各有自己的文案，而且鈕上就看得出後果")` —— 斷言 `ranButton` 含「清掉既有簽章」、兩份 body 不得相同 | 「不生效」與那條指路**現在都是假話**（見上）。新斷言把要求從「講得出不生效」換成「講得出代價」 |
| 5 | `test("跑過的案子把鈕停用，而且旁邊講得出原因")` —— `toContain("disabled")` | `test("跑過的案子按得到，但鈕上與旁邊都要講出代價")` —— `not.toContain("disabled")` + 必含 `ranButton` / `ranWarn` + `--danger` 出現 **2** 次 | 停用是上一輪為了誠實而做的事；行為改了之後，**停用自己變成了那句假話**。斷言沒有變鬆：從「畫面禁止一個動作」換成「畫面必須說出這個動作的代價」 |
| 6 | `test("點下去之前再問一次 —— disabled 只是 DOM 狀態，不是守衛")` —— `toContain("if (!reapplyEffective(pid))")` | `test("點下去再問一次，而且那個答案決定跳哪一份對話框")` —— 必含 `reapplyEffective(pid)` **且** 四個文案常數（`freshBody`/`ranBody`/`okToast`/`ranOkToast`）都要在這個分支裡被選到 | 舊斷言釘的是「不生效就擋下來」那個分支的**寫法**，而那個分支已經不存在。意圖不變（點擊當下重問）而且**變嚴**：多要求「重問的答案要真的決定用哪一份文案」—— 只重問卻永遠跳同一份對話框，是這一輪最像成功的失敗 |
| 7 | `test("已抽單的案子要走「重開案件」，不是重套")` | **只加不減**：多一條 `expect(cases[id]).toEqual(before)` | 行為放寬的那一輪，最容易順手鬆掉的就是閘門 |

**其餘既有測試零改動、零刪除、零弱化。** 上表 1 與 7 是「名稱／註解改寫」與「純新增斷言」，
2～6 是這次行為反轉直接波及的那幾條 —— 每一條都寫在上面，沒有靜默改掉的。

### 新增的測試（+4）

- `重建的關卡照現在的骨架，不是全域流程` —— 改骨架 → 重套 → 個案上看得到新關卡名，
  **而且** `submitPlan().stages` 跟個案那一份逐字相同。釘的是「餵哪一份流程定義」，
  也就是 `caseForProject` 與 `resolveWorkflowFor` 那個岔路
- `已結案鎖定的案子被拒，而且個案一個字都沒動` —— 這批之前**沒有** `locked` 的覆蓋
  （只有 withdrawn／非管理員／找不到專案）
- `文案敢說「會清掉簽章」，是因為 store 真的清了` —— **同時持有兩邊的合約測試**：
  真的跑一次 store 證明簽章被清，才允許斷言文案講那句話。單獨測文案或單獨測 store
  都漏得掉這個形狀，而那個形狀正是上一輪的缺陷（文案與行為對不上）
- `文案不得暗示有一條「換關卡又保住紀錄」的路`

### 交付前實跑的三個閘門

```
bunx tsc --noEmit   → exit 0
bun test            → 1773 pass / 0 fail / 4163 expect / 87 files
                      （基準 1769 / 87；+4 條，測試檔數未減少）
bunx vite build     → ✓ built in 2.41s
git diff --stat     → 4 檔 +296/-88
```

### 這一輪**沒有**做的驗證（誠實揭露）

**沒有跑真 Chrome。** 上兩輪都有 Interceptor 實機表，這一輪沒有 —— 要把 App 開到
「一個已落地、已簽掉一關的專案」需要登入→建案→送審→簽核的完整流程，成本不小，
而這次的行為面已經由 store 測試證明（含那條同時持有文案與行為的合約測試）。
**機器沒驗到的是版面**：`ranWarn` 那段長警語與變長的鈕字（「重新套用範本（會清掉既有簽章）」）
在收合區裡會不會換行破版。列進 UAT（U-1）。

### 建議的 UAT 題目

**U-1（取代作廢的 T20）「已經跑過簽核的案子，重新套用範本說得出自己會破壞什麼」**

流程：
1. 進管理中心 →「各專案已落地的流程」分頁
2. 展開那個已經簽過關的 enterprise 專案
3. 看「重新套用範本」按鈕與旁邊的說明（**先不要按**）

預期：按鈕**按得下去**（不再是停用），鈕上的字是「重新套用範本（會清掉既有簽章）」、
紅色；旁邊有一段說明講明會清掉既有簽章、簽核紀錄與已存的 agent 分析，**而且救不回來**。
畫面上**不得**再出現「對這個案子不生效」或指路到「個案調整 → 套用目前流程」。
版面：那段說明與鈕在收合區裡不破版、不橫向捲動。

**U-2「按下去之後，破壞真的發生了，而且畫面立刻反映」**

流程：
1. 承 U-1，記下那個案子現在有哪幾關是「已簽」、簽核紀錄時間軸上有幾筆
2. 按「重新套用範本（會清掉既有簽章）」→ 對話框確認
3. 回去看該專案的簽核頁與時間軸

預期：toast 說「既有簽章與簽核紀錄已清掉」；關卡換成**現在骨架**那一份、
全部回到未簽狀態；時間軸上重套前的那幾筆決策**不再出現**（不是變成「（已移除的關卡）」，
是整批不見）；該專案從「已落地的流程」清單消失（它回到未落地了）。
再送一次審 → 走的是現在的骨架與領域包。

**U-3「重套前留一份沒拍板的分析」**（已知連帶後果，測到請照這裡的預期判定）

流程：
1. 對某一關執行 Agent 分析、**不要拍板**
2. 重新套用範本
3. 回簽核頁，簽到最後一關

預期：結案**仍然被擋**（「還有 1 份 Agent 分析沒拍板」），攔截對話框裡那一份
**列得出來也拍得了板**，只是關卡名顯示「（已移除的關卡）」—— 這是設計上的已知後果，
不是 bug。拍完板就結得了案。

**U-4「沒有簽核痕跡的案子，文案不得嚇人」**

流程：對一個送過審但**一關都沒簽**的專案按「重新套用範本」

預期：鈕上沒有「會清掉既有簽章」字樣；對話框說的是「還沒有任何簽核痕跡，所以重套
不會弄丟東西」；確認後 toast 是「個案已照現在的骨架重建」。

⚠️ **順帶一提**：`plans/uat-簽核流程重新設計-wave-2-實測.md` 檔頭第 21 行那句
「已知未決：`reapplyWorkflow` 對已經跑過簽核的案子不生效」**現在是假的**，
跟 T20 一起要換掉。那份文件我沒有動 —— 交給 PM 決定怎麼重出。

---

## 送審前流程預覽（Scott 實測回報）

- 開立：2026-08-26 · 實作：Engineer 子代理 · 基準 `ba8066f`（1773 pass / 87 files）
- 交付：`tsc --noEmit` exit 0、`bun test` **1789 pass / 0 fail / 88 files**（+16 條，測試檔數 +1）、`bunx vite build` 成功
- **未 commit、未 push**（PM 自己收）

### 根因一句話

`addProject` 建專案時就先開了一個走**全域預設**流程（`seed.ts` 的工程／設計／資安／法務）
的個案，而這個專案真正的骨架要到**第一次送審**才落地 —— 所以簽核頁在送審前顯示的，
是一套送出那一刻就會被整批換掉的關卡，而頭條還寫著「流程有 4 關。到編輯台按『送出審閱』
之後才會開始跑」，暗示這 4 關就是要跑的那一份。

跟這兩輪修過兩次的是同一類缺陷：**畫面講了一句不成立的話。**

### 怎麼修

判斷一律問 `store.submitPlan(pid)`，**UI 一行都沒有重寫 `caseHasRun`**。

| 檔案 | 改了什麼 |
|------|----------|
| `src/lib/signoff.ts` | 新增 `stagesFromWorkflow()`（從 `store.caseFromWorkflow` **搬**出來的函式體）、`signoffStageView()`、`signoffCta()`、`PREVIEW_DETAIL`；`signoffSummary` 加選填 `opts.preview` |
| `src/data/store.ts` | `caseFromWorkflow` 改呼叫 `stagesFromWorkflow` —— **建立關卡的原語只剩一支** |
| `src/lib/signoff-stages.ts`（新） | 關卡列 HTML 從 `pages/signoff.ts` 整段搬進來，加上 `previewStageListHtml()` 與 `PREVIEW_COPY` |
| `src/pages/signoff.ts` | `render()` 算一次 `view`，餵給 `syncChrome` / `heroHtml` / `stageListHtml`；CTA 改由 `signoffCta` 決定 |

三個關鍵決定：

1. **預覽與真的送審跑同一支 `stagesFromWorkflow`。** 讓 UI 照著 `WorkflowStageDef`
   自己再刻一份關卡，就是把「畫面說的跟實際跑的不是同一件事」重新種一次。要讓兩邊
   講不同的話，現在得先讓同一支函式對同樣的輸入回不同的答案。
2. **關卡列 HTML 搬出頁面。** 這個缺陷的形狀只有「同時持有兩邊」的合約測試抓得住，
   而測試呼叫得到那支函式的前提，是它不再埋在一個要先過 `requireAuth()` 的頁面裡。
   （Wave 2 學到的第 2 點：source-grep 的解析度到「函式」為止。）
3. **預覽狀態下一顆動作按鈕都不給。** 核准／要求修改／保留意見／略過會被
   `approveAndLock` 的 `NOT_SUBMITTED` 全數擋下；改派與執行分析則是那些關卡 id
   根本還不存在於 `state.cases`。頭條的 CTA 改走 `sum.state === "draft"` 那條
   「去編輯台送審 →」——`draft` 判斷**排到 `sum.mine.length` 之前**，那就是截圖裡
   「核准『工程』→」的來源。

### 文案（逐字，先確認行為才寫）

- 頭條（`PREVIEW_DETAIL(n)`）：
  > 這是預覽 —— 送出審閱時才會照現在的範本建立這 N 關，屆時會逐關問你派給誰。
- 關卡列標頭：`關卡（預覽）` ／ 計數 `N 關 · 尚未建立` ／ 每一列的徽章 `預覽`
- 關卡列說明（`PREVIEW_COPY.banner`）：
  > 這個案子還沒送出審閱，關卡也還沒建立。下面是送出審閱時會照現在的範本建立的那一份 —— 送出時會逐關問你派給誰。
- 關卡列結尾（`PREVIEW_COPY.note`）：
  > 所以現在沒有可以簽的關卡。到編輯台按「送出審閱」，這幾關才會真的建立起來。
- 沒有預設執行者的關卡寫 **「送審時指派」**，不寫「待指派」——後者聽起來像一個
  已經存在、正在等人的關卡。

### 哪條測試釘住（`tests/signoff-preview.test.ts`，+16）

| 測試 | 釘的是什麼 |
|------|------------|
| `addProject 開的個案關卡 ≠ submitPlan 會建立的關卡` | **缺陷的前提**。哪天有人改掉建個案的時機，這條會紅 —— 那時整個預覽機制該重新想，而不是靜靜繼續畫預覽 |
| `HTML 裡的關卡名，逐字等於 submitPlan().stages 的關卡名` | 主合約。名字從**產出的 HTML** 讀回來，不從參數反推 —— 反推就退回成一條只驗 store 的測試 |
| `五類骨架各自不同，而畫面每一種都跟著 submitPlan 走` | 防「剛好只有一種對」 |
| `送審之後真的長出來的關卡，跟送審前預覽的那一份逐欄相同` | 比對整個 `CaseStage`（含 id），不只名字。做得到是因為兩邊同一支 `stagesFromWorkflow` |
| `HTML 不含 data-sg-act / data-sg-confirm` | 註定被擋下的四顆鈕 |
| `不含 data-sg-assign / data-sg-analyze`，且那些 stage id 真的不在 `state.cases` 裡 | 改派與分析同理，而且**驗到 id 真的還不存在**，不是只驗畫面 |
| `頭條的主要按鈕不是「核准某一關」，而是「去編輯台送審」` | 先斷言 `sum.mine.length > 0`（缺陷正是從這裡長出來的），再要求 CTA 不是它 |
| `預覽那句話裡的關卡數，等於 submitPlan().stages.length` | **文案／行為雙向合約**：先問 store 送審會建立幾關，才允許斷言那句話 |
| `三件事一句都不能少` + `關卡列上也講得出這是預覽` | 頭條可以被捲出畫面，關卡列自己也要站得住 |
| `送審之後 preview 為 false，畫的就是個案自己那一份` 等三條 | 回歸保護：簽核鈕、改派下拉、頭條文案都要回來 |
| `抽單的案子：頭條照樣講「已抽單」，而且一顆 CTA 都沒有` | 見下面的邊界 |

### 既有測試的改動（逐條，沒有靜默改掉的）

| # | 檔案：測試 | 原本 | 改成 | 變嚴還變鬆 |
|---|-----------|------|------|-----------|
| 1 | `wave2-review-fixes.test.ts`：`signoff.ts 真的把整批畫出來` → 更名 `關卡列真的把整批畫出來` | 三條斷言讀 `SIGNOFF_SRC` | 同樣三條改讀 `SIGNOFF_STAGES_SRC`，**外加** `SIGNOFF_SRC` 必含 `stageListHtmlOf({` 且**不得**再含 `stageAnalysisJobs({` | **變嚴**。原意（關卡列畫整批、不是只畫一張）一字未改，只是那段程式碼換了檔案；新增的兩條防的是「三條斷言在一個沒有人呼叫的模組上全綠」—— 那正是 Wave 1 F0 的形狀 |
| 2 | `agent-popup.test.ts`：`顯示與 pop-up 用共用函式` | `SIGNOFF_SRC` 必含 `stageAnalysisRowHtml(` | 改成 `lib/signoff-stages.ts` 必含它，**外加** `SIGNOFF_SRC` 必含 `stageListHtmlOf({` | **變嚴**，理由同上。`agentResultDialogHtml` / `pendingGateHtml` 兩條原封不動（那兩支還在頁面裡） |

**其餘既有測試零改動、零刪除、零弱化。** 1773 條全部照原樣通過。

### 一個要知道的邊界：抽單的案子也是預覽

`submitPlanFor` 的 `live` 取不到抽單的個案（`existing && !existing.withdrawn`），
所以抽單的案子一律 `landsNow === true` —— 而這是**對的**：重送審確實會整份重建，
連原本簽過的關卡一起換掉。所以簽核頁對抽單的案子也畫預覽。

三件事保持不變、而且有測試釘住：頭條照樣先講「此案已抽單」（`withdrawn` 分支排在
`draft` 之前）、**一顆 CTA 都沒有**、簽核紀錄時間軸仍然讀**真的**那份個案，
歷史一筆都沒少。

### 這一輪**沒有**做的驗證（誠實揭露）

**沒有跑真 Chrome。** `interceptor open` 回 `no extensions connected`（Chrome 擴充沒接上），
試一次就停，沒有繞路。所以**機器沒驗到的是版面**：關卡列多了兩段長句
（`banner` 與 `note`）與每列一顆「預覽」徽章，在窄視窗下會不會換行破版沒有人看過。
列進下面的 UAT（P-3）。

行為面則是由測試證明的，包含那條同時持有文案與行為的合約測試。

### 建議的 UAT 題目

**P-1「新建一個專案，簽核頁講的是送審時真的會建立的那一份」** ← 這題就是 Scott 這次看到的畫面

流程：
1. 新建一個專案（或挑一個**還沒送過審**的），到編輯台套一份範本（例如「技術規格」）
2. 直接進簽核管理頁，**先不要送審**

預期：關卡**不再**是「工程／設計／資安／法務」那四關，而是這份範本自己的關卡
（技術規格 → 設計取捨審查／規格一致性／我核准）。標頭寫「關卡（預覽）」、
右邊寫「N 關 · 尚未建立」、每一列右側是灰色的「預覽」徽章。
頭條那句話變成「這是預覽 —— 送出審閱時才會照現在的範本建立這 N 關，屆時會逐關問你派給誰。」
**畫面上不得再出現**「流程有 4 關。到編輯台按『送出審閱』之後才會開始跑。」

**P-2「預覽狀態下沒有任何按得下去的簽核動作」**

流程：承 P-1，在簽核頁上找核准／要求修改／保留意見／略過、改派下拉、執行分析

預期：**一顆都沒有**。頭條的主要按鈕是「去編輯台送審 →」，**不是**「核准『工程』→」。
（舊版那顆按下去會跳「這個案子還沒送出審閱」—— 這題就是把那顆鈕拿掉。）

**P-3「版面：兩段長說明與『預覽』徽章不破版」**（機器沒驗到的那一項）

流程：承 P-1，把視窗拉窄到大約手機寬，再拉回全寬；關卡列上下捲一遍

預期：關卡列裡那兩段說明正常換行、不橫向捲動；每一列的「第幾關 / 關卡名 / 執行者 /
預覽徽章」不互相擠壓、不重疊。

**P-4「送出審閱之後，畫面上那幾關逐字沒變」** ← 這題是整個修復的重點

流程：
1. 承 P-1，**先把畫面上那幾關的名字抄下來**
2. 到編輯台按「送出審閱」，走完逐關指派對話框
3. 回簽核頁

預期：關卡名**逐字就是剛才抄下來的那幾個**（順序也一樣），不再是「送出去才發現換了一套」。
「（預覽）」與「預覽」徽章消失、計數變回「x/y 必簽已結案」、核准／要求修改／改派下拉
全部回來、頭條不再講「預覽」。

**P-5「已經在跑的案子完全沒被動到」**（回歸）

流程：挑一個**已經送過審、甚至簽過一關**的專案，開簽核頁

預期：跟這次改動之前**一模一樣** —— 沒有「預覽」字樣，簽核鈕、改派、執行分析、
Agent 分析列、簽核紀錄全部照舊。

**P-6「抽單的案子：先講已抽單，關卡列是預覽」**（已知邊界，測到請照這裡判定）

流程：對一個送過審的案子抽單，然後開簽核頁

預期：頭條寫「此案已抽單」＋抽單理由，**沒有任何主要按鈕**；下面的關卡列顯示的是
「重送審會建立的那一份」（預覽樣式）—— 這是設計上的已知後果（重送審確實會整份重建），
不是 bug。**簽核紀錄的時間軸仍然完整**，抽單前的每一筆決策都還在。
