# L2 派工鏈 — 交接時把錨點一起交出去

**建立時間：** 2026-08-10 22:44
**最後更新：** 2026-08-10 23:00
**狀態：** 進行中（等實機驗證）

## 目標

方案 A 的前半：讓錨點在治理鏈的起點誕生，並在派工時交給執行端。
本階段只做**傳輸無關**的那一層 —— 交接內容本身。傳輸方式（URL scheme／
remote HTTP／貼指令）是另一個決定，見下方阻塞。

## 開工前的發現

**現在的交接 prompt 完全沒有提到錨點。** `buildPrompt()` 只帶 task、openspec
change、下一個 artifact。所以即使今天用 App 產生的指令派工，agent 也不會知道
要把 `anc:t=` 寫進 commit —— 事件回填時就串不回 plan 步驟。

L0 探針之所以串得起來，是因為那次的錨點是人手動塞進 prompt 的。這不是設計，
是巧合。

**Border Loom 已經有一個外部建 task 的入口**：給手機用的 remote HTTP server
（`src-tauri/src/remote.rs`，3701 行），`CreateTaskRequest { projectId, name, prompt }`
走的是跟桌面「New Task」同一條 `createTask`。它有配對 PIN 與 token 分級
（coordinator / mobile / paired），**但要使用者先開啟該功能並交換 token**。
Border Loom **沒有** deep-link / single-instance plugin，也沒有註冊任何 URL scheme。

## Plan Steps

- [x] Step 1 — `HandoffInput` 加 `anchor`，並驗證 Crockford 合法性
- [x] Step 2 — `buildPrompt()` 明確要求 agent 把 `anc:t=<id>` 寫進 commit 訊息
- [x] Step 3 — 抽出傳輸無關的 `HandoffPayload`（projectRoot／taskName／prompt／anchor／authorFamily）
- [x] Step 4 — 測試：錨點進 prompt、不合法錨點被擋、職務分離仍生效
- [x] Step 5 — 傳輸層：方案 a（貼指令）。Task Tracking 每個未完成且有錨點的步驟加「交接」鍵

## 決策紀錄

- 23:00 — **傳輸選 a（貼指令），Scott 決定。** 但要修正一件事：a 不是「今天的
  做法」—— `agent-handoff.ts` 從來沒有被任何頁面 import 過，只有測試在用。
  今天之前這個 App 根本沒有交接 UI。所以 a 的成本不是 0，是這一輪做的這些。
- 23:00 — 交接鍵放在 Task Tracking 的步驟上，不放審閱頁。步驟才是錨點所在的
  地方，而交接的最小單位就是一個步驟。
- 22:44 — 先做傳輸無關的那一層。三種傳輸方式都需要它，而傳輸方式的選擇
  還沒定 —— 先寫會有一半機率白寫。

## 阻塞 / 待決議

**傳輸方式三選一，需要 Scott 決定：**

| 方案 | Border Loom 要做什麼 | 代價 |
|---|---|---|
| **a. 貼指令**（今天的做法） | 什麼都不用做 | 每次多一次複製貼上；但攻擊面為零，符合 Anchorline 既有界線 |
| **b. remote HTTP** | 什麼都不用做（已存在） | 使用者要先開「連線手機」並交換 token；還要解決 Anchorline 不知道 Border Loom 的 projectId（remote API 只回 id + name，沒有路徑） |
| **c. URL scheme** | 加 deep-link + single-instance plugin、註冊 scheme、改 Info.plist | 零設定、app 沒開也能喚起；但動到打包，要重跑體積報告 |

## 結束摘要

（待補）
