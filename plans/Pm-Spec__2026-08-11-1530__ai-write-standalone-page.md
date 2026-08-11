# AI 撰寫獨立成頁（與編輯工作台同階層）

**狀態：** 完成
**開始：** 2026-08-11

## 需求（Scott 原話）

> 撰寫教練 >「AI撰寫」功能：請把這個功能獨立出來，階層與「編輯工作台」一樣，
> 介面重新設計，第一個頁面設計一個 dashboard：
> 1. 該專案如果已有 PRD，則顯示適用模板、現在各階段的評分、簽核狀態、
>    改善與修復建議；並提供按鈕「AI撰寫」「重新整理」
> 2. 尚未有 PRD 的專案，則顯示創建引導頁面，分成兩大塊：「AI撰寫」以及
>    「建立空白範本」，其中「AI撰寫」要再分成兩小塊：「AI提問引導撰寫」、
>    「讀取專案資料夾，自動產出全文」

## 現況

`AI 撰寫` 現在是 `editor.html` 第三欄「寫作教練」裡的一張卡
（`src/pages/editor.ts:1375-1391`），執行邏輯在同檔 `1187-1332`
（`aiWriteAbort` / `setAiWriteProgress` / `runAiWrite` / `bindAiWrite` /
`runAiWriteOne`），底層是 `src/lib/ai-coach.ts:writeFullPrd`。

「與編輯工作台同階層」= 這個 repo 的 top-level destination 定義：
一份 `.html` + 一支 `src/pages/*.ts` + `vite.config.ts` input +
`RailPage` union + `RAIL_ITEMS` + 側欄專案卡底下的 `projActionsHtml()`。

## 步驟

- [x] 讀清楚現有 AI 撰寫、rail 註冊點、PRD／評分／簽核資料模型
- [x] 新增 `write.html`（含防閃爍 theme bootstrap，與其他 14 檔逐字相同）
- [x] 新增 `src/pages/write.ts`：dashboard（有 PRD）／創建引導（無 PRD）雙態
- [x] 新增 `src/lib/ai-interview.ts`：AI 提問引導撰寫的問答迴圈
- [x] 導覽註冊：vite input、`RailPage`、`IC.write`、`RAIL_ITEMS`、
      `projActionsHtml`、`status-bar` 標籤、`MobileNavPage`、數字鍵 6
- [x] 從 `editor.ts` 移除 AI 撰寫卡與整段執行邏輯，改留一行入口連結
- [x] `shared.css` 追加 `.aiw-*` 樣式
- [x] `bunx tsc --noEmit` + `bun test` 通過
- [x] 用自己的 dev server（非 5173）實機驗證兩種狀態

## 設計決定

**「已有 PRD」的判定**：任一章節的**已儲存**欄位有非空字串。草稿不算 ——
草稿是「AI 寫了但你還沒收下」，把它算成已有 PRD 會讓引導頁在第一次 AI 撰寫
之後就永遠消失。

**四張卡對應四個需求**：適用模板（領域包）／各階段評分（逐章 liveScore +
結構 gate score）／簽核狀態（`state.cases[pid].stages`）／改善與修復建議
（gate findings 的 block+warn，加上逐章未過的 checks，各自帶一個
「去編輯這節」連結）。

**產出一律進草稿**（沿用編輯台的規則）：`store.setSectionDraft`，
不直接寫 `sectionValues`。中途停止保留已寫好的部分。

**「建立空白範本」**：把領域包的章節骨架以空字串寫進已儲存的正文，
讓「這個專案有 PRD 了」成立，再跳編輯台。不是單純的 `location.href`。

## 後續追加（同一天）

1. **兩張卡合併**：「適用模板」併進「改善與修復建議」。模板資訊壓成一列 chip
   放頂部，因為建議之所以是這幾條，正是這個模板決定的。版面隨之從四張卡變三張。
2. **逐章「AI 優化」按鈕**（`src/lib/ai-optimize.ts`）：各階段評分每一列尾端一顆按鈕。
   未達 100% 可按，已達 100%／未設金鑰／無編輯權限各自反灰，理由寫在 `title`。
   四步流程：問要不要診斷 → 診斷（`critiqueSectionWithAI`）→ **方向可編輯** →
   產出（`generateAIDraft`）→ **diff 確認** → 套用進草稿。
   類別一律 `aiopt-` 前綴：dashboard 的「優化 Dashboard」已佔用 `.opt-*` 與 `#opt-title`。
   diff 必須包在 `.field-diff > .field-diff-body`，少了內層 `.fv-line` 停在
   `display:inline`，所有改動會擠成一行。
3. **改名＋移位**：側欄「AI 撰寫」改為「PRD 審閱監控」並排到專案動作第一位。
   工具列那顆執行鈕仍叫「AI 撰寫」—— 那是動詞，不是頁名。

4. **ADHD 版面重設計**（impeccable skill，Operate mode）。原本首屏是四張等重的卡、
   七顆同權重按鈕、21 個狀態數字、兩行圖例，而且沒有任何一句話說「現在做什麼」。
   改成三層：
   - **頭條「現在做這一件」** — 沿用總覽的 `.ov-hero` 視覺，只指一節，
     附一句為什麼、一顆主要 CTA、四個事實（含「約 N 分」的時間盲對策，
     常數 `CHARS_PER_MIN`／`DEFAULT_TARGET` 從 `focus-mode.ts` 匯出共用）。
   - **章節進度** — 安靜。未起步不畫紅（RSD）、一列只留一個記號
     （原本 ✓!✗ 三個數字 × 七列）、圖例砍成表頭 title、逐列按鈕降成 ghost。
     綠色只留給「填滿且規則全過」，100% 卻掛 ✗ 的綠條是自相矛盾的訊號。
   - **兩塊摺疊** — 改善建議與簽核狀態預設收合；簽核只有真的在審時才自動展開。
5. **跨專案頁不標選中專案**：在總覽／清單／審閱佇列／章節範本四頁，
   側欄專案卡片不加 `.on`、不展開那三個動作。判準與那四個入口共用
   `WORKSPACE_HREFS` 一份清單。

### 踩到的坑：循環 import 的 TDZ

第 5 項第一版把工作區入口做成模組頂層 `const`，裡面讀 `IC.dashboard`。
`rail-nav.ts` 與 `rail-projects.ts` 互相 import，頂層求值 `IC` 會炸
`Cannot access 'IC' before initialization` —— **整個側欄消失、頁面停在
「載入中…」**，而且 tsc 與 bun test 全過。icon 只能在函式裡取。

## 途中改掉的一個設計

「各階段評分」原本打算直接用 `liveScore`，實機一看是**七個零** —— 它從
`section.score` 出發，而那個欄位只有種子範例資料填過，真實專案永遠是 0。

換成 `critiqueSectionLocal.score` 之後更糟：空章節 48 分、寫了三行的章節 41 分。
它的基底分只看字數（>200→78、>80→65、其餘 48），再逐條扣警告 —— 有內容才會
觸發規則，所以**寫得越多扣得越多**。一個獎勵空白的分數放在鼓勵人寫下去的頁面上
是反效果。

最後不自己發明分數，改成兩個既有訊號並排：
**完成度**（已填欄位／全部欄位，純客觀）＋ **規則結果**（`runSectionCoach` 的
✓通過／!警告／✗阻擋，app 自己的判斷）。卡片標題仍是結構 gate 分數 ——
那是這個 app 真正拿來擋送審的那個分數。

## 結束摘要

新增 `write.html` + `src/pages/write.ts` + `src/lib/ai-interview.ts`，
導覽註冊 8 處（vite input／RailPage／IC／RAIL_ITEMS／projActionsHtml／
status-bar／MobileNavPage／數字鍵 6 兩張表），`shared.css` 追加 `.aiw-*`，
`editor.ts` 移除 172 行 AI 撰寫執行邏輯改留入口連結。

實機驗證（自己的 dev server :5199，Interceptor 真 Chrome）：
無專案／無 PRD 引導頁／有 PRD dashboard 四張卡三態都畫得出來；
建立空白範本寫進 7 節骨架並跳編輯台，回來後轉成 dashboard 態；
重新整理無 console error；主題切換 kami／terminal／github 三態
`document.documentElement.dataset.theme` 都對。
`bunx tsc --noEmit` exit 0、`bun test` 702 pass、`vite build` 產出 write chunk。

未驗證：AI 提問引導撰寫與讀取資料夾產出全文的**實際模型呼叫** ——
測試環境沒有 API Key，兩顆按鈕正確地停用。
