# Handoff — Agent 後端可管理化（W1+W2 已合併，W3 派工中）

- 更新：2026-08-26 14:55
- `main` 在 **`f5e7c6c`**，**未 push**（領先 `origin/main` 792 個 commit，多數是舊帳不是這批）
- 規格與收貨紀錄（先讀這份）：`plans/Project_Anchorline__2026-08-26-1323__agent-backends.md`

## 一句話

**簽核呼叫 agent 原本只有一條全域 HTTP 通路，沒 API Key 就整個功能停擺。
現在資料層（W1）與 CLI 原生橋（W2）已經合併進 main 並驗過，W3 接線派工中，W4 的 UI 還沒開始。**

## ⚠️ 冷啟動第一件事：有一個 agent 正在寫主樹

W3（前端白名單對齊 ＋ 接線）在 2026-08-26 14:52 派給 Engineer，**直接在主樹改，沒開 worktree**。

**那個 subagent 綁在派它的那個 session 上，新 session 接不到它的完成通知。** 兩條路：

1. 回原 session 收（推薦，它會把數字驗完）
2. 新 session 自己收：看 `git status` 的主樹改動 ＋ 讀 **`plans/agent-backends-w3-report.md`**
   （我要求它把結論寫進這個檔，正是為了這種情況）。然後**自己跑** `bunx tsc --noEmit` 與 `bun test`

無論哪條，**都不要重新派一次 W3** —— 會跟正在寫的那個對撞。

## 已完成並驗過的（`f5e7c6c`）

**W1 資料層**：`AgentBackend` 判別聯集（api / cli）、`AISettings.backends`、`Employee.backendId`、
`src/lib/agent-backend.ts`（純函式）、store 的 CRUD。

- **`default` 後端是全域 AI 設定的投影，不落地存進 `backends`。** 複製會有兩份真相：
  使用者換金鑰，agent 讀舊副本，唯一症狀是 401。**W4 必須讀 `store.listBackends()`，不是 `settings.backends`**
- `resolveBackend` 永不回 null，未設或指向已刪 id 一律回退 default

**W2 原生層**：`exec::run_stdin`（逾時 180s 真 kill、stdout 1 MB 截斷）、
`commands::agent_cli_run`（prompt 走 stdin 永不進 argv、旗標寫死在 Rust）、
`BRIDGE.md` §3.3 改寫 ＋ §4.11 新 action。

## 白名單是四個，不是六個

Scott 原本點名六個；實測後 **`claude` / `grok` / `pi` / `agy`**。

| 出局 | 為什麼 |
|---|---|
| `codex` | `codex exec --sandbox read-only --ephemeral --ignore-user-config` 下**實際執行 `/bin/zsh -lc "sed -n …"` 並回傳 canary 原值**。`read-only` 限制寫入，不限制執行與讀取，且沒有停用工具的旗標 |
| `hermes` | `--safe-mode -t ""` 仍讀走 canary（`-t` 是「啟用哪些 toolset」，空字串不等於清空），且只吃 argv |

**codex 那條主 session 獨立重現過**（canary `CANARY-VALUE-7Q4XZ`），不是採信 agent 報告。

⚠️ **`agy` 的守門不在我們手上**：靠 headless 問不了人就自動拒絕，那是 fail-closed 的**預設值**不是鎖；
使用者在自己的 `settings.json` 加 `permissions.allow` 就會被放行。**升級 agy 後要重驗。**

⚠️ **兩個靜默 no-op 旗標**：`grok --tools ""` 與 `--disallowed-tools 'Bash,…'` 看起來都對，
實際上都沒擋住且不報錯（grok 內建工具名跟 Claude 那套不同）。有效的是 `--deny '*'`。

## 驗證數字（主 session 自己跑的）

```
bunx tsc --noEmit   exit 0
bun test            1884 pass / 0 fail / 92 files
cargo check         乾淨
cargo test          68 passed / 0 failed
```

## 還沒收的線頭

- **W4 UI 完全沒做**：設定頁兩張清單的 CRUD、agents 頁的後端下拉、金鑰不得進匯出/log
- **三份 CLI 清單要一致**：前端 `CLI_TOOLS`、Rust 白名單、以及 **`src/lib/agent-handoff.ts:70` 的 `RUNNER`**
  （早就存在、只有四個鍵、含這台機器根本沒裝的 `gemini`）
- **既有 bug（非本批造成）**：`tracking.ts:1521` 把較寬的 `AgentFamily` 用 `as AgentFamilyId` 硬轉，
  `agent-handoff.ts:153` 的 `RUNNER[input.family](prompt)` 沒 fallback ——
  作者族系是 `grok`/`agy`/`gpt`/`local` 時**交辦當場 TypeError**
- **`normalizeAgentFamily`（`permissions.ts:131`）fail open**：只是 `family ?? "other"`，不檢查聯集成員
- **實機 UAT 零覆蓋**：這整批沒有任何人眼驗證，W4 做完要出題（`Uat` skill）
- **未 push**，要問過 Scott
- 舊帳：對話框遷移的 UAT、W3 的 11 題視覺驗收、wave1+2 的 10 題 —— 見 `PROJECTS.md`

## 派工教訓（這個 session 踩到的）

- **兩個 Engineer 都撞 50 turn 上限，而且都撞在「驗證」不是「寫」上。** W2 光是六個 CLI 的
  `--help` 加 canary 就吃掉大半預算。**同類工作下次把探測拆成獨立一次派工，產出一張旗標表，實作那次只讀表**
- **要求 agent 邊做邊把結論寫進 repo 內的檔案** —— 這次三份 report 就是這樣保住的
- **不要採信 agent 的完成宣稱**，一律自己跑 tsc / bun test / cargo
- W1 開了 worktree、W2 沒開（它的 worktree 中途被刪、自己退回主樹）。**派工時要明講在哪裡改**
