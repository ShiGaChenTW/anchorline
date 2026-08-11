# PRD 範本庫 — 整份範本 × 章節範本 兩層結構

**建立時間：** 2026-08-11
**最後更新：** 2026-08-11
**狀態：** 進行中

## 目標

1. 範本插入的內容統一落在最後一章「XX 自訂章節」，不再散進當下開著的那一章。
2. 「章節範本」升格為「PRD 範本」，底下分兩種：**整份 PRD 範本** 與 **章節範本**。
3. 整份 PRD 範本以市場上通行的寫法為底，分五類收進來，每一份標明出處。

## 步驟

- [x] 1. `withCustomSection()` — 骨架解析後追加「XX 自訂章節」，編號取最後一章 +1
- [x] 2. 三個建 sections 的入口都包住（domainSections 兩條路徑、seedState、setShowSamples）
- [x] 3. gate 的「空白章節數」排除自訂章節（選填的自由區，空著是常態）
- [x] 4. editor 的 pendingInsert 改打自訂章節，插完跳過去
- [x] 5. 資料模型：`TemplateKind = "section" | "full"`，TemplateCat 擴充五個整份分類
- [x] 6. 十份整份 PRD 範本進 seed，每份帶 source / sourceUrl
- [x] 7. templates.html + templates.ts：kind 切換 + 分類隨 kind 換一組
- [x] 8. 全站導覽字樣「章節範本」→「PRD 範本」（12 處 HTML + rail-projects + rail-nav + status-bar）
- [x] 9. 測試：整份範本的 id 唯一、cat 屬於該 kind、body 有章節標題
- [x] 10. tsc + bun test（716 pass）+ Interceptor 實機驗證
- [x] 11. 匯出：自訂章節走 `## Appendix`，不掃進 Technical Specifications

## 第二輪：領域包管理（2026-08-11 追加）

- [x] 12. 第三個分頁「領域包」：列出內建／自訂／覆寫，顯示章節數、檢查數、在用專案數
- [x] 13. 編輯（內建包＝以此為底稿存成同名覆寫）、新增（以 `_template.md` 改名為底稿）、移除
- [x] 14. `lib/domain-pack-manage.ts`：驗證 → 落地 → 重載註冊表 → store 重算章節，四步一份
- [x] 15. `removeUserPack` / `userPackSource` / `builtinSource` / `renamePackSource`
- [x] 16. `validatePackStructure` 的 sourceHint 可傳入 —— 手動編輯不該看到「AI 產出：」
- [x] 17. 設定頁保留資料夾與 AI 產生，加一行指向新的管理入口

**移除的邊界（已知並顯示）：** Rust 端只有 `write_domain_pack`，沒有刪檔命令。
移除只動快取，磁碟上的 `.md` 還在 —— 開著自動重掃的話下次會回來。
`removeUserPack` 回傳 `stillOnDisk`，toast 會把這件事講出來。真的要刪檔要先在
Rust 加命令（含路徑驗證），那是另一輪。

## 整份 PRD 範本的分類

| 分類 | 收什麼 | 代表 |
|---|---|---|
| `lean` 精簡型 | 1–3 頁，現代新創主流 | Lean 1-pager、現代 PRD |
| `narrative` 敘事型 | 先寫結果再回推 | Amazon PR/FAQ、六頁敘事 |
| `enterprise` 完整型 | 法遵／稽核重度 | 傳統完整 PRD、金融版 |
| `agile` 敏捷型 | 綁週期與胃口 | Atlassian 藍圖、Shape Up Pitch |
| `technical` 技術型 | 給工程審閱 | Google Design Doc、OpenSpec 全套 |

## 出處（已查證，2026-08-11）

- Shape Up Pitch 五要素（Problem / Appetite / Solution / Rabbit holes / No-gos）—
  Basecamp《Shape Up》1.5 章
- Google Design Doc（Context / Goals / Non-goals / Alternatives considered）—
  industrialempathy.com「Design Docs at Google」
- Atlassian Product Requirements Blueprint（Project details 表頭 / Objective /
  Assumptions / Requirements 表 / User stories and design）— Confluence 官方文件
- Amazon Working Backwards PR/FAQ、Cagan 四段式、現代 1-pager — 產品社群通行寫法

## 決定

**整份範本沿用同一條插入路徑（pendingInsert → 自訂章節），不做「套用整份骨架
覆寫章節」。** 覆寫既有章節等於毀掉使用者已寫的內容，那是另一個要有確認流程與
還原路徑的功能；這一輪先讓範本看得到、拿得走、插得進去。

## 結束摘要

**狀態：已完成（2026-08-11）。**

實機驗證（Interceptor，test variant，:5199）：
- 導覽列顯示「PRD 範本 36」；頁面兩層分頁「整份 PRD 範本 10 / 章節範本 26」
- 章節範本插入 → toast「已插入到「08 自訂章節」」，編輯器自動跳到該章
- 連續插入兩份（章節 t1 + 整份 f8）→ 依序追加不覆蓋（offset 0 / 46）
- 編輯器定位列：`PRD.md › ## Appendix`

**編號是算的不是寫死的。** 通用領域 7 章 → 08 自訂章節；領域包多幾章就往後推。
`withCustomSection` 只在骨架解析完之後追加，共三個入口（domainSections 兩條、
seedState、setShowSamples）都包住了。

**沒做的：** 整份範本仍走「插進自訂章節」這條路，不會把章節骨架整份套進各章。
覆寫既有章節要有確認與還原路徑，是下一輪的事。
