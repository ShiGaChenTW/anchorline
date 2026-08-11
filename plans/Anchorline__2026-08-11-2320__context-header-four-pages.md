# 四個專案頁套用 context header

**建立時間：** 2026-08-11 23:20
**最後更新：** 2026-08-11 23:20
**狀態：** 已完成

## 目標

把 `write` / `signoff` / `editor` / `tracking` 四頁的標題列，從舊的
`.toolbar`（單行：標題 + spacer + 一排按鈕）換成其餘五頁已經在用的
`context-surface-toolbar` 結構，讓全站九頁的開頭是同一個形狀。

驗收：四頁的 `.toolbar` 都帶 `context-toolbar context-surface-toolbar`，
且 `[data-od-id="page-title"]` / `page-sub` 仍被各自的 page script 更新得到。

## 現況

已套用（5）：overview `01` · projects `02` · review `03` · templates `04` · openspec `05`
未套用（4）：editor · write · signoff · tracking —— 這四頁是**專案層級**的，
不是跨專案的工作區頁，所以路徑前綴用 `project /` 而不是 `workspace /`。

## 編號與標籤

| 頁 | kicker | state | path |
|---|---|---|---|
| editor | `06 / EDITOR` | DRAFTING | `project / editor` |
| write | `07 / REVIEW MONITOR` | LIVE REVIEW | `project / review-monitor` |
| signoff | `08 / SIGN-OFF` | DECISION GATE | `project / signoff` |
| tracking | `09 / TASK TRACKING` | EXECUTION | `project / task-tracking` |

## 不做什麼

- 不改任何一頁的按鈕組成或行為，只換外層結構與位置
- 不動 `data-od-id`（od 系統與導覽都靠它）
- 不改 `WORKSPACE_HREFS`：這四頁本來就不該算「沒有選中專案」的跨專案頁
- 不重寫 `adhd-ui.ts` 的 chrome 整合邏輯，沿用 context-toolbar 的既有分支

## 風險

- `editor.ts` 在 `.toolbar` 之後插入 `#flow-strip-host` 與 `#beginner-coach`
  （`insertAdjacentElement("afterend")`）—— 外層節點必須維持是同一個 `.toolbar`
- `tracking.html` 的 `<main>` 是 `overflow:hidden` 的 flex column，
  context header 比舊 toolbar 高很多，可能壓縮下方三欄

## Plan Steps

- [x] Step 1 — editor.html 套用 context header，確認 flow-strip 仍插在標題列之後 <!-- anc:t=2J53CR18 -->
- [x] Step 2 — write.html 套用 <!-- anc:t=KAMKJMYT -->
- [x] Step 3 — signoff.html 套用 <!-- anc:t=B31BDN99 -->
- [x] Step 4 — tracking.html 套用，並確認三欄高度沒被壓掉 <!-- anc:t=KX8JK8QT -->
- [x] Step 5 — `bunx tsc --noEmit` 與 `bun test` 全綠 <!-- anc:t=GPV8X4N5 -->
- [x] Step 6 — Interceptor 逐頁量 `.context-surface-toolbar` 是否生效、標題有沒有被 script 寫入 <!-- anc:t=VCX54HX3 -->

## 驗證紀錄

- 指令：`bunx tsc --noEmit`（綠）、`bun test`（824 pass / 0 fail）
- 結果：四頁實測 `surface:true`；kicker/state/path 正確；h1/sub 仍由各頁 script 寫入；
  editor 的 `#flow-strip-host` 仍緊接 `.toolbar`；四頁標題列高度一致 286px
- 副作用：context-toolbar 分支不渲染「下一步」引導列，四頁因此失去該行（見下）
