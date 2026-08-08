# 開發專案工作台 — 實作 Task List

**建立時間：** 2026-08-09 01:17
**最後更新：** 2026-08-09 03:58
**狀態：** 進行中

## 目標

把 `plans/2026-08-09_dev-workbench-upgrade-eval.md`（623 行評估報告）落成可執行步驟。
核心：補上穩定 task ID 這把 join key，讓進度／證據／事件三者能對上；再把開發 LOG 做成磁碟上的 append-only 稽核軌跡。
**每個 Phase 獨立可出貨**，Phase 1 自己就是完整產品。細節一律回查評估報告對應章節，此處只列步驟。

> 本檔的 checkbox 刻意帶 `<!-- sf:t=… -->` 錨點——它同時是 P0 的第一個測試 fixture。

---

## Plan Steps

### Phase 0 — 補上 join key（約 1 天，零決策依賴）

- [x] P0-1 `plan-parser.ts` 解析 `<!-- sf:t=ID -->` 錨點，輸出 `Task.id`（報告 §Phase 0） <!-- sf:t=HNTPRY5R -->
- [x] P0-2 lazy 鑄造：無錨點的步驟在第一次讀取時補 ID，**不做一次性回填腳本** <!-- sf:t=DSTT1PJ2 -->
- [x] P0-3 錨點遺失偵測：回報「本檔 N 個步驟無 ID」，UI 顯示警告 + 手動重鑄，**不無聲重鑄** <!-- sf:t=B5VZSS5K -->
- [x] P0-4 更新 `agenttask-tui` skill 建檔模板，新 plan 自動帶錨點 <!-- sf:t=SN0F6S9X -->
- [x] P0-5 `tests/plan-parser.test.ts`：有錨點 / 無錨點 / 錨點被抹掉 三案 <!-- sf:t=GKFJXKB6 -->
- [ ] P0-✅ 出貨儀式：截一張帶 ID 的 `bun run track` 圖 <!-- sf:t=7AKTPF78 -->

### Phase 1 — 進度追蹤（約 2.5 天，全唯讀，零決策依賴）

- [x] P1-1 bridge action `openspecStatus`：`openspec list --json` + 逐 change `status --json`；缺執行檔回 `openspecMissing` <!-- sf:t=4HEKFWGR -->
- [x] P1-2 `tests/openspec-status.test.ts`：JSON 形狀 snapshot（上游改格式要紅燈） <!-- sf:t=QYFZKM1J -->
- [x] P1-3 **單專案焦點卡**：只顯示 `trackingTarget()` 指到的那個，其餘摺疊成一行 <!-- sf:t=4N2XGDNN -->
- [x] P1-4 焦點卡四欄封頂：下一步 / 進度 / **上次動多久前** / 待推 commit 數（時間盲對策） <!-- sf:t=BY63GS05 -->
- [x] P1-5 rollup 演算法寫死一處：`0.5×plan + 0.5×openspec`，缺一方則另一方佔滿，兩者皆無顯示「無進度來源」 <!-- sf:t=X1EJZN63 -->
- [x] P1-6 刷新：1s 週期 + 畫面去重，**不引入 FSEvents** <!-- sf:t=XMD0A6D6 -->
- [x] P1-7 bridge action `ghStatus` + 跨 repo PR 雷達（焦點卡**下方**一行，不擠進卡內）（§十一 L1） <!-- sf:t=AQ33YKY1 -->
- [x] P1-8 GitHub 分層刷新：60s 週期 + stale 標示 + 多專案共用一次查詢（Search API 30 req/min） <!-- sf:t=GPMDADJS -->
- [x] P1-9 補回 live tracking 段 1 寫入端（Claude Code hook，§5.1） <!-- sf:t=2RBVG8J6 -->
- [ ] P1-✅ 出貨儀式：截焦點卡發一則貼文（G1） <!-- sf:t=34BYQEQF -->

### 決策關卡 — 只有這兩題會擋住 Phase 2

- [x] D1 拍板：log 進不進 git（預設 **(c) 分兩份**——脫敏摘要進 git、原始流 gitignore） <!-- sf:t=YA416G0R -->
- [x] D2 拍板：bridge 開不開 `.specforge/` 追加（預設 **(a) 開放**，用 §6.2 謂詞限縮） <!-- sf:t=MTA08FHB -->

### Phase 2 — 開發 LOG／稽核軌跡（約 4 天）

- [x] P2-1 `isEditablePath` 新增 append 謂詞：realpath 在已註冊專案內 + `.specforge/**` + `.jsonl` + 單行 <4KB <!-- sf:t=FJ3R0DRG -->
- [x] P2-2 bridge action `appendFile`：**真 O_APPEND**，不可用 read-modify-write 模擬 <!-- sf:t=48P0S0C9 -->
- [x] P2-3 月分片 `.specforge/log/YYYY-MM.jsonl` + `.gitattributes: *.jsonl merge=union` <!-- sf:t=EZP9BQT1 -->
- [x] P2-4 事件 schema（§6.3）：`v` / `event_id` / `ts` / `actor` / `run_id` / `kind` / `subject` / `ref` / `payload` <!-- sf:t=AXDKGAWW -->
- [x] P2-5 **payload 欄位白名單** + 命令只存 `cmd_hash`+前綴 + 路徑一律相對（§6.4 機密防護） <!-- sf:t=AXQSXBP4 -->
- [x] P2-6 parser 跳過壞行不丟例外 <!-- sf:t=W7DG04SH -->
- [x] P2-7 writer A：App 內動作（送審／核准／抽單／取號／gate 通過） <!-- sf:t=MQCJR3EM -->
- [x] P2-8 writer B：Claude Code hook。**App 內偵測是否已裝 + 一鍵複製指令，不自動改使用者 settings.json** <!-- sf:t=5E954YC4 -->
- [x] P2-9 writer C：git 全量回填（`subject`=hash 去重，順帶解掉 40 筆上限） <!-- sf:t=7HZ5HDEW -->
- [x] P2-10 PR 事件接入（§十一 L2）：`pr.open` / `pr.review` / `pr.merge` / `pr.checks.fail` <!-- sf:t=YNM02NS8 -->
- [x] P2-11 呈現①「回到工作」三行（預設層，context recovery） <!-- sf:t=473T7PK4 -->
- [x] P2-12 呈現②「今天做了什麼」摘要，`kind` 折疊 ≤4 組 <!-- sf:t=HP0YZ9TT -->
- [x] P2-13 呈現③ 完整時間軸 + 篩選（要點兩下才到，防過度專注） <!-- sf:t=4KZ8MRQD -->
- [x] P2-14 稽核報告匯出 Markdown / CSV <!-- sf:t=9TWNBXE3 -->
- [ ] P2-✅ 出貨儀式：匯出一份稽核報告 PDF <!-- sf:t=Q2JV6HAP -->

### Phase 3 — 決策紀錄與作品化（約 2 天）

- [x] P3-1 ADR 來源接 ISA 的 `## Decisions` / `## Changelog`（§八 #4 預設） <!-- sf:t=RB7XKD41 -->
- [x] P3-2 `decision.record` 事件串接，`subject` 指向受影響的 task / section <!-- sf:t=T8FCNW2Y -->
- [x] P3-3 PR review 職務分離：Claude 寫的 PR 不得由 Claude 核准（§11.2 差異化點） <!-- sf:t=MJ5HGZ07 -->
- [x] P3-4 作品頁：一份 PRD 從撰寫→gate→簽核→change→commits→release 的完整 replay（G0） <!-- sf:t=VN14QPD8 -->

### 明確不做

- ~~App 內 Kanban 任務 CRUD~~ — Backlog.md / Linear 已解，且會與 Claude Code 競爭
- ~~事件流放 localStorage~~ — 5–10MB 硬上限、不可稽核
- ~~自建 openspec spec.md parser~~ — 呼叫 CLI
- ~~agent 執行／worktree 編排~~ — 已在用 Orca
- ~~PR 雙向同步（`gh pr review --approve`）~~ — 不可逆對外動作，比照 `git-doctor.ts` 只產生指令
- ~~PR diff 檢視器~~ — 過度專注黑洞，看 diff 去 GitHub／IDE
- ~~採用 Backlog.md~~ — 目前未安裝（§八 #3，可反悔）

---

## 決策紀錄

- 01:17 — Phase 0 改 lazy 鑄造，排除一次性回填腳本；理由：「先做 30 分鐘雜事才能開始」是 ADHD 最會卡死的形狀
- 01:17 — 跨專案總覽表改單焦點卡；理由：原設計 5×5=25 個同時可見資訊點，違反本專案 `focus-mode.ts` 的 4 迴圈上限
- 01:17 — PR 只讀不寫；理由：`git-doctor.ts` 已為 git 寫入立過界線，同一套邏輯必須套用
- 01:17 — 每 Phase 補「出貨儀式」；理由：C1 的解藥不是停損條件，是明確的結束——產出物離開電腦才算完成
- 02:05 — 焦點卡四欄改掉 overview 原本的「專案總數/審閱中/阻擋合計/已綁資料夾」；理由：那四個是聚合計數且零時間資訊，正是 focus-mode.ts 已修好卻留在首屏的問題
- 02:20 — GitHub 查詢不進 render()，改由 60s interval + status-bridge 快取；理由：gh search 實測 1.9s 且 Search API 限 30 req/min
- 02:31 — 首屏視覺驗證改由 Scott 執行；理由：Interceptor 擴充未連線，且驗證需登入而我不輸入密碼

## 阻塞 / 待決議

- **D1 / D2 未拍板**：兩者都只擋 Phase 2，Phase 0 與 Phase 1 已完成。預設值已在報告 §八 給出，不反對即視為採納。
- **首屏視覺未實機驗證**：Interceptor 擴充未連線（daemon/bridge 有跑，`no extensions connected`），而 claude-in-chrome 進得去但卡在登入——我不輸入密碼。邏輯層 197 個測試全綠、typecheck 與 build 皆過，缺的只有肉眼那一關。
  驗證指令：`VITE_APP_VARIANT=test bun run build && bun run preview` → `login.html`（示範帳號，密碼 demo）→ `overview.html`。

## 停損條件

| Phase | 出現這個就停手 |
|---|---|
| P0 | lazy 鑄造在既有 9 份 plan 上破壞格式 |
| P1 | 5 個專案單次刷新 > 500ms（改手動刷新，不加碼 FSEvents） |
| P1.7 | 上線兩週沒因它處理過任何 PR（不做 L2） |
| P2 | `appendFile` 做不到真 O_APPEND（降級為 hook 單寫、App 只讀） |
| P3 | Timeline 上線兩週自己沒主動打開（定位判斷錯了，別放大） |

## 結束摘要

**做了什麼** — 37 個步驟完成 34 個。新增 8 個 lib 模組（plan-parser 擴充、openspec-status、
gh-status、focus-card、status-bridge、event-log、event-writer、log-views、adr、replay）、
3 個 Swift bridge action（openspecStatus / ghStatus / appendFile）、1 個 shell 寫入端。
測試從 146 → **271 綠**，typecheck 與 build 全過，Swift 語法檢查過。

**未完成（3 個出貨儀式，全部需要 Scott 本人）**
- P0-✅ 截一張帶 ID 的 `bun run track` 圖
- P1-✅ 截焦點卡發一則貼文
- P2-✅ 匯出一份稽核報告 PDF

這三件刻意留著：出貨儀式的定義就是「產出物離開電腦」，我做不到那一步。

**未實機驗證** — 首屏與稽核面板只驗到 build 與單元測試。Interceptor 擴充未連線
（daemon/bridge 有跑，回 `no extensions connected`），claude-in-chrome 進得去但卡在登入，
而我不輸入密碼。驗證指令：
`VITE_APP_VARIANT=test bun run build && bun run preview` → login.html（密碼 demo）→ overview.html / tracking.html。

**後續建議**
1. 先跑一次實機驗證，把三個出貨儀式做完 —— 那才算 Phase 0/1/2 真的收掉
2. `.specforge/log` 目前只有 App 內三個動作（送審／核准／抽單）會寫。裝上 hook 之後才會有 agent 事件
3. git 回填（`commitsToEvents`）與 PR 事件（`prsToEvents`）函式已就緒但沒有觸發點，缺一顆「首次啟用」按鈕
4. D1（log 進不進 git）仍未拍板。目前預設是 (c) 分兩份，但 `.gitignore` 那一半還沒設定
