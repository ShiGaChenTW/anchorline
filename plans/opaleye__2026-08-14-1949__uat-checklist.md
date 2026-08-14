# UAT 實測清單 — Task Tracking 整合

**建立時間：** 2026-08-14 19:49
**最後更新：** 2026-08-14 20:12
**狀態：** 進行中

## 目標

讓 agent 產出「使用者實機測試」清單後自動喚醒 Anchorline、跳出待測報告。每題含流程與預期，
四種結果（通過／失敗／不測／暫時跳過）＋說明欄；失敗與不測必填說明。
架構：Skill（出題）→ CLI（落地 `plans/uat-*.md` + handoff + `open -a`）→ App（既有 1s 掃描 + 新 UI + 寫回）。

## Plan Steps

- [x] 評估四方案，定案 Skill + CLI，不做 MCP／hook <!-- anc:t=8FJK2M4P -->
- [x] 讀齊整合點：plan-parser／plan-writer／tracking-bridge／scan_plans／native 橋 <!-- anc:t=9GHT3N5Q -->
- [x] PM 親寫 `src/lib/uat-parser.ts` — 方言即規格，兩個子 agent 對齊的基石（tsc 綠） <!-- anc:t=AHKW4P6R -->
- [x] Forge：`src/cli/uat.ts` + parser／CLI 測試（987 全綠；抓到 parser 2 bug、CLI slug bug，皆修） <!-- anc:t=BJMX5Q7S -->
- [x] Engineer：tracking 頁 UAT 分組＋四狀態勾選＋必填原因＋寫回＋事件；Rust `uat_handoff_take`；喚醒導頁（於隔離 worktree 完成並驗證，待合併回本 worktree） <!-- anc:t=CKNY6R8T -->
- [x] Skill `~/.claude/skills/Uat`（出題品質門檻 + CLI 合約） <!-- anc:t=DMPZ7S9V -->
- [x] 整合驗證：tsc＋987 測試＋cargo check＋vite build 全綠；安裝版換裝後實機驗證喚醒鏈（自動導頁選中）與 UI 勾選寫回（暫時跳過→檔案更新→還原） <!-- anc:t=ENQA8T0W -->
- [ ] 第二眼審查：Grok 完成（12 缺口／6 項採納並已修）；Cato（codex）進行中 <!-- anc:t=GQSC0W2Y -->
- [x] Grok now-fix 六項：UAT 著陸抑制歡迎 modal；handoff 單槽改佇列（CLI＋Rust＋測試）；著陸自動切換專案（比不到給匯入指引）；全無錨點檔改列「沒有步驟的檔案」＋教學態；已完成報告移出最高優先組；CLI --root 必填 <!-- anc:t=HRTD1X3Z -->
- [x] Skill 修訂（principal 指示，子 agent 完成）：流程必須條列式（一步一原子動作、禁「→」串接）、以 mobile-final 檔為顆粒度標竿、報告頭脈絡誠實留白；評估結論 needs_code_change=no，選配 `context` 欄位列後續 <!-- anc:t=JSVE2Y4A -->
- [ ] 收尾：commit、結束摘要 <!-- anc:t=FPRB9V1X -->

## 決策紀錄

- 19:35 — 選 Skill + CLI，排除 MCP（檔案即 API，不養常駐行程）與 hook（意圖非事件）
- 19:47 — UAT 檔放 `plans/uat-*.md`：Rust `scan_plans` 收全部 `*.md`，掃描層零改動；前端以 H1 `# UAT:` 判方言
- 19:47 — 喚醒鏈補一個 Rust 指令 `uat_handoff_take`（無參數、固定路徑 `~/.anchorline/uat-handoff.json`、讀完即刪），符合「參數在 Rust 寫死」的安全模型；排除 tauri-plugin-shell
- 19:49 — 結果詞彙依需求收斂為 通過／失敗／不測／暫時跳過（+未測）；前案的 BLOCKED 併入「暫時跳過＋說明」
- 19:49 — 檔內結果寫中文詞（git diff 可讀），parser 雙讀中文與 en token；未知詞退回「未測」——往安全方向退
- 20:12 — 採納 Engineer 偏離：事件 kind 新增 `uat.verdict`／`uat.report.done`（失敗與通過在治理鏈上是相反事件，不借用 task.done）；說明欄不進 append-only 稽核 payload；handoff 刪檔失敗＝丟棄該次交件（少跳一次比跳不完好）
- 20:12 — Engineer 被 harness 隔離在自有 worktree（HEAD 同為 af6d02e，已驗證與本 worktree 檔案一致），合併時帶其 9 檔、跳過其 uat-parser.ts 舊快照
- 20:16 — principal 截圖回報安裝版沒顯示：安裝版是舊 build（預期內）＋ Border Loom 的 uat 檔是表格版非方言。對策：偵測放寬（檔名 `uat-*` 也歸實測報告分組，空狀態教方言）、表格版轉正式方言重產、重建安裝版
- 20:19 — 原表格版 `uat-2026-08-14-mobile-final.md` 保留不動（含「已通過免測」脈絡），待 principal 確認後再刪
- 20:47 — 採納 Grok 六項 now-fix（見步驟列）；later 清單（重測輪次/supersede、一鍵複製失敗交接、側欄 badge、說明草稿持久化、快速捕捉、中文 slug、報告頭 context 欄位）掛在此檔不另開票
- 20:47 — Grok 明確裁決：不為此補 MCP／fs watcher，1 秒輪詢＋8 秒著陸窗實測夠用

## 阻塞 / 待決議

無

## 結束摘要

（工作結束時補上）
