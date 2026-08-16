# UAT 從 Task Tracking 拆成獨立頁

**建立時間：** 2026-08-17 01:57
**最後更新：** 2026-08-17 02:05
**狀態：** 已完成

## 目標
UAT 畫面獨立成「UAT使用者測試」，放在 Task Tracking 下方；Task Tracking 不再混實測報告。

## Plan Steps
- [x] 新頁 uat.html + 導覽／喚醒鏈改指過去
- [x] Task Tracking 濾掉 UAT；UAT 頁只列實測報告
- [x] 文案、skill、測試與驗收

## 決策紀錄
- 01:57 — 同一套 tracking 工作台用 pathname 分流，避免複製兩千行

## 阻塞 / 待決議
無

## 結束摘要
UAT 已拆成獨立頁 uat.html，側欄掛在 Task Tracking 下方。喚醒鏈與舊 `tracking.html?uat=` 都會進新頁。相關測試通過。
