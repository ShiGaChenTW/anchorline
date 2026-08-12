# AI 味治理（A+B+C+D）＋ 匯出去向明確化

**建立時間：** 2026-08-12 14:20
**最後更新：** 2026-08-12 14:35
**狀態：** 已完成

## 背景

1. HelmDeck 的 AI 生成 PRD 實測樣本顯示：問題**不是空話**（事實密度夠高），
   是**結構性 AI 味** —— 2,440 字不分段的 goals、單條 300 字的條列項、
   「——」與括號巢狀的長句、每欄一樣的高密度節奏。禁詞表只是配菜，
   主菜是句長、分段、條列形狀的紀律。
2. 桌面版沒有 `on_download`：WKWebView 裡 `<a download>` 無聲失敗。
   「匯出 MD」在正式版裡不告知檔名、位置，甚至可能根本沒存。
   儲存章節的 toast 也沒講內容存去哪（App 內部，非磁碟）。

## 決定

- 匯出在桌面版寫進 `<專案根>/.anchorline/exports/`（新 Rust command），
  toast 顯示完整路徑；瀏覽器版維持下載並 toast 檔名。
  同名覆寫**允許**（匯出可重生，跟快照不同）。
- AI 味 linter 掛在既有 `warnVagueTerms` 開關下（同屬文字品質，不再開新設定）。

## Plan Steps

- [x] Step 1 — `ai-tells.ts`：禁詞表＋結構檢查（長句／不分段／超長條列）純函式 <!-- anc:t=AITELL01 -->
- [x] Step 2 — `tests/ai-tells.test.ts` <!-- anc:t=AITELL02 -->
- [x] Step 3 — A：寫作紀律段落進 `generateAIDraft` 與 `buildDraftSystem` <!-- anc:t=AITELL03 -->
- [x] Step 4 — B：`critiqueSectionLocal` 接 ai-tells 警告 <!-- anc:t=AITELL04 -->
- [x] Step 5 — C：`DEFAULT_STYLE_SAMPLE`，styleSample 空時生效 <!-- anc:t=AITELL05 -->
- [x] Step 6 — D：潤色加「去 AI 味」模式＋編輯台按鈕 <!-- anc:t=AITELL06 -->
- [x] Step 7 — Rust `write_export` ＋ `native.ts`/BRIDGE.md/DATA.md <!-- anc:t=AITELL07 -->
- [x] Step 8 — 匯出走 native 路徑並 toast 路徑；儲存 toast 講清楚存去哪 <!-- anc:t=AITELL08 -->
- [x] Step 9 — tsc / bun test / cargo build 全綠＋瀏覽器實測 <!-- anc:t=AITELL09 -->

## 驗證紀錄

- `bunx tsc --noEmit` 綠 · `bun test` 962 pass / 0 fail（ai-tells 新增 9 條）· `cargo build --release` 綠
- 真瀏覽器：把 HelmDeck 形狀的樣本（不分段長句）餵進本機評估 →
  警告「有 1 句超過 80 字沒斷句」「626 字沒有分段」
- 「去 AI 味」按鈕在編輯台長出；匯出 toast 變成
  「已下載 SaaS 雙重驗證（2FA）-20260812-1424.md（在瀏覽器的下載資料夾）」；
  儲存 toast 講明存在 App 內部
- 未驗（要桌面版）：`write_export` 實際寫入 `.anchorline/exports/` 與路徑 toast
