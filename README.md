# Anchorline

**本機優先的開發專案工作台。** 一條治理鏈，加一份落在磁碟上的稽核軌跡。

缺的從來不是一個資料庫，是一把 join key。`plans/*.md` 的 checkbox、git commit、
簽核、openspec change 各有各的身分，對不起來就只能各自顯示。Anchorline 給每個
工作單元一個穩定錨點（`<!-- anc:t=XXXXXXXX -->`），四份資料才串得成一條線。

> 前身為 SpecForge / PM-SPEC+SCVB。舊的 `sf:` 錨點仍可讀取。

```
PRD 撰寫 → 結構 gate → 簽核 → openspec change → commits → PR → release
```

市面上的 AI 開發工作台都在解「怎麼讓 agent 跑得更多」。這個解另一件事：
**怎麼證明這些 agent 做的事是被治理過的。**

> ⚠️ **早期階段。** 目前產物**未簽章**，macOS 會被 Gatekeeper 擋、Windows 會被
> SmartScreen 擋。簽章與 notarization 尚未做（見 `docs/SCOPE.md` W4）。

---

## 它解決什麼

一個開發專案工作台要回答四個問題。多數工具答得出前兩個：

| | 問題 | 這裡怎麼答 |
|---|---|---|
| Q1 | 下一步做什麼？ | 焦點卡 · openspec 的第一個 `ready` artifact |
| Q2 | 現在到哪了？ | plan checkbox × openspec artifact 的加權 rollup |
| Q3 | **為什麼變成這樣？** | 決策紀錄（讀 ISA 的 `Decisions` / `Changelog`） |
| Q4 | **實際發生了什麼？** | append-only 稽核軌跡 |

Q3 與 Q4 是差異化所在。2026 年 ADR 復甦的理由很直白：**AI agent 現在寫掉大部分
程式碼，而看不到「為什麼」的 agent 會很開心地把理由重構掉。**

### 一個市面上沒有的機制

`authorAgentFamily` — **同一個 agent 族系撰寫的文件，不能由同族系核准。**

GitHub 的 CODEOWNERS 與 branch protection 只認人，不認 AI 族系，抓不到這一類。
治理鏈 replay 會把違規標出來——一條沒有標示違規的治理鏈沒有說服力。

---

## 主要畫面

| 畫面 | 回答 |
|---|---|
| **專案總覽** | 焦點卡（下一步／進度／上次動／待推）+ 跨 repo PR 雷達 |
| **編輯台** | PRD 引導撰寫 + 結構 gate + Markdown 即時預覽 |
| **審閱** | 簽核關卡，gate 未過擋核准 |
| **Task Tracking** | `plans/*.md` 進度、可直接勾選、右欄稽核軌跡三層 |
| **Agents** | Agent 角色、prompt、進場作業 |

設計上有一條貫穿的取捨：**一次只指一個。** 焦點卡欄位硬性封頂 4 個，
其餘專案摺疊；稽核軌跡預設停在「回到工作」三行，完整時間軸要點兩下才到。
理由寫在 `src/lib/focus-card.ts` 與 `src/lib/log-views.ts` 的檔頭。

---

## 安裝

### macOS — Homebrew

```bash
brew install --cask shigachentw/tap/anchorline
```

⚠️ **產物未簽章**，所以第一次開會被 Gatekeeper 擋（Homebrew 預設會蓋
quarantine 屬性）。裝完跑一次：

```bash
xattr -dr com.apple.quarantine "/Applications/Anchorline.app"
```

或在 Finder 對 `Anchorline.app` 按住 Control 點一下，選「打開」。

更新與移除：

```bash
brew upgrade --cask anchorline
brew uninstall --cask anchorline
```

### 直接下載

[Releases](https://github.com/ShiGaChenTW/anchorline/releases) 有 macOS
（universal `.dmg`）、Windows、Linux 的產物。Gatekeeper／SmartScreen 的
處理同上。

### 自行建置

```bash
git clone https://github.com/ShiGaChenTW/anchorline.git
cd anchorline
bun install
bun run tauri build          # 產物在 src-tauri/target/release/bundle/
```

### 需求

| | 版本 | 必要性 |
|---|---|---|
| [Bun](https://bun.sh) | ≥ 1.3 | 必要 |
| [Rust](https://rustup.rs) | ≥ 1.77 | 必要 |
| `git` | 任意 | 必要（沒有它就沒有專案統計） |
| [`openspec`](https://github.com/Fission-AI/OpenSpec) | ≥ 1.6 | 選用 · `npm i -g @fission-ai/openspec` |
| [`gh`](https://cli.github.com) | 任意 | 選用 · PR 雷達要用 |

**選用的 CLI 找不到時不會報錯**，畫面會顯示一行安裝提示。App 會依序找：
你在設定裡指定的路徑 → `PATH` → 三平台常見安裝點。找不到就在設定裡填絕對路徑——
任何猜路徑的邏輯都會漏掉某個人的環境。

平台：macOS · Windows · Linux（CI 三平台都建置，但目前只有 macOS 有實機驗證）。

---

## 開發

```bash
bun run dev            # 只跑前端（vite）
bun run tauri dev      # 完整 App
bun run typecheck
bun test ./tests/*.test.ts
cd src-tauri && cargo test    # 契約測試
```

```bash
bun run track          # 終端 TUI：plans/ 進度，j/k 切換，i 補鑄錨點
bun run track:frame    # 印一張完整畫面就結束（截圖／CI 用）
bun run backfill       # 把 git 歷史回填成稽核軌跡（冪等）
```

### 架構

```
src/lib/        47 個模組，其中 40 個是純函式（I/O 全推到呼叫端）
src/lib/native.ts   ← 原生 bridge 的唯一入口
src-tauri/      Rust 殼，12 個 action
docs/BRIDGE.md  ← 契約：移植規格 + 契約測試依據 + 安全介面說明
```

判定邏輯一律是純函式、`nowMs` 一律可注入。那不是潔癖：從 WKWebView 換到
Tauri 時，47 個 lib 檔裡有 39 個一行都不用改。

---

## 與 OpenSpec 的關係

**這個專案不解析 `openspec/specs/*.md` 的內文。**

Requirement / Scenario / delta 的語法是 OpenSpec 上游的活規格，自己解析等於
維護一份會分岔的第二實作。我們只呼叫官方 CLI 的 `--json`，並且只在原生端做
一件最小解析——從 `list --json` 取出 change 名稱，為了跑下一輪 `status`。

這是一句**對上游的相容承諾**，不是實作細節。要改它請先開 issue。

---

## 文件

| | |
|---|---|
| [`docs/BRIDGE.md`](docs/BRIDGE.md) | 12 個 action 的契約 |
| [`docs/SECURITY.md`](docs/SECURITY.md) | 安全模型 · 為什麼沒有 shell plugin · 已知弱點 |
| [`docs/DATA.md`](docs/DATA.md) | 資料落在哪、進不進 git、事件長什麼樣 |
| [`docs/SCOPE.md`](docs/SCOPE.md) | 開發範圍與工作線 |
| [`docs/SPEC-live-tracking.md`](docs/SPEC-live-tracking.md) | 「哪一份是 agent 此刻正在寫的」判定規格 |
| [`docs/GUIDE-github-pr.md`](docs/GUIDE-github-pr.md) | PR 機制說明（給 PM 與 AI 開發者） |

---

## 貢獻

見 [`CONTRIBUTING.md`](CONTRIBUTING.md)。三件事先講：

1. **安全界線的改動**（`src-tauri/src/paths.rs`、`exec.rs`）請先開 issue 討論
2. `docs/BRIDGE.md` 是契約，改行為就改文件，不要只改實作
3. 判定邏輯請寫成純函式並注入 `nowMs`——那是這個 codebase 唯一的硬性風格要求

## 授權

[MIT](LICENSE) © 2026 ShiGaChenTW
