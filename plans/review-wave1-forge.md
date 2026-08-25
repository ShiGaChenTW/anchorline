# Wave 1 資料層審查 — Forge

> 審查對象：`worktree-agent-add176c78059c7034`，`432be61` → `8ee918a`（5 commits）
> 規格：`plans/Project_Anchorline__2026-08-25-2325__signoff-redesign.md`
> 審查者：Forge（GPT-5.4 家族席位）。未參與規格討論。
> 日期：2026-08-26

---

## 總結：**不能合**

卡在四條，全部是「測試綠但做的是別的東西」，其中兩條我跑出了可重現的證據：

| # | 嚴重度 | 一句話 |
|---|--------|--------|
| **F0** | **critical** | **「五類 PRD 各有自己的簽核骨架」在跑起來的 App 裡完全沒生效。** `applyFullTemplate` 新增的第 4 個 `template` 參數，**唯一的生產呼叫端 `templates.ts:535` 沒有傳**，於是 `Project.templateCat` 永遠是 `undefined`，每個專案都退回 `lean` 兩關骨架。commit `432be61` 整個是死的 |
| F1 | **critical** | `touched` 判準把「有人加註過一句意見」當成「這個案子跑過了」，於是第一次送審會沿用建專案當下的**全域舊流程**，範本骨架與「金融法遵與風險」永久不會出現，而且無法補救 |
| F4-1 | **critical** | D3 說族系隔離是主要守門，但實際的 agent 審查路徑（`invokeAgent(task:"review")` → `saveAgentResult` → 人簽核）**全程沒有任何族系檢查**。`canSignStage` 的族系規則只在 `user.kind === "agent"` 時觸發，而正常流程裡簽核的是人 |
| F3-1 | **major** | `saveAgentResult` 把 agent 全文寫進 `CaseStage.comment` —— 那個欄位已經是「簽核意見」，兩邊互相覆寫，簽核紀錄會顯示 agent 的分析全文當作簽核者留的話 |

第二項（法遵關卡來源）**無發現**，契約守住了。

---

## 0. 意外發現（不在交辦的四項裡，但擋著合併）

### F0 — critical — `src/pages/templates.ts:535` vs `src/data/store.ts:1920–1966`

commit `432be61`「五類 PRD 各有自己的簽核骨架」的整條資料流是：

```
Template.cat → applyFullTemplate(..., { cat })  → Project.templateCat
             → resolveWorkflowFor(p)            → SEED_WORKFLOW_SKELETONS[cat]
```

第一個箭頭斷了。`applyFullTemplate` 的第 4 個參數 `template?: { cat?, stages? }`
是這批新加的（`store.ts:1923–1929`），而**全 repo 唯一的生產呼叫端**
`src/pages/templates.ts:535` 是：

```ts
const r = store.applyFullTemplate(pid, applySecs, seedValuesFromTemplate(current.body));
```

三個參數。`template` 是 `undefined` → `store.ts:1958` 的
`projects: template ? … : state.projects` 走 else → **`templateCat` 與
`templateStages` 從來沒有被任何生產路徑寫入過**。
`migrateProject:527` 讀得回來的，是一個永遠不可能被寫進去的欄位。

於是 `resolveWorkflowFor`（`store.ts:164/172`）拿到的永遠是
`p?.templateCat ?? null` → `skeletonFor` 走 `FALLBACK_CAT = "lean"`
（`workflow-resolve.ts:39/45`）。

**具體失敗情境 —— 已實測**

用測試 harness 逐字複製 `templates.ts:535` 的呼叫形狀，對一個
`domain: "payment"` 的專案套用整份範本後送審：

```
生產路徑（3 參數）  templateCat = undefined
生產路徑落地關卡    ["AI 結構審查", "金融法遵與風險", "我核准"]

測試路徑（4 參數）  templateCat = "enterprise"
測試路徑落地關卡    ["結構完整度", "風險與相依", "技術可行性", "文件補完", "金融法遵與風險", "我核准"]
```

不管使用者套的是十份整份範本裡的哪一份 —— PR/FAQ、六頁備忘錄、Google Design
Doc、傳統完整 PRD —— **落地的都是 lean 那兩關**。規格「本次要產出的內容」
那整張五類表，在真實 App 裡只有一類會出現。

**為什麼 1563 個測試沒抓到**：`tests/workflow-landing.test.ts:47` 的
`freshProject()` helper 直接呼叫
`store.applyFullTemplate(id, sections, {}, { cat })` —— **四個參數**。
那個測試檔裡標題寫著「五類範本各自落地不同的流程 —— 這是整個改動的目的」
（`workflow-landing.test.ts:96`）的那條測試，驗的是一條生產程式碼走不到的路徑。
測試與實作出自同一個人對規格的同一份理解，兩邊都只想到 store 這一層，
`templates.ts` 那一行沒有人回頭改。

**修法**（一行）：

```ts
const r = store.applyFullTemplate(pid, applySecs, seedValuesFromTemplate(current.body), {
  cat: current.cat as FullCat,
  stages: current.stages,
});
```

`Template.cat` 是 `TemplateCat = SectionCat | FullCat`（`types.ts:392`），
套整份範本時才是 `FullCat`。`resolveWorkflow` 對認不得的分類已經有
退回 `lean` 的處理（`workflow-resolve.ts:32–39`），所以傳章節範本的 `cat`
進去是安全的 —— 但既然這個呼叫點只處理整份範本，加個 `current.kind === "full"`
的守衛會更誠實。

**修完之後必須補一條測試，從 `templates.ts` 的呼叫形狀出發**，
否則同樣的縫會再裂一次。

---

## 1. 個案重建判準

### F1 — critical — `src/data/store.ts:2586–2607`

```ts
const touched = Boolean(
  live &&
    (live.reviewCommitId ||
      live.log?.length ||
      live.stages.some((x) => x.state === "approved" || x.state === "changes_requested")),
);
```

判準的語意應該是「這個案子已經真的在跑」，但 `live.log?.length` 把
**`addStageComment`（`store.ts:2480`）** 也算了進去。那支函式沒有任何權限閘門、
沒有檢查專案狀態、沒有檢查 `withdrawn` / `locked`，只往 `c.log` 追加一筆
`kind: "comment"` 的決策。它不代表任何關卡跑過。

**具體失敗情境**

1. 新建專案 P，`domain: "payment"`，套用整份 enterprise 範本
   → `applyFullTemplate(..., { cat: "enterprise" })` 寫入 `templateCat`
   → 同時 `addProject` 已經用**全域** `SEED_WORKFLOW_PROD`（工程／設計／資安／法務，`seed.ts:324`）
     開好了一個個案
2. 還沒送審，先在簽核頁對「工程」那一關**加註一句意見**（`addStageComment`）
3. `live.log.length === 1` → `touched === true`
4. 按「送出審閱」
   - `project.workflowStages` 尚未存在 → 走 `touched` 分支 → `landed = workflowFromCase(live)`
   - `c = live`（不重建）
   - `store.ts:2643` 把那份反推出來的**舊全域流程**永久寫進 `project.workflowStages`

**已實測**（同一支 harness，`domain: "payment"` + 4 參數套用 enterprise 範本）：

```
建專案當下個案      ["工程", "設計", "資安", "法務"]     ← 全域 SEED_WORKFLOW_PROD
addStageComment     {"ok":true}                          ← 無任何權限／狀態閘門
送審後個案          ["工程", "設計", "資安", "法務"]     ← 沒有重建
永久落地            ["工程", "設計", "資安", "法務"]     ← 寫死進 project.workflowStages

對照組（不加註）    ["結構完整度","風險與相依","技術可行性","文件補完","金融法遵與風險","我核准"]
```

**得到的錯結果**：這個 payment / enterprise 專案跑的是「工程 → 設計 → 資安 → 法務」，
而不是規格要求的「結構完整度 → 風險與相依 → 技術可行性 → 文件補完 →
**金融法遵與風險** → 我核准」。合規關卡完全不存在，而且畫面上沒有任何提示。
之後重新套範本也救不回來 —— `store.ts:2643` 是 `p.workflowStages ?? landed`，
落地過就不再覆寫。

同一條路徑還有兩個更容易踩到的入口，症狀一模一樣：
- `approveAndLock`（`store.ts:2304`）不檢查 `project.status`。草稿專案的個案第一關
  `state: "empty"`，`open()` 涵蓋 `empty`，admin 走 `canSignStage` 一路放行 →
  簽掉一關 → `touched = true`。
- `requestChanges`（`store.ts:2416`）同樣不看專案狀態。

**建議**：`touched` 應該問的是「這個個案是不是**依現行落地流程**建立的」，
而不是「有沒有人在它上面留下痕跡」。最小修法是把判準改成
「`project.workflowStages` 已存在」＋「`reviewCommitId` 或有 `approve`/`changes`
類決策」，把 `kind: "comment"` 這種不改變流程狀態的紀錄排除在外。

### F2 — major — `src/data/store.ts:2586` / `3408`

`touched` 沒有把**「已經存過 agent 分析」**算成痕跡。

`saveAgentResult` 對 `review` 關卡的落地方式是寫 `CaseStage.comment`
（`store.ts:3408`）。這個寫入不碰 `c.log`、不改 `state`、不動 `reviewCommitId`。

**具體失敗情境**：新建專案 → 簽核頁對某一關「執行分析」（`invokeAgent` 不檢查
專案狀態，只要有 `stageId` 就綁得上）→ 跑完按「存檔」→ `stage.comment` = 分析全文
→ 送出審閱 → `touched === false` → `store.ts:2607` 用 `caseFromWorkflow` **整個重建個案**
→ 剛存下的分析全文靜默消失，工作單卻仍標著 `landed: "saved"`，
`discardAgentResult` 也因為 `landed === "saved"` 而拒絕重來。

**得到的錯結果**：使用者按過「存檔」、系統回 `{ok:true}`、`agent.result.saved`
審計事件也寫了，但文件上什麼都沒有，而且沒有任何一條路徑能把它救回來。

### F3 — minor — `src/data/store.ts:2586`

`touched` 也漏了 `state === "skipped"`。`skipStage`（`store.ts:2517`）會把非必簽關卡
設成 `skipped` 並往 `log` 追加一筆 —— 因為有 log，實際上被 F1 那條「誤判為 touched」
的路徑蓋掉了，所以現在不會出錯。但兩個判準互相補償是巧合不是設計：修 F1 時
如果只是把 `log` 拿掉，`skipped` 就會變成真的漏網。修 F1 時請一併補上。

### 其他已查、無發現

- `withdrawn` 個案重送：`live` 為 `undefined` → `touched === false` → 重建。
  `project.workflowStages` 已落地時關卡 id 是 `cs-${w.id}-${projectId}`，**穩定**，
  `signoffTimeline` 接得起來。（決策 log 在抽單重送時會整段遺失，但那是既有行為，
  不是這批引入的。）
- 舊資料（跑到一半、無 `workflowStages`）走 `workflowFromCase` 保留原 stageId ——
  這條做對了。

---

## 2. 法遵關卡的來源

### 無發現。契約守住了。

逐條查證：

| 檢查 | 結果 |
|------|------|
| 四份 `.md` 是否真的宣告 `stages:` | ✅ `payment.md:104` / `lending.md:109` / `wealth.md:122` / `digital_account.md:91`，四份 frontmatter 逐字相同（`id: ws-fin-compliance`、`name: 金融法遵與風險`、`required: true`、`mode: sequential`、`kind: review`、`defaultActor: agent`） |
| 解析是否走 frontmatter | ✅ `domain-pack.ts:43` 型別 → `parseDomainPack` 走 `parseYaml`，`resolveDomain` 沿繼承鏈 `stages.push(...)`（`domain-pack.ts:195–203`）→ `store.domainStages()` → `resolveWorkflowFor` |
| `resolveWorkflow` 有沒有寫死金融判斷 | ✅ 沒有。`workflow-resolve.ts:63–87` 全篇沒有 `payment`/`lending`/`wealth`/`digital_account` 任何字樣，也沒有引用 `FINANCIAL_COMPLIANCE_STAGE_NAME` |
| `FINANCIAL_COMPLIANCE_STAGE_NAME` 常數有沒有滲進邏輯 | ✅ 只在 `tests/domain-pack.test.ts` 與 `tests/workflow-resolve.test.ts` 被引用，production code 零使用 |
| `generic` 是否不追加 | ✅ `generic.md` / `_base.md` 都沒有 `stages:` 區塊 |
| 「加一個 .md 就加一個領域」 | ✅ 新領域只要在 frontmatter 寫 `stages:` 就會疊上去，`resolveWorkflow` 不需要改 |

有一處**寫死但正確**：`HUMAN_APPROVAL_STAGE_NAME`（`seed.ts:337` 附近）被
`resolveWorkflow` 當成排序錨點與去重鍵。這是合併語意的一部分（我核准殿後），
不是領域知識，留在程式裡是對的。

一個**未觸發但存在**的脆弱點（不列為發現，供記錄）：去重鍵只有 `name`，
不含 `id`。若日後某個領域包宣告的 `stages[].id` 撞到骨架的 id（例如 `ws-ent-risk`）
但用了不同的 `name`，`caseFromWorkflow` 會產出兩個 `id` 相同的 `CaseStage`
（`cs-ws-ent-risk-p1`），`approveAndLock` 的 `only.has(s.id)` 會一次簽掉兩關。
目前四份 `.md` 都用 `ws-fin-compliance`，撞不到；但 `parseDomainPack` 的驗證
（`domain-pack.ts:137–147`）只檢查 `id` 非空，沒檢查是否與骨架衝突。

---

## 3. 副作用是否真的移乾淨

### 移除本身：乾淨。

`invokeAgent` 舊有的兩段自動寫入（`edit`/`coach` → `open.oq`，`review`/`approve` → 貼留言）
確實整段刪除，換成 `mark("done", result)` + `landed: "pending"`。
全檔 grep 確認 `store.ts` 只剩三個地方碰這兩個目標：
`store.ts:2185`（`addComment`，人手動）、`store.ts:3418`（`saveAgentResult` 的
無關卡分支）、`store.ts:3383–3400`（`saveAgentResult` 的 `edit` 分支）。
`src/pages/` 下沒有任何自動呼叫 `saveAgentResult` 的路徑。**這一半做對了。**

但落地端引入了三個新問題：

### F3-1 — critical — `src/data/store.ts:3408` vs `store.ts:2344`

`saveAgentResult` 的 `review` 分支把 `job.result.slice(0, 4000)` 寫進
`CaseStage.comment`。而 `CaseStage.comment` 在型別上定義為
**「簽核意見。核准時可留一句話，會進簽核紀錄」**（`types.ts:279`），
`approveAndLock` 的 `sign()`（`store.ts:2344`）、`requestChanges`、`skipStage`
都寫同一個欄位。兩邊互相覆寫。

**具體失敗情境 A（簽核意見被 agent 全文吃掉）**
1. 送審，「風險與相依」關卡指派 agent，執行分析（工作單停在 `landed: "pending"`）
2. 使用者先按核准，留言「已確認，第 3 點下一版處理」→ `stage.comment = "已確認，第 3 點下一版處理"`
3. 使用者回頭把那張還沒落地的工作單按「存檔」→ `saveAgentResult` 不檢查
   `stage.state`、不檢查 `c.locked`、不檢查 `c.withdrawn` → `stage.comment` 被
   4000 字分析全文覆蓋
4. `signoff.ts:436`（無 `log` 的舊個案反推路徑）與 `signoff.ts:265`
   （`stageReasons`）顯示的「決策意見」變成 agent 的分析全文，掛在簽核者名下

**具體失敗情境 B（反向）**：先存檔再核准，`sign()` 的
`...(comment ? { comment } : {})` 覆寫掉 agent 分析 —— 存檔按鈕看起來成功了，
內容在下一次核准時消失。

`CaseRecord.log` 保住了決策原文，所以有 log 的新個案在 timeline 主路徑上
（`signoff.ts:415–427`）不受影響；但 `stageReasons`（`signoff.ts:265`）與舊個案
反推路徑（`signoff.ts:428–439`）讀的是 `stage.comment`，兩者都會顯示錯的內容。

**建議**：agent 分析不該共用 `CaseStage.comment`。加一個獨立欄位
（例如 `CaseStage.agentResult`）或直接讓簽核頁從 `agentJobs` 依 `stageId` 反查
（`signoff.ts:392–408` 已經有這種 helper）。

### F3-2 — major — `src/data/store.ts:3360–3445`

`saveAgentResult` **完全沒有權限與狀態閘門**。沒有 `canEditContent`、
沒有 `canSignStage`、沒有 `c.locked`、沒有 `c.withdrawn`、沒有 `project.status`。

**具體失敗情境**：專案已核准並鎖定（`case.locked === true`、`project.status === "approved"`）
→ 一張核准前跑完但沒落地的 `edit` 工作單仍停在 `landed: "pending"` →
按「存檔」→ `store.ts:3383–3400` 直接覆寫 `projectSectionValues[pid]["open"]["oq"]`
與 `state.sectionValues`。已鎖定文件的內文被改掉，`touchProjectMeta` 也跟著動。

舊版把這個寫入藏在 `invokeAgent` 裡時同樣沒閘門，所以嚴格說不是新洞；
但這批把它拉出來變成一支**公開的 store API**，等於把一個原本只有背景流程走得到的
寫入路徑變成 Wave 2 UI 隨時可按的按鈕。**在 Wave 2 接上按鈕之前補閘門，成本最低。**

### F3-3 — minor — `src/data/store.ts:3365` 與 `src/data/types.ts:46`

型別註解寫「沒有 `landed` 的是舊工作單……當成 `saved` 處理」，但**沒有任何程式碼
實作這件事**。`saveAgentResult` 只擋 `job.landed === "saved"`，
`undefined` 一路放行。

**具體失敗情境**：升級前跑完的舊工作單（`status: "done"`、`landed: undefined`，
副作用當年已經寫進 `open.oq`），Wave 2 UI 若照 `landed !== "saved"` 判斷要不要顯示
「待確認」，這批舊工作單會全部冒出來，按下去會**第二次**把同樣的內容落地
（無關卡分支 → 再貼一則一模一樣的留言）。
修法：`saveAgentResult` 開頭改判 `(job.landed ?? "saved") === "saved"`，
或在 `load()` 的移轉裡補 `landed: j.landed ?? "saved"`。

---

## 4. 族系隔離有沒有被稀釋

### F4-1 — critical — `src/lib/signoff.ts:51–73`、`src/data/store.ts:3229`

`separationOfDuties` 的族系規則第一個條件是 **`user.kind === "agent"`**。
但在這套設計的實際流程裡，**簽核的永遠是人**：

- 關卡由 agent 執行 → `invokeAgent(task:"review"|"edit", stageId)` → 結果進 `stage.comment`
- 關卡的**簽核**由使用者（human admin）在簽核頁按下去 → `approveAndLock`
  → `canSignStage(u=human, ...)` → `user.kind === "agent"` 為 **false**
  → 族系規則**不觸發**

唯一還會攔的是 `invokeAgent` 裡那段既有檢查（`store.ts:3228–3238`），
而它的條件是 **`opts.task === "approve"`**。`review` / `edit` / `coach` 三種任務
完全不檢查族系。

**具體失敗情境**
1. 專案 P 由 claude 家族 agent 撰寫 —— `authorAgentFamily: "claude"`
   （`seed.ts:70` 就有現成這種資料）
2. 送審，「結構完整度」關卡指派**另一個 claude 家族**的 agent
3. `store.invokeAgent({ agentId: <claude 家族>, task: "review", stageId })`
   → `store.ts:3229` 的族系檢查因為 `task !== "approve"` 而**不執行** → 放行
4. `saveAgentResult` → 無族系檢查 → 分析寫上關卡
5. 使用者按核准 → `canSignStage(human, ...)` → 族系規則不觸發 → 簽掉

**得到的錯結果**：同一家模型審了自己家寫的文件，全程零攔阻。
而 D3 明寫「個人工作台沒有第二個人當保險，族系隔離反而更重要 …… 升格為主要守門」。
**這條守門在真實流程上沒有掛上。**

`tests/signoff.test.ts:450–500` 之所以全綠，是因為它直接構造
`emp({ kind: "agent", agentFamily: "claude", accessRole: "approver" })` 當
`canSignStage` 的第一個參數。那個 user 在真實流程裡不存在 ——
測試甚至自己寫了註解「agent 不可能是 admin」（`signoff.test.ts:484`），
等於默認了這個 user 是合成出來的。**規則本身寫對了，掛的位置錯了。**

**建議**：族系判斷的主體應該是**「這一關的執行者」**（`stage.assigneeId` 指向的
employee），不是「按按鈕的人」。也就是在 `canSignStage` 裡對
`byId[stage.assigneeId]` 做族系比對，而不是（或不只是）對 `user`。
另外把 `invokeAgent` 的族系檢查從 `task === "approve"` 放寬到「綁了 `stageId` 的
任何任務」—— 綁了關卡就是在做簽核流程的一環。

### F4-2 — major — `src/data/store.ts:2207`、`src/pages/review.ts:541`

收斂過程中，**留言覆核**這條線的族系隔離被拿掉了。

```diff
- hasApprove: canApproveProject(state.currentUser, project).ok
+ hasApprove: canApprove(state.currentUser)
```

`canApprove` 只剩 `hasPermission(user, "approve")` —— 純角色判斷，
不含職責分立。`canResolveComment`（`comment-scope.ts:49–65`）自帶的規則只擋
**`accessRole === "editor"` 的人自審**，完全沒有 agent 族系那一條。

**具體失敗情境**：專案 P 的 `authorAgentFamily === "claude"`。
在設定頁把身分切換成另一個 claude 家族、`accessRole: "approver"` 的 agent
（`settings.ts:396–410` 的下拉選單列的是 `store.get().employees` **全部**，
含 agent；`admin.ts:116` 也有一顆切換鈕）。

- 舊版：`canApproveProject` 回 `{ok:false, reason:"同一種 Agent…"}`
  → `canResolve` 退回 `canPeerReview` → 擋住
- 新版：`canApprove` 回 `true` → `canResolve === true`
  → 同族系 agent 可以把自己家族寫的文件上的**所有審查留言標記為已解決**

程式碼註解說「傳關卡層級的判斷進去會擋掉合法的覆核」—— 這個顧慮是對的，
但正確的替換是把 `separationOfDuties(user, project)` 導出來用（它就是專案層級、
不看關卡），而不是退回純角色判斷。**這是這批唯一一處貨真價實的「收斂時弱化」。**

### F4-3 — minor — `src/data/store.ts:2517`

`signoff.ts:80` 宣稱 `canSignStage` 是「簽核權限的唯一入口」。
`skipStage` 讓這句話不成立：它用自己的行內判斷
（`u.accessRole !== "admin" && stage.assigneeId !== u.id`）把關卡設成 `skipped`，
繞過 `hasPermission(user, "approve")`、繞過 `separationOfDuties`、
也不檢查 `c.withdrawn` / `c.locked`。

**具體失敗情境**：admin 把「規格一致性」（technical 骨架，`required: false`）
指派給一個 claude 家族 agent，而專案正是 claude 家族寫的 → 切換身分成那個 agent →
`skipStage` → 關卡結案，族系規則從頭到尾沒被呼叫過。
`allStagesSettled` 把 `skipped` 算成已結案，所以這一關的守門等於被移除。

爆炸半徑限於 `required: false` 的關卡（「金融法遵與風險」是 `required: true`，
略過不了），而且要 admin 先做一次指派，所以列 minor。
但既然這批的賣點就是「收斂成單一入口」，`skipStage` 應該一併收進去，
否則那句註解會誤導下一個人。

### 已查、無發現

- **代簽（override）沒有繞過族系**：`canSignStage` 的 `opts.override` 分支
  （`signoff.ts:110–114`）排在 `separationOfDuties` **之後**，順序正確。
  舊版 `approveAndLock` 開頭的 `canApproveProject` 也擋 override，行為一致，沒有退步。
- **`approveAndLock` 拿掉開頭的 `canApproveProject` 沒有造成漏洞**：
  `hasPermission(user, "approve")` 在 `canSignStage:96` 補回來了，
  每一關都判一次。
- **`requestChanges` 走 `canSignStage`**（`store.ts:2428`），沒有留行內判斷。
- **`canSignAnyStage`（`signoff.ts:146`）與 `approveAndLock` 迴圈用同一支判斷**，
  `review.ts:424` 的按鈕 enable 條件因此對齊了。這一段是這批做得最乾淨的地方。

---

## 沒查的部分

依交辦跳過：五類 PRD 骨架逐欄比對、舊資料相容那兩項。

（順帶一提，跳過的範圍內我注意到 `agile` 的關卡名實作寫「範圍胃口審查」，
規格表格寫「範圍胃口審查（appetite / no-goes）」；`technical` 同樣少了
「（alternatives considered）」。留給你自己那一輪確認是不是刻意簡化。）

---

## 合併建議

**不能合。** 建議的最小修復順序：

0. **F0** —— `templates.ts:535` 補傳 `{ cat, stages }`，並補一條從那個呼叫形狀
   出發的測試。這一行不改，這批 5 個 commit 裡最大的那個功能在 App 裡是零。
1. **F1** —— 改 `touched` 判準（把 `kind: "comment"` 排除、以
   `project.workflowStages` 是否存在為主軸），並補上 `skipped`。
   這一條不修，第一個 payment 專案的合規關卡就不會出現，而且無法補救。
2. **F4-1** —— 族系比對的主體改成 `stage.assigneeId` 指向的 executor；
   `invokeAgent` 的族系檢查放寬到所有綁 `stageId` 的任務。
   不修的話 D3 那句「主要守門」在紀錄上是假的。
3. **F3-1** —— agent 分析不要共用 `CaseStage.comment`。
4. **F4-2** —— 導出 `separationOfDuties`，`hasApprove` 改用它而不是 `canApprove`。
5. F3-2 / F3-3 / F4-3 可以進 Wave 2 之前補，但 **F3-2 的閘門一定要趕在 UI 接上按鈕之前**。

F0、F1、F4-1、F3-1 這四條的共同形狀是同一個：**規則寫對了，但掛在一條真實流程
走不到的路徑上**，於是針對規則本身寫的單元測試全綠。1563 個測試沒有一個是從
「套範本 →（templates.ts 的呼叫形狀）→ 送審」或「新建專案 → 加註意見 → 送審」
或「agent 執行 → 人簽核」這種端到端順序跑下來的，這四條就是從那個縫裡漏掉的。

**測試補強的建議**：Wave 1 的測試全部是 store API 層的單元測試，
入口參數是測試自己給的。至少要有一條測試從 `src/pages/` 實際呼叫的形狀出發，
把「頁面怎麼叫 store」也釘住 —— F0 就是這一層沒有測試造成的，
而它是這批影響最大的缺陷。

---

## 附：重現用的 harness

實測用的檔案在
`/private/tmp/claude-501/-Users-scottchen-Documents-20-Projects-Project-Anchorline/00cb4d41-b76b-44f3-a823-9265d315dc29/scratchpad/repro2.test.ts`
（在 repo 之外，沒有動到工作樹）。跑法：

```bash
cd <worktree> && bun test <上面那個路徑>
```

它 mock 掉 `src/data/domains/index.ts`（那個檔用 `import.meta.glob`，
`bun test` 直接跑會炸），改用 `parseDomainPack` 直接讀
`_base.md` / `generic.md` / `payment.md`，其餘全走真實 store。
