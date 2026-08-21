# Handoff — main session（Miles）交接

**交棒人：** Miles（main session）· 2026-08-21
**接棒人：** 你 —— 接手 main session，對 Scott 彙報
**上一份：** `plans/handoff-main-session__2026-08-16.md`（對話框遷移那一輪，UAT 仍在等）

---

## 一句話現況

這一輪做的是 dashboard 專案身分卡加「簡寫」欄位（wishlist 取號用的 `shortCode`，
既有欄位、既有 `store.setProjectShortCode` API，這次只是把入口從側欄 rename 表單
搬一份到 dashboard 首頁，跟專案名稱同排）。兩個 commit，`main` 乾淨、**1315 測試全綠**、
tsc 乾淨，已 `bun run app:install` 裝進 `/Applications/Anchorline.app` 且 sha256 驗證通過。
**還沒 push**（`↑9↓1`，領先 origin 9 個 commit，其中只有這輪的 2 個是這次做的）。

---

## 這一輪做了什麼

兩個 commit：

| commit | 內容 |
|---|---|
| `223ea22` | 專案身分卡加簡寫輸入框（`#d-code`），跟 `#d-name` 同排，樣式比照名稱欄位、綁 `setProjectShortCode` |
| `7247329` | 補「簡寫」標籤（跟「專案」同排對齊）、專案名稱加 `maxlength=40`、簡寫欄位邊打邊過濾（即時轉大寫、擋非英文字母字元） |

改動檔案只有 `src/pages/dashboard.ts` + `shared.css`。

**驗證方式：** Interceptor 開 `dashboard.html`（`VITE_APP_VARIANT=test` 起 dev server 才有種子資料，
正式版首次進來是空的引導流程，不能直接測）。用 a11y tree 讀 `value=` 而不是看 `html` 的
`value=""` 屬性 —— 那個屬性本來就不會跟著 JS 設的 `.value` 走，讀了會誤判「沒存到」。
打過一次假訊號的坑：型別修飾詞 `sb2` 帶數字，`normalizeShortCode` 拒收是正常行為，
不是欄位壞了；另外偶爾整個 test context 會斷線（`context not found`），
重跑 `EnsureTestProfile.sh` 就好，不是 code 的問題。

---

## Anchorline 未收的線（依優先度，沿用上一份，這輪沒動到）

| # | 項目 | 來源 |
|---|---|---|
| 1 | **實機 UAT**（對話框遷移那批，題目還沒出）| 2026-08-16 那輪，仍卡著 |
| 2 | 拆 `auth.ts` 的 `delete window.confirm` workaround | 要等 1 |
| 3 | `templates.ts:639, 700` 跨 `await` 重讀模組層級可變狀態 | Relay 稽核 LOW |
| 4 | `templates.ts:752-755` 三個連續對話框，長按 Enter 自動走完 | Relay 稽核 LOW |
| 5 | `.modal-back` z-index 40 低於其他對話框 | Relay 稽核 LOW |
| 6 | Anchorline 沒有 DOM 測試環境，對話框只能靠 UAT | 獨立的票 |
| 7 | 舊帳：W3 的 11 題視覺驗收＋wave1+2 的 10 題 | 更早的 handoff |

這一輪沒碰任何一條，純粹是插隊做的小功能。**簡寫欄位本身不需要額外 UAT**——
底層 API（`setProjectShortCode`）已經在側欄 rename 表單上線一段時間，這次只是多一個入口。

---

## 給接棒者的提醒

1. **`main` 沒 push。** 動之前先 `git fetch` 看 origin 有沒有變化，`↑9↓1` 代表本地領先 9、
   落後 1（origin 上有一個本地沒有的 commit，push 前建議先看那個 commit 是什麼，
   別直接 force）。
2. **正式版已裝好但 fingerprint 對到 `223ea22` 不是 `7247329`**——因為 `app:install` 是在
   `7247329` commit 之前跑的一次（build 抓的是當時的 working tree，內容跟 `7247329` 一致，
   只是換裝腳本印出的 commit 註記慢了一拍）。這輪結束前會再跑一次 `app:install`
   把 fingerprint 對齊 `7247329`，跑完這份 handoff 应该已经是最新的了。
3. **對話框遷移那輪（08-16）的 UAT 題目還沒出**，是目前最大的未收線，優先度高於這次的小功能。
