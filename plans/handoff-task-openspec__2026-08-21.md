# Handoff — task/openspec worktree → main session

**交棒人：** task/openspec worktree session（PM 角色，2026-08-21）
**接棒人：** main session（`project-anchorline-d7`，主 checkout）
**上一份參考：** `plans/handoff-main-session__2026-08-16.md`（不同主線——那份是對話框遷移，跟這份無關）

---

## 一句話現況

`task/openspec` branch 這一輪做完兩個功能，全部已 commit、tsc 乾淨、1359 測試全綠，**尚未 push、尚未 merge 進 main**。
Scott 要求：**merge 進 main、commit、安裝正式版**。

---

## 這個 branch 上做了什麼

`task/openspec` 領先 main 兩個 commit：

| commit | 內容 |
|---|---|
| `7f50e52` | OpenSpec 入口拆掉「開放迴圈掃描帶」，換成「帶入願望」下拉——選一條 Function wish list 的願望，自動帶入類型／標題／正文，不用回編輯台比對 id |
| `a36aaf2` | 新增「孤兒內容」偵測、搬移、刪除——套整份範本或換領域包會置換章節骨架但不刪正文，這批內容從此沒有畫面顯示；這次補上找回的路 |

`a36aaf2` 這支經過**三輪 `codex review --uncommitted`** 抓到並修掉 4 個真的問題（來源未驗證是否真孤兒、標題查詢池永遠查不到、章節內單一欄位被拿掉偵測不到、未存草稿的孤兒兩邊都找不到），細節見該 commit message 與 `openspec/changes/orphan-content-recovery/tasks.md`。

## Merge 前務必確認

1. `git fetch` 先看 main 有沒有新進度（另一個 session 在動 main，見下方）
2. `bunx tsc --noEmit` 與 `bun test` 在 merge 後的 main 上重跑一次——這個 worktree 跑起來是乾淨的，但 main 這段時間可能有別的變動
3. Merge 方式：這個 branch 沒有 force-push 疑慮，正常 merge 或 rebase 皆可，由 main session 判斷哪個更乾淨

## ⚠️ 一件與這次功能無關、但要處理的事

**`.mcp.json`（這個 worktree 裡未追蹤、未 commit）裡有一個看起來是真的 `BORDER_LOOM_MCP_TOKEN`**，
是 `codex review` 第二輪順手掃到的，不在 `.gitignore` 裡。我沒有動它——不是這次任務範圍，也不確定是否還在使用中。
main session 或 Scott 自己決定要不要 rotate／補進 `.gitignore`。

## 這批功能還沒做的事

- `openspec/changes/orphan-content-recovery/tasks.md` 5.2／5.3——真實瀏覽器流程（套範本製造孤兒→搬回去→存檔→重新載入確認還在；刪除路徑同樣重新載入確認）。這個專案沒有 DOM 測試環境，只能靠 UAT，需要 Scott 實機測。
- 「孤兒面板顯示原章節標題」對**一次性範本**造成的孤兒查不到（不屬於任何領域包），如實退回顯示原始 sectionId——已知限制，記在 tasks.md，要補齊是另一個 change 的量級。

## 安裝正式版

Scott 要求的下一步。main session 需要：
1. Merge 這個 branch 進 main（見上）
2. 確認版本號／CHANGELOG（若這個專案有這類慣例，照現有模式）
3. Build 正式版（照這個專案既有的 build/release 流程——這份 handoff 沒有涵蓋 build 指令細節，main session 對主 checkout 比較熟，照現有慣例走）
4. 安裝到 `/Applications`（或這個專案慣用的安裝位置）並確認啟動

---

## 給接棒者的提醒

1. `task/openspec` 這個 worktree 目前工作區乾淨（只有 `.mcp.json` / `.omo/` / `.playwright-mcp/` / `node_modules` 這幾個未追蹤項目，不影響 merge）。
2. Cato（codex 子代理）目前有 `maxTurns: 5` 的硬上限，透過 Agent 工具派工做開放式 review 會提早被切斷——這一輪繞過的方法是直接跑 `codex review --uncommitted`（CLI 內建的 review 指令），不經過 Cato 的 agent wrapper。如果之後還要對這個 repo 做 codex 審查，直接用這個指令比較穩。
