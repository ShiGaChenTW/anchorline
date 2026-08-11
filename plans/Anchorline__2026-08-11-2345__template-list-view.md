# PRD 範本庫：新增列表檢視 + 篩選與排序

**建立時間：** 2026-08-11 23:45
**最後更新：** 2026-08-11 23:45
**狀態：** 已完成

## 目標

範本庫除了現有的卡片牆，新增「列表」檢視；兩種檢視共用同一組篩選條件，
列表可以點表頭改排序。

驗收：切換檢視不會改變筆數（同一份篩選結果，兩種畫法）；點表頭第一次升冪、
再點降冪、第三次回到預設；重新載入頁面記得上次選的檢視。

## 現況

- 篩選軸有三個：kind（標題列的三顆鈕）、cat（分類 tab）、q（搜尋）
- 畫法只有一種：`#grid.grid-cards`
- **完全沒有排序** —— 目前順序是 `store.templates` 的原始順序
- 領域包分頁**沒有任何篩選**，只有搜尋

## 設計

**檢視切換**放在 `.filters` 那一行右側（不放標題列——那裡已經有三顆種類鈕，
再加會超過焦點卡那條「同框 4 個」的規矩）。選擇存 localStorage。

**排序在兩種檢視都要能用**，因為排序不是列表獨有的需求：
- 列表：點表頭（標題／分類／段落／使用／出處）
- 卡片：`.filters` 行的排序下拉，與列表共用同一份 sort state

**篩選補洞**：領域包分頁加「來源」篩選（內建／自訂／覆寫內建）——
那是這頁唯一完全沒有篩選的分頁。範本本身的 cat + q 已存在，改成兩種檢視共用。

判定邏輯全部進 `src/lib/template-view.ts` 純函式，比照這個 codebase 的硬性風格。

## 不做什麼

- 不做多欄同時排序（一次一欄就夠，兩欄排序的心智成本換不到價值）
- 不做欄位顯示/隱藏設定
- 不做分頁（範本數量級是幾十，不是幾千）
- 不動卡片本身的樣式與內容
- 不把 cat tab 換成下拉（既有 UI 不因為新增檢視而改動）

## Plan Steps

- [x] Step 1 — `src/lib/template-view.ts`：filter / sort / nextSort 純函式 <!-- anc:t=RXVG2SEH -->
- [x] Step 2 — `tests/template-view.test.ts`：排序三態、篩選交集、空結果 <!-- anc:t=ZJV5QT06 -->
- [x] Step 3 — `templates.html`：filters 行加檢視切換與排序下拉，新增列表容器 <!-- anc:t=ETHGH28V -->
- [x] Step 4 — `shared.css`：列表表格樣式，表頭可點且看得出目前排序欄與方向 <!-- anc:t=QH6YANN8 -->
- [x] Step 5 — `templates.ts`：接上檢視狀態、列表渲染、表頭排序、localStorage 記憶 <!-- anc:t=NQ9M7VME -->
- [x] Step 6 — 領域包分頁加「來源」篩選 <!-- anc:t=9X4RS0WB -->
- [x] Step 7 — `bunx tsc --noEmit` 與 `bun test` 全綠 <!-- anc:t=W11EGWNA -->
- [x] Step 8 — Interceptor 驗證：兩檢視筆數一致、表頭三態、重載記得檢視 <!-- anc:t=RJGNDFX5 -->

## 驗證紀錄

- 指令：`bunx tsc --noEmit`（綠）、`bun test`（840 pass / 0 fail，新增 16 條）
- 結果：卡片 10 筆 → 列表 10 列，count 文字不變（同一份篩選）；grid 在列表模式 hidden
- 排序實測：段落欄 asc `6,6,8,8,9,11,11,11,12,13`、desc 完全反向；第三次點 aria-sort 回 none
- 換欄實測：點標題欄 aria-sort=ascending，前一欄回 none（不沿用方向）
- 重載後 localStorage `anchorline:tpl-view=list`，列表仍在
- 領域包分頁：排序組與檢視切換自動收起，來源篩選出現；builtin 7 個、custom 0 個
