<!-- 每一項寫成單行：Anchorline 的 Task Tracking 只取 checkbox 的第一行當步驟
     文字，換行的後半段在追蹤畫面上會消失。 -->

## 1. 偵測（純函式）

- [x] 1.1 建 `src/lib/orphan-content.ts`：`findOrphans(sections, values)` 回傳 `{ sectionId, fieldKey, text }[]`，空白值不算
- [x] 1.2 `tests/orphan-content.test.ts`：空白不算、id 在結構裡不算、同一節多個欄位各自成立
- [x] 1.3 `appendInto(current, incoming)`：既有內容非空時中間空一行，同檔補測試

## 2. store API

- [x] 2.1 `orphansOf(projectId)`：用 `sectionsFor(pid)` 與該專案的正文袋，不要用 active 那份（跨專案會算錯）
- [x] 2.2 `moveOrphan(pid, from, to)`：append 進 `prdDrafts`，從已儲存正文移除來源，回傳 `{ ok, reason }`
- [x] 2.3 `dropOrphan(pid, from)`：直接刪，回傳 `{ ok, reason }`
- [x] 2.4 兩支都要擋沒有編輯權限的身分（`canEditContent`）
- [x] 2.5 測試補進 `tests/remove-custom-section.test.ts` 建立的 store 測試骨架

## 3. 編輯台 UI

- [x] 3.1 章節列表下方的入口，只在有孤兒時渲染，文字要寫出段數
- [x] 3.2 展開面板：每段顯示原章節編號與標題、欄位名、完整內容（不截斷）—— 已知限制：只有「換領域包」造成的孤兒查得到原標題（`orphanLabelPool()` 查所有領域包），「套一次性範本」造成的孤兒沒有任何登記處可查，退回顯示原始 sectionId。要補齊需要在換骨架當下就把被取代的章節中繼資料存下來，這次不做，需要的話另開 change
- [x] 3.3 「搬到」下拉：章節 × 欄位，沒有預選值（不做自動配對）
- [x] 3.4 「刪除」按鈕加確認，訊息寫明不可復原
- [x] 3.5 動作完成後重畫清單與目標章節的未儲存標記

## 4. 樣式

- [x] 4.1 `shared.css` 加面板樣式，沿用章節列表的語彙
- [x] 4.2 深色／淺色／terminal 三個主題都看過（token 覆蓋率已查過，無寫死色值）

## 5. 驗證

- [x] 5.1 `bunx tsc --noEmit` 與 `bun test` 全綠（1359/1359，經三輪 codex 審查與修正後）
- [ ] 5.2 真實流程：套整份範本製造孤兒 → 搬回去 → 存檔 → 重新載入確認還在 —— 只做了程式碼路徑推演（moveOrphan 寫進 prdDrafts，saveSections 存檔才落地成正文），沒有瀏覽器實測，需要 UAT
- [ ] 5.3 刪除路徑走一遍，確認重新載入後真的不見了 —— 同上，需要 UAT
