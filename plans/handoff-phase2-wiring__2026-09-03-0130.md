# Handoff — Phase 2 後半：`dashboard.ts` 接線與空狀態

> **冷啟動用。新 session 的角色是 PM：不下海，只派子 agent。**
> 建立於 2026-09-03 01:30（Asia/Taipei）。
> 前一份 `plans/handoff-phase2-dashboard__2026-09-02-2214.md` 的 §3–§7 仍然有效（設計、判定、硬約束），
> **但它的派工席位與進度已過期**，以本檔為準。

---

## 0. 一分鐘進入狀況

| 項目 | 值 |
|---|---|
| 工作目錄 | `/Users/scottchen/Documents/20_Projects/Project_Anchorline`（**主 repo，不是 worktree**） |
| 分支 / HEAD | `main` @ `437d9d5` |
| 工作樹 | **乾淨** |
| 領先 origin | **19** 個 commit。⛔ **push 要問過 Scott** |
| 測試 / 型別 | `bun test` **2237 pass / 0 fail / 110 檔** · `bunx tsc --noEmit` **exit 0** |
| 設計與判定的上位 | `plans/handoff-phase2-dashboard__2026-09-02-2214.md` §3–§7（**仍然有效**） |
| class 名／API 契約 | `plans/p2-contract-classnames__2026-09-02.md`（**已 commit，硬契約**） |
| 需求上位 | `docs/PRD-app-ui-update.md` v0.3（§12 已補六缺陷判定表） |
| Dev server | `bunx vite --port <沒人用的埠> --strictPort`（⛔ 5173/5199 常被別的 checkout 佔） |

**一句話現況**：**Phase 2 的純函式層與樣式全部落地並 commit；只剩 `dashboard.ts` 接線與空狀態。**

---

## 1. 已完成（全部已 commit，PM 逐項跑指令複驗過）

| 塊 | 產出 | commit |
|---|---|---|
| P2-0 | `docs/PRD-app-ui-update.md` §12 六缺陷判定表 | `97748f7` |
| 契約 | `plans/p2-contract-classnames__2026-09-02.md` | `97748f7` |
| P2-1 | `shared.css`：`.gov-chain` / `.gc-*` 四態 / `.gc-ghost` / `.audit-trail-micro` / `.d-head*` / `.empty-state-layout` / `.d-grid--facts` | `97748f7` |
| P2-2a | `src/lib/gov-chain.ts` ＋ `tests/gov-chain.test.ts` | `97748f7` |
| P2-2b | `src/lib/plan-steps.ts` ＋ `tests/plan-steps.test.ts` ＋ `uat-pending.ts` 的 `planStepDirs` | `97748f7` |
| P2-2c-1 | `src/lib/dashboard-chain.ts` ＋ `tests/dashboard-chain.test.ts` | `437d9d5` |

**⚠️ 契約修正（已生效）**：事實卡列叫 **`.d-grid--facts`**，不是舊派工單寫的 `.d-facts`
—— 後者已被 `shared.css:8859` 的 `<dl>`（`display:flex` ＋ `dt`/`dd`）佔用，併用會撞 `display` 且不報錯。

---

## 2. 還沒做的（這份 handoff 的任務）

### P2-2c-2 · `dashboard.ts` 接線 — M，**必須單一 agent**

`dashboard.ts` 是 1476 行的單一 closure（全在 `requireAuth()` 的 `else {}` 裡）。
⛔ **不重構整檔**，整體外移是 L 級、不是本輪範圍。

**要做的**：

1. **`:642-658` 重寫組裝**，新骨架：
   ```
   <header class="d-head">            dashboardHeadHtml(name, chainHealthLine(stations))
   <ol class="gov-chain">             renderGovChainHtml(buildChainStations(buildDashboardChainInput(src)))
   <a class="d-uat-row">              跨專案實測列 —— **完全不動**
   <div class="d-grid d-grid--facts"> 降級事實卡（技術線 / 容量 / 工作區）
   <p class="d-measured">             measuredLineHtml(at, path)
   ```
2. **`:233-280`**：git 區塊降級成 l4 站的證據，不再是整頁第一眼
3. **`:539-565`**：`loadUatScan` 回傳已含 `planStepDirs`，用
   `hasPlanStepsFor(project.rootPath, scan.planStepDirs)` 算 `hasPlanSteps`
4. **`:696-771` 五分支**：本輪只要五個分支都不炸；**`:754-770` 量測中／失敗要從單行升級**
   —— 先畫頁首＋不需要磁碟的鏈（意圖／規格／交付可信），磁碟證據處寫「量測中…」。
   這是「一片黑」主訴求的直接修法，也讓失敗不再變成整頁空白
5. **R10 修正**：餵 `deriveFlowLayers` 一份專案限定的 state，照 `overview.ts:112-121` 的 `gateOf`：
   ```ts
   { ...st, sectionValues: st.projectSectionValues?.[p.id] ?? {}, sections: store.sectionsFor(p.id), activeProjectId: p.id }
   ```
   ＋ `store.gateSpecFor(p.id)`
6. **設計缺陷②**：「待核准的規格修訂」標題改成狀態驅動，自簽時寫「已自簽 · 未送正式審閱」

**寫法要求**：HTML producer 抽成「吃 plain data、回字串」的純函式（先例 `src/lib/focus-card.ts`），
`activeProject()` 在呼叫端取一次往下傳，副作用（`bindIdentEditing` / `addEventListener` /
`loadGovernance`）留在頁內。**全 repo 零 DOM 測試環境，不抽成純函式就測不到。**

### P2-3 · 空狀態 — M，**與 P2-2c-2 同一個 agent 或緊接其後**（同檔）

新增 `src/lib/dashboard-empty.ts` ＋ 測試，接 `:699-708` / `:709-731` / `:732-746` 三分支。
細節見前一份 handoff §3 與派工單「空狀態」表。三條必須有的測試：
- `no-folder` 輸出**不含** `d-card` / `d-grid` / `d-figure` /「量測」（AC-08 機器化）
- `no-folder` 輸出**仍含**身分與版號政策的次要連結（D-5 守門）
- `not-desktop` 輸出**不含** UAT rollup 任何字樣（假全清防線）

### P2-4 · 驗證 — S/M

```bash
bunx tsc --noEmit                     # exit 0
bun test                              # ≥ 2237，0 fail
git diff 437d9d5..HEAD -- src '*.html' | grep '^+' | grep -nE '"[^"]*L[0-4][^"]*"'          # AC-10 零命中
git diff 437d9d5..HEAD -- src shared.css '*.html' | grep '^+' | grep -nE 'https?://(cdn|fonts)'  # AC-11 零命中
```
⚠️ 兩條都**必須設 diff 範圍**（base = `437d9d5`）：不設會全數誤報。
⚠️ AC-11 的 pathspec 一定要含根目錄 `shared.css`（它不在 `src/` 下）。

Interceptor 真 Chrome：三段斷點（>1100 / 900–1100 / <900）版面不破；`.route-grid` 斷點未被改動。

---

## 3. 🔴 立即要補的兩個缺口（`dashboard-chain.ts` 留下的）

### ① 六個來源欄位沒有機器化執法者

`coverageLine` / `anchors` / `ungoverned` / `prdPct` / `branches` / `worktrees`
**曾經整批宣告了卻沒接進輸出**（型別強迫呼叫端算好餵進來，值進黑洞，
計劃站與實作站的微列少掉大半，**tsc 過、測試綠、畫面就是少東西**）。

現在實作已接上，但**是靠 PM 人工 `grep -c "src.<欄位>"` 查出來的，沒有測試守著**。
`tests/dashboard-chain.test.ts` 目前 6 條，全是既有的，防再犯斷言**沒寫**。

**要補**：每個來源欄位一條斷言證明它真的影響輸出，加上「值為 0／空字串時微列不含該條」
（不得出現「0 個」「0 條」）。

### ② `wsLine` 的 AND 判準可能太嚴

`dashboard-chain.ts:114-118`：
```ts
const wsLine = src.branches > 0 && src.worktrees > 0 ? `${src.branches} 條分支 · ${src.worktrees} 個 worktree` : "";
```
**3 條分支、0 個 worktree 會整列消失。** 多數專案沒有 worktree，等於這一列常態不出現。
判準待確認：應該是 OR、還是分開兩條微列。

---

## 4. 派工席位（Scott 2026-09-03 01:00 指示）

| 角色 | 誰 | 備註 |
|---|---|---|
| 編排 | 主 session | **不寫 code** |
| 實作 | **`grok`** 與 **`codex`** | Scott 明確點名，壓過 CLAUDE.md 的路由表 |
| 審查 | **待定** | ⚠️ 見下方 |

```bash
# codex —— 兩個坑都要避開
codex exec --dangerously-bypass-approvals-and-sandbox -c model_reasoning_effort=high \
  "$(cat <brief.md>)" < /dev/null > <log> 2>&1
```

⚠️ **codex headless 的兩個坑（本輪各踩一次）**：
1. **stdin 卡死** —— 背景執行給它一根 pipe，它會停在
   `Reading additional input from stdin...` 永遠不動。**一定要 `< /dev/null`**
2. **它會停下來要批准** —— 出一份「短設計」然後說「請確認後回覆『可以』」，
   headless 沒人回它就結束了（那一輪它只寫了測試、沒改實作）。
   **brief 第一行必須寫死**：「你是 headless 非互動模式，沒有人會回你。
   任何『請確認後回覆』都等於任務失敗。不要提出設計待確認，直接改檔、直接跑驗收、直接交件。」

⚠️ **grok（Bellows）的坑（CLAUDE.md 已記，本輪尚未實測）**：
`--worktree` 在 headless（`-p`）下**被靜默忽略** —— 不報錯、直接在當前分支作業，
還會去改 brief 明列的禁區檔案。**派它的單子必須把禁區檔案寫死，收回時逐檔 `git status` 核對。**

### ⚠️ 審查者要換人（未決，需 Scott 拍板）

`codex` 池原本**獨佔給 Cato 審查**。現在 codex 拿去實作了，而
**審查者不得是實作者** —— codex 與 grok 這一輪都不能審自己的東西。
兩條路：派沒參與本輪的席位（`general-purpose` + `opus`），或這輪不做跨廠商審查。
**這題要問 Scott。**

⛔ **不得用 `Engineer`**：強制 worktree 隔離，Bash 守門擋掉 `cd 別的 worktree` / `git -C`，
寫得出來卻編不了測不了。
⛔ **agent 一律不 commit、不 push。** commit 由 PM 收攏後問過 Scott。

---

## 5. 硬約束（每份 brief 都要整段複製）

1. UI **新增行**不得出現 `L0`–`L4` 字樣（既有內部 id `l1`–`l6` 與程式註解不受限）
2. 不得引入外部 CDN／字體／圖示庫（離線必須能跑的 Tauri app）
3. 新樣式**零硬編 hex 與 px**，一律走既有 token
4. **不新增主題。這個 repo 只有 3 個**：`kami` / `github` / `terminal`
   （`theme.ts:9-13`、`types.ts:5`）。新增一個要改四層共 30 個註冊點，漏改**不報錯只靜默回退**
5. 路線一律走 `projectRoute()`（`prd-triage.ts:137`），四檔中文名唯一權威來源是
   `PRD_ROUTES`（`prd-triage.ts:62-108`）。**不得再造第三份對照表**
6. **不得動 `.route-grid` 斷點**（`shared.css:15511/15520/15526`）—— 跨 session 接縫，
   且 `:15526` 混著 `.modal.modal-sheet > .body`，改它會誤傷 modal
7. **`shared.css` 新規則一律插在所延伸的既有 sibling 規則旁邊，禁止 append 檔尾**
8. 驗證一律 Interceptor 真 Chrome；截圖用 `VerifyViewport.ts`，**不用 `Capture.sh`**
9. ⛔ **不得對任何檔案下 `git checkout` / `git stash` / `git restore`**
   —— 這棵樹有其他 session 在寫（本輪 `docs/PRD.md` 就是別條線改的），還原動作會洗掉別人的工作
10. ⛔ **不碰 `onboarding.html` / `first-run-tour.ts` / `rail-nav.ts`** —— 併行線 `main-2` 的腹地

---

## 6. 派工單怎麼寫（本輪學到的，比席位選擇更重要）

**接線那一棒失敗了 5 次**（v4-pro 兩次 API server error、v4-flash 一次燒光 80 回合、
一次被 Scott 按停、codex 一次 stdin 卡死）。四塊純函式層全部一次過。差別在派工單的大小。

1. **把要讀的檔挖出來貼進 brief。** 上一輪 agent 燒光 80 回合在讀 `dashboard.ts`（1476 行），
   一個字沒寫。改成「⛔ 不要去讀 `dashboard.ts`，你需要的內容我已經摘在下面」之後就過了
2. **一份 brief 一個檔的產出。** `dashboard-chain.ts`（組裝）與 `dashboard.ts`（接線）拆開才過
3. **`--max-turns` 給 160**，不是 80
4. **brief 裡明寫「先寫檔，再驗證，不要先做全 repo 調查」**

---

## 7. 收尾條件與還沒收的線頭

**Phase 2 收工條件**：P2-2c-2 ＋ P2-3 ＋ P2-4 全過，＋ 跨廠商審查（審查者待定），
＋ 一份實機 UAT（走 `Uat` skill，整頁功能 8–15 題）。

**阻斷 push 的**：
- `add-vibe-route` 的 **8 題實機 UAT**（`plans/uat-第四檔路線「試作／探索」實測-2.md`）—— **Scott**
- main 領先 origin **19** 個 commit，push 要另外問過 Scott

**Phase 1 待辦**：實機 UAT 四題，含產品題（`review.html` 核准列預設收合 → 使用者預設看不到自簽標記）

**產品題**：
- `canSelfSign:835` 仍用純 log 判準，舊個案繞得過守門 →「一案一錨點」在舊資料上不是不變量
- `plans/anchorline__2026-09-02-1900__無外殼頁盤點.md` 的三個決定，**期限 2026-09-07**

**技術債（不阻斷）**：
- `signoffTimeline` 反推路徑用 `kind:"approve"`、log 路徑用 `"approved"` → 兩條路徑產生不同 CSS class
- `pages/signoff.ts:239` 另有一組手寫 `sg-log` 列，沒走 `timelineRowHtml`
- `dashboard-chain.ts` 的 `planStepDirsFrom` 註解寫「只認 kind === "plan"」，實際 code 是「排除 openspec」
  （行為正確 —— `kind` 是 optional —— 但兩者不同口徑）

**⛔ 明確不做**：引入 DOM 測試環境 · 缺口 #10/Q-13（歸 3b 線）· 缺口 #17（讓給併行線 P3）·
缺口 #16/#18 · v4 畫面 C · 新增主題 · 外部 CDN · L0–L4 進 UI ·
**不開新的 openspec change**（`openspec/` 歸 `3b` 線，且 `add-vibe-route` 尚未 archive）

---

## 8. 踩過的坑（別再踩）

1. **這個 repo 沒有原生 `<dialog>`** —— 全 repo 零命中，所有 modal 都是 `.modal-back` div。
   查 `dialog[open]` 一定拿到 `null`，會讓你誤判成「確認框沒跳出來」。**不報錯，只讓你多繞好幾輪**
2. **主題只有 3 個**，不是四個
3. **`.d-facts` 已被佔用** —— 新的事實卡列叫 `.d-grid--facts`
4. **埠會被別的 checkout 佔用**（5173/5199 都中過）
5. **不要採信 agent 的完成回報** —— 本輪三次抓到報告與 diff 不符：
   P2-1 說「只加註解」但刪掉了既有設計理由；`dashboard-chain.ts` 第一版說「全部驗收通過」
   但六個欄位沒接上；codex 說要補測試但只補了實作。**跑指令，不讀報告。**
6. **這棵樹有兩條 session 在寫。** 本輪 `docs/PRD.md` 是別條線改的，後來它自己 commit 了

---

## 9. 新 session 的第一個動作

1. 跑 `git log --oneline -3` ＋ `bun test` ＋ `bunx tsc --noEmit` 確認狀態與本檔一致
2. 讀 `src/lib/gov-chain.ts` 與 `src/lib/dashboard-chain.ts` 的**檔頭註解**（三個坑的理由寫在那裡）
3. 問 Scott §4 的審查者要換誰
4. 派 P2-2c-2（單一 agent，brief 照 §6 的四條寫）

---

*建立於 2026-09-03 01:30 · 所有數字由 PM 跑指令查證，非採信 agent 報告*
