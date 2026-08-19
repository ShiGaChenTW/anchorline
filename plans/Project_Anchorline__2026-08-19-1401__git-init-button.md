# 儀表板一鍵 git init

**建立時間：** 2026-08-19 14:01
**最後更新：** 2026-08-19 14:12
**狀態：** 已完成

## 目標

專案資料夾還沒 `git init` 時，儀表板「版本控制」卡出現可執行的按鈕；按下去在該資料夾跑 `git init`，不要只給可複製的指令。

## 背景脈絡

紅框那張卡目前只有說明文字。`git-doctor` 把「不是 git 專案」標成 info，所以「版控健檢」也不會出現。`collect_git` 用 `rev-parse HEAD` 當存在性檢查，空 repo（剛 init、還沒 commit）會被誤判成「不是 git 專案」，按鈕按完畫面看起來沒變。

## Plan Steps

- [x] Step 1 — Rust `git_init`：參數寫死、已註冊根、已是 repo 就拒絕 <!-- sf:t=G7K2M9P4 -->
- [x] Step 2 — `collect_git` 改認 work tree；空 repo 不再被當成沒有 git <!-- sf:t=H3N8Q1R6 -->
- [x] Step 3 — 儀表板按鈕 + 確認框；只 init、不 add/commit <!-- sf:t=J5T0V2W8 -->
- [x] Step 4 — 契約／headline 測試，桌面版確認按鈕與 init 後畫面 <!-- sf:t=K4X7Y3Z1 -->

## 決策紀錄

- 14:01 — 只執行 `git init`，不順便 `add` / `commit`。原因：替使用者寫下沒看過的提交越界。排除：一次做完 initial commit。
- 14:01 — 走 `openspec_init` 同一套例外（可逆、不外流、參數寫死、前端先確認），不把執行權加進 git-doctor。原因：doctor 的產物是文字指令；commit/push 仍不可從 WebView 偷偷跑。

## 阻塞 / 待決議

無

## 結束摘要

儀表板「版本控制」卡在 `git` 不存在時出現「git init」按鈕。按下去先確認，再由 Rust 跑寫死的 `git init`（不 add、不 commit）。空 repo 改由 work tree 判定，init 完會顯示「已起版控」。目前跑的 `/Applications/Anchorline.app` 要重編才吃到這版。
