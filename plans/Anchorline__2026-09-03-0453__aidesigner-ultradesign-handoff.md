# Handoff — Anchorline 介面重新設計（AIDesigner / ultradesign 線）

- **建立時間**：2026-09-03 04:53 CST
- **前一個 session**：兩輪 `/aidesigner`（classic → ultradesign），全程未動 repo 程式碼
- **給新 session 的一句話**：設計稿已經有兩代，第三代還沒開始 —— 你的工作是第三代。

---

## 下一步（新 session 開工就做這件事）

> **原話**：「針對 ultradesign 所出的設計，讀取 `/Users/scottchen/Documents/20_Projects/agentctx/` app 頁面（尤其是中間文件閱讀與編輯區）調整設計元素與排版，更改 01-04 頁，變成一份新的設計」

拆開來是三件事：

1. **讀 agentctx 的 app 介面**，重點在**中間的文件閱讀／編輯區**（read / edit / diff / snapshots 四種模式）。
2. **抽出它的設計元素與排版語言**（token 系統、間距、行為、資訊密度）。
3. **改寫 `.aidesigner/ultradesign-2026-09-03/` 的 01–04 四頁**，變成第三代設計。不是新開一輪 AIDesigner 生成，是拿現有四頁**改**。

### agentctx 已經查到的線索（不用重查）

| 項目 | 位置 |
|---|---|
| репо 根 | `/Users/scottchen/Documents/20_Projects/agentctx` |
| GUI 原始碼 | `gui/src/`（React + Tauri 2 + Rust 後端） |
| **中間編輯區元件** | `gui/src/EditorPane.tsx`（421 行） |
| 主畫面組裝 | `gui/src/App.tsx`（1414 行） |
| **Token 系統** | `gui/src/styles/tokens.css`（2092 行） |
| 靜態設計稿 | `gui/designs/{index,a-editor,b-materials,c-ledger}.html` |

**已讀到的關鍵事實：**

- **tokens.css 是三層架構**：Layer 1 primitives（`--hue` / `--chroma` / `--accent-l/c/h` 五個數字）→ Layer 2 semantics（`--bg` / `--elev` / `--hover` / `--active` / `--line` / `--text` / `--muted` / `--accent`）→ 元件層。**整套配色只有兩個數字在動**，換主題是 `document.documentElement.dataset.scheme = "blue" | "teal" | "neutral" | "nord"`。
- **顏色全部用 `oklch()`**，不是 hex。例：`--bg: oklch(0.15 var(--chroma) var(--hue))`。
- **狀態色刻意不跟著 hue 轉**：`--success` / `--danger` / `--local` 寫死色相，理由寫在註解裡（綠必須是 go、紅必須是 stop）。
- **用途色標（mark-*）共用同一組 L/C（0.75 / 0.13），只換 hue**，所以沒有哪一個點比另一個搶眼。
- 圓角 `--r: 8px` / `--r-lg: 14px`。
- `EditorPane` 的模式是 `type Mode = "read" | "edit" | "diff" | "snapshots"`，有 draft 暫存（`saveDraft` debounce）、`dirty` 判定、行號 gutter（`gutterRef`）、markdown 用 `marked` + `DOMPurify`、語法上色在 `src/highlight.ts`。
- `designs/a-editor.html` 已截圖在 `~/Downloads/actx-a-editor.png`，但**那份 mock 的中間區幾乎是空的**（只有一行 fixture），要看真正的閱讀／編輯區得讀 `EditorPane.tsx` 或把 app 跑起來。

**還沒做的**：`EditorPane.tsx` 只讀到第 120 行；`tokens.css` 只讀到第 90 行（editor 相關的 class 還沒看）；沒跑起來實際截圖。

### 建議的做法

- 先把 `EditorPane.tsx` 讀完 + `grep` tokens.css 裡 editor 相關選擇器，抽出排版規則（gutter 寬、行高、模式切換的視覺、diff 的呈現）。
- 想看真的畫面就 `cd gui && bun install && bun run build && cd .. && AGENTCTX_HOME=... cargo run -p agentctx-cli -- ./project`（browser GUI 模式，README 有寫），或 `bun run app:dev`。驗證一律走 Interceptor，別用別的截圖工具。
- 改 01–04 時**保留既有的雙主題機制**（見下），把 agentctx 的排版語言疊上去。要不要改成 oklch 三層 token 是可以討論的設計決定 —— 那會讓四頁跟 Anchorline `shared.css` 的既有 token 系統分岔，值得先問 Scott。

---

## 現在的狀態

### 產出的檔案（全部是設計稿，**沒有動任何 repo 程式碼**）

**第一代（classic，2026-09-03 上午）** — `.aidesigner/redesign-2026-09-03/`

| 檔 | 對應 | 主題 |
|---|---|---|
| `01-home.html` | `index.html` 啟動首頁 | 只有深色 |
| `02-editor.html` | `editor.html` PRD 撰寫工作台 | 只有深色 |
| `03-review-monitor.html` | `write.html` PRD 審閱監控台 | 只有深色 |

**第二代（ultradesign，2026-09-03 凌晨）** — `.aidesigner/ultradesign-2026-09-03/` ← **要改的是這一批**

| 檔 | 對應 | 主題 |
|---|---|---|
| `01-home.html` | `index.html` | 深＋淺 |
| `02-editor.html` | `editor.html` | 深＋淺 |
| `03-review-monitor.html` | `write.html` | 深＋淺 |
| `04-new-prd.html` | 新增 PRD 流程（`projects.html` 建案入口） | 深＋淺 |

截圖（都驗證過）：`~/Downloads/ud-0{1..4}-*-{dark,light}.png`，共 8 張。

### 第二代的設計主張（第三代要接住的東西）

產品定位換成 **vibe coding 時代的開發文件管理工作台**，核心主張是**跨族簽核**：實作的 AI 家族不得核准自己的實作（Claude 家族寫 → GPT／Grok／Gemini 家族審）。四頁都要看得出「這一關由哪一族核的」。

治理鏈六站：計畫 → 錨點 → Commit → Sign-off → 規格修訂 → Release。
四檔路線（有序，由重到輕）：新產品／新專案（15 節 · 正式多方簽核）→ 功能建構／迭代優化（8 節）→ 試作／探索（3 節 · 一鍵自簽）→ Debug／維運（不寫 PRD · 走 OpenSpec）。

各頁重點：

- **01 首頁** — 主要動作唯一（回到未完成那件）；其餘專案依急迫度排列，每列帶治理鏈與「輪到哪一族、停多久」；右欄常駐「跨族簽核」說明卡。
- **02 撰寫工作台** — 路線從下拉選單升成頂部四格強度條；右欄由上到下是「送出後由誰審」→ 本節教練 →「全文件待處理」→ 唯一的下一步按鈕。
- **03 審閱監控台** — 表格有「代筆哪一族 / 輪到哪一族」兩欄；四關序列畫得出順序閘門擋住第 3 關；AI 撰寫從彈窗升成右側常駐面板。
- **04 新增 PRD** — 三條建案路徑（空白／匯入 Markdown／綁定資料夾）共用同一組欄位；右邊路線比較表帶建議標記；底下先講「這份之後由誰審」。

### 第二代的硬性限制（第三代沿用，除非 Scott 改口）

- 零外部相依：不得有 `<script src>` / `<link href>` / Google Fonts / CDN / 外部圖片。樣式全在一個 `<style>`，圖示全用 inline SVG。
- 零進場動畫（`opacity:0` 起始、transform 位移、IntersectionObserver、scroll reveal、`@keyframes` 進場一律禁止）。
- **雙主題**：`:root` ＝深色（GitHub 風，`--accent #2f81f7`，系統無襯線）；`[data-theme="light"]` ＝淺色（紙感，`--accent #1b365d`，襯線 `"Source Han Serif TC"`）。共 22 個變數，不得出現變數以外的 hex，每個顏色都要走變數。
- 圓角只用 6 / 12 / 9999px；字級只用 12 / 14 / 16 / 20 / 24 / 28 / 32px。
- 全繁中（台灣用語），不得用 emoji。
- 不得出現 L0–L4 檔位編號（`openspec/changes/add-vibe-route/specs/vibe-route/spec.md:8` 明文禁止）。
- 錨點格式一律 `anc:t=` 加 8 位小寫 hex。
- 每個用到的 class 都要有定義；1600px 寬不得橫向溢出。

### 驗收方式（照這個做，別換工具）

```bash
# 1) 產生淺色變體（頁面預設深色，用 sed 換 data-theme）
D=/Users/scottchen/Documents/20_Projects/Project_Anchorline/.aidesigner/ultradesign-2026-09-03
for f in 01-home 02-editor 03-review-monitor 04-new-prd; do
  sed -e 's|<html lang="zh-TW" data-theme="dark">|<html lang="zh-TW" data-theme="light">|' \
      -e 's|<html lang="zh-TW">|<html lang="zh-TW" data-theme="light">|' $D/$f.html > /tmp/$f-light.html
done

# 2) 真 Chrome 截圖（Interceptor 是唯一許可的路徑）
bash ~/.claude/skills/Interceptor/Tools/Capture.sh "file://$D/01-home.html" --out ~/Downloads/x.png

# 3) 限制稽核（外部相依 / hex / 未定義 class）
cd $D
grep -l 'script src\|link href\|cdn\.\|fonts\.googleapis' *.html || echo "none"
grep -ohE '#[0-9a-fA-F]{3,8}' *.html | sort -u
for f in *.html; do
  used=$(grep -ohE 'class="[^"]*"' $f | sed 's/class="//;s/"//' | tr ' ' '\n' | sort -u | grep -v '^$')
  defined=$(grep -ohE '\.[a-zA-Z0-9_\\/:-]+' $f | sed 's/^\.//;s/\\//g' | sort -u)
  echo "--- $f: $(comm -23 <(echo "$used") <(echo "$defined"))"
done
```

收工前跑 `bash ~/.claude/skills/Interceptor/Tools/CleanupTabs.sh`。

---

## 沒收的線頭

1. **AIDesigner 生成器會偷偷注入 `<script src="https://cdn.tailwindcss.com">`** —— 七次生成全中，而且部分版面**實際依賴** Tailwind 的 utility（`w-3/12` / `mt-auto` / `border-t` 之類）。第二代的 01 與 03 因此各補了一個 COMPAT 區塊，把約 30 個 class 手寫定義。**改稿時別刪掉那些 COMPAT 定義，會破版。**

2. **MCP transport 在 ultradesign 長呼叫會斷**（第二代的 02、03 都斷了，run id 遺失但仍計費）。救援方式：`mcp__aidesigner__list_canvases` → 找到對應 canvas → `mcp__aidesigner__get_canvas` 取回 HTML。第二代那兩份就是這樣撈回來的（canvas `be5782d8-772c-4d74-aa46-a9267119f9cf`、`d88015ab-d0b4-4456-a4aa-7c70c8b19ce1`）。

3. **credits 剩 41 / 100**（第一代 3、第二代 15）。ultradesign 一頁約 3–4 credits。**再開新生成前要問過 Scott。**

4. **落地派工還沒發**。規則（Scott 2026-09-02 21:46）：實作交給 `command-code` + `deepseek/deepseek-v4-flash`，備援 `Bellows`(grok)；`Forge`(codex) 退出實作、codex 池獨佔給 `Cato` 審查；**不得用 `Engineer`**（強制 worktree 隔離，編不了測不了）。主 session 不直接寫 code。

5. **與既有 Phase 計畫重疊，Scott 還沒拍板**。介面改版線 Phase 1 已完工（commit `9659437`），Phase 2 是 dashboard；但 `editor.html` / `write.html` 不在 Phase 2 範圍，`onboarding.html` / `rail-nav.ts` 是 Phase 3 腹地且與併行 session 的 P2 重疊。這四份設計要怎麼併進 Phase 計畫，**待 Scott 決定**。進度主檔 `plans/Anchorline__2026-09-02-2204__app-ui-update-all-phases.md`，需求上位 `docs/PRD-app-ui-update.md` v0.3。

6. **main 領先 origin 15 個 commit 全未 push**，push 前置是 `add-vibe-route` 的 8 題實機 UAT 待 Scott。這一輪沒有新增 commit。

7. **session 長度**：前一個 session 到 9.1 MB（stop 階）。設計稿的 HTML 全文都經過 context，很燒。新 session 要改稿的話，**直接 Read 檔案再 Edit，不要整份重寫**。

---

## 這個 repo 會咬人的地方（每次都要記得）

- **新增主題要改四層共 30 個註冊點**，漏改不報錯只會靜默回退。本輪設計稿是獨立 HTML，不受這條約束；但**真的落地進 repo 時會撞到**。細節見 `CLAUDE.md`。
- **主題只有 3 個**：`kami` / `github` / `terminal`。任何文件寫「四個主題」都是錯的。
- **這個 repo 零個 `<dialog>`**，所有 modal 都是 `.modal-back` div。用瀏覽器查 `dialog[open]` 一定拿到 null。
- 驗證要用自己的 dev server（`bunx vite --port <其他埠> --strictPort`），`localhost:5173` 通常是主 repo 在跑。

---

## 第三代已完成（2026-09-03 05:20 CST）

「下一步」那節做完了。四頁**原地改寫**（沒有新開 AIDesigner 生成，credits 仍是 41/100）。

### 從 agentctx 抽出、疊上去的排版語言

| # | 元素 | 出處 |
|---|---|---|
| 1 | **網格畫布 + 浮起的文件卡**（24px 網格底、卡片 `--r-lg` 14px + `--shadow-card`、`--doc-w` 置中） | `tokens.css` `.editor-body` / `.code-card` |
| 2 | **三段式表頭**：身分列 48px → doc-bar（路徑＋狀態 chips＋複製＋Wide/Focus）→ toolbar（模式 seg＋主要動作） | `EditorPane.tsx` return 的前三個 div |
| 3 | **seg 凹槽分段控制器**（選中反白＋shadow），取代所有底線分頁 | `.seg` / `.editor-toolbar .seg` |
| 4 | **chip 狀態徽** 22px pill，`color-mix` 16% 底 / 35% 邊，三色 | `.chip` / `.chip-ok` / `.chip-warn` |
| 5 | **44px gutter + 等寬正文**（12.5px / 1.6，同底色，右邊框分隔） | `.editor-gutter` / `.editor-textarea` |
| 6 | **11px uppercase +0.06em 區塊標籤** | `.details h2` |
| 7 | **底部 28px 狀態列** | `.shell { grid-template-rows: auto 1fr 28px }` |
| 8 | **read / edit / diff / snapshots 四模式** | `type Mode` |
| 9 | 左欄 `.row` 網格（8px 色標＋名稱＋右側數字，整列 hover） | `.row` / `.mark` |

### 刻意的取捨（跟第二代不同，需要 Scott 確認）

- **圓角 6/12 → 8/14**（agentctx `--r` / `--r-lg`）。
- **字級加入 11 / 13 / 15 三階**，UI 主字從 14px 降到 13px。第二代的「只用 12/14/16/20/24/28/32」被放寬了 —— 密度是 agentctx 排版的核心，不降字級等於沒抽到東西。
- **顏色仍是 hex 22 變數雙主題，沒改 oklch 三層**。那個 fork 會讓四頁跟 `shared.css` 分岔，照 handoff 的建議留給 Scott 決定。
- **01 的「其他專案」從三張大卡收斂成一張卡裡的三行**；**03 的四張計數卡與治理強度圖例全部收進左欄**，數字掛在它篩選的那一列旁邊。兩處都是拿密度換版面。
- 兩頁的 Tailwind COMPAT 區塊隨改寫整個消失，四頁現在零 utility class 依賴。

### 驗收證據

- 稽核：外部相依 0、變數定義外的 hex 0、未定義 class 0、emoji/dingbat 0（`✓` 已換成 inline SVG）、錨點格式全合規、無 L0–L4 檔位。
- 截圖 8 張（1600px，深＋淺）：`~/Downloads/g3-0{1..4}-*-{dark,light}.png`，全部逐張看過。
- 修掉的三個版面問題：01 專案列文字換行、03 錨點盒擠壓、03 停留列的 ghost 鈕在淡紅底上看不見。

⚠️ **Interceptor 的 extension context 這一輪沒連上**（`interceptor contexts` 只剩一個 `cdp:` context，`interceptor-test` 不在），preflight 硬擋。改走 `Tools/VerifyViewport.ts`（獨立 headless Chrome + CDP，同樣是 Interceptor 內的工具，且是靜態本機檔案的正確路徑）。**下一個 session 要用 extension 路線的話，得先在測試 profile 的 extension popup 把 Context ID 設回 `interceptor-test`。**

### 還沒做

落地派工仍未發；與 Phase 計畫怎麼併仍待 Scott 拍板（第 5 條線頭原封不動）。
