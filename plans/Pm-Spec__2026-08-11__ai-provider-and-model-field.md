# AI 設定：模型欄位被覆寫 ＋ 供應商通路選擇

**狀態：** 完成
**開始：** 2026-08-11

## 問題（已實機重現，非推論）

### A. 打字打不進去 —— 模型欄位被舊值覆寫

一次 `change` 事件，`#ai-model` 被寫回**舊值 10 次**，全部來自
`populateSettings`（`settings.ts:325`）經由 `store.subscribe`（`store.ts:368`）。
輸入的 `gpt-4o` 消失，欄位回到 `gemini-2.5-flash`。

機制：

```
blur → change → autoSave(300ms) → saveSettings()
  ├─ saveCurrentDomainFields()        ← 先跑，內含 3+ 次 store 寫入
  │     └─ 每次寫入 emit → populateSettings → #ai-model.value = 舊值
  └─ 讀 #ai-model.value               ← 此時已經是舊值，於是「存回舊值」
```

`saveSettings` 開頭的註解已經為 textarea 記過同一個坑，解法是把
`saveCurrentDomainFields()` 移到 `updateSettings` 之前 —— 但它自己也會 emit，
而模型欄位是在它**之後**才讀的。坑沒有被填掉，只是換了一個欄位掉進去。

### B. 沒有供應商選擇

`detectProvider` 用模型 ID 開頭猜供應商（`gemini` / `claude` / `gpt`）。
任何不照這個命名的模型都掉進 `custom`。使用者要能直接指定通路。

## 方案

**A：** `saveSettings` 先把所有 DOM 值讀進區域變數，再做任何 store 寫入。
額外保險：`populateSettings` 不覆寫目前有焦點的欄位。

**B：** `AISettings.provider`：`auto | gemini | openai | anthropic | ollama | custom`，
預設 `auto`（維持現有前綴推斷，舊設定不會壞）。`detectProvider` 在非 `auto` 時直接採用。

## 步驟

- [x] 實機重現 A，取得 stack 證據
- [x] 定位 B 的推斷邏輯
- [x] A：`saveSettings` 先讀後寫
- [x] A：`populateSettings` 跳過焦點欄位
- [x] B：type 加 `provider`
- [x] B：`detectProvider` 尊重明示值
- [x] B：settings.html 加下拉選單
- [x] B：settings.ts 綁定 + 端點連動
- [x] typecheck + test

## 結束摘要（2026-08-11）

實機驗證（Interceptor，test profile）：

| 檢查 | 修正前 | 修正後 |
| --- | --- | --- |
| 打 `gpt-4o` 後觸發 change，欄位值 | `gemini-2.5-flash`（被吃掉） | `gpt-4o` |
| localStorage `settings.model` | 舊值 | `gpt-4o` |
| 切通路 → 端點 | 不存在 | `anthropic` → `https://api.anthropic.com` |
| 手打自訂端點後切通路 | — | 保留 `https://my-gateway.internal/v1` 不被蓋 |

`bunx tsc --noEmit` 乾淨；`bun test` 702 pass / 0 fail。

**已知未處理：** 一次儲存仍會 emit 9 次，整頁欄位重畫 9 次。結果正確（最後一次寫入
是新值），但那是浪費，而且是「焦點欄位保護」必須存在的原因。要根治得讓
`saveCurrentDomainFields` 批次寫入後只 emit 一次 —— 屬於 store 的改動，另案。
