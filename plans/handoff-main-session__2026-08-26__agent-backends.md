# Handoff — Anchorline：轉去做 Agent 後端可管理化

> ⚠️ **已作廢（2026-08-26）。冷啟動請改讀 `plans/handoff-main-session__2026-08-26__agent-backends-w2-merged.md`。**
> 這份寫於 13:34，當時 W1–W4 全未開工；其後 W1/W2/W3 已完成並在 `main` 上。
> 下面的 commit hash 與「全未開工」的描述**都已過時**，照著做會重複去派已完成的 W1/W2。

- 更新：2026-08-26 13:34（本 session 結束）
- `main` 在 **`a7893e6`**，**領先 `origin/main` 兩個 commit，尚未 push**（Scott 沒授權推）
- 工作樹乾淨
- 本 session **零原始碼改動** —— 所以 tsc / bun test / vite build 沒有重跑的必要

## 一句話

**UAT 存檔沒有壞，之前只是沒走報告；28 題現在測了 6 題（4 通過、2 失敗）。
下一段工作轉去做「Agent 後端可管理化」，計畫已寫好，但 CLI 白名單待 Scott 拍板才能派工。**

## 這輪確定下來的兩件事

### 1. 上一份 handoff 掛著的問題有答案了：UAT 存檔是好的

上一份 handoff 要求「下一個 session 第一句先問」的那題 —— 報告 28/28 空白，
是 App 存不回去，還是 Scott 沒走報告手測？

**答案是後者。** 這輪 Scott 開了測試版走報告，結果**確實寫回檔案**：
`最後更新` 從 `05:12` 變成 `13:03`，六題的「結果」與「說明」都落到 markdown 裡。
UAT 功能本身沒有 bug，這條線頭可以收掉。

### 2. 兩版 App 都已換裝到 `d115fc7`

| 變體 | 路徑 | sha256（前 12） | PID |
|---|---|---|---|
| 正式版 | `/Applications/Anchorline.app` | `62dd6759994d` | 48909 |
| 測試版 | `/Applications/Anchorline Test.app` | `bf3f31847453` | 59567 |

兩份都經過 `bun run app:install` 的交易式換裝，來源／目標 sha256 逐字相同、啟動 poll 驗證通過。

**測試版自帶示範資料，儲存區與正式版完全隔離**（`store.ts:106` 的 `KEY` 由 `APP_VARIANT` 插值，
test 是 `anchorline:state:v6:test`）。密碼預填 `demo`，預選管理員 `scott@anchorline.local`，
登入頁多一排示範快速身分。示範專案涵蓋 draft/review/approved 各種狀態，
`lean`（一頁式）與 `enterprise`（傳統完整）兩張 PRD 範本都在種子裡。

⚠️ 以上關於示範資料的描述**是讀原始碼得到的，不是實機截圖驗證的**。畫面上長得不一樣就是 bug。

## UAT 現況：28 題 → 已測 6、未測 22

用程式數的（`python3` + regex，不是手數）：`Counter({'未測': 22, '通過': 4, '失敗': 2})`。

**兩題失敗：**

- **T1（送審指派對話框）—— 真缺陷，要改。**
  對話框本身行為正確，問題在**送出之後的去向**：現在跳到「審閱佇列」。
  Scott 的指示是「改成送出後跳到**簽核管理**頁面，並且調整簽核管理頁面，
  要正確引導使用者完成各關卡」。**這不只是改一個跳轉目標，後半句是要重新設計那一頁的引導。
  規格未拍板，不要直接開工。**

- **T2（會改 PRD 內文的關卡要有警語）—— 題目的問題，不是程式的問題。**
  Scott 的說明只有三個字：「看不懂問題」。**下一輪要做的是改寫這道測項**，
  不是去動程式。改寫前先確認他是看不懂題目敘述，還是畫面上根本找不到那行警語。

**其餘 22 題未測**，Scott 中途轉去做 agent 後端，測到第 6 題就停了。

## 下一段工作：Agent 後端可管理化

計畫完整寫在 **`plans/Project_Anchorline__2026-08-26-1323__agent-backends.md`（110 行）**，
現況查證表、四條設計決策（D1–D4）、W1–W4 四階段任務、派工建議、決策紀錄都在裡面。
**下一個 session 先讀那份，不要重新查一次現況** —— 表格裡每一條都標了行號。

一句話版本：現在整個 App 只有**一份全域 AI 設定**、只有 HTTP 一條通路，
金鑰沒錢就整個 agent 功能停擺（R1 探測 48 次呼叫裡 13 次失敗全是 OpenRouter 402，
而 opencode CLI 免費通道 16/16 全成功）。要改成「CLI 後端／API 後端兩張清單，每個 agent 綁一個」。

### 開工前的硬阻塞

**CLI 白名單要放哪幾個工具，待 Scott 拍板。** 提案是 `claude / codex / gemini / opencode`。
這不是湊數的問題 —— **每多一個工具就多一條從 WebView 通往原生執行的路徑**。
拍板前不要派 W2。

### 派工建議（計畫裡已寫，這裡只重述結論）

- W1（`src/data/*`，純 TS）與 W2（`src-tauri/*` + `native.ts` + `BRIDGE.md`）**檔案不重疊，可並行派 Engineer**
- W3、W4 等 W1/W2 驗收後再派
- 主 session 當 PM，不寫 code
- 額度閘門查於 13:20：Engineer / Forge / Cato routable，Bellows exhausted、Anvil unavailable
  —— **超過幾小時就要重跑 `bun ${LIFEOS_DIR}/TOOLS/AgentQuota.ts --json`，不要拿舊結果派工**

## 還沒收的線頭

- **UAT 剩 22 題**。T1 那條在改之前先測完其餘題目比較划算 —— 現在改動程式，
  已測的 6 題有機會要重測。
- **T1 的規格要拍板**（簽核管理頁的引導長什麼樣），T2 的測項要改寫。
- **`main` 領先 origin 兩個 commit 未 push**（`d115fc7`、`a7893e6`，都是文件）。要推請先問 Scott。
- **OpenRouter 額度用盡**（HTTP 402）。這正是 agent 後端這批要解決的問題本身。
- **ElevenLabs 額度用盡**（`quota_exceeded`），語音通知發不出去 —— 所以三小時後的提醒
  走的是文字通知，不是語音。
- 舊帳照舊：R1「錨定 ＋ 涵蓋率閘門」的規格未拍板（見 `plans/handoff-main-session__2026-08-26__r1-foundation.md`）、
  對話框遷移的實機 UAT、W3 的 11 題視覺驗收、wave1+2 的 10 題。

## 這輪學到、值得帶走的三件事

1. **`~/Documents` 的 TCC 權限會在 session 中途被 macOS 收回，而且是整棵樹。**
   這次症狀是 `cat` / Read tool / `git` 全部 `Operation not permitted`，但 `ls ~/` 正常。
   關掉沙箱無效 —— 那是 macOS TCC，不是 Claude Code 的權限層。
   修法：系統設定 → 隱私權與安全性 → 檔案與資料夾／完整磁碟取用權。
   **這是這份 handoff 第二次記到同一件事**（上一份也有）。會再發生。

2. **`grep | sort | uniq -c` 數 UAT 結果會數錯。** 這輪 shell 那條管線回報「28 全失敗」，
   實際是 22 未測／4 通過／2 失敗。原因是 Bash 輸出被 RTK 壓縮層改寫過。
   **CLAUDE.md 早就寫了「加總一律用程式算」—— 這次差點就照著錯的數字寫進 handoff。**
   照規則跑 `python3 -c` 才拿到對的數。

3. **測試版的隔離性要讀碼確認，不能靠命名猜。** 「Test.app」這個名字不保證資料分開；
   確認的依據是 `store.ts:106` 那行 `KEY` 由 `APP_VARIANT` 插值。
   猜錯的代價是把 Scott 真實的 13,194 字 PRD 蓋掉。
