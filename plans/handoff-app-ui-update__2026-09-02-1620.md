# Handoff — Anchorline 全 App 介面改版（Phase 1 執行中）

> 冷啟動用。新 session 的角色是 **PM：不下海，只派子 agent**。
> 建立於 2026-09-02 16:20（Asia/Taipei）。上一段 session 已達 1.8 MB，故切換。
> 前一份 handoff 是 `plans/handoff-app-ui-update__2026-09-02-1330.md`（**已過期**，
> 它寫的 worktree `~/orca/workspaces/Project_Anchorline/tiamat` 已經不存在，工作已合進 main）。

---

## 0. 一分鐘進入狀況

| 項目 | 值 |
|---|---|
| 工作目錄 | `/Users/scottchen/Documents/20_Projects/Project_Anchorline`（**主 repo，不是 worktree**） |
| 分支 / HEAD | `main` @ `72e8310` |
| 領先 origin | **14** 個 commit（`git log` 列 13 ＋ merge commit `3492798`）。⛔ **push 要問過 Scott** |
| 工作樹 | **有未 commit 的改動**（Phase 1 進行中，見 §2） |
| **主計劃書** | `Plans/plans-handoff-app-ui-update-2026-09-02-breezy-boot.md` ← **先讀這份，它是派工單** |
| 需求來源（上位） | `docs/PRD-app-ui-update.md` **v0.3**（483 行，full 路線 15 章，7 題開放問題全拍板） |
| 架構調查（18 缺口） | `plans/A-新增專案架構調查__2026-09-02.md` |
| 設計產物 | `.aidesigner/mcp-latest-v4.html`（已進 repo） |
| Dev server | `bunx vite --port 5199 --strictPort` |

**一句話現況**：計劃已核准，Phase 1 的兩條並行工作（A · P1-1 狀態條 / B1 · 自簽 helper）
**在上一個 session 結束時仍在跑**，改動已落在工作樹但**報告沒有留下來**。
新 session 的第一件事是**自己驗證工作樹**，不是找報告。

---

## 1. 已完成（本段 session）

### 1.1 計劃書已產出並經 Scott 核准

`Plans/plans-handoff-app-ui-update-2026-09-02-breezy-boot.md` —— 三個 Phase 的完整派工單，
含硬約束、切分、並行安全規則、驗證指令、每一塊的完成條件。**不要重新規劃，照它執行。**

產出過程：3 個 Explore agent 掃過 status-bar / signoff / dashboard / 建案入口 / 測試架構，
2 個 Plan agent 分別設計 P1 與 P2。結論已收進計劃書。

### 1.2 Scott 本段拍板三題

1. **Phase 順序：P1 → P2 → P3**（PRD 原序）
2. **P3 做到 4/4**：補三條互動路徑，agent handoff 從內容推導路線（不彈窗）
3. **空狀態＝空狀態＋跨專案實測列**，身分卡與版號政策卡移出

### 1.3 PRD 修正到 v0.3（已寫進檔案，未 commit）

三處都是**跑指令查證出來的**，不是採信文件：

| 項目 | 原文 | 修正 | 證據 |
|---|---|---|---|
| M-01 / AC-06 | 「22 頁」 | **17 個 App 頁** | `grep -lE 'class="app"' *.html \| wc -l` = 17／22。無外殼的是 `index` / `landing` / `landing-aid` / `login` / `onboarding`；`ensureBar()`（`status-bar.ts:120-141`）沒有 `.app` 就 `return null`。**在登入頁塞狀態條是 bug 不是修正** |
| AC-08 | 口徑模糊 | 寫死「有資料狀態」＝**磁碟量測結果**（`ProjectStats` / `CoverageResult` / UAT rollup 三種來源） | 不寫死的話 UAT 判定會兩邊不一致 |
| §09 P3 | 「1/3」 | 附記實際是 **1/4** | `projects.ts:1093-1098` 的 `?beginner=1` 直接 `openWizard(true)` 繞過 triage |

### 1.4 Phase 0 已獨立複驗屬實（非採信 PRD）

`bun test` **2132 pass / 0 fail**、`tsc` exit 0、`prd-progress.ts` 存在（61 行）、
`selfSignVibe` 確實呼叫 `evaluatePrdGates`（`store.ts:2123`）、`l2.passWhen` 確實動態、
`canSelfSign` 七條守門齊備。PRD 對 Phase 0 的描述全部對得上，只有兩處行號範圍偏寬（無實質出入）。

---

## 2. ✅ 已複驗（2026-09-02 16:5x，新 session 自己跑的，非採信報告）

**A 與 B1 都完工，全綠。** 實測輸出：

- `git status --short` / `git diff --stat` 與 §2 描述的工作樹**逐檔相符**（7 改 4 新，+284/−23）
- `bunx tsc --noEmit` **exit 0**
- `bun test` **2159 pass / 0 fail / 105 檔**
- `grep -rn "結構可送審" src` → **零命中**（D-2 落實）
- 新增行 `L0`–`L4` → 零命中；`shared.css` 新增行 hex/px → 零命中；`route-grid` 在 diff 中 → 零命中
- `grep -rn "startsWith(SELF_SIGN_NOTE)" src` → **只剩 `src/lib/signoff.ts:643`**

⚠️ 下方 §2 原文（16:20 寫的）說「視覺驗證大機率沒跑到」**已過期** —— A 的報告（16:3x，
寫在本節下方）載明它在 **5211 埠**用真 Chrome + `VerifyViewport.ts` 跑過五頁與兩個窄版。
B1 是純重構、行為零改變，不需要視覺驗證。

### ✅ B2a ＋ B2b 也已完工並複驗（18:5x，PM 自己跑的）

第一次派工 16:5x **兩個 agent 都空手死在 429**（Anthropic session limit，18:00 重置），
工作樹零損傷。18:42 重派，兩條都完工。

**PM 複驗實測**（不是採信報告）：

- `bunx tsc --noEmit` **exit 0**
- `bun test` **2197 pass / 0 fail / 107 檔**（基線 2159/105，B2a +21、B2b +17）
- `shared.css` 新增行 hex/px **0** · `route-grid` in diff **0** · 新增行 `L0`–`L4` **0**（含三個新檔）
- 新增行的外部 URL **0**（硬約束 2）
- `anc:t=` 在新增行出現 4 次，**逐條核對全在註解**，零筆進輸出字串
- `結構可送審` 零命中 · `startsWith(SELF_SIGN_NOTE)` 仍只剩 1 處

工作樹現況：**10 改 8 新**，`+452/−59`（不含未追蹤新檔）。

### ⛔ 更正：這個 repo 只有 **3 個主題**，不是 4 個

`theme.ts:9-13` 的 `THEMES` 與 `types.ts:5` 的 `ThemeId` 都是 **`kami` / `github` / `terminal`** 三值。
**PRD v0.3 是對的**（`:387` 與 `:449` 都寫 3）—— 錯的是本 handoff §10 的「要在四個主題區塊各驗一次」，
PM 又把它抄進了 B2a／B2b 的 brief。兩個 agent 各自獨立回報了這個矛盾，兩份都拍三張。
**後續派工不要再寫「四主題」。**

### B2a / B2b 各自 flag、需要 PM 或後續接手的事

| # | 事項 | 誰接 |
|---|---|---|
| 1 | **`review.html` 的核准列預設收合**（`<details class="review-approvals-wrap">`，`review.html:113`，開合不持久化）。使用者預設**看不到**新的自簽標記，要點開「簽核 2/4」那行才看得到 —— 這條自簽訊號的可見度因此打折 | **產品決定**：vibe／自簽個案要不要預設展開。介面改版線 PM |
| 2 | `review.ts` 頂端流程條印出 `L1 意圖 … L6 交付`（來自 `flow-layers.ts`）。**既有行，不違反硬約束 1**（只管新增行），但若「L 碼不進 UI」要往全站推，這是最大宗殘留 | 介面改版線後續 |
| 3 | `src/pages/signoff.ts:239` 另有一組**手寫 `sg-log` 列**（PRD 檔案版本清單），沒走 `timelineRowHtml`。將來改 `.sg-log` 結構會漏掉 | 介面改版線後續 |
| 4 | `syncApprovalsFromActiveCase()` 只同步 active 個案 → 非 active 專案的 `state.approvals` 是舊的。B2b 的 id 對帳讓它不會誤標，但那條列本來就會顯示過期資料 | store 線，非本輪 |
| 5 | **自簽的視覺驗證是直接寫 localStorage 造出來的**，不是走 App 的 `selfSignVibe()`。「按下自簽鈕之後畫面真的長這樣」**沒有實機走過** | **進 UAT 題庫** |
| 6 | `.sg-stage--self-signed` 與 `--changes_requested` 疊在同一列時底色相疊。資料上目前不可達（`isSelfSignStage` 要求 `state === "approved"`） | 若日後把自簽判準改成看 `log`，要重看 |

### 兩個 agent 做的重要判斷（都合理，記著）

- **B2b 的 CSS 選擇器被迫帶 `.approval-strip` 祖先**：原本 `.approval-card.is-self-signed`（0,2,0）
  **實測完全沒生效** —— `shared.css:3791`（github）與 `:3835`（terminal）的主題 chrome 用
  `background` **簡寫**把卡片拍平，連帶把 `background-image` 歸零，且權重 (0,2,1) 在後面。
  提到 (0,3,0) 才蓋得過。比在主題區開分叉好：底紋只有一份，不隨主題數長。
- **B2b 的 `selfSigned` 用 AND 語意不是 OR**：個案層級事實 **且** `stages` 裡 id 對得上且
  `isSelfSignStage()` 為真才標。任一證人說不就安靜不標 —— 誤標的代價是把真簽核講成假的。
- **B2a 把「舊個案反推」路徑也分岔了**（brief 只點名 log 路徑）。不做的話沒有 `log` 的舊個案
  會原樣印出整串 join key，正是這題要消掉的東西。
- **B2a 給 `TimelineEntry` 加 `anchor?`** 而非把錨點併進 `detail` —— `detail` 是跳脫後直印，
  錨點要包 `<span class="mono">`，混在一起等於在渲染端再解析一次 note 格式（第四個 reader）。
- **B2a 的徽章不用 `border`** —— `1px solid` 會踩硬約束 3。改 `color-mix(… 18%)` 底色。
- **terminal 主題下斜線底紋看得見**：B2a 的 8% 不需提高；B2b 走 per-theme override 提到 14%。
  兩人都實拍三主題確認。

---

## 2b. ⚠️（歷史）進行中且狀態未確認 — 已由 §2 取代

上一段 session 派出兩個 `general-purpose` + `opus` agent，**結束時仍在跑**。
它們直接寫 main 工作樹，所以**改動在，報告不在**。

### 工作樹當時的狀態

```
 M docs/PRD-app-ui-update.md      ← §1.3 的 PRD 修正（PM 做的，確定完整）
 M shared.css                     ← A agent
 M src/data/store.ts              ← B1 agent
 M src/lib/signoff.ts             ← B1 agent（+81 行）
 M src/lib/status-bar.ts          ← A agent（+43/-23）
 M tests/signoff.test.ts          ← B1 agent（+6）
?? src/lib/status-bar-view.ts     ← A agent 新檔
?? tests/status-bar-view.test.ts  ← A agent 新檔
?? plans/plans-handoff-...breezy-boot.md ← 計劃書（Plans/ 與 plans/ 在 macOS 是同一個目錄）
```

### ✅ B1 已完工（16:2x 回報，報告完整保留於此）

**結論：純重構，行為零改變，未 commit。**

- 改動：`src/lib/signoff.ts`(+81) · `src/data/store.ts`(+3/-4) ·
  `tests/signoff.test.ts`(+9 測試) · `tests/vibe-route-store.test.ts`(+1 測試)
- 新增 6 支 helper：`selfSignNote` / `isSelfSignComment` / `isSelfSignDecision` /
  `isSelfSignStage` / `caseHasSelfSign` / `selfSignAnchor`
  （`selfSignAnchor` 刻意放在 `selfSignSubject` 正下方 —— 兩支是逆向對）
- **實測**：`tsc` exit 0；`bun test` **2159 pass / 0 fail / 105 檔**
  （B1 自己的增量是 **+10**，其餘 +17 是 A 的 `tests/status-bar-view.test.ts`）
- `grep -rn "startsWith(SELF_SIGN_NOTE)" src` → **只剩 `signoff.ts:643` 一處**，
  `store.ts` 已完全不碰這個常數
- **等價性實測**：測試檔還原成 HEAD 版、原始碼留新版 → 85 pass / 0 fail，既有測試一條沒改就全過
- **九個突變測試全紅**，且紅的是對應那條。兩條最有價值的：
  - **M4**（分隔符 ` · ` → ` - `）：store 那批測試**全綠**，因為 writer 與 reader 同時被改成
    新格式、行為自洽。抓到它的**只有合約測試** —— 這就是「writer 與 reader 進同一個檔」買到的東西
  - **M9**（拿掉清戳記的解構）：既有升檔測試只驗 `state === "pending"`，照樣綠。
    新測試是目前唯一擋住「關卡顯示待簽核卻掛著舊的『某某·已簽』戳記」的東西
- `store.ts:2041` 的真值表已逐格核對（含 `""` 空字串與 optional chaining 的短路差異），
  De Morgan 推導對得上，M8 突變實測三條紅

**B1 flagged 的六件事，其中三件是 P1-2 要接的：**

| # | 事項 | 誰接 |
|---|---|---|
| 1 | **`canSelfSign:675` 沒有改用 `caseHasSelfSign`** —— 後者有「log 缺失退回查 stages」的退路，接進去會讓那條守門**變寬**＝行為改變。這是產品決定不是重構 | **待 Scott 或 P1-2 拍板** |
| 3 | `selfSignAnchor` 回**裸 id**（不是整段 `anc:t=xxx`），與 `plan-parser.anchorOf` 慣例一致，且來回等式才成立 | ✅ 與 B2a 的 brief 相容（`錨點 <mono>{裸 id}</mono>`） |
| 4 | `selfSignAnchor` 目前**生產程式碼零呼叫**，只有測試在用 —— **P1-2 沒開工它就是死碼** | B2a / B2b 接 |
| 2 | `isSelfSignDecision` 對 `comment === undefined` 回 false 而非丟 TypeError（型別上不可達） | 記著即可 |
| 5 | `store.ts:2041` 的 `state === "approved"` 那一半**在 store 層級沒有可達測試情境**（要組出來得先送審，而送審就擋住自簽）。**刻意沒去組** —— 那正是前一輪抓到的那種死測試。覆蓋在單元層（M3 證明有效） | 正確判斷，不要回頭「補」 |
| 6 | 既有測試「升檔＝自簽核准不帶進正式流程」斷言偏弱（只看 `state`），已另加一條補戳記清除與解鎖 | 已處理 |

### ✅ A 已完工（16:3x 回報，報告完整保留於此）

- 改動：**新檔** `src/lib/status-bar-view.ts`(96 行) · `src/lib/status-bar.ts`(+43/−16) ·
  `shared.css`(+21，**插在 `.app-status-pill--warn` 之後，非檔尾**) ·
  **新檔** `tests/status-bar-view.test.ts`(17 測試)
- **實測**：`tsc` exit 0；A 單獨增量 **2132 → 2149（+17）**；全套最終 **2159 / 0 fail**
- 四條 grep 全部零命中：「結構可送審」· 新增行 `L[0-4]` · `shared.css` 新增行的 hex/px ·
  `.route-grid` 在 diff 中 0 行
- **D-2 照做**：`canSubmit` 分支整條刪除，落到 `gateSummaryLine()`

**視覺驗證（真 Chrome，`VerifyViewport.ts`，rAF 63–64 ticks/s 現場確認 lifecycle 活著）**

⚠️ **5199 埠被另一個 checkout 佔用**（`~/orca/workspaces/Project_Anchorline/tiamat`，PID 66866）
—— 正是 handoff 警告的那個坑，而且就發生在 handoff 指名的那個埠上。A 改用 **5211**。
**下次派工要先確認埠沒被佔，或直接指定一個沒人用的。**

五頁都看到路線籤。vibe 專案顯示 `[草稿] [試作／探索]` 琥珀色；lite 專案顯示
`[審閱中] [功能建構／迭代優化]` 中性灰，與旁邊的狀態 pill 明顯可分。三種路線切換各自輸出
`新產品／新專案` / `功能建構／迭代優化` / `試作／探索` 逐字正確，`full`/`lite` 正確不帶
`--vibe` class。專案被清空時**整個籤消失**（`chip: null`），無空框無佔位符 —— PRD §11 行為。
900px 與 720px 窄版：籤保持可見、`flex-shrink:0`、`.app-status-project` 仍是 245.867px（28ch，未動）。

**A 做的四個判斷（都合理，記著）**

1. **多導出第三支 `projectNameHtml(name)`**。理由：`routeChipHtml` 只吐 `PRD_ROUTES` 的靜態名，
   沒有使用者輸入經過它，原本要求的「escapeHtml 生效」測試**沒有靶子**。把專案名的 span
   一起搬進 view module（輸出位元組相同），逸出才有測試網。含 `title` 屬性的引號突破測試。
2. **import 範圍偏離 brief**：`gateStatusText` 必須逐字比對 `gateSummaryLine()` 的回傳，
   所以得呼叫它 —— 從 `prd-gates` import 了一個值而非只有型別。該模組是純的、已被五個測試檔
   import，可測性不受影響。
3. **`gate === null` 檢查排在 `locked` 之前**：`st.locked` 和 gate 一樣是 `activeProjectId`
   範圍的事實，對 fallback 專案顯示「已鎖定」是同一個 bug 換套衣服。非 focus 時整個 center 欄留白。
4. **保留 `canApprove === false` 這條目前不可達的分支**：base spec 下 `canApprove === canSubmit`，
   但 `gate-rules.ts` 明文記載領域包可以加更嚴的核准規則。收掉會靜默吃掉那個設定。原式逐字保留＋註解。

### ⚠️ 重要更正：B-1 那個 bug 在正式版**重現不了**

A 試圖製造分岔失敗，並且**明講它沒有拍到那張截圖、不宣稱有**。原因：

- `load()`（`store.ts:960-963`）會把懸空的 `activeProjectId` 強制收斂成 `projects[0].id`
- 正式版變體**直接把 sample 專案從 `state.projects` 剔除**（`:1018`）

所以正式版正常載入時，`visible[0]` fallback 與 `activeProjectId` **不會不一致**。

**仍然可達的情境**：測試變體；或正式版中 `showSamples` 在某個 sample 專案 active 時被切換。

→ **守門是對的、值得留**（成本是零，而且 A 的第 3 點讓它連 `locked` 一起蓋住），
但**不要對外宣稱「今天就在說謊」** —— 那是上一段 session 的 PM 講過頭了。
`PROJECTS.md` 的接縫第③條已據此更正。

### 冷啟動時照這個順序做

```bash
cd /Users/scottchen/Documents/20_Projects/Project_Anchorline
git status --short
git diff --stat

bunx tsc --noEmit          # 必須 exit 0
bun test 2>&1 | tail -5    # 必須 0 fail，pass ≥ 2132

# A 的驗收
grep -rn "結構可送審" src   # 必須零命中
git diff -- src '*.html' | grep '^+' | grep -nE '"[^"]*L[0-4][^"]*"'          # 零命中
git diff -- shared.css | grep '^+' | grep -nE '#[0-9a-fA-F]{3,8}|[0-9]+px'    # 零命中

# B1 的驗收
grep -rn "startsWith(SELF_SIGN_NOTE)" src   # 只剩 src/lib/signoff.ts 一處
```

**三種可能的結局，處置不同**：

- **全綠** → A 與 B1 完工。接著開 B2a ∥ B2b（見 §3）。
- **半完成 / tsc 紅** → agent 被截斷。**不要自己動手修**（PM 不下海）——
  讀 diff 判斷斷在哪，重派一個 agent 接續，brief 裡附上目前的 diff 摘要。
- **完全沒動到某個檔** → 那條線沒開始，照計劃書重派。

⚠️ **A 與 B1 的視覺驗證（Interceptor 5199 埠、17 個 App 頁抽 5 頁）大機率沒跑到**，
即使 tsc 與 test 全綠也要補。

---

## 3. 下一步（照順序）

1. **確認 A 與 B1 的實際狀態**（§2）
2. **B2a ∥ B2b 開工** —— 兩者都依賴 B1 的 helper，B1 沒落地不能開（tsc 會紅）
   - **B2a**：關卡列＋時間軸自簽語彙。落點 `signoff-stages.ts:232/235-238/250-256`、
     `signoff.ts:780-790/843-853`、新檔 `src/lib/signoff-log.ts`、`shared.css:13655` 區段
   - **B2b**：review 頁 approval strip。落點 新檔 `src/lib/approval-strip.ts`、
     `review.ts:409-455`、`shared.css:2200` 區段
3. **B3**（依賴 B2b）：`signoff.ts:498-511` 的「已自簽 —— 尚未進入正式審閱」誠實文案
4. **V1 驗證 ＋ Cato 審查**（merge 前審，不是先合再審）
5. **Phase 1 的實機 UAT**（走 `Uat` skill）
6. commit 前問 Scott；push 另外再問

Phase 2 / Phase 3 的完整派工單在計劃書裡，這裡不重複。

---

## 4. 派工規則（每次都要守）

- **主 session 只編排，不寫 code。**
- **席位：`general-purpose` + `model: opus`，直接在 main 工作樹作業。**
  ⛔ **不要用 `Engineer`** —— 它強制 worktree 隔離，而本 repo 慣例是「實作任務直接在
  main 工作樹，不開 worktree、不 commit、不 push」。Engineer 會拿到一棵從預設分支新開的
  隔離樹，Bash 守門會擋掉 `cd 別的 worktree` / `git -C`，等於寫得出來卻編不了測不了。
- **agent 一律不 commit、不 push。** commit 由 PM 收攏後問過 Scott。
- **審查用 Cato**（codex 池專供審查，2026-09-02 上午 76%、偏緊）。
  派它時**必須**給：落點行號清單 ＋ 優先序 ＋「先出結論再補證據」。
  前一輪它撞了兩次 5 回合上限、零產出，第三次下令「最多再跑 1 個工具立刻輸出」才交件。
- **每個 agent 的 brief 都要複製計劃書的「硬約束」全段。**
- 派工前跑 `bun ${LIFEOS_DIR}/TOOLS/AgentQuota.ts --json`。
  2026-09-02 上午的狀況：Engineer 可用但與主 session 共池、Cato/Forge 76% 偏緊、
  **Bellows 100% 耗盡**（08:13 重置）、Relay 可用但**只能在預設分支**。

---

## 5. 硬約束（違反任一即該題失敗）

1. UI **新增行**不得出現 `L0`–`L4` 字樣（既有內部 id `l1`–`l6` 與程式註解不受限）
2. 不得引入外部 CDN／字體／圖示庫（離線必須能跑的 Tauri app）
3. 新樣式**零硬編 hex 與 px**，一律走既有 token
4. 不新增主題（要改四層 30 個註冊點，漏改**不報錯只會靜默回退**）
5. 路線一律走 `projectRoute()`（`prd-triage.ts:137`），四檔中文名唯一權威來源是
   `PRD_ROUTES`（`prd-triage.ts:62-108`）。**不得再造第三份對照表**
   （已有 `prd-file.ts:120` 與 `editor.ts:1519` 兩份重複）
6. **不得動 `.route-grid` 斷點**（`shared.css:15511/15520/15526`）—— 跨 session 接縫，
   且 `:15526` 那個 media block 混著 `.modal.modal-sheet > .body`，改它會誤傷 modal
7. **`shared.css` 新規則一律插在所延伸的既有 sibling 規則旁邊，禁止 append 到檔尾**
   —— 多 agent 並行時這是唯一的防撞規則
8. 驗證一律 Interceptor 真 Chrome、**5199 埠**（不是 5173）；
   截圖用 `VerifyViewport.ts`，**不用 `Capture.sh`**（背景分頁會停整個 rendering
   lifecycle —— rAF / IntersectionObserver / transition 全停，**不報錯**，拍出全白圖）

### 測試架構（決定了寫法，不是建議）

**全 repo 零 DOM 測試環境** —— 無 happy-dom、無 GlobalRegistrator，104 個測試檔全是
`bun:test` 純函式 + HTML 字串比對（範例 `tests/signoff-preview.test.ts`）。
→ **新 UI 程式碼必須寫成「吃 plain data、回字串」的純函式，否則測不到。**
本輪**不引入** DOM 測試環境（那是併行線的 P0 建議 #2，L 級，另案）。

---

## 6. 三個查證出來的既有 bug（PRD 沒寫，計劃書有）

| # | Bug | 處置 |
|---|---|---|
| **B-1** | `evaluatePrdGates(state, spec)`（`prd-gates.ts:505-515`）讀的是 `state.sectionValues`／`state.sections`，**那永遠是 `activeProjectId` 的內容**，不是傳進去的 spec 對應的專案。`status-bar.ts:101` 的 `activeProject()` 會 fallback 到 `visible[0]` → 狀態條可能顯示 A 專案的名字配 B 專案的 gate，**完全不報錯**。⚠️ **但正式版重現不了** —— `load()`（`store.ts:960-963`）會收斂懸空的 `activeProjectId`，正式版又剔除 sample 專案（`:1018`）。僅測試變體或 `showSamples` 切換時可達（A agent 實測，見 §2 更正） | A agent 的處置：非 focus 時 gate 欄留白。⛔ **不修 `evaluatePrdGates` 的簽章**（會動四個呼叫端） |
| **B-2** | 同一種病的第二例：`dashboard.ts:91-95` 的 `activeProject()` 過濾 `isSample` 並 fallback `visible[0]`；`flow-layers.ts:37-44` 的 `activeProject(state)` **不過濾**、fallback `p1`。兩者可能指向不同專案 | Phase 2 的 P2-2c 必做。解法照 `overview.ts:112-121` 的 `gateOf` 寫法，餵專案限定的 state |
| **B-3** | 建案入口實際覆蓋率 **1/4**：`projects.ts:1093-1098` 的 `?beginner=1` 繞過 triage，從 `onboarding.ts:208-212` 與 `rail-projects.ts:312` 都進得來。另有第五條 `projects.ts:1441-1462` 的 agent handoff 自動匯入，**全自動無互動，沒地方彈 modal** | Phase 3。Scott 已拍板做到 4/4，agent handoff 從內容推導 |

---

## 7. 跨 session 接縫（重要）

主 repo 上另有併行 session：`main-2-77`（工作在 `~/orca/workspaces/Project_Anchorline/main-2`，
分支 `main-2`），做的是介面改版的另一半（首啟一題＋導航漸進揭露）。

**已立的協議**：

- 我方落點：`status-bar.ts`（**短期歸我方獨佔**）、`shared.css`（狀態條／自簽／治理鏈三個區段）、
  `dashboard.ts`、`review.ts`、`signoff*.ts`
- **`.route-grid` 斷點是兩線接縫**，任一方要動先知會 —— 我方 Phase 1／2 都不動
- 對方的 P2 會碰 `onboarding.html` / `first-run-tour.ts` / `rail-nav.ts`，
  **正是我方 Phase 3 的腹地**。Scott 已定 P3 排最後，所以對方大機率先動 ——
  **P3 開工前必須先敲對方確認落點狀態**
- 對方短期只 commit `docs/` 與 `openspec/`
- 缺口 #10 / Q-13（升檔靜默改變關卡來源）**歸 `project-anchorline-3b` 線**，本計劃只追蹤不做

⚠️ **2026-09-02 16:0x 嘗試用 SendMessage 敲對方，訊息卡在對方的核准佇列、過期未送達。**
別再靠 SendMessage 傳接縫協議 —— 寫進 handoff 與 `PROJECTS.md` 比較可靠。
待傳達的三件事：①我方 status-bar 落點 ②線頭 #8「結構可送審」我方判定是**直接刪分支**、
收斂到 `gateSummaryLine()`（理由：那句話對 vibe 與已鎖定專案都是假的，且描述的是檢查結果
不是權限）③上表的 B-1 bug 回報。

⛔ **不要對 `main-2` worktree 做任何寫入。**

---

## 8. 已拍板，不要重開

- 四檔路線條 = **唯讀指示器**（不做切換入口）—— code 裡三種點擊行為完全不同，
  長得一樣但行為三分岔會是下一個 bug 源
- 自簽**不推進** `status` / `pct` —— P1-3 是「誠實呈現」而非「修正」
- Q-01 選 **(b)**：v4 畫面 C 的正式多方簽核關卡表是 **P2 之後的目標態**，不進 P1-2
- Q-04：匯入 pct 落差的說明放**匯入完成的 toast**
- Q-05：設計產物**進 repo**（`.aidesigner/`，596K）
- Q-07：**不做**質性量表（NASA-TLX / QUIS）
- 空狀態的最終形狀：**空狀態＋跨專案實測列**，身分卡與版號政策卡去殼改成輕量文字連結

### 明確不做

引入 DOM 測試環境 · 缺口 #10/Q-13（歸 3b 線）· 缺口 #17 升檔訊號（讓給併行線 P3）·
缺口 #16/#18 · v4 畫面 C · 新增主題 · 外部 CDN · L0–L4 進 UI · 自創升檔提示樣式 · 雙進度曲線

⛔ **不開新的 openspec change** —— `openspec/` 歸 `3b` 線，且 `add-vibe-route` 尚未 archive，
本線再開一個會撞。

---

## 9. 還沒收的線頭

- **A 與 B1 的完成狀態未確認**（§2）—— 最優先
- A / B1 的 Interceptor 視覺驗證大機率沒跑
- B2a / B2b / B3 未開工
- Phase 1 的 Cato 審查未做、UAT 未出題
- Phase 2 / Phase 3 完全未開工
- **接縫協議三件事未傳達給併行線**（§7）
- PRD v0.3 的三處修正**未 commit**
- `add-vibe-route` 的 **8 題實機 UAT 仍待 Scott**
  （`plans/uat-第四檔路線「試作／探索」實測-2.md`）—— 這是 push 的前置
- main 領先 origin **14** 個 commit，全部未 push

---

## 10. 兩個踩過的坑（別再踩）

1. **`refine_design` 會靜默刪掉你沒提到的既有元素**（v3→v4 掉了 5 個，包括拍板要保留的按鈕）。
   每輪都要跑「v(n-1) 有、v(n) 沒有」的字串反向比對。
2. **AIDesigner 的 canvas pipeline 會自己注入 `<script src="https://cdn.tailwindcss.com">`**
   貼在 `</head>` 上（v2/v3/v4 三次都中），違反硬約束 2，而且它的 `.gap-*` 會撐爆版面。
   每次都要檢查並移除，原檔另存 `-raw.html`。

**設計 v4 只能當視覺參考**：它用的是 Tailwind 式 utility class（`text-14` `px-24` `gap-12`
`w-200` `border-l-3-warn`），repo 完全沒有這些 class，且違反「不得硬編 px」。
可借鏡的是語意 class 名：`audit-trail-micro` / `anchor-grid` / `empty-state-layout` /
`ghost-chain`。斜線底紋在 `shared.css` **零命中**，要從零建，且要在四個主題區塊各驗一次
（`warn 5%/8%` 疊在 `terminal` 極暗底上大機率視覺為零）。
