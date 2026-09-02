# Anchorline — AI-Native SDLC Playbook 互動式學習頁

- **建立時間**：2026-09-03 06:00 CST
- **來源**：https://claude.com/blog/the-ai-native-sdlc-playbook（2026-08-21，Louis Claxton）
- **目的**：① 學習教材 ② Anchorline 後續改版的對照參考
- **產出**：`docs/ai-native-sdlc-playbook.html`（單檔、零建置、可離線）

## 步驟

- [x] 抓原文全文（WebFetch 只回摘要 → 改用 curl + 自寫抽取器拿到 2188 行全文）
- [x] 讀 Anchorline README / docs/PRD.md，取得對照的事實基礎
- [x] 載入 skills：`html-diagram`（圖）、`artifact-design`（版面）
- [x] 建立追蹤文檔
- [x] 寫 HTML：15 個 play 全文詳解 + 5 張圖 + Anchorline 對照 + 自我檢核
- [x] 瀏覽器實看一次（Interceptor）並修正

## 內容盤點（原文結構）

| 階段 | Plays |
|---|---|
| 1 Plan | 捕捉 intent.md |
| 2 Design | 需求與設計合併 |
| 3 Build | plan mode（含 auto mode）／legacy 真相來源 sidebar／CLAUDE.md／Skills／Hooks 建置護欄／平行 session 與 subagent |
| 4 Test | 回饋迴圈／CI 持續 evals |
| 5 Deploy | PR 審查雙向／Hooks 核准閘（含 managed settings 範例）／CI/CD 整合 |
| 6 Maintain | 閉環（bands.yaml）／週期性掃描（Claude Security）／Claude Tag on-call |

## 圖表決策

| 圖 | 形式 | 為什麼 |
|---|---|---|
| 01 瓶頸移位 | HTML/CSS 比例長條 + 切換 | 量值比較，不需 SVG |
| 02 六階段迴圈 | SVG 水平環（含回流箭頭） | 拓樸 + 交付物落在邊上；水平比環狀少標籤碰撞 |
| 03 採用順序 DAG | SVG 分層圖 + 前置鏈追蹤 | 原文明說「箭頭是採用順序，不是階段順序」 |
| 04 一次變更流程 | SVG 直式流程 + 閘門菱形 | 有分支（退回），需要真流程圖 |
| 05 σ 控制帶 | HTML 三層帶 | 三個值，SVG 是浪費 |

## 結束摘要

（完成後補）

---

## 結束摘要（2026-09-03）

**產出**：`docs/ai-native-sdlc-playbook.html`（1916 行 / 145KB，單檔零依賴，只外連 Google Fonts）

**驗證（Interceptor，isolated test profile，localhost:5199）**
- DOM：`dagNodes=15`、`dagEdges=22`、`details.play=15`、檢核 17 項
- 無橫向溢位：`body.scrollWidth=1833` < `innerWidth=1848`
- 圖 01 切換：transition 收斂後 segs `304,194,56,166,153,97`（grow `22,14,4,12,11,7`，比例一致 ≈13.8/單位），`總長 70`
- 圖 03 點 M1：前置鏈正確展開（R3/R2/R1/B5/T1/B2…）
- Anchorline 表格篩選「缺口」→ 6 列
- 雙主題 token 皆解析：light `body bg rgb(237,239,234)` / dark `rgb(147,167,238)` indigo
- 截圖：全頁 + 圖 02 迴圈 + 圖 03 DAG + 圖 04 流程圖，皆無標籤碰撞或裁切

**踩到的坑**：測試 profile 同時開著另一個同 URL 分頁，`eval` 跟到非預期分頁，量到自相矛盾的數值（按鈕 `aria-pressed=false` 卻是 pressed 配色）。`CleanupTabs.sh` + `tab switch <id>` 後全部一致。另外 `flex-grow` 有 0.6s transition，點完立刻量會量到動畫中途的寬度——要等。

**沒做**：未 commit（等 Scott）、未發布成 artifact（外流動作，沒問過）。

---

## 追加（同日）：05 節單獨拉成 archify 流程圖

**產出**：`docs/anchorline-governance-chain.html`（699KB）＋ 規格 `docs/anchorline-governance-chain.archify.json`（6KB），並從主文件 05 節加了連結。

- `deliver workflow --quality showcase`：**9/9 checks、0 errors、0 warnings**
- `visual-check`：**pass**（1440×900 / 1600×1000 / 1920×1080 / 2048×1320 皆無溢位），light/dark 截圖已看過後刪除（可用 `visual-check` 重生）
- spec sha256 `9fdd1e36…`、artifact sha256 `11155029…`

**收斂過程的三個硬約束（下次直接照用，省掉五輪）**
1. **同 lane 相鄰 col 的節點寬度上限 ≈ 70px**（col pitch 80）。要放長標籤就別讓兩個節點落在同 lane 的相鄰欄，改用「換 lane + `route:"drop"`」或「同 lane 跳欄 + `bottom-channel`」——這是官方範例的寫法，照抄錯誤數直接從 15 掉到 6。
2. **`up-channel` 的 `toSide` 是 `"top"` 不是 `"bottom"`**：路徑從上方繞過去再往下進節點，方向檢查看的是最後一段。
3. **viewBox 寬度愈大字愈小**：`desktop-readability` 用 `930/viewBoxWidth` 當縮放比，投影字級要 ≥6px。本圖 w=1000 過、w=1060 不過。**把 viewBox 調寬修不了溢位，只會讓字變小。**

**為了通過 1440×900 containment 砍掉的東西**：`phases` 三條階段帶、第四張卡（authorAgentFamily 那張，內容已在主文件）、卡片文案改成一行。viewBox 收到 1000×600。

**已知取捨**：`meta.locale` 只支援 `en` / `zh-CN`，繁中不在其中，所以 Viewer UI（Legend、Export、Present 等）是英文。寧可英文也不要簡體。
