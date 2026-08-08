# 貢獻指南

先謝謝你願意看。這個專案有幾條不太常見的規則，先講清楚比之後在 review 裡
來回省事。

---

## 三條硬性要求

### 1. 判定邏輯寫成純函式，`nowMs` 注入

```ts
// ✅
export function sinceLabel(iso: string | null, nowMs: number): string

// ❌ 測不動
export function sinceLabel(iso: string | null): string  // 內部呼叫 Date.now()
```

這不是潔癖。從 WKWebView 換到 Tauri 時，47 個 lib 檔裡有 39 個一行都不用改，
就是因為 I/O 一直被推在呼叫端。

### 2. `docs/BRIDGE.md` 是契約，不是文件

改了 Rust command 的輸入／輸出／錯誤形狀，**同一個 PR 要改那份文件**。
它同時是移植規格、契約測試依據、以及安全介面說明——三者只有一份真相。

### 3. 安全界線的改動先開 issue

`src-tauri/src/paths.rs` 與 `src-tauri/src/exec.rs`。特別是這兩件：

- 把 `editable()` 與 `append_allowed()` 合併成「通用的安全路徑檢查」
- 引入 `tauri-plugin-shell` 或任何讓前端組參數的機制

兩者都是很自然的重構衝動，而且**都不會有測試失敗**。理由寫在
[`docs/SECURITY.md`](docs/SECURITY.md)，看完還是覺得該改就開 issue，我們討論。

---

## 開始

```bash
bun install
bun run tauri dev
```

送 PR 之前：

```bash
bun run typecheck
bun test ./tests/*.test.ts
cd src-tauri && cargo fmt && cargo clippy --all-targets -- -D warnings && cargo test
```

CI 跑同一組，外加 Windows 與 Linux。

---

## 測試怎麼寫

**測「這裡搞砸會怎樣」，不是測覆蓋率。** 幾個例子：

- `append_is_real_o_append_under_concurrency` — 8 執行緒各寫 50 行，必須剛好 400 行。
  read-modify-write 在單執行緒下會過，這條會紅。
- `payload 白名單裡沒有任何看起來像密鑰的欄位` — 掃整個白名單。
- `其餘一字不改` — 勾選只能動那一行的方框字元。

測試名稱請寫成一句話說明**為什麼這條存在**，不要寫 `test toggleStep works`。

### 不要寫死會變的東西

有一條測試曾經寫死 `狀態 === "進行中"`，而那份 fixture 是活的 task list，
工作推進到「已完成」時它就紅了。斷言值域，不要斷言當下的值。

---

## Commit 訊息

第一行講「做了什麼」，內文講「**為什麼**，以及排除了什麼」。

```
併發保護用內容雜湊不用 mtime

mtime 答錯了問題：它變了不代表內容變了（touch、同步工具），
內容變了在同一秒內它也可能沒變。要問的是「我讀到的那份還在嗎」。
代價是每次寫入前多讀一次檔，一份 plan 幾 KB，代價是零。
```

沒有理由的 commit 在半年後等於沒有 commit——而這個專案的主題正好就是
「讓後來的人（和 agent）看得到為什麼」。

---

## 不會被接受的 PR

| | 為什麼 |
|---|---|
| Kanban 板／拖曳／優先級／指派 | Linear 的形狀。做進來就是兩套任務系統 |
| 從 App 派工執行 agent | 要讓原生端跑前端傳來的任意 prompt，拆掉整個安全模型 |
| 執行 `gh pr review` / `git push` 之類的寫入 | 不可逆的對外動作。工具產生指令，人自己執行 |
| 解析 `openspec/specs/*.md` 內文 | 對上游的相容承諾，見 README |
| 雲端同步／多人伺服器 | 本機 + 檔案 + git 就是產品邊界 |

這些不是「暫時不做」，是**設計決定**。想改變其中一條，開 issue 講清楚
什麼前提變了——`plans/2026-08-09_dev-workbench-upgrade-eval.md` §十二 有一次
翻案的例子，理由是新事實而不是重複要求。

---

## 語言

程式碼註解與文件用繁體中文，識別字用英文。這是專案現況，不是規定——
英文 PR 一樣會被 review。
