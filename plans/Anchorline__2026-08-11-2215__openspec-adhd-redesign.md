# OpenSpec 入口 · ADHD 視角重新設計

**建立時間：** 2026-08-11 22:15
**最後更新：** 2026-08-11 22:15
**狀態：** 已完成

## 目標

把 OpenSpec 入口從「一張同時要你輸入又要你讀狀態的雙欄表單」，改成
「先看見還沒收完的坑，再一次只做一個決定」的單欄動線。

判準：進頁後畫面上最亮的東西，必須是**此刻該做的那一件事**——
而不是一句糾正、也不是一個空的狀態面板。

## 診斷：沿用 `2026-08-07_editor-adhd-redesign.md` 的五機制表

| 機制 | 這一頁的表現 |
|---|---|
| 任務啟動 | 進來第一件事是空白「標題」欄。想標題本身就是一個任務 |
| 時間盲 | 全頁零時間資訊：不知道上次掃描多久前、change 幾天沒動 |
| 工作記憶（約 4 迴圈） | 左欄要你輸入、右欄要你讀。右欄空的時候仍佔半個畫面 |
| 顯著性偏誤 | 最亮的是橘色「先填寫變更標題。」，離它所指的欄位 140px |
| RSD／迴避 | 同上：還沒完成任何事就先看到一句糾正 |

**這頁獨有的第六條：全站唯一沒有「下一步」的頁面。** `adhd-ui.ts` 的
`nextStepForPage()` 對 openspec 明寫 `return { label: "", detail: "" }`，
全站的 ADHD 機制在這一頁被關掉。

## 根因：這頁的功能與 C0 直接衝突

C0 是「開很多坑但收不完」。**這一頁的功能就是開新坑。**
現行版面把「開新坑」放主位、「還沒收完的坑」放副位，
預設動線是「進來 → 開一個新的」——介面在替 C0 加速。

## 不做什麼

- 不做自動建檔。維持「只產生文件，人自己放回去」的界線（`agent-handoff.ts` 立過兩次的那條線）
- 不做拖曳排序、不做 change 的看板視圖（那是 Linear 的形狀）
- 不改 openspec CLI 的呼叫方式（D10／D10a 的相容承諾不動）
- 不動 `openspec-status.ts` 既有的解析邏輯，只加欄位

## Plan Steps

- [x] Step 1 — `openspec-status.ts` 帶出 `listed`（要 `lastModified` 才治得了時間盲） <!-- anc:t=JFWQN1J7 -->
- [x] Step 2 — `status-bridge.ts` 把 listed 傳出來，既有兩個呼叫端不受影響 <!-- anc:t=9ZPV6GE6 -->
- [x] Step 3 — `openspec.html` 改單欄三步驟結構 + 開放迴圈帶 <!-- anc:t=VZC96EDK -->
- [x] Step 4 — `shared.css` 換掉 `.os-*` 區塊，後續步驟用 dim 不用隱藏（避免 layout jump） <!-- anc:t=VFA1V6KQ -->
- [x] Step 5 — `openspec.ts` 接上步驟狀態、開放迴圈帶、時間標籤、錯誤回到欄位下方 <!-- anc:t=ZPWS7P9B -->
- [x] Step 6 — `adhd-ui.ts` 還這一頁一個真的「下一步」 <!-- anc:t=Q1E7ADW8 -->
- [x] Step 7 — `bunx tsc --noEmit` 與 `bun test` 全綠 <!-- anc:t=D4C33QP6 -->
- [x] Step 8 — Interceptor 實機驗證三種狀態（無專案／有未完成 change／可建立） <!-- anc:t=VF4G4PVY -->

## 驗證紀錄

- 指令：`bunx tsc --noEmit`（綠）、`bun test`（840 pass / 0 fail）
- 三步驟實測：起始 step2/step3 皆 locked → 選類型後 step2 解鎖、step3 仍鎖
  → 中文標題時 slug 留空且錯誤顯示在 slug 欄下方、step3 仍鎖 → 填 slug 後 step3 解鎖
- 檔案預覽實測：feature 列出 4 個路徑；切到 bug 變成 1 個 `plans/2026-08-11-bug-audit-export.md`
- 「下一步」引導列已還給這一頁（原本是全站唯一被寫死空字串的頁面）
- 未驗：開放迴圈帶需要綁定資料夾的專案才有資料，測試環境沒有
