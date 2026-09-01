# 「新增 PRD」流程優化

> 現行流程的完整圖與逐字文案：`docs/flow-new-prd.html`
> 這一關的來源設計：`plans/Project_Anchorline__2026-08-31-1705__prd-unified-template-swap.md`

## Context

2026-08-31 我把範本第 0 章（要不要寫這份 PRD）做成建立專案前的一道關。流程因此是：
入口 → 權限 → 第 0 關 → Q1 → Q2 → Q3 → 確認頁 → 建立 → 資料夾詢問 → 編輯台。

盤過一遍之後，問題不在關卡數，在**有幾關是空轉的**：第 0 關算出 Lite／Full 卻不影響任何後續行為；
確認頁問「目標發布」但那個值從來沒被寫進專案；「範本類型」不套範本；「先跳過」和「下一題」
是同一顆按鈕。使用者付出了十個決策點的成本，其中四個換不到任何東西。

**判準一條：每一關要嘛改變後面發生的事，要嘛砍掉。** 問了不用的問題比不問更貴——
它同時花掉使用者的時間與對這個工具的信任。這一輪不動關卡數（Scott 拍板），
只讓每一關真的算數。

⚠️ **先更正一筆我自己寫錯的紀錄。** 上一份 plan 寫「三個入口全部先過這一關」，
實際是**四個入口、其中一個繞過**：`projects.html?beginner=1`（`src/pages/projects.ts:1085-1089`）
直接 `openWizard(true)`，從不呼叫 `openTriage`。而那正是 onboarding 選「新手撰寫流程」
之後的去向（`src/pages/onboarding.ts:210`）——最需要被問「這件事值不值得一份 PRD」的人，
是唯一沒被問到的人。

---

## 要改的九件事

### A ·（主軸）讓 Lite 判定真的生效

第 0 關現在算得出 `lite`／`full`，然後把結果丟掉。上一輪我說「要生效就得改 schema 加 migration」——
**那句話是錯的**：`store.applyFullTemplate(projectId, sections, seed, template?)`
（`src/data/store.ts:2182`）本來就支援 per-project 章節覆寫，`store.resetSections(projectId)`
（`:2327`）可以還原回領域包骨架。Lite 就是「這個專案自帶一份 8 章的骨架」，可逆、零 migration。

- `src/pages/projects.ts`：把 `triageNote: string` 換成 `triageResult: TriageResult | null`
  （`triage()` 的完整回傳，`src/lib/prd-triage.ts`），確認頁的「判定」列從它算。
- `modal-create` handler：`store.addProject(p)` → `setActiveProject(p.id)` 之後，
  若 `triageResult?.verdict === "lite"`，用 `SEED_SECTIONS.filter(s => LITE_SECTIONS.includes(s.id))`
  呼叫 `applyFullTemplate(p.id, liteSections, {}, undefined)`。
  第 4 個參數給 `undefined` 是刻意的——**Lite 不該重設簽核流程**，那是範本分類的職責。
  順序要在 `setSectionValues("summary", …)` 之前，且 `summary` 本來就在 `LITE_SECTIONS` 裡。
- 確認頁的「判定」列補一句後果：Lite 時寫「建立後先放 8 章，之後可在編輯台按『回到領域包骨架』展開成 15 章」。
  判定要說得出它會做什麼，否則它仍然只是一段文字。
- Full 與 ticket 走原路（不套骨架）。

### B · 刪掉「目標發布」

`new-target`（`projects.html:288`）在全 repo 只被 `resetWizard()`（`src/pages/projects.ts:849`）
讀來重設，從沒寫進 `Project`。刪 input 與那兩行重設。

### C · 「範本類型」正名，不要謊稱套範本

`new-tpl` 讀出來只決定 `p.tag` 的顏色分類（`src/pages/projects.ts:994`），
標籤卻寫「範本類型」。**`<option value>` 維持不變**（`tpl.includes("資安")` 靠它），
只改 `<label>` 為「分類標籤」、選項顯示文字改為「不分類／平台／資安／成長」。
真正的整份範本套用在 PRD 範本頁，不在這裡。

### D · 合併「先跳過」與「下一題」

兩顆按鈕的 handler 都是 `setWizardStep(wizStep+1) + saveDraft()`，
而 `validateWizardStep()` 永遠回 `true`（`src/pages/projects.ts:840`）——零行為差異。
刪掉 `#wizard-skip`，在 `.ask-help` 補一句「答不出來留白直接下一題」。
（ADHD 層的原則就是「降低同時可見選項」，見 `src/lib/adhd-ui.ts:1-6`。）

### E · 首次導覽不得蓋在對話框上

`.tour-root` z-index 200（`shared.css:8110`）壓過 `.modal-back` 的 40（`shared.css:2595`），
`first-run-tour.ts` 完全不知道有 modal 開著，還會 `.focus()` 搶焦點——
第一次使用的人按下「新建 PRD」會拿到兩個 `aria-modal="true"` 的對話框。（本輪截圖拍到。）
在 `src/lib/ui.ts` 的 `openModal()` 裡關掉導覽（單一去處，所有 modal 都受惠），
並在 `startTour()` 開頭遇到 `.modal-back.open` 就不啟動。

### F · `?beginner=1` 也要過第 0 關

`src/pages/projects.ts:1088` 的 `openWizard(true)` 改成 `openTriage(true)`。
這一行是上面那筆更正的修法。

### G · 「先看範例 2FA」要真的打開範例

`projects.html` 的 `btn-open-sample` 是裸的 `<a href="editor.html">`，`projects.ts` 沒有 handler，
所以它開的是「當下 active 的那個專案」，不是範例。加一個 handler：
`store.setActiveProject(<isSample 的專案 id>)` 之後再導頁；找不到範例就維持現狀並 toast。

### H · 讓「7 步」說實話

`BEGINNER_STEPS`（`src/lib/beginner-flow.ts:26`）有 7 筆，**但全 repo 只有定義那一行，
從沒被 import 或渲染**——是死碼。實際渲染的是 6 筆的 `EDITOR_BEGINNER_TRACK`
（`src/pages/editor.ts:1343`），而精靈只有 3 題。三個數字沒有一個對得起來。

- 刪掉 `BEGINNER_STEPS` 與它的 `BeginnerStep` 型別。留著它，下一個人會「照它把文案改回 7」。
- 改文案，講清楚兩段：`projects.html:141`（空狀態卡）與 `onboarding.html:73`（匯入模式選項）
  改成「建立前問 3 題，進編輯台後有 6 節教練帶你補完」。
- `src/pages/projects.ts:696` 的註解 `/* ─── PRD 新手撰寫流程（7 步） ─── */` 一併改掉。
- `onboarding.html:24` 的「四步開始協作」講的是 onboarding 自己的 4 個畫面，是對的，不動。

### I · 第 0 關的勾選要跟著草稿存

`saveDraft()`（`src/pages/projects.ts:794`）只存 `wiz-what`／`wiz-who`／`wiz-why`／`new-title`。
Triage 的勾選是記憶體裡的一個 `let`，重整就沒了——而 A 之後判定會決定套哪套骨架，
掉了就等於靜默降級成 Full。把勾選的判準 id 陣列一起存進 `DRAFT_KEY`，`loadDraft()` 一併還原。

---

## 不在這一輪

- **不併關、不折成單頁。** Scott 選了「關卡數不變」。
- **匯入資料夾照舊繞過第 0 關**，這是對的：那些 PRD 已經存在，問「要不要寫」沒有意義
  （`store.importProjectCandidates`，`src/data/store.ts:1289`，已自帶 `sourceFolder`，
  也不會跳資料夾詢問）。
- **不動 `ask-` / `.modal-ask` 命名空間**，`plans/spec-dialog-migration.md:36,52` 明講那是這個精靈的。

---

## 驗證

1. `bunx tsc --noEmit` 乾淨、`bun test` 全綠（現況 2026 pass）。
2. **A 的核心斷言**（要有自動化測試，不能只靠眼睛）：
   給定 `triage(["iterate-logic"])`，建立後 `store.projectSections[pid]` 長度為 `LITE_SECTIONS.length`，
   且每個 id 都在 `LITE_SECTIONS` 裡；`store.resetSections(pid)` 之後回到 15 章。
   放在 `tests/prd-triage.test.ts` 或新開 `tests/new-prd-flow.test.ts`。
3. **四個入口逐一走過**（Interceptor，`bunx vite --port 5173 --strictPort`）：
   `新建 PRD`、`🌱 新手引導`、側欄 `＋`(`?new=1`)、`projects.html?beginner=1`——
   四個都要先看到 `#modal-triage`。
4. **E 的驗收**：清掉導覽的 seen 旗標，重載 `projects.html`，導覽出現時按「新建 PRD」——
   斷言 `#tour-root` 不存在，且焦點在 modal 內。
5. **B/C/D 的驗收**：確認頁進階設定不再有「目標發布」；標籤是「分類標籤」；頁尾只有一顆前進鈕。
6. **H 的驗收**：`grep -rn "7 步" .` 在 `src/`、`*.html` 應為零命中（`docs/flow-new-prd.html`
   是引用舊文案的說明頁，要一併更新——它自己寫了「UI 文案改了這份就過期」）。
7. 全部過了才更新 `docs/flow-new-prd.html` 的圖與逐字文案，並改對照日。
