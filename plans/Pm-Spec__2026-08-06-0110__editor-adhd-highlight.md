# 編輯台 ADHD 外框 + 文件內容高亮

**建立時間：** 2026-08-06 01:10
**最後更新：** 2026-08-06 01:25
**狀態：** 已完成

## 目標

1. 紅框標題不再硬編碼「SaaS 雙重驗證（2FA）」，改為目前 active 專案（如 Borderloom）。
2. 編輯台 chrome（工具列、大綱、教練、章節導引）依 ADHD 友善原則重設；**文件編輯器（MarkaMD 雙欄）維持現狀**。
3. 規劃「文件內容高亮」設計，供後續實作。

## Plan Steps

- [x] Step 1 — 修正 titlebar / h1 / sub 綁定 active project
- [x] Step 2 — 審閱頁同步專案名稱（避免同一錯誤）
- [x] Step 3 — 編輯台 ADHD chrome（大綱簡化、教練漸進揭露、指南可摺）
- [x] Step 4 — 規劃文件內容高亮設計（本檔 § 高亮設計）+ CSS token 預埋
- [x] Step 5 — 結束摘要

## 決策紀錄

- 01:10 — 紅框 SaaS 根因：`editor.html` 靜態字串 + `editor.ts` 寫死 `identity / prd-2fa`；focus strip 已正確讀 store，故出現「正在寫 Borderloom」與標題 SaaS 並存。
- 01:10 — 文件編輯器（`mdFieldHtml` / MarkaMD）不動；只動 chrome 與外層導引。
- 01:10 — 內容高亮本階段以設計規劃為主，不一次做完整 annotation 系統。
- 01:20 — 高亮 CSS class（`.hl-focus` 等）先預埋；preview 關鍵字掃描留待下一段。

## 文件內容高亮設計（規劃）

### 問題

長篇 PRD 在 ADHD 使用者眼中是「一整片灰字」。需要：

- **當前焦點**一眼可辨
- **風險／待決／已完成**語意色塊不靠細讀
- 不破壞 Markdown 編輯流（選取、游標、undo）

### 範圍分層

| 層 | 位置 | 用途 | 優先 |
|----|------|------|------|
| A. 預覽高亮 | MarkaMD 右欄 preview | 語意著色、章節錨點、搜尋命中 | P0 |
| B. 編輯輔助 | 左欄 textarea 外層 | 行號旁 gutter 標記、不改 textarea 內文 | P1 |
| C. 批註高亮 | 審閱頁 doc pane | 留言錨點、`==mark==`、開放問題 | P0 審閱 |
| D. 寫作時即時 | 可選 overlay | 與 B 重疊，延後 | P2 |

**原則：預覽可富渲染；編輯欄保持純文字，避免 contenteditable 複雜度。**

### 語意類型（token）

| Token | 觸發 | 預覽樣式 | 語意 |
|-------|------|----------|------|
| `hl-focus` | 目前游標對應段落 / 大綱 active | 左側 3px accent bar + 淡底 | 我在這裡 |
| `hl-todo` | 含「待決／TBD／TODO／？？」 | 暖黃底 `color-mix(warn 18%)` | 尚未決定 |
| `hl-risk` | 含「風險／阻擋／BLOCK／合規」 | 淡紅底 | 需注意 |
| `hl-done` | checklist 通過或 `- [x]` | 淡綠底 / 刪除線可選 | 已關閉 |
| `hl-quote` | blockquote / 使用者原話 | 左邊框 + 斜體維持 | 證據 |
| `hl-metric` | 表格列或「≥ / % / 天」指標句 | mono 微強調 | 可量測 |
| `hl-mark` | Markdown `==text==`（已有 mark plugin） | 螢光底（kami 暖、github 冷） | 人工標重要 |
| `hl-search` | ⌘F 命中 | 高對比描邊 | 搜尋 |

### ADHD 行為規則

1. **同時最多 2 種語意色**在可見 viewport（focus + 一種語意）；其餘用 icon／gutter 點，hover 才展開色塊。
2. **預設關閉彩虹模式**；設定頁開關「語意高亮」與「強度：淡／中」。
3. **不在編輯欄插入 span**（避免游標錯位）；高亮只在 preview 與 gutter。
4. **一鍵「只看待決」**：preview 淡化非 `hl-todo`／`hl-risk` 段落（opacity 0.35）。
5. **對比**：背景與文字 WCAG AA；kami／github 各一組 token。

### 技術路徑（建議實作順序）

1. **CSS token** in `shared.css`：`--hl-focus` … 綁 theme。
2. **Preview post-process**（`src/lib/markamd/markdown.ts` 或 render 後 DOM walk）：
   - 掃描 `p, li, td, blockquote`
   - 依關鍵字／regex 加 class（純 client，無後端）
3. **Focus sync**：textarea `selectionchange` → 對應 preview 段落 `hl-focus`（可沿用 markamd selection sync 思路，簡化版）。
4. **Gutter dots**（可選）：行號欄旁 4px 圓點對應 todo/risk。
5. **審閱頁**：既有 `.hl` 留言錨點對齊同一 token 命名；開放問題列表 → `hl-todo` 自動。
6. **設定**：`settings.highlightSemantic: boolean`、`highlightIntensity: 'soft' | 'medium'`。

### 不做（本階段）

- 多人即時 co-highlight
- AI 自動摘要色塊（可之後接 coach）
- 在 raw markdown 塞 HTML comment 錨點（可讀性差）

### 驗收（高亮落地時）

- [ ] Borderloom 專案標題與 focus strip 一致
- [ ] Preview 對「待決」句有暖色；關閉設定後無色
- [ ] 編輯欄選字／輸入無跳字
- [ ] kami / github 兩主題可讀

## 結束摘要

- **SaaS 紅框**：`syncProjectChrome()` 讀 `activeProject` + `projectDisplayName`，titlebar／h1／sub／status 動態更新；審閱頁同步。
- **ADHD chrome**：大綱只在 active 顯示說明；「本章怎麼寫」可摺；教練先「現在做這一件」其餘 details；MarkaMD 雙欄未改。
- **高亮**：本檔完整設計 + `shared.css` token／class 預埋；語意掃描尚未接 preview。
- **驗證**：`bun run build` 通過。若用 mac app，需重載／重建 bundle 才看得到。

### 後續（2026-08-06 01:25）— 預覽語意高亮已落地

- `src/lib/markamd/semantic-highlight.ts`：關鍵字分類 + focus 對齊
- `md-field.ts`：preview 刷新時套用；高亮／只看待決控件；gutter 圓點
- 設定：`semanticHighlight`、`highlightIntensity`（soft／medium）
- soft＝待決+風險+游標；medium＝再加指標／完成／引用
- textarea 仍為純文字，不插入 span
