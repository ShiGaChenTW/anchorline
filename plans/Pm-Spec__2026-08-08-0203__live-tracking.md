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

## 合併紀錄

- 2026-08-08 — `feasibility-eval-live-tracking`（be617b8）以 `--no-ff` 併入 main（`76f7dd7`），
  已 push。與主線**無檔案重疊**（merge-base 是 4e0f4d3，主線之後只動了 editor/dashboard/
  projects/store 那一串），所以是乾淨合併，沒有手動解衝突。

合併後在 main 上重跑的驗證：

| 項目 | 結果 |
|---|---|
| `bun test tests/tracking.test.ts` | 15 pass / 0 fail |
| `bunx tsc --noEmit` | 通過 |
| `bun run build` | 通過 |
| `swiftc -parse mac-app-build/main.swift` | 通過 |
| `bun run track:once` | 追蹤圓點標在 live-tracking 這份計畫上（`進行中 75% 6/8 •`），正確 |
| 正式版安裝 | 已重裝，二進位含 `trackingScan` |

⚠️ `bun test`（全量）有 9 fail，全部來自 `vendor/markamd/`（缺 react / @tauri-apps
等未安裝的相依）。**在合併前的 61140eb 上跑也是同樣的 9 fail**，與這次合併無關。

## 阻塞（合併後仍未解）

兩項都還開著，我沒有把它們當作已驗證：

- **瀏覽器實機**：Chrome 擴充在我這端也是 `Browser extension is not connected`，
  一樣做不了。降級路徑（`import.meta.glob` 靜態快照 + footer 明說）只有程式碼層面看過。
- **桌面版 bridge 往返**：App 已重裝且二進位含 `trackingScan`，但視窗一直被其他
  應用蓋住、`System Events` 的 frontmost 拉不上來，沒能實際看到畫面上的圓點。
  需要人工開一次 App、進 Task Tracking 頁確認。

## 結束摘要

（Step 7/8 完成後補上）
