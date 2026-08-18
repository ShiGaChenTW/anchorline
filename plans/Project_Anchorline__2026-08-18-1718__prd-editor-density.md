# PRD 撰寫頁對齊 History 密度

**建立時間：** 2026-08-18 17:18
**最後更新：** 2026-08-18 17:28
**狀態：** 已完成

## 目標

編輯工作台的寫作畫布長得像上一屏 History：章節列有 Write / Preview / Split，欄位不要一人佔滿一屏，工具列讓位給正文。

## Plan Steps

- [x] Step 1 — 欄位模式改 Write/Preview/Split，抽出套用函式 <!-- anc:t=K8ED01 -->
- [x] Step 2 — 章節列總開關 + 來源列壓成一行 <!-- anc:t=K8ED02 -->
- [x] Step 3 — 降單欄高度、收工具列、大綱選中態 <!-- anc:t=K8ED03 -->

## 決策紀錄

- 17:18 — 動的是 `editor.html`（真的寫 PRD），不是 `write.html`（審閱監控）。
- 17:18 — 每個 Markdown 欄位 `height: 100vh-280px` 是主因：一節兩個欄位就滾不完。

## 阻塞 / 待決議

無

## 結束摘要

編輯台章節列有 Write / Preview / Split，所有 Markdown 欄位一起切。
單欄高度從「一人一屏」改成最多約 42vh（只有一個欄位才放到 58vh）。
工具列只留匯出、大綱、預覽審閱、送出審閱。TypeScript 通過。未在 tauri 視窗點過。
