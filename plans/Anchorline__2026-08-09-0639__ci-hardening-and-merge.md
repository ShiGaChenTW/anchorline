# 改名落地 · CI 硬化 · PR #1 合併

**建立時間：** 2026-08-09 06:39
**最後更新：** 2026-08-09 06:39
**狀態：** 已完成

## 目標

補上這一輪的執行紀錄。規劃在 `plans/2026-08-09_rename-to-anchorline.md`（runbook），
這份記的是**實際發生了什麼**，特別是三件 runbook 沒預料到的事。

兩個 session 並行作業，序列化交接。PR #1 已合併（`8984c20`），`origin/main` 含 32 個 commit。

---

## Plan Steps

- [x] 改名 SpecForge → Anchorline：身分識別碼 · join key 錨點 · 文件 · localStorage <!-- anc:t=TNG5PQ64 -->
- [x] 修 Windows CI ①：補 `src-tauri/icons/icon.ico` <!-- anc:t=9V5GJAM3 -->
- [x] 修 Windows CI ②：`exec.rs` 的 CLI 探測補 `.exe`（原本只試 `.cmd`） <!-- anc:t=A5Z2JPD7 -->
- [x] 修 `hookInstallSnippet()`：檔案路徑來自 stdin JSON，不是環境變數 <!-- anc:t=YS8MQHDD -->
- [x] 安裝 PostToolUse hook 到 `~/.claude/settings.json` 並實測觸發 <!-- anc:t=NEG9PDH6 -->
- [x] PR #1 四平台 CI 全綠後合併 <!-- anc:t=Z955QG4V -->
- [ ] `~/Documents/20_Projects/Project_PM-SPEC+SCVB` 那個 worktree 執行 `git pull`（落後 33 commit，需 Scott） <!-- anc:t=3TSDJY47 -->

---

## 三件值得記下來的事

### 1. Windows CI 從第一天就是紅的，只是這個 repo 從來沒跑過 CI

兩層原因，**都先於改名**：

| # | 原因 | 為什麼只有 Windows 會爆 |
|---|---|---|
| ① | 缺 `src-tauri/icons/icon.ico` | `tauri-build` 只在 Windows 需要它產 resource file |
| ② | `exec.rs` 的 `exe_name()` 只回 `{tool}.cmd` | `.cmd` 是 npm global 的 shim；原生二進位是 `.exe`。**等於 `git` 與 `gh` 在 Windows 上永遠找不到**，而那兩個是必要依賴 |

②是真 bug 不是測試問題。抓到它的是 `locate_finds_a_universally_present_binary`
（macOS/Linux 找 `sh`、Windows 找 `cmd`）。

**這個 bug 在 macOS 上跑一萬次都不會紅，用 Docker 驗的 Linux 也抓不到**——那邊
根本沒有副檔名這回事。修法改成依 `PATHEXT` 產生候選清單，並補
`exe_candidates_covers_exe_and_cmd_on_windows` 守住。

> 教訓：`artifacts/W1-linux-verify.md` 當時寫「沒證明 Windows」是對的，
> 但我沒有把它當成**待辦**看待，只當成免責聲明。三平台 CI 第一次跑就抓到兩個。

### 2. 安全謂詞的改名要「先看它紅」

`.specforge` → `.anchorline` 在 `src-tauri/src/paths.rs` 是 `append_allowed()` 的
字面值。流程是**先改測試斷言、確認它紅、再改實作**。

不先看紅的話，無法區分兩件事：

- 測試真的在守著那個目錄名
- 測試守著一個**已經不存在**的目錄名（也會綠，因為斷言與實作一起改了）

安全謂詞的測試特別容易落入後者——它們斷言的是「不允許」，而不允許的東西
永遠不允許，改錯目標一樣過。

### 3. 稽核軌跡的第一筆活體事件

事件流 74 → 75 筆。前 74 筆全是 `bun run backfill` 從 git history 倒灌的
commit hash；第 75 筆是 PostToolUse hook 在編輯 `src/lib/event-writer.ts` 時
自己寫的，subject 就是那次編輯本身。

`hookIsLive()` 首次能回 `true`。它的判準是「最近有沒有 `actor.kind = hook` 的事件」
而不是「設定檔寫了沒」——那個設計到這一刻才第一次被真實資料驗證。

**`hookInstallSnippet()` 原本是壞的**：用 `$CLAUDE_TOOL_FILE` 取路徑，而那個
環境變數不存在（PostToolUse 的路徑在 stdin JSON 的 `.tool_input.file_path`）。
照原樣貼進 `settings.json` 的話，每筆事件 subject 都是空字串，而 hook 照樣 exit 0。

**更糟的是釘死它的那條測試**：

```ts
expect(cmd).toContain('${CLAUDE_TOOL_FILE#$r/}');   // ← 斷言字串長相，不是行為
```

它把 bug 鎖在綠燈裡。一個永遠不會紅的錯誤比沒有測試更糟——它讓人以為那條
路徑被覆蓋了。已改成真的執行那段指令、用 App 自己的 `parseLog` 驗回來，
並涵蓋含空白與中文的路徑。

> 這與 `CONTRIBUTING.md` 寫的「測『這裡搞砸會怎樣』，不是測覆蓋率」直接矛盾——
> 規則寫在同一輪，違反也發生在同一輪。

---

## 決策紀錄

- 06:05 — 兩個 session 序列化而非並行。改名是全域字串替換，跟任何並行編輯都會衝突
- 06:20 — `anchorsOf()` 與 `plan-parser` 的 `ANCHOR_RE` 合併成單一 source。原本兩份一模一樣的正規表示式，只改一份的話 `anchorsOf()` 讀不到新錨點，而**衝突偵測的斷言全是自洽的，一條測試都不會紅**
- 06:25 — e2e fixture 的 `sf:` 錨點**保留不翻**，改當舊錨點相容性證據，並補一條「新鑄必須 `anc:`、既有 `sf:` 一個位元組不動」的斷言。盲目翻成新前綴會弄丟唯一一條端到端相容覆蓋
- 06:30 — 裸 `SCVB` / `S.CodingFlow` 保留。那是借用的方法論署名不是產品品牌，改掉會變成冒認出處
- 06:35 — hook 加 `.anchorline/` 存在才寫的 guard。全域 hook 沒有它會在每個 repo 長出目錄；`mkdir -p .anchorline/log` 當開通動作，**明確的 opt-in 比聰明的自動偵測容易解釋**
- 06:39 — 走 PR 而不是直接推 main。CI 只在 push to main / PR 觸發，而這是一個從沒在 Windows 上建置過的 32 commit 平台遷移。事實證明對：CI 擋下兩個 Windows-only 的 bug

## 阻塞 / 待決議

- `~/Documents/20_Projects/Project_PM-SPEC+SCVB` 停在 `000dc4e`，落後 `origin/main` 33 個 commit。工作樹乾淨，可直接 `git pull`。**不 pull 的話打開那個目錄會看到改名前的 SpecForge**，很容易搞混在看哪一版

## 結束摘要

**32 個 commit 併入 main**，四平台 CI 全綠（Windows 11m54s）。

| | |
|---|---|
| 產品名 | SpecForge → **Anchorline** |
| join key | `sf:t=` → `anc:t=`（解析端雙讀，舊錨點仍認） |
| 資料目錄 | `.specforge/` → `.anchorline/` |
| 前端測試 | 314 pass |
| Rust 測試 | 10 單元 + 6 契約 |
| 平台 | macOS · Linux · **Windows**（首次驗證通過） |

### 後續

1. 重建並安裝 Anchorline app（`/Applications` 還躺著兩個改名前的 PRD開發監控台）
2. 刪 `mac-app-build/`（1157 行 Swift 已是死碼）
3. **用一週。** 到目前為止全部是「建好、測過」，沒有一天真正拿它工作——焦點卡四個欄位夠不夠、PR 雷達會不會變成噪音，只有用才知道
