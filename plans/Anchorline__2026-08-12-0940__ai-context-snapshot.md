# AI 撰寫：專案快照前置 + 可勾選要寫哪幾份

**建立時間：** 2026-08-12 09:40
**最後更新：** 2026-08-12 09:40
**狀態：** 已完成

## 目標

AI 撰寫從「一鍵全寫」改成：

1. **前置**：既有專案要先有一份**專案快照**（完整讀過資料夾後存成的 MD）。
   沒有快照就不給寫 —— 沒讀過專案就寫出來的文件是編的。
2. **勾選**：使用者決定這次要寫哪幾份文件，不是整組覆蓋。
3. **新專案例外**：沒有資料夾的專案不需要快照，改走問答收集內容。

## 快照的規則

- 存在 `<專案>/.anchorline/context/<專案名>-<YYYYMMDD-HHmm>.md`
- **不覆寫**。每次重讀都是新檔，舊的留著 —— 快照是「當時的專案長這樣」，
  覆寫掉就沒有東西可以比對「這中間變了什麼」。
- 每次要 AI 撰寫時檢查有沒有快照：
  - 有 → 顯示它是多久以前做的、以及**落後多少**（快照之後的 commit 數）
  - 沒有 → 擋住 AI 撰寫，只給「讀取專案資料夾」

## 這會打破一條寫在文件裡的承諾

`docs/DATA.md` 現在寫著「只有一個地方，而且只寫一種檔」，
而快照是第二種檔。放在 `.anchorline/context/` 而不是專案根目錄，
是把新增的寫入限制在 App 自己的目錄裡；DATA.md 要同步改，
留一句跟行為相反的承諾比沒有承諾更糟。

`.gitignore` 的處置比照 log：預設不進 git（快照含專案原始碼片段）。

## 不做什麼

- 不自動重讀。落後多少要講出來，但要不要重讀是使用者的決定
- 不刪舊快照（不覆寫的意義就在這裡）
- 不把快照送進 git
- 不做快照之間的 diff 視圖（先讓「落後多少」這個數字有用）
- 新專案的問答不做多輪追問，先用單次表單

## Plan Steps

- [x] Step 1 — `project-snapshot.ts`：檔名、摘要組裝、落後判定（純函式） <!-- anc:t=5JPRRPYQ -->
- [x] Step 2 — `tests/project-snapshot.test.ts` <!-- anc:t=0BQW1C1V -->
- [x] Step 3 — Rust `scan_project`：讀資料夾內容（副檔名白名單、大小上限） <!-- anc:t=VS6G8E99 -->
- [x] Step 4 — Rust `write_snapshot` / `list_snapshots`：只准寫 `.anchorline/context/` <!-- anc:t=AWGGMS5M -->
- [x] Step 5 — `native.ts` 與 `docs/BRIDGE.md` 補契約；`docs/DATA.md` 改承諾 <!-- anc:t=W5G6QZ5Y -->
- [x] Step 6 — UI：快照狀態列（有／沒有／落後多少）與「讀取專案資料夾」 <!-- anc:t=W8CX6DHG -->
- [x] Step 7 — UI：勾選要寫哪幾份，AI 只重寫勾到的 <!-- anc:t=GMK43FRA -->
- [x] Step 8 — 新專案（無資料夾）走問答，不要求快照 <!-- anc:t=8GM0NHE0 -->
- [x] Step 9 — `bunx tsc --noEmit`、`bun test`、`cargo build` 全綠 + 實測 <!-- anc:t=DJCNBCFZ -->

## 驗證紀錄

- 指令：`bunx tsc --noEmit`（綠）· `bun test` **922 pass / 0 fail**（新增 17）· `cargo build --release` 綠
- 新專案路徑實測：顯示「新專案，沒有資料夾可讀」· 問答框出現 ·
  讀取鈕隱藏 · AI 鈕未被擋
- 既有專案路徑實測（注入 rootPath）：顯示「還沒讀過這個專案」·
  class 帶 is-block · **AI 鈕 disabled** · 讀取鈕出現 · 問答框隱藏
- 勾選：填完表單長出 proposal/spec/design/tasks 四項，預設全勾
- 未驗：實際掃描與寫檔（要桌面版原生橋）· 落後 N 個 commit 的顯示（要有快照）
