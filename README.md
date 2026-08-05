# SpecForge · PRD 引導工作台

多頁桌面原型（Open Design handoff → production）。

## 架構

| 畫面 | 角色 |
|------|------|
| `index.html` | Launcher / 總覽 |
| `projects.html` | 專案列表 |
| `editor.html` | 引導式編輯工作台 |
| `templates.html` | 章節範本庫 |
| `review.html` | 審閱簽核 |

- **Tokens / 主題**：`shared.css`（Warp · kami · GitHub · Claude）
- **邏輯**：`src/` TypeScript（Vite MPA）
- **狀態**：`localStorage` key `specforge:state:v1` + `specforge:theme`

## 角色與登入（本機原型）

| 角色 | 權限 |
|------|------|
| **管理員** | 全部（含人員管理） |
| **核准人員** | 讀取、簽核、匯出；**不可**編輯內文 |
| **編輯人員** | 撰寫／維護／編輯／讀取／移除；可覆核**他人**檔案，不可覆核自己的；不可正式簽核 |

- 人員可任一種角色；**Agent 僅可為編輯或核准**
- 同一 **Agent 族系**撰寫的文件，不可再由同族系 Agent 核准
- 示範密碼一律：`demo`（管理員 `系統管理員`、編輯 `林可晴`、核准 `周承翰`、Claude 編輯／核准、GPT 核准…）
- App 啟動 → `login.html`；工作頁未登入會導回登入

### 匯出與範例

- 專案／審閱／設定：匯出 **Markdown / JSON / HTML**
- **一鍵隱藏／展示範例文件**（清空示範內文與隱藏種子專案，可還原）

### 管理中心（`admin.html`，僅管理員）

| 分頁 | 功能 |
|------|------|
| **人員權限名單** | 新增／編輯／異動角色／停用／刪除 |
| **簽核流程設計** | 關卡排序、預設簽核人、必簽設定 |
| **個案調整** | 異動關卡人員、抽單、重開、套用流程 |

## 開發

```bash
bun install
bun run dev
```

## 建置

```bash
bun run build
bun run preview
```

`vite.config.ts` 使用 `base: "./"`，讓 macOS App（WKWebView `file://`）能載入 `./assets/*` CSS/JS。不要改回 `base: "/"`，否則安裝後畫面會黑底、文字幾乎看不見。

## macOS App

```bash
bash mac-app-build/build-dmg.sh
# 產出 SpecForge.app + SpecForge-1.0.0-macOS.dmg
open SpecForge.app
```
