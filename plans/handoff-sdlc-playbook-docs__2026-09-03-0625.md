# Handoff — AI-Native SDLC 導讀文件線

- **建立時間**：2026-09-03 06:25 CST
- **這條線在做什麼**：把 Anthropic《The AI-Native SDLC Playbook》做成繁中互動式學習頁，並把其中「對照 Anchorline」那節單獨拉成一張流程圖。
- **給新 session 的一句話**：**這條線已經做完了，沒有進行中的工作。** 剩下的只有「要不要 commit」與「05 節的判讀要不要逐列查證」兩個決定，兩個都要 Scott 拍板。

> ⚠️ **這條線與 UI 改版線（Phase 2）完全無關，沒有動到任何 `src/`。** 不要把這份 handoff 當成 Phase 2 的接手文件——那條線讀 `plans/handoff-phase2-dashboard__2026-09-02-2214.md`。

---

## 1. 冷啟動先跑這幾條（不要相信下面的數字，自己驗）

```bash
cd ~/Documents/20_Projects/Project_Anchorline
git status -sb
git log --oneline -6
ls -la docs/ai-native-sdlc-playbook.html docs/anchorline-governance-chain.*
```

**我離開時的實測值（2026-09-03 06:24 CST）**

| 項目 | 值 |
|---|---|
| 分支 | `main`，領先 origin **21** 個 commit，全部未 push |
| HEAD | `773f0c3 feat(ui): Phase 2 後半 —— dashboard 治理鏈接線與空狀態` |
| 工作樹 | 15 項未追蹤／已修改 |

**注意**：`773f0c3` / `437d9d5` / `97748f7` 這幾個 Phase 2 commit **不是這條線做的**，是另一個 session 在同一個工作樹上推進的。`PROJECTS.md` 裡 Anchorline 條目寫的「Phase 1 已完工 `9659437`、領先 15」**已經過時**（實際已到 Phase 2、領先 21）。要接 UI 改版線的人請以 `git log` 為準，不要以 PROJECTS.md 為準。

---

## 2. 這條線的產出（4 個檔案，全部未 commit）

| 檔案 | 內容 |
|---|---|
| `docs/ai-native-sdlc-playbook.html` | 主文件。1916 行 / 145KB，單檔零建置（只外連 Google Fonts）。原文 **15 個 play** 全文詳解 + 11 份程式碼範本 + 4 張圖 + Anchorline 對照 + 導入檢核清單 |
| `docs/anchorline-governance-chain.html` | 05 節單獨拉出的 archify workflow 流程圖，699KB |
| `docs/anchorline-governance-chain.archify.json` | 上面那張圖的規格來源（6KB），改圖改這份再 `deliver` |
| `plans/anchorline__2026-09-03-0600__ai-native-sdlc-interactive-html.md` | 本線的追蹤文檔，含收斂過程與踩到的坑 |

另外改了一處：主文件 05 節加了一段連到流程圖的方框連結。

`.aidesigner/` 底下那一堆未追蹤目錄與 `plans/Anchorline__2026-09-03-0453__aidesigner-ultradesign-handoff.md` **不是這條線的**，是 AIDesigner 那條線的產物，別一起 commit 掉。

---

## 3. 已經驗過的（不用重驗）

**主文件** —— Interceptor 在隔離 test profile 開 `localhost:5199` 實看：

- DOM 實測：DAG 15 節點 / 22 條邊、15 張 play 卡、17 項檢核
- 無橫向溢位：`body.scrollWidth 1833 < innerWidth 1848`
- 互動實測：圖 01 切換後 segs `304,194,56,166,153,97` 對 grow `22,14,4,12,11,7`（比例一致 ≈13.8/單位）；圖 03 點 M1 前置鏈正確展開；Anchorline 表格篩選「缺口」得 6 列
- 雙主題 token 都解析得出（light `rgb(237,239,234)` / dark indigo `#93A7EE`）
- 全頁 + 圖 02 / 圖 03 / 圖 04 分別 zoom 看過，無標籤碰撞或裁切

**流程圖** —— archify 官方工具：

- `deliver workflow --quality showcase`：**9/9 checks · 0 errors · 0 warnings**
- `visual-check`：**pass**，1440×900 / 1600×1000 / 1920×1080 / 2048×1320 四個尺寸都無溢位
- spec sha256 `9fdd1e36…` / artifact sha256 `11155029…`
- light/dark 截圖看過後已刪除（`node ~/.claude/skills/archify/bin/archify.mjs visual-check <html> --json` 可重生）

---

## 4. 還沒收的線頭（照優先度排）

1. **要不要 commit？** 4 個檔案還在工作樹。這條線沒有 push 的理由（純文件），但也不該一直懸著。**push 的前置沒變**：`add-vibe-route` 的 8 題實機 UAT 待 Scott，而且現在領先 origin 21 個 commit。
2. **05 節的 Anchorline 現況欄是判讀，不是查證。** 依 `README.md` 與 `docs/PRD.md` 寫的，**未逐一核對原始碼**。文件裡已經標了這句話。要拿它當改版依據之前，14 列每一列都該回去驗一次——尤其「已具備 / 部分 / 缺口」這個判定。
3. **主文件沒做窄視窗實測。** 只在 1848px 寬驗過。CSS 有寫 responsive，但沒實測。
4. **流程圖的 Viewer UI 是英文。** archify 的 `meta.locale` 只吃 `en` / `zh-CN`，繁中不在選項裡。我選英文而不是簡體。圖上的內容全是繁中，只有 Legend / Export / Present 這些按鈕是英文。
5. **為了通過 1440×900 首屏 containment，圖裡砍掉了兩樣東西**：`phases` 三條階段帶、以及第四張卡（authorAgentFamily 那張，內容已在主文件 05 節）。如果之後不在意首屏 containment，把 `docs/anchorline-governance-chain.archify.json` 的那兩塊加回去再 `deliver` 就好。
6. **`docs/` 沒有索引指到這兩份新 HTML。** README 與 docs 目錄裡都沒有連結，只有主文件內部連到流程圖。
7. **這個 session 的 3.1MB 是被什麼撐大的**：抓原文（WebFetch 只回摘要，改用 curl + 自寫抽取器拿 2188 行全文）、七段 heredoc 寫 1916 行 HTML、archify 六輪幾何收斂。下次做同類事情，**archify 那六輪是可以省掉的**——三條硬約束記在追蹤文檔第二段。

---

## 5. 下次要再動 archify 時，直接看這三條

寫在 `plans/anchorline__2026-09-03-0600__ai-native-sdlc-interactive-html.md` 末段，這裡只放標題：

1. 同 lane 相鄰 col 的節點寬度上限 ≈ 70px（col pitch 80）——要放長標籤就換 lane 走 `route:"drop"`。
2. `up-channel` 的 `toSide` 是 `"top"` 不是 `"bottom"`。
3. **viewBox 調寬會讓字變小**，修不了溢位。`desktop-readability` 用 `930/viewBoxWidth` 當縮放比，投影字級要 ≥6px。

---

## 6. 明確不要做的事

- 不要把 `.aidesigner/` 的未追蹤檔案跟這條線的 4 個檔案一起 commit。
- 不要照 `PROJECTS.md` 的 Anchorline 條目理解目前進度，它停在 Phase 1。
- 不要把 05 節的判定當查證結果直接開單。
- 不要為了「補完」把主文件再加長——它已經 145KB，該補的是查證，不是字數。
