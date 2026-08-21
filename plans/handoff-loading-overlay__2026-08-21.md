# Handoff — 載入中畫面全面盤點（進行中）

**交棒人：** task/openspec worktree session（PM 角色）· 2026-08-21
**接棒人：** 新 session，繼續當 PM，派工給 Engineer 實作，不要自己動手寫 code
**上一份：** `plans/handoff-openspec-workspace-split__2026-08-21.md`（方案 B 開工那份，這份是它之後的兩件事）

---

## 這個 session 做完的事（已 merge/push/裝機，不用再碰）

**方案 B — OpenSpec 工作區獨立頁面**已完工：

- 分支 `feat/openspec-workspace`（commit `381e305`）已 fast-forward merge 進 `main`，
  已 `git push origin main`（`54af3a1..381e305`），origin/main 同步。
- 已跑 `bun run app:install`，`/Applications/Anchorline.app` 交易式換裝完成，
  sha256 雙邊比對一致（`38e1059123b7...`），App 已啟動確認能開。
- 過程：兩次派給 Engineer 的子任務都被 harness 的 worktree 隔離機制釘錯目錄
  （agent type "Engineer" 似乎一律自動開一個新的空 worktree，不管 prompt 裡怎麼指定
  既有目錄）——這是這次觀察到的 harness 行為，不是這次任務特有的問題，下一輪
  還是會遇到，見下方「已知：Engineer 派工的 worktree 坑」。
- 七輪 `codex review --uncommitted` 收斂：修掉四個 P1（切換 change 繞過未存檔確認、
  URL 帶入路徑只做前綴比對可跨專案讀寫、沒綁資料夾時仍放行還原上次檔案、
  只追蹤 rootPath 漏掉 activeProjectId 變動）與三個 P2（檔案樹重繪簽章只看數量、
  綁定資料夾後局部重繪不完整、refreshSideData／restoreOpenFile 非同步競態）。
- **這個新頁面完全零人測過**——Scott 開了一次就看到下面這個新 bug，代表功能面
  可能還有其他沒踩到的角落，找機會請他跑一輪 UAT。

---

## 這個 session 進行中、還沒收尾的事——載入中畫面全面盤點

### 起因

Scott 開 OpenSpec 工作區時截圖回報：頁面殼（側欄、欄位標題）都畫出來了，
但標題卡在「載入中…」、內容欄是空的，畫面很醜。他要求：**所有「載入中」相關的
畫面都要改成「當下畫面上蓋一層透明黑底＋正中央置中"載入中"文字」的樣式**，
不要出現「裸露的骨架＋一句載入中文字」這種畫面。

### 已經查過的東西（不用重查）

1. **App 裡本來就有一個現成元件完全符合這個樣式**：`src/lib/loading-overlay.ts`
   的 `showLoading()`/`hideLoading()` —— `position:fixed;inset:0` 的半透明黑底
   （`.load-back`，`rgba(0,0,0,0.55)` + blur）＋正中央一個帶文字與進度條的小視窗
   （`.load-box`/`.load-text`）。CSS 在 `shared.css` 約 13355 行。**目前只有
   `overview.ts` 在用**（給 git/PR/治理覆蓋率那種非同步刷新用），其餘頁面的
   「進場但資料還沒好」那段完全沒用到它——這才是 bug 的根源，不是遮罩不存在，
   是沒被套用在「頁面剛進場」這個時機點上。
2. **openspec-workspace.ts 的 render() 之前那段 bootstrap 邏輯已經逐行查過**：
   `initTheme`／`initMobileNav`／`bindLogout`／`initHelpOverlay`／
   `initFileTreeCollapse`／`initFileTreeResize`／兩個 `initCollapsible`／
   `applyEntryIntent` 全部有 null-guard，沒抓到會丟例外的地方。**沒辦法在瀏覽器
   dev server 完整重現**——這頁重度依賴 Tauri 原生 IPC（讀檔、`openspec` CLI），
   純瀏覽器連 session 都沒有會被導去 onboarding。所以 Scott 那次到底是「真的卡住」
   還是「單純載入視窗比較長剛好被看到很醜」沒有確定答案，**但不影響修法**：
   不管是哪一種，正確做法都是「載入視窗內一律蓋住裸露畫面，而且不管成功/失敗/
   卡住都保證會拿掉」。
3. **待驗證跟排除範圍已經定案**：`review.html` 有三處「載入中」——`page-title`
   （頁級，要改）、`doc-title`（死markup，render() 一律把它 `hidden=true`，
   不會真的被看到，但改了比較乾淨）、`approvals-summary`（跟 page-title 同一個
   同步 render 週期設的值，不是獨立非同步，要改）。**`settings.html` 的
   `uf-state`（UAT 格式面板）刻意排除不改**——那是頁面裡一張卡片的局部狀態提示，
   不是整頁還沒好，套整頁黑幕是過度設計，這頁本身的 `page-title` 本來就是正常
   文字（不是「載入中…」），代表 settings.html 根本沒有這個 bug。

### 已經派工、進行中的狀態

派了一個 Engineer 子任務（詳細 brief 見上一輪對話，或直接看下面的檔案清單自己
推敲意圖），worktree 落在
`~/Documents/20_Projects/Project_Anchorline/.claude/worktrees/agent-add8599029c714f67`
（branch `worktree-agent-add8599029c714f67`，base 是 main 的 `381e305`）。
**這個 agent 已經從 ListAgents 掉出去了，接不回去**——新 session 只能重新評估
要不要接著改這個 worktree（它是普通 git worktree，內容還在，沒被清掉），
或是重新派一個新的 Engineer。

**進度（tsc 乾淨，但沒做完）：**

```
git status --short（在 agent-add8599029c714f67 這個 worktree 裡）:
 M dashboard.html / editor.html / history.html / index.html / openspec-workspace.html
 M overview.html / projects.html / releases.html / review.html / shared.css
 M signoff.html / src/lib/loading-overlay.ts / src/pages/dashboard.ts
 M src/pages/signoff.ts / tracking.html / uat.html / write.html
?? tests/boot-overlay.test.ts
```

範圍比原本設想的大：它把「進場遮罩」的靜態 markup 灌進了**全部 15 個 HTML 頁**
（不是只有本來就有「載入中」文字的那 7-8 個），因為進場的 auth／store 初始化
視窗是所有頁共通的，邏輯上一致。這個決定看起來合理，不用質疑，除非新 session
覺得範圍不對。

`bunx tsc --noEmit` 乾淨。`bun test` 目前 **1431 pass / 26 fail**——它自己寫了一份
`tests/boot-overlay.test.ts` 當驗收清單，失敗的 26 個測試名稱就是**剩下要做的事**，
非常精確，直接照著做：

**JS 端還沒接管遮罩（缺「收掉的路徑」／「失敗時的可見錯誤畫面」／「接管遮罩」／
「收掉走 finally」四件事）：**
- `editor.ts`
- `openspec-workspace.ts`
- `overview.ts`
- `review.ts`
- `write.ts`

（`dashboard.ts` 跟 `signoff.ts` 已經接好，這兩個沒有測試失敗。）

**HTML 端還沒拿掉舊的「載入中…」寫死文字：**
- `dashboard.html` 的頁首
- `editor.html` 的頁首
- `openspec-workspace.html` 的頁首
- `overview.html` 的頁首
- `review.html` 的頁首 **和**簽核進度摘要（兩個都要拿掉）
- `signoff.html` 的頁首
- `write.html` 的頁首

**接手做法建議**：直接把這個 worktree（`agent-add8599029c714f67`）當成工作分支繼續
派 Engineer 做完剩下這 26 項（給它 `bun test` 的失敗清單當任務清單），不用重新
從頭設計。完工後照上一輪的模式：`bunx tsc --noEmit` + `bun test` 全綠 →
`codex review --uncommitted`（直接跑 CLI，不要走 Cato 的 Agent 工具 wrapper，
`maxTurns:5` 會在審查中途被切斷，這輪已經驗證好幾次）→ 因為是視覺變動，
最後要開 dev server 用 claude-in-chrome 實際看畫面確認遮罩會消失、沒有卡住。

**我自己另外開了一個乾淨的目標分支**：
`~/Documents/20_Projects/Project_Anchorline/.worktrees/fix/loading-overlay`
（branch `fix/loading-overlay`，base 是 main 的 `381e305`，目前是空的、乾淨的）。
做完之後應該是把 `agent-add8599029c714f67` 那個 worktree 的最終 commit
fast-forward 進這個分支，再合回 main——跟這次方案 B 用的手法一樣。

---

## ⚠️ main 已經被另一個 session 往前推了一個 commit，loading-overlay 的 base 過期了

寫這份 handoff 的過程中，peer session `project-anchorline-65`（Scott 自己另開的
視窗，或他起的另一個 agent，不是我這個 session 動的）把它那批修改 commit 完了：

```
116d0c9 rename workbench labels, drop 專案檔案 sidebar
381e305 feat(openspec): 拆出獨立的 OpenSpec 工作區頁面（方案 B）  ← 我這次 merge 的那個
```

`116d0c9` 內容：「編輯工作台」改名「工作台-PRD」、「OpenSpec 工作區」改名
「工作台-OpenSpec」（動到 nav／status bar／context menu／help overlay／
prompt registry／每一頁的 pre-hydration nav markup），**並且把 `專案檔案` 那個
檔案樹側欄整塊從 `editor.html` 跟 `openspec-workspace.html` 拿掉**（含相關的
resize/collapse/render 死碼一併清掉），還修了 `project-folder.ts` 裡一個指向
被拿掉入口的過期 toast。**這是本地 commit，還沒 push**（main 目前領先
origin/main 1 個 commit）。

**這對 loading-overlay 工作的直接影響**：

- 我這次派工／自己接手的 loading-overlay 兩個 worktree
  （`fix/loading-overlay` 分支、`agent-add8599029c714f67` 那個 agent worktree）
  base 都是 `381e305`，**不包含** `116d0c9`。它們動的檔案跟 `116d0c9` 有重疊
  （至少 `editor.html`／`openspec-workspace.html`／`editor.ts`／
  `openspec-workspace.ts`），合併時大概率會衝突，尤其 `116d0c9` 拿掉了整個
  檔案樹側欄，如果 loading-overlay 那邊的 overlay markup 剛好插在那個區塊
  附近，衝突機率更高。
- **接手前務必先 `git rebase main` 或重新對照 `116d0c9` 的 diff**，確認
  loading-overlay 那批改動有沒有跟被刪掉的東西衝突，不要盲目合併。
- 也要留意：`116d0c9` 改了 nav／label 相關的字串（「編輯工作台」→「工作台-PRD」
  等），如果 loading-overlay 那邊的頁面標題邏輯（`syncProjectChrome` 之類）
  有寫死舊名稱，合併後可能要一併更新，不然畫面會出現新舊命名混雜。

**跟主 repo 工作目錄互動的原則不變**：我這次 loading-overlay 的工作全程在獨立
worktree 進行，沒有碰過主 repo 工作目錄，這批 `116d0c9` 也不是我造成的——只是
它現在是 main 的新事實，接手者要基於它去 rebase，不要無視它直接照舊分支合併。

---

## Anchorline 其他未收的線（沿用上一份，這輪沒動）

| # | 項目 | 狀態 |
|---|---|---|
| 1 | `.mcp.json`（某個 worktree 裡，未追蹤）疑似真的 `BORDER_LOOM_MCP_TOKEN` | 沒 rotate，沒動 |
| 2 | 孤兒內容功能 5.2／5.3（真實瀏覽器流程） | 需要 Scott 實機 UAT |
| 3 | 08-16 對話框遷移那批 UAT 題目 | 還沒出，是最大的舊帳 |
| 4 | 一次性範本造成的孤兒查不到原標題 | 已知限制，記在 `openspec/changes/orphan-content-recovery/tasks.md` |
| 5 | OpenSpec 工作區（方案 B）新頁面 | 剛裝機，零人測，Scott 一開就抓到這次的載入中 bug，可能還有其他角落沒踩到 |

---

## 給接棒者的提醒

1. 先確認 main repo 那個 peer session 在做什麼，別誤觸。
2. loading-overlay 那 26 項失敗測試是最精確的任務清單，直接照做，不用重新設計。
3. 這是視覺變動，做完務必用 claude-in-chrome 實際看一次畫面，不要只信 tsc/test 綠燈。
4. Engineer 派工目前必踩坑：不管 prompt 裡怎麼指定既有 worktree 目錄，harness
   一律自動開一個新的空 worktree 給它。工作法是「隨它去，做完後我自己把它的
   commit fast-forward 進目標分支」，不要浪費時間硬要它進指定目錄（試過兩次都失敗）。
