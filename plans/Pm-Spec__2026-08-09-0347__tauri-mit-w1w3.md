# Tauri × MIT — W1〜W3 實作

**建立時間：** 2026-08-09 03:47
**最後更新：** 2026-08-09 03:55
**狀態：** 進行中

## 目標

依 `SCOPE.md` 完成 W1（Tauri 遷移）、W2（功能補完）、W3（開源化）。
核心是把 1157 行 Swift 殼的 12 個 action 移到 Rust，而 47 個 lib 檔裡的 39 個不動。
前置已確認：Rust 1.95.0 · Tauri CLI 2.11.4 · Xcode CLT。

---

## Plan Steps

### W1 — Tauri 遷移

- [x] W1-1 凍結 bridge 契約 → `docs/BRIDGE.md`（12 action 的輸入／輸出／錯誤形狀） <!-- sf:t=8SDBME8W -->
- [ ] W1-2 Tauri 骨架：`src-tauri/`、`tauri.conf.json`、shell allowlist <!-- sf:t=PFD99YKD -->
- [ ] W1-3a 移植五個承載功能的 action：projectStats · trackingScan · appendFile · openspecStatus · ghStatus <!-- sf:t=H86YKX5P -->
- [ ] W1-3b 移植其餘：pickFolder · pickProjectFolder · readFile · writeFile · openPath · ping <!-- sf:t=7ZK3RH1R -->
- [ ] W1-4 新增 `src/lib/native.ts` 單一抽象層，改寫 8 個碰 bridge 的 TS 檔 <!-- sf:t=NQXPZ6C7 -->
- [ ] W1-5 契約測試：Rust 端與 `docs/BRIDGE.md` 一致 <!-- sf:t=MK44H1WP -->
- [ ] W1-6 三平台建置：macOS 本機驗證 + CI 設定 <!-- sf:t=VDYQG8F1 -->
- [ ] W1-✅ 出貨儀式：在非 mac 環境跑起來並截圖 <!-- sf:t=27Z4BYVF -->

### W2 — 功能補完

- [ ] W2-1 openspec CLI 探測：使用者指定路徑 → PATH → 常見安裝點 → npx → 一鍵複製安裝指令 <!-- sf:t=3R3YQSPC -->
- [ ] W2-2 焦點卡接上真的 `openspecPct`（目前硬寫 null） <!-- sf:t=PA9D1CTF -->
- [ ] W2-3 任務勾選／新增步驟寫回 plan 檔 <!-- sf:t=2KKYF1MW -->
- [ ] W2-4 **併發保護**：寫入前重讀，比對 mtime 與錨點集合，不一致就擋（硬性，綁定 W2-3） <!-- sf:t=T8DB1Q07 -->
- [ ] W2-5 agent 交接指令產生器（只產生不執行，git-doctor 模式） <!-- sf:t=KXAK92KX -->
- [ ] W2-6 刪 19 個 desktop guard 與 4 檔編譯期快照 <!-- sf:t=FT95KFZN -->
- [ ] W2-✅ 出貨儀式：錄一段勾選步驟並看到事件進 log <!-- sf:t=53W0DMKP -->

### W3 — 開源化

- [ ] W3-1 `LICENSE`（MIT）+ README 重寫 <!-- sf:t=7G7DH8SC -->
- [ ] W3-2 `docs/SECURITY.md`：shell allowlist · appendAllowed 謂詞 · 為什麼不執行寫入動作 <!-- sf:t=EWVTW65P -->
- [ ] W3-3 `CONTRIBUTING.md` + issue 範本 <!-- sf:t=Z0CN3PP3 -->
- [ ] W3-4 上游相容承諾寫進 README：不解析 spec.md，該段呼叫 CLI <!-- sf:t=AE310QY8 -->
- [ ] W3-5 GitHub Actions：三平台 build + test <!-- sf:t=BJC12Q71 -->
- [ ] W3-6 資料落點文件：`.specforge/log` 是什麼、為何預設 gitignore、怎麼脫敏匯出 <!-- sf:t=MM1J4FK8 -->
- [ ] W3-✅ 出貨儀式：repo 轉公開，README 有截圖 <!-- sf:t=EYCK55RF -->

### 明確不做

- ~~瀏覽器版~~ — D5
- ~~自建 openspec spec.md parser~~ — D10，失敗模式是 PATH 不是沒裝
- ~~Kanban／拖曳／優先級／指派~~ — Linear 的形狀
- ~~agent 派工執行~~ — 要讓原生端跑 JS 傳來的任意 prompt
- ~~內嵌 openspec sidecar~~ — 暫緩，先做探測
- ~~W4 簽章／notarization~~ — 本輪不做，W1〜W3 完成後另議

---

## 決策紀錄

- 03:47 — W1-4 改成先做一層 `native.ts` 抽象再改 8 個檔；理由：postMessage+event 換成 invoke() 是同一種變換做八次，抽出來只做一次，也讓契約有單一落點

## 阻塞 / 待決議

- 三平台建置只有 macOS 能在本機真的驗證；Windows／Linux 靠 CI，本輪不會有實機截圖

## 停損條件

| 工作線 | 出現這個就停 |
|---|---|
| W1 | 移植三個核心 action 後仍無法在 Windows 建置 → 退回 macOS-only，Tauri 只當單平台殼 |
| W2-3 | 併發保護做不到可靠偵測 → 改成唯讀，勾選回終端做 |
| W3 | 安全文件寫不出來（代表某個介面自己也說不清）→ 先改介面，不要先開源 |

## 結束摘要

（工作結束時補上）
