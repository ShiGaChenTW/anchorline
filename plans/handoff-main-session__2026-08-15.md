# Handoff — main session（Miles）交接

**交棒人：** Miles（main session）· 2026-08-15，第二輪（09:21–11:45）
**接棒人：** 你 —— 接手 main session 的協調角色：對 principal（Scott）彙報、守關卡、
派工給 worktree／agent、build＋安裝正式版。**你不是唯一寫手**，大量實作走 worktree PM 模式
（範本：`plans/handoff-next-version-impl.md`）。

## 一句話現況

W3 剩餘帳全數落地並推上 `origin/main`（`1ba052c`，0 unpushed，1191 測試全綠），
正式版已用新做的 `bun run app:install` 重裝，**現在卡在等 Scott 勾兩份實測報告**——
新的 11 題（本輪視覺驗收）＋ 原本的 10 題（wave1+2）。他勾完才有下一步。

## 等待中的線（依觸發順序）

1. **Scott 的兩份 UAT**（App 會喚醒跳題，tracking 頁「實測報告」分組）：
   - `plans/uat-建置識別碼與願景-gate-視覺驗收.md`（11 題，UAT-20260815-02）——
     本輪三項變更的**畫面**驗收，全部是 Interceptor 擴充卡死時欠下的 `[DEFERRED-VERIFY]`。
     **第 2 題（比對狀態列雜湊與 `git log -1`）是重點**，其餘只驗長得對不對，那題驗它說的是不是真話
   - `plans/uat-下一版實作驗收（wave1+2）.md`（10 題）——仍全數未測。
     第 7、8 題是兩項 `[DEFERRED-VERIFY]`（C8 ObjC 例外路徑、C11 取號三鈕）；
     **第 9 題已被本輪改寫**，加了「再測一個 git 專案」的判別步驟（見下方 §根因）
   - 兩份跑在同一個 build 上，不用裝兩次
2. **v0.01.01 dogfood 收官**：ZZ 草稿已在 App 取號。UAT 過 → 在版本取號頁編列
   本輪 commits → 正式放行（兩段式卡內確認）→ 複製 PUSH 指令到終端機執行。
   這是 W3-2 的交付；卡住的每一步都是 bug，記進票。
3. **另一個專案的 UAT 帳**：設定頁「UAT 格式」13 項互動清單（要 Scott 的 API key）
   仍掛 DEFERRED，在 `plans/opaleye__2026-08-14-1949__uat-checklist.md`。

## 本輪做了什麼（2026-08-15 第二輪）

完整紀錄在 `plans/Anchorline__2026-08-15-0921__w3-followup.md`。摘要：

| commit | 內容 |
|---|---|
| `3ee1f6f` | **抽單 fail-open 修復（P0）** |
| `1947544` | W3-3 願景欄位進 gate（warn 級，兩條短路串接） |
| `757422e` | W3-1b 狀態列建置識別碼 |
| `1ba052c` | W3-1a `bun run app:install` 交易式一鍵換裝 |

測試 1126 → **1191**（+5 W3-3、+14 W3-1b、+46 W3-1a），零迴歸。

## 下一版帳本（做完 UAT 之後的工作來源）

規格：`docs/NEXT-VERSION-PLAN.md`（圓桌彙整，行號級切入點）＋
`docs/next-version-plan.html`（給 Scott 讀的版本）。已出貨：W1、W2 全部，W3-1a／1b、W3-3。

### 🔴 最大的一張票：34 處原生對話框遷移

完整清單、逐筆嚴重度、遷移工法、四批出貨計劃全在
`plans/Anchorline__2026-08-15-0921__w3-followup.md` 的 10:48 條目。要點：

- **34 處不是 30**（前一輪漏數 4 處 `window.prompt`）。全 repo **零個 `alert()`**
- **批次 1（M）＝ 治理鏈 P0 全集 8 筆＋泛用元件 enabler**。八顆按鈕全在 `.ts`
  template literal 裡，**不用碰任何 `.html`**
- **enabler**：把 `releases.ts` 的 `.rl-arm`/`.rl-arm-go` 抽成泛用 `armConfirm()`／
  `armPrompt()` 放 `src/lib/ui.ts`。現成可抄的樣板：兩段式 `releases.ts:266-272`＋`509-527`；
  卡內理由必填 `signoff.ts:317-322`＋`417-431`；就地改名 `rail-projects.ts:556-625`
- **批次 1 含 `dashboard.ts:670`，那是 UAT 第 9 題的受測物 —— 等他勾完再動手**
- **四筆需個案設計**（要 Scott 點頭）：`editor.ts:683`（同步回傳 boolean，三個呼叫端靠
  回傳值決定流程，改非同步會傳染整條鏈）、`editor.ts:1883`（三選一不是 yes/no）、
  `write.ts:275/303`（confirm 在已開啟的 modal 裡，合理解法是把逐項確認整個拿掉）

### 其他

- **W3-1c updater ＋ Apple 簽章（降 P3，兩者綁一起）**——觸發條件寫死「第一台
  非 Scott 本人的機器要安裝時」。**`docs/NEXT-VERSION-PLAN.md:42` 的三處事實錯誤尚未回填**
  （見下方 §updater），下一個動這份文件的人請順手改掉，免得錯誤敘述被下一輪 agent 當前提
- 緩辦：mtime 快取完整版、覆蓋率 N× 掃描、失敗貼圖捕捉
- 低嚴重度記帳：Grok C12/C13、CATO-05
- dogfood 摩擦②「worktree commit 不在候選」值得進下一版（①已由 C11 解掉）

## 本輪查證出來的事實（別再重複踩）

### updater：計劃書寫的三件事都是錯的

`docs/NEXT-VERSION-PLAN.md:42` 目前仍是錯的敘述。Grok 查了 tauri v2 官方文件與
plugin 原始碼（非憑記憶）：

1. **updater 簽章金鑰是強制的**——官方原文 "This cannot be disabled"；
   `plugins/updater/src/config.rs` 的 `pubkey` 無 `serde(default)`，缺了直接反序列化失敗；
   `updater.rs:740` 的 `verify_signature` 無條件執行、無 flag 可繞
2. **updater 不吃 dmg**，吃 `.app.tar.gz`
3. **「更新後一次 xattr」在本機不成立**——實測 `/Applications/Anchorline.app` 只有
   `com.apple.provenance`、無 quarantine；updater 的 macOS 安裝路徑全程沒碰 xattr。
   那句是**散佈情境**的知識，被寫進同份文件自稱「不存在」的場景

**對本機驗證，updater 讓每輪從 4 步變 9 步**（版號要三處手動遞增否則什麼都不會發生、
sig 每 build 都變要手貼 latest.json、release build 強制 https 故本機要跑 localhost server、
換裝後仍要手動重啟）。**是方向相反的解，不是成本高的正解。**

**誤導源**：`vendor/markamd/AGENTS.md:19` 寫「Tauri updater artifacts are enabled in
src-tauri/tauri.conf.json」——那是**被 vendor 進來的別的專案**的文件，Anchorline 自己的
conf 完全沒 updater 設定。任何 agent grep 到這行都會得出錯誤結論，**建議加免責註記**。

### T9「改採 vX.YY.ZZ」的根因：不是 git，是裸 `confirm()`

失效點 `src/pages/dashboard.ts:669`。`js_dialogs.rs` 檔頭註解自己寫過：wry 0.55 的
WKWebView UI delegate 只實作檔案選擇面板，WebKit 對未實作的 delegate **當作使用者
立刻取消**，所以 `confirm()` 永遠回 false 且零錯誤。四條競爭假設（handler 沒掛上、
重複 id、CSS 裁掉、上層攔截）都有反證排除。`git blame` 指向 `a589d71`（2026-08-12），
**PR #7 三個動 dashboard.ts 的 commit 都沒碰到它**——確定是既有 bug。

⚠️ **「AX press 也沒反應」「鍵盤也沒反應」不構成獨立證據**——WKWebView 對
AX value-set 與 postToPid 鍵擊多數不理，三路實際上只有滑鼠那路是有效訊號。

### 兩個 tsc 盲點（今天各踩一次）

1. **`strict: true` 抓不到 `string === null` 這種死比較**——`admin.ts:389` 的
   fail-open bug 修之前 tsc 一樣是綠的
2. **`tsconfig.json` 的 `include` 只有 `src/**/*.ts`，`vite.config.ts` 不在型別檢查範圍內**
   ——該檔的重複宣告 tsc 全綠，是 `bunx vite build` 才炸

**推論：綠燈的涵蓋範圍比想像小。動 `vite.config.ts` 或寫守衛式比較時，tsc 不算證據。**

## 操作慣例（repo 文件沒寫全、用血換來的）

- **build＋安裝：現在有 `bun run app:install`**（交易式：舊版 rename 到備份 → ditto
  新版就位 → 雙邊 sha256 → 才刪備份，任一步失敗 rename 回原位）。旗標
  `--test`／`--skip-build`／`--no-open`。手動四步作廢
- **瀏覽器驗證**：`VITE_APP_VARIANT=test bunx vite --port 5195 --strictPort`
  （**絕不用 5173**，那常是別的 repo）；Interceptor test-profile；demo 帳號密碼
  一律 `demo`；原生功能用 `window.__TAURI_INTERNALS__={invoke:async(cmd,args)=>…}`
  stub 掉再測。⚠️ **Interceptor 擴充功能資料面卡死**（控制面正常，preflight 會過），
  要 Scott 到 chrome://extensions 重載一次才能再用。**本輪四筆視覺驗證就是這樣欠下的**
- **桌面殼驗證**：`VITE_APP_VARIANT=test bunx tauri dev --config
  '{"build":{"devUrl":"http://localhost:5199","beforeDevCommand":"bunx vite --port 5199 --strictPort"}}'`；
  stderr 有 `[js-dialogs]` 注入與呼叫日誌
- **cargo test --release 冷編譯超過 10 分鐘**——一律丟背景跑
- **⚠️ `orca worktree rm --force` 會連 branch 一起刪**（2026-08-14 事故）
- **多個 agent 不要同時在同一棵樹上**（03:20 教訓：Forge revert 越界時把 PM 未 commit
  的並行變更一起清掉）。本輪四個 agent 各自 worktree，零衝突
- **agent 產出先在自己分支 commit 再併**，別讓成果只存在工作區
- **AX 類驗收看 AX 樹**（Interceptor / Accessibility Inspector），截圖與 grep 不算證據

## Agent 派工的教訓（本輪新增）

- **Forge 的 codex 額度用盡到 2026-08-20**（`You've hit your usage limit`），
  且無 `OPENAI_API_KEY` 可繞。它**沒有靜默降級**、明講改由 Claude-family 自己寫——
  但「換一個認知血統降低共同盲點」的價值那次沒實現。8/20 前要跨廠商第二眼，
  **改派 Anvil（Kimi-family）**
- **追加需求要趁早**：本輪 7 條補充條件送達時 agent 已收工，得再打一輪。
  派工前把驗收條件想齊，比事後補便宜
- **要求 agent 自己量基準**，不要餵它數字。W3-3 那個 agent `git stash` 前後各跑一次
  得到 1126／1131，比採信轉述可靠

## Scott 的工作節奏（照著走就不會錯）

功能做完 → commit（訊息講為什麼，不列檔案數）→ build → 安裝 → 他實測 →
回報的 bug 當天修。他說「合併」「PUSH」才動 main 的合併與推送。設計裁決給選項
與建議，不要開放式問句。回應格式照他慣的：結論先講、CHANGE/VERIFY 分列、
⚠️ 誠實列沒驗的東西。

## 檔案地圖

| 東西 | 位置 |
|---|---|
| 下一版規格（工程） | `docs/NEXT-VERSION-PLAN.md`（⚠️ updater 三處敘述待訂正） |
| 下一版規劃書（Scott 版） | `docs/next-version-plan.html` |
| **本輪追蹤與 34 處對話框清單** | `plans/Anchorline__2026-08-15-0921__w3-followup.md` |
| 上一輪追蹤與審計紀錄 | `plans/next-version-impl__2026-08-15-0111__wave1-wave2-impl.md` |
| UAT 功能鏈全紀錄 | `plans/opaleye__2026-08-14-1949__uat-checklist.md` |
| worktree PM handoff 範本 | `plans/handoff-next-version-impl.md` |
| **Scott 的待勾考卷（兩份）** | `plans/uat-建置識別碼與願景-gate-視覺驗收.md`（11 題）<br>`plans/uat-下一版實作驗收（wave1+2）.md`（10 題） |
| 原生橋合約 | `docs/BRIDGE.md`（19+ actions，安全模型在 §3） |
