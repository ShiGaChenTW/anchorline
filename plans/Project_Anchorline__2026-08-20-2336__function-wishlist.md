# OpenSpec Function wish list

**建立時間：** 2026-08-20 23:36
**最後更新：** 2026-08-20 23:52
**狀態：** 已完成

## 目標

在編輯台 OpenSpec 區塊加入 Function wish list：文字檔存願望、可編輯、勾選送出給 OpenSpec 寫 spec、寫完封存並標示已寫 spec。

## Plan Steps

- [x] Step 1 — 純函式 parse/serialize/狀態轉換 + bun 測試
- [x] Step 2 — Rust `write_wishlist` 窄通道（路徑寫死）+ 契約測試
- [x] Step 3 — 編輯台 OpenSpec 區塊 UI（新增／存檔／編輯／勾選／送出／封存）
- [x] Step 4 — OpenSpec 入口吃 handoff，填標題並餵 AI 初稿
- [x] Step 5 — 測試 + 瀏覽器驗收

## 決策紀錄

- 23:36 — 檔案放 `<root>/.anchorline/function-wishlist.md`，不放 `openspec/`。在 `openspec/` 建檔會讓 `openspec_probe` 把「只有 wishlist」誤判成已經 init。
- 23:36 — 封存是手動「已寫 spec」，不在送出時自動封存。送出只代表「去寫 spec」，不是 spec 已寫完。
- 23:36 — 沒勾選時送出不導頁（Anti-claim）。
- 23:51 — `.os-list` 設 `min-height: 11rem`，否則檔案樹會把清單壓成 12px。

## 阻塞 / 待決議

無

## 結束摘要

編輯台 OpenSpec 區塊加上 Function wish list。瀏覽器以 localStorage 為後備；桌面版寫入專案 `.anchorline/function-wishlist.md`。勾選送出到 OpenSpec 入口預填標題與 AI 背景；標示已寫 spec 後進封存欄。
