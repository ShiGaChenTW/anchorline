# Handoff — 全站進場遮罩：完工、已裝機

**交棒人：** task/openspec worktree session（PM 角色）· 2026-08-21
**接棒人：** 下一個 session
**上一份：** `plans/handoff-loading-overlay__2026-08-21.md`（盤點進行中那份，這份是收尾）

---

## 一句話現況

全站進場遮罩已經做完、merge 進 `main`（commit `c1f6c5d`）、`bunx tsc --noEmit` 乾淨、
**1459 tests 全綠**、`codex review` 兩輪（Engineer 自己跑一次、我事後又獨立跑一次
`codex review --commit c1f6c5d` 覆核）都是乾淨結論、已 `bun run app:install` 裝進
`/Applications/Anchorline.app` 且 sha256 雙邊比對一致。**還沒 push**（沿用這個 repo
這幾輪一貫的做法——push 前留給 Scott 或下一個 session 決定）。

---

## 這一輪做了什麼

上一份 handoff 交接時，loading-overlay 的 WIP 卡在一個孤兒 worktree
（`agent-add8599029c714f67`，base 落後 main 一個 commit）。這一輪：

1. 把那份 WIP 存成 patch，dry-run 確認跟 main 當時的 tip（`80f9212`，含 `116d0c9`
   rename／拿掉檔案樹側欄）**完全無衝突**，套用後 `bun test` 結果跟 rebase 前一模一樣
   （1433 pass / 26 fail），證明沒有引入新問題。Commit 到 `fix/loading-overlay` 分支
   （`ea06d3e`）。
2. 派 Engineer 收尾剩下 26 項失敗測試（5 頁接管遮罩：editor／openspec-workspace／
   overview／review／write，7 處拿掉寫死的「載入中…」）。Engineer 完工於 `c1f6c5d`，
   `tests/boot-overlay.test.ts` 71/71、全套 1459 tests 全綠、tsc 乾淨、`codex review`
   乾淨。
3. 我自己又獨立跑一次 `codex review --commit c1f6c5d` 覆核（不只信 Engineer 自報），
   結論同樣乾淨。
4. Fast-forward `fix/loading-overlay` → `main`，`bun run app:install` 裝機驗證。
5. 清掉兩個已經吸收進 main、不再需要的孤兒 worktree
   （`agent-add8599029c714f67`、`agent-a8c52f47893ed4821`）。

## ⚠️ 實機驗證踩到的坑：這個 Chrome profile 有裝一個外掛在污染畫面

用 claude-in-chrome 開 `openspec-workspace.html`／`editor.html`／`review.html`／
`write.html` 一開始整頁主要內容區塊是**全黑一片看不到任何字**，一度以為是真的
regression（花了不少輪 JS 內省才查出來）。**根因跟這次的程式碼改動完全無關**：
這個自動化用的 Chrome profile 裝了一個瀏覽器擴充套件（console 有 `Mapify` 的
warning），它會在每個頁面的 `<head>` 注入一份自己的 `<style>`，裡面有一條
`.resize-handle { position: absolute }` —— 跟 Anchorline 自己 `.resize-handle`
這個 class 撞名，把 `position: relative` 蓋掉，導致 CSS Grid 的 auto-placement
把 `<main>` 擠進本來留給拖曳把手的 6px 那一欄，整個主內容區塊被壓成 6px 寬。

**驗證方式**：用 JS 把所有沒有 `href`（即注入的、非外部連結的）`<style>`
disable 掉，`<main>` 立刻彈回正確的 1986px，畫面完全正常。四個頁面都復現同一個
簽名（`main` 寬度卡在 6px，`.resize-handle--rail` 的 computed `position` 是
`absolute`），排除是我們自己程式碼的問題。

**下一個 session 用 claude-in-chrome 驗證這個 repo 的畫面時**，如果又看到某個區塊
莫名其妙全黑或版面擠爆，先懷疑這個擴充套件，不要照著它去改程式碼——排除法：
`for (const s of document.styleSheets) if (!s.href) s.disabled = true` 清乾淨
再看一次。這不是這個 repo 能修的東西（是使用者本機 Chrome profile 裝的擴充套件），
沒有需要開票的動作，純粹留給下一個人省時間用。

---

## Anchorline 其他未收的線（沿用上一份，這輪沒動）

| # | 項目 | 狀態 |
|---|---|---|
| 1 | `.mcp.json`（某個 worktree 裡，未追蹤）疑似真的 `BORDER_LOOM_MCP_TOKEN` | 沒 rotate，沒動 |
| 2 | 孤兒內容功能 5.2／5.3（真實瀏覽器流程） | 需要 Scott 實機 UAT |
| 3 | 08-16 對話框遷移那批 UAT 題目 | 還沒出，是最大的舊帳 |
| 4 | 一次性範本造成的孤兒查不到原標題 | 已知限制，記在 `openspec/changes/orphan-content-recovery/tasks.md` |
| 5 | OpenSpec 工作區（方案 B）新頁面 | 已裝機一段時間，仍缺 Scott 實機 UAT |
| 6 | main 還沒 push（領先 origin 若干個 commit） | 待 Scott 決定 |

---

## 給接棒者的提醒

1. `main` 目前是 `c1f6c5d`，工作區乾淨，`/Applications/Anchorline.app` 已同步。
2. loading-overlay 這條線可以算完工——`tests/boot-overlay.test.ts` 是它的驗收清單，
   全綠。剩下的只有「Scott 實機看一次」這個社交性質的收尾（不是自動化能補的）。
3. 用 claude-in-chrome 驗證這個專案時，先看上面那段 Mapify 擴充套件的坑，省得重查一次。
