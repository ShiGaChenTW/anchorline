# TUI 渲染修正 — T1 止血 + T2 單欄精緻化

**建立時間：** 2026-08-10 22:51
**最後更新：** 2026-08-10 22:57
**狀態：** 已完成

## 目標

修掉 `track-tui.ts` 三個會誤導人的渲染缺陷：顯示寬度算錯導致垂直分隔線在
31–34 欄之間飄、百分比與計數說不同話、狀態用子字串比對會把「尚未完成」判成完成。
順序刻意先修寬度——後面要加的語意符號全落在寬度誤判區，先加只是多生歪列。

範圍是 PRD 的 T1 + 縮編後的 T2，不做 T3（雙欄完整版／滑鼠／設定面板）。

## Plan Steps

- [x] Step 1 — `ansi.ts`：正確的 `charWidth`/`cells`，`dw()` 與 `pad()` 走同一套
- [x] Step 2 — 百分比與計數對齊（`planProgressPct` 的分子與標籤一致）
- [x] Step 3 — `statusColor` 改封閉列舉完全比對，對不上顯示未知
- [x] Step 4 — 步驟圖示改 `Record<StepState, …>`，加狀態時編譯期就擋
- [x] Step 5 — 左欄幾何封口：每列 `displayWidth` 恰等於 `leftW`
- [x] Step 6 — `?7l` 關自動換行 + `?2026h/l` 同步輸出
- [x] Step 7 — 測試：寬度 / pct 一致性 / 詞彙執法

## 決策紀錄

- 22:51 — 併入現有 `ansi.ts` 而非整檔複製姊妹專案的 217 行。原因：Anchorline 只有
  `dw()`/`pad()` 是壞的，其餘 `pal`/`enterAlt`/`boxLine` 都在用；整檔複製會帶進
  `paint`/`Style`/`truncate` 等用不到的 API 並逼所有呼叫端改寫。排除「照 PRD §10 整檔複製」。
- 22:51 — 檔名用 repo 既有慣例 `YYYY-MM-DD_slug.md`，不用 Skill 的
  `<project>__…` 三段式。原因：plans/ 已有 22 檔採前者，且 Skill 自述檔名不影響解析；
  加專案前綴在單專案 repo 只會破壞與既有檔的排序。

- 22:55 — 進度真相收成 `planProgress()` 一個函式回傳 `{closed, total, pct}`，而不是
  在呈現端各自算。原因：分開放就永遠可能再長出第二種寫法（PRD §7.3）。
  `planProgressPct()` 保留為它的薄殼，網頁端不必改簽章。
- 22:56 — 驗證用的量測腳本改用 Python `unicodedata` 的 EAW 表，不是引用 `ansi.ts`
  的 `dw()`。用自己的函式驗自己的函式是自我驗證，證明不了任何事。

- 23:02 — 網頁端一起收（Scott 指示）。`tracking.ts` 三處與 `projects.ts` 一處全部
  改走 `planProgress()`；分桶標籤由「已完成」改「已結束」，因為那一桶也收全部
  放棄的 plan，寫「完成」同樣是在騙人。

## 阻塞 / 待決議

- **`tracking.html` 的計劃列表在瀏覽器裡驗不到。** `loadPlans()` 在 `canScanPlans()`
  為 false 時直接 `loadEmpty()`，而該旗標只有 Tauri 原生橋在時為真——所以
  `planRow()` 與分桶那三處改動只能在桌面版跑到。本次只驗到「頁面載入零 JS 錯誤、
  零 row」，沒有驗到列表本身的呈現。`:94` 那句「退回靜態快照」的註解已經與程式
  不符（現在沒有靜態快照路徑），順手記著，之後誰改誰修。

- **Ambiguous 寬度是按目標終端釘死的假設，不是普世事實。**
  `charWidth()` 把 East Asian Ambiguous 當 1 格，只有 `—`(U+2014) 與 `…`(U+2026)
  例外算 2。這與 macOS 中文終端實測一致，但換到把 Ambiguous 一律當 2 格的終端
  （少數 CJK locale 設定）框線仍會歪。要更保險就得改用 DSR 游標查詢實測，
  或把 `▶ • ○` 這批 Ambiguous 圖示換成 ASCII——目前不值得。

## 結束摘要

三個會誤導人的缺陷都修掉了，另加兩個 DEC 序列。

**做了什麼**
- `ansi.ts`：`code > 0xff ? 2 : 1` 換成真的 `charWidth()`／`cells()`，處理零寬組合
  附加符號與變體選擇子；`pad()` 重寫成「回傳值 `dw()` 必等於 width」的契約，
  截斷時保留 SGR 序列並補回 reset。加 `syncFrame()`；`enterAlt` 補 `?7l`。
- `plan-parser.ts`：新增 `planProgress()` 單一真相；`STATUS_WORDS` 改為 export
  並附 `asStatusWord()` 完全比對。
- `track-tui.ts`：狀態與步驟圖示各收成 `Record<…>`；進度標籤改印 `closed/total 已結`；
  body 兩側都過 `pad()` 封口；`draw()` 整幀包進同步輸出。
- `pages/tracking.ts`：分桶改用 `planProgress().closed`、桶名改「已結束」、
  列表與詳情兩處數字改印 `closed/total`。`pages/projects.ts`：統計列標籤改「已結」。
- `tests/tui-render.test.ts`：89 個檢查，含「pct===100 ⟺ closed===total」的
  等價關係——三個呈現端都靠它，任一邊改回 `done_steps` 就會紅。

**T2 剩餘四項（2026-08-10 23:2x 補完，Scott 指示做完）**
- **gauge 改 ASCII** `=`／`.`，不用 █ ░——後者在部分等寬字型會被反鋸齒黏成一整條
  實色，刻度消失；`=` 之間永遠有間隙，貼進 issue 或 CI log 也不依賴字型。
- **相對時間**：`建立 48 分鐘前 · 更新 42 分鐘前`。直接複用既有的
  `time-format.ts` 的 `sinceLabel(iso, nowMs)`（`nowMs` 可注入所以測得動），
  沒有另寫一份。解析不了就原樣吐回。
- **spinner**：braille，只在有追蹤目標時轉。時脈改 125ms，但資料每 8 拍才重讀
  （仍是 1 秒，沒多做 I/O）；`tick` 只在 `state.tracking` 非空時前進，所以閒置
  時整幀不變、去重擋掉重畫，閒置成本仍是零。
- **三段斷點**取代 `Math.max(60, cols)`：≥100×28 雙欄／≥50×12 單欄 compact／
  以下只印置中提示。夾住數字不會讓版面排得下——版面引擎正是在那個尺寸失效的
  東西，正解是不啟動它。

**未完成**
- `tracking.html` 計劃列表的瀏覽器驗證——Scott 已在桌面版自行確認 OK。

**後續建議**
- T3（雙欄完整版／滑鼠／設定面板／多專案管理）維持不做。理由不變：Tauri 版
  已經有，而且做得比終端好。
