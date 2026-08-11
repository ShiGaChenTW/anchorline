# 簽核管理頁

**狀態：** 完成
**開始：** 2026-08-11

## 需求（Scott）

> 新增頁面：簽核管理，這個頁面管理該專案所有 PRD 簽核相關作業，
> 例如各關卡簽核狀態、簽核紀錄、簽核意見等。

## 盤點：三件事裡只有一件已經有資料

| 要的東西 | 現況 |
|----------|------|
| 各關卡簽核狀態 | **有資料**。`CaseStage{state, assigneeId, assigneeName}`，但管理介面埋在「管理中心 → 個案」那一頁，是**跨專案**的工作區管理，不是這個專案的簽核作業台 |
| 簽核紀錄 | **沒有**。`CaseStage` 沒有任何時間戳，簽核者身分被塞進 `assigneeName`（`"名字 · 已簽"`）。唯一的時間痕跡是稽核事件，而稽核只在桌面版＋匯入專案才寫得出來 |
| 簽核意見 | **完全沒有**。整條流程裡簽核者只能按核准，沒有任何欄位可以留一句話。有文字的只有：抽單理由、專案層級留言（不掛在關卡上）、commit/merge 訊息（實際上都是空字串） |

所以這不是「把既有資料換個版面」，前兩項要補資料模型。

## 做法

### 1. 資料模型（向後相容，全部 optional）

`CaseStage` 加四個欄位：`decidedAt` / `decidedById` / `decidedByName` / `comment`。
舊資料沒有這些欄位仍然讀得動，畫面顯示「—」。

**不動 `assigneeName` 的「· 已簽」後綴**（那是既有行為，改了會讓舊案子的顯示變樣），
但新的簽核一律同時寫進 `decidedByName`，紀錄以它為準。

### 2. `src/lib/signoff.ts`（純函式，可測）

- `canSignStage(user, project, stage)` —— 把目前**散在兩處**的判斷合成一支：
  專案層級的職責分立（`canApproveProject`）＋ 關卡層級的歸屬
  （admin／指派給我／未指派且我是簽核人）。現在後者是寫在 `store.approveAndLock`
  迴圈裡的行內條件，畫面要顯示「為什麼我不能簽」時無從呼叫。
- `stageRows(...)` —— 關卡視圖模型（狀態、簽核人、時間、意見、我能不能簽、不能的理由）
- `signoffTimeline(...)` —— 把三個互不相干的來源併成一條時間軸：
  關卡決策戳記、`prdVersions`（commit/merge）、`CaseRecord` 的抽單欄位、稽核事件（有才加）
- `signoffSummary(...)` —— 幾關已簽／卡在誰身上／能不能合併

### 3. 頁面 `signoff.html` + `src/pages/signoff.ts`

三段：**現在卡在誰身上**（頭條）→ **關卡清單**（可簽核、可留意見、admin 可改派）
→ **簽核紀錄**（時間軸）。沿用 PRD 審閱監控的視覺語言。

### 4. 註冊 10 處

vite input／`RailPage`／`IC`／`RAIL_ITEMS`／`projActionsHtml`／`status-bar`／
`MobileNavPage`／`help-overlay` 數字鍵／`hub.ts` 數字鍵／頁面自身的 `requireAuth` 樣板。

## 刻意不做（要講清楚）

**不加「退回／駁回」的狀態機。** 現在的關卡狀態只有
`approved | pending | empty | skipped`，沒有負向決策；負向路徑是作者端的「抽單」。
加一個 `rejected` 會連動 `allStagesSettled`、重送時的作廢規則、
稽核事件的 `EventKind` 白名單與 `PAYLOAD_ALLOW`，是一次獨立的治理變更，
不該混在「做一個管理頁」裡順手改掉。**這一頁會把這個缺口明講**，
而不是假裝流程完整。

## 步驟

- [x] 盤點既有簽核資料模型與四個介面（review／admin／write／editor）
- [x] `types.ts` 擴充 `CaseStage`（4 個 optional 決策欄位）
- [x] `store.approveAndLock({comment, stageIds})` 收意見並寫決策戳記
- [x] 新增 `src/lib/signoff.ts` 純函式 + 23 個測試
- [x] 新增 `signoff.html` / `src/pages/signoff.ts`
- [x] 註冊 10 處 + CSS
- [x] tsc / 752 tests / 實機簽核驗證 / 重建測試版

## 一個順手修掉的 footgun

`approveAndLock` 舊行為對 admin 是**一鍵全簽**：只要是 admin，
不管畫面上按的是哪一關，迴圈都會把所有未簽的關卡一起簽掉。
在審閱頁那是刻意的（那顆按鈕就叫「核准並鎖定」），但在簽核管理頁按
某一關的「核准」卻把四關全簽了，畫面上完全看不出來發生什麼事。

改法：`stageIds` 有給時**不套用**一鍵全簽，而且若指定的關卡一關都簽不了
就回 `{ok:false}` 而不是靜默成功。審閱頁不傳 `stageIds`，行為原封不動。

## 結束摘要

新增 `signoff.html` + `src/pages/signoff.ts` + `src/lib/signoff.ts`，
`CaseStage` 補四個決策欄位，`approveAndLock` 支援逐關簽核與簽核意見。

實機驗證（真 Chrome）：對「工程」按核准 → 填意見 → 確認，
關卡轉 `approved`、`decidedByName`／`decidedAt`／`comment` 都寫進去、
紀錄長出「核准「工程」」那一筆、頭條從「3 關等你簽」變成「2 關」，
**其餘三關沒有被順手簽掉**。

未驗：稽核事件那一路（`signoffTimeline` 的 `audit` 參數）——
它只在桌面版＋已綁資料夾的專案才有資料，瀏覽器讀不到。
純函式那一段有 3 個單元測試涵蓋去重規則。
