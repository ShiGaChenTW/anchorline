# 通用 PRD 骨架換成 TEMPLATE-prd-unified.md

- 專案：Anchorline
- 開始：2026-08-31 17:05
- 來源範本：`docs/TEMPLATE-prd-unified.md`（12 章 0–11，Lite/Full 分級）

## 決策

Scott 定調：**第 0 章與第 11 章不是編輯內容，是檢核工具**。

- 第 0 章「要不要寫這份 PRD」→ 前置判定工具（開 Ticket / Lite / Full）
- 第 11 章「送出前自檢」→ 送審前自檢清單，能用規則判的接進 gate，判不了的留人工勾
- 第 1–10 章 → 可編輯章節骨架，取代現行通用 7 章

章節 id 沿用現有的 `summary` / `problem` / `goals` / `metrics` / `stories` / `scope` / `open`，
因為 `folder-import.ts`、`beginner-flow.ts`、`file-tree.ts`、`export.ts`、`review.ts`
共 5 個檔以這些 id 當鍵。新章節才給新 id。編號改用連號 01–15，範本章次記在 `desc`。

## 章節對照

| n | id | 標題 | 範本來源 |
|---|---|---|---|
| 01 | docinfo | 文件概況與修訂紀錄 | 1 |
| 02 | summary | 摘要 | 2.1 |
| 03 | problem | 專案背景與佐證 | 2.2 |
| 04 | goals | 目標與非目標 | 2.3 |
| 05 | metrics | 成功指標 | 2.4 |
| 06 | sources | 需求來源 | 2.5 |
| 07 | users | 目標客群與競品 | 3.1 + 3.4 |
| 08 | stories | 用戶故事與流程 | 3.2 + 3.3 |
| 09 | scope | 功能範圍與開發排程 | 4 |
| 10 | arch | 產品架構 | 5 |
| 11 | spec | 需求規格 | 6 |
| 12 | proto | 原型、視覺與附件 | 7 |
| 13 | accept | 驗收標準 | 8 |
| 14 | kpi | 產品指標 | 9 |
| 15 | open | 開放問題 | 10 |

## 步驟

- [x] 1. `src/lib/prd-triage.ts` — 第 0 章判定工具
- [x] 2. `src/lib/prd-selfcheck.ts` — 第 11 章自檢清單
- [x] 3. `src/data/seed.ts` — SEED_SECTIONS 換成 15 章
- [x] 4. `src/lib/prd-gates.ts` — BASE_GATE_SPEC 依新章節與自檢清單重寫
- [x] 5. 下游 id 對應：folder-import / beginner-flow / file-tree / export / review
- [x] 6. 測試：新增 triage + selfcheck 測試，修既有 prd-gates / prd-template 測試
- [x] 7. `bunx tsc --noEmit` + `bun test` 全綠

## 結束摘要（2026-08-31 18:10）

`bunx tsc --noEmit` 乾淨、`bun test` 2024 pass / 0 fail、Interceptor 實機驗過（0 console error）。

### 做了什麼

- `SEED_SECTIONS` 從 7 章換成 15 章（範本第 1–10 章，子節展開）。舊 id 全部保留，下游 5 個檔零改動。
- 第 0 章 → `src/lib/prd-triage.ts`：`TRIAGE_CRITERIA` + `triage()`，回 ticket / lite / full。
- 第 11 章 → `src/lib/prd-selfcheck.ts`：20 項自檢，能用規則判的接 gate、判不了的人工勾。
- `BASE_GATE_SPEC` 加 13 條新規則（全部 warn + skipWhenEmpty）＋ `bullets.max` predicate。
- 編輯台右欄新增「送出前自檢」卡，人工勾選存 localStorage（不進 AppState）。

### 兩個順手修掉的既有缺陷

1. **領域包章節編號硬寫在 frontmatter**（`n: "08"`）。通用骨架一變長就跟 base 撞號，
   症狀是大綱重號、沒有錯誤訊息。改成一律由位置算。
2. **`evaluateChecks` 綁死欄位鍵**（`values.ms`）。範本改版把 `scope` 拆成 `phases` + `ms`，
   綁死的檢查會靜默失效。改讀整章。

### 實機驗證抓到、當場修掉的設計錯

自檢卡原本兩態（pass / fail）。gate 規則多半 `skipWhenEmpty`，於是「沒有 finding」
被讀成通過 —— 一份還沒寫的需求規格顯示「沒有模糊字眼 ✔」。改成三態，空白章節
與 `untouched` 的 block 一律 `pending`（○），跟 gate 卡講同一種話。
空白專案現在是 3 pass / 14 pending / 0 fail，不是 16/20。

### 第二輪（同日 18:40）

- **自檢卡標「待優化」**：summary 加 `pill-warn` 徽章 + 一條黃底說明，講清楚 4 項只能人工勾、
  其餘是啟發式比對，**先當提示看，不要當放行條件**。跟結構 gate 的視覺分開，因為 gate 才是放行條件。
- **第 0 章有 UI 入口了**：`projects.html` 新增 `#modal-triage`，「新建 PRD」／「新手引導」／`?new=1`
  三個入口全部先過這一關，再進原本的三題精靈。判準從 `TRIAGE_CRITERIA` 渲染，判定即時更新，
  結果帶到精靈確認頁的「判定」列。做成**精靈之前的一道關**而不是精靈的第 0 題 —— 塞進精靈裡
  就變成「已經在建了才問要不要建」。

### 沒做的

- **判定結果不寫進 `Project`**。Lite/Full 還不是可切換的模式，先存一個沒人讀的欄位，
  換來的是一次 schema 變更加一次 migration，然後在真的要用時發現當初存錯形狀。
- Lite / Full 沒有做成可切換的模式；Full 才有的章節一律 warn 不 block，靠這個
  讓 Lite 也能送審。要真的分級要動 store 與建專案 UI。
- 範本沒有註冊成「整份 PRD 範本」（`SEED_FULL_TEMPLATES`）。
