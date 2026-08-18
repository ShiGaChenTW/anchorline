# History 提交 diff 檢視

**建立時間：** 2026-08-18 16:59
**最後更新：** 2026-08-18 17:12
**狀態：** 已完成

## 目標

在 Anchorline 做出 GitDesktop History 那種三欄畫面：提交列表、檔案清單、unified/split 語法色 diff，底下可寫本機註解。不搬他們的 React 元件，只學交互。

## Plan Steps

- [x] Step 1 — 橋：唯讀 `git show` + hash/path 守衛，寫進 BRIDGE.md <!-- anc:t=K8DIFF01 -->
- [x] Step 2 — 純函式 patch 解析／unified+split 渲染 + 測試 <!-- anc:t=K8DIFF02 -->
- [x] Step 3 — history.html 頁、rail 入口、Changes/History 兩分頁 <!-- anc:t=K8DIFF03 -->
- [x] Step 4 — 本機註解 Write/Preview，不碰 git commit <!-- anc:t=K8DIFF04 -->

## 決策紀錄

- 16:59 — 做成獨立 `history.html`，不塞進審閱佇列。審閱看的是 PRD 欄位 diff，這頁看的是 git commit。
- 16:59 — 程式自己重畫，不引用 `fokr_source/GitDesktop-master/`。授權只借交互。
- 16:59 — 註解只活在 localStorage。不開新的寫入橋、不執行 git commit。

## 阻塞 / 待決議

無

## 結束摘要

獨立頁 `history.html`：Changes / History、檔案清單、unified/split diff、本機註解。
沒有搬 GitDesktop 元件。`git show` 只收 hex hash 與相對路徑。
未在瀏覽器實機點過（這是桌面橋功能）。用 `bun run tauri dev` 打開側欄「提交與 Diff」驗。
