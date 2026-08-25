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
  - [ ] `pendingAgentJobs` + 結案閘門（不歸 W2-A agent）
- [x] W2-A 送審指派對話框（2026-08-26；`bunx tsc --noEmit` exit 0、
      `bun test` 1651 pass / 0 fail / 83 files，基準 1612/82 → +39 測試、零退步、
      `bunx vite build` 成功。**未 commit**，交 PM 驗）
- [ ] W2-B Agent 結果 pop-up
- [ ] W2-C 管理中心流程檢視／編輯
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
