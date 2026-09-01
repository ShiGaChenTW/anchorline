<!-- 每一項寫成單行：Anchorline 的 Task Tracking 只取 checkbox 的第一行當步驟
     文字，換行的後半段在追蹤畫面上會消失。 -->

## 1. 路線資料（純函式，`prd-triage.ts`）

- [x] 1.1 `RouteId` 擴 `"vibe"`、加 `VIBE_SECTIONS = ["summary","problem","goals"]`、第四張路線卡（name「試作／探索」；desc「還不確定要不要做——先動手驗證，只留一頁意圖」；cases：週末專案／一次性腳本／想法未成形／之後可能轉正）——`tests/prd-triage.test.ts` 驗卡片欄位齊全且全卡零 L 編號字樣
- [x] 1.2 `routeScaleLabel` 加 vibe 分支「意圖 1 頁 · 3 欄位」——同檔測試釘住，並驗三條既有路線的文案逐字不變
- [x] 1.3 四張卡各加「時機」行（vibe：動工前 5 分鐘 AI 起草你只審；openspec：不寫 PRD 一個 change 一份紀錄；lite：出現轉折訊號就轉——AI 修 A 壞 B、新功能違反既有寫法；full：動工前想清楚）——測試逐卡驗時機文案存在
- [x] 1.4 `projectRoute`／`visibleSectionIds`／`isSectionVisible`／`hiddenSectionIds` 認得 vibe——測試：vibe 只見三節、自訂章節仍可見、hidden 清單＝全量減三節

## 2. 型別（`src/data/types.ts`）

- [x] 2.1 驗證 `Project.route` 的 `Exclude<RouteId,"openspec">`（types.ts:230）隨 1.1 自動涵蓋 vibe——`bunx tsc --noEmit` 綠即證；順手更新該欄位 doc 註解（現在寫「full 或 lite」，會誤導下一個讀的人）

## 3. 持久化與 migration（同型坑：重載回退 full）

- [x] 3.1 `normalizeRoute` 認 `"vibe"`（回傳型別擴為 `"lite" | "vibe" | undefined`）——`tests/prd-triage.test.ts` 倣既有 lite 重載測試：vibe 專案經 migrate 後不回退 full，髒值仍回 undefined
- [x] 3.2 修 `store.ts` `setProjectRoute` 的持久化三元（1922 行 `route === "lite" ? "lite" : undefined` 會把 vibe 靜默存成 full）——store 測試：設 vibe → 序列化 → 讀回仍是 vibe

## 4. gate（`prd-gates.ts` 純資料＋ store 接線）

- [x] 4.1 `VIBE_GATE_SPEC` 純資料：`summary-incomplete` 只查 `what`、`non-goals-min` 降為 ≥1（仍 block）、指標類 gate 關、warn 組與 hints 不載入、`emptySections` 關——`tests/prd-gates.test.ts` 逐條驗
- [x] 4.2 store 的 `activeGateSpec()`／`gateSpecFor()` 依 route 選 spec：vibe 回 `VIBE_GATE_SPEC` 且不經 `domainGates`（決策 5：vibe 一律忽略領域包）；lite/full 走現行路徑逐字不變——store 測試：vibe 專案掛領域包後 gate 結果與未掛時相同

## 5. 建案 UI（`src/pages/projects.ts`）

- [x] 5.1 route-grid 渲染四卡（既有 map 應自動長出，驗 CSS 版面容得下第四卡）、`pickRoute("vibe")` 建案落 `route: "vibe"`——UAT 題：四卡顯示、選「試作／探索」建案後編輯台只見 3 節

## 6. 編輯台（`src/pages/editor.ts`）

- [x] 6.1 `route-select` 加 vibe 選項，切換走 `setProjectRoute` 現行確認流程——UAT 題：vibe ↔ lite ↔ full 三向切換皆可
- [x] 6.2 升降檔對話框加種子文案「已寫的 3 節原樣保留，新增 N 節待補」（N 從目標路線章節數算，不寫死）——純函式部分進 `tests/prd-triage.test.ts`，對話框呈現出 UAT 題

## 7. 匯出組版（`prd-file.ts`）

- [x] 7.1 驗證 `renderPrdMarkdown` 濾節走 `visibleSectionIds` 免改；但 138 行路線標籤是寫死的 lite/full 三元，vibe 會誤標「Full」——補分支「試作（3 節）」，`tests/prd-file.test.ts` 釘住 vibe 組版（只出三節＋標籤正確）

## 8. 最小治理（一鍵自簽＋錨點）

- [x] 8.1 vibe 檔簽核＝一顆「自簽」鈕：寫入簽核紀錄＋`anc:t=` 錨點事件進稽核軌跡（不跳過簽核，轉正時可 replay；方向見 proposal 決策 2，介面細節實作時定）——簽核純邏輯進對應 signoff 測試檔，按鈕流程出 UAT 題

## 9. 驗證

- [x] 9.1 `bun run typecheck`／`bun test` 全綠，測試數只增不減（AC-01）
- [ ] 9.2 彙整本 change 的 UAT 題（5.1／6.1／6.2／8.1）成 `plans/uat-*.md` 並實機勾選（AC-04）
