# 編輯工作台 · ADHD 視角重新設計

> 2026-08-07 · E3 · ISA: `~/.claude/PAI/MEMORY/WORK/adhd-editor-redesign/ISA.md`

## 診斷：ADHD 壞掉的是五個機制，不是「太雜」

| 機制 | 原介面表現 |
|---|---|
| 任務啟動 | 空白 textarea + 4 行「本章怎麼寫」。讀說明本身就是一個任務 |
| 時間盲 | 全畫面零時間資訊 |
| 工作記憶（約 4 迴圈） | 同框約 30 個未完成訊號 |
| 顯著性偏誤 | 最亮的三樣是紅「未就緒」、紅 ✗×2、藍色外連——沒一樣是該打字的地方 |
| RSD／迴避 | 還沒動手就先看到 ✗✗ 與「無法送審(2)」 |

## 根因：R1 惡性強化迴路（寫死在渲染層）

```
卡住 → gate 未過 → editor.ts `gateOpen = !gate.canSubmit` → 面板自動展開
    → 畫面更滿更紅 → 認知負荷↑ → 更卡住 ↺
```

`editor.ts:325` 的檢查清單同構。**介面被設計成「你越掙扎，它就越吵」。**

## 已實作

- [x] **反轉揭露邏輯** — `gateOpen = gate.canSubmit && gate.warns > 0`；快過關才展開細節，卡住時安靜。數量留在 summary 行不遺失資訊
- [x] **檢查清單只在剩 1 項時展開**，其餘顯示「還有 N」
- [x] **`src/lib/focus-mode.ts`** — 專注模式：收大綱欄、收預覽欄、教練欄只留首卡、工具列 13→6 鍵、流程條退場。⌥F 或編輯欄按鈕切換，localStorage 記憶
- [x] **進度膠囊** — 「第 X / Y 節 · 還差 N 字 · 約 M 分」+ 即時進度條（`CHARS_PER_MIN = 40`）
- [x] **「還沒開始」≠「做錯了」** — `GateFinding.untouched`，空白欄位用灰 ○ 不用紅 ✗；判定等級完全不變

## 第二輪：`src/lib/writing-assist.ts`

- [x] **起手式** — 本章 tips 轉成填空骨架（`- 區分產品決策 vs 工程調查：`），只在章節近乎全空時出現。
      刻意不插入 `s.example` 原文：範例被誤當成自己的規格是更貴的錯
- [x] **Hyperfocus 守門** — 連續寫作計時，25 分鐘提醒一次；可 snooze 10 分、可本次關閉。
      停筆超過 5 分鐘自動重新起算，不會對著沒在打字的人跳
- [x] **中斷復原** — 記 `{sectionId, key, caret}`，回來直接把游標放回原處並閃一下。7 天後失效

## 第三輪：tasks.md 回讀 · `src/lib/openspec-import.ts`

- [x] **匯出埋錨點** — `export.ts` 每行加 `<!-- sf:s=<sectionId> -->` /
      `<!-- sf:c=<sectionId>/<checkId> -->`。markdown 渲染不顯示，agent 切 `[ ]`→`[x]` 也不會動到
- [x] **`parseTasksReadback`** — 錨點優先；舊版匯出（無錨點）走「章節內 label 比對」fallback，
      跨章節同名一律列 unmatched，寧可少認也不要認錯
- [x] **簽核一律不回讀** — `## 簽核` 段解析出來只為了告訴使用者「這 N 行被忽略」。
      讓 agent 勾 checkbox 就能通過規格簽核是權限漏洞，不是功能
- [x] **章節 status 用推導不用讀** — 全過 done / 有過 warn / 全無 empty。
      檔案裡的章節 checkbox 是給人看的摘要，不是真相
- [x] **先預覽再套用** — 表列每一項 `○ → ✔`，按「套用 N 項」才寫入

入口：專案頁匯出選單旁「回讀 tasks.md」。

### 驗證

| 案例 | 結果 |
|---|---|
| 匯出後原樣回讀 | 0 變更 · 22 項一致 · 走錨點 |
| agent 全勾 | 偵測 22 項變更 |
| 舊版無錨點 fallback | 同樣 22 項 · 0 unmatched |
| 簽核 4 行 | 全數忽略 |
| 瀏覽器實測 | 3 項變更套用後 04/06/07 由 `2/3 warn` → `3/3 done` |

## 仍未做

- `openspec/` 目錄與 change lifecycle（draft→active→archived）
- `specs/<capability>/spec.md` delta 撰寫與追蹤 UI
- tracking 頁仍讀 vite 編譯期 glob，改檔要重 build

## OpenSpec 現況（2026-08-07 查核）

**只有單向匯出，沒有架構追蹤撰寫。**

有的：`export.ts` 的 `buildOpenspecPrd` / `buildOpenspecTasks` / `buildOpenspecProposal` /
`exportOpenspecBundle`（`## Non-Goals`、`## Desired Outcomes` 一字不差對齊 gate）；
`folder-import.ts` 辨識 openspec 慣例檔名；`plan-parser.ts` + tracking 頁解析 `plans/*.md` checkbox。

沒有的：`openspec/` 目錄與 change lifecycle（draft→active→archived）、
匯出 tasks.md 的回讀（agent 勾完 SpecForge 不知道）、
`specs/<capability>/spec.md` 的 delta 撰寫與追蹤 UI。
且 tracking 頁讀的是 vite 編譯期 glob，改檔要重 build。

## 順手發現的既有 bug（未修，不在本次範圍）

`.shell` 與 `.wb` 的 grid 軌道指派錯位：`main.main` 被放進 6px 的 resize-handle 軌道，
編輯欄寬度歸零，整個主區在乾淨 profile 下不可見。**用 `git stash` 清空本次改動後重現，
確認為既有問題。** 疑似 `resize-panels.ts` 的 track 指派與 DOM 順序不同步。

## 驗證

- `bun run typecheck` — exit 0
- Chrome 實測：專注模式前後截圖、進度膠囊字串、按鈕 `aria-pressed` 皆確認
