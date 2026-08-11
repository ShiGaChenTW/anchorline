# 版號規則：vX.YY.ZZ 三層閘門 + 預先取號與正式放行

**建立時間：** 2026-08-12 01:55
**最後更新：** 2026-08-12 01:55
**狀態：** 已完成

## 目標

版本取號從「一種編列方式」變成兩條互斥的路線，兩條的**取號時機**不同：

| | 路線 A · 已完成 | 路線 B · 未實作 |
|---|---|---|
| 收什麼 | 這個專案已經 commit 的項目（可多選） | openspec 的 change |
| 約束 | 該 commit 尚未被其他版號用過 | — |
| 順序 | 選項目 → 選版號 → 加說明 → PUSH | 選 change → 確認 → **先取到版號** |
| PUSH | 當下就能出 | 要等實作完成 |

**兩條路暫時不能互用**：一個版號要嘛全是 commit、要嘛全是 change。

## 為什麼是兩條而不是一條

取號時機不同，所以「版號代表什麼」也不同：
路線 A 的版號是**已經發生的事實**的標籤，路線 B 的版號是**承諾**。
混在同一個版號裡，「這一版做完了沒有」就沒有答案 ——
一半是既成事實、一半是待辦，而 PUSH 只能有一個時機。
互斥不是限制，是讓那個問題有答案。

## 資料模型

- `Release.track: "shipped" | "planned"`。舊資料沒有這個欄位，一律當
  `"shipped"`（那是現行行為：候選來自章節與 commit）。
- `ReleaseItem.source` 新增 `"change"`，`ref` 存 change 名稱。
- commit 佔用是**跨版號**的：同一個 `ref` 只能被一個版號收。
  判定要排除自己那一版，否則編輯中的版號會說自己佔用了自己。

## 不做什麼

- **不從 change 或 commit 推導版號。** `release.ts` 開頭寫死「版號一律由
  使用者決定，系統絕不自動指定」，那是對外承諾，不為了方便破例。
- 不執行 git。PUSH 一樣是產生可貼的指令（沿用既有界線）。
- 不自動 archive openspec change。
- 不做兩條路互轉（使用者說暫時不能互用，那就先不做半套的轉換）。
- 不解析 `spec.md`（D10）：change 的名稱與完成度只讀 CLI 的 `--json`。

## Plan Steps

- [x] Step 1 — `src/lib/release-track.ts`：track 型別、commit 佔用判定、混用防護、PUSH 閘門 <!-- anc:t=DRTM66CW -->
- [x] Step 2 — `tests/release-track.test.ts`：佔用去重、排除自己、混用擋下、閘門三態 <!-- anc:t=058W9SNK -->
- [x] Step 3 — `types.ts` 與 `release.ts`：`track` 欄位與 `"change"` 來源，舊資料當 shipped <!-- anc:t=896STYJ8 -->
- [x] Step 4 — store：建立版號時指定 track；加項目時擋跨 track <!-- anc:t=FNXJRB67 -->
- [x] Step 5 — `releases.ts`：新建流程先問走哪一條，候選來源依 track 切換 <!-- anc:t=XKN5C019 -->
- [x] Step 6 — 路線 B 的 PUSH 閘門與說明（未完成的 change 要列出來） <!-- anc:t=1GB6NW44 -->
- [x] Step 7 — `buildHandoff()` 對 change 項目印出 `openspec/changes/<id>/` <!-- anc:t=GQMKCEN6 -->
- [x] Step 8 — `bunx tsc --noEmit` 與 `bun test` 全綠 + 實機驗證兩條路 <!-- anc:t=8FJAPK53 -->

## 驗證紀錄

- 指令：`bunx tsc --noEmit`（綠）· `bun test` 885 pass / 0 fail（新增 20）
- 兩條路情境實測：
  A 重收同一筆 commit → 擋下並指名「已被版號 v1.0.0 收走」
  A 收 change → 擋下（兩條路不能互用）；A 有版號有內容 → 可 PUSH
  B 收 commit → 擋下；B 一個 change 未完成 → 擋下並列出 `orphan-content-recovery`
  B 全部完成 → 放行，產出 tag + push 兩行指令
  交辦單對 change 印出 `openspec/changes/<id>/`
- 過程抓到一個會出錯的：渲染與點擊各自組候選清單，索引對不上會「點 A 加到 B」，
  已抽成單一 `visibleCandidates()`
- 未驗：UI 完整流程需要綁定資料夾且有 openspec 的專案，測試 profile 沒有
