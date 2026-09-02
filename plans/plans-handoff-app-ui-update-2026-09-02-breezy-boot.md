---
status: draft
created: 2026-09-02
owner: Scott
pm: Miles
source_prd: docs/PRD-app-ui-update.md
baseline: main @ 72e8310 · bun test 2132 pass / 0 fail · tsc exit 0
---

# 全 App 介面改版 — 實作計劃（PM 派工版）

> 本計劃只管「怎麼做、誰做、怎麼驗」。**要做什麼以 `docs/PRD-app-ui-update.md` 為準**。
> PM 不下海，每一項工作派子 agent。

## Context

Anchorline 賣的是「治理鏈看得見」，但這條鏈在畫面上有一半是隱形的：22 個 HTML 頁裡只有
`editor.html` 看得出專案走哪一檔路線；自簽事實（`SELF_SIGN_NOTE`）零頁面渲染，一個 vibe 檔的
一鍵自簽和一場真正的多方簽核在 `review.html` 上長得一模一樣；單一專案總覽的 import 清單裡
沒有任何一支 PRD 治理模組——它回答的是 git 與檔案的問題，不是治理的問題。

Phase 0（治理底座四題）已於 `a2b5d0b` 完成並 commit，本輪要做的是把路線與自簽推到全 app
常駐介面，並以治理鏈為骨架重畫總覽。**這是介面線，不是功能線**：本輪不新增任何持久化欄位，
所有新資訊都是既有資料的讀取路徑。

**Phase 0 已獨立查證屬實**（非採信 PRD 說法）：`bun test` 2132 pass / 0 fail、`tsc` exit 0、
`prd-progress.ts` 存在、`selfSignVibe` 確實呼叫 `evaluatePrdGates`（`store.ts:2123`）、
`l2.passWhen` 確實動態、`canSelfSign` 七條守門齊備。

## Scott 已拍板（2026-09-02，本次）

1. **Phase 順序：P1 → P2 → P3**（PRD 原序）
2. **P3 做到 4/4**：補三條互動路徑，agent handoff 從內容推導路線
3. **空狀態＝空狀態＋跨專案實測列**，身分卡與版號政策卡移出

## PM 判定（不另問，UAT 時可推翻）

| # | 題 | 判定 |
|---|---|---|
| D-1 | 狀態條 vibe 路線籤用 warn 色還是中性灰 | **warn**。「最低治理強度」全站同色相，P1-1 與 P1-2 才是同一個故事 |
| D-2 | 「結構可送審」改成什麼 | **刪掉這條分支**，收斂到 `gateSummaryLine()` 既有文案。它對 vibe（走自簽不走送審）與已鎖定專案都是假的，且描述的是檢查結果不是權限 |
| D-3 | 狀態條顯示的專案 ≠ `activeProjectId` 時 gate 欄怎麼辦 | **留白**。今天顯示的是別的專案的檢查結果，留白比說謊好 |
| D-4 | 自簽關卡要不要露出裸錨點 | **要**，但改成 `錨點 <mono>anc:t=…</mono>`，不原樣印前綴字串 |
| D-5 | 空狀態移出身分卡後，沒綁資料夾的專案就改不了名 | **留一條輕量次要文字連結**（編輯身分／版號政策），不留資料卡。入口保住、AC-08 也保住 |
| D-6 | dashboard 要不要也做自簽語彙 | **不做**，只預留 `.gc-note` 位置。判準未定（SPEC-02 才定），現在做等於在未定判準上蓋房 |
| D-7 | 稽核微列深度 | **本輪只用現成事實**。真事件軌跡要擴 `CoverageResult.recent[]`，那會讓 P2-2a 由 M 變 L，留給下一輪 |
| D-8 | `--d-card-h` 要不要重算 | **零數值改動**。`overview.ts` 六處共用 `.d-card`，改高度是跨頁副作用。鏈用全新 `.gc-*` 天然不吃固定高 |

## ⚠️ 兩條 PRD 要修正（實作前先改文件）

1. **AC-06 / M-01 的「22 頁」是錯的。** 根目錄 22 個 HTML 只有 **17 個**帶 `class="app"`；
   `ensureBar()`（`status-bar.ts:120-141`）沒有 `.app` 就 `return null`。無殼的是
   `landing.html` / `landing-aid.html` / `index.html` / `login.html` / `onboarding.html`。
   **在 login 頁塞狀態條是 bug 不是修正。** → 改成 **17 / 17 App 頁**並附排除清單。

2. **AC-08 的口徑要寫死**：「有資料狀態的元件」＝**呈現磁碟量測結果**的元件
   （`ProjectStats` / `CoverageResult` / UAT rollup 三種來源）。影子鏈不算（它每站都寫「未建立」，
   不宣稱任何事實）。這條要進 PR 描述與測試名稱，否則 UAT 判定會不一致。

## 派工原則

- **主 session 只編排，不寫 code。**
- **席位：`general-purpose` + `model: opus`，直接在 main 工作樹作業。**
  ⛔ 不用 `Engineer` — 它強制 worktree 隔離，而本 repo 慣例是「實作任務直接在 main 工作樹，
  不開 worktree、不 commit、不 push」。Engineer 會拿到一棵隔離樹，`cargo`/`bun`/`git` 全被擋。
- **審查用 Cato**（codex 池專供審查，開工時 76% 偏緊）。派它時**必須**給落點行號清單＋優先序＋
  「先出結論再補證據」——前一輪它撞了兩次 5 回合上限、零產出。
- **agent 不 commit、不 push。** commit 由 PM 收攏後問過 Scott；push 另外再問。
- 每個 agent 的 brief 都要帶下方「硬約束」全文。

## 硬約束（每個 agent 的 brief 都要複製這段）

1. UI **新增行**不得出現 `L0`–`L4` 字樣（既有內部 id `l1`–`l6` 與註解不受限）
2. 不得引入外部 CDN／字體／圖示庫（離線必須能跑）
3. 新樣式**零硬編 hex 與 px**，全走既有 token
4. 不新增主題（會觸發四層 30 個註冊點，漏改不報錯只靜默回退）
5. 路線一律走 `projectRoute()`（`prd-triage.ts:137`），四檔中文名唯一權威來源是
   `PRD_ROUTES`（`prd-triage.ts:62-108`）。**不得再造第三份對照表**
   （已有 `prd-file.ts:120` 與 `editor.ts:1519` 兩份重複）
6. **不得動 `.route-grid` 斷點**（`shared.css:15511/15520/15526`）——跨 session 接縫，
   且 `:15526` 那個 media block 混著 `.modal.modal-sheet > .body`，改它會誤傷 modal
7. **shared.css 新規則一律插在所延伸的既有 sibling 規則旁邊，禁止 append 到檔尾**
   （多 agent 並行時這是唯一的防撞規則）
8. 驗證一律 Interceptor 真 Chrome；截圖用 `VerifyViewport.ts`，**不用 `Capture.sh`**
   （背景分頁會停整個 rendering lifecycle，不報錯，拍出全白圖）

## 測試架構（決定了寫法，不是建議）

**全 repo 零 DOM 測試環境**——無 happy-dom、無 GlobalRegistrator，104 個測試檔全是
`bun:test` 純函式 + HTML 字串比對（範例 `tests/signoff-preview.test.ts`）。

→ **新 UI 程式碼必須寫成「吃 plain data、回字串」的純函式，否則測不到。**
本輪不引入 DOM 測試環境（那是併行線的 P0 建議 #2，L 級，另案）。

---

## Phase 1 — 路線可見 · 自簽可見

```
A（P1-1 狀態條）─────────────────┐
                                  ├── V1 驗證 ── Cato 審查
B1（helper）→ B2a ∥ B2b → B3 ────┘
```

### A · P1-1 常駐狀態條加路線 — M

| 落點 | 做什麼 |
|---|---|
| **新** `src/lib/status-bar-view.ts` | 純函式、零 store 零 DOM。導出 `routeChipHtml(p)`（`p==null` 回空字串）與 `gateStatusText({locked, gate})`。只 import `prd-triage` / `ui.escapeHtml` / type-only `GateReport` |
| `src/lib/status-bar.ts:155-161` | 換成 `gateStatusText(...)`。**「結構可送審」字串從 repo 消失**（全 repo 僅此一處） |
| `src/lib/status-bar.ts:167-174` | `.app-status-project` 之後插 `${routeChipHtml(p)}`，順序＝`[dot][專案名][路線籤] · [頁面][狀態 pill]` |
| `src/lib/status-bar.ts:101-111` | `activeProject()` 改回傳 `{project, isFocus}`。⛔ **不得呼叫 `setActiveProject()` 收斂**——這支掛在 `store.subscribe`，寫 store 會自遞迴 |
| `src/lib/status-bar.ts:155` | 用 `store.gateSpecFor(p.id)`；`isFocus === false` 時**不算 gate**、center 欄只留 ephemeral（D-3） |
| `shared.css` 插在 `:688` 之後 | `.app-status-route` ＋ `--vibe` 變體（warn 三件組，照抄 `.app-status-pill--review` 配方）。窄版讓路線籤 `flex-shrink:0`，**不得縮 `.app-status-project` 的 `max-width:28ch`**（跨頁面共用面） |
| **新** `tests/status-bar-view.test.ts` | 四種 route 的中文名**斷言等於 `routeById(...)!.name`**（釘死不得出現第三份對照表）；null 回空；零 `L0`–`L4`；斷言輸出不含「結構可送審」。約 +12 |

**為什麼要抽新檔**：`status-bar.ts` 頂層 import store 且 module 頂層跑 `resolveBuildInfo()`，
bun 直接 import 會拖進 localStorage 與 build 環境。抽出來才測得到。

⚠️ **`evaluatePrdGates` 的分岔比表面嚴重**：它讀的是 `state.sectionValues`／`state.sections`，
那**永遠是 active 專案的內容**，不是傳進去的 spec 對應的專案。只換 `gateSpecFor` 修不掉——
所以非 focus 時整條 gate 欄留白，這不是保守，是唯一誠實的做法。

**開工前先敲併行線**（`main-2` worktree）拿線頭 #8 的修正方向。`status-bar.ts` 短期歸本線獨佔，
但那是談定的，不是預設。

### B1 · 自簽 helper 收編 — S

`src/lib/signoff.ts` 緊接 `SELF_SIGN_NOTE`（`:616`）之下新增六支，**reader 與 writer 進同一檔**：

`selfSignNote(subject)` · `isSelfSignComment(c)` · `isSelfSignDecision(d)` ·
`isSelfSignStage(s)` · `caseHasSelfSign(c)` · `selfSignAnchor(comment)`

收編三處：`signoff.ts:675`、`store.ts:2041`、`store.ts:2152`。
**完成條件**：`grep -rn "startsWith(SELF_SIGN_NOTE)" src` 只剩 `lib/signoff.ts` 內部一處。
純重構，既有 2132 條全綠即可（測試數可不變）。

### B2a · 關卡列＋時間軸 — M（依賴 B1）

| 落點 | 做什麼 |
|---|---|
| `src/lib/signoff-stages.ts:232` | `<li>` 追加 `sg-stage--self-signed` |
| 同檔 `:235-238` | `.sg-stage-name` 內插 `<span class="sg-selfsign">自簽</span>` |
| 同檔 `:250-256` | 自簽時**不原樣印** `「一鍵自簽（試作／探索） · anc:t=…」`。改印「作者核准自己 · 未經第三方」＋`錨點 <mono>`（D-4）。非自簽路徑逐字不動 |
| `src/lib/signoff.ts:780-790` | `TimelineKind` 加 `"selfsign"`。⛔ **不要動 `DECISION_TITLE`**（它是 `Record<CaseDecision["kind"],…>`），另加 `SELF_SIGN_TITLE` |
| `src/lib/signoff.ts:843-853` | `signoffTimeline` 對自簽決策回 `kind:"selfsign"` |
| **新** `src/lib/signoff-log.ts` | 把 `pages/signoff.ts:170-178` 的 `rowHtml` 搬出來成 `timelineRowHtml(e)`。**不抽的話徽章只能靠 CSS `content:` 注入中文，那是把文案藏進樣式表** |
| `shared.css` 插在 `:13655` 區段 | `.sg-stage--self-signed` ＋ `.sg-selfsign` ＋ `.sg-log--selfsign .sg-log-when` |

### B2b · review 頁 approval strip — M（依賴 B1）

| 落點 | 做什麼 |
|---|---|
| **新** `src/lib/approval-strip.ts` | `approvalStripHtml({approvals, stages?, openComments, withdrawn, selfSigned})`。把 `review.ts:431-455` 逐字搬過來再加自簽標記。⛔ 不塞進 `signoff-stages.ts`——那個檔的合約講的是「送審建立的關卡」，approval 是另一件事的鏡像 |
| `src/pages/review.ts:409-455` | 改呼叫。`:456-480` 的 `#approvals-summary`／`#status-pill`／`#btn-approve` **留在頁面裡不動**（DOM 副作用不是 HTML producer） |
| `shared.css` 插在 `:2200` 區段 | `.approval-card.is-self-signed` ＋ `.ap-selfsign` |

⚠️ **`Approval` 鏡像是有損的**：`store.ts:472-475` 把 `skipped→empty`、`changes_requested→pending`，
且 `syncApprovalsFromActiveCase()` 只同步 **active** 個案。`stages` 缺席時**一律安靜不標**，不要猜。

### B3 · P1-3 誠實文案 — S（依賴 B2b）

**主位置**：`src/lib/signoff.ts:498-511`（`signoffSummary` 的 `!c.reviewCommitId` 分支）。
這是全 App 目前最大的一句謊——vibe 自簽後所有關卡 approved、進度條滿格，頭條卻寫
「尚未送審 / 到編輯台按『送出審閱』之後才會開始跑」，使用者只會讀成「系統漏了」。

`caseHasSelfSign(c) && !c.reviewCommitId` → headline 改「已自簽 —— 尚未進入正式審閱」，
detail 說明「專案狀態仍是草稿，進度不會因為自簽而前進」。
⛔ **`state` 仍是 `"draft"`**（SPEC-03 已拍板自簽不推進），`signoffCta` 不新增升檔按鈕（SPEC-05）。

**次位置**：`approvalStripHtml` 內 `selfSigned` 時多一行「已自簽（試作／探索）—— 專案仍是草稿」。

### 斜線底紋（B2a / B2b 共用，AC-12 的地雷）

設計 v4 的 `2px / 8px` 幾何**照抄必定違規**。改用 `repeating-linear-gradient(45deg, …)` 搭
`var(--space-1)` / `var(--space-3)` 當條紋週期，`color-mix(in oklab, var(--warn) 8%, transparent)`。
`45deg` 與百分比不是 px，不觸發 AC-12。

⚠️ **`warn 5%/8%` 疊在 `terminal`（極暗底）上大機率視覺為零。** 這是機器測不到的類別，
只能靠 Interceptor 四主題各一張截圖。看不見時走既有的 per-theme override 慣例
（`shared.css:3784` 就是這個 pattern）把百分比提到 10–14%，**不新增 token、不新增主題**。

### Phase 1 測試（新增約 +55，2132 → ~2187）

`tests/status-bar-view.test.ts`(+12) · `tests/self-sign-visibility.test.ts`(+18) ·
`tests/approval-strip.test.ts`(+12) · `tests/signoff.test.ts` 擴充(+6) ·
`tests/vibe-route-store.test.ts` 擴充(+3) · source-grep 守門(+4)

**最重要的一條**：`selfSignNote(selfSignSubject(id))` 產的字串必須被三支 reader 全部認出——
writer 與 reader 同檔的意義就在這條合約測試。

### Phase 1 並行安全

- `shared.css` 三個區段（`:688` / `:2200` / `:13655`）互不重疊，可並行
- `src/lib/signoff.ts` 由 B 線**單一 agent 獨佔**，A 不碰
- **B1 未落地前 B2a / B2b 不得開工**（helper 不存在，tsc 會紅）

---

## Phase 2 — 單一專案總覽改版

### 新的 `#dash-root` 骨架（取代 `dashboard.ts:643-648`）

```
1  <header class="d-head">     專案身分 ＋ 鏈健康度一行（修缺陷③）
2  <ol class="gov-chain">      六站：意圖 → 規格 → 計劃 → 實作 → 驗證 → 交付
3  <a class="d-uat-row">        跨專案實測列（完全不動）
4  <div class="d-grid d-facts"> 降級事實卡（技術線 / 容量 / 工作區）
5  <p class="d-measured">       量測時間 ＋ 路徑
```

**零區塊被刪除**——11 個資訊區塊有 8 個降級成鏈上某一站的證據、2 個降級成鏈下事實卡、
1 個（跨專案實測列）原封不動。砍掉的只有 `.d-top` 兩欄等高格線這個**版面概念**。

git 頭條從「整頁第一眼」降級成鏈上「實作」站的主證據行。

### 一站的解剖（五段，缺資料整段不渲染，不留 `—` 空殼）

1. 狀態點＋序號（**1–6 阿拉伯數字，不是 L 碼**）＋站名＋狀態字
2. lead：一句話結論
3. `passWhen`：**取 `layer.passWhen`，不取 `FLOW_LAYER_DOCS[].passWhen`**——L2 是依 gate spec
   生成的，取靜態值等於對 vibe 說謊
4. 稽核微列 `.audit-trail-micro`，上限 3 條
5. **只有 active 站**渲染「現在該做」＋`goto` 按鈕 ← 這就是 SPEC-04 的「就地成為鏈上的一站」

**展開用原生 `<details>/<summary>`，不用委派 listener**——純字串可測、鍵盤與輔助技術免費。
**dashboard 不掛 `.flow-strip`**（垂直鏈就是這頁的流程條，掛兩條是重複）。
**不做頂部 `.adhd-focus-strip`**——同一句話出現兩次，「位置本身帶資訊」就被稀釋掉了。

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
| `dashboard.ts:699-708` 未選專案 | 整頁空狀態。`uatRow()` **不刪、改位置**——從空狀態上方浮著，改成收進空狀態版面內的次要行 |
| `:709-731` **未綁資料夾**（AC-08 正題） | 四者並存 → `.empty-state-layout` 兩欄：左欄＝**影子鏈**（六站灰階「未建立」）＋一句話＋「指定專案資料夾」；右欄＝實測列 ＋ **一條輕量次要文字連結**（編輯身分／版號政策，D-5）。⛔ 身分卡與版號政策卡的**卡片外殼移除**。影子鏈同時修掉設計缺陷④（左下大片空白） |
| `:732-746` 非桌面版 | 整頁空狀態。`:733-735` 的「刻意不放實測列」**原文保留**，且**新增同源守門**：非桌面版不得用 `hasPlanSteps === false` 畫「計劃未完成」——那是同一種假全清 |
| `:754-770` 量測中／失敗 | **從單行升級**：先畫頁首＋不需要磁碟的鏈（意圖／規格／交付可信），磁碟證據處寫「量測中…」。這是「一片黑」主訴求的直接修法，也讓失敗不再變成整頁空白 |

### `hasPlanSteps` 資料通道（blocker 級）

現況：dashboard 沒有 `planModules`，漏傳 → `doneMap.l3` 永遠 false → active 掃描
**永遠停在計劃站**，整條鏈的「下一步」對每個專案都指向同一個地方。

⛔ **不得照抄 editor/projects/review 的 `import.meta.glob("../../plans/*.md")`**——那是
Anchorline 這個 repo 自己的 plans、且 DEV-only。拿本 repo 的計劃去點亮使用者的專案是說謊，
正式版還會靜默變成永遠 false。

**採用**：共用 `dashboard.ts:539-565` 已經在跑的那一趟 `loadUatScan`。
`uat-pending.ts:399-406` 的 `UatScan` 加 `planStepDirs`，`:441-446` 多算一次
`planStepDirsFrom(scan.files)`。零額外 I/O，不破壞「五個曝光面共用一趟」的設計。

**非桌面版必須是 unknown，不是 false**：`ChainInput` 收 `planStepsKnown`，為假時該站顯示
「桌面版才量得到」且重算 active 時跳過。⛔ **不改 `flow-layers.ts`**（加 `unknown` 要動四個
既有呼叫端，且會影響 editor/review/projects/tracking）。

### ⚠️ R10 — 又一個隱形分岔（P2-2c 必做）

`dashboard.ts:91-95` 的 `activeProject()` 會過濾 `isSample` 並 fallback 到 `visible[0]`；
`flow-layers.ts:37-44` 的 `activeProject(state)` **不過濾**、fallback 到 `p1`。
兩者可能指向不同專案 → 鏈的規格側會描述另一個專案的章節，**完全不報錯**。

**解法現成**：照 `overview.ts:112-121` 的 `gateOf` 寫法，餵 `deriveFlowLayers` 一份專案限定的
state：`{...st, sectionValues: projectSectionValues[p.id], sections: sectionsFor(p.id),
activeProjectId: p.id}` ＋ `store.gateSpecFor(p.id)`。理由要寫進 `gov-chain.ts` 檔頭。

### P2-0 六個設計缺陷的判定

| # | 缺陷 | 判定 |
|---|---|---|
| ① | Sign-off 卡掉了風險說明／變更重點／影響範圍 | **本輪不補**。這三項在現行 code 沒有專屬欄位（D-7 已定只用現成事實），硬補等於編資料 |
| ② | 「待核准的規格修訂」與「已自簽」矛盾 | 標題改成狀態驅動：自簽時寫「已自簽 · 未送正式審閱」 |
| ③ | 頁首掉了健康度訊號 | `chainHealthLine(stations)` →「鏈已完成 N 站 · M 件待辦」放 `.d-head` 右側。**不得出現 L 碼** |
| ④ | 畫面 B 左右失衡 | 影子鏈進左欄撐高度；<900px 退單欄 |
| ⑤ | 路線徽章兩畫面強度不一 | **整項刪除**：dashboard 不放四格 segmented（SPEC-05 已定唯讀指示器），路線由 P1-1 的常駐狀態列表達。缺陷用刪除解決 |
| ⑥ | 「自簽不推進狀態」權重過弱 | 改成站內 `.gc-note.is-warn`（`--warn-bg` 底、`--fs-3`）。**本輪只預留位置不填內容**（D-6） |

### Phase 2 切分

```
P2-0 ──┬── P2-1 (CSS)        ┐
       ├── P2-2a (gov-chain) ├── P2-2c (dashboard.ts 接線) ── P2-3 ── P2-4
       └── P2-2b (plan-steps)┘
```

| 塊 | 落點 | 量 |
|---|---|---|
| **P2-0** | 六缺陷判定表（上表）附進 PRD §12，不寫 code | S |
| **P2-1** | `shared.css` 新增 `.gov-chain` `.gc-*` `.audit-trail-micro` `.d-head` `.gc-ghost` `.empty-state-layout`；改 `:9241-9245` 註解（**只改註解不改值**）；`.d-top`/`.d-top-left` 成孤兒 → **留＋加註解，不刪** | M |
| **P2-2a** | **新** `src/lib/gov-chain.ts`（`buildChainStations` / `renderGovChainHtml` / `renderGhostChainHtml` / `chainHealthLine` / `AUDIT_ITEM_CAP=3`）＋ `tests/gov-chain.test.ts` | M |
| **P2-2b** | **新** `src/lib/plan-steps.ts` ＋ `uat-pending.ts:399-446` 擴充 ＋ 測試 | S |
| **P2-2c** | `dashboard.ts` 接線：`:642-658` 重寫組裝、`:233-280` 降級、`:696-771` 五分支、`:539-565`。**含 R10 修正** | M |
| **P2-3** | **新** `src/lib/dashboard-empty.ts` ＋ 測試 ＋ 接三分支 | M |
| **P2-4** | 驗證（見下方） | S/M |

**可並行**：P2-1 ∥ P2-2a ∥ P2-2b（前提是先把 class 名清單當契約敲定）。
**必須單一 agent**：P2-2c 與 P2-3 都寫 `dashboard.ts` —— 1476 行單一 closure，兩人同改必衝突。

### closure 怎麼解

**不重構整檔**（1476 行全在 `requireAuth()` 的 `else {}` 裡，整體外移是 L 級）。
只做一件事：把 HTML producer 抽成「吃 plain data、回字串」的純函式，
`activeProject()` 在呼叫端取一次往下傳，`cache`/`busy` 本來就不進 producer，
副作用（`bindIdentEditing` / `addEventListener` / `loadGovernance`）留在頁內。
先例照 `src/lib/focus-card.ts`。

### Phase 2 測試（新增 30–40）

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

## Phase 3 — 建案入口收斂（Scott 拍板做到 4/4）

### 現況：實際覆蓋率 1/4，不是 PRD 寫的 1/3

| 入口 | 現況 | 落點 |
|---|---|---|
| 手動精靈 | ✅ 經過 triage | `projects.ts:924-971` → `:1023` 落 route |
| Markdown 匯入 | ❌ 無 route | `store.ts:1354-1397`；UI 在 `onboarding.ts:197-206` |
| 資料夾掃描匯入 | ❌ 無 route | `store.ts:1469-1583`；UI 在 `projects.ts:1541-1580` |
| **`?beginner=1`** | ❌ **PRD 沒寫到的漏網支線** | `projects.ts:1093-1098` 直接 `openWizard(true)` 繞過 triage。從 `onboarding.ts:208-212` 與 `rail-projects.ts:312` 都進得來 |
| （第五條）agent handoff | ❌ 全自動無互動 | `projects.ts:1441-1462`，**沒地方彈 modal** |

### 前置重構：triage modal 目前不可重用

`openTriage` / `pickRoute` 是 `projects.ts` 那個 `else {}` 區塊裡的區域閉包，**沒有 export**、
硬綁 `projects.html` 專屬 DOM（`#route-grid` `#modal-triage` `#triage-close` `#triage-skip`）、
沒有回傳值（結果寫進閉包變數 `pickedRoute`，控制流寫死跳去 `openWizard()`）。

**P3-0（前置，M）**：抽成 `src/lib/triage-modal.ts`，回傳 `Promise<ProjectRoute | null>`，
自建 DOM 或接受 host element。`projects.ts` 改為呼叫端。

**P3-1（M）**：三條互動路徑接上 `triage-modal`。
**P3-2（S）**：agent handoff 從內容推導 route（章節數／內容特徵），**不彈窗**，
並在匯入完成的 toast 說明推導結果（順便帶 Q-04 已拍板的 pct 落差文案）。
**P3-3（S）**：`rail-projects.ts:309-313` 的 `ADD_ITEMS` 三條硬編 href 是天然收口點；
動 `#btn-new` 的 id 或行為會讓 `first-run-tour.ts:27` 的聚光燈**靜默落空**（找不到 anchor 就置中，不報錯），
`adhd-ui.ts:290/450` 也要一併改。

### 測試從零開始

`tests/` 104 個檔**零個**提到 `importMarkdownProject` 或 `importProjectCandidates`。
M-05 與 AC-09 目前沒有基線 —— **P3 要先建立這條基線才有辦法宣稱 1/4 → 4/4**。

### ⚠️ 跨 session 接縫（P3 最大風險）

併行線的 P2 會碰 `onboarding.html` / `first-run-tour.ts` / `rail-nav.ts`，**正是本階段的腹地**。
Scott 已定 P3 排最後，所以很可能對方先動。**P3 開工前必須先敲對方確認落點狀態。**

---

## 驗證

### 每個 Phase 結束都要跑

```bash
bunx tsc --noEmit                                    # exit 0
bun test                                             # ≥ 前一 Phase，0 fail
git diff <phase-base>..HEAD -- src '*.html' | grep '^+' | grep -nE '"[^"]*L[0-4][^"]*"'   # AC-10 零命中
git diff <phase-base>..HEAD -- src shared.css '*.html' | grep '^+' | grep -nE 'https?://(cdn|fonts)'  # AC-11 零命中
```

⚠️ **AC-11 的 pathspec 一定要含根目錄 `shared.css`** —— 它不在 `src/` 下，漏了就驗不到最可能違反的檔案。
⚠️ 兩條都**必須設 diff 範圍**：現況全檔 `L[0-4]` 有 49 個命中、`docs/` 與 `landing*.html` 本來就有
15 處外部字體／CDN，不設範圍會全數誤報。

### Interceptor 真 Chrome

```bash
bunx vite --port 5199 --strictPort     # ⛔ 不是 5173（那是別的 checkout，用錯埠會對著另一個版本截圖且完全不報錯）
```

- **P1**：17 個 App 頁抽 5 頁（editor / review / signoff / dashboard / projects）看路線籤；
  review / signoff × 4 主題各一張看斜線底紋（`terminal` 暗底最可能看不見）
- **P2**：三段斷點（>1100 / 900–1100 / <900）版面不破；`.route-grid` 斷點未被改動
- 截圖一律 `VerifyViewport.ts`，**不用 `Capture.sh`**

### Cato 跨廠商審查

P1 與 P2 各一次，**merge 前審**（不是先合再審）。開工時 codex 池 76%，偏緊。
**brief 必須包含**：落點行號清單、優先序、「先出結論再補證據」。
前一輪它撞了兩次 5 回合上限、零產出，第三次下令「最多再跑 1 個工具立刻輸出」才交件。

### 實機 UAT

Phase 1 與 Phase 2 各出一份，走 `Uat` skill。題數對應改動範圍（整頁功能 8–15 題）。
視覺類機器測不到——AC-07（自簽一眼可分辨）、AC-08（空狀態不並存）、AC-15（三斷點）
只有 Scott 實機答得出來。

---

## 收尾（PM 做，不派 agent）

1. commit 前問 Scott（本 repo **不在**免詢問名單內）
2. **push 另外再問** —— main 現領先 `origin/main` **13** 個 commit，
   且要等 `add-vibe-route` 的 8 題 vibe UAT
3. 兩條 PRD 修正（AC-06 → 17 頁、AC-08 口徑）寫回 `docs/PRD-app-ui-update.md` 並記修訂紀錄
4. ⛔ **不開 openspec change** —— `openspec/` 歸 `project-anchorline-3b` 線，
   且 `add-vibe-route` 尚未 archive，本線再開一個會撞

## 明確不做

- 引入 DOM 測試環境（happy-dom）—— 併行線的 P0 建議 #2，L 級，另案
- 缺口 #10 / Q-13（升檔靜默改變關卡來源）—— 已歸 `3b` 線
- 缺口 #17（升檔訊號偵測）—— 已讓給併行線 P3
- 缺口 #16 / #18 —— PRD 已列非目標
- v4 畫面 C 的正式多方簽核關卡表 —— Q-01 拍板選 (b)，P2 之後的目標態
- 新增主題 · 外部 CDN · L0–L4 編號進 UI · 自創升檔提示樣式 · 雙進度曲線

## 結束摘要

（工作結束時補上）
