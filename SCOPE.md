# 開發範圍 — Tauri × MIT 重新基準

> 建立：2026-08-09
> **本文取代** `plans/2026-08-09_dev-workbench-upgrade-eval.md` §六（三階段路線）、§12.3（openspec parser）、§13.4（三選項）中與路線有關的部分。評估與市場對標仍以該報告為準。
> 已完成的 37 步實作（P0–P3）記錄在 `plans/Pm-Spec__2026-08-09-0117__dev-workbench-impl.md`。

---

## 0. 只讀這一段就夠

**產品**：本機優先的開發專案工作台。PRD 撰寫 → 結構 gate → 簽核 → openspec change → commits → PR → release，一條治理鏈，外加一份落在磁碟上的稽核軌跡。

**三個新基準**：桌面獨佔（放棄瀏覽器版）· Tauri 跨平台 · MIT 開源。

**這三件事對已完成的工作是什麼影響**：**47 個 lib 檔裡 39 個一行都不用改**，要重寫的是 1157 行的原生殼。當初把 I/O 全推到呼叫端，代價在這裡回收。

**現在做的第一件事**：W1-1，把 12 個 action 的契約凍結成一份文件——那是 Rust 重寫的規格，也是 MIT 專案的安全介面說明。

---

## 1. 決策基線

| # | 決策 | 來源 | 影響 |
|---|---|---|---|
| D1 | log 分兩份：脫敏摘要進 git、原始流 `.gitignore` | 報告 §八 #1 | 已實作 |
| D2 | bridge 開放 `.anchorline/**.jsonl` append | 報告 §八 #2 | 已實作（Swift），**需 Rust 重做** |
| D3 | 不採用 Backlog.md | 報告 §八 #3 | 連帶讓 D6 成立 |
| D4 | ADR 讀 ISA 的 `Decisions` / `Changelog` | 報告 §八 #4 | 已實作 |
| **D5** | **放棄瀏覽器版** | 本輪 | 刪 19 個 guard、4 檔的編譯期快照 |
| **D6** | **任務勾選／新增寫回 plan 檔**（不做 Kanban） | 報告 §12.1 | 新工作，含併發保護 |
| **D7** | **agent 編排不做**，改產生交接指令 | 報告 §12.2 | 新工作（小） |
| **D8** | **改用 Tauri** 跨平台 | 本輪 | 殼重寫 |
| **D9** | **MIT 開源** | 本輪 | 新增開源化工作 |
| **D10** | **openspec CLI 為唯一真相來源**，取消自建 parser | 本輪 | **取消**原訂 0.5 天，改為 CLI 探測 |

> D10 的理由更正：失敗模式不是「使用者沒裝 openspec」（沒裝的人專案裡也不會有 `openspec/`），而是**「裝了但 GUI 進程找不到」**。那是 PATH 問題，解法是探測（~25 行）不是第二套 parser（80 行）。

---

## 2. 現況盤點：保留／重寫／取消

### 保留（不動）

| 資產 | 量 |
|---|---|
| 純函式 lib（`event-log` `log-views` `focus-card` `openspec-status` `gh-status` `adr` `replay` `plan-parser` `tracking` `git-doctor` …） | **39 / 47 檔** |
| 測試 | **271 綠** |
| 頁面與 CSS | 14 頁 · 8000 行 CSS |
| 事件 schema、機密白名單、月分片、治理鏈定義 | 全部 |

### 重寫（Swift → Rust）

`mac-app-build/main.swift` **1157 行 · 12 個 action**：

```
pickFolder  pickProjectFolder  projectStats  onefetch  fastfetch
trackingScan  readFile  writeFile  openPath  appendFile
openspecStatus  ghStatus  ping
```

TS 端要改的只有 **8 檔**：`tracking-bridge` `status-bridge` `event-writer` `project-stats` `project-folder` `file-editor` `welcome` `pages/projects`。

三個要特別小心的：

- **`appendFile`** — 必須是真 O_APPEND（`OpenOptions::append(true)`），不可 read-modify-write
- **`appendAllowed` 謂詞** — `canonicalize()` 後仍在已註冊根目錄內、限 `.anchorline/**`、限 `.jsonl`
- **git／CLI 子指令白名單** — Tauri shell plugin 要宣告 allowlist，**這是 MIT 專案必須寫進文件的安全介面**

### 取消

| 項目 | 原因 |
|---|---|
| 自建 openspec parser | D10 |
| 19 處 desktop guard 分支 | D5 |
| 4 檔的 `import.meta.glob` 編譯期快照 | D5 |
| Kanban／拖曳／優先級／指派 | 報告 §七（維持） |
| agent 派工執行 | D7 |
| SQLite | 報告 §七（維持） |

---

## 3. 開發範圍：四條工作線

### W1 — Tauri 遷移（殼）

| # | 內容 | 產出 |
|---|---|---|
| W1-1 | **凍結 bridge 契約**：12 個 action 的輸入／輸出／錯誤形狀寫成 `docs/BRIDGE.md` | 重寫規格 + 安全介面文件 |
| W1-2 | Tauri 專案骨架、`tauri.conf.json`、shell plugin allowlist | 可啟動的空殼 |
| W1-3 | 移植 12 個 action（Rust command） | 功能對等 |
| W1-4 | 改寫 8 個 TS bridge 檔：`postMessage` → `invoke()` | 前端接上 |
| W1-5 | 契約測試：同一份輸入，Rust 與規格一致 | 防止移植漏行為 |
| W1-6 | 三平台建置驗證（macOS / Windows / Linux） | CI 綠 |

> **不做**：`onefetch` / `fastfetch` 可以先不移植（歡迎畫面的裝飾），優先移植 `projectStats` / `trackingScan` / `appendFile` / `openspecStatus` / `ghStatus` 這五個承載功能的。

### W2 — 功能補完

| # | 內容 | 依賴 |
|---|---|---|
| W2-1 | **openspec CLI 探測**：使用者指定路徑 → PATH → 常見安裝點（三平台）→ `npx` → 一鍵複製安裝指令 | W1-3 |
| W2-2 | 焦點卡接上真的 `openspecPct`（目前硬寫 `null`） | W2-1 |
| W2-3 | **任務勾選／新增步驟寫回 plan 檔** | W1-3 |
| W2-4 | **併發保護**：寫入前重讀，比對 mtime 與錨點集合，不一致就擋 | W2-3（**硬性，不可省**） |
| W2-5 | **agent 交接指令產生器**（`git-doctor` 模式，只產生不執行） | — |
| W2-6 | 刪 19 個 guard、4 檔編譯期快照 | W1-4 |

> W2-4 沒做就別上 W2-3。整檔覆寫會靜靜吃掉 agent 剛寫的內容，而且沒有任何錯誤訊息——那比功能沒做更糟。

### W3 — 開源化

| # | 內容 |
|---|---|
| W3-1 | `LICENSE`（MIT）、`README` 重寫（定位、安裝、需求、截圖） |
| W3-2 | **`docs/SECURITY.md`**：shell allowlist、`appendAllowed` 謂詞、為什麼不執行 `gh pr review` 與 agent 派工 |
| W3-3 | `CONTRIBUTING.md` + issue 範本 |
| W3-4 | **與上游的相容承諾寫進 README**：「不解析 `spec.md`，該段一律呼叫 OpenSpec CLI」 |
| W3-5 | GitHub Actions：三平台 build + test |
| W3-6 | 資料落點文件：`.anchorline/log` 是什麼、為什麼預設 gitignore、怎麼脫敏匯出 |

> W3-2 不是形式。這個 App 讀得到使用者所有專案資料夾、會寫檔、會跑 CLI——**MIT 專案不把這三件事講清楚，第一個看原始碼的人就會開 issue**。

### W4 — 散佈（**待決，見 §5**）

| # | 內容 | 條件 |
|---|---|---|
| W4-1 | GitHub Releases + 三平台產物 | 無條件 |
| W4-2 | macOS 簽章 + notarization（Apple Developer US$99/年） | 只在要給別人用時 |
| W4-3 | Windows 簽章 | 同上（否則 SmartScreen 擋） |
| W4-4 | Homebrew cask / winget | 有 W4-2/3 才有意義 |

---

## 4. 順序與時程

```
W1-1 凍結契約 ─┬─ W1-2 骨架 ─ W1-3 移植 ─ W1-4 前端接線 ─ W1-5 契約測試 ─ W1-6 三平台
               └─ W3-2 安全文件（同一份契約，兩個產物）

W1-4 完成後：W2-1 探測 → W2-2 openspecPct
             W2-3 勾選 → W2-4 併發保護（綁定）
             W2-5 交接指令（可並行）
             W2-6 刪 guard（最後做，避免遷移中兩邊對不上）

W3-1/3/4/5/6 全程並行
W4 待 §5 回答
```

| 工作線 | 估計 |
|---|---|
| W1 Tauri 遷移 | **6–9 天**（移植 5 個核心 action 3 天、其餘 2 天、契約測試與三平台 2–4 天） |
| W2 功能補完 | **2.5 天** |
| W3 開源化 | **2 天** |
| **合計** | **10.5–13.5 天**（不含 W4） |

**每條工作線的出貨儀式**（C1 對策，產出物離開電腦才算完成）：

- W1 → 在一台非 mac 機器上（或 VM）跑起來，截圖
- W2 → 錄一段勾選步驟並看到事件寫進 log 的操作
- W3 → repo 轉公開，README 有截圖

**停損條件**：

| 工作線 | 出現這個就停 |
|---|---|
| W1 | 移植三個核心 action 之後仍無法在 Windows 跑起來 → 退回 macOS-only，Tauri 只當單平台殼 |
| W2-3 | 併發保護做不到可靠偵測 → 改成唯讀，勾選回終端做 |
| W3 | 安全文件寫不出來（代表某個介面自己也說不清） → 先改那個介面，不要先開源 |

---

## 5. 待決一件事

**這個軟體會有你以外的使用者嗎？**

MIT 開源實質上已經回答了——**會**。所以：

- **W4-2 / W4-3 簽章要排進去**。未簽章的 macOS App 會被 Gatekeeper 擋、Windows 會被 SmartScreen 擋。開源專案可以叫人自己 build，但那會篩掉九成的人。
- 成本：Apple US$99/年 +（Windows 憑證另計）。

**在你另外指示之前我採預設：W1–W3 先做完再處理 W4。** 理由是簽章解的是散佈問題，而現在還沒有東西可散佈。

---

## 6. 明確不做（更新版）

| 不做 | 為什麼 |
|---|---|
| 瀏覽器版 | D5。降級路徑的維護成本 > 價值 |
| 自建 openspec `spec.md` parser | D10。上游格式會演進；不解析是對 OpenSpec 生態的相容承諾 |
| Kanban／拖曳／優先級／指派／到期日 | Linear 的形狀，做進來就是兩套任務系統 |
| agent 派工執行 | 要讓原生端跑 JS 傳來的任意 prompt，直接拆掉整個注入防護 |
| `gh pr review --approve` 等寫入 | 不可逆對外動作，沿用 `git-doctor.ts` 的界線 |
| PR diff 檢視器 | 過度專注黑洞，看 diff 去 GitHub／IDE |
| SQLite | 單人量級換不到查詢優勢，卻換來二進位進 git 與 agent 寫不進去 |
| 內嵌 openspec sidecar | **暫緩**。先做探測，等真的有人回報找不到再說（見報告 §14） |
| 雲端同步／多人伺服器 | 本機 + 檔案 + git 就是產品邊界 |
