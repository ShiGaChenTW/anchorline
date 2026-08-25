# Function wish list — 貼上截圖

**建立時間：** 2026-08-25 21:00
**最後更新：** 2026-08-25 22:10
**狀態：** 已實作，待實機 UAT

## 目標

願望的說明欄可以直接貼截圖，張數不限，圖插在游標位置——所以圖的順序就是正文裡的順序。

## Plan Steps

- [x] Step 1 — 純函式：檔名、相對路徑、markdown 片段、正文切段（text/image）+ bun 測試
- [x] Step 2 — Rust `save_wish_image` / `read_wish_image` 窄通道（落點寫死 `.anchorline/wishlist-assets/`）+ 契約測試
- [x] Step 3 — UI：compose／編輯兩個 textarea 吃 paste、加「貼上截圖」鈕、清單縮圖
- [x] Step 4 — tsc + bun test + cargo test

## 決策紀錄

- 21:00 — 圖不另存一份清單，正文裡的 `![](wishlist-assets/…)` 就是唯一紀錄。UAT 那邊把證物存成獨立欄位，圖只能附在題目末尾；這裡要求「依正文順序」，把 ref 插進正文是唯一自然的做法，順序不必另外維護。
- 21:00 — 刪圖＝在正文刪掉那一行，不做刪檔。孤兒檔留在 assets 目錄，沒有正確性代價。

## 阻塞 / 待決議

貼上→寫檔→縮圖那一段只有桌面版跑得到（原生橋），瀏覽器只驗到 UI 有畫出來。要實機 UAT 前得先重新打包 App。

## 結束摘要

願望說明欄吃 ⌘V 貼上的截圖，張數不限。圖寫進使用者專案的 `.anchorline/wishlist-assets/`，
正文在游標位置插一行 `![截圖](wishlist-assets/<編號>-01.png)`——所以圖的順序就是正文的順序，
清單也照這個順序畫縮圖。另有「貼上截圖」鈕走 `navigator.clipboard.read()`，給不想用鍵盤的人。
`blobsFromClipboard` 從 tracking.ts 抽成 `lib/clipboard-images.ts`，UAT 證物那條線改用同一份。
