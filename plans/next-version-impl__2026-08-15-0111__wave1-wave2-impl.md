# 下一版實作 — Wave 1（正確性止血）＋ Wave 2（UAT 迴圈補全）

**建立時間：** 2026-08-15 01:11
**最後更新：** 2026-08-15 04:45
**狀態：** 進行中

## 目標

依 `docs/NEXT-VERSION-PLAN.md` 的建議出貨順序實作 Wave 1 與 Wave 2（餘裕才做 W3-1；
W3-3 不做，等 principal 裁決）。本 worktree 的 Claude Code 任 PM：判準級／parser 級
決策親寫，其餘派工 Forge（純函式/測試）、Engineer（UI）、GrokResearcher（每波第二眼）、
Cato（收尾審計）。完成後開 PR 回 main，並用 Uat skill 出實測清單。

## Plan Steps

- [x] Step 0 — W3-2 版號 dogfood：已在安裝版取號 **v0.01.01（ZZ 草稿，名字 Wave1+2 correctness + UAT loop）**；編列（收 commit refs）與放行/PUSH 留到 PR 合併後收尾。四項摩擦見決策紀錄 02:30
- [x] Step 1 — W1-1 說明草稿跨題遺失（P0/S）：已實機重現＋修復＋實機驗證（草稿層 `uat-note-draft.ts` + 焦點還原；tsc 綠、1055 測試綠、dev app 實測全鏈通過）
- [x] Step 2 — W1-2 mousedown guard（16e9790）：send/fam 實機驗證 prevented+零 blur、面板正常
- [x] Step 3 — W1-6 中文檔名（85fe826，Forge）：CJK 放行＋NFC＋ENAMETOOLONG 截斷（Forge 自抓的新失效模式），突變測試驗證
- [x] Step 4 — W2-3 supersede（d42304e）：parser/serializer/pending/CLI --supersedes，17 條新測試（NFC/NFD、/private 前綴收斂）
- [x] Step 5 — W2-2 本輪收工（47265f5）：剩餘題批次標暫時跳過＋兩段確認（臂態模組化——DOM 存臂態活不過重繪，實機踩到）；實機驗證含誠實文案
- [x] Step 6 — W2-1 跨專案收件匣（e618449，Engineer 隔離 worktree 實作、PM 抽 patch 合入）：plansDirsOfAll＋歸屬 chip＋badge 全專案分母
- [x] Step 7 — W1-3 治理計分（4780653）：openspec 第二形狀＋歸檔混合驗證規則（計劃未料到的坑：堅持存在驗證會讓歸檔倒扣覆蓋率）；join key 改目錄 id；dashboard 說明行
- [x] Step 8 — W1-5 badge 即時失效（3f0b455）：onSetVerdict/收工成功路徑重掃；實機驗證收工後 badge 不導頁歸零
- [x] Step 9 — W2-5（2280488）：AX 實機診斷——真 button＋完整名稱，計劃症狀不可重現，不修不存在的 bug；僅刪 .ov-uat 死 class。真痛點是 WKWebView AX 全樹遍歷逾時（工具側，另記）
- [x] Step 10 — W1-4 js_dialogs 硬化（9691f18）：catch_unwind 三 handler、錯誤收斂取消語意、ping capabilities 報 jsDialogs
- [x] Step 11 — W1-7 CRLF（794966e）：eolOf＋四 mutator；實測加碼發現 toggleStep 在 CRLF 上本來就是無聲 no-op（`.` 不吃 \r）
- [x] Step 12 — W1-8 刪重複 stat（49608e2）：mtime_ms_of(&Metadata)，cargo 38 綠
- [ ] Step 13 — W2-4 失敗題落地成工作項（P1/M）：**先寫設計段落給 main session 過目**
- [ ] Step 14 — GrokResearcher 第二眼（每波完成後）＋ Cato 收尾審計
- [ ] Step 15 — （餘裕）W3-1 updater
- [ ] Step 16 — 開 PR 回 main、通知 main session（Miles）、Uat skill 出實測清單


## W2-4 設計段落（待 main session 過目後動工）

**核心判準：不建第二個工作項資料庫。** 失敗題的 single source of truth 是 UAT 報告檔
（`**結果：** 失敗`＋說明）；「工作項」是**視圖**不是副本。一旦複製成獨立 todo，修完後
兩邊狀態必然分岔——「報告說失敗、工作項說完成」是可預見的終局。

1. 新純函式 `openFixesFrom(files)`（掛 uat-pending 旁）：掃全專案 UAT 報告，收集
   verdict=fail 的題（報告路徑、題錨點、標題、說明、專案歸屬），**排除已被 supersede
   的報告**——舊輪的失敗由新輪重驗，不重複列帳。
2. Overview 收件匣下方加「待修 N 題」區塊：依專案分組，一列＝一個失敗題，
   點擊 → `tracking.html?uat=<報告>`（沿用著陸鏈）。
3. 「修完」的定義＝掃描結果自然出清：該題在原報告改判通過／不測，或整份報告被新
   一輪 supersede。零狀態同步、零回寫協定。
4. 每列「交辦」快捷重用 `uatFixTask`（uat-fix-handoff 既有打包）——加分項，第一版
   可不做。
5. 明確不做：獨立工作項 CRUD／指派／期限——單人系統，這些是儀式。

**兩個開放問題（請 main session 裁決）：**
- 位置：我傾向 overview（跨專案「還欠幾個修」正是 PM 視角），dashboard 專案卡只加
  一個數字；另一案是整塊放 dashboard。
- 報告已收工但含失敗題：我傾向**仍算欠修**——失敗不因收工而消失；反方論點是收工
  語意應含「本輪帳結清」。

## 決策紀錄

- 01:11 — 依 CLAUDE.md 2026-07-31 規則不呼叫 launch_tui.ts（scvb dashboard 已解除安裝）。
- 01:11 — 出貨順序照 NEXT-VERSION-PLAN 建議序；每項出貨前 `bunx tsc --noEmit`＋`bun test`（基準 1048）＋動 Rust 時 `cargo test`。
- 01:30 — W1-1 重現環境：瀏覽器降級路徑無資料通道（`canScanPlans`=false → `loadEmpty`），重現必須在原生。採 worktree 自建 `tauri dev`（埠 5273 strictPort，devUrl origin 不同 → localStorage 與安裝版隔離）。scratch 專案 `scratchpad/uat-repro-proj`，UAT 報告由 `src/cli/uat.ts` 產（handoff 以 `ANCHORLINE_HANDOFF_DIR` 分流，不污染 `~/.anchorline`）。
- 02:05 — **W1-1 實機重現成功（成功路徑）**：dev app（WKWebView）+ 真 HID 鍵盤與滑鼠。證據：probe 事件流（`scratchpad/probe-events.jsonl`）顯示 T1 textarea input 逐字入帳 → 點 T2 通過鈕 mousedown `prevented:true` → **全程零 blur 事件** → 檔案 T2=通過、T1 說明=（無）→ 畫面 textarea 清空。Codex F1' 推導完全屬實。附帶發現：(a) 寫入失敗路（safeApply !ok → toast + refresh(true)）同樣沖掉草稿——修法必須兩路都蓋；(b) `paths::editable` 限 $HOME 底下，/tmp 專案根會讓所有勾選靜默失敗只剩 toast。
- 01:30 — W1-1 修法草案：草稿層抽 `src/lib/uat-note-draft.ts` 小模組（Map keyed `path:itemId`），textarea `oninput` 記草稿、重繪時 seed 回 textarea 但 `original` 保持磁碟值（讓 blur/勾選路徑照常把草稿寫回檔案）、草稿==磁碟值即自清。lib 化是為了配 repo 的 lib 層測試慣例。

- 02:25 — W1-1 修法比計劃多一塊：**焦點還原**。實測發現只保字不保焦點時，重繪後 blur 永遠不再發生，草稿寫不回檔案（畫面有字、檔案沒有的新分裂）。重繪前記住聚焦的 `data-note`，重繪後 focus + 游標到尾。驗證：勾完別題續打無縫、blur 寫回磁碟成功。
- 02:25 — W1-1 測試由 PM 親寫（7 例，模組即判準本體）；Forge 併入後續大項與收尾掃描，不為 15 行模組單開 codex 迴圈。

- 02:30 — **W3-2 dogfood 摩擦（安裝版 v1.1.0 build 2026-08-15 00:26 實測）**：
  ①（真使用者級）strict 取號的層級選擇走 `window.prompt()`——系統面板不在主視窗、js_dialogs 掛掉或舊 build 時 `pick===null` 直接 return，**按了零回饋**；releases.ts:258 自己的註解都說確認要做在卡片裡不用 window.confirm，層級選擇應同理改成卡片內三顆按鈕。
  ②（真使用者級）候選 commit 清單只讀主 checkout 當前分支——worktree/side-branch 整輪開發下**只能取號、無法邊做邊編列**，「從第一個 commit 就開始編列」在此工作流不成立，收 refs 只能等 PR 合併。
  ③（自動化級）WKWebView 對 AX value-set、滾輪捲動、postToPid 鍵擊多數不理——app 的 agent 可測性弱，與 W2-5 同族但屬全域。
  ④（自動化級）`prompt()` 對話框是獨立系統視窗，`--app` 主視窗截圖看不到，害 agent 誤判「沒反應」。

- 03:20 — **教訓（付過學費）**：Forge 的 codex 越界重做了 W2-3/W1-8，Forge revert 越界部分時把 PM 未 commit 的並行變更一起清掉（已從 context 重放，無損失）。規則改為：**派 agent 進 worktree 前先 commit 乾淨；agent 在樹上時 PM 不動檔**。
- 03:20 — 教訓：tsc incremental 可能在剛刪檔後假綠（W1-1 首次 commit 帶進壞 import，已 amend 為 3a55c98）。每次 commit 前 `git show --stat` ＋ grep TEMP 標記。
- 03:20 — W2-2 設計判準：「本輪收工」＝把剩餘未測題批次標「暫時跳過」。狀態推導自然轉已完成（離開待辦），零方言變更、不破 Cato F3 完成判定守門，報告誠實記錄「這輪跳過了哪些」。批次用 setVerdict 組合、safeApply 一次寫入。
- 04:45 — **Grok 第二眼：14 條挑戰、12 成立（高 3／中 5／低 4）**，全數判讀完畢。已修：C1（supersede 循環——升級為一般化環偵測，環內並存）、C2（--supersedes 對 root 解析＋存在驗證）、C3（收工按鈕/toast 對無錨點題誠實）、C4（supersede 標記圍欄意識，Cato F5 規矩）、C5（badge invalidate 加 dirty 旗標防吞）、C6（alignProjectForUat 套 canon 正規化）、C7（openspec 治理改純形狀認定——N.M 是位置編號，存在驗證會讓編輯 tasks.md 打回未治理）、C8（js_dialogs 加 objc2::exception::catch 攔 ObjC 例外）、C9（eolOf 改多數決）、C10（note split 剝 \r）、C11（strict 取號 window.prompt 改頁內三鈕——dogfood 摩擦①正解）。**緩辦（記帳）**：C12（草稿層蓋掉外部並發寫入——草稿模型內在代價，提示 UI 留下一版）、C13（送出給 agent 帶未存補充說明——必填原因已落地，損失限於補充文字）。C14/C15 不成立。

## 阻塞 / 待決議

無

## 結束摘要

（工作結束時補上）
