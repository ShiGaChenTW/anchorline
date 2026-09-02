---
status: in-progress
created: 2026-09-02
updated: 2026-09-02T22:04+08:00
owner: Scott
pm: Miles
source_prd: docs/PRD-app-ui-update.md (v0.3)
supersedes: Plans/plans-handoff-app-ui-update-2026-09-02-breezy-boot.md (派工細節仍以那份為準，本份是進度主檔)
---

# 全 App 介面改版 — 全階段計劃與進度

> **這份是進度主檔**：三個 Phase 一次看完，勾選狀態與 repo 現況對齊。
> 「要做什麼」的上位是 `docs/PRD-app-ui-update.md`；「Phase 2/3 每一塊怎麼派工」的細節在
> `Plans/plans-handoff-app-ui-update-2026-09-02-breezy-boot.md`，本份不重抄。

## 0. 現在的狀態（2026-09-02 22:04 實測）

| 項目 | 值 |
|---|---|
| 分支 / HEAD | `main` @ `9659437` |
| 工作樹 | **乾淨** |
| 領先 origin | **15** 個 commit，⛔ 全部未 push |
| 測試 | `bun test` **2211 pass / 0 fail / 107 檔** |
| 型別 | `bunx tsc --noEmit` **exit 0** |
| 進度 | **Phase 0 ✅ · Phase 1 ✅（已 commit，待實機 UAT）· Phase 2 ⬜ · Phase 3 ⬜** |

```
Phase 0  治理底座四題        ████████████  完成 · a2b5d0b
Phase 1  路線可見 / 自簽可見  ████████████  完成 · 9659437 · 待 UAT
Phase 2  單一專案總覽改版     ░░░░░░░░░░░░  未開工
Phase 3  建案入口收斂 4/4     ░░░░░░░░░░░░  未開工
```

**測試成長軌跡**：2132（P0 收尾）→ **2211**（P1 收尾，+79 條／+2 檔）。

---

## 1. 這條線在解什麼

Anchorline 賣的是「治理鏈看得見」，但這條鏈在畫面上有一半是隱形的：

- 22 個根目錄 HTML 裡，**只有 17 個帶 `class="app"`**（`ensureBar()` 沒有 `.app` 就 `return null`），
  而這 17 頁裡原本只有 `editor.html` 看得出專案走哪一檔路線
- 自簽事實（`SELF_SIGN_NOTE`）**零頁面渲染** —— 一個 vibe 檔的一鍵自簽和一場真正的多方簽核，
  在 `review.html` 上長得一模一樣
- 單一專案總覽的清單裡沒有任何一支 PRD 治理模組 —— 它回答的是 git 與檔案的問題，不是治理的問題

**這是介面線，不是功能線**：全程不新增任何持久化欄位，所有新資訊都是既有資料的讀取路徑。

---

## 2. 派工席位（2026-09-02 21:46 起，Scott 指示）

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

- `--tools-all` 是**必要的** —— headless 預設會扣住寫檔工具
- ⛔ **不要帶 `-w/--worktree`**：本 repo 慣例是實作直接在 main 工作樹
- ⛔ **不要用 `Engineer`**：強制 worktree 隔離，Bash 守門擋掉 `cd 別的 worktree` / `git -C`，
  寫得出來卻編不了測不了（2026-08-30 實測空燒 8 萬 token）
- ⛔ **Forge（codex）退出實作**，codex 池留給 Cato。Scott 點名才出場
- ⛔ **agent 一律不 commit、不 push**，commit 由 PM 收攏後問過 Scott

---

## 3. 硬約束（每份 brief 都要整段複製）

1. UI **新增行**不得出現 `L0`–`L4` 字樣（既有內部 id `l1`–`l6` 與程式註解不受限）
2. 不得引入外部 CDN／字體／圖示庫（離線必須能跑的 Tauri app）
3. 新樣式**零硬編 hex 與 px**，一律走既有 token
4. **不新增主題。這個 repo 只有 3 個**：`kami` / `github` / `terminal`
   （`theme.ts:9-13`、`types.ts:5`）。新增一個要改四層共 30 個註冊點，漏改**不報錯只靜默回退**
5. 路線一律走 `projectRoute()`（`prd-triage.ts:137`），四檔中文名唯一權威來源是
   `PRD_ROUTES`（`prd-triage.ts:62-108`）。**不得再造第三份對照表**
6. **不得動 `.route-grid` 斷點**（`shared.css:15511/15520/15526`）—— 跨 session 接縫，
   且 `:15526` 混著 `.modal.modal-sheet > .body`，改它會誤傷 modal
7. **`shared.css` 新規則一律插在所延伸的既有 sibling 規則旁邊，禁止 append 檔尾** ——
   多 agent 並行時這是唯一的防撞規則
8. 驗證一律 Interceptor 真 Chrome；截圖用 `VerifyViewport.ts`，**不用 `Capture.sh`**
   （背景分頁會停整個 rendering lifecycle，**不報錯**，拍出全白圖）

### 測試架構（決定了寫法，不是建議）

**全 repo 零 DOM 測試環境** —— 無 happy-dom、無 GlobalRegistrator，107 個測試檔全是
`bun:test` 純函式 + HTML 字串比對。
→ **新 UI 程式碼必須寫成「吃 plain data、回字串」的純函式，否則測不到。**
本輪**不引入** DOM 測試環境（併行線的 P0 建議 #2，L 級，另案）。

---

## Phase 0 — 治理底座四題 ✅ 完成

**commit `a2b5d0b`** `fix(governance): 治理底座四個真 bug — pct 講真話、自簽補上守門`

- [x] `prd-progress.ts` 存在，`derivePrdPct` 講真話
- [x] `selfSignVibe` 確實呼叫 `evaluatePrdGates`（`store.ts:2123`）
- [x] `l2.passWhen` 確實是動態的（依 gate spec 生成）
- [x] `canSelfSign` 七條守門齊備

**收尾實測**：`bun test` 2132 pass / 0 fail、`tsc` exit 0（PM 獨立查證，非採信 PRD 說法）。

---

## Phase 1 — 路線可見 · 自簽可見 ✅ 完成（待實機 UAT）

**commit `9659437`** `feat(ui): 全 App 介面改版 Phase 1 —— 狀態條路線籤與自簽語彙誠實化`
（21 檔、`+3040/−61`，含 3 個新 src 檔、3 個新測試檔）

### 五塊全部完工

- [x] **A · P1-1 常駐狀態條加路線籤** — 新檔 `src/lib/status-bar-view.ts`(94 行)、`status-bar.ts`
  - `routeChipHtml(p)` / `gateStatusText({locked, gate})`，純函式零 store 零 DOM
  - vibe 路線籤用 **warn 色**（D-1）：「最低治理強度」全站同色相
  - **「結構可送審」這條分支整條刪掉**（D-2）—— 它對 vibe（走自簽不走送審）與已鎖定專案都是假的，
    且描述的是檢查結果不是權限，收斂到 `gateSummaryLine()`
  - 非 focus 專案時 gate 欄**留白**（D-3）：`evaluatePrdGates` 讀的永遠是 active 專案的
    `sectionValues`，換 `gateSpecFor` 修不掉，留白是唯一誠實的做法
- [x] **B1 · 自簽 helper 收編** — 6 支具名 helper 進 `signoff.ts`，reader 與 writer 同檔（純重構）
  - 完成條件已達成：`grep -rn "startsWith(SELF_SIGN_NOTE)" src` 只剩 `lib/signoff.ts` 內一處
- [x] **B2a · 關卡列＋時間軸自簽語彙** — `signoff-stages.ts`、新檔 `src/lib/signoff-log.ts`(44 行)
  - 不再原樣印內部 join key，改印「作者核准自己 · 未經第三方」＋`錨點 <mono>anc:t=…</mono>`（D-4）
- [x] **B2b · review 頁核准列** — 新檔 `src/lib/approval-strip.ts`(116 行)、`pages/review.ts`
- [x] **B3 · 誠實文案** — `signoffSummary` 的 `!c.reviewCommitId` 分支
  - 全 App 目前最大的一句謊已修：自簽後所有關卡 approved、進度滿格，頭條卻寫「尚未送審」
  - `state` 仍是 `draft`（SPEC-03），`signoffCta` 不新增升檔按鈕（SPEC-05）

### 跨廠商審查（Cato）抓到的兩個 P0，都已回修 ✅

| # | 問題 | 根因與修法 |
|---|---|---|
| **P0-1** | vibe → 一鍵自簽 → 改路線升檔轉正後，頭條仍說「已自簽 —— 尚未進入正式審閱」，細節卻是「自簽已核准 **0**/N 關」 | `setProjectRoute`（`store.ts:2038-2050`）重設關卡為 `pending` 但**刻意保留 log**。**`log` 是 append-only 歷史，`approved` 是現況投影，兩個時態被組進同一句話**。→ 拆成 `caseHasSelfSign`（讀 log ＝ 歷史）與 `caseHoldsSelfSign`（讀 stages ＝ 現況），講當下的句子只准問後者 |
| **P0-2** | 同一個個案在同一頁得到三種答案 | `caseHasSelfSign` 用 `if (c.log)`（`[]` 是 truthy）、`signoffTimeline` 用 `c?.log?.length`，而 `load():894` 把 log 正規化成 `[]` → 統一成長度判準 |

**第二輪複審：APPROVE_WITH_NITS**，兩個 P0 均確認關閉。

### 複審 warning 回修 ✅（2026-09-02 21:50）

`SELF_SIGN_DRAFT_DETAIL` 的分子原本是**全部** approved 關卡數，別人正式簽的會被算進
「自簽已核准 N/M 關」。→ 改成 `selfApproved = rows.filter(r => isSelfSignStage(r.stage)).length`
（`signoff.ts:490`），**與 `total` 數在同一份 `rows` 投影上**。
新測試 `tests/signoff.test.ts:272` 釘死「自簽 1 關 + 別人簽 2 關 → 說 1/3 不是 3/3」，
並另外斷言回傳欄位 `s.approved` 仍是 3（語意沒被順手改掉）。
同趟修掉 `caseHasSelfSign` doc `:729` 把「變嚴」寫成「變寬」的方向錯誤。

### Phase 1 剩下的事 ⬜

- [ ] **實機 UAT（走 `Uat` skill）** — 必出的四題：
  1. **按下自簽鈕之後畫面真的長這樣** —— B2a 的視覺驗證是直接寫 localStorage 造狀態，
     **不是走 `selfSignVibe()`**，這段沒有人實機走過
  2. **`review.html` 的核准列預設是收合的**（`<details class="review-approvals-wrap">`，
     `review.html:113`，開合不持久化）→ **使用者預設看不到新的自簽標記**。
     這是產品題（vibe／自簽個案要不要預設展開），**要 Scott 拍板**
  3. **三主題**（`kami`/`github`/`terminal`）下自簽斜線底紋與徽章的可辨識度 ——
     `warn 5%/8%` 疊在 `terminal` 極暗底上大機率視覺為零，這是機器測不到的類別。
     看不見時走既有 per-theme override 慣例（`shared.css:3784` 就是這個 pattern）
     把百分比提到 10–14%，**不新增 token、不新增主題**
  4. 升檔轉正後的頭條（P0-1 的迴歸題）

---

## Phase 2 — 單一專案總覽改版 ⬜ 未開工

**目標**：`dashboard.html` 改成以**治理鏈為頁面骨架**，而不是 git 與檔案的儀表板。

### 新的 `#dash-root` 骨架（取代 `dashboard.ts:643-648`）

```
1  <header class="d-head">      專案身分 ＋ 鏈健康度一行
2  <ol class="gov-chain">       六站：意圖 → 規格 → 計劃 → 實作 → 驗證 → 交付
3  <a class="d-uat-row">        跨專案實測列（完全不動）
4  <div class="d-grid d-facts"> 降級事實卡（技術線 / 容量 / 工作區）
5  <p class="d-measured">       量測時間 ＋ 路徑
```

**零區塊被刪除** —— 11 個資訊區塊有 8 個降級成鏈上某一站的證據、2 個降級成鏈下事實卡、
1 個（跨專案實測列）原封不動。砍掉的只有 `.d-top` 兩欄等高格線這個**版面概念**。
git 頭條從「整頁第一眼」降級成鏈上「實作」站的主證據行。

### 一站的解剖（五段，缺資料整段不渲染，不留 `—` 空殼）

1. 狀態點＋序號（**1–6 阿拉伯數字，不是 L 碼**）＋站名＋狀態字
2. lead：一句話結論
3. `passWhen`：**取 `layer.passWhen`，不取 `FLOW_LAYER_DOCS[].passWhen`** —— L2 是依 gate spec
   生成的，取靜態值等於對 vibe 說謊
4. 稽核微列 `.audit-trail-micro`，**上限 3 條**
5. **只有 active 站**渲染「現在該做」＋`goto` 按鈕 ← 這就是 SPEC-04 的「就地成為鏈上的一站」

展開用原生 `<details>/<summary>`，不用委派 listener（純字串可測、鍵盤與輔助技術免費）。
**dashboard 不掛 `.flow-strip`**（垂直鏈就是這頁的流程條）。
**不做頂部 `.adhd-focus-strip`**（同一句話出現兩次，「位置本身帶資訊」就被稀釋掉了）。

### 三個 blocker 級的隱形分岔（必做，否則整條鏈說謊）

- [ ] **`hasPlanSteps` 資料通道** — dashboard 沒有 `planModules`，漏傳 → `doneMap.l3` 永遠 false
  → active 掃描**永遠停在計劃站**，每個專案的「下一步」都指向同一個地方。
  ⛔ **不得照抄 editor/projects/review 的 `import.meta.glob("../../plans/*.md")`** ——
  那是 Anchorline 自己的 plans、且 DEV-only，拿本 repo 的計劃點亮使用者的專案是說謊，
  正式版還會靜默變成永遠 false。
  **採用**：共用 `dashboard.ts:539-565` 已在跑的那趟 `loadUatScan`，
  `uat-pending.ts:399-406` 的 `UatScan` 加 `planStepDirs`，`:441-446` 多算一次。零額外 I/O
- [ ] **非桌面版必須是 unknown，不是 false** — `ChainInput` 收 `planStepsKnown`，
  為假時該站顯示「桌面版才量得到」且重算 active 時跳過。
  ⛔ **不改 `flow-layers.ts`**（加 `unknown` 要動四個既有呼叫端，會影響 editor/review/projects/tracking）
- [ ] **R10 — 兩支 `activeProject()` 可能指向不同專案** — `dashboard.ts:91-95` 過濾 `isSample`
  且 fallback 到 `visible[0]`；`flow-layers.ts:37-44` **不過濾**、fallback 到 `p1`。
  → 鏈的規格側會描述另一個專案的章節，**完全不報錯**。
  解法現成：照 `overview.ts:112-121` 的 `gateOf` 寫法餵一份專案限定的 state

### 稽核微列資料來源（全部現成，零新通道）

| 站 | lead | 微列（≤3） |
|---|---|---|
| 意圖 | `sectionValues.summary` 是否齊 | `gate.findings` 的 `summary-incomplete` |
| 規格 | `gateSummaryLine(report)`（**與常駐狀態列同口徑，刻意的**） | `derivePrdPct` 的 N/M 節 ＋ 最多 2 條 findings，block 優先 |
| 計劃 | `hasPlanSteps` 有無 | `coverageLine(c)` ＋ 錨點數／未治理件數（`dashboard.ts:455-469` 三分支文案原樣搬） |
| 實作 | `gitHeadline(g)` | 最近 2 筆 commit ＋「N 條分支 · M 個 worktree」 |
| 驗證 | 專案 `status` 對應字 | 本專案待修 N 題（零題不渲染）＋ 送審／核准時間 |
| 交付 | `releasesOf()[0].version ?? git tag[0] ?? "尚無版號"` | 最近 2 個 tag ＋ 版號政策一行 |

### 空狀態（Scott 已拍板：空狀態＋實測列）

| 分支 | 改法 |
|---|---|
| `dashboard.ts:699-708` 未選專案 | 整頁空狀態。`uatRow()` **不刪、改位置** —— 收進空狀態版面內的次要行 |
| `:709-731` **未綁資料夾**（AC-08 正題） | 四者並存 → `.empty-state-layout` 兩欄：左欄＝**影子鏈**（六站灰階「未建立」）＋一句話＋「指定專案資料夾」；右欄＝實測列 ＋ **一條輕量次要文字連結**（編輯身分／版號政策，D-5）。⛔ 身分卡與版號政策卡的**卡片外殼移除**。影子鏈同時修掉「左下大片空白」 |
| `:732-746` 非桌面版 | 整頁空狀態。`:733-735` 的「刻意不放實測列」**原文保留**，且**新增同源守門**：非桌面版不得用 `hasPlanSteps === false` 畫「計劃未完成」 |
| `:754-770` 量測中／失敗 | **從單行升級**：先畫頁首＋不需要磁碟的鏈（意圖／規格／交付可信），磁碟證據處寫「量測中…」。這是「一片黑」主訴求的直接修法，也讓失敗不再變成整頁空白 |

### 六個設計缺陷的判定

| # | 缺陷 | 判定 |
|---|---|---|
| ① | Sign-off 卡掉了風險說明／變更重點／影響範圍 | **本輪不補** —— 現行 code 沒有專屬欄位，硬補等於編資料 |
| ② | 「待核准的規格修訂」與「已自簽」矛盾 | 標題改成狀態驅動：自簽時寫「已自簽 · 未送正式審閱」 |
| ③ | 頁首掉了健康度訊號 | `chainHealthLine(stations)` →「鏈已完成 N 站 · M 件待辦」放 `.d-head` 右側。**不得出現 L 碼** |
| ④ | 畫面 B 左右失衡 | 影子鏈進左欄撐高度；<900px 退單欄 |
| ⑤ | 路線徽章兩畫面強度不一 | **整項刪除** —— dashboard 不放四格 segmented（SPEC-05 已定唯讀指示器），路線由 P1-1 的常駐狀態列表達 |
| ⑥ | 「自簽不推進狀態」權重過弱 | 站內 `.gc-note.is-warn`，**本輪只預留位置不填內容**（D-6：判準未定，現在做等於在未定判準上蓋房） |

### Phase 2 切分與順序

```
P2-0 ──┬── P2-1 (CSS)         ┐
       ├── P2-2a (gov-chain)  ├── P2-2c (dashboard.ts 接線) ── P2-3 ── P2-4
       └── P2-2b (plan-steps) ┘
```

| 塊 | 落點 | 量 | 狀態 |
|---|---|---|---|
| **P2-0** | 六缺陷判定表附進 PRD §12，不寫 code | S | ⬜ |
| **P2-1** | `shared.css` 新增 `.gov-chain` `.gc-*` `.audit-trail-micro` `.d-head` `.gc-ghost` `.empty-state-layout`；`:9241-9245` **只改註解不改值**；`.d-top`/`.d-top-left` 成孤兒 → **留＋加註解，不刪** | M | ⬜ |
| **P2-2a** | **新** `src/lib/gov-chain.ts`（`buildChainStations` / `renderGovChainHtml` / `renderGhostChainHtml` / `chainHealthLine` / `AUDIT_ITEM_CAP=3`）＋ 測試 | M | ⬜ |
| **P2-2b** | **新** `src/lib/plan-steps.ts` ＋ `uat-pending.ts:399-446` 擴充 ＋ 測試 | S | ⬜ |
| **P2-2c** | `dashboard.ts` 接線：`:642-658` 重寫組裝、`:233-280` 降級、`:696-771` 五分支、`:539-565`。**含 R10 修正** | M | ⬜ |
| **P2-3** | **新** `src/lib/dashboard-empty.ts` ＋ 測試 ＋ 接三分支 | M | ⬜ |
| **P2-4** | 驗證（見 §5） | S/M | ⬜ |

**可並行**：P2-1 ∥ P2-2a ∥ P2-2b（前提是先把 class 名清單當契約敲定）。
**必須單一 agent**：P2-2c 與 P2-3 都寫 `dashboard.ts` —— 1476 行單一 closure，兩人同改必衝突。

**closure 怎麼解**：**不重構整檔**（1476 行全在 `requireAuth()` 的 `else {}` 裡，整體外移是 L 級）。
只做一件事 —— 把 HTML producer 抽成「吃 plain data、回字串」的純函式，
`activeProject()` 在呼叫端取一次往下傳，副作用（`bindIdentEditing` / `addEventListener` /
`loadGovernance`）留在頁內。先例照 `src/lib/focus-card.ts`。

### Phase 2 測試（預計 +30～40，2211 → ~2245）

`tests/gov-chain.test.ts` 的關鍵三條：
- **`expect(html).not.toMatch(/L[0-4]/)`** ← 硬約束 1 與 AC-10 的機器化執法者
- active 站恰好 1 個，且只有它帶「現在該做」與 `gc-go`
- L2 走 `layer.passWhen`：餵 `VIBE_GATE_SPEC` 看到「至少 1 條」、`BASE_GATE_SPEC` 看到「至少 3 條」

`tests/dashboard-empty.test.ts` 的關鍵三條：
- `no-folder` 輸出**不含** `d-card` / `d-grid` / `d-figure` /「量測」（AC-08 機器化）
- `no-folder` 輸出**仍含**身分與版號政策的次要連結（D-5 的守門）
- `not-desktop` 輸出**不含** UAT rollup 任何字樣（假全清防線）

`tests/plan-steps.test.ts`：四種 checkbox 寫法；**rootPath 前綴 `/a/proj` 不得命中 `/a/proj2`**。

---

## Phase 3 — 建案入口收斂 ⬜ 未開工（Scott 拍板做到 4/4）

### 現況：實際覆蓋率 **1/4**，不是 PRD 寫的 1/3

| 入口 | 現況 | 落點 |
|---|---|---|
| 手動精靈 | ✅ 經過 triage | `projects.ts:924-971` → `:1023` 落 route |
| Markdown 匯入 | ❌ 無 route | `store.ts:1354-1397`；UI 在 `onboarding.ts:197-206` |
| 資料夾掃描匯入 | ❌ 無 route | `store.ts:1469-1583`；UI 在 `projects.ts:1541-1580` |
| **`?beginner=1`** | ❌ **PRD 沒寫到的漏網支線** | `projects.ts:1093-1098` 直接 `openWizard(true)` 繞過 triage。從 `onboarding.ts:208-212` 與 `rail-projects.ts:312` 都進得來 |
| （第五條）agent handoff | ❌ 全自動無互動 | `projects.ts:1441-1462`，**沒地方彈 modal** |

### 前置：triage modal 目前不可重用

`openTriage` / `pickRoute` 是 `projects.ts` 那個 `else {}` 區塊裡的區域閉包，**沒有 export**、
硬綁 `projects.html` 專屬 DOM（`#route-grid` `#modal-triage` `#triage-close` `#triage-skip`）、
沒有回傳值（結果寫進閉包變數 `pickedRoute`，控制流寫死跳去 `openWizard()`）。

| 塊 | 做什麼 | 量 | 狀態 |
|---|---|---|---|
| **P3-0** | 抽成 `src/lib/triage-modal.ts`，回傳 `Promise<ProjectRoute \| null>`，自建 DOM 或接受 host element；`projects.ts` 改為呼叫端 | M | ⬜ |
| **P3-1** | 三條互動路徑接上 `triage-modal` | M | ⬜ |
| **P3-2** | agent handoff **從內容推導 route**（章節數／內容特徵），**不彈窗**，並在匯入完成的 toast 說明推導結果（帶 Q-04 已拍板的 pct 落差文案） | S | ⬜ |
| **P3-3** | `rail-projects.ts:309-313` 的 `ADD_ITEMS` 三條硬編 href 是天然收口點 | S | ⬜ |

⚠️ **P3-3 的地雷**：動 `#btn-new` 的 id 或行為會讓 `first-run-tour.ts:27` 的聚光燈**靜默落空**
（找不到 anchor 就置中，不報錯），`adhd-ui.ts:290/450` 也要一併改。

⚠️ **測試從零開始**：`tests/` 107 個檔**零個**提到 `importMarkdownProject` 或
`importProjectCandidates`。M-05 與 AC-09 目前沒有基線 —— **P3 要先建立這條基線，
才有辦法宣稱 1/4 → 4/4**。

⚠️ **跨 session 接縫（P3 最大風險）**：併行線 `main-2` 的 P2 會碰
`onboarding.html` / `first-run-tour.ts` / `rail-nav.ts`，**正是本階段的腹地**。
Scott 已定 P3 排最後，所以很可能對方先動。**P3 開工前必須先敲對方確認落點狀態。**

---

## 5. 驗證（每個 Phase 結束都要跑）

```bash
bunx tsc --noEmit                                    # exit 0
bun test                                             # ≥ 前一 Phase，0 fail
# AC-10 零命中（新增行不得有 L0–L4）
git diff <phase-base>..HEAD -- src '*.html' | grep '^+' | grep -nE '"[^"]*L[0-4][^"]*"'
# AC-11 零命中（不得引入外部 CDN／字體）
git diff <phase-base>..HEAD -- src shared.css '*.html' | grep '^+' | grep -nE 'https?://(cdn|fonts)'
```

⚠️ **AC-11 的 pathspec 一定要含根目錄 `shared.css`** —— 它不在 `src/` 下，
漏了就驗不到最可能違反的檔案。
⚠️ 兩條都**必須設 diff 範圍**：現況全檔 `L[0-4]` 有 49 個命中、`docs/` 與 `landing*.html`
本來就有 15 處外部字體／CDN，不設範圍會全數誤報。

**Phase base**：P1 = `72e8310`，P2 = `9659437`。

### Interceptor 真 Chrome

```bash
bunx vite --port 5199 --strictPort   # ⛔ 不是 5173（那是別的 checkout，用錯埠會對著另一個版本截圖且完全不報錯）
```

- **P1**：17 個 App 頁抽 5 頁（editor / review / signoff / dashboard / projects）看路線籤；
  review / signoff × **3 主題**各一張看斜線底紋（`terminal` 暗底最可能看不見）
- **P2**：三段斷點（>1100 / 900–1100 / <900）版面不破；`.route-grid` 斷點未被改動
- 截圖一律 `VerifyViewport.ts`，**不用 `Capture.sh`**

### Cato 跨廠商審查

P1 ✅ 已做兩輪（REQUEST_CHANGES → APPROVE_WITH_NITS）。P2 一次，**merge 前審**（不是先合再審）。
**brief 必須包含**：落點行號清單、優先序、「先出結論再補證據」，並把待審 diff
**打包成單一檔案**放 scratchpad —— 前一輪它撞了兩次 5 回合上限、零產出，
改成打包＋「最多跑 3 個工具」之後兩次都在 3 個工具內交件。

### 實機 UAT

Phase 1 與 Phase 2 各出一份，走 `Uat` skill。題數對應改動範圍（整頁功能 8–15 題）。
視覺類機器測不到 —— AC-07（自簽一眼可分辨）、AC-08（空狀態不並存）、AC-15（三斷點）
只有 Scott 實機答得出來。

---

## 6. 已拍板，不要重開

- Phase 順序 **P1 → P2 → P3**；P3 做到 **4/4**，agent handoff 從內容推導路線（不彈窗）
- 四檔路線條 = **唯讀指示器**（不做切換入口）—— code 裡三種點擊行為完全不同
- 自簽**不推進** `status` / `pct`（SPEC-03）；`signoffCta` 不新增升檔按鈕（SPEC-05）
- **`setProjectRoute` 離開 vibe 時保留 log** 是拍板過的 spec（可 replay 的錨點紀錄），**不要「修」它**
- 空狀態＝**空狀態＋跨專案實測列**，身分卡與版號政策卡去殼改成輕量文字連結
- Q-01 選 (b)：v4 畫面 C 的正式多方簽核關卡表是 P2 之後的目標態
- Q-05：設計產物**進 repo**（`.aidesigner/`）· Q-07：**不做**質性量表
- 兩條 PRD 修正已定案：AC-06 / M-01 的「22 頁」→ **17 / 17 App 頁**並附排除清單
  （`landing.html` / `landing-aid.html` / `index.html` / `login.html` / `onboarding.html`）；
  AC-08 口徑寫死為「呈現磁碟量測結果的元件」（`ProjectStats` / `CoverageResult` / UAT rollup 三種來源），
  影子鏈不算

### 明確不做

引入 DOM 測試環境 · 缺口 #10/Q-13（歸 3b 線）· 缺口 #17（讓給併行線 P3）· 缺口 #16/#18 ·
v4 畫面 C · 新增主題 · 外部 CDN · L0–L4 進 UI · 自創升檔提示樣式 · 雙進度曲線

---

## 7. 還沒收的線頭

### 阻斷 push 的

- [ ] `add-vibe-route` 的 **8 題實機 UAT**（`plans/uat-第四檔路線「試作／探索」實測-2.md`）—— **Scott**
- [ ] main 領先 origin **15** 個 commit，push 要另外問過 Scott

### 產品題（要 Scott 拍板）

- [ ] `review.html` 核准列預設收合 → vibe／自簽個案要不要預設展開
- [ ] `canSelfSign:835` 仍用純 log 判準（第三種）。舊個案（`log:[]` 但 stages 有戳記）
      繞得過「已自簽過」守門，可再鑄一個錨點 → **「一案一錨點」在舊資料上不是不變量**
- [ ] `plans/anchorline__2026-09-02-1900__無外殼頁盤點.md` 的三個決定，**期限 2026-09-07**
      （`landing.html` 去留 / `landing-aid.html` 刪不刪 / 補不補「17 頁該有外殼」的測試）

### 技術債（都有明確歸屬，不阻斷）

- `signoffTimeline` 反推路徑用 `kind:"approve"`、log 路徑用 `"approved"` —— 同一件事兩個值，
  而 `timelineRowHtml` 的 class 是 `sg-log--${kind}` → **兩條路徑產生不同 CSS class**。
  下一個「同頁兩種答案」的候選
- `approvalStripHtml` 的 `selfSigned` 參數吃到的是歷史語意（`review.ts:444` 傳 `caseHasSelfSign`）。
  行為正確（徽章集合逐關重算），但建議改傳 `caseHoldsSelfSign`
- `pages/signoff.ts:239` 另有一組**手寫 `sg-log` 列**（PRD 版本清單），沒走 `timelineRowHtml`
- `review.ts` 頂端流程條印 `L1 意圖 … L6 交付`（**既有行，不違反硬約束 1**，只管新增行）
- `syncApprovalsFromActiveCase()` 只同步 active 個案 → 非 active 專案的 `state.approvals` 是舊的

---

## 8. 踩過的坑（別再踩）

1. **這個 repo 沒有原生 `<dialog>`** —— 全 repo 零命中。`askConfirm()`（`src/lib/ask.ts:122`）
   與所有 modal 都是 `.modal-back` div。查 `dialog[open]` 一定拿到 `null`，
   會讓你誤判成「確認框沒跳出來」。**這條不報錯，只讓你多繞好幾輪**
2. **主題只有 3 個**，前一份 handoff 寫「四個主題」是錯的，PM 還把錯的抄進兩份 brief，
   兩個 agent 各自獨立回報矛盾才抓到。**PRD v0.3 本來就是對的**
3. **Cato 會撞回合上限空手回來** —— 解法已驗證：把待審 diff 打包成單一檔案放 scratchpad，
   brief 寫「最多跑 3 個工具、先出判定再補證據」
4. **subagent 會共用主 session 的 Anthropic 池** —— 2026-09-02 兩個 agent 同時 429 空手死掉。
   **這是改派 `command-code` / grok 的理由之一**
5. **`refine_design` 會靜默刪掉你沒提到的既有元素**（v3→v4 掉了 5 個）。每輪跑反向比對
6. **AIDesigner canvas pipeline 會自己注入 `<script src="https://cdn.tailwindcss.com">`**，
   違反硬約束 2。每次檢查並移除，原檔另存 `-raw.html`
7. **埠會被別的 checkout 佔用**（5173/5199 都中過）。派工前指定一個沒人用的埠
8. ⛔ **不開新的 openspec change** —— `openspec/` 歸 `3b` 線，且 `add-vibe-route` 尚未 archive

---

## 結束摘要

（三個 Phase 全部收工時補上）
