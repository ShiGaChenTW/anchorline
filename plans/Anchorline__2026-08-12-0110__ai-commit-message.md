# 版控健檢接 AI：從實際改動產生 commit 訊息

**建立時間：** 2026-08-12 01:10
**最後更新：** 2026-08-12 01:10
**狀態：** 已完成

## 目標

版控健檢在偵測到未提交檔案時，能讀真實的改動內容，產生一則說得出
「這次到底改了什麼」的 commit 訊息，交給使用者確認後複製指令去執行。

驗收：產生的訊息必須引用得到實際檔名或行為，而不是「更新多個檔案」這種
從 dirtyCount 就能寫出來的空話。

## 為什麼現在寫不出來

`GitStats` 只有 `dirtyCount`（一個數字）。用數字產生的訊息永遠只能說
「12 個檔案還沒提交」，那正是這次要解決的問題。要寫出真實訊息，
必須讀 `git status --porcelain` 與 `git diff`。

而 `exec::git()` 的參數**一律在 Rust 寫死，前端碰不到**（見 `exec.rs` 檔頭
與 `docs/BRIDGE.md` §3.1）。所以這件事必須加一個新的原生 action，
不能從前端組指令。

## 邊界（不可退讓）

`git-doctor.ts` 立過的線：**只產生指令，不執行任何 git 寫入。**
這次維持原樣 —— AI 產出訊息，使用者確認後複製 `git commit` 指令自己執行。
理由不變：從 WebView 按一下就改動 repo，出錯時使用者連發生了什麼都不知道。

新增的原生 action 一律唯讀（`status` / `diff`），寫死參數，路徑要過既有的
已註冊根目錄檢查。

## 不做什麼

- 不執行 commit、不 stage、不 push
- 不送整份 diff 給模型（大改動會爆 token，也會把不該外流的內容送出去）：
  patch 有上限，超過就退回只送檔案清單與 stat
- 不自動套用訊息，一定要人看過
- 不改既有的診斷邏輯（`diagnoseGit`）

## 設計

原生 `gitChangeset(root)` → `{ status, stat, patch, truncated }`
- `status`：`git status --porcelain`（檔名 + 狀態碼）
- `stat`：`git diff HEAD --stat`
- `patch`：`git diff HEAD --unified=1`，超過上限就截斷並標記

純函式 `commit-message.ts`
- `parsePorcelain()`：狀態碼 → 檔案清單（新增／修改／刪除／改名）
- `buildCommitPrompt()`：組 system/user，帶入 repo 是否用 conventional commits
  （沿用 `git-doctor.ts` 既有的 `usesConventionalCommits`）
- `parseCommitDraft()`：把模型輸出正規化成 `{ subject, body }`，
  主旨過長要截、要擋掉模型愛加的引號與 ``` 圍欄
- `commitCommand()`：組出可貼的 `git commit` 指令，訊息要正確跳脫

UI：儀表板版控健檢區塊，dirtyCount > 0 時出現「AI 產生訊息」，
產生後顯示可編輯的文字框與「複製指令」。

## Plan Steps

- [x] Step 1 — `src/lib/commit-message.ts`：解析、組 prompt、正規化、組指令 <!-- anc:t=XEJP0X26 -->
- [x] Step 2 — `tests/commit-message.test.ts`：porcelain 各種狀態碼、截斷、跳脫、圍欄 <!-- anc:t=MT7EEB86 -->
- [x] Step 3 — Rust `git_changeset` command（唯讀、寫死參數、走既有路徑檢查） <!-- anc:t=KN11K96F -->
- [x] Step 4 — `native.ts` 與 `docs/BRIDGE.md` 補上這個 action 的契約 <!-- anc:t=NGH9XMMC -->
- [x] Step 5 — 儀表板 UI：按鈕、產生中狀態、可編輯結果、複製指令 <!-- anc:t=DABT982K -->
- [x] Step 6 — AI 未設定 / 無改動 / diff 過大 三種狀態要各自說得清楚 <!-- anc:t=Y6AE3XFR -->
- [x] Step 7 — `bunx tsc --noEmit`、`bun test`、`cargo test` 全綠 <!-- anc:t=0D6G35QW -->
- [x] Step 8 — 實機驗證：拿這個 repo 自己的未提交改動跑一次 <!-- anc:t=A5NNGWPK -->

## 驗證紀錄

- 指令：`bunx tsc --noEmit`（綠）· `bun test` 865 pass / 0 fail（新增 25）· `cargo test` 32 pass
- 真實資料實測（這個 repo 當下的未提交改動）：
  porcelain 解析出 15 個檔案（修改 12 · 未追蹤 3），與 `git status` 一致
  patch 24,588 → 截到 24,000，truncated=true —— 上限在真實工作量下就會觸發，
  代表畫面上那句「差異過大已截斷」不是裝飾
  prompt 約 10,200 token；指令跳脫對反引號與 $ 正確（單引號包）
- 未驗：Tauri IPC 那一跳與真正的 AI 呼叫，兩者都需要在打包後的 App 內操作
