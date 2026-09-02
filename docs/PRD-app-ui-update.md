---
status: draft
created: 2026-09-02
owner: Scott
route: full
parent: docs/PRD.md
---

# Anchorline 全 App 介面改版 — 產品需求文件

> **這是子專案 PRD，不取代 `docs/PRD.md`。** 產品層的邊界、非目標與治理鏈定義以 `docs/PRD.md`（v0.4.1）為準；本文件只管「全 app 介面改版」這一條線，遇到衝突以 `docs/PRD.md` 為上位。
>
> **章節骨架採 unified PRD 的 full 路線（全量 15 章）**，標題與編號逐字對齊 `src/data/seed.ts` 的 `SEED_SECTIONS`；`## <編號> <標題>` ＋ `### <欄位>` 的層級沿用 `src/lib/prd-file.ts` 的 `renderPrdMarkdown()`，以便日後匯入 App 後匯出格式一致。範本原文見 `docs/TEMPLATE-prd-unified.md`。

## 01 文件概況與修訂紀錄

### 文件紀錄

| 欄位 | 內容 |
|---|---|
| 專案／需求名稱 | Anchorline 全 App 介面改版（路線可見 · 自簽可見 · 單一專案總覽改版 · 建案入口收斂） |
| 負責人 | Scott（PM 兼唯一使用者；代筆 Miles） |
| 平台 | Tauri 桌面 App（macOS 實機；Windows / Linux 僅 CI 建置） |
| 目前產品版號 | v0.1.0（`package.json` / `tauri.conf.json`） |
| 文件狀態 | 審閱中（已過兩輪跨廠商審查；7 題開放問題已拍板，待 Scott 終審） |
| 利害關係人 | Scott（決策）；實作／審查由多家 AI agent 分工；主 repo 上另有兩條併行 session（`project-anchorline-91` 動 `docs/` 與 `plans/`、`3b` 動 `docs/` 與 `openspec/`），介面線需與其守接縫協議 |
| **本次路線判定** | **☑ 寫 PRD — Full（全量 15 章）** |
| 判定理由 | 命中 `src/lib/prd-triage.ts:69` 的 full 適用情境「新產品或大型改版（多模組，需要功能地圖與 IA）」：本輪橫跨 `store.ts` / `signoff.ts` / `flow-layers.ts` / `status-bar.ts` / `dashboard.ts` / `shared.css` 六個模組與 22 個 HTML 頁面，且要重畫單一專案總覽的資訊架構。不適用 lite（不是單一功能迭代）、不適用 vibe（不是週末試作）、不適用 openspec（不只是文案與欄位調整）。 |

### 修訂紀錄

| 日期 | 版本 | 修改人 | 修改章節 | 變更內容 | 已通知 |
|---|---|---|---|---|---|
| 2026-09-02 | v0.1 | Miles（代筆） | 全部 | 初版：從 `plans/Anchorline__2026-09-02-1221__app-ui-update.md`、`plans/A-新增專案架構調查__2026-09-02.md`、`plans/handoff-app-ui-update__2026-09-02-1330.md` 收攏 | — |
| 2026-09-02 | v0.2 | Miles（代筆） | 01 / 03 / 05 / 09 / 11 / 12 / 13 / 14 / 15 | 兩輪跨廠商審查（Cato `gpt-5.6-sol` 5 條、`gpt-5.6-luna` 5 條）findings 全數修正：L4 亮燈條件補上 `hasSpec`、AC-10/AC-11 改 diff-only 判準、§03 引用標明為 P0 修正前狀態、P0-2 與 dashboard 空狀態落點更正；`bun test` 2132 pass/0 fail 獨立驗證；§15 七題全部拍板（Q-01 選 b、Q-05 進 repo、Q-02 留、Q-04 toast、Q-06 只定順序、Q-07 不做量表、Q-03 延後） | ☑ 已於本次 commit 記錄 |

## 02 摘要

### 專案功能說明與願景

Anchorline 的賣點是「治理鏈看得見」，但目前這條鏈在畫面上有一半是隱形的。全 App 22 個 HTML 頁面裡，只有 `editor.html` 一頁看得出專案走哪一檔路線；自簽的事實（`SELF_SIGN_NOTE`）零頁面渲染，一個 vibe 檔的一鍵自簽和一場真正的多方簽核在 `review.html` 上長得一模一樣；單一專案總覽 `dashboard.ts` 的 import 清單裡沒有任何一支 PRD 治理模組，它回答的是 git 與檔案的問題，不是治理的問題。

本專案要把「治理鏈就是頁面骨架」這件事落到畫面上：路線進常駐狀態條、自簽事實進簽核頁、單一專案總覽從「一片黑、下半頁空白、答不出下一步」改成鏈上每一站都有稽核微列。

**但介面不是第一順位。** 架構調查查出流程條 L4「實作」那一格從產品上線至今可能從未在送審前亮過——`Project.pct` 從不由章節完成度推導，建案寫死 18，而 L4 門檻是 25；而 vibe 的一鍵自簽有兩個守門缺口，讓「治理降到最小但不歸零」的承諾實際上歸了零。**一條講不出真話的流程條，畫得再漂亮都是白做。** 所以 Phase 0 先修底座，介面排在它後面。

主要功能：

- 路線可見：四檔路線進全頁常駐狀態條（`status-bar.ts`），不再只有編輯台看得到
- 自簽可見：自簽的關卡在 `review.html` / `signoff.html` 有專屬視覺語彙，與多方核准可一眼分辨
- 單一專案總覽改版：治理鏈當骨架、每站帶稽核微列、未綁資料夾走整頁空狀態
- 建案入口收斂：三個建案入口目前只有一個經過路線判定，另兩條匯入路徑一律落成 Full
- 治理底座修正（已完成）：`pct` 由章節完成度推導、自簽補上 gate 與 `status` 守門、L2 判定文案依路線產生

實際要達成：

- 讓「治理強度」在使用者的任何一個視野裡都是可見量，而不是只存在於匯出的 markdown 檔頭
- 讓流程條六格都講真話——修完 L4 之後才有資格談把路線加進這條鏈

### 做什麼

把四檔路線與自簽事實從「只有編輯台與匯出檔看得到」提升為全 App 常駐資訊，並以治理鏈為骨架重畫單一專案總覽；動工前先修好會讓流程條說謊的四個底座缺陷。

### 給誰

Scott 本人——單人 PM／顧問，ADHD，帶一隊 AI agent 開發，需要在任何一頁都看得出「這個專案的治理強度是多少、它現在走到鏈的哪一站」。次要受益者是開源後同型的單人開發者（此定位在 `docs/PRD.md` §3 仍標為待拍板，本文件沿用該狀態，不自行升格）。

### 為何現在

`6dcd5c9` 剛把第四檔路線「試作／探索」落地，四檔路線系統成形；但架構調查（`plans/A-新增專案架構調查__2026-09-02.md`）同時查出 18 項缺口，其中 6 項判定必做，且有 4 項是「路線資訊在 UI 上根本不存在」造成的。路線系統剛上線就有缺口，補的成本最低；等它累積成使用者習慣再改，代價會高得多。

### 技術線選型

- 前端主路徑：無框架 TypeScript ＋ 多頁 HTML（沿用既有架構，不引入框架）
- 樣式：一律用 `shared.css` 既有 token（`--accent` / `--surface` / `--border` / `--fs-*` / `--radius-*`），不硬編 hex 或 px
- 落點集中在 `status-bar.ts`（常駐狀態條）、`dashboard.ts`（單一專案總覽）、`shared.css`（卡片／焦點卡／間距），避開併行 session 的腹地
- 驗證：`bunx tsc --noEmit` ＋ `bun test` ＋ Interceptor 真 Chrome（**5199 埠**）；設計截圖走 `VerifyViewport.ts`
- **刻意不選（一）**：不新增主題。新增一個主題要改四層共 30 個註冊點（`shared.css` token 區塊、14 份 HTML `<head>` 的防閃爍 bootstrap 各含 `if(!m[t])` 與 `catch` 兩條退路、`theme.ts` 的 `THEMES` 與 `migrateLegacy()`、`types.ts` 的 `ThemeId`），漏改不報錯只會靜默回退。本輪只強化既有 class。
- **刻意不選（二）**：不引入任何外部 CDN、字體或圖示庫。本機優先的 Tauri App，離線必須能跑。
- **刻意不選（三）**：UI 不出現 `L0`–`L4` 檔位編號。`openspec/changes/add-vibe-route/specs/vibe-route/spec.md:8` 明文禁止，且已寫進 UAT 驗收條件。治理強度改用四檔名稱與視覺權重表達。

## 03 專案背景與佐證

### 背景與問題

Anchorline 對外的主張是「跨四種身分的錨點 join key ＋ 看得見的治理鏈」。但 2026-09-02 的架構調查把畫面層攤開之後，發現主張與實作之間有一段沒補上的距離：

**第一，治理強度不可見。** 四檔路線（full / lite / vibe / openspec）是一個有序量——15 節多方簽核 → 8 節 → 3 節一鍵自簽 → 不寫 PRD。但全 App 22 頁裡，只有 `editor.html:122-128` 的一個下拉看得到它；每頁都有的常駐狀態條 `status-bar.ts:167-180` 有專案名、頁面、狀態 pill、gate 摘要，就是沒有路線。反諷的是，路線唯一穩定露出的地方是 App **之外**的匯出檔（`prd-file.ts:151`）。`shared.css` 裡唯一的路線專屬樣式是 `.route-card.is-openspec .route-scale`，`is-vibe` / `is-lite` / `is-full` 零樣式——四張同色平行卡片把有序量畫成了平行選項。

**第二，治理成果不可見。** `SELF_SIGN_NOTE` 只出現在 `lib/signoff.ts` 與 `data/store.ts`，任何頁面都沒有渲染它。一個 vibe 檔走完唯一的治理動作（一鍵自簽）之後，`review.html` 上它與真正的多方核准同型，差別只有 comment 字串前綴。稽核的價值在於看得見，看不見的稽核等於沒有。

**第三，底座在說謊。** `Project.pct` 從不由章節完成度推導：建案寫死 18、Markdown 匯入寫死 8、資料夾匯入用掃描分數，之後唯一更新是 `approveAndLock` 的 `allDone ? 100`。⚠️ **以下行號皆為 P0 修正前的狀態，需用 `git show a2b5d0b^:<檔>` 查看**——現況 `projects.ts:1008` 已是 `pct: 0`：`projects.ts:1008`（建案）、`store.ts:1280`（Markdown 匯入）、`store.ts:1432`（資料夾匯入）、`store.ts:2946`（`approveAndLock`）。L4「實作」的門檻是 `pct >= 25`，所以手動新建的草稿把 15 章寫得再完整，L4 在送審前永遠不亮——**它不報錯，只是不亮**，所以上線至今沒有人回報。同一份文件裡，`FLOW_LAYER_DOCS.l2.passWhen` 硬寫「Non-Goals 至少 3 條」（`flow-layers.ts:120`，**同為修正前狀態**；現況該行已是 `${nonGoals.require.min}` 動態值），但 vibe 是 1 條、領域包又是別的數字，使用者點開 L2 看到的唯一判定說明有機率在說謊。

**第四，最小治理實質歸零。** vibe 的一鍵自簽不呼叫 `evaluatePrdGates`，而 spec 明寫 non-goals ≥ 1 對 vibe「仍為 block」；自簽也不擋 `status === "review"`，一個已送進正式審閱、關卡已指派給多人的專案，作者仍能一鍵核准所有 pending 關卡。

### 佐證（引言／審查紀錄／工單）

> 「`Project.pct` 從來不從章節完成度推導……所以一份手動新建的草稿 pct 永遠是 18 < 25 → **L4 在送審之前永遠不亮**，不管使用者把 15 章寫得多完整。這是既有缺陷，不是 vibe 帶進來的。」
> — A agent 架構調查，`plans/A-新增專案架構調查__2026-09-02.md:152-156`（證據取自不可變 commit 物件 `git show 6dcd5c9:<path>`，非工作樹）

> 「全 App 22 個 HTML 頁面裡，只有 `editor.html` 一頁看得到路線。」
> — 同上，`:398`（逐頁列表附證據行號）

> 「這條路 100% 失敗」——`signoff.ts:658` 的錯誤訊息叫使用者「先抽單再自簽」，但 `:665` 的 `c?.withdrawn` 會擋掉。（**行號為修正前**；現況 `:659-664` 是 `status === "review"` 守門、`:668` 才是 `c?.withdrawn`。）
> — Cato 跨廠商審查 finding #1（high），2026-09-02；已於 `a2b5d0b` 修正（採「不放寬守門、只修說謊文案與矛盾註解」）

> 缺口分佈（程式計算，非手估）：必做 6 · 該做 8 · 可延 4，合計 18；工作量 S 10 · M 8 · L 0。
> — 同上，`:498-504`

## 04 目標與非目標

### 目標

- **G-01** 流程條六格都講真話：`Project.pct` 由章節完成度推導，分母隨路線變、不寫死；L2 判定文案依路線產生（已完成，`a2b5d0b`）
- **G-02** vibe 的最小治理不歸零：一鍵自簽必須通過 `evaluatePrdGates`，且擋 `status === "review"`（已完成，`a2b5d0b`）
- **G-03** 路線進全頁常駐狀態條，讓 22 頁都看得出治理強度
- **G-04** 自簽事實在 `review.html` / `signoff.html` 可見，與多方核准可一眼分辨
- **G-05** 單一專案總覽以治理鏈為骨架重畫，每站帶稽核微列；未綁資料夾走整頁空狀態
- **G-06** 三條建案路徑都經過路線判定，不再有「匯入一個週末腳本的資料夾會拿到 15 節」
- **G-07** 全程不違反第 6 章「硬約束」六條——任一條被違反即視為本輪失敗，不論畫面多好看

### 非目標

- **N-01 `L0`–`L4` 檔位編號進 UI。** spec 明文禁止（`openspec/changes/add-vibe-route/specs/vibe-route/spec.md:8`），UAT 已把「卡面沒有 L0–L4 編號」寫成驗收條件。改用四檔名稱與視覺權重表達治理強度。
- **N-02 新增主題。** 會觸發主題四層註冊共 30 個改動點，漏改不報錯只會靜默回退。本輪只強化既有 class。
- **N-03 自行發明「該轉正了」的升檔提示面。** 呈現規則併行 session 已定死：一行灰字＋snooze，永不 modal 永不紅。Phase 2 的 dashboard 不得自創提示樣式。
- **N-04 雙進度曲線。** 已被併行 session 否決，改為「路線卡一行誠實代價」。設計 v5 不得重開這個案。
- **N-05 自行處理 Lite 路線章節編號跳號**（01–05 後直接 11）。穩定編號是刻意的，該題在併行 session 的待拍板池（`docs/PRD.md` §2.3 線頭 #10）。Phase 2 照顯示，不自行改編號。
- **N-06 缺口 #16（跳過路線與選 Full 存出同一份資料）與 #18（`lite → full` 不問確認）。** 判定「可延」，本輪不做。#16 是刻意設計且註解有寫，代價記著即可；#18 的危害是不一致而非資料損失。
- **N-07 缺口 #17（升檔訊號自動偵測）。** 整項讓給併行 session 的 P3（`route-signals.ts` 純函式，約 4–6 檔）。腹地與漸進揭露重疊，各改一次會撞。
- **N-08 缺口 #10（升檔靜默改變關卡來源）。** 已由 spec-research 線（`project-anchorline-3b`）認領，立為 `docs/PRD.md` 開放問題 Q-13。**本計劃不做**，只追蹤。

## 05 成功指標

本輪是內部介面改版，沒有外部使用者流量可量。以下指標一律用 **source-grep 命中數／頁面覆蓋數／測試數** 這類可機械查證的量，不編使用者行為數字。**目標值欄若標「待補」，表示需要 Scott 拍板後才有意義的判準，不是忘了填。**

| 指標 | 現況基準 | 目標值 | 量測方式 | 領先／落後 |
|---|---|---|---|---|
| M-01 路線可見的頁面數 | 1 / 22（僅 `editor.html`；證據 `A 報告:398-411`） | 22 / 22（P1-1 完成後常駐狀態條全頁覆蓋） | `status-bar.ts` 渲染測試 ＋ Interceptor 逐頁抽驗 | 領先 |
| M-02 自簽事實有渲染的頁面數 | 0（`SELF_SIGN_NOTE` 零頁面渲染） | ≥ 2（`review.html`、`signoff.html`） | `git grep SELF_SIGN_NOTE -- src/pages` ＋ UAT 實測 | 領先 |
| M-03 流程條會說謊的格數 | 2（L4 恆不亮、L2 判定文案寫死） | 0 | `bun test`（`prd-progress.test.ts`、`flow-layer-detail.test.ts`） | 領先 |
| M-04 vibe 自簽的守門條數 | 5（路線／抽單鎖定／重複簽／簽核權限／簽核者族系） | 7（＋結構 gate、＋`status === "review"`） | `signoff.ts` / `store.ts` 測試；已於 `a2b5d0b` 達成 | 落後 |
| M-05 經過路線判定的建案入口數 | 1 / 3（手動精靈；兩條匯入路徑不設 route） | 3 / 3 | `store.ts` 匯入路徑測試 | 落後 |
| M-06 測試數（只增不減） | 2132 pass / 0 fail（`a2b5d0b` 後） | 每個 Phase 結束時不低於前一 Phase | `bun test` | 領先 |
| M-07 硬約束違反數 | 0 | 0（任一 > 0 視為本輪失敗） | 逐條檢查表，見第 13 章 AC-10~AC-13 | 領先 |
| M-08 使用者主觀改善（「答得出下一步」） | 無基準（改版前未做量表） | **不設數值目標**（Scott 2026-09-02 拍板，Q-07：不做 NASA-TLX／QUIS） | 實機 UAT AC-08 的質性判定 | 單人自用工具做量表是儀式不是證據；此項刻意不量化 |

## 06 需求來源

| # | 需求 | 來源 | 提出日期 | 釐清結論 |
|---|---|---|---|---|
| R-01 | 單一專案總覽「一片黑、下半頁空白、答不出下一步」 | Scott 口述 | 2026-09-02 | 進開發，Phase 2 |
| R-02 | 把 `6dcd5c9` 的四檔路線系統補進全 app 常駐介面 | Scott 口述 | 2026-09-02 | 進開發，Phase 1 |
| R-03 | 18 項架構缺口（必做 6 / 該做 8 / 可延 4） | A agent 架構調查（唯讀，證據取自 commit 物件） | 2026-09-02 | 必做 6 項全進；該做 8 項擇 3（#10 讓給他線、#11 進 Phase 2、#13/#14 併入 Phase 1/2）；可延 4 項列非目標 |
| R-04 | 四檔路線條是唯讀指示器，不是切換入口 | Scott 拍板（12:3x「皆同意」） | 2026-09-02 | 已定案，見第 11 章 SPEC-05 |
| R-05 | 補「正式多方簽核」示範畫面（不能只示範治理最弱的一檔） | Scott 拍板 | 2026-09-02 | 已完成（設計 v4 畫面 C）；**但 code 無對應實作，範圍見 Q-01** |
| R-06 | 自簽不推進 `status` / `pct` | Scott 拍板 | 2026-09-02 | 已定案，P1-3 改為「誠實呈現」而非「修正」 |
| R-07 | Cato 跨廠商審查 4 個 finding（1 high / 2 medium / 1 low） | Cato（codex 家族，read-only） | 2026-09-02 | 全部修完，含 E agent 加碼的 `importState()` 移轉路徑 |
| R-08 | 設計 v3 的 6 個缺陷（B agent 誠實列出） | B agent 設計審視 | 2026-09-02 | 進開發，Phase 2 的 P2-0；不修就是把問題移植進 repo |
| R-09 | 跨 session 接縫 S-1~S-5 | 兩條併行 session 四輪通訊 | 2026-09-02 | 已收斂：`status-bar.ts` 短期歸本線獨佔；`plans/` 重整方案會附改名對照表；`prd-gates.ts` 的 `SECTION_SUBSTANCE_MIN` 不對齊 gate 門檻已被對方記錄為本線設計決策 |
| R-10 | UI 不得出現 L0–L4 編號 | `openspec` spec 明文（`spec.md:8`） | 2026-09（`add-vibe-route`） | 不做，列非目標 N-01 |

## 07 目標客群與競品

### 目標客群

**主要：Scott 本人**——單人 PM／顧問，ADHD，帶多家 AI agent 分工開發。他最在意的是「打開任何一頁，都要立刻知道這個專案的治理強度與所在位置」。這一群不服務就等於失敗：本產品的第一位使用者就是他，而且是唯一有實機 UAT 資料的人。

**次要：開源後同型的單人開發者／顧問。** 他們的抵抗不是「功能不夠」，是「又一個要學的治理框架」——所以路線可見性必須是**免學習的**：不能靠使用者記住四檔的差別，要靠視覺權重讓他一眼分辨強弱。⚠️ 次要客群究竟是目標受眾還是順帶受益，在 `docs/PRD.md` §3 仍標為待拍板；本文件沿用該狀態，不因為介面改版就自行升格。

### 競品分析

**外部競品分析本輪不重跑。** `docs/PRD.md` §7 已於 2026-09-02 跑過 PriorArt（27 組 GitHub 關鍵字 ＋ 3 次 WebSearch，8 個候選皆「部分滿足」），結論是全新開發、借用線只作架構參考。介面層的外部對照（其他工具怎麼在常駐 UI 上表達「治理強度」）**未做，待補**——這是本章的已知缺口，不是判定為不必要。

以下是本輪實際做過取捨的**內部方案對照**，記下來是為了半年後看得懂為什麼：

| 對象 | 功能 | 作法 | 可借鏡之處 | 不採用的理由 |
|---|---|---|---|---|
| 本產品（現況） | 路線可見性 | 只有 `editor.html` 一個下拉；`shared.css` 唯一路線專屬樣式是 `is-openspec` | — | — |
| 設計 v2（卡片牆） | 單一專案總覽 | 焦點卡回答「我該做什麼」，卡片牆平鋪其餘資訊 | 焦點卡的問句式標題 | **不採用**：焦點卡與治理鏈脫節，使用者知道要做什麼但不知道自己在流程哪裡 |
| **設計 v3 → v4（治理鏈當骨架，採用案）** | 單一專案總覽 | 讓「下一步」就地成為鏈上的一站，位置本身帶資訊 | 位置即資訊；每站帶稽核微列 | — |
| 設計 v3 的四格 segmented control | 路線條 | 看起來可點的四格切換器 | — | **不採用**：code 裡三種點擊行為完全不同（openspec 跳頁不建專案、`lite → full` 不問確認直接切、降級與 vibe 升檔都問確認），長得一樣但行為三分岔會是下一個 bug 來源。改為唯讀指示器 |
| 併行 session 的「雙進度曲線」提案 | 進度呈現 | 兩條曲線並陳 | — | **已被否決**，改為「路線卡一行誠實代價」 |

## 08 用戶故事與流程

### 用戶故事

1. 作為單人 PM，我想要在任何一頁的常駐狀態條看到專案走哪一檔路線，以便不必回編輯台就知道這份 PRD 該有多少節。
2. 作為單人 PM，我想要在 `review.html` 一眼分辨「這關是作者自簽的」與「這關是多方核准的」，以便稽核時不必去讀 comment 字串前綴。
3. 作為 ADHD 使用者，我想要打開單一專案總覽時看到治理鏈與鏈上的下一站，以便不用面對一片黑與下半頁空白。
4. 作為剛匯入一個資料夾的使用者，我想要匯入路徑也問我一次路線，以便一個週末腳本不會拿到 15 節的空白頁。
5. 作為把 PRD 寫得很完整卻沒送審的使用者，我想要流程條的 L4 據實亮起，以便流程條講的是我的實際進度而不是一個寫死的 18。
6. 作為走 vibe 檔的使用者，我想要一鍵自簽在我還沒補齊 BLOCK 項時擋住我，以便「治理降到最小但不歸零」是真的。
7. 作為還沒綁資料夾的使用者，我想要總覽頁給我一整頁的空狀態與一個明確動作，以便我不用在有資料與沒資料的混合畫面裡猜。

### 用戶流程（User Journey）

| 步驟 | 角色 | 動作 | 系統回應 | 畫面 |
|---|---|---|---|---|
| 1 | 使用者 | 點「新建 PRD」 | 開滿版 sheet，渲染四張路線卡（由左至右：新產品／新專案 · 功能建構／迭代優化 · 試作／探索 · Debug／維運） | `projects.html` `#modal-triage` |
| 2 | 使用者 | 選一張卡（或跳過） | 選 `openspec` → 跳 `openspec.html` 不建專案；其餘 → 進精靈，確認頁顯示「路線 <名稱 — 節數標籤>」 | `#modal` 建立新 PRD |
| 3 | 使用者 | 送出建立 | 建 `Project`，路線在 `addProject()` 第一次生效（vibe 只配 3 節空白袋）；`pct` 由章節完成度推導 | → `editor.html` |
| 4 | 使用者 | 切到任何一頁 | **（新）常駐狀態條顯示路線** | 全 22 頁 |
| 5 | 使用者 | 開單一專案總覽 | **（新）治理鏈骨架，每站帶稽核微列；未綁資料夾則整頁空狀態** | `dashboard.html` |
| 6 | vibe 使用者 | 點「一鍵自簽」 | **（改）先跑 `evaluatePrdGates`**：有 BLOCK 就擋並說明；`status === "review"` 也擋 | `editor.html` |
| 7 | 使用者 | 開審閱／簽核頁 | **（新）自簽關卡顯示自簽語彙**：warn 左邊框＋斜線底紋＋「自簽」徽章＋核准者＝作者 | `review.html` / `signoff.html` |
| 8 | 使用者 | 匯入一個資料夾 | **（新）匯入路徑也經過路線判定**，不再一律落成 Full | `projects.html` / `onboarding.html` |

- 流程圖連結：見第 10 章「功能邏輯圖」；建案三入口的完整分岔圖在 `plans/A-新增專案架構調查__2026-09-02.md:249-298`

## 09 功能範圍與開發排程

### 功能範圍（Phase）

| Phase | 功能 | 對應故事 | 需求來源 | 版本號 | 上版時間 | 依賴／風險 | 狀態 |
|---|---|---|---|---|---|---|---|
| **P0** | 治理底座四題：`pct` 推導、自簽補 gate、自簽擋 `review`、L2 文案依路線產生 | 5、6 | R-03、R-07 | 待補 | 待補 | 無外部依賴 | **✅ 已完成並 commit `a2b5d0b`**（`tsc` exit 0；`bun test` 2132 pass / 0 fail，基線 2098、+34）。**未 push** |
| P1 | 路線可見：常駐狀態條加路線（P1-1）；自簽事實在 review / signoff 頁可見（P1-2）；自簽的 `status`／`pct` 誠實呈現（P1-3） | 1、2 | R-02、R-03 | 待補 | 待補 | P1-1 落點 `status-bar.ts:167-180` 已談定短期歸本線獨佔，但開工前要敲併行 session 拿線頭 #8 的修正方向；**P1-2 範圍未定（Q-01）**，(a) 案會讓工作量從 M 升到 L | **未開工** |
| P2 | 單一專案總覽改版：先修 v3 的 6 個缺陷（P2-0）→ `shared.css`（P2-1）→ `dashboard.ts` 治理鏈骨架（P2-2）→ 整頁空狀態（P2-3）→ 驗證（P2-4） | 3、7 | R-01、R-08 | 待補 | 待補 | `.route-grid` 斷點（4 欄 / 1100px / 900px）是跨 session 接縫，動它要先知會；不得自創升檔提示樣式（N-03） | **未開工** |
| P3 | 建案入口收斂：三個入口只有一條經過 triage（P3-1）；升檔訊號整項讓出（P3-2） | 4 | R-03 | 待補 | 待補 | **與併行 session 的 P2 重疊**（`onboarding.html` / `first-run-tour.ts` / `rail-nav.ts`），開工前先知會；排序由 Scott 定 | **未開工** |

**Phase 0 的實際改動落點**（供對照）：

| 題 | 需求 | 落點 |
|---|---|---|
| P0-1 | `Project.pct` 由章節完成度推導（分母隨路線變，不得寫死） | 新檔 `src/lib/prd-progress.ts`；`store.ts` 的 `derivedPctFor` / `syncDerivedPct`，掛在 `touchProjectMeta()`；建案與兩條匯入路徑的寫死值改 `pct: 0` 佔位；三條移轉路徑（`load()` / seed / `importState()`）都重算 |
| P0-2 | 一鍵自簽必須呼叫 `evaluatePrdGates` | `store.ts:2116-2130`（呼叫在 `:2123`；`:2065-2086` 是降級決策，不是這一題）。用 `overview.ts` 的 `gateOf` 寫法，**沒照抄 active 專案的資料** |
| P0-3 | 自簽擋 `status === "review"` | `signoff.ts:655-664`，放在路線檢查之後、`withdrawn` 之前 |
| P0-4 | `l2.passWhen` 依路線產生 | `flow-layers.ts:99-208`。條數數 spec、門檻讀 `bullets.min` |

### 本次時程

| 階段 | 日期 | 負責人 | 備註 |
|---|---|---|---|
| Phase 0 | 2026-09-02（已完成） | C agent 實作 / E agent 回修 / Cato 審查 / Scott 拍板 commit | `a2b5d0b`，未 push |
| Phase 1 | 待補 | 待補 | 需先解 Q-01（P1-2 範圍）才估得出工作量 |
| Phase 2 | 待補 | 待補 | — |
| Phase 3 | 待補 | 待補 | 排序與併行 session 的 P2 交錯，由 Scott 定 |
| 實機 UAT | 待補 | Scott | 視覺類機器測不到（`docs/PRD.md` AC-04） |
| push | 待補 | Scott 拍板 | ⛔ main 現領先 `origin/main`，push 前一定要問過 Scott |

> ⚠️ **本章的日期一律「待補」不是疏漏。** 原始材料裡沒有任何一個經過拍板的日期或版本號；估時只有計劃書的「估 4–6 小時 / 3–5 小時 / 4–6 小時 / 2–3 小時」四個工程直覺值，那不是交付承諾。編一個日期進 PRD 會讓它看起來像已定案。

## 10 產品架構

### 功能心智圖（Function Map）

```
路線可見性
├─ 常駐狀態條路線指示（新）      status-bar.ts
├─ 建案卡片路線視覺權重（強化）   shared.css .route-card.is-*
├─ 編輯台路線下拉（既有）        editor.html #route-bar
└─ 匯出檔頭路線欄（既有）        prd-file.ts ROUTE_LABEL

自簽可見性
├─ 自簽徽章與底紋（新）          review.html / signoff.html
├─ 自簽 vs 多方核准的分辨（新）   同上
└─ 自簽的 status / pct 呈現（新） 誠實呈現，不改語意

單一專案總覽
├─ 治理鏈骨架（新）              dashboard.ts
├─ 每站稽核微列（新）            同上
├─ 整頁空狀態（新）              dashboard.ts :700 未選專案 / :711 未綁資料夾
└─ 卡片／焦點卡／間距 token（改） shared.css

治理底座（已完成）
├─ pct 推導                     prd-progress.ts（新檔）
├─ 自簽 gate 守門                store.ts
├─ 自簽 status 守門              signoff.ts
└─ L2 判定文案依路線             flow-layers.ts

建案入口
├─ 手動精靈（既有，走 triage）    projects.ts
├─ Markdown 匯入（補 triage）     store.ts importMarkdownProject
└─ 資料夾掃描匯入（補 triage）    store.ts importProjectCandidates
```

**CRUD 檢查**（範本要求；掃過一遍才發現的兩個角）：

| 資料 | Create | Read | Update | Delete |
|---|---|---|---|---|
| `Project.route` | 建案精靈 ✅；兩條匯入路徑 ❌（P3-1 要補） | `projectRoute()` ✅ | 編輯台下拉 ✅ | `full` 存成 `undefined` ＝ 刪欄位 ✅ |
| 推導 `pct` | `addProject` 起始 0 ✅ | 流程條 L4、清單、總覽 ✅ | `touchProjectMeta()` ✅ | 不刪（永遠有值） |
| 自簽事實（`SELF_SIGN_NOTE`） | `selfSignVibe` ✅ | **❌ 零頁面渲染**（P1-2 要補） | 離開 vibe 時關卡重設回 pending、錨點保留 ✅ | 不刪（錨點是 append-only） |
| 路線視覺 token | `shared.css` ✅ | 建案卡 ✅ | — | — |

漏掉的兩角就是缺口 #4（自簽事實無 Read 路徑）與缺口 #6（route 在兩條匯入路徑無 Create 路徑）。

- 心智圖連結：無（本專案不維護外部心智圖工具，以上為文字版）

### 資料結構圖（IA）

本輪**不新增持久化欄位**——路線與自簽事實的資料模型在 `6dcd5c9` 就已存在，缺的是讀取路徑。以下是本輪會碰到的既有欄位與新增的推導值：

| 功能 | 欄位 | 型別 | 必填 | 預設值 | 限制 | 備註 |
|---|---|---|---|---|---|---|
| 路線 | `Project.route` | `"lite" \| "vibe" \| undefined` | N | `undefined` | `normalizeRoute()` 只認 `lite` / `vibe`，其餘（含髒值）→ `undefined` | `full` **刻意**存成 `undefined`（副作用＝缺口 #16，列非目標） |
| 進度 | `Project.pct` | number | Y | `0`（建案佔位） | 0–100；由章節完成度推導，分母隨路線變 | **不再寫死**；三條移轉路徑都重算 |
| 進度判準 | `SECTION_SUBSTANCE_MIN` | number（常數） | — | `12` | 每節欄位 trim 後字數相加 ≥ 12 即算「有實質內容」 | **刻意不對齊 gate 門檻**：gate 答「合格沒」、pct 答「進行到哪」。併行 session 已記錄此為本線設計決策，不會當 bug 修掉 |
| 自簽 | 關卡 `comment` 前綴 `SELF_SIGN_NOTE` | string | — | — | 決策一律 `kind: "approved"`，不另記 `override` | 這是目前唯一分辨自簽的依據，也正是 P1-2 要換掉的做法 |
| 流程層 | `FLOW_LAYER_DEFS` | `l1`–`l6` | — | — | **沒有 l0**；`aria-label` 寫死「L1 到 L6 流程」 | 路線若要進流程條，那一格不能叫 L0（N-01） |
| gate 規則 | `VIBE_GATE_SPEC` | spec 物件 | — | — | `non-goals-min` = 1（BASE 是 3）；不載入指標／warn／`emptySections`；一律忽略領域包 | `l2.passWhen` 的條數與門檻都從這裡讀，不寫死 |

### 功能邏輯圖（Flow Chart）

**全局分岔——建案三入口**（缺口 #6 的來源）：

```
手動精靈      → openTriage() → pickRoute() → addProject(route)  ✅ 經過路線判定
Markdown 匯入 → importMarkdownProject()    → addProject()        ❌ 不設 route → 落成 Full
資料夾匯入    → importProjectCandidates()  → addProject()        ❌ 不設 route → 落成 Full
                                              └─ 三條都收斂到 addProject()，
                                                 路線在 blankDocsForSections() 第一次生效
```

**局部分岔——簽核兩條路徑**（P1-2 的來源）：

```
                  ┌─ 正式路徑：送出審閱 → canSignStage → review.html 逐關簽 → approveAndLock
專案 status/route ─┤    守門：路線無限定 / 抽單鎖定 / 重複簽 / 權限 / 族系（user+stage）/ 順序閘門 / 指派對象 / 結構 gate
                  └─ 自簽路徑：#btn-self-sign（僅 vibe 顯示）→ canSelfSign → selfSignVibe
                       守門：僅 vibe / 抽單鎖定 / 重複簽 / 權限 / 族系（user）
                             ＋結構 gate（P0-2 新增）＋ status !== "review"（P0-3 新增）
                       仍缺：關卡層族系隔離（缺口 #9，見 Q-03）、順序閘門、指派對象（設計上就是一次簽完）
```

⚠️ **兩條路徑在畫面上目前是同型的**——`review.html` / `signoff.html` 完全不認得 route（`git grep prd-triage` 只命中 5 個檔，不含這兩頁）。這是 P1-2 的全部理由。

## 11 需求規格

### 功能描述

**SPEC-01 常駐狀態條加路線（P1-1）**：`status-bar.ts:167-180` 的狀態條目前渲染專案名／頁面／狀態 pill／gate 摘要。新增一個路線指示，用四檔名稱（新產品／新專案 · 功能建構／迭代優化 · 試作／探索）而非編號。同一次開工把「結構可送審」這句誤導文案一併處理（併行 session 的線頭 #8，已談定短期歸本線）。

**SPEC-02 自簽事實可見（P1-2）**：視覺語彙沿用設計 v4 畫面 A——warn 左邊框 ＋ 斜線底紋 ＋「自簽」徽章 ＋ 核准者顯示為作者本人。⚠️ **範圍未定**：v4 畫面 C 描繪的正式多方簽核（關卡表＋順序閘門＋職責分離）現行 code 沒有對應實作，(a) 一併把關卡表落到 `review.html`（M→L）或 (b) 明說畫面 C 是 P2 之後的目標態——見 Q-01。**在 Q-01 拍板前，畫面 C 不是已定範圍。**

**SPEC-03 自簽的 `status`／`pct` 誠實呈現（P1-3）**：自簽**不推進** `status` / `pct`（Scott 已拍板，維持現況語意）。本題因此不是「修正」而是「呈現」：讓畫面說清楚「已自簽，但專案仍是草稿」，不要讓使用者以為系統漏了。

**SPEC-04 單一專案總覽改版（P2）**：治理鏈當骨架，每站帶稽核微列；「我該做什麼」就地成為鏈上的一站，位置本身帶資訊。未綁資料夾走整頁空狀態——**空狀態與有資料狀態不得並存**。

**SPEC-05 四檔路線條是唯讀指示器**（已拍板，不重開）：不做切換入口。升檔入口只有 Sign-off 卡那顆「轉為正規路線並送正式簽核」按鈕。理由是 code 裡三種點擊行為完全不同，長得一樣但行為三分岔會是下一個 bug 來源。

**SPEC-06 建案入口收斂（P3-1）**：`importMarkdownProject` 與 `importProjectCandidates` 都要經過路線判定。落點含 `onboarding.*`，與併行 session 的 P2 腹地重疊，開工前先知會。

### 邏輯規則

| 項目 | 內容 |
|---|---|
| 觸發條件 | 路線指示：任何頁面載入 `status-bar` 且有 focus 專案時渲染。自簽語彙：關卡 `comment` 帶 `SELF_SIGN_NOTE` 前綴時渲染（P1-2 完成後改為不依賴字串比對的判準——判準本身待 SPEC-02 定案）。 |
| 輸入來源與限制 | 路線一律走 `projectRoute(project)`，不得自行讀 `p.route`（沒存路線要當 `full`）。節數一律從 `SEED_SECTIONS.length` / 白名單陣列長度算，不寫死。 |
| 處理邏輯 | `pct` = 有實質內容的章節數 ÷ 該路線可見章節數；「有實質內容」＝該節所有欄位 trim 後字數相加 ≥ `SECTION_SUBSTANCE_MIN`（12）。L4 判定 `l4 = implementing && hasSpec`，其中 `implementing = status ∈ {review, approved, withdrawn} \|\| (draft && pct >= 25)`、`hasSpec = gate.canSubmit`（`flow-layers.ts:59,71,80`）。**`implementing` 不等於 L4**。 |
| 輸出內容與格式 | 路線指示輸出四檔中文名稱；**任何輸出都不得含 `L0`–`L4` 字樣**。 |
| 防呆機制 | 一鍵自簽先跑 `evaluatePrdGates`，有 BLOCK 即擋；`status === "review"` 即擋；已自簽（查 `log` 有無自簽決策）即擋。 |
| 資料流向 | 本輪**不新增持久化欄位**；所有新資訊都是既有資料的讀取路徑。`pct` 是推導值，寫回 `Project` 時經 `touchProjectMeta()` 單一入口。 |
| 狀態轉換 | 自簽**不**改變 `status`（維持 `draft`）、**不**改變 `locked`。離開 vibe 時，帶 `SELF_SIGN_NOTE` 的 approved 關卡重設回 `pending`，錨點事件原樣保留。 |

### 例外與錯誤流程

| 例外狀況 | 系統行為 | 使用者看到什麼 |
|---|---|---|
| 專案未存路線（`undefined`） | 一律當 `full` | 路線指示顯示「新產品／新專案」，不顯示空白或「未知」 |
| 專案 `route` 是髒值 | `normalizeRoute()` 收斂為 `undefined` | 同上，不報錯 |
| 沒有 focus 專案 | 狀態條不渲染路線區塊 | 該區塊整塊消失，不留空欄位或佔位符 |
| vibe 自簽時有 BLOCK 未清 | 擋下，不寫任何決策 | 一句話說明還差什麼；⚠️ 目前訊息前後半句打架（Cato finding #4，已修）。文案終稿待 SPEC-02 定案 |
| vibe 專案已 `status === "review"` | 擋下 | 說明「已進正式審閱，請走簽核頁逐關簽」——**不得**引導使用者去抽單（`withdrawn` 會擋掉，那條路 100% 失敗；Cato finding #1） |
| 專案未綁資料夾（總覽頁） | 走整頁空狀態分支 | 一整頁的空狀態＋一個明確動作；**不得**與有資料狀態並存 |
| 專案未綁資料夾（PRD 落檔） | `syncPrdFiles` 不執行（要求 `isNative()` 且有 `rootPath`） | ⚠️ 目前畫面上**沒有任何地方說明**這件事（缺口 #15，判定「該做」）。本輪是否補提示：待補 |
| 匯入的 pct 從掃描分數掉到個位數 | 數字誠實 | 畫面上像「匯入之後專案倒退了」，需要一句說明——**文案待拍板（Q-04）** |
| Interceptor 驗證抓到主 repo 的畫面 | — | 用錯埠會看到另一個版本的畫面且完全不報錯。驗證一律 **5199 埠** |

### 規格數值

| 欄位／元素 | 限制 | 預設值 |
|---|---|---|
| `SECTION_SUBSTANCE_MIN` | 每節欄位 trim 後字數相加 ≥ 12 才算有實質內容 | 12 |
| L4 判定門檻 | `l4 = implementing && hasSpec`；`implementing` 含 `draft && pct >= 25` | 25，**另需 `gate.canSubmit`** |
| `VIBE_GATE_SPEC` non-goals 下限 | ≥ 1 條（BASE 是 ≥ 3 條） | 1 |
| Full / Lite / Vibe 章節數 | 15 / 8 / 3（＋自訂章節永遠可見） | 從資料算，不寫死 |
| `.route-grid` 斷點 | > 1100px 四欄 · 900–1100px 兩欄 · < 900px 單欄 | 既有值，**跨 session 接縫，動它先知會** |
| 設計 v4 畫面 A 字數 | 現況 332 漢字，目標 ~300 | 未達標，待修 |
| 設計 v4 畫面 B 字數 | 235 → 145 漢字（兩刀已下） | 目標 ~120，仍有距離 |
| dev server 埠 | 5199（`bunx vite --port 5199 --strictPort`） | **不是 5173**，那是主 repo |
| 顏色與尺寸 | 一律 `--accent` / `--surface` / `--border` / `--fs-*` / `--radius-*` | 不得硬編 hex 或 px（`shared.css` 已有 447 個硬編 px 字級繞過 token 階梯，不要再加） |
| 外部資源 | 0 個 CDN／字體／圖示庫 | 離線必須能跑 |
| 主題數 | 3（`kami` / `github` / `terminal`），本輪不新增 | 新增一個要改 30 個註冊點 |

## 12 原型、視覺與附件

### 原型

| 功能 | 原型連結 | 保真度 | 最後更新 | 已與 PRD 對過規則 |
|---|---|---|---|---|
| 畫面 A — vibe 自簽的單一專案總覽 | `.aidesigner/mcp-latest-v4.html` | 高 | 2026-09-02 | ⚠️ 部分。自簽視覺語彙（warn 左邊框＋斜線底紋＋徽章）已寫進 SPEC-02；字數 332 未達 ~300 目標 |
| 畫面 C — 正式多方簽核 | 同上 | 高 | 2026-09-02 | ❌ **未對過，且 code 無對應實作**。`review.html` / `signoff.html` 完全不認得 route。**畫面 C 目前是設計提案，不是已定範圍**——歸屬見 Q-01 |
| 畫面 B — 空狀態 | 同上 | 高 | 2026-09-02 | ⚠️ 部分。兩刀已下（235 → 145 漢字），目標 ~120 仍有距離 |

**不一致處以哪份為準**：畫面 C 與現行 code 不一致，**以 code 為準**。✅ **Q-01 已拍板（Scott 2026-09-02 拍板）：選 (b)**——畫面 C 是 **P2 之後的目標態**，不進 P1-2；P1-2 只做自簽視覺語彙（SPEC-02）。理由：`review.html` / `signoff.html` 完全不認得 route，把一個沒有 code 基礎的關卡表塞進 P1 會讓工作量由 M 漲到 L、Phase 1 交不出來。這一條寫死是因為範本第 7 章的警告正是這種情況：「PRD 寫 8 組、設計稿標 10 組，開發到一半才發現的成本最高」。

**設計檔的存放狀態**：✅ **已進 repo**（Scott 2026-09-02 拍板，Q-05）——`.aidesigner/` 含 v2 / v3 / v4 三版設計、`-raw.html` 原檔與 `runs/` 產製紀錄，共 596K。本章原型連結指向 repo 內路徑，協作者 clone 後即可開啟。異地備份仍留 `~/Downloads/anchorline-design-backup-20260902/` 這一份備份。**是否把設計產物納入 repo：待補（見 Q-05）。**

**兩個已知的產出陷阱**（下一輪如果再跑設計工具要防）：

1. `refine_design` 會靜默刪掉沒提到的既有元素——v3→v4 掉了 5 個，包括拍板要保留的「轉為正規路線並送正式簽核」按鈕。每輪都要跑「v(n-1) 有、v(n) 沒有」的字串反向比對。
2. AIDesigner 的 canvas pipeline 會自己注入 `<script src="https://cdn.tailwindcss.com">` 貼在 `</head>` 上（v2/v3/v4 三次都中），違反硬約束「不得引入外部 CDN」，而且它的 `.gap-*` 會撐爆版面。每次都要檢查並移除，原檔另存 `-raw.html`。

### 字串表

本專案無 i18n key 管理系統（單一語系）。以下是本輪會改動或待定的文案，先列在這裡：

| 位置 | 現況 | 本輪處置 |
|---|---|---|
| `status-bar.ts` 「結構可送審」 | 與送審預檢同樣誤導 | P1-1 一併處理（併行 session 線頭 #8） |
| `FLOW_LAYER_DOCS.l2.passWhen` | 曾寫死「Non-Goals 至少 3 條」 | ✅ 已改為依路線產生（P0-4） |
| 自簽被擋時的訊息 | 曾出現「PRD 還沒開始（2 個必填章節）— 請先補齊 BLOCK 項再自簽」前後半句打架 | ✅ 已修（Cato finding #4） |
| `status === "review"` 擋自簽的訊息 | 曾寫「先抽單再自簽」（那條路 100% 失敗） | ✅ 已改為不說謊的文案（Cato finding #1） |
| 匯入 pct 落差的說明 | 無 | ⚠️ **待補**：需要一句「這是 PRD 章節完成度，不是資料夾齊備度」——文案待拍板（Q-04） |
| `HUMAN_APPROVAL_STAGE_NAME`「我核准」 | 第一人稱，在多方簽核情境下錯位 | 待補（v4 已知缺陷，本輪未排入） |

### 附件

| 類型 | 名稱 | 連結 | 提供者 |
|---|---|---|---|
| 調查報告 | 新增專案流程架構調查（18 缺口） | `plans/A-新增專案架構調查__2026-09-02.md` | A agent |
| 計劃書 | 全 App 介面更新計劃（主計劃書） | `plans/Anchorline__2026-09-02-1221__app-ui-update.md` | PM |
| 交接 | 冷啟動 handoff（含硬約束六條） | `plans/handoff-app-ui-update__2026-09-02-1330.md` | PM |
| 規格 | 第四檔路線 spec（含 L0–L4 禁令） | `openspec/changes/add-vibe-route/specs/vibe-route/spec.md` | — |
| 範本 | unified PRD 範本 | `docs/TEMPLATE-prd-unified.md` | — |
| 上位文件 | Anchorline 產品 PRD v0.4.1 | `docs/PRD.md` | — |
| 設計 | v2 / v3 / v4 三版設計 HTML（含 `-raw`）與 `runs/` 產製紀錄 | `.aidesigner/`（已進 repo，596K） | AIDesigner |

## 13 驗收標準

| # | 驗收項目 | 預期結果 | 判定 |
|---|---|---|---|
| AC-01 | 建一份手動新建的草稿，把章節逐節寫滿 | `pct` 隨章節完成度上升；在 `gate.canSubmit === true`（L2 已亮）的前提下跨過 25，L4「實作」亮起。**單看 pct 不足以點亮 L4** | ☐ Pass ☐ Fail |
| AC-02 | 建一份 vibe 專案（3 節），把 3 節寫滿 | `pct` 分母是 3 不是 15，能達到 100% | ☐ Pass ☐ Fail |
| AC-03 | vibe 專案在 non-goals 為空時點一鍵自簽 | 被擋，訊息說明還差什麼，**不建立任何決策紀錄** | ☐ Pass ☐ Fail |
| AC-04 | vibe 專案送出正式審閱後，作者點一鍵自簽 | 被擋，且訊息**不引導使用者去抽單** | ☐ Pass ☐ Fail |
| AC-05 | 開啟 vibe 專案，點流程條 L2 | 判定說明寫「Non-Goals 至少 1 條」而非 3 條 | ☐ Pass ☐ Fail |
| AC-06 | 在 22 個頁面中隨機抽 5 頁，看常駐狀態條 | 都顯示路線，且顯示的是四檔中文名稱 | ☐ Pass ☐ Fail |
| AC-07 | 一個自簽過的 vibe 專案，開 `review.html` | 自簽關卡有專屬視覺語彙，與多方核准可一眼分辨 | ☐ Pass ☐ Fail |
| AC-08 | 未綁資料夾的專案，開單一專案總覽 | 整頁空狀態＋一個明確動作；**沒有**任何有資料狀態的元件同時出現 | ☐ Pass ☐ Fail |
| AC-09 | 用 Markdown 匯入與資料夾匯入各建一個專案 | 兩條路徑都問過路線，不再一律落成 Full | ☐ Pass ☐ Fail |
| AC-10 | 全 App 逐頁掃視 ＋ `git diff <phase1-base>..HEAD -- src '*.html' \| grep '^+' \| grep -nE '"[^"]*L[0-4][^"]*"'` | **新增行零命中**。既有內部 id（`l1`–`l6`）與程式註解不受此約束——現況全檔 `L[0-4]` 有 49 個命中，不設 diff 範圍就讀不出 pass/fail | ☐ Pass ☐ Fail |
| AC-11 | `git diff <phase1-base>..HEAD -- src shared.css '*.html' \| grep '^+' \| grep -nE 'https?://(cdn\|fonts)'` | **新增行零命中**。注意 `shared.css` 在 **repo 根**、不在 `src/` 下，pathspec 漏了它就驗不到最可能違反的檔案；現況 `docs/` 與 `landing*.html` 本來就有 15 處外部字體／CDN（非 App 頁面），不設 diff 範圍會全數誤報 | ☐ Pass ☐ Fail |
| AC-12 | 檢查本輪 `shared.css` 的 diff | 新增樣式**零**硬編 hex 與 px，全走既有 token | ☐ Pass ☐ Fail |
| AC-13 | 檢查本輪是否新增主題 | 未新增（`ThemeId` 仍是三值），因此未觸發 30 點註冊 | ☐ Pass ☐ Fail |
| AC-14 | `bunx tsc --noEmit` ＋ `bun test` | exit 0；測試數不低於 2132，0 fail | ☐ Pass ☐ Fail |
| AC-15 | Interceptor 真 Chrome 開 `localhost:5199`，逐頁截圖 | 版面在三段斷點（>1100 / 900–1100 / <900）都不破；`.route-grid` 斷點未被本輪改動 | ☐ Pass ☐ Fail |
| AC-16 | 設計截圖流程 | 用 `VerifyViewport.ts` 產出，非 `Capture.sh`（背景分頁會停整個 rendering lifecycle 且不報錯，拍出全白圖） | ☐ Pass ☐ Fail |

## 14 產品指標

⚠️ **本章的 GSM 埋點對本專案不成立，這是刻意的判斷不是省略。** `docs/PRD.md:229` 已明寫「GSM 埋點對單人本機工具不成立」；Anchorline 是本機優先的單人工具，沒有遙測、也不打算加。本章因此把「Metric」定義為**可機械查證的 repo 內訊號**（source-grep、測試、UAT 勾選結果），把「埋點事件」欄改記查證指令。

| 功能 | Goal（商業目標） | Signal（觀察得到的行為） | Metric（可量測數字） | 查證方式（取代埋點） |
|---|---|---|---|---|
| 常駐路線指示 | 讓「治理強度看得見」這個賣點在產品內成立，供 G0 顧問作品展示 | 使用者不必回編輯台就知道路線 | 路線可見頁面數 1 → 22 | `status-bar` 渲染測試 ＋ Interceptor 逐頁抽驗（AC-06） |
| 自簽事實可見 | 稽核鏈的說服力——一條看不見違規與例外的鏈沒有說服力 | 稽核時不必讀 comment 前綴就能分辨 | 有渲染的頁面數 0 → ≥ 2 | `git grep SELF_SIGN_NOTE -- src/pages` ＋ AC-07 |
| pct 推導 | 流程條講真話（否則整條治理鏈的可信度歸零） | L4 會在寫得完整時亮起 | 會說謊的格數 2 → 0 | `prd-progress.test.ts` / `flow-layer-detail.test.ts` ＋ AC-01/02/05 |
| 自簽守門 | 「治理降到最小但不歸零」是真的 | 空白 vibe 檔簽不掉 | 守門條數 5 → 7 | `signoff.test.ts` / `vibe-route-store.test.ts` ＋ AC-03/04 |
| 單一專案總覽改版 | ADHD-first：讓使用者面對的永遠是「改一句話」不是空白頁 | 打開總覽能立刻說出下一步 | **刻意不量化**（Scott 2026-09-02 拍板，Q-07） —— 無基準且無遙測 | 實機 UAT（AC-08）質性驗收；量表已決定不做，見 M-08 |
| 建案入口收斂 | 路線判定的覆蓋率有洞就等於沒有 | 匯入的專案不再莫名其妙有 15 節 | 經過判定的入口 1/3 → 3/3 | 匯入路徑測試 ＋ AC-09 |

**要反覆自問的一題**：路線可見頁面數從 1 拉到 22，使用者就真的更懂治理強度嗎？這個指標量的是「資訊有沒有露出」，不是「有沒有被讀懂」。後者只有實機 UAT 答得出來，而視覺類的東西機器測不到（`docs/PRD.md` AC-04）。**所以本輪不得用「22/22 達成」宣告成功**——那只是必要條件。

## 15 開放問題

| # | 問題 | 負責人 | 期限 | 狀態 |
|---|---|---|---|---|
| Q-01 | **P1-2 範圍**：v4 畫面 C 的正式多方簽核現行 code 沒有對應畫面 | Scott | — | ✅ **已拍板 (b)**（Scott 2026-09-02 拍板）：畫面 C 是 P2 之後的目標態，P1-2 只做自簽語彙。理由：塞進 P1 會讓工作量 M→L、Phase 1 交不出來 |
| Q-02 | **`changes_requested` 死碼去留**：P0-3 之後 `selfSignVibe` 的這條內層防線沒有情境走得到（要有 `changes_requested` 就得先送審，而送審就擋住自簽了）。留著當第二保險，還是移除？ | Scott | — | ✅ **已拍板：留**（Scott 2026-09-02 拍板）。目前用 source-grep 釘住，維持成本是零；刪掉才要承擔「以後真的走得到卻沒防線」的風險 |
| Q-03 | **缺口 #9 關卡層族系隔離**：同族系檢查**已實作於** `separationOfDuties()`（`signoff.ts:84-96`），但 `canSelfSign` 因為不接 `employees` 而沒有等價檢查。實務影響取決於「決策人換成人」算不算補償 | Scott | 本輪後 | ⏸️ **延後**（Scott 2026-09-02 拍板）：語意未定，但**不擋本輪**。動手前必須先拍板語意 |
| Q-04 | **匯入 pct 落差的文案**：匯入專案 pct 從舊的掃描分數 5–95 掉到個位數。數字誠實，但畫面上像「匯入之後專案倒退了」。需要一句「這是 PRD 章節完成度，不是資料夾齊備度」 | Scott | — | ✅ **已拍板**（Scott 2026-09-02 拍板）：放**匯入完成的 toast**，一句話帶過，不另開說明頁 |
| Q-05 | **設計產物（`.aidesigner/` 的 v2/v3/v4）要不要進 repo** | Scott | — | ✅ **已拍板：進**（Scott 2026-09-02 拍板）。596K（8 份 HTML ＋ `latest.json` ＋ `runs/`），已還原進工作樹並隨本次 commit 入庫。死連結的代價大於 596K |
| Q-06 | **本輪的時程、版本號與 Phase 排序**（含與併行 session P2 的交錯順序） | Scott | Phase 1 開工前 | 🔶 **部分拍板**（Scott 2026-09-02 拍板）：**只定 Phase 順序，日期不編**。理由：8 題 vibe UAT 尚未執行，此時定日期是假數字。第 9 章日期欄維持「待補」是刻意的 |
| Q-07 | **是否為本輪做質性量表**（NASA-TLX / QUIS 的認知構面） | Scott | — | ✅ **已拍板：不做**（Scott 2026-09-02 拍板）。單人自用工具做量表是儀式不是證據；總覽改版接受只有質性 UAT（AC-08）可驗收 |
| （追蹤） | **Q-13 升檔靜默改變關卡來源**（＝本線缺口 #10）：已由 spec-research 線 `project-anchorline-3b` 認領，追蹤點 `docs/PRD.md` §10 Q-13（commit `d8bcb15`），時程在 Scott 的 8 題 UAT 之後、`openspec archive add-vibe-route` 之前 | 3b 線 | UAT 後、archive 前 | **不歸本文件**，僅追蹤 |

> **Scott 2026-09-02 拍板：7 題已全部處理** —— 5 題定案（Q-01/02/04/05/07）、1 題部分定案（Q-06 只定順序不定日期）、1 題延後但不擋本輪（Q-03）。追蹤列不計入——它已有主人，列在這裡是為了避免兩條 session 各修一次。
>
> 本章保留原始問句與判定理由，不刪除已決項：**PRD 的價值在於後人看得到「為什麼這樣決定」，只留結論等於把理由丟掉。**
