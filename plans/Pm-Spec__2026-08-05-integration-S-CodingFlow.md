# SpecForge × S.CodingFlow 整合實作分析報告

**建立時間：** 2026-08-05  
**狀態：** 待確認（確認後再實作）  
**基準專案：** `Pm-Spec(Final)` / SpecForge  
**參考專案：** `/Users/scottchen/Documents/20_Projects/Projetc_S.CodingFlow`（S.CodingFlow / scvb-specgate / scvb-dashboard）

---

## 1. 一句話定位差異

| | **SpecForge（本專案）** | **S.CodingFlow** |
|---|---|---|
| **產品本質** | PRD **人機協作工作台**（寫 → 審 → 簽核 → 匯出） | **Agent 開發紀律系統**（強制 spec 紀律 + 進度追蹤 TUI） |
| **主要使用者** | 產品／工程／設計／資安、Agent 角色扮演簽核 | 開發者 + Claude Code / Codex agent |
| **主介面** | macOS WebKit 多頁 App（Vite MPA + localStorage） | CLI hook + Blessed TUI (`scvb`) + 可選 GUI / Menubar |
| **真相來源** | `localStorage` 內的專案／章節／簽核／人員 | 檔案系統：`openspec/`、`plans/*.md`、`tasks.md` |
| **強制力** | UI 權限與按鈕禁用（可繞過資料層） | Hook `exit 2` 擋操作（法律層） |

**結論：** 兩者互補，不宜整包合併。應以 **SpecForge 產品殼與 PRD 工作流為主**，從 S.CodingFlow **挑可複用的方法論、檢查規則、TUI 追蹤與模板**，以「外掛模組／可選面」方式接入。

---

## 2. 兩邊現況盤點

### 2.1 SpecForge（本專案）已具備

| 模組 | 狀態 | 說明 |
|------|------|------|
| 多頁 PRD UI | ✅ | hub / projects / editor / templates / review |
| 主題系統 | ✅ | Warp / kami / GitHub / Claude |
| 登入與 RBAC | ✅ | admin / approver / editor + Agent 族系隔離 |
| 管理中心 | ✅ | 人員、簽核流程設計、個案異動／抽單 |
| Agent 管理 | ✅ | prompt / role / 啟停 / 呼叫進場（原型模擬） |
| 匯出 | ✅ | MD / JSON / HTML |
| 範例一鍵切換 | ✅ | showSamples |
| macOS 封裝 | ✅ | WKWebView App + DMG |
| 檔案系統 SSOT | ❌ | 僅 localStorage |
| 終端 TUI | ❌ | 無 |
| 寫碼前 gate / hook | ❌ | 無 |
| OpenSpec 變更生命週期 | ❌ | 無 |

### 2.2 S.CodingFlow 核心資產

| 資產 | 路徑 | 價值摘要 |
|------|------|----------|
| **SpecGate 四道 BLOCK** | `specgate/packages/specgate-core` | no-spec / non-goals≥3 / unarchived / orphan-facet |
| **Blessed TUI（正式）** | `specgate/tui-ts` → `scvb` | learn / create / monitor + tracking 模式 |
| **Plan 解析器** | `tui-ts/src/plan-parser.ts` | checkbox / 狀態欄 / 下一步 / 阻塞 |
| **詞彙 SSOT** | `vocab.ts` + `shared/flow-layers.ts` | 狀態封閉列舉、L1–L6 |
| **PRD 模板（機器可檢）** | `Doc/templates/PRD.template.md` | Non-Goals / Desired Outcomes 硬標題 |
| **三角色架構** | `Doc/methodology/…三角色…` | 作業 agent / 程式追蹤 / 管理 agent |
| **agenttask 計劃格式** | `skill/agent_task_RTY_TUI` | plan 檔名、checkbox、launch_tui |
| **Web GUI coach** | `specgate/gui` | 新手導覽、唯讀 snapshot |
| **Menubar** | `specgate/menubar` | 常駐狀態（可選） |
| OpenSpec profiles/changes | `openspec/` | 變更生命週期 SSOT |

### 2.3 TUI 頁面／模式（S.CodingFlow 重點）

`scvb`（Blessed）主要表面：

| 模式 / 面板 | 用途 | 對 SpecForge 的可對應 |
|-------------|------|----------------------|
| **learn** | 學習 kit 資源瀏覽 | 可做成「規格方法論／章節教練」側欄或獨立學習頁 |
| **create / beginner wizard** | 新建專案引導 | 可強化「新建 PRD」精靈（目前僅 modal） |
| **monitor** | OpenSpec / 專案監控 | 可對應「計劃進度 / 變更狀態」面 |
| **tracking** | 追蹤 `plans/*.md` 或 tasks | **最高價值**：SpecForge 目前無即時計劃進度 TUI |
| **flow overlay** | L1–L6 流程圖 | 可做成 hub 或 editor 內「流程層」導覽 |
| **help `?`** | 鍵位浮層 | editor 快捷鍵 overlay |
| **search** | kit 搜尋 | 模板庫搜尋強化 |

另有舊入口：`tui-go`（非正式）、`flowtui/`、legacy Swift TUI。

---

## 3. 架構交叉：為什麼「以 SpecForge 為主」

```
┌─────────────────────────────────────────────────────────┐
│  SpecForge macOS App（產品主殼 · 本專案）                  │
│  登入 · PRD 編輯 · 審閱簽核 · Agent 管理 · 匯出            │
│  localStorage 工作區狀態                                  │
└───────────────┬─────────────────────────┬───────────────┘
                │ 可選橋接                 │ 可選橋接
                ▼                         ▼
┌───────────────────────────┐   ┌───────────────────────────┐
│  SpecForge Tracking TUI   │   │  Spec Quality Gates       │
│  （移植 scvb tracking）    │   │  （移植 SpecGate 規則）    │
│  讀 plans/ 或 tasks.md    │   │  寫入/送審前結構檢查       │
└───────────────────────────┘   └───────────────────────────┘
                │                         │
                └────────────┬────────────┘
                             ▼
              檔案層 SSOT（新增，可選）
              workspace/changes/... 或 plans/
```

- **不建議** 把 SpecGate hook 直接塞進 WKWebView App 當唯一入口。  
- **建議** 讓 SpecForge 繼續當「人簽核 + PRD 協作」主介面；S.CodingFlow 能力以 **library + CLI/TUI sidecar** 形式服務本專案。

---

## 4. 可整合項目清單（按優先級）

### P0 — 強烈建議（直接提升本專案核心）

#### P0-1. PRD 結構契約（來自 PRD.template + SpecGate non-goals）

**來源：** `Doc/templates/PRD.template.md`、`no-non-goals` gate  

**落到 SpecForge：**
- 編輯器章節強制對應：`Non-Goals` ≥ 3、`Desired Outcomes` 需可量測字樣  
- 送審／簽核前跑 **結構檢查**（程式判定，不靠 LLM）  
- 與現有 `ai-coach` linter 合併：既有 vague terms + 新的 section 門檻  

**實作形態：** `src/lib/prd-gates.ts` + editor coach 面板 + review 送審阻擋  

#### P0-2. 計劃進度追蹤 TUI（來自 scvb tracking + plan-parser）

**來源：** `tui-ts/src/plan-parser.ts`、`tracking.ts`、`vocab.ts`  

**落到 SpecForge：**
- 在本 repo 的 `plans/` 採用 **同一 checkbox 語法**（已部分相容 agenttask-tui）  
- 新增 **`scvb` 風格 tracking 面**：或  
  - **A)** 嵌入 SpecForge 新頁 `tracking.html`（Web 模擬 TUI 面板），或  
  - **B)** 獨立 `bun` CLI `specforge-track` 讀 `plans/` 並在終端顯示（直接重用 plan-parser 思路）  

**建議先做 A（Web 面板）** 以符合「本專案 = 桌面 App 主殼」；TUI CLI 作 P1 sidecar。

#### P0-3. 三角色對齊現有 RBAC + Agent

**來源：** 作業 / 追蹤(程式) / 管理 三刀切  

**落到 SpecForge：**
| S.CodingFlow 角色 | SpecForge 對應 |
|-------------------|----------------|
| 作業 agent | `accessRole: editor` 的 Agent（Claude/Codex/Grok/Agy 編輯） |
| 管理 agent | `accessRole: approver` 的 Agent + 人類核准 |
| 追蹤（程式） | **新建** 結構 gate / plan parser（非 LLM） |
| 人類 admin | Scott 管理員 |

→ 把「Agent 進場」與「結構檢查」切開：Agent 只寫/審語意，程式只數「有沒有」。

---

### P1 — 建議（明顯加分，與產品契合）

#### P1-1. L1–L6 流程層導覽

**來源：** `shared/flow-layers.ts`  

**落到 SpecForge：**  
hub / editor 增加「意圖→規格→計劃→實作→驗證→交付」進度條；PRD 送審 = L2 完成信號。

#### P1-2. 新建 PRD 精靈（beginner wizard）

**來源：** `beginner-wizard.ts`、GUI coach  

**落到 SpecForge：**  
取代單薄 modal：問題 / 受益者 / Non-Goals 最少 3 條 / Outcomes → 生成初始 sections。

#### P1-3. `?` 快捷鍵 help overlay

**來源：** TUI help overlay 設計審計  

**落到 SpecForge：**  
editor / review 全頁 `?` 顯示快捷鍵（1–4、⌘S、R 回覆等）。

#### P1-4. 檔案匯出對齊 OpenSpec 片段

**來源：** openspec change 結構  

**落到 SpecForge：**  
匯出時可選「OpenSpec bundle」：`PRD.md` + `tasks.md` skeleton + Non-Goals 段，方便丟給 Claude Code。

#### P1-5. Plan 檔與審閱狀態雙向提示

**來源：** task-tracking spec（tasks 為 SSOT）  

**落到 SpecForge：**  
`plans/*.md` 完成度顯示在 projects 列表旁；不強制以 tasks 覆寫簽核狀態（簽核仍以本專案 case 為準）。

---

### P2 — 可選／長期

| 項目 | 說明 | 風險 |
|------|------|------|
| 完整 SpecGate hook | 在本機 Claude Code 開發本專案時掛 hook | 與 App 產品路徑分離，屬 dev tooling |
| scvb binary 原樣內嵌 | App 內 spawn 終端 | 打包體積、權限、維護雙棧 |
| Menubar 常駐 | 顯示今日待審數 | 需 Swift 另 target |
| GUI coach 整站搬入 | 與 SpecForge 視覺系統衝突 | 建議只抽流程文案 |
| orphan-facet / BF-NN | 邊界編號體系 | 對 PRD 產品過重，可後做 |

---

## 5. 明確「不要整包搬」的項目

| 項目 | 原因 |
|------|------|
| 以 OpenSpec 取代 SpecForge 資料模型 | 本專案核心是簽核協作，不是 change archive 引擎 |
| 用 Blessed 重寫整個 SpecForge UI | 與現有 Web 設計系統、macOS App 路徑衝突 |
| 四道 gate 原樣不改就當產品阻擋 | 需改寫成「PRD 章節語意」而非 openspec 目錄語意 |
| 強制所有使用者裝 Claude Code hook | 超出 PRD 工作台產品邊界 |

---

## 6. 建議實作分期（確認後執行）

### Phase A — 規格品質底盤（約 1–2 日）

1. `src/lib/prd-gates.ts`：Non-Goals 計數、Outcomes 量測啟發式、摘要三欄非空  
2. Editor coach 顯示 gate 結果；Review「送審／核准」前強制  
3. 採用／改編 `PRD.template.md` 的引導註解進 section `guide`  

### Phase B — 計劃追蹤面（約 2–3 日）**【TUI 重點】**

1. 抽出/移植 `plan-parser` + `vocab` 概念 → `src/lib/plan-parser.ts`  
2. 新頁 `tracking.html`（Web 仿 TUI：Header + 清單 + 完成度 bar + 下一步）  
3. 讀寫本 repo `plans/*.md`；與 agenttask 格式對齊  
4. （可選）`bun run track` CLI 用同一 parser 輸出終端簡易表  

### Phase C — 流程與精靈（約 1–2 日）

1. L1–L6 狀態模型寫入 store（可由專案 status + gate 推導）  
2. 新建 PRD wizard（4 步）  
3. `?` help overlay  

### Phase D — 開發者 sidecar（可選）

1. 本專案 dogfood：可選安裝 scvb-specgate 僅用於 repo 開發  
2. 匯出 OpenSpec bundle  

---

## 7. TUI 移植技術建議（Phase B 細節）

### 7.1 不建議

- 在 WKWebView 內跑 Blessed / neo-blessed（依賴 tty，不適合）  
- 原樣 fork 整包 `tui-ts` 進 App Resources  

### 7.2 建議

| 層 | 做法 |
|----|------|
| **解析層** | 純 TypeScript port `plan-parser` + 狀態詞彙（無 terminal 依賴） |
| **呈現層 A** | SpecForge Web 頁：深色 terminal-like 面板（沿用 Warp token） |
| **呈現層 B** | 可選 standalone `specforge-track`（Bun + 簡易 ANSI 或 blessed） |
| **資料** | `plans/` 為進度 SSOT；SpecForge 簽核 `cases` 為簽核 SSOT——**兩套不互相覆寫** |

### 7.3 Web「TUI 頁」資訊架構草案

```
tracking.html
├── Header：目前 plan 標題 / 狀態 / 完成 x/y
├── Sidebar：plans/ 檔案列表
├── Main：步驟清單 [x]/[ ] / ~~skip~~ + 完成度 bar
├── Side：決策紀錄 / 阻塞 / 下一步
└── Footer：快捷鍵 r 重新整理 · j/k · enter 開檔
```

快捷鍵與 scvb tracking 對齊可提升跨工具肌肉記憶。

---

## 8. 風險與決策點（需你確認）

| # | 決策 | 選項 | 建議 |
|---|------|------|------|
| D1 | 計劃進度放哪 | 僅 Web / 僅 CLI TUI / 兩者 | **先 Web，CLI 可選** |
| D2 | PRD 與 OpenSpec | 輕量對齊模板 / 完整 change 生命週期 | **輕量模板 + gate** |
| D3 | Gate 嚴格度 | 僅 WARN / 擋送審 / 擋編輯存檔 | **先擋送審與核准** |
| D4 | 是否內嵌 scvb binary | 是 / 否 | **否**（避免雙棧） |
| D5 | Agent 進場是否接真 LLM | 維持模擬 / 接 API | 維持模擬至 Phase C 後 |

---

## 9. 成功判準（整合後）

1. 使用者在 SpecForge 寫 PRD 時，**Non-Goals < 3 無法送審**。  
2. `plans/` 有計劃時，**tracking 頁**顯示正確完成度與下一步。  
3. Scott + 8 個 Agent 角色不變；Agent 進場與結構 gate **互不取代**。  
4. App 仍可離線以 localStorage 運作；檔案層為**增強而非硬依賴**。  
5. 不引入「必須先會用 OpenSpec 才能開 App」的門檻。

---

## 10. 總結建議

**可從 S.CodingFlow 帶進 SpecForge 的精華（按價值）：**

1. **結構紀律**（Non-Goals / Outcomes / 機器可檢模板）  
2. **計劃追蹤體驗**（plan-parser + tracking 面，優先 Web 仿 TUI）  
3. **三角色清晰切割**（程式追蹤 ≠ Agent 作業/管理）  
4. **L1–L6 詞彙**與流程可視化  
5. **新手精靈 / help overlay** 的 UX 模式  

**應留在 S.CodingFlow 生態、不吞進本產品殼的：**

- Claude Code Hook 強制力本體  
- 完整 OpenSpec archive 引擎  
- Blessed 全螢幕 IDE 工作台整包  

---

## 11. 請你確認的事項

回覆時可直接勾選／改寫：

- [ ] **採納 Phase A**（PRD gates）  
- [ ] **採納 Phase B**（tracking 頁；Web / CLI / 兩者）  
- [ ] **採納 Phase C**（L1–L6 + wizard + help）  
- [ ] **Phase D** 要或不要  
- [ ] Gate 嚴格度：WARN only / 擋送審 / 擋存檔  
- [ ] 其他要加／不要做的項目  

確認後再依選定分期實作。
