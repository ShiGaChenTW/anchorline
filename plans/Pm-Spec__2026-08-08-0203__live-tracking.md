# Live Tracking 導入（SPEC-live-tracking.md → Task Tracking）

**建立時間：** 2026-08-08 02:03
**最後更新：** 2026-08-08 15:26
**狀態：** 進行中（等瀏覽器實機驗證）

## 目標

把 `SPEC-live-tracking.md` 的「自動判定哪一份 plan 是 agent 此刻正在動的」落到本 repo，
接進側欄既有的 Task Tracking 頁與 `bun run track` CLI。先做段 2（mtime fallback），
段 1（訊號檔）讀取端做好、寫入端依 spec §10 建議暫緩。

## Plan Steps

- [x] Step 1 — `src/lib/tracking.ts`：snapshot 型別 + `trackingTarget()` 純函式（零 I/O）
- [x] Step 2 — `tests/tracking.test.ts`：spec §8 的 11 個案例（15 tests pass）
- [x] Step 3 — CLI `track-tui.ts` 接入：追蹤圓點 + 週期刷新 + 畫面去重 + `t` 跳轉
- [x] Step 4 — Swift `trackingScan` bridge action（桌面版的資料通道）
- [x] Step 5 — Web `tracking.ts` 接入：selection / tracking 分離、`•`、桌面走 bridge
- [x] Step 6 — `bun test` + `typecheck` + `build` + `swiftc -parse` 全綠
- [ ] Step 7 — 瀏覽器實機驗證（Interceptor 擴充未連線，**未完成**）
- [ ] Step 8 — 桌面版 `bun run app` 打包後驗證 bridge 往返

## 決策紀錄

- 02:03 — `trackingTarget()` 改成吃 snapshot 的純函式，不在函式內做 `stat()`。
  原 spec 簽章隱含同步 fs，過不了 WKWebView 的非同步 bridge；改 snapshot 後
  CLI 與 web 才真的共用同一份判定邏輯（spec §7 自己下的判別式）。
- 02:03 — 段 1 訊號檔的**寫入端**暫緩，但**讀取端做了**（CLI + Swift 各 10 行）。
  不做讀取端的話 snapshot 的 signal 欄位永遠是死的，測試也就測不到真東西。
- 15:10 — 段 1 的「路徑存在於檔案系統」改判為「路徑存在於 snapshot.files」。
  刻意偏離規格：追蹤一個沒被監看的檔沒有意義，消費端拿到路徑也沒有內容可畫。
- 15:15 — Web 端維持 `import.meta.glob` 當**降級路徑**，不刪。桌面版有 bridge 就走 bridge、
  掃使用者實際綁定的專案資料夾；沒有就退回內建靜態快照並在 footer 明說。
  兩條路的差別對使用者可見，不假裝瀏覽器也是 live。
- 15:20 — 不掛 fs watcher，只做 1 秒輪詢。mtime 重比較本來就得每秒做一次，
  watch() 只省下 ≤1s 延遲卻多一組 debounce 與清理路徑。畫面去重讓沒變化的輪詢零成本。

## 阻塞 / 待決議

- **Interceptor 擴充未連線**（daemon 有跑、Chrome 有開，但 `no extensions connected`），
  瀏覽器實機驗證做不了。Step 7 掛著。dev server 在 `http://localhost:5175/tracking.html`。
- 桌面版 bridge 往返未實測 —— 需要 `bun run app` 打包，且要有至少一個綁了資料夾、
  底下有 `plans/` 的專案才會走 live 路徑。

## 結束摘要

（Step 7/8 完成後補上）
