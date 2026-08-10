# 治理覆蓋率 — 未治理 task 的數量統計

**建立時間：** 2026-08-10 22:03
**最後更新：** 2026-08-10 22:20
**狀態：** 進行中（等視覺確認）

## 目標

在兩個地方顯示「開始治理之後，有多少事情繞過了治理鏈」：

- **專案儀表板**（`dashboard.ts`）：該專案自己的數字
- **專案總覽**（`overview.ts`）：跨專案總和，卡片可展開列出各專案

判定依據是事件的 `subject` 有沒有 `anc:t=` 前綴 —— 有錨點代表串得回 plan 步驟，
沒有就是繞過治理鏈直接發生的事（手動 commit、未來 Border Loom 的未治理 task）。

## 決策紀錄

- 22:03 — **基準線 = 第一筆帶錨點事件的時間**（Scott 選 a）。之前的事件完全不計。
  既有 repo 有幾百個沒有錨點的 commit，全算進去會顯示「未治理 487」——那個數字
  不可行動，只會讓人以後忽略這張卡片。沒有任何帶錨點事件時顯示「尚未開始治理」，
  不顯示 0：兩者意思差很多。
- 22:03 — **判定用 `anc:t=` 前綴，不用字元集比對。** 原本打算用 Crockford 字元集
  比對裸 id，但七位全數字的 commit hash 也符合那個 pattern —— 約 3.7% 的 commit
  會被錯算成已治理。前綴是精確的。
- 22:03 — **新增 `readLog` bridge action，不擴大 `EDITABLE_EXTS`。** App 讀不到自己
  的 `.anchorline/log/*.jsonl`（讀取白名單沒有 jsonl，`tracking.ts` 的
  `loadAuditLog` 因此是一個沒人呼叫的死 export）。把 jsonl 加進白名單會同時開放
  `writeFile` 與 `openPath`，讓 append-only 的檔變成可整檔覆寫 —— 那正是
  `append_allowed` 存在的理由。窄通道符合 BRIDGE.md 的原則。Scott 已核可。
- 22:03 — **Border Loom 端的開通訊號 = 專案有沒有 `.anchorline/` 目錄**，不偵測對方
  裝了沒。這不是新發明：Anchorline 自己的 Claude Code hook 已經是這樣判的
  （`hookInstallSnippet()` 的 `[ -d "$r/.anchorline" ] || exit 0`）。

## Plan Steps

- [x] Step 1 — `paths.rs`：`log_dir_of()` 謂詞（已註冊根目錄 ∧ `.anchorline/log`）
- [x] Step 2 — `commands.rs`：`read_log` action（唯讀、有分片與位元組上限）
- [x] Step 3 — `lib.rs` 註冊 + `ping` 的 capabilities 補上 `readLog`
- [x] Step 4 — `native.ts`：`readLog` 包裝
- [x] Step 5 — `governance.ts`：純函式 `governanceCoverage()` + 測試
- [x] Step 6 — `dashboard.ts`：單一專案的卡片
- [x] Step 7 — `overview.ts`：跨專案總和 + 可展開的各專案明細
- [x] Step 8 — `docs/BRIDGE.md` 補上第 13 個 action（契約文件，改行為就改文件）

- 22:20 — **修掉自己引進的 join key 不一致**：App 內動作寫的 subject 是
  `anc:t=XXXX`（帶前綴），而 2026-08-10 稍早改的 backfill 寫裸 id。兩種形狀等於
  兩條各自獨立的軌跡，而且不會有任何錯誤。已統一成帶前綴。

## 阻塞 / 待決議

- **視覺未經實機確認。** Chrome（localhost:5173）打不開這一頁的主內容區 ——
  側欄正常、無 JS 錯誤、但 `.main` 整片空白。把本次改動 stash 掉重現同樣結果，
  **所以是既有問題，不是這次造成的**，但也因此無法用瀏覽器驗證版面。
  要看實際畫面只能用 Tauri 測試版。

- **收尾前必須跟 Scott 確認**：只裝一套軟體時的實際行為（只有 Border Loom／
  只有 Anchorline／兩者都有）三種情況各自的畫面與寫入行為。

## 結束摘要

（待補）
