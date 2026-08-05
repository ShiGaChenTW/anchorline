# PM-SPEC+SCVB

**SpecForge PRD 引導工作台** + **S.CodingFlow（SCVB）** 結構 gate 與計劃追蹤整合版。

- 來源基底：SpecForge（`Pm-Spec-Final`）
- 整合參考：S.CodingFlow / scvb-dashboard / SpecGate 方法論
- **原 SpecForge repo 保持獨立、未改動**

## 與純 SpecForge 的差異

| 能力 | 說明 |
|------|------|
| **結構 gate** | Non-Goals ≥ 3、摘要完整、成功指標等（程式判定）→ 擋送審／核准 |
| **計劃追蹤頁** | `tracking.html`：解析 `plans/*.md` checkbox、完成度、下一步（SCVB tracking 概念） |
| **L1–L6** | 專案／編輯／審閱頂部流程條 + 追蹤頁側欄 |
| **新建 PRD 精靈** | 4 步：基本 → 問題 → Non-Goals≥3 → 成果指標 |
| **`?` help** | 全站快捷鍵與 SCVB 說明浮層（1–5 導覽） |

## 畫面

| 畫面 | 角色 |
|------|------|
| `login.html` | 登入（Scott + Agents，密碼 `demo`） |
| `projects.html` | 專案列表 |
| `editor.html` | 引導編輯 + **結構 gate 面板** |
| `templates.html` | 範本庫 |
| `review.html` | 審閱簽核（gate 擋核准） |
| `tracking.html` | **SCVB 計劃追蹤** |
| `admin.html` | 人員／流程／個案 |
| `agents.html` | Agent prompt / 啟停 / 進場 |

## 開發

```bash
bun install
bun run dev
# 開啟 login.html 或 tracking.html
```

## 終端 TUI（真·Terminal）

讀取 `plans/*.md` 的計劃進度（SCVB tracking 概念，零 blessed 依賴）：

```bash
bun run track          # 全螢幕互動 TUI
bun run track:once     # 單次輸出（可 pipe）
bun run track -- --dir ./plans
```

| 鍵 | 功能 |
|----|------|
| `j` / `k` | 下／上一個 plan |
| `J` / `K` | 步驟清單捲動 |
| `r` | 重新載入 |
| `?` | 說明 |
| `q` / `Esc` | 離開 |

Web 版追蹤頁：`tracking.html`（App 內）。終端版：`bun run track`。

## 建置 / macOS App

```bash
bun run build

# 正式版 → SpecForge.app + SpecForge-{version}-macOS.dmg
bun run app:prod

# 測試版 → SpecForge Test.app + SpecForge-Test-{version}-macOS.dmg
bun run app:test

# 一次打兩包
bun run app:all
```

| 變體 | App 名稱 | Bundle ID | 範例專案 | DMG |
|------|----------|-----------|----------|-----|
| **正式** | `SpecForge.app` | `com.specforge.prd.workbench` | **僅 1 份**（SaaS 2FA） | `SpecForge-{ver}-macOS.dmg` |
| **測試** | `SpecForge Test.app` | `com.specforge.prd.workbench.test` | 8 份示範列表 | `SpecForge-Test-{ver}-macOS.dmg` |

測試版在 Dock／選單列／Finder 顯示名稱含 **Test**，可與正式版並存。

### PRD 新手撰寫流程

專案列表 → **🌱 新手引導**（或空狀態 CTA）：

1. 認識 PRD  
2. 一句話交付物  
3. 給誰 · 為何現在  
4. 問題陳述  
5. 目標 / Non-Goals≥3  
6. 成功指標  
7. 確認建立 → 編輯台 **新手教練列**

快速路徑：**＋ 新建 PRD**（略過說明，同一套骨架）。

`vite.config.ts` 使用 `base: "./"`（file:// 相容）。

## 文件

- 整合分析：`plans/Pm-Spec__2026-08-05-integration-S-CodingFlow.md`
- 上游 SpecForge：https://github.com/ShiGaChenTW/Pm-Spec-Final
- 本整合 repo：https://github.com/ShiGaChenTW/PM-SPEC-SCVB
