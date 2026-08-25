# Handoff — 簽核流程重新設計（個人工作台版）

- 更新：2026-08-26（Wave 1 已合併）
- 規格（先讀這份）：`plans/Project_Anchorline__2026-08-25-2325__signoff-redesign.md`
- 審查報告：`plans/review-wave1-forge.md`（440 行，六條發現的完整重現）

## 一句話

**Wave 1（資料層）已審查、修復、合併進 main 並驗證通過。下一步是 Wave 2 的三個 UI。**
未 push —— `origin/main` 還在 `083f970`，push 要問過 Scott。

## Wave 1 —— 完成

`5b9a5ec`（merge commit）在 main 上，含 Wave 1 的 5 個 commit + 審查修復 1 個。

**main 上實跑驗證**：`bunx tsc --noEmit` exit 0、`bun test` **1612 pass / 0 fail / 82 files**、
`tests/` 零刪除（沒有靠刪測試換綠）。

做掉的四塊：
1. 五類 PRD 各有簽核骨架（lean / narrative / enterprise / agile / technical），寫成 `seed.ts` 的資料
2. 金融四包的法遵關卡寫進**領域包 frontmatter**，`resolveWorkflow` 全篇沒有領域名稱 ——
   「加一個 `.md` 就加一個領域」的契約守住了（審查獨立確認）
3. `store.invokeAgent` 移除全部靜默副作用，改 `landed: "pending"` → `saveAgentResult()` 才落地
4. 權限收斂成單一 `canSignStage`，族系隔離改掛在**執行者**（`stage.assigneeId`）而非簽核者

新檔：`src/lib/workflow-resolve.ts`、`src/lib/prd-template.ts` 的 `templateWorkflowArg()`、
`tests/{workflow-resolve,agent-result-landing,workflow-landing,wave1-review-fixes}.test.ts`

## 審查抓到什麼（重要，別讓它再發生一次）

跨 context 審查（Forge，沒看過規格討論）在 1563 個測試全綠的情況下抓到 **3 critical + 3 major**：

- **F0（最大）**：`applyFullTemplate` 新增的第 4 個參數**只有測試在傳**，生產唯一呼叫端
  `templates.ts:535` 沒傳 → `Project.templateCat` 從未被寫入 → 五類骨架永遠退回 `lean`。
  **整批工作的核心功能在 App 裡是零，而測試全綠。** 修法是抽 `templateWorkflowArg()`，
  讓測試能直接驗生產呼叫端存不存在。
- F1：`touched` 判準被 `addStageComment` 汙染，送審前加註一句就會落地舊的全域關卡且救不回
- F4-1：族系隔離掛在 `user.kind === "agent"`，而真實流程裡簽核的永遠是人 → 等於沒有守門
- F3-1 / F2 / F3-2：agent 全文與簽核意見搶同一個欄位、存下的分析在重送審時靜默消失、
  `saveAgentResult` 零權限零狀態閘門

**教訓**：新參數只有測試在傳，是這個 repo 會重複出現的失敗模式。實作者順帶查出
`submitForReview(assignments)` 與 `saveAgentResult` 也是同一形狀 —— 但那兩個是 Wave 2 的排程，不是缺陷。

## 下一步 —— Wave 2（三個 UI，可並行）

- **W2-A**：編輯台「送出審閱」→ 先開**關卡指派對話框**（逐關選 agent 或我），確認才送審。
  接的是已備好的 `submitForReview(projectId, commitId, assignments)`（`editor.ts:1372` 目前只傳 2 個參數）
- **W2-B**：簽核頁 **agent pop-up** —— 跑完跳窗顯示完整全文 + 結論 + 是否存檔；存檔後關卡才出現內容。
  接 `saveAgentResult()` / `discardAgentResult()`（`src/pages/` 目前零呼叫端），顯示 `CaseStage.agentResult`
- **W2-C**：管理中心流程範本檢視／編輯（可延後）

⚠️ **W2-B 兩個硬條件**：
1. `edit` 關卡的落地是**整段替換**欄位（規格明列 diff UI 不做）。對話框**必須顯示現值 vs 新值**，
   否則使用者按下去就把手寫內容整段換掉。
2. F3-2 的閘門要求 `project.status === "review"` 才能落地。案子一旦全簽完鎖定，
   未落地的工作單就永久落不了地（只能 discard）。UI 要讓使用者看得懂那顆存檔鈕為什麼變灰。
   **這是行為上的收緊，Scott 尚未拍板。**

## 還沒收的線頭

- **實機 UAT 完全沒做。** 簽核流程改動幾乎零人眼驗證，Wave 2 做完要出題（用 `Uat` skill）
- **舊帳**：對話框遷移的實機 UAT、W3 的 11 題視覺驗收、wave1+2 的 10 題 —— 見 `PROJECTS.md`
- **未 push**，`origin/main` 在 `083f970`
- Scott 未拍板：F3-2 鎖定後不得落地這條收緊是否接受

## 派工注意（這個 session 踩過的坑）

- 派工前一律先跑 `bun ~/.claude/LIFEOS/TOOLS/AgentQuota.ts --json`。
  2026-08-26 當下：Bellows exhausted、Anvil unavailable、Forge/Cato/Engineer 可用
- **Cato 連續三次交白卷**（兩次停在句子中間、一次連 result 欄位都沒有，共燒約 17 萬 token）。
  改派 Forge 才拿到報告
- **要求審查者把結論邊查邊寫進 repo 內的檔案**，不要只留在回話裡 —— agent 一停結論就全沒了。
  這次 `plans/review-wave1-forge.md` 就是這樣保住的
- **不要採信 agent 的 `completed` 狀態字**：這個 session 有四次停在句子中間卻回報 completed。
  一律自己跑 `tsc` / `bun test` 驗實際產出
- 主 session 當 PM，不寫 code，只派工與驗收
