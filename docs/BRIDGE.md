# Bridge 契約

> **凍結於 2026-08-09**，來源是當時 Swift 殼 `mac-app-build/main.swift`（1157 行）的實際行為。
> 那個殼已於 Tauri 移植完成後刪除（見 git 歷史）；這份文件是它留下的唯一規格，
> 也是現在 `src-tauri/` 那份實作唯一的對照基準。
> 這份文件有三個用途：Rust 移植的規格、契約測試的依據、以及 MIT 專案的**安全介面說明**。
> 三者只有一份真相——改行為就改這裡，不要只改實作。

---

## 1. 為什麼需要 bridge

WebView 看不到磁碟、跑不了 git、拿不到 mtime。這三件事是這個 App 的全部功能基礎，所以它們必須在原生端做，而 bridge 就是那條唯一的通道。

**通道越窄越好。** 每多一個 action 就多一個 WebView 可以觸發的原生行為，而 WebView 載入的是本地檔案、但它跑的是可以被任何 XSS 影響的 JS。所以：

> **前端只能說「做這件已列舉的事」，不能說「用這些參數去跑這個程式」。**

---

## 2. 傳輸層

### 舊（WKWebView，即將退場）

```js
window.webkit.messageHandlers.anchorline.postMessage({ action, ...params })
window.addEventListener("anchorline-native", (e) => { e.detail.type === "..." })
```

請求與回應沒有關聯 id，靠 `type` 比對——**同一個 action 併發兩次會拿錯結果**。這是舊設計的已知缺陷，移植時修掉。

### 新（Tauri v2）

```ts
import { invoke } from "@tauri-apps/api/core";
const res = await invoke<TrackingScan>("tracking_scan", { plansDirs });
```

- action 名稱 `camelCase` → Rust command `snake_case`
- 成功 → resolve payload（**不再帶 `type` 欄位**，Promise 本身就是關聯）
- 失敗 → reject `string`（人看得懂的訊息，可直接顯示）
- 「不是錯誤的缺席」（CLI 沒裝、不是 git 專案）→ **resolve 一個明確的 unavailable 形狀**，不要 reject

最後一條很重要。`openspec` 沒裝不是錯誤，是一個狀態；用 reject 表達會讓呼叫端把它當例外處理，畫面就會跳紅字。

---

## 3. 安全界線（三條，實作必須守）

### 3.1 子指令白名單

外部程式的參數**永遠寫死在原生端**，不接受前端傳入的任何字串當參數。

| 程式 | 允許的呼叫 |
|---|---|
| `git` | `-C <dir>` + 寫死的唯讀子指令（`rev-parse` `log` `status` `remote` `rev-list` `describe` `worktree` `for-each-ref`） |
| `openspec` | `list --json` · `status --change <name> --json`。**`<name>` 只能來自 `list --json` 自己的輸出**，不經過前端 |
| `gh` | `search prs --author=@me --state=open --limit 30 --json …`。**永遠不包含** `pr review` / `pr merge` / `pr comment` / 任何寫入 |
| `onefetch` `fastfetch` | 固定旗標，唯讀 |

前端能決定的只有「工作目錄是哪個專案」。

### 3.2 路徑謂詞（兩條，刻意不共用）

**`editable(path)`** — 給 `readFile` / `writeFile` / `openPath`：

```
家目錄底下
∧ 副檔名 ∈ {md, markdown, yaml, yml, json, txt, toml}
∧ 檔案已存在且是普通檔（不建新檔、不碰目錄）
```

**`appendAllowed(path)`** — 只給 `appendFile`，規則更緊，因為它會建新檔：

```
canonicalize(path) 仍位於某個「已註冊專案根目錄」之內   ← 擋 symlink 逃逸
∧ 相對路徑符合 .anchorline/**
∧ 副檔名 = jsonl
∧ 只 append，永不覆寫、永不刪除
∧ 單行 < 4KB（保住 append 的原子性）
```

**「已註冊專案根目錄」的唯一來源是使用者透過系統資料夾選擇器親手選過的路徑。** 前端傳來的路徑只能被檢查，不能被信任成根目錄。

### 3.3 永不執行的動作

| 動作 | 為什麼 |
|---|---|
| `gh pr review --approve` / `gh pr merge` / `gh pr comment` | 不可逆的對外動作，與 `git push` 同類 |
| `git commit` / `git push` / `git reset` | 同上。工具產生指令，人自己執行（見 `src/lib/git-doctor.ts`） |
| `openspec archive` | 破壞性，會改寫真相來源 |
| 執行前端傳來的任意 prompt／指令 | 那會讓 WebView 變成任意程式碼執行入口 |

---

## 4. 十二個 action

### 4.1 `pickFolder` / `pickProjectFolder`

開系統資料夾選擇器。`pickProjectFolder` 文案不同，且允許在面板內新建資料夾。

| | |
|---|---|
| 輸入 | 無 |
| 成功 | `{ folderName, folderPath, files: ScannedFile[] }` |
| 取消 | `{ cancelled: true }`（**不是 reject**——取消是正常操作） |
| 副作用 | **把 `folderPath` 加入已註冊根目錄集合**（`appendAllowed` 唯一的授權來源） |

`ScannedFile`：`{ path, name, size, text }`，只收 `.md` / `.txt`，單檔上限 512 KB。`size` 是位元組，`folder-import` 用它算覆蓋率。

### 4.2 `projectStats`

| | |
|---|---|
| 輸入 | `{ folderPath }` |
| 成功 | `ProjectStats`（型別以 `src/lib/project-stats.ts` 為準） |
| 失敗 | reject `"缺少 folderPath"` |
| 非 git 專案 | `git` 欄位缺席，**不是錯誤** |

`ProjectStats`：`{ folderPath, totalBytes, fileCount, extBytes, extCount, manifests, manifestBodies, git? }`
`GitStats`：`{ head, branch, lastMessage, lastAt, author, dirtyCount, remote, ahead, behind, tag, commitCount, commits?, tags?, worktrees?, branches? }`

> `ahead = -1` 代表**沒有 upstream**，不是 0。移植時不要把它正規化掉——前端靠這個區分「沒接遠端」與「已同步」。

走訪時排除 `node_modules` `.git` `dist` `build` `.next` `target`。

### 4.3 `trackingScan`

| | |
|---|---|
| 輸入 | `{ plansDirs: string[] }` |
| 成功 | `{ files: PlanStat[], signal?: TrackingSignal \| null }` |
| 失敗 | 不 reject。讀不到的目錄跳過 |

`PlanStat`：`{ path, name, mtimeMs, text }` — 只收 `.md`，非遞迴，單檔 ≤ 512 KB，總數 ≤ 300，跨目錄去重。
`TrackingSignal`：`{ raw, mtimeMs }`，來源 `$XDG_CONFIG_HOME/anchorline/active`（見 `SPEC-live-tracking.md` §4）。

> `mtimeMs` 是**毫秒浮點數**。整個 live tracking 判定只靠它，精度掉了追蹤點就會抖。

### 4.4 `readFile` / `writeFile`

| | 輸入 | 成功 | 失敗 |
|---|---|---|---|
| `readFile` | `{ path }` | `{ path, text }` | reject 訊息 |
| `writeFile` | `{ path, text }` | `{ path }` | reject 訊息 |

兩者都先過 `editable(path)`。`writeFile` 是整檔覆寫，**只允許覆寫使用者自己打開過的既有檔**。

### 4.5 `appendFile`

| | |
|---|---|
| 輸入 | `{ path, line }` |
| 成功 | `{ path }` |
| 失敗 | reject 訊息 |

先過 `appendAllowed(path)`。實作要求：

- **真 O_APPEND**（Rust：`OpenOptions::new().append(true).create(true)`）。**不可 read-modify-write** — 三類 writer 會併發，讀整檔再寫回會直接吃掉別人剛寫的事件
- `line` 內的換行一律替換成空白，結尾補一個 `\n`
- 超過 4 KB 截斷
- 自動建立 `.anchorline/log/` 目錄
- 缺 `.anchorline/.gitattributes` 時種下 `*.jsonl merge=union`（**只在缺檔時，不覆寫**）

### 4.6 `openPath`

| | |
|---|---|
| 輸入 | `{ path }` |
| 成功 | `{ path }` |
| 失敗 | reject 訊息 |

過 `editable(path)`，用系統預設程式開啟。

### 4.7 `openspecStatus`

| | |
|---|---|
| 輸入 | `{ folderPath }` |
| 成功 | `{ folderPath, list: string, statuses: string[] }` — **CLI 的原始 JSON 字串，不在原生端解析** |
| 不可用 | `{ unavailable: true, message }`（**不是 reject**） |

流程：`openspec list --json` → 取出 `changes[].name`（原生端唯一的解析，只為了下一輪查詢）→ 逐一 `openspec status --change <name> --json`。

**所有 JSON 判讀留在 `src/lib/openspec-status.ts`**，不要在兩端各寫一套。

> CLI 探測順序見 §5。找不到就回 unavailable，畫面顯示安裝提示。

### 4.8 `ghStatus`

| | |
|---|---|
| 輸入 | 無 |
| 成功 | `{ raw: string, fetchedAt: string }` — 原始 JSON 字串 + ISO-8601 取得時間 |
| 不可用 | `{ unavailable: true, message }` |

固定呼叫：

```
gh search prs --author=@me --state=open --limit 30 --json repository,number,title,updatedAt
```

**`gh search` 走 Search API，限 30 req/min。** 快取與去重在前端（`status-bridge.ts`，60 秒），原生端不做節流——但也不要在原生端加迴圈。

`fetchedAt` 一定要回，前端要靠它標新鮮度。

### 4.9 `onefetch` / `fastfetch`

歡迎畫面的裝飾。`{ folderPath }` / 無輸入 → `{ raw }` 或 unavailable。

`fastfetch` 的輸出前後夾 ANSI 跳脫序列，而序列本身含 `[`——**要先整段剝掉 ANSI 再找 JSON 開頭**，直接 parse 會炸在第一個字元。

### 4.10 `ping`

| | |
|---|---|
| 輸入 | 無 |
| 成功 | `{ native: true, capabilities: string[] }` |

`capabilities` 是**這個版本實際實作了哪些 action**。前端靠它做功能偵測，而不是靠版本號猜。移植期間特別有用：Rust 端還沒補完的 action 不要列進去。

---

## 5. CLI 探測（Rust 端共用）

`openspec` 是 **Node CLI**（`@fission-ai/openspec`，npm global），`gh` 是原生二進位。兩者都不保證在 GUI 進程的 PATH 裡——GUI 繼承的 PATH 通常不含 Homebrew 或 npm global。

探測順序（第一個命中就用）：

1. **使用者在設定裡指定的絕對路徑** ← 最終逃生口，一定要有
2. `PATH` 直接找
3. 常見安裝點
   - macOS / Linux：`/opt/homebrew/bin` · `/usr/local/bin` · `~/.local/bin` · `~/.npm-global/bin` · `~/.bun/bin` · nvm / volta / asdf shim
   - Windows：`%APPDATA%\npm` · `%LOCALAPPDATA%\npm`
4. `npx @fission-ai/openspec`（僅 openspec；有 Node 就跑得起來，慢但保底）
5. 都失敗 → unavailable + 一鍵複製的安裝指令

**第 1 步是關鍵。** 任何猜路徑的邏輯都會漏掉某個人的環境；給他一個輸入框比多猜十個路徑有用。

---

## 6. 移植檢查表

要參數化、不要硬編碼：

- [ ] PATH 補丁 `/opt/homebrew/bin:...` 是 macOS 專屬，換成 §5 的探測
- [ ] 訊號檔路徑 `$XDG_CONFIG_HOME/anchorline/active`（Windows 沒有 XDG，用 `%APPDATA%`）
- [ ] 家目錄判斷（`editable` 用）
- [ ] 副檔名白名單

可直接照搬：

- [ ] 兩條路徑謂詞的邏輯與**它們刻意不共用**這件事
- [ ] `ahead = -1` 的語意
- [ ] 「不是錯誤的缺席」一律 resolve unavailable
- [ ] JSON 判讀全部留在 TS

**移植時最容易漏掉的**：`appendFile` 用 read-modify-write 模擬 append。它在單執行緒測試裡完全正確，在三個 writer 併發時會靜靜吃掉事件——而且沒有任何錯誤訊息。契約測試必須有一條併發案例。
