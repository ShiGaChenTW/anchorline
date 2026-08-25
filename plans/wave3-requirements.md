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
