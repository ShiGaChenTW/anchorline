# 命名撞名體檢 — anchorline / throughline / plumbline / kedge

> 執行：2026-08-09 04:06（台北）· `bun run scripts/name-audit.ts anchorline throughline plumbline kedge`
> 判準（跑之前先講死）：npm 週下載 ≥1000 ／ GitHub 同名 ≥1000★ ／ App Store 命中 → **BLOCK**；品牌 TLD 全被註冊 或 brew 同名 → **WARN**

## 總表

| 名稱 | 判定 | npm | GitHub | App Store | .app .dev .com | Homebrew |
|---|---|---|---|---|---|---|
| **anchorline** | ✅ 實質最乾淨 | ✅ 未占用 | 22 個・最高 1★ | ✅ 無 | ⛔ ⛔ ⛔ | ✅ 無 |
| **throughline** | ⛔ **BLOCK** | ⚠️ 活躍（485/週） | 229 個・最高 73★ | ⛔ 2 個 | ⛔ ⛔ ⛔ | ✅ 無 |
| **plumbline** | ✅ 實質可用 | ⚠️ 已死（44/週，2022 停更） | 100 個・最高 9★ | ✅ 無 | ⛔ ⛔ ⛔ | ✅ 無 |
| **kedge** | ✅ 實質可用 | ⚠️ 幾乎無用（3/週） | 240 個・最高 299★（**2018 已封存**） | ✅ 無 | ⛔ ⛔ ⛔ | ✅ 無 |

## 逐案細節

### throughline — 唯一真正出局的，而且比分數更糟

1. **npm `throughline` 是一個活躍的 Claude Code hooks plugin**，`v0.9.0`，最後發佈 **2026-08-04**（五天前），週下載 485。
   描述：`Claude Code hooks plugin for structured context compression (/clear-safe persistent memory)`。
   → 這是最壞的一種撞名：**同一個生態系、同一類工具、同一批使用者**。Scott 的產品正是活在 Claude Code / Orca 工作流裡。
2. **App Store 兩個同名**：`Throughline`（遊戲，Finlay Paterson）與 **`Throughline: AI Voice Notes`（生產力類，Michael Polner）** —— 後者直接同分類。
3. GitHub 229 個同名 repo。

> 上一輪只知道 NPR 那個 podcast，那個其實無所謂。真正的殺手是那個五天前發佈的 Claude Code plugin。**Throughline 出局。**

### kedge — 唯一的雜訊是一具 2018 年的屍體

`kedgeproject/kedge`（299★）是 Kubernetes 應用宣告工具，**已封存（archived）**，最後 push 是 **2018-04-17**。npm 週下載 3。App Store 無。
→ 星數是歷史遺產，不是活躍競爭。實質乾淨。

### plumbline — npm 上是一個停更三年的 Angular 測試工具

`plumbline` v10.0.9，最後更新 2022-05-13，週下載 44，描述是 Angular shallow mount 測試工具。GitHub 最高 9★。
→ 不構成阻礙，但 npm 套件名已被占（若要發 `plumbline` npm package 需改名或走 scope）。

### anchorline — 各項最乾淨

npm 未占用、GitHub 最高 1★（一個建築公司網站）、App Store 無同名、Homebrew 無同名。

## 網域：四個名字的 `.app/.dev/.com` 全部被註冊

對照組 `zxqwvbnm12345.app` 回 404（未註冊），確認查詢邏輯正確 —— 所以這不是誤判，是四個都是常見英文詞的必然結果。**網域在四者之間不構成差異。**

替代 TLD 實測：

| 名稱 | .io | .sh | .co | .tools | .day | .build | .so |
|---|---|---|---|---|---|---|---|
| **anchorline** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **plumbline** | ✅ | ✅ | ✅ | ⛔ | ✅ | ⛔ | ✅ |
| **kedge** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

`anchorline` 與 `kedge` 七個全開。

## 結論

**throughline 出局**（Claude Code 生態系同名 plugin + App Store 同分類 App）。
**anchorline / plumbline / kedge 三者皆可用**，其中 anchorline 各項最乾淨且 npm 名未被占。

## 人工待辦：TIPO 商標檢索（無公開 API）

https://twtmsearch.tipo.gov.tw/ — 第 9 類（電腦軟體）、第 42 類（軟體設計服務）

- [ ] anchorline
- [ ] plumbline
- [ ] kedge

## 腳本已知限制

- npm「已占用」只看週下載數，分不出**死套件**與**活躍競品** —— throughline 與 plumbline 的下載量同屬「未達 1000」，但一個是五天前發佈的同生態系工具、一個是停更三年的屍體。判定仍需人工看一眼 `description` 與 `time.modified`。
- GitHub star 數同理不分**現役**與**已封存**（kedge 的 299★ 來自 2018 年的封存專案）。
