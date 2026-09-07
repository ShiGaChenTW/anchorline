# Handoff — AI-Native SDLC 導讀文件線

- **建立時間**：2026-09-03 06:25 CST
- **最後更新**：2026-09-03（下午，commit `52cb725` 之後）
- **這條線在做什麼**：把 Anthropic《The AI-Native SDLC Playbook》做成繁中互動式學習頁，並把其中「對照 Anchorline」那節單獨拉成圖。
- **給新 session 的一句話**：**已經 commit，工作樹乾淨，沒有進行中的工作。** 剩下的全是判斷題（見 §4），沒有一題是「還沒寫完」。

> ⚠️ **這條線與 UI 改版線（Phase 2）完全無關，沒有動到任何 `src/`。** 接 Phase 2 的人請讀 `plans/handoff-phase2-dashboard__2026-09-02-2214.md`。

---

## 1. 冷啟動先跑這幾條（不要相信下面的數字，自己驗）

```bash
cd ~/Documents/20_Projects/Project_Anchorline
git status -sb
git log --oneline -4
ls -la docs/ai-native-sdlc-playbook.html docs/anchorline-governance-*.{html,json}
```

**我離開時的實測值（2026-09-03 下午）**

| 項目 | 值 |
|---|---|
| 分支 | `main`，領先 origin **23** 個 commit，全部未 push |
| HEAD | `52cb725 docs: AI-Native SDLC 導讀頁與 Anchorline 治理鏈圖` |
| 工作樹 | **乾淨**（`git status --short` 零行） |

**注意**：`773f0c3` / `3f2dc53` 等 commit **不是這條線做的**，是其他 session 在同一個工作樹上推進的（Phase 2 UI ＋ AIDesigner）。要接 UI 改版線的人以 `git log` 為準，不要以 `PROJECTS.md` 為準。

---

## 2. 這條線的產出（5 個檔案，全部已在 `52cb725`）

| 檔案 | 內容 |
|---|---|
| `docs/ai-native-sdlc-playbook.html` | 主文件。1916 行 / 145KB，單檔零建置（只外連 Google Fonts）。原文 15 個 play 全文詳解 ＋ 11 份程式碼範本 ＋ 4 張圖 ＋ Anchorline 對照 ＋ 導入檢核清單 |
| `docs/anchorline-governance-chain.html` | **archify 版**的 05 節流程圖，699KB，附 Viewer UI（Legend／Export／Present） |
| `docs/anchorline-governance-chain.archify.json` | 上面那張圖的規格來源（6KB）。改圖改這份再 `deliver` |
| `docs/anchorline-governance-loop.html` | **diagram-design 版**：Loop 圖（7 站 ＋ 1 中心）＋ 節點級／整圖級情境說明 ＋ 14 條 Play 判定表 ＋「上下文維度」一節。40KB，靜態單檔 |
| `plans/anchorline__2026-09-03-0600__ai-native-sdlc-interactive-html.md` | 本線追蹤文檔，含收斂過程與踩到的坑 |

### 2b. `anchorline-governance-loop.html` 這一份的內容地圖

同一節被畫了兩次，**兩張圖講的不是同一件事**，不要當重複品：

- **chain（archify）** = 治理鏈的**線性工作流**，強調節點與邊
- **loop（diagram-design）** = 同一節但畫成**迴圈**，因為 05 節的核心論點是「它現在是一條線，不是迴圈」。7 站順時針，中心是共用的錨點稽核軌跡，**鏽紅虛線兩段（P1 意圖入口／M1 訊號回寫）＝ 尚不存在**，缺口在鏈的兩端而不是中間

loop 那份多出來的三節，是後續對話長出來的，**主文件裡沒有**：

1. **情境 A** — 8 張卡，每站回答「什麼時候走到這裡／實務上長什麼樣／誰在操作／卡在哪」
2. **情境 B** — 四個該用這張圖的場合、兩個不該用的地方
3. **延伸｜上下文維度**（`#context`）——把「上下文管理」疊上去之後長出的東西：
   - **D1/B1/B2/B3 四列塌成一個機制「上下文出處」**：現在錨點記錄「產出了什麼」，沒記錄「產出者當時看得到什麼」。監看給 changelog，出處給 lockfile
   - **`authorAgentFamily` 已經是這件事的第一個欄位**（把執行者身分綁進錨點）——Anchorline 已經做了四分之一，只是沒意識到
   - **B4 優先度翻轉**：讀 hook log／OpenTelemetry 是上下文出處唯一的進料管，不是最低優先。原文那個判斷要翻過來
   - **第 15 格：跨 session 矛盾偵測**——兩個 agent 在兩個 worktree 各自過 gate 卻互相衝突。playbook 沒有、14 條 Play 沒有。目前的解法是在 `PROJECTS.md` 手寫「跨 session 接縫」，人工同步靠記得

---

## 3. 已經驗過的（不用重驗）

**主文件** —— Interceptor 隔離 test profile 實看：

- DOM 實測：DAG 15 節點 / 22 條邊、15 張 play 卡、17 項檢核
- 無橫向溢位：`body.scrollWidth 1833 < innerWidth 1848`
- 互動實測：圖 01 切換後 segs 對 grow 比例一致（≈13.8/單位）；圖 03 點 M1 前置鏈正確展開；Anchorline 表格篩選「缺口」得 6 列
- 雙主題 token 都解析得出（light `rgb(237,239,234)` / dark indigo `#93A7EE`）

**chain 圖（archify）**：`deliver workflow --quality showcase` → **9/9 checks · 0 errors · 0 warnings**；`visual-check` **pass**，四個尺寸無溢位。spec sha256 `9fdd1e36…` / artifact sha256 `11155029…`

**loop 圖（diagram-design）**：

- 幾何用 Python 依 Loop 型別公式算（7 站 × 51.43°、R=272、環弧同半徑 `A 272 272 0 0 1`、輻條真徑向），非手排座標
- skill 官方 `self_check.py` → **OK**
- Interceptor 實機亮／暗兩色：1 SVG／14 站點矩形／**12 路徑**（7 環弧＋5 輻條）／8 情境卡／22 表格列
- **7 站兩兩比對零重疊**；所有站名與副標都在 192px 框內（最寬 176）
- 標題與 lede 在 900/600/420/360px 皆無重疊；`body.scrollWidth` 未溢位；console error 0
- 所有 `#` 錨點都解析得到（3 個指向 `#context` 的連結）

> **踩過的坑，寫下來免得再中**：DOM-render 截圖會把 `.sec-head` 的 h2 與 `.lede` 疊在一起顯示，**那是合成假象**。DOM 幾何實測 gap 恆為 12px。看到疊字先用 `getBoundingClientRect()` 驗，不要去改 CSS。

---

## 4. 還沒收的線頭（照優先度排）

1. **`docs/` 現在有兩張同一節的圖**（chain 與 loop）。兩張目的不同（§2b），但**沒有任何地方說明它們的關係**——主文件 05 節只連到 chain。要嘛在主文件加一句分工說明，要嘛砍掉一張。**這是這條線自己製造出來的線頭。**
2. **05 節的 Anchorline 現況欄是判讀，不是查證。** 依 `README.md` 與 `docs/PRD.md` 寫的，**未逐一核對原始碼**。兩份文件裡都標了這句話。要當改版依據之前，14 列每一列都該回去驗——尤其「已具備／部分／缺口」這個判定。
3. **「上下文維度」那三個判斷要不要開單？** 它們不是原文的主張，是推導出來的：①上下文出處（合併 D1/B1/B2/B3）②B4 優先度翻轉 ③跨 session 矛盾偵測。**①的前置是②**（沒有 hook log 就拿不到 skill 版本），③的最小可行版是「兩份在途 plan 碰到同一個錨點就標記」，不需要理解語意。要開單前先做 #2 的查證。
4. **loop 圖沒做窄視窗實機測。** CSS 有 responsive，`.stations` 是 auto-fit grid，SVG 有 `min-width:720px` ＋ 外層 `overflow-x:auto`。DOM 幾何在 360px 驗過標題不重疊，但沒有真的縮窗看過。
5. **主文件也沒做窄視窗實測。** 只在 1848px 寬驗過。
6. **chain 圖的 Viewer UI 是英文。** archify 的 `meta.locale` 只吃 `en` / `zh-CN`，繁中不在選項裡，我選英文而不是簡體。圖上內容全繁中，只有按鈕是英文。
7. **chain 圖為了通過 1440×900 首屏 containment 砍掉兩樣東西**：`phases` 三條階段帶、第四張卡（authorAgentFamily 那張，內容已在主文件 05 節）。不在意首屏就把 `.archify.json` 那兩塊加回去再 `deliver`。
8. **`docs/` 沒有索引指到這三份新 HTML。** README 與 docs 目錄都沒連結。
9. **push 還沒做，前置沒變**：`add-vibe-route` 的 8 題實機 UAT 待 Scott，Phase 1 另有 4 題。現在領先 origin **23** 個 commit。這條線是純文件，沒有自己 push 的理由。

---

## 5. 下次要再動 archify 時，直接看這三條

寫在 `plans/anchorline__2026-09-03-0600__ai-native-sdlc-interactive-html.md` 末段，這裡只放標題：

1. 同 lane 相鄰 col 的節點寬度上限 ≈ 70px（col pitch 80）——要放長標籤就換 lane 走 `route:"drop"`。
2. `up-channel` 的 `toSide` 是 `"top"` 不是 `"bottom"`。
3. **viewBox 調寬會讓字變小**，修不了溢位。`desktop-readability` 用 `930/viewBoxWidth` 當縮放比，投影字級要 ≥6px。

## 5b. 下次要再動 diagram-design 的 Loop 圖，看這三條

1. **幾何用腳本算，不要手排。** 站點中心 `θ_k = -90° + k·(360/N)`，環弧全部 `A R R 0 0 1`（同半徑、順時針），輻條是真徑向且要扣掉 `marker_gap=6`。腳本留在本次 scratchpad，重寫成本約 10 分鐘。
2. **CJK 站名用 16px，副標 11px，站寬 192px。** 12px CJK 在圖上讀不動；192 寬能容最長 141px 的站名。
3. **兩處刻意偏離 skill 預設**（改圖時別「修正」掉）：①環弧用鏽紅虛線標「不存在的環節」——型別文件說環弧一律實線，但這正是整張圖要講的事；②除 2 個鏽紅焦點外 R2 用苔綠，來自 playbook 自己的語意三色，對應表格判定 tag，不是第三個 accent。

---

## 6. 明確不要做的事

- 不要照 `PROJECTS.md` 的 Anchorline 條目理解 UI 改版線進度，那條以 `git log` 為準。
- 不要把 05 節的判定當查證結果直接開單（線頭 #2 是 #3 的前置）。
- 不要為了「補完」把主文件再加長——它已經 145KB，該補的是查證，不是字數。
- 不要以為 chain 與 loop 是重複品而隨手砍掉一張，先讀 §2b。
- 不要因為 DOM-render 截圖看起來標題重疊就去改 CSS，那是合成假象（§3 末）。
