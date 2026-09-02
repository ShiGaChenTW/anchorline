# Handoff — Anchorline 全 App 介面改版（Phase 1 完成待 commit）

> 冷啟動用。新 session 的角色是 **PM：不下海，只派子 agent**。
> 建立於 2026-09-02 21:34（Asia/Taipei）。上一段 session 已達 1.6 MB，故切換。
> 前一份是 `plans/handoff-app-ui-update__2026-09-02-1620.md`（**已完成，可只當史料**）。

---

## 0. 一分鐘進入狀況

| 項目 | 值 |
|---|---|
| 工作目錄 | `/Users/scottchen/Documents/20_Projects/Project_Anchorline`（**主 repo，不是 worktree**） |
| 分支 / HEAD | `main` @ `72e8310` |
| 領先 origin | **14** 個 commit。⛔ **push 要問過 Scott** |
| 工作樹 | **20 個檔案未 commit**（Phase 1 全部成果 + §4.1 回修，`+777/−61`） |
| 主計劃書 | `Plans/plans-handoff-app-ui-update-2026-09-02-breezy-boot.md`（派工單，Phase 2/3 在裡面） |
| 需求來源（上位） | `docs/PRD-app-ui-update.md` **v0.3** |
| Dev server | `bunx vite --port <沒人用的埠> --strictPort`（⛔ 5173/5199 常被別的 checkout 佔） |

**一句話現況**：**Phase 1 五塊全部完成、跨廠商審查過關（APPROVE_WITH_NITS）、尚未 commit。**
§4.1 的 warning 回修＋doc 修正**已於 21:50 完成並複驗**，現在可以問 Scott 要不要 commit。

---

## 1. ⚠️ 派工規則已變更（2026-09-02 21:46，Scott 指示 — 第二版）

**實作席位：`command-code` CLI 跑 `deepseek/deepseek-v4-flash`，取代 Forge（codex）。**
Bellows（grok）保留為第二實作席。**codex 池從此只供 Cato 審查**，先前
「Forge 與 Cato 搶同一個池」的衝突消失了。

| 角色 | 誰 | 備註 |
|---|---|---|
| 編排 | 主 session（Claude Code） | **不寫 code** |
| 實作（主） | **`command-code` + `deepseek/deepseek-v4-flash`** | 本機 CLI，獨立帳號池（ShiGaChenTW） |
| 實作（備） | **Bellows**（grok） | xAI 週配額，3% used，reset 2026-09-09 |
| 審查 | **Cato**（codex，read-only） | 審查者不得是實作者；codex 池獨佔 |

### `command-code` 派工指令（headless）

```bash
command-code -p "$(cat <brief.md>)" \
  -m deepseek/deepseek-v4-flash \
  --yolo -t --tools-all --max-turns 60 -n "<session-name>"
```

- `-p` = 非互動；`--yolo` 跳過權限提示；`-t` 自動信任專案；`--tools-all` 打開 headless
  預設扣住的工具（不加會少掉寫檔工具）。
- ⛔ **不要帶 `-w/--worktree`** —— 本 repo 慣例是實作直接在 main 工作樹。
- 模型清單 `command-code --list-models`；`deepseek-v4-flash` 本身就是它的預設模型。
- 認證：`command-code status`（已登入 ShiGaChenTW，Provider: Command Code）。

### 席位硬限制（會決定你怎麼切任務）

- **Bellows**：本機 `grok` CLI，`--worktree` 是**原生隔離**。本 repo 慣例是
  「實作直接在 main 工作樹，不開 worktree、不 commit、不 push」——
  派它時**不要**帶 `--worktree`，否則它在隔離樹裡改，改動回不到 main 工作樹。
- ⛔ **Forge（codex）退出實作** —— codex 池留給 Cato。Scott 點名才出場。
- ⛔ **不要用 `Engineer`** —— 強制 worktree 隔離，Bash 守門擋掉 `cd 別的 worktree` / `git -C`，
  寫得出來卻編不了測不了（2026-08-30 實測空燒 8 萬 token）。
- ⛔ **agent 一律不 commit、不 push。** commit 由 PM 收攏後問過 Scott。

---

## 2. Phase 1 五塊，全部完工並經 PM 獨立複驗

⚠️ **複驗全部是 PM 自己跑指令，不是採信 agent 報告。**

| 塊 | 做了什麼 | 落點 |
|---|---|---|
| **A** | 常駐狀態條加四檔路線籤；刪掉「結構可送審」這句假話 | 新檔 `status-bar-view.ts`(94)、`status-bar.ts` |
| **B1** | 自簽判讀收編成 6 支 helper（純重構） | `signoff.ts`、`store.ts` |
| **B2a** | 關卡列＋時間軸自簽語彙；不再原樣印內部 join key | `signoff-stages.ts`、`signoff.ts`、新檔 `signoff-log.ts`(44)、`pages/signoff.ts` |
| **B2b** | review 頁核准卡片抽純函式＋自簽標記 | 新檔 `approval-strip.ts`(116)、`pages/review.ts` |
| **B3** | 修掉頭條謊話「尚未送審」 | `signoff.ts` 的 `signoffSummary` |

**最終實測**：`bunx tsc --noEmit` **exit 0**、`bun test` **2210 pass / 0 fail / 107 檔**
（基線 2132 / 105 → **+78 條測試**）。

**硬約束複驗全零**：`shared.css` 新增行 hex/px · `.route-grid` · 新增行 `L0`–`L4`（含三個新檔）·
外部 URL · 「結構可送審」· `startsWith(SELF_SIGN_NOTE)` 仍只剩 `signoff.ts` 內一處。

---

## 3. 跨廠商審查（Cato）—— 這是本輪最有價值的一段

**第一輪：REQUEST_CHANGES，兩個 P0，都是這輪自己種的，PM 已逐條跑指令查證屬實。**

| # | 問題 | 根因 |
|---|---|---|
| **P0-1** | vibe → 一鍵自簽 → 改路線升檔轉正後，頭條仍說「已自簽 —— 尚未進入正式審閱」，細節變成「自簽已核准 **0**/N 關」 | `setProjectRoute`（`store.ts:2038-2050`）重設自簽關卡為 `pending` 但**刻意保留 log**；B3 的判定讀 log → 仍 true，`approved` 從當下 state 現算 → 0。**`log` 是 append-only 歷史，`approved` 是現況投影，兩個時態被組進同一句話** |
| **P0-2** | 同一個個案在同一頁得到三種答案 | `caseHasSelfSign` 用 `if (c.log)`（`[]` truthy）、`signoffTimeline` 用 `c?.log?.length`，而 `load():894` 正規化成 `[]` |

**回修方式（已完成）**：把兩個時態拆成兩支**有名字**的 helper —

- `caseHasSelfSign`（讀 log）＝ **歷史上自簽過嗎** → 時間軸用它
- `caseHoldsSelfSign`（讀 stages，新增）＝ **現在仍掛著自簽核准嗎** → 頭條用它

**第二輪複審：APPROVE_WITH_NITS，兩個 P0 都確認關閉。**
Cato 驗了「`setProjectRoute` 是唯一核准移除點且掃全部 stages，無殘留路徑」與
「三支 reader 現在同一判準」，也確認 `store.ts` 的兩個 hunk 是等價替換、沒夾帶行為改變。

**回修時改了 2 條既有測試斷言** —— PM 逐條看過，**原本釘住的正是那兩個 bug 行為**，改是對的，
且另加一條擋近似解（「升檔後只剩正式核准 —— 仍然不說已自簽」）。

---

## 4. 下一步（照順序）

### 4.1 ✅ 已完成（2026-09-02 21:50）：Cato 複審開的 warning 已回修

由 `command-code` + `deepseek/deepseek-v4-flash` 實作，PM 自己跑指令複驗（非採信回報）。

- `SELF_SIGN_DRAFT_DETAIL` 分子改成 `selfApproved`＝`rows.filter(r => isSelfSignStage(r.stage)).length`
  （`signoff.ts:490`），與 `total` 數在同一份 `rows` 投影上；呼叫點 `:558`；參數改名 + doc 更新 `:462-475`
- 新測試 `tests/signoff.test.ts:272`「1 關自簽 approved ＋ 2 關別人簽的 approved → 細節說 1/3，不是 3/3」，
  另斷言 `s.approved` 仍是 3（回傳欄位語意不變，只改細節句的分子）
- `caseHasSelfSign` doc `:729`「變寬」→「變嚴」（方向寫反）已修
- **複驗**：`bunx tsc --noEmit` exit 0；`bun test` **2211 pass / 0 fail / 107 檔**（基線 2210 → +1）
- 既有斷言零更動；本輪只動 `src/lib/signoff.ts` 與 `tests/signoff.test.ts`（`git status` 檔案集合與修前相同）

### 4.2 Phase 1 的實機 UAT（走 `Uat` skill）

**必出的題**（來自 agent 自承沒實機走過的部分）：

1. **按下自簽鈕之後畫面真的長這樣** —— B2a 的視覺驗證是直接寫 localStorage 造狀態，不是走 `selfSignVibe()`
2. **`review.html` 的核准列預設是收合的**（`<details class="review-approvals-wrap">`，`review.html:113`，
   開合不持久化）→ **使用者預設看不到新的自簽標記**。這是產品題（vibe／自簽個案要不要預設展開），要 Scott 拍板
3. 三主題（`kami`/`github`/`terminal`）下自簽底紋與徽章的可辨識度
4. 升檔轉正後的頭條（P0-1 的迴歸）

### 4.3 commit（問過 Scott）→ 之後才是 push（另外再問）

push 前置未解：`add-vibe-route` 的 **8 題實機 UAT 仍待 Scott**
（`plans/uat-第四檔路線「試作／探索」實測-2.md`）。

### 4.4 Phase 2 / Phase 3

完整派工單在 `Plans/plans-handoff-app-ui-update-2026-09-02-breezy-boot.md`，這裡不重複。
Phase 2 = 單一專案總覽以治理鏈為骨架重畫；Phase 3 = 建案入口補到 4/4。
⚠️ **P3 開工前必須先敲併行線**（見 §7）。

---

## 5. 硬約束（每個 agent 的 brief 都要複製這段）

1. UI **新增行**不得出現 `L0`–`L4` 字樣（既有內部 id `l1`–`l6` 與程式註解不受限）
2. 不得引入外部 CDN／字體／圖示庫（離線必須能跑的 Tauri app）
3. 新樣式**零硬編 hex 與 px**，一律走既有 token
4. **不新增主題。這個 repo 只有 3 個**：`kami` / `github` / `terminal`
   （`theme.ts:9-13`、`types.ts:5`）。⚠️ **前一份 handoff 寫「四個主題」是錯的**，
   PM 還把錯的抄進了兩份 brief，兩個 agent 各自獨立回報矛盾才抓到。**PRD v0.3 本來就是對的**
5. 路線一律走 `projectRoute()`（`prd-triage.ts:137`），四檔中文名唯一權威來源是
   `PRD_ROUTES`（`prd-triage.ts:62-108`）。**不得再造第三份對照表**
6. **不得動 `.route-grid` 斷點**（`shared.css:15511/15520/15526`）—— 跨 session 接縫，
   且 `:15526` 混著 `.modal.modal-sheet > .body`，改它會誤傷 modal
7. **`shared.css` 新規則一律插在所延伸的既有 sibling 規則旁邊，禁止 append 檔尾**
   —— 多 agent 並行時這是唯一的防撞規則
8. 驗證一律 Interceptor 真 Chrome；截圖用 `VerifyViewport.ts`，**不用 `Capture.sh`**
   （背景分頁會停整個 rendering lifecycle —— rAF / IntersectionObserver / transition 全停，
   **不報錯**，拍出全白圖）

### 測試架構（決定了寫法，不是建議）

**全 repo 零 DOM 測試環境** —— 無 happy-dom、無 GlobalRegistrator，107 個測試檔全是
`bun:test` 純函式 + HTML 字串比對。
→ **新 UI 程式碼必須寫成「吃 plain data、回字串」的純函式，否則測不到。**
本輪**不引入** DOM 測試環境（那是併行線的 P0 建議 #2，L 級，另案）。

---

## 6. 專案內規則已補三條（`CLAUDE.md`，本段 session 新增）

1. **這個 repo 沒有原生 `<dialog>`** —— 全 repo 零命中。`askConfirm()`（`src/lib/ask.ts:122`）
   與所有 modal 都是 `.modal-back` div。查 `dialog[open]` 一定拿到 `null`，
   會讓你誤判成「確認框沒跳出來」。**這條不報錯，只讓你多繞好幾輪**（B3 實際踩到）
2. **主題只有 3 個**（同硬約束 4）
3. 驗證要用自己的 dev server（既有）

---

## 7. 跨 session 接縫（重要）

主 repo 上另有併行 session：`main-2`（工作在 `~/orca/workspaces/Project_Anchorline/main-2`），
做介面改版的另一半（首啟一題＋導航漸進揭露）。

- 我方落點：`status-bar.ts`（**短期獨佔**）、`shared.css`（狀態條／自簽／治理鏈三區段）、
  `dashboard.ts`、`review.ts`、`signoff*.ts`
- **`.route-grid` 斷點是兩線接縫**，任一方要動先知會 —— 我方 Phase 1／2 都不動
- 對方 P2 會碰 `onboarding.html` / `first-run-tour.ts` / `rail-nav.ts`，**正是我方 Phase 3 腹地**。
  **P3 開工前必須先敲對方**
- ⛔ **不要對 `main-2` worktree 做任何寫入**
- ⚠️ **SendMessage 傳不過去**（2026-09-02 16:0x 試過，卡在對方核准佇列過期）。
  接縫協議寫進 handoff 與 `PROJECTS.md` 比較可靠
- ⛔ **不開新的 openspec change** —— `openspec/` 歸 `3b` 線，且 `add-vibe-route` 尚未 archive

---

## 8. 已拍板，不要重開

- Phase 順序 **P1 → P2 → P3**；P3 做到 **4/4**，agent handoff 從內容推導路線（不彈窗）
- 四檔路線條 = **唯讀指示器**（不做切換入口）—— code 裡三種點擊行為完全不同
- 自簽**不推進** `status` / `pct`（SPEC-03）；`signoffCta` 不新增升檔按鈕（SPEC-05）
- **`setProjectRoute` 離開 vibe 時保留 log** 是拍板過的 spec（可 replay 的錨點紀錄），**不要「修」它**
- 空狀態＝**空狀態＋跨專案實測列**，身分卡與版號政策卡去殼改成輕量文字連結
- Q-01 選 (b)：v4 畫面 C 的正式多方簽核關卡表是 P2 之後的目標態
- Q-05：設計產物**進 repo**（`.aidesigner/`）· Q-07：**不做**質性量表

### 明確不做

引入 DOM 測試環境 · 缺口 #10/Q-13（歸 3b 線）· 缺口 #17（讓給併行線 P3）· 缺口 #16/#18 ·
v4 畫面 C · 新增主題 · 外部 CDN · L0–L4 進 UI · 雙進度曲線

---

## 9. 還沒收的線頭

**阻斷 commit 的**：
- ~~§4.1 的 warning 回修~~ ✅ 已完成 2026-09-02 21:50。**目前沒有阻斷 commit 的線頭。**

**技術債（都有明確歸屬，不阻斷）**：
- `signoffTimeline` 反推路徑用 `kind:"approve"`，log 路徑用 `"approved"` —— 同一件事兩個值，
  而 `timelineRowHtml` 的 class 是 `sg-log--${kind}` → **兩條路徑產生不同 CSS class**。
  下一個「同頁兩種答案」的候選
- `canSelfSign:835` 仍用純 log 判準（第三種）。舊個案（`log:[]` 但 stages 有戳記）
  繞得過「已自簽過」守門，可再鑄一個錨點 → **「一案一錨點」在舊資料上不是不變量**。產品題
- `approvalStripHtml` 的 `selfSigned` 參數吃到的是歷史語意（`review.ts:444` 傳 `caseHasSelfSign`）。
  **行為正確**（徽章集合逐關重算），但參數 doc 說「兩個證人」而實際一個問歷史一個問現況。
  建議改傳 `caseHoldsSelfSign`
- `pages/signoff.ts:239` 另有一組**手寫 `sg-log` 列**（PRD 版本清單），沒走 `timelineRowHtml`
- `review.ts` 頂端流程條印 `L1 意圖 … L6 交付`（**既有行，不違反硬約束 1**，只管新增行）
- `syncApprovalsFromActiveCase()` 只同步 active 個案 → 非 active 專案的 `state.approvals` 是舊的

**Scott 待辦（非本線可推進）**：
- `add-vibe-route` 的 **8 題實機 UAT**（`plans/uat-第四檔路線「試作／探索」實測-2.md`）—— push 前置
- `plans/anchorline__2026-09-02-1900__無外殼頁盤點.md` 的三個決定，**期限 2026-09-07**
  （`landing.html` 去留 / `landing-aid.html` 刪不刪 / 補不補「17 頁該有外殼」的測試）
- main 領先 origin **14** 個 commit，全部未 push

---

## 10. 踩過的坑（別再踩）

1. **Cato 會撞回合上限空手回來**（前一輪撞兩次、零產出）。解法已驗證有效：
   **把待審 diff 打包成單一檔案**放 scratchpad，brief 裡寫「最多跑 3 個工具、先出判定再補證據、
   空手回來比讀完再回來糟糕得多」。這樣兩次都在 3 個工具內交件。
2. **subagent 會共用主 session 的 Anthropic 池** —— 2026-09-02 16:5x 兩個 agent 同時 429
   空手死掉（session limit）。工作樹零損傷，但白等一輪。**這正是改派 codex/grok 的理由之一。**
3. **`refine_design` 會靜默刪掉你沒提到的既有元素**（v3→v4 掉了 5 個）。每輪跑反向比對。
4. **AIDesigner canvas pipeline 會自己注入 `<script src="https://cdn.tailwindcss.com">`**，
   違反硬約束 2。每次檢查並移除，原檔另存 `-raw.html`。
5. **埠會被別的 checkout 佔用**（5173/5199 都中過）。派工前指定一個沒人用的埠。

---

*建立於 2026-09-02 21:34 · 所有數字與判定皆由 PM 跑指令查證，非採信 agent 報告*
