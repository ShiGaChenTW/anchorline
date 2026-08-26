# Handoff — Agent 後端可管理化（W1+W2+W3 完成，剩 W4）

- 更新：2026-08-26 15:35
- `main` 在 **`ab2dd2d`**，**未 push**（領先 `origin/main` **8** 個 commit）
  - 2026-08-26 更正：原本寫 `384cb23` / 792，兩個都錯。`384cb23` 之後還有一個 handoff commit；
    792 是某次過期 `origin` ref 算出來的，`git rev-list --count origin/main..main` 實測是 8
- 規格與收貨紀錄（先讀這份）：`plans/Project_Anchorline__2026-08-26-1323__agent-backends.md`

## 一句話

**簽核呼叫 agent 原本只有一條全域 HTTP 通路，沒 API Key 就整個功能停擺。
現在資料層（W1）、CLI 原生橋（W2）、接線（W3）全部完成並驗過，在 main 上。
剩 W4 的 UI —— 在那之前使用者看不到這批的任何能力。**

## 冷啟動第一件事

工作樹乾淨、沒有 agent 在跑。**唯一未提交的是 `plans/uat-簽核流程重新設計-wave-2-實測.md`，
那是另一個 session 在改的，不要碰、不要 commit。**

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

## 還沒收的線頭

- **W4 UI 完全沒做 —— 這是下一步**：設定頁兩張清單的 CRUD、agents 頁的後端下拉、
  金鑰不得進匯出/log。⚠️ **W4 必須讀 `store.listBackends()`，不是 `settings.backends`**（default 是投影）
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
