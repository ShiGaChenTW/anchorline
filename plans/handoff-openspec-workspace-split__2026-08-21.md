# Handoff — 編輯工作台拆分（方案 B）開工

**交棒人：** task/openspec worktree session（PM 角色）· 2026-08-21
**接棒人：** 新 session，繼續當 PM，派工給 Engineer 實作，不要自己動手寫 code
**上一份：** `plans/handoff-task-openspec__2026-08-21.md`（merge 進 main、裝正式版那一輪）

---

## 一句話現況

`main` 已經 merge 完 `task/openspec` 的兩個功能（wishlist 帶入下拉、孤兒內容偵測），
commit `a38c28e`，已裝進 `/Applications/Anchorline.app` 並 sha256 驗證通過。

**Scott 決定：執行方案 B——OpenSpec 升格成獨立工作區頁面。** 這份 handoff 就是要交接「開始實作方案 B」。

---

## 方案 B 是什麼（決策脈絡）

Scott 質疑「為什麼 OpenSpec 內容還放在編輯工作台裡面，不是應該獨立出來」。
我（PM）派了四個並行、各自被指定不同硬約束的 general-purpose agent 做唯讀設計探索
（design-an-interface skill 的方法論：Design It Twice，逼出真正有差異的方案），
產出 A（同頁頁籤）／B（獨立路由）／C（併進 tracking.html）／D（IDE 式常駐雙子樹）四份設計，
整理成對照後發布成 Artifact 給 Scott 看：
**https://claude.ai/code/artifact/bedcc85d-6f97-4f7f-a949-e7d42bd73938**

Scott 選了 **B**。方案 B 的設計全文在那份 Artifact 裡，這裡摘要開工要看的部分：

### 現況（要拆的東西）

`editor.html`／`src/pages/editor.ts`（"編輯工作台"）目前是固定三欄：
- **左欄 `#outline-col`**：PRD 章節大綱 ＋ 領域選單 ＋ 孤兒內容面板（`#orphan-panel`）
  ＋ 可收合的 OpenSpec 檔案清單（`#openspec-list`，`renderOpenSpec()` 畫的，列
  `openspec/changes/*/`底下的 proposal/tasks/design/specs，點了用 `openFileInEditor()`
  在同一塊內容欄開）＋ 內嵌的 Function Wish List（`#os-wish`）＋ 專案檔案樹（`#file-tree`）。
  六件事擠在同一條會捲動的欄位。
- **中欄 `#editor-col`**：共用一塊內容區，在「畫 PRD 章節表單」跟「顯示原始檔案內容」之間切換
  （`openFile` 這個 module 變數是不是 null 決定畫哪一種）。
- **右欄 `#coach-col`**：AI 寫作教練，PRD 專用，看 OpenSpec 檔案時完全不相關。

### 方案 B 要做的（設計 agent 的具體提案）

1. **新開一個頁面**：`openspec-workspace.html` ＋ `src/pages/openspec-workspace.ts`。
   **不要**重用 `openspec.html`（那是開新 change 的三步驟精靈，形狀不對）。
   三欄佈局：
   - 左欄：change 選單（`openspec/changes/*` 分 active／archived）＋ 該 change 的檔案清單
     （proposal／tasks／design／specs，沿用 `renderOpenSpec()` 現有的分組邏輯 `groupOpenspecFiles`）
     ＋ 專案檔案樹（從 editor.html 搬過來）
   - 中欄：原始檔案檢視／編輯——把 `editor.ts` 的 `openFileInEditor`（readFile → textarea ＋
     diff-highlight backdrop → writeFile）整支搬過去，這是唯一真正的邏輯搬遷，其餘多半是佈局重排
   - 右欄：換掉寫作教練，改成 spec 相關的東西——任務進度（可以呼叫 `tracking.html` 已有的
     checklist 掃描當函式庫用，不要重造）、`openspec validate` 結果、change 的健康狀態
2. **`editor.html` 瘦身成 PRD-only**：拿掉整個 `#openspec-list` 區塊（os-bar／os-files／os-wish），
   中欄拿掉 `openFile` 那個分支（只剩 PRD 表單渲染），左欄留：PRD 章節大綱、領域選單、孤兒內容面板、
   專案檔案樹。右欄教練不變。
3. **導覽**：`src/lib/rail-nav.ts` 加一個新的 `RailPage`（例如 `"openspec-workspace"`），
   **不是**固定側欄項目——照現有慣例（`editor`／`tracking`／`write` 都是 `hidden:true`，
   入口改掛在選中的專案卡片底下，見 `rail-projects.ts` 的 `projActionsHtml`），這個新頁面
   應該跟 `editor`／`tracking` 同一類（對某個專案做的事），不是跟 `templates`／`openspec`
   同一類（跨專案）。
4. **State 串接**：`store.activeProjectId` 兩邊都讀，本來就會跟著走。新增
   `store.activeOpenSpecChange`（記上次開哪個 change）、可選 `activeOpenSpecFile`（記上次開哪個檔），
   讓從 Wish List「撰寫 Spec」或 `tracking.html` 的 tasks.md 連結過來時，能直接落在對的地方。

### 沒收斂、要先問 Scott 的一件事

**Function Wish List 該歸 PRD（留在 editor.html）還是歸 OpenSpec（搬去新頁面）？**
四份設計裡 A 主張歸 OpenSpec，C／D 主張歸 PRD（它是「要做什麼」的發想，餵給撰寫 Spec，
本質更接近 PRD 端產出）。方案 B 自己沒有明確表態選哪邊。**接棒者在動工前應該先問 Scott**，
不要自己拍板——這不是實作細節，是分類問題。

---

## 開工前務必做的事

1. **這個 worktree（task/openspec）的分支已經沒有存在意義**——它的兩個 commit 已經 merge 進
   main（`a38c28e`）。新工作**不要**繼續在 `task/openspec` branch 上加，開一個新分支
   （例如 `feat/openspec-workspace`），從 main 的最新狀態開始。
2. `git -C ~/Documents/20_Projects/Project_Anchorline fetch origin` 確認
   main 有沒有變化——main 目前領先 origin 若干個 commit、**尚未 push**（Scott 沒要求 push，
   我沒動）。
3. 派 Engineer 實作（PM 角色，自己不要動手寫 code）。實作完照這個 repo 的既有規矩走：
   `bunx tsc --noEmit` ＋ `bun test` 全綠才算數，UI 這種改動另外派一輪 `codex review --uncommitted`
   做獨立審查（**不要**透過 Cato 的 Agent 工具 wrapper，它的 `maxTurns: 5` 是硬上限，
   會在審查中途被切斷——直接跑 codex CLI 的 `review --uncommitted` 子指令比較穩，這一輪已經
   驗證過好幾次）。
4. 這個改動會動到 `editor.html`／`editor.ts`（拿掉整塊）＋ 新增兩個檔案（`.html`／`.ts`）
   ＋ `rail-nav.ts`（新頁面項目）＋ `rail-projects.ts`（專案卡片動作按鈕）＋ `src/data/store.ts`
   （新增 `activeOpenSpecChange` 之類的 state）。跨檔案改動，建議先確認 Engineer 有讀過
   CLAUDE.md 裡「新增主題必須改四層」那類容易漏改的坑（雖然這次不是主題系統，但同一種
   「散在多檔、漏一處就靜默失效」的風險存在——尤其是 rail-nav 的 `hidden:true` 慣例跟
   `detectRailPage()` 的路徑比對，漏掉會導致側欄偵測不到新頁面且不報錯）。

---

## Anchorline 其他未收的線（沿用上一份，這輪沒動）

| # | 項目 | 狀態 |
|---|---|---|
| 1 | `.mcp.json`（task/openspec worktree 裡，未追蹤）疑似真的 `BORDER_LOOM_MCP_TOKEN` | 沒 rotate，我沒動 |
| 2 | 孤兒內容功能 5.2／5.3（真實瀏覽器流程）| 需要 Scott 實機 UAT |
| 3 | 08-16 對話框遷移那批 UAT 題目 | 還沒出，是最大的舊帳 |
| 4 | 一次性範本造成的孤兒查不到原標題 | 已知限制，記在 `openspec/changes/orphan-content-recovery/tasks.md` |

---

## 給接棒者的提醒

1. **先問 Wish List 歸屬**，再開始派工——這決定了 editor.html 瘦身後左欄長什麼樣，
   晚問代表可能要重做一次佈局。
2. 完整四方案對照與每份的原始佈局示意圖在 Artifact：
   https://claude.ai/code/artifact/bedcc85d-6f97-4f7f-a949-e7d42bd73938
3. `main` 目前工作區乾淨，`git log --oneline -5` 應該看到 `a38c28e`（merge task/openspec）
   在最上面。開新分支前先確認這一點沒有被別的 session 動過。
