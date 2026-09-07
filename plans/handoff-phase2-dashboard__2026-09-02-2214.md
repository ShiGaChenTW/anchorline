# Handoff — 啟動 Phase 2：單一專案總覽以治理鏈重畫

> **冷啟動用。新 session 的角色是 PM：不下海，只派子 agent。**
> 建立於 2026-09-02 22:14（Asia/Taipei）。
> 前一份 `plans/handoff-app-ui-update__2026-09-02-2134.md` **已完成，只當史料**。

---

## 0. 一分鐘進入狀況

| 項目 | 值 |
|---|---|
| 工作目錄 | `/Users/scottchen/Documents/20_Projects/Project_Anchorline`（**主 repo，不是 worktree**） |
| 分支 / HEAD | `main` @ `9659437` |
| 工作樹 | **乾淨**（只有本檔一個 untracked） |
| 領先 origin | **15** 個 commit。⛔ **push 要問過 Scott** |
| 測試 / 型別 | `bun test` **2211 pass / 0 fail / 107 檔** · `bunx tsc --noEmit` **exit 0** |
| **進度主檔** | `plans/Anchorline__2026-09-02-2204__app-ui-update-all-phases.md` ← **先讀這份** |
| 派工細節（Phase 2 逐塊） | `Plans/plans-handoff-app-ui-update-2026-09-02-breezy-boot.md` |
| 需求上位 | `docs/PRD-app-ui-update.md` **v0.3** |
| Dev server | `bunx vite --port <沒人用的埠> --strictPort`（⛔ 5173/5199 常被別的 checkout 佔） |

**一句話現況**：**Phase 0 ✅ · Phase 1 ✅（已 commit `9659437`，待實機 UAT）· Phase 2 ⬜ 未開工。**
這份 handoff 的任務就是把 Phase 2 派出去。

---

## 1. 開工前必須先確認的兩件事（不確認就別派工）

### ① Phase 1 的實機 UAT 還沒做 —— 決定它擋不擋 Phase 2

**PM 判定：不擋。** Phase 2 動的是 `dashboard.ts` / 新檔 `gov-chain.ts` / `plan-steps.ts` /
`dashboard-empty.ts`，與 Phase 1 的 `signoff*.ts` / `status-bar*.ts` / `review.ts` **零重疊**，
UAT 若要回修改的也是那幾檔。**但要跟 Scott 說一聲再開**，因為 UAT 第 2 題是產品題
（`review.html` 核准列預設收合 → 使用者預設看不到新的自簽標記，vibe 個案要不要預設展開），
他若當場要改，那是 Phase 1 的回修，不是 Phase 2 的。

### ② P2 不碰併行線腹地，但 P3 會 —— 這輪還不用敲

併行線 `main-2`（`~/orca/workspaces/Project_Anchorline/main-2`）的 P2 會碰
`onboarding.html` / `first-run-tour.ts` / `rail-nav.ts`。**那是我方 Phase 3 的腹地，不是 Phase 2 的。**
Phase 2 全程不動那三個檔，所以**這輪不需要敲對方**；P3 開工前才必須敲。

- 我方 P2 落點：`dashboard.ts`、`shared.css`（`.gov-chain` / `.gc-*` / `.d-head` / `.empty-state-layout` 區段）、
  `uat-pending.ts`，＋三個新檔
- ⛔ **不得動 `.route-grid` 斷點**（`shared.css:15511/15520/15526`）—— 兩線接縫，
  且 `:15526` 混著 `.modal.modal-sheet > .body`，改它會誤傷 modal
- ⛔ **不要對 `main-2` worktree 做任何寫入**
- ⚠️ **SendMessage 傳不過去**（2026-09-02 試過，卡在對方核准佇列過期）。接縫協議寫進 handoff 與
  `PROJECTS.md` 比較可靠

---

## 2. 派工席位（2026-09-02 21:46 Scott 指示，已實測過一輪）

| 角色 | 誰 | 備註 |
|---|---|---|
| 編排 | 主 session（Claude Code） | **不寫 code** |
| 實作（主） | **`command-code` + `deepseek/deepseek-v4-flash`** | 本機 CLI，獨立帳號池（ShiGaChenTW） |
| 實作（備） | **Bellows**（grok） | xAI 週配額，reset 2026-09-09 |
| 審查 | **Cato**（codex，read-only） | 審查者不得是實作者；**codex 池獨佔給審查** |

```bash
command-code -p "$(cat <brief.md>)" -m deepseek/deepseek-v4-flash \
  --yolo -t --tools-all --max-turns 60 -n "<session-name>"
```

**首輪實測結果（§4.1 那條 warning 回修）**：一趟過，沒撞回合上限，回報與 PM 複驗逐項吻合
（`tsc` exit 0、`bun test` 2211/0），沒有溢出到禁區檔案。**這條線可用。**

- `--tools-all` 是**必要的** —— headless 預設會扣住寫檔工具
- ⛔ **不要帶 `-w/--worktree`**：本 repo 慣例是實作直接在 main 工作樹
- ⛔ **不要用 `Engineer`**：強制 worktree 隔離，Bash 守門擋掉 `cd 別的 worktree` / `git -C`，
  寫得出來卻編不了測不了
- ⛔ **Forge（codex）退出實作**，codex 池留給 Cato
- ⛔ **agent 一律不 commit、不 push。** commit 由 PM 收攏後問過 Scott

---

## 3. Phase 2 要做什麼（一頁版；逐塊細節在派工單）

**目標**：`dashboard.html` 從「git 與檔案的儀表板」改成**以治理鏈為頁面骨架**。

```
1  <header class="d-head">      專案身分 ＋ 鏈健康度一行
2  <ol class="gov-chain">       六站：意圖 → 規格 → 計劃 → 實作 → 驗證 → 交付
3  <a class="d-uat-row">        跨專案實測列（完全不動）
4  <div class="d-grid d-facts"> 降級事實卡（技術線 / 容量 / 工作區）
5  <p class="d-measured">       量測時間 ＋ 路徑
```

**零區塊被刪除** —— 11 個資訊區塊有 8 個降級成鏈上某一站的證據、2 個降級成鏈下事實卡、
1 個（跨專案實測列）原封不動。砍掉的只有 `.d-top` 兩欄等高格線這個**版面概念**。

### 切分與順序

```
P2-0 ──┬── P2-1 (CSS)         ┐
       ├── P2-2a (gov-chain)  ├── P2-2c (dashboard.ts 接線) ── P2-3 ── P2-4
       └── P2-2b (plan-steps) ┘
```

| 塊 | 落點 | 量 |
|---|---|---|
| **P2-0** | 六缺陷判定表附進 PRD §12，不寫 code | S |
| **P2-1** | `shared.css` 新增 `.gov-chain` `.gc-*` `.audit-trail-micro` `.d-head` `.gc-ghost` `.empty-state-layout`；`:9241-9245` **只改註解不改值**；`.d-top`/`.d-top-left` 成孤兒 → **留＋加註解，不刪** | M |
| **P2-2a** | **新** `src/lib/gov-chain.ts` ＋ `tests/gov-chain.test.ts` | M |
| **P2-2b** | **新** `src/lib/plan-steps.ts` ＋ `uat-pending.ts:399-446` 擴充 ＋ 測試 | S |
| **P2-2c** | `dashboard.ts` 接線：`:642-658` 重寫組裝、`:233-280` 降級、`:696-771` 五分支、`:539-565`。**含 R10 修正** | M |
| **P2-3** | **新** `src/lib/dashboard-empty.ts` ＋ 測試 ＋ 接三分支 | M |
| **P2-4** | 驗證 | S/M |

**可並行**：P2-1 ∥ P2-2a ∥ P2-2b —— **前提是先把 class 名清單當契約敲定**，否則 CSS 那支和
gov-chain 那支會各寫各的名字。
**必須單一 agent**：P2-2c 與 P2-3 都寫 `dashboard.ts` —— 1476 行單一 closure，兩人同改必衝突。

**建議派法**：先派 P2-2a（純函式、可測、是整條的骨），同時派 P2-2b（小、獨立）。
P2-1 等 P2-2a 的 class 名定案再派。P2-2c 一定最後、一個人做。

---

## 4. 🔴 三個 blocker 級的隱形分岔（不修，整條鏈就在說謊）

這三條都是**不報錯**的類別 —— 跟 Phase 1 抓到的兩個 P0 同一種毛病，
要當成需求寫進 brief，不是「順手注意一下」。

### ① `hasPlanSteps` 資料通道沒接

dashboard 沒有 `planModules`，漏傳 → `doneMap.l3` 永遠 false → active 掃描
**永遠停在計劃站**，每個專案的「下一步」都指向同一個地方。

⛔ **不得照抄 editor/projects/review 的 `import.meta.glob("../../plans/*.md")`** ——
那是 Anchorline 這個 repo 自己的 plans、且 DEV-only。拿本 repo 的計劃去點亮使用者的專案是說謊，
正式版還會靜默變成永遠 false。

**採用**：共用 `dashboard.ts:539-565` 已經在跑的那一趟 `loadUatScan`。
`uat-pending.ts:399-406` 的 `UatScan` 加 `planStepDirs`，`:441-446` 多算一次
`planStepDirsFrom(scan.files)`。零額外 I/O，不破壞「五個曝光面共用一趟」的設計。

### ② 非桌面版必須是 unknown，不是 false

`ChainInput` 收 `planStepsKnown`，為假時該站顯示「桌面版才量得到」且重算 active 時跳過。
⛔ **不改 `flow-layers.ts`** —— 加 `unknown` 要動四個既有呼叫端，會影響
editor / review / projects / tracking。

### ③ R10 — 兩支 `activeProject()` 可能指向不同專案

`dashboard.ts:91-95` 會過濾 `isSample` 並 fallback 到 `visible[0]`；
`flow-layers.ts:37-44` 的 `activeProject(state)` **不過濾**、fallback 到 `p1`。
→ 鏈的規格側會描述**另一個專案**的章節，**完全不報錯**。

**解法現成**：照 `overview.ts:112-121` 的 `gateOf` 寫法，餵 `deriveFlowLayers` 一份專案限定的 state：
`{...st, sectionValues: projectSectionValues[p.id], sections: sectionsFor(p.id), activeProjectId: p.id}`
＋ `store.gateSpecFor(p.id)`。**理由要寫進 `gov-chain.ts` 檔頭**。

---

## 5. 硬約束（每份 brief 都要整段複製）

1. UI **新增行**不得出現 `L0`–`L4` 字樣（既有內部 id `l1`–`l6` 與程式註解不受限）
2. 不得引入外部 CDN／字體／圖示庫（離線必須能跑的 Tauri app）
3. 新樣式**零硬編 hex 與 px**，一律走既有 token
4. **不新增主題。這個 repo 只有 3 個**：`kami` / `github` / `terminal`
   （`theme.ts:9-13`、`types.ts:5`）。新增一個要改四層共 30 個註冊點，漏改**不報錯只靜默回退**
5. 路線一律走 `projectRoute()`（`prd-triage.ts:137`），四檔中文名唯一權威來源是
   `PRD_ROUTES`（`prd-triage.ts:62-108`）。**不得再造第三份對照表**
6. **不得動 `.route-grid` 斷點**（`shared.css:15511/15520/15526`）
7. **`shared.css` 新規則一律插在所延伸的既有 sibling 規則旁邊，禁止 append 檔尾**
8. 驗證一律 Interceptor 真 Chrome；截圖用 `VerifyViewport.ts`，**不用 `Capture.sh`**
   （背景分頁會停整個 rendering lifecycle，**不報錯**，拍出全白圖）

### 測試架構（決定了寫法，不是建議）

**全 repo 零 DOM 測試環境** —— 107 個測試檔全是 `bun:test` 純函式 + HTML 字串比對。
→ **新 UI 程式碼必須寫成「吃 plain data、回字串」的純函式，否則測不到。**

### `dashboard.ts` 的 closure 怎麼解

**不重構整檔**（1476 行全在 `requireAuth()` 的 `else {}` 裡，整體外移是 L 級）。
只做一件事：把 HTML producer 抽成「吃 plain data、回字串」的純函式，
`activeProject()` 在呼叫端取一次往下傳，副作用（`bindIdentEditing` / `addEventListener` /
`loadGovernance`）留在頁內。先例照 `src/lib/focus-card.ts`。

---

## 6. 驗收（Phase 2 收工條件）

```bash
bunx tsc --noEmit                     # exit 0
bun test                              # ≥ 2211，0 fail（預計 +30～40 → ~2245）
# AC-10 零命中
git diff 9659437..HEAD -- src '*.html' | grep '^+' | grep -nE '"[^"]*L[0-4][^"]*"'
# AC-11 零命中（pathspec 一定要含根目錄 shared.css）
git diff 9659437..HEAD -- src shared.css '*.html' | grep '^+' | grep -nE 'https?://(cdn|fonts)'
```

⚠️ 兩條都**必須設 diff 範圍**（base = `9659437`）：現況全檔 `L[0-4]` 有 49 個命中、
`docs/` 與 `landing*.html` 本來就有 15 處外部字體／CDN，不設範圍會全數誤報。

### 必須有的六條測試（機器化執法者）

`tests/gov-chain.test.ts`：
- **`expect(html).not.toMatch(/L[0-4]/)`** ← 硬約束 1 與 AC-10 的執法者
- active 站恰好 1 個，且只有它帶「現在該做」與 `gc-go`
- L2 走 `layer.passWhen`：餵 `VIBE_GATE_SPEC` 看到「至少 1 條」、`BASE_GATE_SPEC` 看到「至少 3 條」

`tests/dashboard-empty.test.ts`：
- `no-folder` 輸出**不含** `d-card` / `d-grid` / `d-figure` /「量測」（AC-08 機器化）
- `no-folder` 輸出**仍含**身分與版號政策的次要連結（D-5 守門）
- `not-desktop` 輸出**不含** UAT rollup 任何字樣（假全清防線）

`tests/plan-steps.test.ts`：四種 checkbox 寫法；**rootPath 前綴 `/a/proj` 不得命中 `/a/proj2`**。

### Interceptor 真 Chrome

```bash
bunx vite --port 5199 --strictPort   # ⛔ 不是 5173（別的 checkout，用錯埠會對著另一個版本截圖且不報錯）
```
三段斷點（>1100 / 900–1100 / <900）版面不破；`.route-grid` 斷點未被改動。

### Cato 跨廠商審查（merge 前，不是先合再審）

**brief 必須**：落點行號清單 ＋ 優先序 ＋「先出結論再補證據」，並把待審 diff
**打包成單一檔案**放 scratchpad。前一輪它撞了兩次 5 回合上限、零產出；
改成打包＋「最多跑 3 個工具」之後兩次都在 3 個工具內交件。

---

## 7. 已拍板，不要重開

- Phase 順序 **P1 → P2 → P3**；P3 做到 **4/4**，agent handoff 從內容推導路線（不彈窗）
- 四檔路線條 = **唯讀指示器**。**dashboard 不放四格 segmented**（設計缺陷⑤用刪除解決），
  路線由 P1-1 的常駐狀態列表達
- 自簽**不推進** `status` / `pct`（SPEC-03）；`signoffCta` 不新增升檔按鈕（SPEC-05）
- dashboard **不做自簽語彙**，只預留 `.gc-note` 位置（D-6：判準未定，現在做等於在未定判準上蓋房）
- **`--d-card-h` 零數值改動**（D-8）：`overview.ts` 六處共用 `.d-card`，改高度是跨頁副作用
- 稽核微列**本輪只用現成事實**（D-7）：真事件軌跡要擴 `CoverageResult.recent[]`，那會讓 P2-2a 由 M 變 L
- 空狀態＝**空狀態＋跨專案實測列**，身分卡與版號政策卡去殼改成輕量文字連結
- 設計缺陷①（風險說明／變更重點／影響範圍）**本輪不補** —— 現行 code 沒有專屬欄位，硬補等於編資料

### 明確不做

引入 DOM 測試環境 · 缺口 #10/Q-13（歸 3b 線）· 缺口 #17（讓給併行線 P3）· 缺口 #16/#18 ·
v4 畫面 C · 新增主題 · 外部 CDN · L0–L4 進 UI · 雙進度曲線 ·
⛔ **不開新的 openspec change**（`openspec/` 歸 `3b` 線，且 `add-vibe-route` 尚未 archive）

---

## 8. 還沒收的線頭（Phase 2 不負責，但要知道）

**阻斷 push 的**：
- `add-vibe-route` 的 **8 題實機 UAT**（`plans/uat-第四檔路線「試作／探索」實測-2.md`）—— **Scott**
- main 領先 origin **15** 個 commit，push 要另外問過 Scott

**Phase 1 待辦**：
- 實機 UAT 四題（含產品題：`review.html` 核准列預設收合）

**產品題**：
- `canSelfSign:835` 仍用純 log 判準。舊個案（`log:[]` 但 stages 有戳記）繞得過守門，
  可再鑄一個錨點 → **「一案一錨點」在舊資料上不是不變量**
- `plans/anchorline__2026-09-02-1900__無外殼頁盤點.md` 的三個決定，**期限 2026-09-07**

**技術債**（不阻斷）：
- `signoffTimeline` 反推路徑用 `kind:"approve"`、log 路徑用 `"approved"` → **兩條路徑產生不同 CSS class**。
  下一個「同頁兩種答案」的候選
- `approvalStripHtml` 的 `selfSigned` 建議改傳 `caseHoldsSelfSign`
- `pages/signoff.ts:239` 另有一組手寫 `sg-log` 列，沒走 `timelineRowHtml`
- `syncApprovalsFromActiveCase()` 只同步 active 個案

---

## 9. 踩過的坑（別再踩）

1. **這個 repo 沒有原生 `<dialog>`** —— 全 repo 零命中，所有 modal 都是 `.modal-back` div。
   查 `dialog[open]` 一定拿到 `null`，會讓你誤判成「確認框沒跳出來」。**不報錯，只讓你多繞好幾輪**
2. **主題只有 3 個** —— 前一份 handoff 寫「四個」是錯的，PM 還把錯的抄進兩份 brief，
   兩個 agent 各自獨立回報矛盾才抓到
3. **Cato 會撞回合上限空手回來** —— 解法見 §6
4. **subagent 會共用主 session 的 Anthropic 池** —— 兩個 agent 同時 429 空手死掉過。
   這是改派 `command-code` / grok 的理由之一
5. **埠會被別的 checkout 佔用**（5173/5199 都中過）。派工前指定一個沒人用的埠
6. **不要採信 agent 的完成回報** —— 每一輪都自己跑 `tsc`／`bun test`／`git status`。
   Phase 1 有一輪 agent 說「做完了」但 commit 沒推、回報寫得不完整，內容其實是對的；
   也有一輪報告與 diff 不符。**跑指令，不讀報告。**

---

## 10. 新 session 的第一個動作

1. 讀 `plans/Anchorline__2026-09-02-2204__app-ui-update-all-phases.md`（進度主檔）
2. 讀 `Plans/plans-handoff-app-ui-update-2026-09-02-breezy-boot.md` 的 Phase 2 段（派工細節）
3. 跟 Scott 確認 §1① —— Phase 1 的 UAT 要先做還是先開 P2
4. 敲定 `.gov-chain` / `.gc-*` 的 class 名清單（**這是 P2-1 ∥ P2-2a 並行的前提**）
5. 派 P2-2a ＋ P2-2b

---

*建立於 2026-09-02 22:14 · 所有數字由 PM 跑指令查證，非採信 agent 報告*
