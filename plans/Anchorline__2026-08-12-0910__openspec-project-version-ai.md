# OpenSpec 入口：選擇專案 · 是否加入版號 · AI 撰寫

**建立時間：** 2026-08-12 09:10
**最後更新：** 2026-08-12 09:10
**狀態：** 已完成

## 目標

三件事都要接到既有機制，不是各做各的：

1. **選擇專案** —— 這一頁的每一塊（開放迴圈帶、AI 的上下文、要收進哪一版）
   都是專案層級的，但目前只能被動跟著側欄的 activeProject 走。
2. **是否加入版號** —— 版號規則裡 YY 要求「收的內容有走過 OpenSpec 的 change」。
   建立 change 的當下正是把它收進某一版的時機，錯過就要之後自己回去補。
3. **AI 撰寫** —— 產生的是骨架，每一段都是 `[方括號提示]`。
   AI 依標題與專案的 PRD 內容把骨架填成初稿。

## 設計

**選擇專案**放在工作區最上面：它決定下面所有東西的範圍。
選了要同時更新 store 的 activeProject，否則這一頁跟側欄會各講各的。

**版號**放第 3 步（拿走文件的那一刻），選項是「不收」或某個**尚未放行**的版號。
已放行的不出現 —— `canAddItem` 會擋，讓它出現在清單裡只是製造一次失敗。
按下建立時才真的寫進去，跟下載同一個動作，不另外一顆按鈕。

**AI 撰寫**放第 2 步之後（有了標題才有東西可寫）。
產出直接換掉預覽裡的內容，下載與複製拿到的就是 AI 版本。
沒設 AI 時按鈕要說得出去哪裡設定。

判定進 `change-templates.ts` 的純函式：組 prompt、把模型輸出套回檔案。
模型少回一個檔就保留骨架，不要整組失敗。

## 不做什麼

- 不自動建立版號（版號一律由使用者決定，`release.ts` 的承諾）
- 不在這裡改 change 的內容之後又寫回磁碟（維持只產生文件的界線）
- 不讓 AI 決定 change id 或類型（那是使用者的判斷）
- 不做預覽區的即時編輯（先看 AI 初稿夠不夠用）

## Plan Steps

- [x] Step 1 — `change-templates.ts`：AI prompt 組裝與輸出套回的純函式 <!-- anc:t=W7V3ZXJP -->
- [x] Step 2 — `tests/change-templates.test.ts`：套回、缺檔保留骨架、垃圾輸出不炸 <!-- anc:t=4HBP7FMA -->
- [x] Step 3 — `openspec.html`：專案選單、版號選單、AI 撰寫按鈕 <!-- anc:t=AK7FR028 -->
- [x] Step 4 — `openspec.ts`：專案切換同步 store、版號清單只列未放行 <!-- anc:t=79P4J1QF -->
- [x] Step 5 — `openspec.ts`：AI 撰寫接 `chatCompletion`，三種失敗各自說清楚 <!-- anc:t=PK9412FY -->
- [x] Step 6 — 建立時把 change 寫進選定的版號 <!-- anc:t=MWZMFF68 -->
- [x] Step 7 — `shared.css` 樣式 <!-- anc:t=STV2FB8C -->
- [x] Step 8 — `bunx tsc --noEmit`、`bun test` 全綠 + Interceptor 實測 <!-- anc:t=F6H7AN6W -->

## 驗證紀錄

- 指令：`bunx tsc --noEmit`（綠）· `bun test` **905 pass / 0 fail**（新增 8）· `cargo build --release` 綠
- 實測：專案選單填入專案清單 · 版號第一項為「加入該專案」· AI 按鈕存在 ·
  三張卡仍等高（247/247/247）· AI 未設定時訊息指向偏好設定
- 中途追加：openspec init 偵測與一鍵執行（Rust `openspec_probe` / `openspec_init`）
- 未驗：openspec init 的偵測與執行需要綁定資料夾的專案；AI 撰寫需要設定金鑰
