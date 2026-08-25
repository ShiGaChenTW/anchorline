# Wave 3 需求 — Agent 修改建議的 diff 化與簽核期間的內容變更紀錄

- 開立：2026-08-26 · 來源：Scott 在 Wave 2 實測期間口述
- 狀態：**需求捕捉，尚未拍板規格**
- 前置：Wave 2 的 28 題 UAT 尚未測完，測完的失敗題要跟這兩項一起排

## Scott 的原話

> 1. agent 提供修改建議時，必須同時提供 PRD 各項內容根據修改建議而修改好的 diff
> 2. 從簽核過程中修改的內容，都必須要保留修改前後的紀錄，並要提供紀錄頁面

## R1 — Agent 的建議要附「改好的內容」與 diff

### 現況（已查證）

- `review` 關卡的 agent 只產出**散文意見**，第一行給「建議核准／建議修改」
  （prompt 在 `src/pages/signoff.ts` 的 `invokeAgent` 呼叫處）
- `edit` 關卡產出的是**單一欄位的整段替換**，pop-up 顯示現值 vs 新值兩欄
- **沒有任何路徑**會產生「逐項、逐欄位的修改後內容」

### ⚠️ 這會推翻母規格一條明寫的「不做」

`plans/Project_Anchorline__2026-08-25-2325__signoff-redesign.md` 的「不做」那一節：

> 逐條勾選套用的 diff UI（`edit` 關卡先做整段欄位替換 + 前後對照）

R1 要的正是被排除的那個東西。**這是刻意的範圍擴張，不是遺漏** —— 但要重新拍板，
因為當時排除它是有理由的（範圍控制），現在理由變了。

### 未拍板的設計岔路

1. **範圍**：只有 `review` 關卡說「建議修改」時要附 diff？還是每一關都要？
2. **粒度**：一份 diff 涵蓋整份 PRD，還是每個章節／欄位各一份？
3. **套用方式**：逐條勾選套用，還是整批接受／整批拒絕？
   （母規格當初排除的就是「逐條勾選」的成本）
4. **agent 輸出格式**：現在是自由散文。要 diff 就必須改成**結構化輸出**
   （sectionId / fieldKey / 新內容），而模型不一定守規矩 ——
   解析失敗時要退回散文意見，不能整關卡死
5. **跟 `edit` 關卡的關係**：`edit` 已經會替換欄位。R1 是把那個能力擴到
   `review` 關卡，還是把兩者合併成同一個機制？

## R2 — 簽核期間的內容變更要留前後紀錄，並要有紀錄頁面

### 現況（已查證，這是真缺口）

- `store.saveAgentResult` 的 `edit` 分支**直接寫** `projectSectionValues` 與
  `sectionValues`，**不產生 `PrdVersion`**（`store.ts:1663` 是唯一寫 `prdVersions`
  的地方，只有 commit／merge 走得到）
- 所以：**簽核過程中 agent 改掉的 PRD 內容，目前沒有任何修改前後的紀錄。**
  只有 `audit(…, "agent.result.saved", …)` 一筆稽核事件，不含內容
- `PrdVersion.kind` 只有 `"commit" | "merge"`（`types.ts:686`）
- **`src/pages/history.ts` 不是 PRD 內容的紀錄頁** —— 它讀專案資料夾的 git repo
  （`native.gitCommitDiff`），顯示 git commit 與檔案 diff，跟 PRD 章節無關
- `prdVersions` 目前只在 `signoff.ts`（時間軸）與 `releases.ts`（取號）出現，
  **沒有可以逐欄位看前後對照的頁面**

### 未拍板的設計岔路

1. **紀錄的載體**：`PrdVersion` 加一種 `kind`（例如 `"agent-edit"`），
   還是另開一條 `contentChanges` 紀錄？前者能重用既有的 `docs` 快照與
   `changedFieldCount`／diff 工具；後者不會讓版本清單被大量小改動灌爆
2. **粒度**：每一次 `saveAgentResult` 一筆，還是每一輪彙總一筆？
3. **紀錄頁面**：擴充既有的「提交與 Diff」頁（它現在是 git 專用，混進 PRD
   內容會讓那一頁同時講兩件事），還是新開一頁？
4. **範圍**：只記 agent 的落地，還是連人在編輯台的每次儲存都記？
   （後者等於做完整的內容版本控制，成本差一個量級）
5. **保存上限**：`capVersions` 現在對版本數有上限，內容變更紀錄要不要同一套

## 建議的下一步

1. Scott 測完 Wave 2 的 28 題，失敗題先收
2. 一併處理兩個已知既有缺陷（見 `## 既有缺陷` 一節）
3. R1／R2 各自把上面的岔路拍板，再寫規格。**R1 之前要先確認 agent 的結構化
   輸出穩不穩** —— 那是整個功能的地基，地基不穩就不要蓋

## 既有缺陷（Scott 2026-08-26 實測發現，已用探針重現，尚未修）

### B1 —— 關卡同時顯示「已簽」與「待簽核」

```
重送審(第2輪): AI 結構審查[pending] who=Scott · 已簽
```

根因：`assigneeName` 被當成狀態欄用。`approveAndLock` 的 `sign()` 把它覆寫成
`` `${u.name} · 已簽` ``，而 `stagesAfterResubmit`（`lib/prd-versions.ts:168`）
只把 `state` 重設回 `pending`，那行字沒人清。於是同一關同時宣稱兩件相反的事。

`sign()` 同時保留原本的 `assigneeId`，所以改派下拉顯示的是 agent、
而那行字顯示的是簽核者 —— 兩個欄位互相矛盾。

修法方向：`assigneeName` 只存「這一關派給誰」，「已簽」由 `state` 與
`decidedByName` 表達（`decidedByName` 本來就有）。

### B2 —— 輪次多算一輪

全新案子第一次送審，`round` 就跳到 2：

```
送審後 → round 已經是 2
```

根因：`submitForReview` 的 `nextRound` 用 `commitId !== c.reviewCommitId` 判斷，
而新案子的 `reviewCommitId` 是 `null`，第一次送審必然不相等 → 直接 +1。

修法方向：`reviewCommitId` 為 `null`（從未送審過）時不算新一輪。
注意 `groupTimelineByRound` 依 round 分組，改動會影響既有資料的顯示。

---

### B1／B2 修復（2026-08-26 · Engineer）

已修完，未 commit。`tsc --noEmit` exit 0、`bun test` **1809 pass / 0 fail / 89 files**
（基準 1789／88，只增不減）、`vite build` 成功。

#### B1 —— 根因與修法

**根因一句話：`assigneeName` 同時扛「派給誰」與「誰簽的」兩件事，而重送審只清得掉其中一半。**

修法是把那個欄位還原成單一語意：`assigneeName` 只存「這一關派給誰」，
「誰簽的」由 `state` + `decidedByName` 表達（那兩欄本來就有，`types.ts` 的註解
八月就寫過這件事，只是程式碼沒照做）。

| 檔案 | 改了什麼 |
|------|----------|
| `src/lib/signoff.ts` | 新增 `stageAssignment(emp)` —— 「派給誰」兩個欄位的**唯一產生處**，`assigneeId` 與 `assigneeName` 一起出，不會再各改各的 |
| `src/lib/signoff.ts` | 新增 `normalizeStageAssignee(stage, employees)` —— 既有資料的收斂（見下） |
| `src/lib/signoff.ts` | `stagesFromWorkflow` 改用 `stageAssignment(emp)` |
| `src/data/store.ts` | `approveAndLock` 的 `sign()`：`` assigneeName: `${u.name} · 已簽` `` → `s.assigneeId ? s.assigneeName : u.name`。本來就沒派人的 `empty` 關卡才把簽核者填進去（那是它真的執行者），已派人的一律不動 |
| `src/data/store.ts` | `reassignCaseStage`：拿掉 `` s.state === "approved" ? `${emp.name} · 已簽` : emp.name `` 這條分支，改用 `stageAssignment(emp)` |
| `src/data/types.ts` | `CaseStage.decidedByName` 的註解改成現況（原註解描述的是被修掉的那個行為） |

畫面那一層**沒有動**：`signoff-stages.ts:157` 的
`(settled && s.decidedByName) || s.assigneeName || "待指派"` 本來就是對的 ——
它讀 `state` 決定要顯示簽核者還是被指派者，錯的是餵給它的資料。

#### B1 —— 既有資料怎麼收斂

localStorage 裡已經有一批 `assigneeName` 被寫成「某某 · 已簽」的個案。
**只修寫入端不夠**：那行字是存下來的、不是每次算出來的，既有個案重新載入之後
照樣同時顯示「已簽」與「待簽核」，看起來像沒修好。

收斂掛在 `normalizeCases()`（`load()` 與 `importState()` 共用的那一支，
跟 `sanitizeStageDefs` 同一條路），順序刻意分兩段：

1. `assigneeId` 查得到員工 → 照員工名單重新取名。**這一段才修得掉
   「改派下拉顯示 agent、旁邊那行字顯示簽核者」** —— 光切後綴會留下簽核者的名字
2. 查不到（人被刪了、或這一關本來就沒派人）→ 只把 `" · 已簽"` 後綴切掉，
   不憑空造一個名字出來

同名時回傳原物件，不製造無謂的新參考。

#### B2 —— 根因與修法

**根因一句話：`reviewCommitId` 的初始值是 `null`，而判斷用的是「不等於」，
所以第一次送審必然被算成新的一輪。**

判斷抽成 `prd-versions.ts` 的 `isNewRound(stages, prevCommitId, nextCommitId)`
（跟 `stagesAfterResubmit` 同一組參數、放在隔壁）：`prevCommitId` 為 `null`
代表這份 PRD 從來沒送審過 —— 第一次送審是**第 1 輪**，不是「從第 1 輪進到第 2 輪」。
「有人要求修改過就算新的一輪」那一半原封不動。

#### B2 —— 既有資料的取捨（**這是刻意不做的那件事**）

**不回頭把既有個案的 `round` 減一。**

`CaseDecision.round` 是寫入當下蓋上去的，`groupTimelineByRound` 分組讀的是
**那個戳記**、不是 `c.round`。所以「灌高過」對既有紀錄只是一個外顯的偏移一，
每一筆紀錄仍然跟自己那一輪的同伴在一起。

反過來做才會壞：假設某個案跑過兩輪、紀錄蓋的是 2 與 3，載入時把 `c.round`
從 3 改成 2，下一次送審就會蓋上 3 —— 而 3 已經有紀錄了。兩輪的紀錄被併成同一組，
那正是分組要防的事。測試檔裡有一條反例 case 釘住這個取捨。

代價：Scott 既有的個案在畫面上仍然會看到偏高一的輪次標籤。新案子從第 1 輪開始。

#### 哪條測試釘住

新檔 `tests/wave3-b1-b2-fixes.test.ts`（20 條）。**走真的 store**
（照 `signoff-preview.test.ts` 的 `mock.module` + localStorage 替身），
每一條同時握著 `state.cases` 與 `stageListHtml()` 產出的 HTML。

紅燈驗證：把 `src/` stash 掉之後跑同一份測試 → **17 fail / 3 pass**。
那 3 條 pass 的是刻意的回歸／取捨防護（已核准時畫面照樣顯示簽核者、
既有紀錄照舊分組、以及 B2 的反例），本來就該在修好之前也是綠的。

| 缺陷 | 測試 | 釘住什麼 |
|------|------|----------|
| B1 | `重送審之後那一關是 pending，而畫面上沒有「已簽」兩個字` | 跑完「送審 → 核准 → 要求修改 → 重送審」，斷言整份關卡列 HTML（含改派下拉的選項）不含「已簽」 |
| B1 | `pending 的那一關，畫面顯示的執行者 = assigneeId 指到的人（不是簽核者）` | 第 1 關派給 agent、由管理員簽 —— 兩者是不同的人，這條才有解析度 |
| B1 | `assigneeName 從頭到尾等於被指派者的名字` | 簽核不得改寫那個欄位 |
| B1 | `已核准時畫面照樣講得出「誰簽的」` | 回歸防護：修掉矛盾不等於把資訊拿掉 |
| B1 | `改派不再把「· 已簽」寫進名字` | `reassignCaseStage` 那一半 |
| B1 | 既有資料收斂 4 條 + HTML 1 條 | 查得到／查不到／沒指派／乾淨資料四種入口，加上收斂後畫成 HTML 的結果 |
| B1 | `normalizeCases 真的接上了收斂` | 形狀防護（抄 wave2 的 F0）—— `load()` 與 `importState()` 都不能在共用 store 單例的測試裡真的跑 |
| B2 | `全新案子第一次送審 → round 是 1` | 缺陷本身 |
| B2 | `換了 commit 的第二次送審才變 2` | 修法沒有把輪次整個關掉 |
| B2 | `同一份快照重按送審不灌輪次` / `有人要求修改 → 就算快照沒換也算新的一輪` | 另外兩半的行為不變 |
| B2 | `isNewRound` 純函式 6 個斷言 | 邊界：prev 為 null／換快照／同快照／沒帶新快照／沒有關卡／要求修改 |
| B2 | `灌高過的個案繼續往前走，新舊紀錄接得起來` | 既有資料不壞 |
| B2 | `反例：回頭把既有 round 減一，下一輪就會跟既有紀錄撞號` | 釘住「不做回溯遷移」這個取捨的理由 |

#### 既有測試的增減

**一條都沒有刪除或弱化。** 1789 條原有測試在修完之後全綠，沒有一條需要改。
`tests/workflow-landing.test.ts:137` 的 `round).toBeGreaterThan(1)` 是唯一有風險的
一條（它連送三次 `c1`／`c2`／`c3`，修法之後 round 走 1 → 2 → 3，仍然 > 1）。

#### 建議的 UAT 題目

1. **B1 主線**：新專案 → 送審時第 1 關派給一個 agent → 用管理員核准第 1 關 →
   第 2 關按「要求修改」→ 回編輯台改一個欄位、儲存、重新送審。
   **預期**：第 1 關的徽章是「待簽核」，旁邊那行字是**那個 agent 的名字**，
   畫面上任何地方都沒有「已簽」；改派下拉選中的也是同一個 agent。
2. **B1 反向**：同一個案子在第 1 關核准**當下**看。
   **預期**：徽章「已核准」，那行字是**簽核者**（人）的名字加時間，資訊沒有掉。
3. **B1 既有資料**：打開一個 8/26 之前就跑過簽核的舊案子（Scott 截圖那一個）。
   **預期**：重新載入之後那行字回到「派給誰」，不再是「某某 · 已簽」。
4. **B1 改派**：對一個已核准的關卡改派給別人。
   **預期**：名字換成新的人，沒有「· 已簽」後綴。
5. **B2 主線**：全新專案第一次送審之後看簽核紀錄。
   **預期**：紀錄分組的標題是「第 1 輪」。
6. **B2 第二輪**：改內容、重新送審。**預期**：出現「第 2 輪」，第 1 輪的意見還在自己那一組。
7. **B2 既有資料**：打開一個已經跑過好幾輪的舊案子。
   **預期**：輪次標籤可能偏高一（已知取捨），但**每一輪的紀錄沒有混在一起**、
   也沒有任何一輪憑空多出別輪的紀錄。

#### 沒有碰的東西

Wave 3 的 R1／R2、S1 結案閘門、`dialog-flow.ts`、`submitPlan` / `submitForReview`
的 `landsNow` 判斷、`reapplyWorkflow`、`discardAgentResult` / `setWorkflowSkeleton`
的閘門、送審前預覽（`lib/signoff-stages.ts` 的行為）—— 全部原封不動。
