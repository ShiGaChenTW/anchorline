# Handoff — Agent 後端可管理化（W1–W4 全部完成；W4 未 merge，等拍板）

- 更新：2026-08-26（W4 收貨後）
- `main` 在 **`c3040f6`**，**未 push**（領先 `origin/main` **9** 個 commit）
  - ⚠️ 這個數字每次有人 commit 就會過期，**冷啟動請自己跑一次**：
    `git rev-parse --short main && git rev-list --count origin/main..main`。
    這份文件的舊版寫 `384cb23` / 792（兩個都錯），已經害一個 session 照著去重派已完成的 W1/W2
- 規格與收貨紀錄（先讀這份）：`plans/Project_Anchorline__2026-08-26-1323__agent-backends.md`

## 一句話

**簽核呼叫 agent 原本只有一條全域 HTTP 通路，沒 API Key 就整個功能停擺。
現在資料層（W1）、CLI 原生橋（W2）、接線（W3）全部完成並驗過，在 main 上。
W4 的 UI 也完成並驗過了，但**還在 worktree 裡沒 merge** —— 在它進 main 之前，
使用者仍然看不到這批的任何能力。**

## 冷啟動第一件事

先跑 `git status`。工作樹在 `c3040f6` 當下是乾淨的，但這份文件本身可能是未提交的改動。

⚠️ **`plans/uat-簽核流程重新設計-wave-2-實測.md` 的時間戳差異不是有人在編輯** ——
那是 Anchorline App 開啟該報告時自己寫回去的。2026-08-26 曾被誤判成「有第三個 session 在改」，
白追了一條線頭。

三份 agent 報告在 `plans/agent-backends-w{1,2,3}-report.md`，收貨紀錄在規格檔裡。

## 已完成並驗過的（`f5e7c6c` ＋ `4d57b1e`）

**W1 資料層**：`AgentBackend` 判別聯集（api / cli）、`AISettings.backends`、`Employee.backendId`、
`src/lib/agent-backend.ts`（純函式）、store 的 CRUD。

- **`default` 後端是全域 AI 設定的投影，不落地存進 `backends`。** 複製會有兩份真相：
  使用者換金鑰，agent 讀舊副本，唯一症狀是 401。**W4 必須讀 `store.listBackends()`，不是 `settings.backends`**
- `resolveBackend` 永不回 null，未設或指向已刪 id 一律回退 default

**W3 接線**（`4d57b1e`）：`ChatOpts` 多一個 optional `backend`，不給＝沿用全域設定；
`invokeAgent` 依 `resolveBackend` 分流。

- **CLI 後端在 HTTP 層是明確拒絕，不是降級。** `getAiReadiness(backend)` 對 `kind === "cli"`
  一律 `ok:false`。理由不是技術是帳單：**綁本機 CLI 的理由通常就是 API 額度用完，
  靜默回退全域設定會安靜地把帳單記回去，月底才發現**
- 瀏覽器 + CLI 後端回 `ok:false` 且不開工作單；CLI 沒裝才開工作單標 failed 並帶安裝提示
- `landed: "pending"` 與族系隔離閘門一個字未動；六個既有 `chatCompletion` 呼叫端零改動

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
bun test            1907 pass / 0 fail / 93 files
cargo check         乾淨
cargo test          68 passed / 0 failed
```

## W4 已完成，在 worktree 裡等拍板（2026-08-26）

實作＋測試都完成且驗過，**但沒有 merge 進 main**，在
`.claude/worktrees/agent-ae491953ea5b09c3e`（branch `worktree-agent-ae491953ea5b09c3e`）。

主 session 自己跑的數字：`bunx tsc --noEmit` exit 0、`bun test` **1959 pass / 0 fail / 96 files**
（基線 1907/93 → +52 測試、+3 檔）。收貨報告在該 worktree 的 `plans/agent-backends-w4-report.md`。

內容：設定頁「🔌 Agent 執行後端」CRUD、agents 頁後端下拉（含「目前實際使用」與失效綁定警告）、
`RUNNER` 總函式化、`normalizeAgentFamily` 收斂、新檔 `src/lib/agent-backend-ui.ts`（顯示邏輯純函式化，
所以金鑰有沒有漏到畫面上測得到）。

⚠️ **開新 worktree 前先確認起點。** 這次 Engineer 進去時 branch 停在 `7603b70`，
W1/W2/W3 全不在裡面（`src/lib/agent-backend.ts` 根本不存在），它自己 `git merge --ff-only main`
才開工。沒發現的話會在一個沒有資料層的樹上重寫一份資料層。

### 三個等 Scott 拍板的決定

1. **worktree 要不要 merge 回 main**
2. **匯出洩漏 API 金鑰要不要修** —— 見下方「舊帳」，這是產品決定不是實作決定
3. **`main` 那 9 個 commit 要不要 push**

### 🔴 匯出洩漏 API 金鑰（舊帳，非 W4 造成，主 session 逐字驗過）

`src/lib/export.ts:148` 的 `exportJsonFile()` 把整個 `state` 直接 `JSON.stringify`，
**全檔零 redaction**（`grep 'apiKey\|redact'` 零命中）。所以 `settings.apiKey`
一直都進備份檔。W1 的影響是**從一把變成 N 把** —— `settings.backends[].apiKey` 也一起進去。
event JSONL 是乾淨的。

沒有自己動手是刻意的：拿掉金鑰會改變備份的 round-trip 語義（匯入回來的檔案不再能還原成可用狀態）。
兩個選項寫在 W4 報告裡。

## 還沒收的線頭

- ~~W4 UI 完全沒做~~ —— **已完成，見上方「W4 已完成，在 worktree 裡等拍板」**。未 merge
- **CLI 通路從未實機驗過**：真的 spawn `claude`/`grok`/`pi`/`agy` 在 `bun test` 裡驗不到，
  要桌面版 App 的 UAT。這是這整批最大的未驗區
- **兩份 CLI 清單已對齊（前端四個＝Rust 四個）**，但第三份還在： **`src/lib/agent-handoff.ts:70` 的 `RUNNER`**
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
