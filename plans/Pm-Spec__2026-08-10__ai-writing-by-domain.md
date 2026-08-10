# AI 撰寫設定：改用領域包分類，移除撰寫角色

> 建立：2026-08-10
> 目標：拿掉自訂「撰寫角色」，改以既有的 5 個領域包為分類單位；各領域可沿用通用版本，也可獨立設定。

## 起因

1. **「新增角色」按不動** — 用了 `window.prompt()`。Tauri 的 WKWebView 沒有實作 text input panel，
   `prompt` 直接回 null，按鈕看起來像壞掉。上一輪我在瀏覽器 preview 驗證，剛好避開這個差異。
   → 新設計全面禁用 `prompt`。`confirm`（WKWebView 有實作）維持現狀，但標為未在 app 內實測。
2. **自訂角色是多一層概念** — 使用者要的分類軸本來就存在：領域包。角色與領域重疊，
   維護兩套分類只會讓「這份 PRD 該用哪個角色」變成每次都要想的問題。

## 設計

分類軸 = 領域包（`generic` / `digital_account` / `lending` / `payment` / `wealth`）。
`generic`（通用）是基底，其餘領域的每個欄位可以**沿用**或**自訂**。

```
byDomain: {
  generic:  { globalInstruction: "…", styleSample: "…", sectionPrompts: {…} },   // 基底
  payment:  { globalInstruction: "…" },                                          // 只覆寫這個欄位
}
```

- 欄位值 `undefined` = 沿用通用；字串（含空字串）= 自訂。
  用 `undefined` 而不是空字串當「沿用」，是因為「我要它空著」和「我沒設定」是兩件事。
- 解析：`byDomain[D][F] ?? byDomain.generic[F] ?? ""`。
- 章節提示詞同理，但**領域限定章節沒有通用版可沿用**（如支付的 08–10 在通用領域不存在），
  這些章節不顯示沿用按鈕。

### UI

每個可繼承欄位旁一顆按鈕：
- 目前沿用中 → 顯示唯讀的通用內容 + 「改成自訂」
- 目前自訂中 → 顯示自己的輸入框 + 「沿用通用版本」（按下即還原成繼承並顯示通用內容）

通用領域本身不顯示這顆按鈕（它就是基底）。

## 步驟

- [x] 1. 型別：`aiWriting.byDomain` 取代 `profiles/activeProfileId/globalInstruction/styleSample/sectionPrompts`
- [x] 2. store：載入時遷移舊資料（角色 → generic）、`sectionsForDomain`、`resolveWriting(domain)`、setter
- [x] 3. ai-coach：依專案領域取解析後的設定
- [x] 4. settings：領域選擇 + 繼承 UI，移除角色相關程式與 DOM
- [x] 5. 測試：繼承解析、遷移、領域限定章節不給沿用按鈕
- [x] 6. 移除 prompt 依賴並確認 app 正常啟動渲染（互動實測在瀏覽器，見下）

## 結束摘要

全部完成。568 測試通過（新增 13 個繼承／遷移測試）。

**與計畫的偏離**：AI 塑造（`suggestWriteProfile`）原本產生新角色，改成產生「目前領域的
全域指令」並直接填進欄位（自動從沿用轉自訂）。角色概念既然移除，建議產物需要別的落點。

**實測（瀏覽器 preview，與 app 同一份 dist）**
- 通用領域：7 章、無繼承按鈕（它是基底）✓
- 切支付：章節 7→10、全域指令唯讀且下方顯示通用內容 ✓
- 按「改成自訂」：以通用值當起點、變成可編輯 ✓
- 改支付的值後切回通用：通用未被汙染；再切回支付：值還在 ✓
- 章節層級：01–07 有沿用按鈕，08–10 標「領域限定章節」且無按鈕 ✓

**實測（Tauri app）**：只驗到正常啟動與渲染。上述互動未在 app 內逐一重點，理由是
剩下的 Tauri 差異只有 `window.prompt`，已全域移除並以 grep 確認（僅存註解）。
其餘皆為純 DOM，兩邊同一份 dist。

**過程中修掉的自造 bug**：`saveCurrentDomainFields()` 一開始放在 `updateSettings` 之後 ——
`updateSettings` 會 emit，訂閱者立刻用舊值重畫 textarea，之後讀到的是被清空的框，
打的字直接消失。跟先前角色切換是同一類錯誤（先改 store 再讀 DOM）。移到最前面。
