# Anchorline — 專案內規則

## 新增主題必須改四層，少一層會靜默回退

主題註冊在這個 repo 是**四層重複**，全部改到才會生效：

每一份 bootstrap 內部**還有兩個獨立退路**：主題名不認得時的 `if(!m[t])`，
以及整段 try 失敗時的 `catch`。所以改預設值要動的是 14×2 + theme.ts + theme.js
＝ 30 個點，不是 16 個。catch 那一路正常永遠不會執行，改漏了不會有任何症狀 ——
只有在 localStorage 讀取失敗時才會突然冒出舊的預設主題。

1. `shared.css` — `[data-theme="<id>"]` token 區塊 + `html[data-theme="<id>"]` chrome 覆寫
2. **每個 HTML `<head>` 的內嵌防閃爍 bootstrap**（14 檔）— 自帶一份 `var m={kami:[…],github:[…]}`
   白名單，`if(!m[t])t="github"`。**不在名單就強制回退，不報錯**
3. `src/lib/theme.ts` — `THEMES` 物件 + `migrateLegacy()`
4. `src/data/types.ts` — `ThemeId` 聯合型別（漏了 tsc 會擋）

`theme.js`（repo 根目錄）**沒有任何頁面載入它**，是遺留檔。只改它等於什麼都沒改。

驗收條件：執行時 `document.documentElement.dataset.theme` 必須等於目標值。
靜態 grep 單一檔案不構成證據 —— 症狀是「切了沒反應」而非錯誤訊息。

## 驗證要用自己的 dev server

`localhost:5173` 通常是主 repo（`~/Documents/20_Projects/Project_Anchorline`）在跑。
在 worktree 裡驗證要 `bunx vite --port <其他埠> --strictPort`，否則你會對著別的 checkout 截圖。
