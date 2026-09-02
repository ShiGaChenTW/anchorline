# Handoff — Anchorline 介面重新設計（AIDesigner 路線）

> 冷啟動用。新 session 的角色是 **PM**：保管第一款設計、指揮子 agent 產第二款、最後決定移植哪些。
> 建立於 2026-09-02 02:55（Asia/Taipei）。上一段 session 已達 3.4 MB，故切換。

---

## 0. 一分鐘進入狀況

| 項目 | 值 |
|---|---|
| 工作目錄 | `/Users/scottchen/orca/workspaces/Project_Anchorline/tiamat`（**worktree，不要 cd 回主 repo**） |
| 分支 | `redesign-ui-aidesigner` |
| 基準 commit | `e1b413c fix(seed): 測試版示範 agent 全部綁 CLI 後端` |
| 未追蹤 | `.aidesigner/`（設計產物，**保留**） |
| Dev server | `bunx vite --port 5199 --strictPort`（**不要用 5173**，那是主 repo 在跑） |
| AIDesigner 額度 | 訂閱 active · 100 credits · 已用 1（`get_credit_status` 可查） |
| 已完成 | 第一款設計產出並落地 |
| 待辦 | **第二款設計**（本文件 §4）→ 兩款比對 → Scott 拍板 → 移植（§5） |

Scott 的原始指令：`/aidesigner 請重新設計本專案介面`。
範圍經他選定為 **「單頁試點，再擴散」**，試點頁 = `dashboard.html`。

---

## 1. 為什麼是 dashboard.html

`.rail` / `.toolbar` / `.shell` 這層殼是 22 頁共用的，改試點頁的 token 會自動擴散。
而 dashboard 是資訊密度最高的一頁（`src/pages/dashboard.ts` 1,476 行）。

**現況實測診斷**（Interceptor 真 Chrome 截圖，非從 code 推論）：

1. 卡片邊界極弱 —— 三塊內容讀起來像同一片黑，`.d-card` 的框幾乎看不見
2. 頁面下半約 40% 完全空白
3. 「還沒有對應資料夾」那段文案 + `指定專案資料夾` 主按鈕**裸浮在兩張卡片之間**，沒有容器
4. 右上四顆按鈕（重新量測／優化 Dashboard／回編輯台／登出）同等權重，看不出主要動作
5. 第一張卡沒有標題，直接就是「專案／簡寫」表單欄位
6. **完全沒有回答 Q1「下一步做什麼」** —— README 說焦點卡是核心，這頁上沒有

**重要：第 6 點不是 bug，是空狀態。**
`src/pages/dashboard.ts:235-280` 起的 git hero、技術線、治理覆蓋率、UAT 卡
**只在專案綁定磁碟資料夾後才渲染**。沒綁資料夾就塌成一個空表單 —— 空狀態沒有教下一步。

**對照組**：`overview.html` 結構是對的（KPI 條 → 單一焦點卡 + 進度條 + 一顆主按鈕 → 細節）。
dashboard 要達到同樣標準。第一款設計就是照這個方向做的。

---

## 2. 第一款設計 —— 完整規格（**必須保留**）

### 2.1 產物位置

| 東西 | 路徑 |
|---|---|
| 本機 run id | `2026-09-01T18-50-25-802Z-anchorline-project-dashboard-redesig` |
| 遠端 run id | `6012b709-e67b-4cbc-9a97-94d2c6f7a6a0` |
| Canvas id | `18838eff-0f7f-4b19-862c-d3726fc00236` |
| HTML | `.aidesigner/runs/<run-id>/design.html` 與 `.aidesigner/mcp-latest.html` |
| 採用簡報 | `.aidesigner/runs/<run-id>/adoption.json` |
| 截圖 | `~/Downloads/aid-dashboard-design.png` |
| 現況基線截圖 | `~/Downloads/interceptor-capture-20260902-024209-75397.png`（dashboard）、`…-024211-75672.png`（overview） |

生成參數：`design_mode: ultradesign` · `viewport: desktop` · 2m26s · 32.9k tokens。

### 2.2 組織原則

**卡片儀表板**。由上而下：焦點卡 → KPI 條 → 兩欄（工作鏈｜最近活動）→ 底部四欄小卡。
工作鏈是**其中一張卡**，不是頁面骨架。

### 2.3 值得移植的設計決策（設計系統層 —— 這層要精準複製）

1. **「下一步」焦點卡置頂**
   眉標 `下一步` + 副標「目前唯一需要處理的工作」，內嵌一張深一階的內卡：
   左＝圖示方塊 + 標題 + 說明 + 「完成後將建立 sign-off 並更新執行鏈」；
   右＝錨點 chip（虛線框）+ 狀態 chip + 一顆 amber 主按鈕「開始處理 →」。
   **這是解 Q1 與 ADHD 開放迴圈的關鍵，任何一款都必須有。**

2. **三層明度分離** —— 底 `#161920` / 卡 `#1a1d24` / 內卡 `#222630`，框 `#2e323d`（焦點卡用亮一階的 `#3f4451`）。
   現況最缺的就是這個。移植時**換成 token**，見 §5 警告。

3. **KPI 條四格 + 底部進度線**
   `進度 18/27`（下方墊 amber 進度條，`width` 由 JS 補上動畫）／`目前階段 實作中●`／`待處理 3`（紅）／`最後活動 27 分鐘前`。
   比 overview 現在那五個空 `0` 有資訊量。

4. **工作鏈水平視覺化** —— 五個節點：`計畫 → 錨點(Anchor) → Commit → Sign-off → 規格修訂`。
   節點是 42px 圓框，連接線用顏色與虛實表達狀態（已完成綠實線 → 進行中白實線 → 未達虛線）。
   當前錨點節點有 `subtlePulse` 呼吸光暈。
   **這是 Anchorline 差異化第一次變成看得見的東西**，價值最高，也是移植成本最高的一塊。

5. **最近活動表** —— 四欄固定寬：時間(85px) / 作者(100px) / 圖示+事件(彈性) / 錨點 chip。
   每一列都掛錨點 ID = 稽核軌跡具象化。

6. **卡片底部「查看全部 (N) ›」列** —— 分隔線 + amber 文字連結，一致地收在每張列表卡底部。

### 2.4 色票與字體（原稿值，供對照）

```
amber        #f5a524    amberHover  #ffb540
dark(底)     #101115    surface     #161920
card         #1a1d24    cardHover   #222630
border       #2e323d    borderLight #3f4451
text         #e2e8f0    muted       #8b94a5
```
字體：Inter + Noto Sans TC（sans）／JetBrains Mono（mono，用於識別碼、雜湊、時間）。

---

## 3. 第一款的不足 —— 七項（**第二款要避開，移植時要修掉**）

| # | 問題 | 嚴重度 | 處置 |
|---|---|---|---|
| 1 | **擅自重畫了 rail**。提示詞明講「rail 已存在，不要重設計」，它照樣換掉導覽項（工作台／工作鏈／規格／執行記錄／變更／代理程式／設定），跟真實 22 頁結構對不上 | 高 | rail 一律不移植；第二款提示詞要更硬地鎖死 |
| 2 | **外部 CDN 相依**：Tailwind CDN + Phosphor Icons + Google Fonts。這是**本機優先的 Tauri app，離線必須能跑** | 高 | 全部要翻成 `shared.css` + 既有 token；圖示改用 repo 內既有做法 |
| 3 | **色票是它自己發明的**，不是 terminal 主題的實際值 | 高 | 移植時對應回 `--accent` / `--surface` / `--border` / `--fg` / `--muted`，**不得硬編 hex** |
| 4 | **錨點格式錯誤**：用了 `AL-042`。真實格式是 `anc:t=XXXXXXXX`（8 位 hex） | 中 | 內容層改掉；第二款提示詞要寫明真實格式 |
| 5 | **假資料**：人名 `Alex Chen`、路徑 `~/projects/anchorline`、日期 2025-05 | 中 | 內容層一律換成 store 真實資料 |
| 6 | **右下「還沒有工作鏈」空狀態卡與三張有資料的卡並列** —— 同一頁同時說「有鏈」和「沒鏈」，邏輯打架 | 中 | 生成瑕疵，直接刪；空狀態必須是**整頁模式**而不是一張並列的卡 |
| 7 | **`.reveal-item` 進場動畫**（opacity 0 + IntersectionObserver）。桌面 App 每次切頁淡入很煩，而且**背景分頁的 IntersectionObserver 是停的，會讓整頁空白** —— 第一次截圖就踩到 | 中 | 移植時整段砍掉；第二款提示詞要求不要進場動畫 |

另外兩點**不是缺陷但要知道**：

- 它沒有處理「**專案未綁定資料夾**」這個真實空狀態（§1 第 6 點），只給了一個泛用的空卡。這是現況最痛的一頁，第二款應該正面解。
- 底部四欄小卡（專案概覽／規格變更／執行摘要／空狀態）資訊價值不均，第四格是湊數的。

---

## 4. 下一步 —— 第二款設計（本 session 的主要工作）

### 4.1 做法

派**一個子 agent** 去跟 AIDesigner MCP 溝通，主 session 保持 PM 角色不下海。
（依 CLAUDE.md「主 session 不動 code，只派工」。派工前先跑
`bun ${LIFEOS_DIR}/TOOLS/AgentQuota.ts --json` 過閘門。）

子 agent 的任務邊界：**只負責產出設計稿並落地，不移植、不改 repo 的 code。**

### 4.2 建議方向（PM 可改）

第一款是「卡片儀表板，工作鏈只是其中一張卡」。
第二款應該換**組織原則**而不是換配色重骰，否則兩款會長得一樣，比較沒有意義。

**建議：讓治理鏈本身變成頁面骨架。**
一條垂直的鏈貫穿頁面，`計畫 → 錨點 → commit → sign-off → 規格修訂 → release` 每個環節是鏈上的一站，
狀態、產物、負責的 agent、稽核事件都掛在對應那一站旁邊。當前所在位置就是「下一步」。
這樣「一條治理鏈 + 一份落在磁碟上的稽核軌跡」不再是一張卡，而是整頁的閱讀動線。

其他可考慮的方向（擇一，別混）：
- **終端／TUI 風**：高密度、等寬字、鍵盤優先，呼應 `terminal` 主題與「開發者儀器」定位
- **雙欄工作台**：左＝鏈與狀態，右＝實際 PRD 內容，看與寫在同一頁

### 4.3 給子 agent 的提示詞要點

沿用第一款的 `repo_context`（在 `.aidesigner/runs/<run-id>/repo-context.json`，可直接讀出來重用），
提示詞則換組織原則，並**額外加上這些硬約束**（都是第一款踩到的坑）：

- 只設計主內容區。左側 240px rail 已存在且**不得重新設計、不得更動其導覽項**
- 不得使用任何外部 CDN、外部字體、外部圖示庫 —— 產物要能離線渲染
- 不要進場動畫、不要 scroll-reveal、不要 IntersectionObserver
- 錨點識別碼格式是 `anc:t=` 加 8 位 hex，例如 `anc:t=3f9a2c14`
- 必須包含「專案尚未綁定磁碟資料夾」的空狀態，且該空狀態要**教下一步**，不是給一張空表單
- 空狀態與有資料狀態不得同時出現在同一畫面
- 深色為主，但版面結構要靠間距／邊框／字重承載，換成淺色主題不能垮

### 4.4 驗證方式（**這一段照做，否則會拿到空白截圖**）

設計稿產出後：

```bash
# 1. 落地
npx -y @aidesigner/agent-skills capture --html-file .aidesigner/mcp-latest-v2.html \
  --prompt "<最終提示詞>" --transport mcp --remote-run-id "<remote run id>"
npx -y @aidesigner/agent-skills adopt --id "<local run id>"

# 2. 截圖 —— 必須用 VerifyViewport，不要用 Capture.sh
bunx vite --port 5199 --strictPort &
bun ~/.claude/skills/Interceptor/Tools/VerifyViewport.ts shot \
  "http://localhost:5199/.aidesigner/mcp-latest-v2.html" \
  --width 1600 --out ~/Downloads/aid-dashboard-design-v2.png
```

**為什麼不能用 `Capture.sh`**：一般 Interceptor 測試分頁在背景時，Chrome 會停掉整個 rendering
lifecycle —— `requestAnimationFrame`、`IntersectionObserver`、CSS transition 全部不跑，**不報錯**。
第一款就是這樣拍出一張內容區全白的圖。`VerifyViewport.ts` 跑獨立 headless Chrome 且帶反節流旗標，
生命週期是活的。（`preview` 子指令需要 puppeteer，本 repo 沒裝，不要為它裝。）

---

## 5. 移植計畫（兩款都定案、Scott 拍板後才執行）

建議切兩段：

**第一段 · 約 1.5 小時** —— 焦點卡 + 卡片邊界 + KPI 條。
這三個就把 §1 診斷的六個問題全修掉，而且全部落進 `shared.css` token，其餘 21 頁自動吃到。

**第二段 · 約 2-3 小時** —— 工作鏈視覺化。
價值最高但它是全新元件，要接 `src/lib/governance.ts` 的真實錨點資料，不是改樣式而已。

落點：
- `shared.css` —— `.d-card` / `.d-hero` / `.d-eyebrow` 等既有 class 的樣式強化
- `src/pages/dashboard.ts` —— `#dash-root` 的組裝順序（約 `:639`），以及未綁資料夾時的空狀態分支（`:235` 起）

### ⚠️ 移植期間必須遵守

- **一律用既有 token**（`--accent` / `--surface` / `--border` / `--fs-1..9` / `--ctl-h-*` / `--radius-*`），
  不得硬編 hex 或 px。`shared.css` 檔頭自己記著：全檔已有 447 個硬編 px 字級繞過 token 階梯，不要再加。
- **不得引入任何外部 CDN 或字體**。
- **若動到主題**：新增主題要改**四層**（`shared.css` token 區塊 / 14 個 HTML head 的防閃爍 bootstrap / `src/lib/theme.ts` / `src/data/types.ts`），
  每份 bootstrap 內還有兩條退路（`if(!m[t])` 與 `catch`），總共 30 個點。漏改**不報錯，會靜默回退**。
  驗收條件是執行時 `document.documentElement.dataset.theme` 等於目標值 —— 靜態 grep 不算證據。
  （細節見本 repo 的 `CLAUDE.md`。本次移植若不新增主題就不會碰到這條。）
- 驗證一律走 Interceptor（真 Chrome）。`localhost:5173` 是主 repo，**用 5199**。
- 完成後 `bunx tsc --noEmit` + `bun test` 要綠。

---

## 6. 還沒收的線頭

- 第二款設計尚未開始（§4）
- 兩款的並排比較與 Scott 拍板，尚未進行
- 移植尚未開始，`shared.css` / `src/pages/dashboard.ts` **一個字都還沒改**
- 本分支 `redesign-ui-aidesigner` 目前只多了未追蹤的 `.aidesigner/`；要不要把設計產物 commit 進 repo 還沒決定
- 這條線與 PROJECTS.md 記的 Anchorline 主線（`add-vibe-route` 的 8 題實機 UAT 待 Scott）**是分開的兩件事**，不要混

---

## 7. 環境備忘

- 額度查詢：`mcp__aidesigner__get_credit_status`；帳號 `mcp__aidesigner__whoami`（k.aka.s.chen@gmail.com）
- MCP 已連上編輯台 session `c3e6a22a-6bbd-4cc1-a79b-47f24863a442`，
  `generate_design` 會自動把結果送上 canvas。不想送就先 `unlink_editor_session`。
- `generate_design` 的 ultradesign 模式約需 2-3 分鐘，會被移到背景 task，等 `<task-notification>`。
- MCP 回傳的 HTML 在通知裡是 HTML-escaped 的，寫檔時要還原（`&lt;` → `<`）。
  或改用 `mcp__aidesigner__get_canvas` 直接取原始 HTML（代價是再吃一次 context）。
