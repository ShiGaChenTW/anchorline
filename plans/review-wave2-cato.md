# Wave 2 跨 context 審查報告（Cato）

- 審查者：Cato（未參與 Wave 2 實作、未看過設計討論）
- 標的：`d9603f6..d33a7ae`（b84c262 W2-A / d3e1802 W2-B / d33a7ae W2-C）
- 日期：2026-08-26
- 狀態：**完成**
- 結論：**2 條 major（C-1、C-3）、2 條 minor（C-2、C-4；C-4 附帶一個會讓管理中心整頁停止 render 的 TypeError）、4 條疑慮（D-1～D-4）**

## 進度表

| # | 查核項 | 狀態 |
|---|--------|------|
| 1 | `submitPlan()` vs `submitForReview` 是否共用同一段判斷 | ✅ 查過，沒發現（見 §A） |
| 2 | S1 結案閘門：繞過路徑／死鎖 | ✅ 查過，store 層沒繞過路徑；UI 層有一條（C-1） |
| 3 | `isPendingAgentJob` 四條件 vs 舊資料 | ✅ 查過，沒發現（見 §A） |
| 4 | `edit` 關卡落地目標三處是否同一欄位 | ✅ 查過，三處確實收斂到 `resolveEditTarget`，沒發現 |
| 5 | XSS：`askCustom` bodyHtml 全路徑 escape | ✅ 一處未 escape（C-4），其餘乾淨 |
| 6 | `askCustom` dialog lock 洩漏／重入 | ✅ 找到 C-1（實錘）、C-2（疑慮） |
| 7 | 權限閘門 | ✅ `saveAgentResult` 正確；D-1／D-2 兩條要拍板 |
| 8 | 測試守門的真實強度 | ✅ 見 §E（148 pass／0 fail，實跑過） |

---

## A. 查過、沒發現問題的區塊

以下每一條都實際追過生產呼叫鏈，不是只看註解。

- **`submitPlan()` / `submitForReview()` 共用判斷**——兩者都呼叫同一支
  `submitPlanFor(id)`（store.ts:231-266），連 id 解析都逐字一致
  （`projectId ?? state.activeProjectId ?? "p1"`，store.ts:2762 vs 2773）。
  `submitForReview` 內已無第二份 `caseHasRun` 判斷。**沒有分岔。**
- **`assignments` 真的送得到底**——`editor.ts:1419` →
  `store.submitForReview(undefined, commit.version!.id, assignments)` →
  `submitPlanFor` 判 `landsNow` → `caseFromWorkflow(id, landed, employees, assignments)`
  （store.ts:2782）→ `w.id in assignments` 逐關套用（store.ts:429）。
  **Wave 1 的 F0 形狀在這條路上沒有重演。**
- **`isPendingAgentJob` 對舊工作單**——用 `jobLanded(j) === "pending"` 而不是
  `j.landed === "pending"`（types.ts:89-93）。`jobLanded` 把沒有 `landed` 欄位的舊單
  算成 `saved`，所以舊單**不會**變成擋門的幽靈。另外三個條件（`stageId`、
  `status === "done"`、`result` 非空）與 `saveAgentResult` 的拒絕條件對得起來，
  沒有「擋得住但拍不掉」的組合。**查過，沒發現。**
- **`locked: true` 的第三條路**——全檔 grep `locked`（store.ts 29 處），寫入
  `locked: allDone` 的只有 `approveAndLock`(2537/2543) 與 `skipStage`(2727/2734)，
  兩支都在寫 state 之前放了閘門。其餘全是 `locked: false`
  （`requestChanges` / `withdrawCase` / `reopenCase` / `applyWorkflowToCase` /
  `submitForReview`）。**沒有第三條路繞過閘門。**
- **永遠結不了案的死鎖**——`discardAgentResult`（store.ts:3792）**完全沒有閘門**
  （不看 locked／withdrawn／權限／關卡是否存在），所以閘門永遠有出口。
  代價見 §D-1。
- **`escapeHtml` 沒有 escape 單引號**（ui.ts:23-29），但這批新增的 HTML 屬性
  **全部用雙引號**（submit-assign.ts、agent-result.ts、workflow-admin.ts 逐行看過）。
  **查過，沒發現。**
- **`edit` 落地目標三處收斂**——指派警語（submit-assign.ts:165 → `editTargetLabel`
  → `resolveEditTarget`）、pop-up 左欄現值（signoff.ts `currentValueFor` →
  `resolveEditTarget`）與欄位名（agent-result.ts:87 → `editTargetLabel`）、
  真正寫入（store.ts:3703 → `resolveEditTarget`）**確實是同一支**。
  `caseFromWorkflow` 也把 `editTarget` 複製到個案上（store.ts:445），
  所以流程定義事後被改也不會讓三者分岔。**這一條宣稱是真的。**

---

## C. 缺陷

### C-1（major）自動跳窗會吃掉 dialog lock，S1 攔截對話框整個不出現，且丟出沒人接的 rejection

- **檔案:行號**：`src/pages/signoff.ts:493`（`render()` 尾端的 `maybeAutoShow(p)`）
  與 `src/pages/signoff.ts:553-558`（閘門被擋時 `render(); void handlePendingGate(p);`）
- **重現路徑**：
  1. 在關卡 A 按「Agent 分析」，跑完 → `render()` → `maybeAutoShow` 自動跳窗（鎖被拿走），
     `autoShown = {A}`。
  2. 在窗還開著時，關卡 B 的分析也跑完 → `render()` → `maybeAutoShow` 因
     `isDialogOpen()` 為 true 而 **return，且刻意不把 B 記進 `autoShown`**
     （signoff.ts:424-428 的註解自己寫明這是設計，實作在 :429）。
  3. 使用者在 A 的窗按「稍後再決定」。`showAgentResult` 對 cancel 直接 return、
     **不呼叫 `render()`**，所以 B 不會補跳。
  4. 使用者去簽最後一關 → `approveAndLock` 回 `pendingJobs: 2` →
     UI 走 `render()`：這一次 `maybeAutoShow` 找到 B（不在 `autoShown` 裡）→
     **同步呼叫 `askCustom` 拿走鎖**。
  5. 緊接著的 `void handlePendingGate(p)` 呼叫 `askCustom` → `rejectIfBusy()`
     throw「已有對話框開啟」→ 因為是 `void` 的 async 呼叫，**沒有人接**。
- **後果**：S1 那個「還有 N 份分析沒拍板」的清單對話框**在這條路上永遠不出現**；
  使用者看到的是 B 這一張的結果窗（沒有任何一句話說明他剛才的簽核被擋了），
  外加一個 unhandled promise rejection。`loading-overlay.ts:103` 明講這個 repo
  **刻意不攔 `unhandledrejection`**，所以它只會沉到 console。
- **為什麼測試沒抓到**：`tests/pending-gate.test.ts` 測的是
  `pendingGateItems` / `pendingGateHtml` 這兩支純函式，以及 store 端的閘門回傳值。
  `maybeAutoShow` 與 `handlePendingGate` 的**時序**沒有任何覆蓋——headless 沒有 DOM，
  而 source-grep 型測試只能證明「這兩支被呼叫了」，證明不了「它們搶同一把鎖」。
- **可行的修法方向**（不是我要改，只是指出成本）：`handlePendingGate` 這條路上
  先讓 `maybeAutoShow` 讓位（例如 `render()` 帶一個 `skipAutoShow` 旗標），
  或把 `void handlePendingGate(p)` 改成 `.catch(() => {})` 至少不要丟。

### C-2（minor）`onMount` / `read` 丟例外會同時洩漏鎖與留下拔不掉的對話框

- **檔案:行號**：`src/lib/ask.ts:223-224`（`finish()` 內先跑 `opts.read?.(back)`，
  才 `removeEventListener` / `back.remove()` / `releaseDialogLock()`）與
  `src/lib/ask.ts:291`（`opts.onMount?.(back)` 在 Promise executor 尾端）
- **重現路徑**：目前生產端的兩個 `read`（`readAssignments`、
  `handlePendingGate` 的 `() => picked`）與唯一的 `onMount` 都不會丟，
  所以**現在踩不到**。但 `finish()` 裡 `closed = true` 已經先設好，read 一丟例外，
  `back.remove()` 與 `releaseDialogLock()` 就都不會跑：對話框留在畫面上、
  document 層的 keydown 攔截器留著（全 App 熱鍵從此失效）、鎖永久佔住
  （之後每一次 `askCustom` 都 throw）。`onMount` 丟例外則是 executor throw →
  promise reject → `askCustom` 的 catch 會放鎖，但 `back` 已經 append 上去，
  **沒有人移除它**。
- **為什麼測試沒抓到**：`tests/ask.test.ts` 測的是 `mapOutcome` / `resolveLabels` /
  lock 三支純函式，`openDialog` 本身沒有 DOM 可測。
- **這是「疑慮」不是實錘**：我講不出一條使用者操作能讓現有的 read/onMount 丟例外。
  列出來是因為 `askCustom` 被定位成共用地基，下一個呼叫端很容易在 `read` 裡
  寫一行會丟的解析。

### C-1 補充：更乾淨的重現路徑（不需要競態）

`autoShown` 是記憶體內的 Set，重新載入頁面就空了：

1. 專案有 **2 份**待拍板分析（跨 session 留下來的，`agentJobs` 有進 localStorage）。
2. 開簽核頁 → `render()` → `maybeAutoShow` 自動跳出**最新那一份**（J2），
   `autoShown = {J2}`；J1 沒被標記。
3. 使用者按「稍後再決定」。cancel 分支直接 return，**不 render**，所以 J1 不會補跳。
4. 去簽最後一關 → 閘門擋下（`pendingJobs: 2`）→ `render()` →
   `maybeAutoShow` 找到 J1 → 拿走鎖 → 隨後的 `handlePendingGate` throw。

**沒有時序競態，兩份待拍板 + 按一次「稍後再決定」就重現。**

---

### C-3（major）待拍板的工作單會從關卡列上消失，而閘門照樣擋

- **檔案:行號**：`src/pages/signoff.ts:169`（`const job = isAgent ? stageAnalysis(...) : null`）
  ＋ `src/lib/signoff.ts:413`（`stageAnalysis` 只回**最新一筆**）
  ＋ `src/data/types.ts:89`（`isPendingAgentJob` 不看指派對象、不看新舊）
- **兩條重現路徑**：
  - **(a) 重新分析**：關卡 S 的分析跑完（J1，pending），使用者覺得結論不好，
    按「重新分析」（那顆鈕**沒有**因為 J1 還沒拍板而停用，signoff.ts:171-176）→ J2 跑完。
    關卡列只畫得出 J2（`stageAnalysis` 回最新一筆），**J1 在頁面上完全看不到**。
    `pendingAgentJobs` 兩份都算 → 結案被擋「還有 2 份沒拍板」，
    而使用者盯著關卡列只看得到 1 份。
  - **(b) 改派**：關卡 S 的 agent 分析跑完（pending），使用者把 S 改派給人
    （`data-sg-assign` 下拉）→ `isAgent` 變 false → `job` 變 `null` →
    `stageAnalysisRowHtml` 收到 `job: null` 直接回空字串（agent-result.ts:125）→
    **整行分析連同「查看結果」鈕一起消失**，但工作單仍然 pending、仍然擋結案。
- **後果**：唯一還看得到這些工作單的地方是 S1 攔截對話框。而 C-1 正好會在
  相當一部分情況下把那個對話框吃掉 —— 兩條合起來，使用者會遇到
  「簽核被擋、訊息一閃而過、關卡列上找不到任何待處理的東西」。
- **為什麼測試沒抓到**：`tests/agent-popup.test.ts` 對 `stageAnalysisRowHtml`
  的測試都直接餵 `job`，沒有一條走 signoff.ts 那個 `isAgent ? ... : null` 的
  選擇邏輯；`pendingAgentJobsOf` 的測試也只驗四個條件本身。
  **「這個 job 在畫面上出不出得來」與「這個 job 擋不擋結案」是兩套獨立的判斷，
  而沒有任何一條測試同時碰過它們。**這是這批最典型的「呼叫了，但在死路徑上」。

---

### C-4（minor）匯入的工作區 JSON 可以在指派對話框注入 HTML

- **檔案:行號**：`src/lib/submit-assign.ts:170`
  （`<span class="assign-order">${s.order}</span>`，**這批新增的 bodyHtml 路徑上
  唯一一處沒有 escape 的插值**）。同一類還有
  `src/pages/admin.ts`（`renderLandedFlows` / `stageRowHtml` 的
  `${String(s.order).padStart(2,"0")}`）與既有的 `<option value="${e.id}"`。
- **重現路徑**：
  1. `設定 → 匯入工作區 JSON`（`src/pages/settings.ts:924-940`）讀進一份檔案，
     直接呼叫 `store.importState(parsed)`。
  2. `importState`（store.ts:3138）**只淺合併，完全不收斂**
     `projects[].workflowStages` 的元素形狀 —— 相對的，`load()` 那條路有
     `sanitizeProject` / `sanitizeSkeletons`，匯入這條沒有。
  3. 檔案裡把 `projects[0].workflowStages[0].order` 設成一段 HTML。
  4. 打開那個專案、按「送出審閱」。**條件**：這個案子要落在
     `project.workflowStages` 已存在但 `caseHasRun` 仍為 false 的狀態
     （送過一次審、沒有人簽），此時 `submitPlanFor` 回傳的是
     **原封不動的 `project.workflowStages`**（store.ts:253-256），
     不走 `resolveWorkflow` 的 `order: i + 1` 重編（workflow-resolve.ts:86）。
     ——這正是 W2-C「重新套用範本」那顆鈕存在的那個狀態，不是罕見組合。
  5. 對話框把那段 HTML 原樣塞進 `askCustom` 的 `bodyHtml`。
- **同一個輸入的第二個後果（更容易踩）**：匯入的 JSON 若缺 `kind` / `defaultActor`
  （例如 Wave 1 之前產生的匯出檔），`admin.ts` 的
  `escapeHtml(STAGE_KIND_LABEL[s.kind])` 會拿到 `undefined` →
  `undefined.replace` **TypeError** → `renderLandedFlows` 整支炸掉 →
  `render()` 中斷、`renderCases()` 不再執行，而且它掛在 `store.subscribe` 上，
  **之後每一次狀態變動都再炸一次**。管理中心從此半殘。
- **為什麼是 minor 不是 critical**：需要使用者主動匯入一份別人給的工作區 JSON
  （或手改 localStorage）。這是桌面單機工具，威脅模型上比較接近「別開來路不明的檔」。
  但我要指出：**`load()` 那條路花了三段註解在講「漏了收斂會怎樣」，匯入那條路
  一行都沒有**，而兩條吃的是同一份資料。
- **為什麼測試沒抓到**：所有 XSS 相關測試都是對 `assignDialogHtml` 餵型別正確的
  `WorkflowStageDef`（`order` 是 number），驗 `escapeHtml` 有沒有作用在
  `name` / 員工名上。沒有一條測試餵一個**型別謊報**的物件。
- **答覆你的第 5 條**：除了這一處，`assignDialogHtml` / `agentResultDialogHtml` /
  `pendingGateHtml` / `workflow-admin.ts` 的產出**我逐行看過，其餘全部 escape 了**，
  而且新程式碼的屬性一律用雙引號（`escapeHtml` 不處理 `'`，這一點成立）。

---

## D. 疑慮（講不出使用者操作路徑，或後果我不確定）

### D-1（疑慮）`discardAgentResult` 是唯一沒有任何閘門的落地 API，而 W2-B 把它變成一顆按得到的鈕

- **檔案:行號**：`src/data/store.ts:3792-3806`
- **事實**：`saveAgentResult` 補了六道閘門（專案存在／關卡存在／`withdrawn`／
  `locked`／`project.status === "review"`／`edit` 要 `canEditContent`）。
  `discardAgentResult` 一道都沒有：不看角色、不看鎖定、不看抽單。
  Wave 1 時它在 `src/pages/` 零呼叫端，所以這不重要；**W2-B 把它接成
  pop-up 上的「不採用」，於是它變成 approver（不可改內文）也按得到的按鈕**。
- **為什麼我標成疑慮**：這個 App 的角色只有 admin／approver／editor 三種，
  沒有純唯讀角色，而 approver 本來就有權對這個案子做結案決策。
  「approver 可以把一份分析標成不採用」算不算越權，是產品決定，不是我判得了的。
- **可驗證的部分**：`discardAgentResult` 之後 UI **沒有回頭路**
  （`stageAnalysisRowHtml` 的 discarded 分支不畫「查看結果」鈕），
  但 store 其實還允許 `saveAgentResult`（它只擋 `saved`）。
  也就是「不採用」在畫面上是不可逆的，在資料上不是。這個落差值得拍板一次。

### D-2（疑慮）`setWorkflowSkeleton` / `resetWorkflowSkeleton` 沒有角色閘門，而同一個 commit 的 `reapplyWorkflow` 有

- **檔案:行號**：`src/data/store.ts:2919`（`setWorkflowSkeleton`，只驗 cat／非空／
  `hasHumanApproval`）、`:2950`（`resetWorkflowSkeleton`，零驗證）
  vs `:2968`（`reapplyWorkflow`，`accessRole !== "admin"` 直接拒絕）。
- **實際保護**：管理中心整頁被 `gate()`（`canManageUsers`，admin.ts:58-65）擋著，
  非 admin 連 DOM 都不會 render，所以**沒有使用者操作路徑**。
- **為什麼還是寫出來**：這跟既有的 `setWorkflowStages` / `addWorkflowStage` /
  `updateWorkflowStage` 一致（那三支也沒有閘門），所以不算破壞慣例。
  但同一個 commit 裡 `reapplyWorkflow` 加了 admin 檢查、隔壁兩支沒加，
  下一個讀這段程式的人會以為「有檢查的那支才是需要保護的」。要嘛三支都加，
  要嘛在 `reapplyWorkflow` 上寫清楚為什麼只有它需要。

### D-3（疑慮）結果為空字串的工作單在關卡列上顯示「待拍板」，但閘門不算它

- **檔案:行號**：`src/lib/agent-result.ts:141`（`landed === "pending"` 就畫「待拍板」
  ＋「查看結果」）vs `src/data/types.ts:89`（`isPendingAgentJob` 要求 `result.trim() !== ""`）
- **後果**：一張 `status: "done"` 但 `result` 是空字串的工作單，關卡列說「待拍板」、
  點進去按「存到這一關」會被 `saveAgentResult` 以「這張工作單沒有結果可以存」擋掉，
  唯一出路是「不採用」。閘門不擋它，所以不會卡住結案。
- **為什麼是疑慮**：我不確定 `invokeAgent` 有沒有辦法產生 `status: "done"` 且
  `result === ""` 的工作單（要看 `mark("done", result)` 那條路上 result 會不會是空）。
  講不出重現路徑，所以標疑慮。

### D-4（疑慮）自動跳窗會在「進入簽核頁」的當下就彈窗，不只在「剛跑完」的當下

- **檔案:行號**：`src/pages/signoff.ts:493`（`maybeAutoShow` 掛在每一次 `render()` 尾端）
- 註解說這是「分析剛跑完那一刻」，但 `render()` 也在頁面初次載入時跑一次，
  `autoShown` 那時是空的。所以**跨 session 留下來的待拍板分析，會在使用者
  一打開簽核頁時就把一個 modal 推到臉上**，而他當下可能是要來看別的東西。
- 這可能是刻意的（S1 的精神就是「別讓它被忘記」），所以我標疑慮不標缺陷。
  但它同時是 C-1 的前置條件，值得一起拍板。

---

## E. 測試守門強度評估（回答你的第 8 條）

`bun test tests/{submit-assign,agent-popup,pending-gate,workflow-skeletons,ask}.test.ts`
→ **148 pass / 0 fail**（我實跑過）。

**這批 source-grep 測試比我預期的強。** 它不是「字串出現過就算過」：
- `tests/submit-assign.test.ts:494` 用 `indexOf` 比較**兩個呼叫的先後順序**
  （對話框必須在 `commitForReview` 之前）——這條擋得住「呼叫了但順序錯」。
- `tests/workflow-skeletons.test.ts:645` 用 `slice(indexOf(A), indexOf(B))`
  把斷言侷限在單一函式體內，還在註解裡寫明為什麼下界要卡在 `renderCases`
  ——這條擋得住「別的地方剛好有這個字串」。
- 多條 `.not.toContain("caseHasRun(")` / `.not.toContain("SEED_WORKFLOW_SKELETONS")`
  ——負向斷言擋得住「又自己刻了一份判斷」，這正是 F0 的形狀。

**但它擋不住的，剛好就是我這次找到的三條：**

1. **擋不住「兩支各自都對，合起來搶同一把鎖」。**
   `test("自動跳窗有 isDialogOpen 守門…")` 斷言 `maybeAutoShow` 體內有
   `isDialogOpen()` 與 `autoShown.add(` —— 兩者確實都在，測試綠。
   而 C-1 的缺陷在 `maybeAutoShow` 與 `handlePendingGate` **之間**，
   不在任何一支的函式體內。source-grep 的解析度是「函式」，
   抓不到「函式與函式之間的時序」。
2. **擋不住「這個 job 畫得出來嗎」與「這個 job 擋不擋結案」的分岔（C-3）。**
   兩邊各有完整測試，但沒有一條測試同時持有兩邊。
3. **擋不住型別謊報的輸入（C-4）。** 所有測試餵的都是型別正確的物件。

**一個具體的守門弱點**（不是缺陷，是下次會漏的地方）：
`expect(ADMIN_SRC).toContain("stagePatchFrom(readStageForm(el))")` 只要求這個
字串**出現一次**，但 admin.ts 有**兩個**儲存點（全域關卡編輯器與骨架編輯器）。
今天兩處都寫對了，但只要其中一處退回舊寫法，這條測試照樣綠。
建議改成 `expect((ADMIN_SRC.match(/stagePatchFrom\(readStageForm\(/g) ?? []).length).toBe(2)`。

---

## F. 覆蓋範圍宣告（查過、沒發現問題的部分）

- `src/lib/ask.ts` 的 lock 語意：`rejectIfBusy` 在任何 `document` 存取之前、
  四支 API 的 `catch` 都會放鎖、`finish()` 有 `closed` 旗標擋重入、
  Escape／Enter／Tab 三條鍵盤路徑都 `stopImmediatePropagation`。**查過，沒發現。**
  唯一的洞是 C-2（read/onMount 丟例外），而它現在踩不到。
- `handlePendingGate` 的「查看」按鈕借 `[data-dlg="ok"]` 轉手交出 jobId：
  `finish()` 是先 `read()` → 再 `remove()` → 再 `releaseDialogLock()` → 才 `resolve`，
  所以接著開第二個窗時鎖已經放掉。**查過，沒有洩漏。**
- `stagePatchFrom` 的三條硬規則（`kind !== "edit"` 清 `editTarget`、
  章節與欄位缺一不可、認不得的聯合型別退回預設）——逐條對過
  `updateWorkflowStage` 與 `setWorkflowSkeleton` 的下游，**沒發現分岔。**
- `liveSkeletons()` 對 `resolveWorkflow` 的第三參數：`resolveWorkflowFor` 確實餵
  `liveSkeletons()`，自帶骨架的範本（`templateStages`）刻意不吃五類覆寫。
  複本（`src.map(s => ({...s}))`）避免了共用參考。**查過，沒發現。**
  （淺複製，`editTarget` 仍是共用參考——但下游沒有原地改它的路徑，不算缺陷。）
- `sanitizeSkeletons`：空陣列與不認得的分類都丟掉，回 `undefined` 而不是 `{}`。
  對得上 `setWorkflowSkeleton` 的拒絕條件。**查過，沒發現。**
- `caseFromWorkflow` 的 `w.id in assignments`：`null`（明確不派人）與
  「沒提到這一關」（退回 `defaultAssigneeId`）確實分得開，
  `readAssignments` 把空字串轉成 `null` 而不是 `""`。**查過，沒發現。**
- `skeletonLandedCounts` 三個判準（要有 `workflowStages`、自帶骨架的不算、
  沒有 `templateCat` 走 `lean`）與 `resolveWorkflow` 的 `FALLBACK_CAT` 一致。
  **查過，沒發現。**
- `review.ts` 的 `!r.pendingJobs`：確認 S1 拒絕不會誤觸代簽流程。**查過，沒發現。**
- `shared.css` 的 264 行新增：純樣式，未逐行審。**未查（宣告）。**
- `admin.html` 的 30 行新增：兩個分頁與兩個容器 id，與測試對得上。**查過，沒發現。**

---

## G. 給編排的一句話

**Wave 1 的 F0 那個形狀（新參數只有測試在傳）這一批沒有重演** —— 三條生產接線
（`editor.ts` 的 `assignments`、`signoff.ts` 的 `saveAgentResult`/`discardAgentResult`、
`admin.ts` 的 `stagePatchFrom`）我都追到底了，都是真的接上。

這一批的問題換了一種形狀：**每一支函式單看都對，錯在兩支之間**——
C-1 是 `maybeAutoShow` 與 `handlePendingGate` 搶鎖，C-3 是
「畫得出來」與「擋不擋結案」用了兩套不同的判準。source-grep 測試的解析度到函式為止，
剛好停在這一類缺陷的門口。下一輪如果要補測試，該補的不是更多 grep，
而是一層極薄的 DOM/時序替身（哪怕只是把 `askCustom` 換成一個記錄呼叫順序的 stub）。

**建議處理順序**：C-1（會讓 S1 這個 Wave 2 主打功能在真實操作下不出現）→
C-3（同上，兩條合起來使用者會找不到出口）→ C-4 → D-1/D-2 拍板 → C-2。
