# Handoff — 簽核流程重新設計（個人工作台版）

- 寫於：2026-08-26
- 前一個 session：project-anchorline-5b
- 規格（先讀這份）：`plans/Project_Anchorline__2026-08-25-2325__signoff-redesign.md`

## 一句話

PRD 簽核流程重構的**資料層（Wave 1）已完成並驗證通過，但還沒 merge**，
卡在 Cato 的跨廠商審查上；那個審查跑在舊 session 裡，**新 session 要重派**。

## 現在的狀態

### Wave 1 — 完成，未合併
- 分支：`worktree-agent-add176c78059c7034`
- worktree：`.claude/worktrees/agent-add176c78059c7034`
- 5 個 commit：`432be61` → `8ee918a`，工作樹乾淨
- **驗證（主 session 獨立跑過，非採信 agent 自述）**：
  - `bunx tsc --noEmit` → exit 0
  - `bun test` → **1563 pass / 0 fail / 80 files**
  - `git diff main...HEAD --numstat -- tests/` → 855 行純新增，**零刪除**（排除刪測試換綠）
- 基準是 **1514**（不是規格原本寫的 1229），所以是 +49 測試、零退步

做掉的四塊：
1. 五類 PRD 各有簽核骨架（lean / narrative / enterprise / agile / technical），寫成 `seed.ts` 的資料
2. 金融四包（payment / lending / wealth / digital_account）的法遵關卡寫進**領域包 frontmatter**，由 `domain-pack.ts` 解析 —— 維持「加一個 .md 就加一個領域」契約
3. `store.invokeAgent` 移除全部靜默副作用，改 `landed: "pending"` → `saveAgentResult()` / `discardAgentResult()` 才落地
4. 權限三層收斂成單一 `canSignStage`，agent 族系隔離升格為主要守門

新檔：`src/lib/workflow-resolve.ts`、`tests/{workflow-resolve,agent-result-landing,workflow-landing}.test.ts`

### 順手抓到的既有 bug（已修在 Wave 1 裡）
`store.invokeAgent` 原本 `const bag = state.sectionValues` —— 那是**當下開著的專案**的正文。
對非 active 專案下工作單，送進模型的是別的專案的內文，而分析看起來完全正常，只是在講錯的文件。
已改成依 `job.projectId` 取。**不是這次改出來的，本來就在。**

### 實作時補的四個決定（規格原本沒寫死，已回寫規格檔）
1. `Project.templateCat` —— 專案原本記不得自己套過哪份範本
2. `editTarget` —— `edit` 關卡存檔要寫進哪個欄位，enterprise「文件補完」指向 `open.oq`
3. `Project.templateStages` —— 讓 `Template.stages` 活到送審那一刻
4. **最容易寫錯的一處**：規格假設「送審才建個案」，實際上 `addProject` 當下就建了（走全域舊預設流程）。
   判準改成「個案有沒有留下痕跡」（綁過快照／有決策紀錄／有關卡簽掉或被退回）：沒痕跡的照新流程重建。
   不重建的話，第一次送審跑的是建專案當下那套舊關卡，而專案上剛落地的新流程只是一份沒人用的資料，
   **畫面上完全看不出來**。

## 下一步（照順序）

1. **重派 Cato 審查 Wave 1。** 舊 session 派過兩次，兩次都停在句子中間沒交出結論。
   brief 重點：它沒看過規格討論，要抓的是**「測試綠但東西錯」**——需求被誤解的那一類。
   特別驗上面那第 4 點，以及法遵關卡是不是真的從 frontmatter 來、副作用有沒有真的移乾淨、
   族系隔離在收斂過程中有沒有被稀釋。
2. **審查結果分流**：critical / major → 打回 Engineer；只有 minor 或無發現 → merge。
3. **merge**：`--no-ff` 保留五個 commit 的形狀，合完再跑一次 `tsc` + `bun test`。
   主線工作樹目前乾淨，與 Wave 1 的 15 個檔零重疊。**不要 push**（Scott 未授權）。
4. **Wave 2 三個 UI**（可並行，都踩在 Wave 1 的資料模型上）：
   - W2-A：編輯台「送出審閱」→ 先開**關卡指派對話框**（逐關選 agent 或我），確認才送審
   - W2-B：簽核頁 **agent pop-up** —— 跑完跳窗顯示完整全文 + 結論 + 是否存檔；存檔後關卡才出現內容
   - W2-C：管理中心流程範本檢視／編輯（可延後）

   ⚠️ **W2-B 的硬條件**：`edit` 關卡的落地是**整段替換**欄位（規格明列 diff UI 不做）。
   存檔對話框**必須顯示現值 vs 新值**，否則使用者按下去就把手寫內容整段換掉。

## 還沒收的線頭

- **實機 UAT 完全沒做。** 簽核流程改動幾乎零人眼驗證，Wave 2 做完要出 UAT 題目（用 `Uat` skill）。
- **舊帳**：對話框遷移的實機 UAT、W3 的 11 題視覺驗收、wave1+2 的 10 題 —— 見 `PROJECTS.md`。
- **Bellows 額度用盡**（2026-08-26 08:13 重置）。派工前一律先跑 `bun ~/.claude/LIFEOS/TOOLS/AgentQuota.ts --json`。
- **兩個 agent 都停在句子中間過**（Engineer 一次、Cato 兩次）。不要採信 `completed` 這個狀態字，
  一律自己跑 `tsc` / `bun test` 驗實際產出。
- **未 push**：main 領先 origin，`origin/main` 還在 `083f970`。push 要問過 Scott。

## 這次的方法論（值得保留）
- 主 session 當 PM，不寫 code，只派工與驗收
- agent 回報「完成」一律當成待驗證，實跑 `tsc` + `bun test` 才算數
- 測試單獨跑綠、整套跑紅 = 測試污染，那是訊號不是雜訊（這次靠它抓到 store 單例的疑慮，
  最後證實是測試 fixture 用了通用 id，但順著查出了上面那個 active-project bug）
