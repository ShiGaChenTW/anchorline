# 規格：原生對話框遷移

> 派工用規格。**釘死那些 agent 否則會自己發明的決定。**
> 建立 2026-08-16。適用範圍：**34 處** `alert` / `confirm` / `prompt` 呼叫點，分佈於 `src/pages/` 下 **10 個檔案**。
>
> ⚠️ 本規格初版寫「36 處、11 個檔案」，是未過濾的 grep 產物——把三行散文註解
> （`auth.ts:3`、`project-folder.ts:87`、`admin.ts:390`）當成呼叫點算了。
> 實際 37 個 grep 命中 − 3 個註解 = **34**。另：`src/` 裡**沒有任何 `alert()` 呼叫**，
> 所以 `showAlert` 的呼叫點數為零，那是正確結果不是遺漏。

## 為什麼要做

`tauri-plugin-dialog` 的注入腳本把 `window.confirm` 蓋成 **async 函式** —— 回傳 Promise、恆為 truthy。
於是全 App 每一個 `if (!confirm(...)) return` 守門**全部失效**：刪除、放行、覆寫都變成不問直接做。

2026-08-14 實測：編輯台按 ✕ 無聲刪掉子章節。根因就是這個。

目前靠 `src/lib/auth.ts` 模組頂層 `delete window.confirm` 退回原生實作撐著。**那是 workaround，不是修好。**

## 已確立的先例（不要重新發明）

`src/lib/project-folder.ts` 的 `askForProjectFolder()` 已經示範了正確做法。新 helper 照抄它的結構：

```
<div class="modal-back open" id="...">
  <div class="modal" role="dialog" aria-labelledby="..." aria-modal="true">
    <header><h3 id="...">標題</h3><button class="btn btn-ghost btn-sm">關閉</button></header>
    <div class="body"><p class="sub">說明</p></div>
    <footer><button class="btn">取消</button><button class="btn btn-primary">確認</button></footer>
  </div>
</div>
```

CSS 全部已存在於 `shared.css`（`.modal` / `.modal-back`），**不要新增樣式**。

⚠️ **`.modal-ask` 不可沿用。** 它是 onboarding wizard 的外殼（`projects.html:170`，`class="modal modal-wizard modal-ask"`，帶 `width: min(560px, 92vw)` 與自己的子元素），不是通用確認框。只用 `.modal` + `.modal-back`。

## 決定集（不得自行更動）

| 項目 | 定案 |
|---|---|
| 檔案位置 | `src/lib/ask.ts`，單一新檔 |
| 匯出 | `askConfirm(opts): Promise<boolean>`、`askText(opts): Promise<string \| null>`、`showAlert(opts): Promise<void>` |
| 回傳語意 | `askConfirm` 取消回 `false`；`askText` 取消回 `null`（空字串是合法輸入，**不可**與取消混用） |
| 參數 | 物件形式。共用 `{ title, body?, confirmLabel?, cancelLabel?, danger? }`；`askText` 另加 `value?: string`（預填）與 `placeholder?: string`。**不接受位置參數** |
| 危險動作 | `danger: true` 時確認鈕用 `btn btn-warn-confirm`，且**預設焦點在取消鈕** |
| HTML 插值 | 一律經 `escapeHtml`。`project-folder.ts` 已有一份，抽到 `ask.ts` 共用並讓原處改 import |
| 樣式 | 只用既有 class，不新增 CSS |
| 鍵盤 | ESC = 取消；Enter = 確認（`danger` 時 Enter 不觸發確認）；焦點鎖在 modal 內 |
| 清理 | 關閉時 `remove()` 整個 `.modal-back`，並解除 keydown listener |
| 併發 | 同時只允許一個。已有開啟中的 ask 時，後來者 reject |
| 命名 | DOM id 前綴用 `dlg-`。**不要用 `ask-`** —— 那個命名空間已被 onboarding wizard 佔用（`.ask-progress` / `.ask-seg` / `.ask-body`） |

## 遷移規則

- `if (!confirm(x)) return` → `if (!(await askConfirm({ title: x }))) return`
- 呼叫端函式必須改成 `async`；若原本是事件 handler，改為 `async` 箭頭函式
- `alert(x)` → `await showAlert({ title: x })`
- `prompt(x, def)` → `await askText({ title: x, value: def })`
- **文案一字不改。** 現有中文訊息原樣搬進 `title`，不要順手改寫
- 刪除／清空／覆寫類的確認一律加 `danger: true`

## 不在範圍內

- **不要動 `src/lib/auth.ts` 的 `delete window.confirm`。** 那個 workaround 必須等 36 處全部遷完才能拆，是最後一步，不屬於任何單檔任務
- 不要改既有 modal（`settings-modal.ts` / `help-overlay.ts` / `askForProjectFolder`）
- 不要重構呼叫端的其他邏輯

## 驗收

```bash
bun test                                   # 基線 1214 筆必須全綠（不是 1191，那是舊數字）
bunx tsc --noEmit                          # 型別必須乾淨（async 改動最容易漏這裡）
grep -rnE '\b(window\.)?(alert|confirm|prompt)\s*\(' --include='*.ts' src | grep -v '^src/lib/ask.ts'
```

第三條在**全部遷完後**應只剩註解命中。單檔任務只需該檔歸零。

⚠️ `tsconfig.json` 的 `include` 只有 `src/**/*.ts`，**`tests/` 不在型別檢查範圍內**。tsc 只保得住 helper 本身。

### 測試策略：不引入 DOM 環境

這個 repo 的 `bun test` **沒有 DOM**（`document` / `window` 皆 undefined，且無 happy-dom／jsdom／linkedom）。63 個測試檔零個碰 DOM。

**決定：不為了這個檔案加 DOM 相依。** 改成把 `ask.ts` 的純邏輯與 DOM 渲染分開：

| 純邏輯（必須有測試，headless 可跑） | DOM 行為（留給實機 UAT） |
|---|---|
| `escapeHtml` | modal 是否正確渲染 |
| 併發守衛：第二次呼叫被 reject | 焦點鎖、`danger` 時焦點在取消鈕 |
| 回傳值對應：確認／取消 → `true`／`false`／`null`／空字串 | ESC 取消、Enter 確認 |
| 選項預設值填補（label 預設值等） | 關閉後 DOM 與 listener 是否清乾淨 |

作法：把上述純邏輯寫成 `ask.ts` 內可獨立匯出的函式（不碰 `document`），由 `tests/ask.test.ts` 直接 import 測試；DOM 部分只在三個 async 函式內部使用。

**為 Anchorline 補 DOM 測試環境是一張獨立的票**，不在這個任務範圍內——它會影響現有 1214 筆測試的執行環境，值得單獨評估。

## 遇到規格沒寫到的情況

**停下來回報，不要自己決定。** 這份規格的漏洞比一個猜錯的實作便宜。
