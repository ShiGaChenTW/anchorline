# 治理覆蓋率 — 未治理 task 的數量統計

**建立時間：** 2026-08-10 22:03
**最後更新：** 2026-08-10 22:45
**狀態：** 已完成

## 目標

在兩個地方顯示「開始治理之後，有多少事情繞過了治理鏈」：

- **專案儀表板**（`dashboard.ts`）：該專案自己的數字
- **專案總覽**（`overview.ts`）：跨專案總和，卡片可展開列出各專案

判定依據是事件的 `subject` 有沒有 `anc:t=` 前綴 —— 有錨點代表串得回 plan 步驟，
沒有就是繞過治理鏈直接發生的事（手動 commit、未來 Border Loom 的未治理 task）。

## 決策紀錄

- 22:03 — **基準線 = 第一筆帶錨點事件的時間**（Scott 選 a）。之前的事件完全不計。
  既有 repo 有幾百個沒有錨點的 commit，全算進去會顯示「未治理 487」——那個數字
  不可行動，只會讓人以後忽略這張卡片。沒有任何帶錨點事件時顯示「尚未開始治理」，
  不顯示 0：兩者意思差很多。
- 22:03 — **判定用 `anc:t=` 前綴，不用字元集比對。** 原本打算用 Crockford 字元集
  比對裸 id，但七位全數字的 commit hash 也符合那個 pattern —— 約 3.7% 的 commit
  會被錯算成已治理。前綴是精確的。
- 22:03 — **新增 `readLog` bridge action，不擴大 `EDITABLE_EXTS`。** App 讀不到自己
  的 `.anchorline/log/*.jsonl`（讀取白名單沒有 jsonl，`tracking.ts` 的
  `loadAuditLog` 因此是一個沒人呼叫的死 export）。把 jsonl 加進白名單會同時開放
  `writeFile` 與 `openPath`，讓 append-only 的檔變成可整檔覆寫 —— 那正是
  `append_allowed` 存在的理由。窄通道符合 BRIDGE.md 的原則。Scott 已核可。
- 22:03 — **Border Loom 端的開通訊號 = 專案有沒有 `.anchorline/` 目錄**，不偵測對方
  裝了沒。這不是新發明：Anchorline 自己的 Claude Code hook 已經是這樣判的
  （`hookInstallSnippet()` 的 `[ -d "$r/.anchorline" ] || exit 0`）。

## Plan Steps

- [x] Step 1 — `paths.rs`：`log_dir_of()` 謂詞（已註冊根目錄 ∧ `.anchorline/log`）
- [x] Step 2 — `commands.rs`：`read_log` action（唯讀、有分片與位元組上限）
- [x] Step 3 — `lib.rs` 註冊 + `ping` 的 capabilities 補上 `readLog`
- [x] Step 4 — `native.ts`：`readLog` 包裝
- [x] Step 5 — `governance.ts`：純函式 `governanceCoverage()` + 測試
- [x] Step 6 — `dashboard.ts`：單一專案的卡片
- [x] Step 7 — `overview.ts`：跨專案總和 + 可展開的各專案明細
- [x] Step 8 — `docs/BRIDGE.md` 補上第 13 個 action（契約文件，改行為就改文件）

- 22:20 — **修掉自己引進的 join key 不一致**：App 內動作寫的 subject 是
  `anc:t=XXXX`（帶前綴），而 2026-08-10 稍早改的 backfill 寫裸 id。兩種形狀等於
  兩條各自獨立的軌跡，而且不會有任何錯誤。已統一成帶前綴。

## 阻塞 / 待決議

無。（視覺由 Scott 在 Tauri 測試版確認，並在 `3d16b93` 接手修掉卡高問題；
「只裝一套」的行為表已於 2026-08-10 確認。）

## 結束摘要

**做完的**：新增第 13 個 bridge action `readLog`（唯讀、只認已註冊根目錄下的
`.anchorline/log/`、有分片與位元組上限）、純函式 `governanceCoverage()`、
專案儀表板與跨專案總覽各一張卡片、`docs/BRIDGE.md` 契約同步。
前端 586 tests、Rust 15+14 tests、typecheck 全綠。

**只裝一套的行為（已確認）**：只有 Anchorline → 統計成立，但缺 family／run_id／
合併前可見度；只有 Border Loom → 專案沒有 `.anchorline/` 就一個位元組都不寫；
瀏覽器 → 顯示「桌面版才讀得到稽核軌跡」；有 Anchorline 但該專案沒開通 →
「尚未開始治理」，不列入總數。

**沒做完的**：這只是 L1 的**讀取端**。寫入端（Border Loom 發事件）還沒開始，
所以真實專案上這張卡目前會顯示「尚未開始治理」—— 那是誠實的，不是 bug。
下一步是 L2 派工鏈（20h）→ L1 事件寫入（52h）。

**過程中修掉的自造 bug**：backfill 寫的 subject 是裸 id，App 內動作寫的是
`anc:t=` 帶前綴。兩種形狀在軌跡上是兩條互不相干的線，而且不會報錯。

**驗證缺口**：瀏覽器（localhost:5173）打不開總覽頁的主內容區 —— 側欄正常、
零 JS 錯誤、`.main` 全空。把改動 stash 掉重現同樣結果，是既有問題。
記在這裡是因為它讓「用瀏覽器驗版面」這條路目前不可用。
