# W4 收貨報告 —— UI ＋ 兩個既有地雷

**worktree：** `.claude/worktrees/agent-ae491953ea5b09c3e`（branch `worktree-agent-ae491953ea5b09c3e`）
**基準：** `ab2dd2d`（W3 完成）
**狀態：** 完成，**未 commit、未 push**（依派工要求）

---

## 開工前先修的事：worktree 落後 main 八個 commit

進來時 branch 停在 `7603b70`，**W1/W2/W3 全部不在** —— `src/lib/agent-backend.ts`
根本不存在。`git merge --ff-only main` 快轉到 `ab2dd2d` 之後才動手。

沒發現的話，會在一個沒有資料層的樹上把資料層再寫一次，而且 tsc 全綠、測試全過，
交回去才發現是兩份平行實作。**派工單裡「已完成並在 main 上」不等於「在你的 worktree 上」。**

派工單提到的「最後一節 W4 派工」也不在 commit 過的 plan 檔裡 —— 那段是主樹工作區
的未 commit 修改，從主樹的 `plans/` 讀到的。

---

## 改了哪些檔

| 檔 | 動了什麼 |
|---|---|
| `src/lib/agent-handoff.ts` | **C1**：`RUNNER` 改成 `Record<AgentFamily, FamilyRunner>`（四鍵 → 十鍵）；新增總函式 `runnerFor()`；刪掉 `AgentFamilyId` 型別 |
| `src/pages/tracking.ts` | **C1**：`as AgentFamilyId` 全部消失（4 處），改用 `AgentFamily` |
| `src/data/types.ts` | **C2**：新增 `AGENT_FAMILIES`（從 `AGENT_FAMILY_LABEL` 推導）與 `isAgentFamily()` |
| `src/lib/permissions.ts` | **C2**：`normalizeAgentFamily` 從 `family ?? "other"` 改成檢查成員資格 |
| `src/lib/agent-backend-ui.ts` | **新增**。兩張清單共用的純顯示邏輯 |
| `settings.html` | **W4-A**：新增 `🔌 Agent 執行後端` section（`#agent-backends-root`），放在 AI 金鑰設定與 AI Prompt 之間 |
| `src/pages/settings.ts` | **W4-A**：`renderAgentBackends()` 及其 CRUD／表單／CLI 探測 |
| `src/pages/agents.ts` | **W4-B**：detail 區塊的「執行後端」下拉 ＋ 解析結果顯示 |
| `tests/agent-handoff-runner.test.ts` | **新增**，C1 |
| `tests/agent-family-normalize.test.ts` | **新增**，C2 |
| `tests/agent-backend-ui.test.ts` | **新增**，W4 純函式（含金鑰不外洩） |

**零 `src-tauri/`。零 `store.ts`。** `landed: "pending"` 與族系隔離閘門一個字沒動
（`git status` 裡沒有 `store.ts`，那兩段就在裡面）。
`plans/uat-簽核流程重新設計-wave-2-實測.md` 沒碰過。

---

## 驗證數字（自己跑的）

```
bunx tsc --noEmit    → exit 0，零輸出
bun test             → 1959 pass / 0 fail / 96 files
```

基線 1907 / 93 files → **+52 tests / +3 files，測試檔零刪除**（1907 + 52 = 1959，93 + 3 = 96）。
新增的三個檔單獨跑：52 pass / 0 fail / 204 expect()。

沒有跑 `cargo` —— 這批一行 Rust 都沒動。

---

## 測試涵蓋了什麼

**C1（`tests/agent-handoff-runner.test.ts`，19 條）**
六個原本會 TypeError 的族系（`grok`/`pi`/`hermes`/`agy`/`gpt`/`local`）各驗一次；
六個有 CLI 的族系驗「前綴 `cd` ＋ 用對旗標」；四個沒 CLI 的驗「**不**前綴 `cd`」；
聯集外的髒字串（`"Pi"`、`"CLAUDE"`、空字串、`null`、`undefined`）回退到貼上模式。

最有價值的一條是「聯集裡每一個成員都有 runner」：它會在有人往 `AgentFamily`
加成員卻忘了補 runner 時變紅，**而那正是這個 bug 當初的產生方式**。

**C2（`tests/agent-family-normalize.test.ts`，17 條）**
八個髒字串各驗一次；合法成員原樣通過（收斂不可以誤傷）；非 agent 仍回 null。
核心那條是「兩個不同的髒值收斂後必須相等」—— 族系隔離靠 `===`，收斂前
`"Pi"` 與 `"pi "` 是兩個互不相同的「族系」，於是同一個被手改過的 agent
可以核准自己寫的文件。

**W4（`tests/agent-backend-ui.test.ts`，16 條）**
`cliProbe` 四種 state 分得開；`backendBinding` 在綁定值失效時有 warning、
且選中的是「跟隨預設」（因為那就是實際發生的事）；default 不可改名不可刪除。

金鑰那條用 **canary 字串 ＋ 整個回傳值序列化後搜字串**，不是檢查「有沒有
`apiKey` 欄位」—— 後者擋得住直接複製欄位，擋不住把金鑰拼進 `detail` 或
`label` 這種真的會發生的寫法。

---

## 規格外判斷與理由

### 1. `RUNNER` 用完整的 `Record<AgentFamily, …>`，不是 `Partial`

派工單只要求「任何成員都給得出指令」。用 `Partial` ＋ fallback 也做得到，
但那樣**加新族系不會有任何提示**。寫成完整 Record 之後，將來往 `AgentFamily`
加第十一個成員時 `tsc` 會在 `RUNNER` 紅燈 —— 這個 bug 當初就是這樣長出來的
（族系聯集長到十個，runner 表留在四個），值得把同一條路堵死。

### 2. 判準從「族系是不是 `other`」換成 `runner.cwd`

舊碼用 `input.family === "other"` 決定要不要前綴 `cd`。那只是「這串不是可執行
指令」的一個特例 —— 現在有四個族系走貼上模式，用舊判準會有三個誤前綴 `cd`，
交出去的東西看起來像可以執行但不是。

### 3. 顯示邏輯抽成 `src/lib/agent-backend-ui.ts`

兩張清單真正會出錯的地方（金鑰有沒有外洩、CLI 偵測不到時說了什麼、綁定與
解析不一致有沒有講）全部是純資料轉換。留在 `innerHTML` 樣板裡就只能靠人開
App 用眼睛看，而**金鑰外洩是硬性約束，不能靠眼睛看**。抽出來之後那條約束
是一條會紅的測試。

### 4. 預設後端在設定頁**不可就地編輯**，只給一句指路

派工單說 default 不可刪除、不可改名，沒說不可編輯。我做成不可編輯，理由是
同一頁上方已經有一份完整的全域 AI 設定表單，而 default 就是那份設定的投影。
兩份表單寫同一份資料，只要有一份沒即時重繪，畫面就會出現兩個互相矛盾的值 ——
而使用者無從判斷哪個是真的。default 那一列改成顯示
「在上方『🤖 AI 寫作教練模型與金鑰設定』修改」。

### 5. 既有金鑰不回填進 input，另給一顆「清除這把金鑰」

派工單只要求遮罩＋不顯示明文。我連 `value` 都不回填（欄位永遠是空的，
placeholder 顯示「已設定 —— 留空表示不變更」），因為回填等於把金鑰放進 DOM，
而 DOM 會進截圖、進錄影、進 bug 回報。

代價是「留空＝不變更」之後沒有辦法清空一把設錯的金鑰，所以補了一顆清除鍵 ——
否則使用者只能刪掉整筆後端重建。

### 6. `tracking.ts` 的交接族系下拉維持四個

`HANDOFF_FAMILIES` 現在型別是 `AgentFamily`，但選項還是四個。理由是那顆按鈕
不該變成十選一；原本「多寫一個沒有 runner 的族系就會炸」的限制已經消失，
所以這是策展，不是能力上限 —— 註解已改寫成這個意思。**要加隨時可以加。**

### 7. 第一版 `runnerFor` 有一個我自己寫出來的洞，測試抓到了

第一版是 `RUNNER[family] ?? PASTE`。對 `"toString"`／`"constructor"` 這類
`Object.prototype` 上的名字，它拿到的是**繼承來的函式**而不是 `undefined`，
`??` 因此不會觸發，接著 `runner.run` 不存在 —— 等於把要修掉的那個 TypeError
換一個入口再開一次。改成 `Object.prototype.hasOwnProperty.call()`，並留了
一條專門測這件事的測試。

---

## `pathOverride` 的規格缺口 —— 照預設做法處理

依派工單指示，**沒有改 Rust、沒有改 `agentCliRun` 簽章**。

實際做法：
- UI 照樣讓使用者填 `pathOverride`，存進該筆 backend
- 存檔成功後呼叫 `native.setCliPath(tool, path)` 把路徑推給原生端，再重跑
  `probeClis()` 更新畫面。**不推的話這一欄會是純裝飾**（存了但沒有任何人讀），
  那比「會被覆蓋」更糟
- 欄位旁邊直接寫：「⚠️ 同一個 CLI 工具只會套用**最後儲存**的路徑：兩個都綁
  同一個工具的後端各填一個，後存的那個會蓋掉前一個」
- `backendEditorHtml` 與 `pushCliPath` 各留一則 `ponytail:` 註解，寫明天花板
  （`set_cli_path` 是 per-tool 全域、`agent_cli_run(tool, prompt)` 不吃路徑）
  與升級路徑（Rust 端把 run 的簽章改成收 path，或收 backendId 由 Rust 自己查）

**給 PM 的判斷題：** 另一個成本更低的選項是**把 `pathOverride` 從 CLI 後端拿掉**，
改成設定頁上「每個 CLI 工具一個路徑」的獨立小表（那才是原生端真正的資料形狀）。
這樣就沒有天花板要解釋，也沒有「後存的蓋掉前一個」這種只有讀了說明才知道的行為。
代價是 W1 的 `AgentBackend.pathOverride` 欄位要移除。我沒有自己做這個決定，
因為它會動到已驗收的資料層。

---

## 另一件事：匯出的備份**含有 API 金鑰**（既有問題，這批讓它變寬）

硬性約束第 2 條要求動到匯出／log 路徑時自己確認一次。我沒有動那些路徑，但確認了：

- `src/lib/export.ts:148` `exportJsonFile()` 直接 `JSON.stringify({ …, state })`，
  **全檔沒有任何 redact／scrub**。`state.settings.apiKey` 因此原樣進備份檔
- event JSONL（`event-writer.ts` / `event-log.ts`）**乾淨**，不帶 settings
- 我新增的顯示層有測試釘住不外洩

也就是說：**這是升級前就存在的洞**（全域那把金鑰一直都在備份裡），但 W1 之後
`settings.backends[].apiKey` 會加入同一份 dump —— 從一把變成 N 把。

我沒有動它，因為把金鑰從匯出拿掉會改變備份的 round-trip 語意（還原之後金鑰
全空，使用者得重打），那是產品決定不是實作細節。**建議 PM 拍板**：
匯出時把所有 `apiKey` 換成 `""` 並在檔案裡留一行說明，或提供「含金鑰／不含金鑰」
兩種匯出。

---

## 沒做完 / 沒做的部分

1. **UI 的 DOM 行為沒有自動化測試** —— 依派工單「UI 的 DOM 行為不必硬寫測試」。
   純函式那一半有測試，`renderAgentBackends()` 的事件綁定沒有
2. **沒開 dev server 目視驗證**。兩張清單的實際外觀、`.form-group` 在
   `.pr-editor` 裡的排版、`.pr-badge` 在名稱欄的位置都沒有用眼睛看過 ——
   `tsc` 與測試證明不了版面。**建議列進 UAT**
3. **CLI 後端的實際呼叫沒有端到端跑過**（要桌面版 App ＋ 真的按下去），
   `probeClis` / `setCliPath` 這兩條原生呼叫在 `bunx vite` 下根本不會執行
4. **API 後端的表單只收 label／provider／model／endpoint／apiKey**。
   `localModelName` 與 `temperature` 沒放進表單 —— 依 W3 的
   `settingsFor()` 設計，後端沒填就落回全域值，那是正確的預設。要 per-backend
   調 temperature 的話再加
5. **`AgentFamilyId` 型別已刪除**。全 repo 沒有其他引用（grep 確認），
   但如果有人在未合併的分支上用它，合併時會撞到

---

## 建議的 UAT 題目（給 Uat skill 用）

1. 設定頁 → 看得到「🔌 Agent 執行後端」，第一列是預設且標著「預設（全域設定的投影）」，沒有刪除鍵
2. 新增一個 API 後端，ID 填空白 → 要看到「後端 ID 不可空白」原話
3. 用同一個 ID 再新增一次 → 要看到「已經有一個 ID 為「x」的後端」
4. 編輯剛才那個 API 後端 → 金鑰欄位是空的、是遮罩的，placeholder 說「已設定 —— 留空表示不變更」
5. 只改模型、金鑰留空 → 存檔後金鑰狀態仍是「金鑰已設定」
6. 桌面版：新增 CLI 後端 → 下拉只有 `claude`/`grok`/`pi`/`agy` 四個，各自標著偵測到或找不到
7. 瀏覽器版（`bunx vite`）：「＋ 新增 CLI 後端」是 disabled，且旁邊講得出「要開桌面版」
8. agents 頁 → 每個 agent 有「執行後端」下拉，選一個 → 立即生效，「目前實際使用」跟著變
9. 把某個 agent 綁的後端刪掉（會被擋，先解綁再刪）→ 驗證擋下來的訊息說得出是哪個 agent 在用
10. 追蹤頁：把專案的撰寫者族系設成 `grok`，按步驟交接 → **以前這裡會 TypeError**，現在要複製得出指令
