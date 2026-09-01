## Why

路線系統目前是三檔：full（15 節）、lite（8 節）、openspec（不建專案）。
缺的是第四檔——**還不確定要不要做**的東西：週末專案、一次性腳本、未成形的
想法。這類專案今天只有兩條爛路：硬塞進 lite（8 節對一個「先動手驗證」的
念頭太重，空白頁殺死啟動——PRD §2.2 的 ADHD 機制）；或乾脆不進 App
（零錨點、零軌跡，之後想轉正時治理鏈沒有起點可 replay）。

第四檔「試作／探索」對應社群檔位光譜的 L0+L1：只留一頁意圖（3 節），
治理降到最小但**不歸零**——一鍵自簽仍寫錨點事件，轉正時鏈條接得回去。

這是檔位系統的 P1 開工單。完整規格的單一真相在本 change
（PRD §10 明寫不複寫，見 `docs/PRD.md:183`）。

## Decisions（2026-09-02 Scott 拍板，對應 PRD §10 Q-08～Q-12）

1. **命名（Q-08）**：「試作／探索」。UI 全程不出現 L0–L4 編號——
   flow-layers 已經用掉 L1–L6，撞名的混亂比對齊社群術語的好處貴。
2. **治理（Q-09）**：一鍵自簽＋錨點的最小治理，不完全跳過簽核。
   完全跳過的代價是轉正時無鏈可 replay。
3. **升檔訊號（Q-10）**：閾值 6 個 change／3 題 UAT 失敗起步。
   P1 只放卡片上的靜態「時機」文案；自動偵測是 P3，不在本 change。
4. **openspec（Q-11）**：vibe 檔不產 openspec change，追蹤先用 plans 檔；
   升檔時重看。
5. **gate × 領域包（Q-12）**：vibe 一律忽略領域包的 gate；lite/full 維持現行。

## What Changes

- `prd-triage.ts`：第四張路線卡（`vibe`）＋ `VIBE_SECTIONS`（summary／
  problem／goals 三節）＋ `routeScaleLabel` 分支；四張卡各加一行「時機」
  靜態文案（含決策 3 的升檔訊號措辭）
- `types.ts`：`Project.route` 經 `Exclude<RouteId, "openspec">` 自動涵蓋 vibe
- `normalizeRoute` 認 `"vibe"`；`setProjectRoute` 的持久化三元同步修
  （現行寫法會把 vibe 存成 undefined＝重載回退 full，與 lite 當年同型的坑）
- `prd-gates.ts`：`VIBE_GATE_SPEC` 純資料；store 的 gate spec 依 route 接線，
  vibe 不疊領域包
- `projects.ts` 建案四卡、`editor.ts` route-select 與升降檔種子文案
- `prd-file.ts`：組版走 `visibleSectionIds` 應免改，但路線標籤那行寫死了
  lite/full 二元，要補 vibe 分支並用測試釘住
- 最小治理：vibe 檔的簽核＝一鍵自簽＋錨點事件（進稽核軌跡，可 replay）

## Non-goals（不做什麼）

- **不做升檔訊號自動偵測。** 閾值只出現在靜態文案；偵測與提示是 P3。
- **不做首啟一題與導航漸進揭露。** 那是 P2，另開 change。
- **不做成本／風險曲線視覺化。** 已否決。
- **不做 L4 contract／CI 整合。** PRD §2.3 柵欄，未拍板不開工。
- **不做 diff UI。** R1 已拍板兩段式（Q-03），本 change 不觸碰。
- **不為 vibe 檔產 openspec change。** 決策 4：追蹤用 plans 檔，升檔時重看。

## Capabilities

### New Capabilities
- `vibe-route`: 第四檔路線「試作／探索」——3 節意圖頁、最小 gate、
  一鍵自簽＋錨點、可升檔轉正

### Modified Capabilities
（無——lite/full/openspec 三條路線與領域包 gate 的既有行為都不變，
純新增一檔）

## Impact

- `src/lib/prd-triage.ts`：路線卡、`VIBE_SECTIONS`、`routeScaleLabel`、
  `normalizeRoute`、可見性函式
- `src/data/types.ts`：`RouteId`/`ProjectRoute` 擴充（型別層，tsc 守）
- `src/lib/prd-gates.ts`：`VIBE_GATE_SPEC`
- `src/data/store.ts`：`setProjectRoute` 持久化、`activeGateSpec()`/
  `gateSpecFor()` 依 route 接線、自簽動作
- `src/pages/projects.ts`、`src/pages/editor.ts`：四卡渲染、route-select、
  升降檔對話框
- `src/lib/prd-file.ts`：路線標籤分支
- `tests/prd-triage.test.ts`、`tests/prd-gates.test.ts`、
  `tests/prd-file.test.ts` 與 store 測試骨架：對應新增測試
- 驗收基線：`bun run typecheck`／`bun test` 全綠、測試數只增不減（AC-01）；
  涉 UI 的出 UAT 題實機勾選（AC-04）
