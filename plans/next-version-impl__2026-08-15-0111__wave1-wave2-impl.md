# 下一版實作 — Wave 1（正確性止血）＋ Wave 2（UAT 迴圈補全）

**建立時間：** 2026-08-15 01:11
**最後更新：** 2026-08-15 02:25
**狀態：** 進行中

## 目標

依 `docs/NEXT-VERSION-PLAN.md` 的建議出貨順序實作 Wave 1 與 Wave 2（餘裕才做 W3-1；
W3-3 不做，等 principal 裁決）。本 worktree 的 Claude Code 任 PM：判準級／parser 級
決策親寫，其餘派工 Forge（純函式/測試）、Engineer（UI）、GrokResearcher（每波第二眼）、
Cato（收尾審計）。完成後開 PR 回 main，並用 Uat skill 出實測清單。

## Plan Steps

- [ ] Step 0 — W3-2 版號 dogfood：在安裝版 App 版本取號頁替本輪取號（第一個 commit 前）
- [x] Step 1 — W1-1 說明草稿跨題遺失（P0/S）：已實機重現＋修復＋實機驗證（草稿層 `uat-note-draft.ts` + 焦點還原；tsc 綠、1055 測試綠、dev app 實測全鏈通過）
- [ ] Step 2 — W1-2 送出/DIFF/族系鈕補 mousedown guard（P1/S）
- [ ] Step 3 — W1-6 中文標題檔名（P1/S）：放行 CJK，只擋危險字元；留意 NFD
- [ ] Step 4 — W2-3 重測輪次 supersede 限縮版（P1/S）：preamble `> 重測自：`（PM 親寫 parser 判準）
- [ ] Step 5 — W2-2 本輪收工＋報告歸檔（P1/S）
- [ ] Step 6 — W2-1 跨專案待實測收件匣（P0/M）
- [ ] Step 7 — W1-3 治理計分認 openspec subject 第二形狀（P0/M，PM 親寫判準；畫面說明數字跳動）
- [ ] Step 8 — W1-5 側欄 badge invalidateUatBadge（P1/S，排在分母修正後）
- [ ] Step 9 — W2-5 待實測列 a11y/可測性（P2/S）：**先 Accessibility Inspector 定位**，驗收看 AX 樹
- [ ] Step 10 — W1-4 js_dialogs completionHandler 硬化（P1/S，Rust，cargo test）
- [ ] Step 11 — W1-7 CRLF eol 保留 ＋ round-trip 測試（P2/S）
- [ ] Step 12 — W1-8 scan_plans 刪重複 stat（P2/XS）
- [ ] Step 13 — W2-4 失敗題落地成工作項（P1/M）：**先寫設計段落給 main session 過目**
- [ ] Step 14 — GrokResearcher 第二眼（每波完成後）＋ Cato 收尾審計
- [ ] Step 15 — （餘裕）W3-1 updater
- [ ] Step 16 — 開 PR 回 main、通知 main session（Miles）、Uat skill 出實測清單

## 決策紀錄

- 01:11 — 依 CLAUDE.md 2026-07-31 規則不呼叫 launch_tui.ts（scvb dashboard 已解除安裝）。
- 01:11 — 出貨順序照 NEXT-VERSION-PLAN 建議序；每項出貨前 `bunx tsc --noEmit`＋`bun test`（基準 1048）＋動 Rust 時 `cargo test`。
- 01:30 — W1-1 重現環境：瀏覽器降級路徑無資料通道（`canScanPlans`=false → `loadEmpty`），重現必須在原生。採 worktree 自建 `tauri dev`（埠 5273 strictPort，devUrl origin 不同 → localStorage 與安裝版隔離）。scratch 專案 `scratchpad/uat-repro-proj`，UAT 報告由 `src/cli/uat.ts` 產（handoff 以 `ANCHORLINE_HANDOFF_DIR` 分流，不污染 `~/.anchorline`）。
- 02:05 — **W1-1 實機重現成功（成功路徑）**：dev app（WKWebView）+ 真 HID 鍵盤與滑鼠。證據：probe 事件流（`scratchpad/probe-events.jsonl`）顯示 T1 textarea input 逐字入帳 → 點 T2 通過鈕 mousedown `prevented:true` → **全程零 blur 事件** → 檔案 T2=通過、T1 說明=（無）→ 畫面 textarea 清空。Codex F1' 推導完全屬實。附帶發現：(a) 寫入失敗路（safeApply !ok → toast + refresh(true)）同樣沖掉草稿——修法必須兩路都蓋；(b) `paths::editable` 限 $HOME 底下，/tmp 專案根會讓所有勾選靜默失敗只剩 toast。
- 01:30 — W1-1 修法草案：草稿層抽 `src/lib/uat-note-draft.ts` 小模組（Map keyed `path:itemId`），textarea `oninput` 記草稿、重繪時 seed 回 textarea 但 `original` 保持磁碟值（讓 blur/勾選路徑照常把草稿寫回檔案）、草稿==磁碟值即自清。lib 化是為了配 repo 的 lib 層測試慣例。

- 02:25 — W1-1 修法比計劃多一塊：**焦點還原**。實測發現只保字不保焦點時，重繪後 blur 永遠不再發生，草稿寫不回檔案（畫面有字、檔案沒有的新分裂）。重繪前記住聚焦的 `data-note`，重繪後 focus + 游標到尾。驗證：勾完別題續打無縫、blur 寫回磁碟成功。
- 02:25 — W1-1 測試由 PM 親寫（7 例，模組即判準本體）；Forge 併入後續大項與收尾掃描，不為 15 行模組單開 codex 迴圈。

## 阻塞 / 待決議

無

## 結束摘要

（工作結束時補上）
