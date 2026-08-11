# 簽核流程重做 —— 狀態機與介面

**狀態：** 完成（2026-08-11）

## Context

簽核管理頁做完之後，流程本身的怪處就浮出來了。逐條都可驗證，不是感覺：

| # | 現況 | 位置 |
|---|------|------|
| 1 | **審閱者只能核准，沒有任何負向動作。** 發現問題時唯一能做的是「不按按鈕」，而畫面上那跟「還沒輪到他」長得一模一樣。退回要靠作者自己抽單 | `store.approveAndLock`，全檔沒有 reject 路徑 |
| 2 | **`required: false` 是死設定。** 管理中心可以取消勾「必簽關卡」，但 `allStagesSettled` 要求**每一關**都 approved/skipped，非必簽照樣擋著。prod 種子的「法務」就是 `required:false` | `prd-versions.ts:146-150`；`required` 只在 `addWorkflowStage` 被寫入，從未被讀 |
| 3 | **`skipped` 沒有任何程式路徑能產生。** 型別有、UI 有標籤、`allStagesSettled` 認得它 —— 但沒有動作可以達成。所以第 2 點沒有出口 | `types.ts:116` vs 全檔無 producer |
| 4 | **沒有順序概念。** 四關完全獨立，資安可以在工程還沒看之前先簽 | `approveAndLock` 逐關獨立判斷 |
| 5 | **admin 一鍵全簽。** 審閱頁那顆「核准並鎖定」對 admin 會把所有未簽關卡一次簽完，畫面上看不出來，紀錄只留一筆 | `store.ts` `approveAndLock` 的 admin 分支 |
| 6 | **簽核者身分有兩個真相來源。** 舊路徑把 `"名字 · 已簽"` 寫進 `assigneeName`（指派欄位），新路徑寫 `decidedByName` | `store.ts` sign() |
| 7 | **重送作廢有洞。** 只在「前後 commitId 都存在且不同」時作廢；第一次送審或 `commitId` 為 undefined 時，舊簽核原封不動留著 | `prd-versions.ts:158-166` |
| 8 | **紀錄只留得住最後一次決策。** 每關一組 `decidedAt/By/comment`，第二輪覆蓋第一輪，前面幾輪的意見消失 | `types.ts` CaseStage |

### 市場做法（研究結果）

- **三態評審是主流。** GitHub PR review 有 Approve / Request changes / Comment 三種，其中 Comment 不改變狀態、只留話；Request changes 是明確的負向決策。Jira Service Management 是二態（approve/decline，一個 approval 綁兩條 transition）。ServiceNow 的變更管理在駁回時**帶著 comment 退回 New 狀態**。
- **串行／並行／法定人數是一組 pattern，真實流程幾乎都是混合。** 並行的完成條件可以是「全部到齊」或「達到 quorum」。
- **委派與升級**是處理「簽核人不在」的標準解，不是靠 admin 代簽。
- **金融監理要的是「系統性控制」不是「程序性控制」** —— 四眼原則（maker-checker）要求軟體**實體強制**兩個人，而且稽核證據要同時看得到 maker 的動作與 checker 的決策。

Sources: [ACM: Design Patterns for Approval Processes](https://dl.acm.org/doi/fullHtml/10.1145/3628034.3628035) · [Kissflow: Parallel vs Sequential Approvals](https://kissflow.com/workflow/bpm/parallel-vs-sequential-approvals-in-bpm/) · [GitHub Docs: About pull request reviews](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/about-pull-request-reviews) · [Jira Service Management: Add approvals to your workflow](https://confluence.atlassian.com/display/SERVICEDESKSERVER/5.+Add+approvals+to+your+workflow) · [Maker-checker (Wikipedia)](https://en.wikipedia.org/wiki/Maker-checker) · [Opcito: Maker-Checker implementation guide for FinTech](https://www.opcito.com/blogs/maker-checker-implementation-guide-for-secure-fintech-systems)

### 已拍板的三個決定（Scott, 2026-08-11）

1. **三態決策**：核准／要求修改／保留意見
2. **每一關可設串行或並行**
3. **admin 一鍵全簽保留，但強制留痕**：二次確認 + 必填理由 + 紀錄標明代簽

---

## 設計

### 資料模型

**`WorkflowStageDef`** 加一個欄位：

```ts
mode: "sequential" | "parallel"
```

移轉時**既有關卡一律給 `parallel`** —— 那是現行行為，不能因為升級就把跑到一半的案子擋住。新增關卡預設 `sequential`（市場常態）。

**`CaseStageState`** 擴成：`approved | changes_requested | pending | empty | skipped`

**`CaseRecord`** 加兩個欄位，這是紀錄修好的關鍵：

```ts
round: number            // 每次重送 +1
log: CaseDecision[]      // 所有決策，不覆蓋
```

```ts
type CaseDecision = {
  id: string; stageId: string; round: number; at: string;
  byId: string; byName: string;
  decision: "approved" | "changes_requested" | "comment" | "skipped" | "override";
  comment: string;          // changes_requested / override 必填
};
```

`CaseStage` 上的 `decidedAt/decidedById/decidedByName/comment`（本輪剛加的）保留為**最新一筆決策的投影**，方便清單直接讀；真相在 `log`。

### 狀態機規則

- **可簽條件**（`canSignStage` 擴充）：既有的職責分立與關卡歸屬**之外**，再加一條 —— `mode === "sequential"` 的關卡，只有當所有 `order` 較小的關卡都已結案（approved 或 skipped）時才可動作；否則理由是「等 <前一關> 先過」。
- **結案條件**（`allStagesSettled` 改寫）：**所有 `required` 關卡都是 approved**。非必簽關卡不擋，且可用明確的「略過」動作產生 `skipped`（第 2、3 點一起修）。
- **要求修改**：該關轉 `changes_requested`，案件進入「待修正」（由 stages 推導，**不新增 project.status 值** —— 那個詞彙表牽動專案清單、總覽、側欄三處，不值得為這件事動）。
- **重送**：`round + 1`；`stagesAfterResubmit` 改成「只要進入新一輪就作廢」，把第 7 點那個「commitId 為 undefined 就不作廢」的洞補掉。`approved` 與 `changes_requested` 一律回 `pending`。
- **admin 代簽**：`approveAndLock({ override: { reason } })`，理由必填，每一關寫一筆 `decision: "override"`。

### 介面（重做 `signoff.html` / `src/pages/signoff.ts`）

從「四張獨立的列」改成**一條看得到方向的路徑**：

- **頭條**維持「現在卡在誰身上」，但要能講出串行阻塞（「等 工程 先過」）
- **關卡**改成 stepper：串行的上下相連、並行的同層並列；每關顯示最新決策與意見
- **動作**三顆等重：核准／要求修改／保留意見。要求修改必填理由；被順序擋住時顯示理由而不是給一顆能按的鈕
- **紀錄**依「輪」分組，第 2 輪在上、第 1 輪收合 —— 現在的平鋪時間軸在多輪之後會讀不出因果

### 用哪些 Skills

- **`impeccable`**（Operate mode）做介面：這個 repo 的既有視覺語言就是靠它建立的，`.ov-hero` / 卡片 / ADHD 那套排版原則要延續，不能另開一套。
- **`RedTeam`** 在動工前打一次狀態機：新增兩個狀態 + 順序閘門 + 輪次作廢，組合起來的失效路徑（例如「並行關卡在 changes_requested 之後重送，前面串行關卡的簽章該不該留」）值得先被攻擊過再寫。

---

## 要改的檔案

| 檔案 | 改動 |
|------|------|
| `src/data/types.ts` | `WorkflowStageDef.mode`、`CaseStageState` 擴值、`CaseRecord.round/log`、`CaseDecision` |
| `src/data/store.ts` | `approveAndLock` 收 decision 種類與 override；新增 `requestChanges` / `addStageComment` / `skipStage`；`caseFromWorkflow` 補 round/log；移轉時補 `mode:"parallel"` 與空 log |
| `src/lib/prd-versions.ts` | `allStagesSettled` 改看 `required`；`stagesAfterResubmit` 改看輪次 |
| `src/lib/signoff.ts` | `canSignStage` 加順序閘門；`signoffTimeline` 改讀 `log` 並依輪分組；`signoffSummary` 要講得出阻塞原因 |
| `src/pages/signoff.ts` + `shared.css` | stepper 版面、三顆動作、必填理由、紀錄分輪 |
| `src/pages/admin.ts` | 關卡設定加「串行／並行」切換 |
| `src/pages/review.ts` | 「核准並鎖定」對 admin 的一鍵全簽改走 override 路徑（要理由） |
| `tests/signoff.test.ts` · `tests/prd-versions.test.ts` | 順序閘門、required、輪次作廢、三態決策、override 留痕 |

既有可重用、**不要重寫**的東西：`canApproveProject`（`permissions.ts:84`，職責分立已經對了）、`syncApprovalsFromActiveCase`、`audit()`、`stageRows`/`signoffSummary` 的形狀、`.ov-hero` 與 `.aiw-*` 視覺語彙。

---

## 驗證

1. `bunx tsc --noEmit` · `bun test`（新增測試涵蓋：串行閘門、非必簽不擋、輪次作廢、三態決策、override 必填理由）
2. `bunx vite --port 5199 --strictPort`（**不要用 5173**，那是主 repo）
3. Interceptor 實機走完一輪：送審 → 工程核准 → 資安「要求修改」並填理由 → 案件轉待修正 → 作者重送 → 確認**所有簽章作廢、round 變 2、第 1 輪的意見仍在紀錄裡**
4. 串行驗證：把「設計」設成 sequential，確認工程未結案前它顯示「等 工程 先過」且按鈕不可按
5. override 驗證：admin 在審閱頁按「核准並鎖定」→ 必須填理由 → 紀錄出現「以管理員身分代簽 N 關」
6. `bun run app:test` 重建並安裝測試版，在桌面版確認一次


---

## 實作結果

| 原本的怪處 | 現在 |
|---|---|
| 只能核准 | 三態：核准／要求修改（理由必填）／保留意見（不改狀態） |
| `required:false` 是死設定 | `allStagesSettled` 只看必簽關卡；非必簽可用「略過」明確結案 |
| `skipped` 沒有 producer | `store.skipStage()`，且**拒絕略過必簽關卡** |
| 沒有順序 | 每關可設串行／並行；串行被擋時顯示「等「工程」先過」而不是給一顆按不動的鈕 |
| admin 靜默一鍵全簽 | 改成明示的 override：理由必填，逐關寫一筆 `override` 決策 |
| 紀錄只留最後一次 | `CaseRecord.log` 只追加不覆蓋，依輪分組 |
| 重送作廢有洞 | 拿到新快照就作廢；有人要求修改時即使快照沒換也重簽 |

### 實機驗證（真 Chrome，混合串並行的四關案子）

```
初始      工程(串行) 設計(並行) 資安(串行) 法務(並行·非必簽)
          可簽       可簽       等「工程」先過   可簽＋可略過
核准工程  approved   pending    仍被擋（設計還沒結案）
核准設計  approved   approved   解鎖
資安要求修改（不填理由 → 被擋；填了才過）
          → 頭條「要修改 —— 1 關退回」，log 3 筆全在第 1 輪
重送 c2   → round 2，三關全部退回 pending，**第 1 輪的意見仍在紀錄裡**
```

計數器顯示 `0/3 必簽已結案`（法務被排除），確認 `required` 真的生效。

### 途中修掉的一個顯示錯誤

重送把關卡退回待簽核之後，上一輪的意見與簽核者還掛在那一列上，看起來像
「這一輪已經有人講過話」。改成只有 `state` 不是 pending/empty 時才顯示 ——
那些字屬於上一輪，位置在紀錄裡。

### 未驗

`review.ts` 的 admin override 走 `window.prompt`，而瀏覽器對話框會卡住
Interceptor 的擴充套件通道（技能文件明列的禁忌），所以沒有實機點過。
`store.approveAndLock({override})` 的守衛（非 admin 拒絕、空理由拒絕、
逐關寫 override 決策）有單元測試涵蓋。
