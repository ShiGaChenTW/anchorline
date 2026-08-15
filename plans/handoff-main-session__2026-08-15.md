# Handoff — main session（Miles）交接

**交棒人：** Miles（main session）· 2026-08-15
**接棒人：** 你 —— 接手 main session 的協調角色：對 principal（Scott）彙報、守關卡、
派工給 worktree／agent、build＋安裝正式版。**你不是唯一寫手**，大量實作走 worktree PM 模式
（範本：`plans/handoff-next-version-impl.md`）。

## 一句話現況

PR #7（下一版 Wave 1＋2，17 commits）已合併進 main（`213f88d`），正式版已重建安裝
（HEAD `ce6463a`），**現在整條線卡在等 Scott 勾 10 題實測** —— 他勾完你才有下一步。

## 等待中的線（依觸發順序）

1. **Scott 的 10 題 UAT**：`plans/uat-下一版實作驗收（wave1+2）.md`。App 會喚醒跳題
   （tracking 頁「實測報告」分組）。失敗題 → 用報告頁「送出給 agent」走修復迴圈
   （這功能本身就在受測，第一次實戰）。特別注意：
   - 第 7、8 題是兩項 `[DEFERRED-VERIFY]`（C8 ObjC 例外路徑、C11 取號三鈕）
   - 第 9 題是 PM 發現的**疑似既有 bug**：非 git 專案 dashboard「改採 vX.YY.ZZ」
     三路（click/AX/鍵盤）都叫不出 confirm、js_dialogs 日誌零筆 —— 證實就開票
2. **v0.01.01 dogfood 收官**：ZZ 草稿已在 App 取號。UAT 過 → 在版本取號頁編列
   本輪 commits → 正式放行（兩段式卡內確認）→ 複製 PUSH 指令到終端機執行。
   這是 W3-2 的交付；卡住的每一步都是 bug，記進票。
3. **另一個專案的 UAT 帳**：設定頁「UAT 格式」13 項互動清單（要 Scott 的 API key）
   仍掛 DEFERRED，在 `plans/opaleye__2026-08-14-1949__uat-checklist.md`。

## 下一版帳本（做完 UAT 之後的工作來源）

規格：`docs/NEXT-VERSION-PLAN.md`（圓桌彙整，行號級切入點）＋
`docs/next-version-plan.html`（給 Scott 讀的版本）。已出貨：W1 全部、W2 全部。剩：

- **W3-1 updater**（P1，判定無餘裕留下輪）——真正的痛是每次驗證手動換裝
- **W3-3 011 願景欄位入 gate**——**等 Scott 裁決，不要自作主張**
- 緩辦：mtime 快取完整版、覆蓋率 N× 掃描、失敗貼圖捕捉、Apple 簽名
- 低嚴重度記帳：Grok C12/C13、CATO-05（見 `plans/next-version-impl__2026-08-15-0111__wave1-wave2-impl.md` 決策紀錄）
- dogfood 四項摩擦（同檔 02:30 條目）——其中「strict 取號 window.prompt 零回饋」
  與「worktree commit 不在候選」值得進下一版

## 操作慣例（repo 文件沒寫全、這個 session 用血換來的）

- **build＋安裝**：`bun run app` → `rm -rf /Applications/Anchorline.app && cp -R
  src-tauri/target/release/bundle/macos/Anchorline.app /Applications/` →
  **雙邊 sha256 比對** → `open -a`。Scott 每輪功能後都要這一套。
- **瀏覽器驗證**：`VITE_APP_VARIANT=test bunx vite --port 5195 --strictPort`
  （**絕不用 5173**，那常是別的 repo）；Interceptor test-profile；demo 帳號密碼
  一律 `demo`；原生功能用 `window.__TAURI_INTERNALS__={invoke:async(cmd,args)=>…}`
  stub 掉再測。⚠️ 目前 Interceptor 擴充功能**資料面卡死**（控制面正常），
  要 Scott 到 chrome://extensions 重載一次才能再用。
- **桌面殼驗證**：`VITE_APP_VARIANT=test bunx tauri dev --config
  '{"build":{"devUrl":"http://localhost:5199","beforeDevCommand":"bunx vite --port 5199 --strictPort"}}'`；
  stderr 有 `[js-dialogs]` 注入與呼叫日誌。對話框層背景見 `src-tauri/src/js_dialogs.rs`
  頭註（wry 缺 delegate＋plugin-dialog 蓋 confirm 的雙重根因）。
- **cargo test --release 冷編譯超過 10 分鐘**——一律丟背景跑。
- **⚠️ `orca worktree rm --force` 會連 branch 一起刪**（2026-08-14 事故，靠 merge
  第二親本重建）。要保 branch 就先打 tag 或準備重建。
- worktree `next-version-impl` 與其 session 還活著（idle）——分支已併，
  要清理時記得上一條。
- 狀態列的「↑N unpushed」可能是其他本機分支（`BUG修復` 等）沒有遠端對應，
  不代表 main 沒推乾淨；以 `git rev-list origin/main..main` 為準。
- **AX 類驗收看 AX 樹**（Interceptor / Accessibility Inspector），截圖與 grep 不算證據。
- 欠一筆視覺驗證：`docs/next-version-plan.html` 只驗了結構與 200，
  沒在真瀏覽器看過主題渲染（extension 卡死時欠下的）。

## Scott 的工作節奏（照著走就不會錯）

功能做完 → commit（訊息講為什麼，不列檔案數）→ build → 安裝 → 他實測 →
回報的 bug 當天修。他說「合併」「PUSH」才動 main 的合併與推送。設計裁決給選項
與建議，不要開放式問句。回應格式照他慣的：結論先講、CHANGE/VERIFY 分列、
⚠️ 誠實列沒驗的東西。

## 檔案地圖

| 東西 | 位置 |
|---|---|
| 下一版規格（工程） | `docs/NEXT-VERSION-PLAN.md` |
| 下一版規劃書（Scott 版） | `docs/next-version-plan.html` |
| 本輪追蹤與審計紀錄 | `plans/next-version-impl__2026-08-15-0111__wave1-wave2-impl.md` |
| UAT 功能鏈全紀錄 | `plans/opaleye__2026-08-14-1949__uat-checklist.md` |
| worktree PM handoff 範本 | `plans/handoff-next-version-impl.md` |
| Scott 的待勾考卷 | `plans/uat-下一版實作驗收（wave1+2）.md` |
| 原生橋合約 | `docs/BRIDGE.md`（19+ actions，安全模型在 §3） |
