# SpecForge 登入簽核 / 匯出 / 範例切換

**建立時間：** 2026-08-05 09:35
**最後更新：** 2026-08-05 09:50
**狀態：** 已完成

## 目標
新增登入與角色簽核管理、檔案匯出、一鍵移除／展示範例文件內容，並接入既有 MPA store。

## Plan Steps
- [x] Step 1 — 資料模型與權限核心（types / permissions / seed / store）
- [x] Step 2 — 登入頁 + session 閘道
- [x] Step 3 — 設定頁人員／Agent 管理與審核規則
- [x] Step 4 — 編輯／專案／審閱頁權限與匯出、範例切換
- [x] Step 5 — 建置驗證 + 重裝 App

## 決策紀錄
- 09:35 — 本地原型：session 存 localStorage；示範密碼 `demo`
- 09:35 — Agent 以 `agentFamily` 區分「同一種 agent」，禁止自寫自簽
- 09:50 — App 啟動優先開 `login.html`；state key 升至 `specforge:state:v2`

## 阻塞 / 待決議
無

## 結束摘要
- 登入頁 + 三角色 RBAC（admin / approver / editor）與 Agent 族系隔離
- 匯出 MD / JSON / HTML；一鍵隱藏／展示範例文件
- `/Applications/SpecForge.app` 與 DMG 已重裝
