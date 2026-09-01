# Anchorline — PRD 路線持久化 + PRD 檔案版本管理

- 建立：2026-09-01
- 分支：main
- 來源：Scott「2. 做檔案快照，另外請針對專案資料夾內的 PRD 檔案進行管理／3. 依據你的建議調整」

## 背景

盤點結果：路線有三條（`full` / `lite` / `openspec`，`src/lib/prd-triage.ts:41`），
但**選了哪條沒有存進 `Project`**（`projects.ts:917` 的 `triageNote` 只是確認頁上一行字），
所以 full 與 lite 目前是同一條路。PRD 內容本身則完全沒有版本控制：
`docinfo.revisions` 是手打表格、`Release` 是產品版號、`history.html` 是 git commits
（PRD 存在 localStorage，不在 git 裡）。

## 中途修正（重要）

**這個 repo 已經有一條 PRD 版本線** —— `AppState.prdVersions`：送審＝`commit`、
核准＝`merge`，各自帶整份 PRD 的深拷貝（`lib/prd-versions.ts`）。原本的計畫
「掛在狀態轉換上」因此改成**掛在 commit / merge 上**：那兩支手上已經有
`version.docs`，寫出去的檔案跟 App 裡那一版逐字相同；改用 live state 撈的話，
「核准版」會混進核准之後才打的字。

缺的從來不是版本，是**檔案**：`capVersions` 會丟掉舊 commit，整條線活在
localStorage，App 之外沒人讀得到。

## 決策

- PRD 主檔寫 `<root>/docs/PRD.md`，**狀態轉換時自動寫**（Scott 2026-09-01 選定）
- 快照寫 `<root>/.anchorline/prd/PRD-<stamp>-<status>.md`，不覆寫
- 降級 full → lite 是**檢視過濾器**，隱藏不刪（沿用 `Project.domain` 改領域的先例）
- 狀態變更的偵測點放在 `emit()`，一個 hook 蓋掉所有轉換（現有與未來的）

## 步驟

- [x] 1. Rust：`write_prd` / `list_prd_versions` 兩個 command
- [x] 2. `native.ts` 綁定
- [x] 3. `types.ts`：`Project.route?: RouteId`（undefined = full，向後相容）
- [x] 4. `prd-triage.ts`：`visibleSectionIds(route)` / `isSectionVisible()`
- [x] 5. `projects.ts`：建立時寫入 route
- [x] 6. 編輯台／完成度／gate 吃過濾後的章節
- [x] 7. 路線切換 UI（降級／升級，隨時可切）
- [x] 8. `prd-file.ts`：組 markdown + 寫主檔 + 寫快照
- [x] 9. `emit()` 掛狀態轉換偵測
- [x] 10. 版本清單 UI（看得到快照、能開啟）
- [x] 11. 測試

## 結束摘要

全部 11 步完成。驗證：tsc 乾淨、2042 bun 測試綠（+21）、40 Rust 單元測試綠、
vite build 成功、Interceptor 實機走過完整流程。

**實測抓到一個 bug 並修掉**：`migrateProject` 逐欄位重建 Project，漏了 `route`，
所以選了 Lite 的專案重新載入就變回 Full（15 節照樣長出來，零錯誤訊息）。
store.ts 裡同一個坑的註解已經寫了七次，這是第八次。判斷抽成
`prd-triage.normalizeRoute()` 才進得了測試網（store 的相依鏈用 `import.meta.glob`，
bun test 載不進來）。

**沒驗到的**：PRD 檔案實際寫入 —— `isNative()` 在瀏覽器是 false，只有桌面殼會跑。
Rust 端的路徑決策抽成 `prd_target()` 並有 3 個單元測試（主檔路徑寫死、快照進
`.anchorline/prd/`、路徑穿越被擋），但「送審之後 docs/PRD.md 真的出現」要實機 UAT。

**待 Scott 拍板**：Lite 的章節編號會跳號（01–05 之後直接 11、13、15、16），
因為 `n` 來自完整骨架。保持穩定編號是刻意的（重新編號會讓跨文件引用失效），
但看起來像漏了東西。
