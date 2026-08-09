# 安全模型

這個 App 會**讀取你所有已綁定專案的資料夾**、**寫檔**、**執行外部 CLI**。
三件事都不小，所以在你看程式碼之前，先把界線講清楚。

實作對照：`src-tauri/src/paths.rs`、`src-tauri/src/exec.rs`、`docs/BRIDGE.md` §3。

---

## 一句話

> **前端只能說「對哪個已授權的專案做這件已列舉的事」，不能說「用這些參數去跑這個程式」。**

前端是 WebView 裡的 JavaScript。它載入的是本地打包的檔案，但只要有一個 XSS
或一個被污染的相依套件，它就會替攻擊者說話。所以整個原生層的設計前提是
**不信任前端**——不是「前端應該不會亂傳」，是「前端亂傳也拿不到東西」。

---

## 1. 為什麼沒有 `tauri-plugin-shell`

Tauri 有一個官方 shell plugin，可以配 allowlist。**這個專案刻意不用它。**

理由是 allowlist 管得住「可以跑哪支程式」，管不住「參數長什麼樣」——
參數仍然由前端組。而 `git`、`gh`、`openspec` 這幾支程式的破壞力幾乎全在參數裡：
`git push --force`、`gh pr merge`、`openspec archive`。

所以外部程式呼叫全部寫在 `src-tauri/src/exec.rs`，**指令與旗標是 Rust 常數**，
前端能決定的只有「工作目錄是哪個專案」。

```rust
// exec.rs —— 前端傳不進任何一個旗標
run(&bin, &["search", "prs", "--author=@me", "--state=open", ...], None)
```

`src-tauri/capabilities/default.json` 只開兩個 Tauri 權限：
`dialog:allow-open`（資料夾選擇器）與 `opener:allow-open-path`（用系統預設程式開檔）。

---

## 2. 兩條路徑謂詞，刻意不共用

### `editable(path)` — 給 `readFile` / `writeFile` / `openPath`

```
家目錄底下
∧ 副檔名 ∈ {md, markdown, yaml, yml, json, txt, toml}
∧ 檔案已存在且是普通檔
```

「必須已存在」是關鍵：它讓寫入只能覆寫你自己打開過的檔，不能憑空建立新檔。

### `append_allowed(path)` — 只給 `appendFile`

```
canonicalize(path) 仍在某個「已註冊專案根目錄」內   ← 擋 symlink 逃逸
∧ 相對路徑第一段 = .anchorline
∧ 副檔名 = jsonl
∧ 單行 < 4KB
```

這條更緊，因為稽核軌跡**會建新檔**。

> **為什麼不把兩條合併成一條「通用安全路徑檢查」**：那是很自然的重構衝動，
> 但合併會讓 append 的嚴格度悄悄降到 `editable` 的水準——而降級不會有任何
> 測試失敗，只會多出一個「可以在家目錄任何地方建 `.jsonl`」的能力。
> `paths.rs` 開頭有這段註解，請不要把它重構掉。

### 「已註冊專案根目錄」怎麼來

**只有一個來源：使用者透過系統資料夾選擇器親手選過。**

前端傳來的路徑只能被檢查，不能被信任成根目錄——否則「限制在專案內」就等於
「限制在前端說的專案內」，而那不是限制。

---

## 3. 永遠不會執行的動作

| 動作 | 為什麼 |
|---|---|
| `gh pr review --approve` / `gh pr merge` / `gh pr comment` | 不可逆的對外動作 |
| `git commit` / `git push` / `git reset` | 同上。工具產生指令，你自己執行（`src/lib/git-doctor.ts`） |
| `openspec archive` | 破壞性，會改寫真相來源 |
| 執行前端傳來的任意 prompt 或指令 | 那會讓 WebView 變成任意程式碼執行入口 |

需要對外動作時，App 產生一段可複製的指令或 markdown，由你自己貼。
成本是多一次貼上，換來的是攻擊面為零。

`src/lib/agent-handoff.ts` 是同一個模式：產生 `claude -p '...'`，不執行它。

---

## 4. 稽核軌跡與你的機密

事件流寫在 `<專案>/.anchorline/log/YYYY-MM.jsonl`，**預設不進 git**（`.gitignore`）。

原因：append-only 的檔案洩漏了**刪不掉**，只能 rewrite history。而 agent 的
tool call 參數裡很可能有 API key、token、私有路徑。

所以 `src/lib/event-log.ts` 有三條硬規則：

1. **`payload` 走欄位白名單，不是黑名單。** 黑名單永遠漏（`authorization`、
   `x-api-key`、拼錯的 `tokn`）。白名單漏一個欄位只是少記，黑名單漏一個
   欄位是不可撤銷的洩漏。兩者不對等。
2. **命令原文不落地**，只存 `cmd_hash` 與前 16 字元。
3. **路徑一律相對於專案根**，根目錄外的記成 `<outside>`。

要把軌跡當作品公開時，用 App 的匯出功能產生脫敏摘要，不要直接貼 `.jsonl`。
細節見 [`docs/DATA.md`](DATA.md)。

---

## 4.5 CSP：`connect-src` 為什麼允許任何 https

```
connect-src 'self' ipc: http://ipc.localhost https: http://localhost:* http://127.0.0.1:*
```

AI 寫作教練會直接從 webview 打使用者自己設定的 LLM 端點。那個端點**沒有白名單
可言**——它可能是 Anthropic、Gemini、OpenAI，也可能是本機 Ollama、公司內部的
LiteLLM proxy，或任何相容端點。設定頁明講「可直接打字填任何模型 ID」，
硬塞一份主機白名單只會讓自訂端點的人卡住，然後去改原始碼。

於是：**https 全開，http 只留 loopback。** 後者是為了 Ollama（`localhost:11434`）；
不允許非 loopback 的 http，明文流量不該從這個 App 出去。

**為什麼不改走 Rust 端代發（像其他所有外部呼叫那樣）**：量過了——
webview 的 origin 是 `tauri://localhost`，直接 fetch Anthropic 會拿到正常的
HTTP 回應（401，代表 CORS 通過），不需要繞道。§1 拒絕 `tauri-plugin-shell`
是因為「前端組參數去執行程式」；這裡前端組的是**自己要打給誰的 HTTP 請求**，
而使用者本來就有權決定那件事。兩者不是同一類風險。

**實際暴露**：一個能執行任意 JS 的攻擊者可以把資料 POST 到任何 https 主機。
但在這個 App 裡，能執行任意 JS 就已經能透過 `appendFile` 與 `openPath` 做更糟的事，
所以 `connect-src` 不是這條鏈的最短處。真正的防線是「不載入外部腳本」
（`script-src 'self'`，未放寬）。

金鑰只存在 localStorage、只往使用者自己設定的端點送，不經過任何我們的伺服器。

---

## 5. 目前的已知弱點（誠實清單）

| 項目 | 狀態 |
|---|---|
| **產物未簽章** | macOS 會被 Gatekeeper 擋、Windows 會被 SmartScreen 擋。簽章與 notarization 是 `SCOPE.md` 的 W4，**尚未做** |
| **CLI 探測會走 PATH** | 若你的 PATH 上有惡意的同名 `git`／`gh`，App 會用到它。這與你在終端打指令的風險相同，但值得知道 |
| **`.anchorline/log` 是明文** | 沒有加密。它在你自己的磁碟上，威脅模型假設本機是可信的 |
| **沒有沙盒** | App 需要跑 `git` 才有功能，所以未啟用 macOS App Sandbox |
| **`connect-src` 允許任何 https** | LLM 端點由使用者自訂，無法白名單。理由與取捨見 §4.5 |

---

## 回報安全問題

請**不要**開公開 issue。寄到 repo 擁有者的 GitHub 帳號私訊，或用 GitHub 的
Private vulnerability reporting。

如果你發現的是「某個路徑謂詞可以被繞過」或「某個 action 可以被誘導執行
非白名單的參數」，那就是這份文件在講的那類問題，我會優先處理。
