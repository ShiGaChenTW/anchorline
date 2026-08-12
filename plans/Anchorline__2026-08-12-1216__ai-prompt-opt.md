# AI 按鈕 Prompt 優化實作（handoff §4）

**建立時間：** 2026-08-12 12:16
**最後更新：** 2026-08-12 12:48
**狀態：** 已完成

## 目標

依 `docs/handoff-ai-prompt-optimization.md` §4 實作 Phase 1 (P0) → Phase 2 (P1) →
Phase 3 (P2)，每 Phase 一個 commit；每 Phase 後過 `bun run build`；
最後同步 `docs/ai-button-prompts.md`。Phase 4 (P3) 選做，本次不做。

## Plan Steps

- [x] Phase 1a — 溫度分流：chatCompletion/Stream 加 opts（temperature/jsonMode），OpenAI response_format＋降級重送、Gemini responseMimeType、Anthropic 忽略；五個呼叫端指定 0.2、潤色 0.5
- [x] Phase 1b — writeFullPrd 跨章上下文：generateAIDraft 加 projectContext，迴圈累積 300 字/節、總 3000 字
- [x] Phase 1 驗證＋commit（build ✓、bun test 723 ✓、commit 0e97023）
- [x] Phase 2a — #3 評估重構：score-only、共用 grade 函式、帶入本機 findings、merge 改聯集
- [x] Phase 2b — #1 fill policy＋mini JSON example、styleSample 4000→1500
- [x] Phase 2c — #11 SCHEMA 尾附最小合法範例
- [x] Phase 2 驗證＋commit（build ✓、bun test 731 ✓、commit 63eb4c9）
- [x] Phase 3a — #2 潤色：章節/欄位上下文、保真約束、不疊 domain、移除 add_metrics
- [x] Phase 3b — #8 agent 進場：任務型輸出契約、去 System prompt 嵌套、截斷告知
- [x] Phase 3c — #12 refine 鎖 name
- [x] Phase 3 驗證＋commit（build ✓、bun test 731 ✓、commit 334ac81）
- [x] 單元測試：extractJsonObject＋共用 grade 函式（隨 Phase 2 進；含 SCHEMA_EXAMPLE 合法性測試）
- [x] 更新 docs/ai-button-prompts.md 保持盤點同步
- ~~Phase 4 (P3)~~ — 選做，本次不做

## 決策紀錄

- 12:16 — authorDomainPack 溫度 0.2 走 Complete 型別擴充（第三參數 opts），settings.ts 不用改；chatCompletion 新簽名天然相容
- 12:16 — dashboard-optimize.ts 的 aiSuggestions 需一行修改（handoff §1a 明列，屬目標檔案清單外的必要最小接線）
- 12:30 — extractJsonObject/gradeFromScore 抽到新檔 ai-shared.ts（原路徑 re-export）：ai-client/ai-coach 拖著 import.meta.glob，bun test 載不動，驗收要求的單元測試只能對純模組寫
- 12:31 — SCHEMA_EXAMPLE 抽成 export 常數並加測試驗證它本身過 validatePackStructure——教格式的範例自己驗不過是最隱形的缺陷
- 12:40 — #2 潤色的章節/欄位上下文需要 editor.ts 呼叫端補兩個參數（handoff §3a 明說「加參數帶入」，屬明說需要的最小 UI 接線）

## 阻塞 / 待決議

無

## 結束摘要

- 三個 Phase（P0/P1/P2）各一 commit：0e97023 / 63eb4c9 / 334ac81；docs 同步另一 commit。
- 每 Phase 後 `bun run build`（tsc + vite）與 `bun test` 全綠；最終 731 tests（含新增 tests/ai-shared.test.ts）。
- Phase 4 (P3) 選做，未做（persona 繁中化、#9 尺寸校準、#7 微調、regex 提醒）。
- 手動 smoke（測試連線→一鍵生稿→本機＋AI 評估）需 API Key，未執行——留給使用者驗。
