# OpenSpec 的 tasks.md 進不了 Task Tracking — 規劃

**狀態：** 完成（方案 B）
**開始：** 2026-08-11

## 現象

Task Tracking 左欄只看得到 `plans/*.md`。被追蹤專案的
`openspec/changes/<id>/tasks.md` 完全不出現。

## 兩個獨立的原因（不是同一件事）

**原因 A — 根本沒被掃到。**
`tracking_scan`（`src-tauri/src/commands.rs:356-412`）對每個目錄做
**非遞迴** `read_dir`，而目錄清單來自
`plansDirsOf()`（`src/lib/tracking-bridge.ts:46-55`），它只回
`[<rootPath>/plans]`。`openspec/changes/<id>/tasks.md` 深兩層，不在名單上。

**原因 B — 就算掃到也會顯示 0 步驟。**
`parsePlanMeta`（`src/lib/plan-parser.ts:212`）只在
`## Plan Steps` 這個標題底下算 checkbox。OpenSpec 的 tasks.md 長這樣：

```markdown
## 1. Line separation and formal documentation

- [x] 1.1 Verify `parallel-code` is independently reachable…
- [ ] 3.5 Remove Electron from the active build only after the matrix is green
```

沒有 `## Plan Steps`、沒有 `# ` H1、沒有 `**狀態：**` 標籤、沒有
`<!-- anc:t=… -->` 錨點。逐項對照：

| 項目 | OpenSpec tasks.md | plan-parser 要的 | 後果 |
|------|-------------------|------------------|------|
| 步驟標題 | `## 1. <群組名>`，有很多個 | 單一 `## Plan Steps` | `total_steps = 0` → 落進「沒有步驟的檔案」 |
| checkbox | `- [x]` / `- [ ]` | 同 | ✅ 相容 |
| 步驟身分 | 文字裡的 `1.1`／`2.3` | 不透明錨點 `anc:t=` | 沒錨點就沒有勾選鈕、沒有交接鈕 |
| 略過 | 無此慣例 | `- ~~文字~~` | 「已結束」桶永遠到不了 |
| 標題／狀態／日期 | 無（狀態在 `.openspec.yaml` 與 CLI JSON） | `# ` + 三個粗體標籤 | 標題「(無標題)」、狀態「未知」 |

## 卡住規劃的那條既有決策

`docs/SCOPE.md` 的 **D10：「openspec CLI 為唯一真相來源，取消自建 parser」**，
`openspec-status.ts:1-10` 的檔頭也重申「不碰 `openspec/` 底下任何檔案內容」。

所以「寫一個 tasks.md parser 餵進現有的追蹤畫面」這個最直覺的解法，
**直接違反自己寫下來的決策**。這不是實作難度問題，是要不要改決策的問題。

而 CLI 給得出來的東西是**變更層級**，不是步驟層級：
- `openspec list --json` → 每個 change 的 `completedTasks` / `totalTasks`
  （`src/lib/openspec-status.ts:59` 已經在解析了，只是沒人用）
- `openspec status --change <id> --json` → artifact 狀態
  （proposal / design / tasks / spec 各自 done|ready|blocked|skipped）

**CLI 拿不到單一步驟的文字**。所以能不能在 Task Tracking 中間欄逐條列出
「1.1 Verify…」，完全取決於要不要放棄 D10。

## 三個方案

### 方案 A — 只用 CLI，變更層級（不違反 D10）

左欄多一個「OpenSpec 變更」分組，每個 change 一列，顯示
`completedTasks/totalTasks` 與進度條；點進去中間欄顯示 artifact 狀態燈
（proposal ✓ / design ✓ / tasks ◐ / spec ○）與「下一步：寫 design.md」。

- 做得到：進度百分比、還剩幾項、下一個該寫哪份 artifact
- 做不到：逐條步驟文字、勾選、交接錨點
- 改動：`tracking-bridge.ts` 加一條 openspec 資料流、`tracking.ts` 加一個分組與一個中間欄視圖
- 估：**0.5–1 天**。既有的 `parseOpenspecList` / `parseOpenspecStatus` /
  `requestOpenspecStatus` 全部可直接用，Rust 端不用動。

### 方案 B — 讀 tasks.md，步驟層級（要改 D10）

`tracking_scan` 的目錄清單加上 `openspec/changes/*/`（Rust 端要改成能吃
glob 或多層目錄），並在 `plan-parser.ts` 加一個 OpenSpec 方言：
`## <數字>. <群組>` 也算步驟區、`1.1` 前綴當作步驟 id 的來源。

- 做得到：跟 `plans/*.md` 一模一樣的體驗，逐條列出、可勾選
- 代價：多一個要跟著 OpenSpec 上游格式跑的 parser —— 正是 D10 要避免的東西。
  而且勾選要寫回 tasks.md，等於 Anchorline 開始改 openspec 管的檔案
- 改動：`commands.rs`（遞迴或多目錄）、`plan-parser.ts`（方言）、
  `plan-writer.ts`（寫回）、`docs/SCOPE.md`（撤銷或修訂 D10）
- 估：**2–3 天**，且長期維護成本不是一次性的

### 方案 C — A 先做，B 當作後續選項

先出方案 A（不違反任何決策、既有程式碼幾乎都能重用），實際用一週看
「只有變更層級」夠不夠。不夠再談要不要為了步驟層級付 D10 的代價。

## 我的建議

**方案 C。** 理由是這件事的痛點目前是「完全看不到」，而不是「看得到但不能勾」。
方案 A 就把「完全看不到」解掉了，成本是方案 B 的三分之一，而且不用先撤銷
一條寫在 SCOPE.md 裡的決策。等真的用過再決定要不要走 B，那時候的判斷會
比現在準。

## 決策（2026-08-11，Scott）

**走 B —— 步驟層級。** 連帶：D10 不撤銷，**收窄**成 D10a（寫進 `docs/SCOPE.md`）：
`spec.md` 與變更狀態仍只走 CLI，`changes/<id>/tasks.md` 的 checkbox 開例外。
勾選寫回 tasks.md：**是**，但只翻那一個方框字元。

## 實作（已完成）

| 層 | 改了什麼 |
|----|----------|
| Rust `commands.rs` | `tracking_scan` 收第二個參數 `openspec_roots`；新增 `scan_openspec()` 掃 `<root>/openspec/changes/*/tasks.md`，跳過 `archive/` 與 `.` 開頭；`PlanStat` 加 `kind` 與 `change` |
| `tracking-bridge.ts` | `ScannedPlan` 加 `kind`/`change`；新增 `openspecRootsOf()`（與 `plansDirsOf` 同規矩：只看當前專案，沒有就空陣列） |
| `native.ts` | `trackingScan(plansDirs, openspecRoots)` |
| `plan-parser.ts` | 新增 `PlanDialect` 與 `parseOpenspecTasks()`：沒有 `## Plan Steps` 閘門、`N.M` 編號當身分、`## N. <群組>` 當分組、狀態由勾選推算 |
| `plan-writer.ts` | `toggleStep(text, id, done, dialect)`；openspec 依 `N.M` 定位而非錨點 |
| `tracking.ts` | 傳方言給 parser、清單標 `OpenSpec` 徽章、步驟依群組分段並顯示編號、openspec 不給交接鍵、事件 subject 用 `openspec:<change>/<N.M>` 而不是偽造成錨點 |
| `docs/SCOPE.md` | D10a |
| 測試 | `tests/openspec-tasks.test.ts` 16 項（含「舊 parser 回 0 步驟」的回歸鎖）＋ Rust contract 3 項（archive 跳過、缺目錄不算錯、kind 標註） |

## 刻意沒做

- **不往 tasks.md 寫錨點。** 那是上游工具管的檔案，塞 `<!-- anc:t= -->` 等於改別人的格式。
  代價是 openspec 步驟接不上事件流的錨點聚合，所以交接鍵對它們不出現。
- **不碰 `spec.md`、不自建變更狀態 parser。** D10 的那一半原封不動。
- **`archive/` 不進清單。** 封存的變更是歷史不是待辦，混進去會把清單淹掉。

## 已知的脆弱點

`tasks.md` 的分組標題若從 `## N. <名稱>` 改成別的形狀，步驟數會少算，
而**症狀是安靜的**（清單變短，不報錯）。`tests/openspec-tasks.test.ts`
用真實檔案形狀鎖住這個假設。
