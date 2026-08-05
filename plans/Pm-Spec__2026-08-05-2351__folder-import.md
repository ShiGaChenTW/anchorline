# 專案資料夾匯入

**建立時間：** 2026-08-05 23:51
**最後更新：** 2026-08-06 00:10
**狀態：** 已完成

## 目標
使用者點「專案匯入」→ 選資料夾 → 自動偵測 PRD 相關檔 → 對應軟體所需文件、評分與進度 → 確認後建立獨立專案內容；側邊欄可切換匯入／新建專案。

## Plan Steps
- [x] Step 1 — folder-import 偵測／對應／評分
- [x] Step 2 — types + store 每專案文件袋
- [x] Step 3 — 專案列表匯入 Modal
- [x] Step 4 — 側邊欄專案切換
- [x] Step 5 — CSS／typecheck／重建

## 決策紀錄
- 23:51 — 用 webkitdirectory 選資料夾（file:// / WKWebView 相容）
- 23:51 — 每專案 sectionValues 獨立 bag，切換 active 時 swap
- 23:51 — 資料夾可拆出多個候選專案（子目錄含 .md）
- 00:10 — requireAuth 自動掛側欄專案清單

## 阻塞 / 待決議
無

## 結束摘要
新增 folder-import 掃描器、import modal、projectSectionValues 獨立內容、rail 專案切換。typecheck + vite build 通過。
