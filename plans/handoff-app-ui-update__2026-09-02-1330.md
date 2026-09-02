# Handoff — Anchorline 全 App 介面更新計劃

> 冷啟動用。新 session 的角色是 **PM**：收 Cato 審查結果 → 決定 commit → 進 Phase 1。
> 建立於 2026-09-02 13:30（Asia/Taipei）。上一段 session 已達 5.7 MB，故切換。

---

## 0. 一分鐘進入狀況

| 項目 | 值 |
|---|---|
| 工作目錄 | `/Users/scottchen/orca/workspaces/Project_Anchorline/tiamat`（**worktree，不要 cd 回主 repo**） |
| 分支 / HEAD | `redesign-ui-aidesigner` @ `6dcd5c9`（已 fast-forward 對齊 main） |
| 退回點 | `git reset --hard e1b413ce8e5e37cdd9e17abdd9190aa70a870438` |
| Dev server | `bunx vite --port 5199 --strictPort`（**不要 5173**，那是主 repo） |
| 主計劃書 | `plans/Anchorline__2026-09-02-1221__app-ui-update.md` ← **先讀這份** |
| 架構調查（18 缺口） | `plans/A-新增專案架構調查__2026-09-02.md` |
| 設計採用案 | `.aidesigner/mcp-latest-v4.html` · `~/Downloads/aid-dashboard-design-v4.png` |
| AIDesigner 額度 | 84 credits |

---

## 1. 現在的狀態

### 已完成

- **worktree fast-forward** `e1b413c` → `6dcd5c9`（純 ff，零自有 commit）。原本落後 3 個 commit，
  路線系統的 `prd-triage.ts` / `prd-file.ts` / `prd-selfcheck.ts` 在舊 HEAD 根本不存在。
- **A agent 架構調查**：18 項缺口，必做 6 / 該做 8 / 可延 4。
- **設計 v2 → v3 → v4**：v4 有三個畫面（A 自簽 · C 正式多方簽核 · B 空狀態）。
- **Phase 0 四題實作完成（C agent）**，改動**在工作樹、未 commit**：
  - `bunx tsc --noEmit` exit 0
  - `bun test` **2124 pass / 0 fail**（改動前 2098，+26）
  - `git diff --stat` 7 檔 324 insertions ＋ 2 個未追蹤新檔
    （`src/lib/prd-progress.ts` 61 行、`tests/prd-progress.test.ts` 229 行）

- **Cato 跨廠商審查完成 → `ship_with_fixes`，無 critical。**
  ⚠️ 它撞了**兩次** 5 回合上限、零產出，第三次下令「最多再跑 1 個工具，立刻輸出」才交件。
  **教訓：Cato 會把回合全燒在讀檔。派它時就要給落點行號清單＋優先序＋「先出結論再補證據」。**

  兩項治理守門**通過敵意檢查**：gate 算在正確的專案上（沒照抄 active 的資料）、
  自簽**沒有第二寫入入口**（全 repo 只有 `store.selfSignVibe` 會寫 `SELF_SIGN_NOTE`，唯一呼叫端 `editor.ts:1576`）。

  四個 finding（**PM 已親自複驗前兩個**）：

  | # | 級別 | 問題 |
  |---|---|---|
  | 1 | high | `signoff.ts:658` 的錯誤訊息叫使用者「先抽單再自簽」，但 `:665` 的 `c?.withdrawn` 會擋掉 —— **那條路 100% 失敗**。`:653-654` 的註解也與行為矛盾。**C agent 原本回報「抽單後仍可自簽，有測試」是錯的。** |
  | 2 | medium | `tests/signoff.test.ts`「抽單之後又可以自簽」組出 `status="withdrawn"` 但 `case.withdrawn=false` 的**不可達狀態** —— 死測試 |
  | 3 | medium | `store.ts:613` 的 `migrateProject` 原樣讀回 `raw.pct` 不重算；`seed.ts` 寫死 82/41/18/67/74/29/72/34 → **既有使用者的 L4 照樣不亮，修完等於沒修** |
  | 4 | low | 空白 vibe 自簽被擋時訊息前後半句打架：「PRD 還沒開始（2 個必填章節）— 請先補齊 BLOCK 項再自簽」 |

- **四個 finding 已全部修完（E agent）**。Finding 1 採「不放寬守門、只修說謊文案與矛盾註解」
  —— 進了正式審閱流程就不該退回「作者自己核准自己」，維持嚴格是正確的治理姿態。
  E 加碼一條：Cato 只點名 `load()` 與 seed 兩條 pct 移轉路徑，E 補上 `importState()`
  （理由：`store.ts` 自己的註解記載 `withMigratedBackends` 當年就漏掉這條）。
  **E 證明了那條死測試是死的** —— 把守門刪掉後新測試紅、死測試照樣綠。

  **現況：`tsc` exit 0、`bun test` 2132 pass / 0 fail（原始基線 2098，+34）。仍未 commit。**

### 唯一待辦：Scott 拍板要不要 commit

本地分支 commit，**不 push**（push 要等 Scott 的 8 題 vibe UAT，且 main 已領先 origin 5 個）。

### 跨 session 協調：已全部收斂（2026-09-02 下午）

F agent 交叉比對對方兩份新文件後，雙方通訊四輪，結果：

| 項目 | 結果 |
|---|---|
| `status-bar.ts` | ✅ **短期歸我方獨佔**。對方線頭 #8 未拍板、不動此檔。**P1-1 直接把「結構可送審」文案一起改，不用等對方**；開工前敲一聲拿 #8 的修正方向 |
| 缺口 #10（升檔靜默改變關卡來源） | ✅ **對方認領**，立為 PRD 開放問題 **Q-13**。**本計劃不做** |
| `plans/` 重整 | 對方開工前必敲我方，方案含**改名對照表** |
| `prd-gates.ts` | 對方已記錄「`SECTION_SUBSTANCE_MIN` 不對齊 gate 門檻是我方設計決策」，不會當 bug 修 |
| `CLAUDE.md` 慣例搬家 | 搬家 commit 會附新舊段落對照 |
| 對方已修（我方 F 抓到） | `docs/PRD.md` §4 補上四檔（v0.4.1）；prior-art 的 NOASSERTION 論述改寫 |
| 對方的 rebase 顧慮 | ✅ **已撤回** —— 我方 base 就是 `6dcd5c9`，Phase 0 本來就寫在對方改過之後的那三支上 |

✅ **第三條 session 的疑慮已解**（原記於對方 `prior-art:443`「待 Scott 確認是否關掉」）：
`project-anchorline-3b` 是**活的、合法的 spec-research 線**。主 repo 現有**兩條寫入線** ——
`project-anchorline-91` 只動 `docs/` 與 `plans/`，`3b` 動 `docs/` 與 `openspec/`。
**兩條都不動 `src/`**，我方 monitor 看到的主 repo 變動都來自這兩條，不需要關掉任何一條。

Q-13 歸屬**雙方已對齊**（兩條 session 一度講反，現已確認歸 `3b`）：
追蹤點 `docs/PRD.md` §10 Q-13（已 commit `d8bcb15`），時程在 Scott 的 8 題 UAT 之後、
`openspec archive add-vibe-route` 之前，行為選項由 Scott 拍板後 3b 實作。
**我方 Phase 0 的自簽 gate 不需要順手補這個洞。**

**F agent 糾正過 PM 的三處說法（皆已複驗屬實）**：main 已到 `9555e93`（比 `6dcd5c9` 多兩個
**純 docs、零 `src/`** 的 commit，故不需再 ff）；main 領先 origin **5** 個不是 3；
E agent **沒有**動 `prd-gates.ts`。

**已知但刻意不修**：`tests/flow-layer-detail.test.ts:65/66/136/139` 有四條寫死字串的斷言
（「4 道 BLOCK」「Non-Goals 至少 3 條」）。對方建議 [15] 改 gate 權重時會紅 ——
**那正是想要的行為**，gate 規則變動時該有人回頭看文案。真正動態的那條（`:134`
`toBe(l2PassWhenText(VIBE_GATE_SPEC))`）已從 spec 反查，無脆弱性。

---

## 2. Phase 0 改了什麼（Cato 若給出 finding，對照這裡）

| 題 | 需求 | 落點 |
|---|---|---|
| P0-1 | `Project.pct` 由章節完成度推導（分母隨路線變，不得寫死） | 新檔 `src/lib/prd-progress.ts`；`store.ts` 的 `derivedPctFor`/`syncDerivedPct`，掛在 `touchProjectMeta()`；建案與兩條匯入路徑的寫死值改 `pct: 0` 佔位 |
| P0-2 | 一鍵自簽必須呼叫 `evaluatePrdGates` | `store.ts:2065-2086`。**沒照抄 active 專案的資料**（照抄會在非 active 專案上拿別人的內容評分），用 `overview.ts` 的 `gateOf` 寫法 |
| P0-3 | 自簽擋 `status === "review"` | `signoff.ts:655-664`，放在路線檢查之後、`withdrawn` 之前。抽單後仍可自簽（有測試） |
| P0-4 | `l2.passWhen` 依路線產生 | `flow-layers.ts:99-208`。條數數 spec、門檻讀 `bullets.min` |

**「有實質內容」= 每節欄位 trim 後字數相加 ≥ 12**（`SECTION_SUBSTANCE_MIN`）。
刻意**不對齊 gate 門檻** —— gate 答「合格沒」、pct 答「進行到哪」；借 gate 的數字會讓進度條
在使用者把每節補到合格前一路停在 0，那只是換一種方式讓 L4 不亮。

C agent 每條測試都做過「還原成舊行為 → 看它紅」的實測，報告附了各自 fail 數。

---

## 3. 下一步（照順序）

1. **收 Cato 的結論**。`verdict` 是 `ship` / `ship_with_fixes` / `block`。
   有 critical 就先修再談 commit —— 前一輪 Cato 在同一條自簽路徑抓過兩個 critical。
2. **問過 Scott 再 commit**。本 repo 不在「免詢問」名單內（那只有 `~/.claude` 與他指定的工作 repo）。
   **push 一定要問**：main 現領先 origin 3 commit，且 push 要等 Scott 的 8 題 vibe UAT。
3. **進 Phase 1**（路線進常駐狀態條、自簽事實在 review/signoff 頁可見）。細節見主計劃書。

---

## 4. 待 Scott 拍板（4 題，全部不急）

1. **P1-2 範圍** —— v4 畫面 C 描繪的正式簽核（關卡表＋順序閘門＋職責分離）**現行 code 沒有對應畫面**：
   `review.html` / `signoff.html` 完全不認得 route（`git grep prd-triage` 只命中 5 檔，不含這兩頁）。
   選 (a) P1-2 一併把關卡表落到 `review.html`（M→L），或 (b) 明說畫面 C 是 P2 之後的目標態。
2. **`changes_requested` 死碼** —— P0-3 之後 `selfSignVibe` 的這條內層防線沒有情境走得到
   （要有 `changes_requested` 就得先送審，而送審就擋住自簽了）。留著當第二保險，還是移除？
   目前用 source-grep 釘住，免得它變成刪掉也不會紅的死碼。
3. **缺口 #9 關卡層族系隔離** —— `canSelfSign` 仍沒有「這一關的執行者與作者同族系」那條
   （`signoff.ts:84-96`），因為它不接 `employees`。A 報告說「需先拍板語意」。
4. **匯入 pct 落差的文案** —— 匯入專案 pct 從舊的掃描分數 5–95 掉到個位數。數字誠實，
   但畫面上像「匯入之後專案倒退了」。需要一句「這是 PRD 章節完成度，不是資料夾齊備度」。

---

## 5. 已拍板（不要重開）

- 四檔路線條 = **唯讀指示器**（不做切換入口）。升檔入口只有 Sign-off 卡那顆「轉為正規路線並送正式簽核」。
- **補畫面 C**（正式多方簽核）—— 已完成。
- 畫面 B **兩刀照下** —— 已完成，235 → 145 漢字。
- 自簽**不推進** `status` / `pct` —— 維持現況語意。

## 6. 硬約束（每一輪都要守）

- 🔴 **UI 任何地方不得出現 `L0`–`L4` 檔位編號**
  （`openspec/changes/add-vibe-route/specs/vibe-route/spec.md:8` 明文，UAT 驗收條件）。
  既有的 L1–L6 流程層是另一回事。
- **不得引入外部 CDN／字體／圖示庫** —— 本機優先的 Tauri app，離線必須能跑。
- **一律用既有 token**（`--accent` / `--surface` / `--border` / `--fs-*` / `--radius-*`），不得硬編 hex 或 px。
- **若新增主題要改四層 30 個點**（`shared.css` / 14 份 HTML head 的防閃爍 bootstrap / `theme.ts` / `types.ts`，
  每份 bootstrap 內還有 `if(!m[t])` 與 `catch` 兩條退路）。漏改**不報錯，會靜默回退**。本輪不新增主題就碰不到。
- 驗證一律走 Interceptor 真 Chrome，**5199 埠**。
- 設計截圖**必須用 `VerifyViewport.ts`，不要用 `Capture.sh`** —— 背景分頁會停整個 rendering
  lifecycle（rAF / IntersectionObserver / transition 全停，**不報錯**），會拍出全白圖。

---

## 7. 跨 session 接縫（重要）

主 repo `~/Documents/20_Projects/Project_Anchorline` 上有**另外兩條 Claude session**，
做的是同一條 vibe route 線（`add-vibe-route`，已 commit 為 `6dcd5c9`，等 Scott 的 8 題 UAT 才 push）。

**已立的協議（也寫進 `~/.claude/LIFEOS/USER/PROJECTS/PROJECTS.md` 的 Anchorline 條目）：**

- 我方落點：`shared.css`（卡片／焦點卡／間距 token）＋ `src/pages/dashboard.ts`
- **`.route-grid` 斷點（4 欄 / 1100px / 900px）是兩線接縫**，任一方要動先知會對方
- 對方的 P2 會碰 `onboarding.html` / `first-run-tour.ts` / `rail-nav.ts`，開工前會敲我方
- 對方短期只 commit `docs/` 與 `openspec/`，不動 `src/` 與 HTML

⛔ **不要對主 repo 做任何寫入**（不 fetch / checkout / merge / stash）。純讀用
`git --git-dir=/Users/scottchen/Documents/20_Projects/Project_Anchorline/.git show <sha>:<path>`。

---

## 8. 兩個踩過的坑（別再踩）

1. **`refine_design` 會靜默刪掉你沒提到的既有元素。** v3→v4 那輪掉了 5 個，包括拍板要保留的
   「轉為正規路線並送正式簽核」按鈕。**每輪都要跑「v(n-1) 有、v(n) 沒有」的字串反向比對**，
   不能只驗新需求有沒有做到。
2. **AIDesigner 的 canvas pipeline 會自己注入 `<script src="https://cdn.tailwindcss.com">`** 貼在
   `</head>` 上（v2、v3、v4 三次都中）。它的 `.gap-*` 會蓋掉設計自己的間距把版面撐爆。
   **每次都要檢查並移除**，原檔另存 `-raw.html`。

## 9. 還沒收的線頭

- Phase 0 未 commit（等 Cato）
- Phase 1 / 2 / 3 未開工
- v4 仍有缺陷未修：畫面 A 332 漢字（目標 ~300）、非 active 的強度計用白色比 active 的琥珀更顯眼、
  畫面 B 的路線訊號是語彙統一而非元件統一、`我核准` 這個關卡名（`seed.ts:339` 的
  `HUMAN_APPROVAL_STAGE_NAME`）在多方簽核情境下第一人稱錯位
- 交付的 v4 整頁 PNG 是三張真截圖拼接的（`VerifyViewport --full` 在 3684px 高度反覆 JSON parse 失敗）。
  **每張都是真渲染**，但接縫間距是畫的。要驗真實整頁直接開
  `http://localhost:5199/.aidesigner/mcp-latest-v4.html`
- 這條線與 PROJECTS.md 記的 Anchorline 主線（`add-vibe-route` 的 8 題實機 UAT 待 Scott）**是分開的兩件事**
