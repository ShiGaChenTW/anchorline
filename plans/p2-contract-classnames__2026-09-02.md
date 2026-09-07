# Phase 2 契約 — class 名與 gov-chain API

> PM 敲定於 2026-09-02。**P2-1（CSS）／P2-2a（gov-chain）／P2-2c（接線）三支各自獨立作業，
> 唯一的防撞面就是這份契約。** 不得自行改名、不得新增未列出的 class。
> 要加新 class 先回報 PM，不要自己決定。

## 一、class 名（硬契約）

### 頁首
| class | 用途 |
|---|---|
| `.d-head` | 頁首容器（專案身分 ＋ 鏈健康度一行） |
| `.d-head-name` | 專案身分（沿用既有可編輯身分的掛點） |
| `.d-head-health` | 鏈健康度一行，靠右。**不得出現 L 碼** |

### 治理鏈
| class | 用途 |
|---|---|
| `.gov-chain` | `<ol>` 容器 |
| `.gc-ghost` | 影子鏈修飾子，與 `.gov-chain` 併用：`<ol class="gov-chain gc-ghost">` |
| `.gc-station` | `<li>`，一站 |
| `.gc-station.is-done` / `.is-active` / `.is-todo` / `.is-unknown` | 四種站狀態，互斥 |
| `.gc-dot` | 狀態點 |
| `.gc-idx` | 序號。**1–6 阿拉伯數字，不是 L 碼** |
| `.gc-name` | 站名 |
| `.gc-state` | 狀態字 |
| `.gc-lead` | 一句話結論 |
| `.gc-details` | 原生 `<details>`（**不用委派 listener**） |
| `.gc-summary` | 原生 `<summary>` |
| `.gc-pass` | passWhen 文案，放在 `.gc-details` 內 |
| `.audit-trail-micro` | 稽核微列 `<ul>`，上限 3 條 |
| `.atm-item` | 微列一條 `<li>` |
| `.gc-todo` | 「現在該做」。**只有 active 站有** |
| `.gc-go` | 前往按鈕。**只有 active 站有** |
| `.gc-note` / `.gc-note.is-warn` | 站內註記位。**本輪只預留位置，不填內容**（D-6） |

### 鏈下
| class | 用途 |
|---|---|
| `.d-grid--facts` | 降級事實卡列，與既有 `.d-grid` 併用：`<div class="d-grid d-grid--facts">`。⚠️ **不得叫 `.d-facts`** —— 那個名字已被 `shared.css:8859` 的 `<dl>` 佔用（`display:flex` ＋ `dt`/`dd`），併用會撞 `display` |
| `.d-measured` | 量測時間 ＋ 路徑 |

### 空狀態
| class | 用途 |
|---|---|
| `.empty-state-layout` | 兩欄容器，<900px 退單欄 |
| `.esl-main` | 左欄（影子鏈 ＋ 一句話 ＋「指定專案資料夾」） |
| `.esl-side` | 右欄（實測列 ＋ 次要文字連結） |
| `.esl-links` | 輕量次要文字連結列（編輯身分／版號政策，D-5）。**不得是卡片** |

## 二、`src/lib/gov-chain.ts` 導出符號（硬契約）

```ts
export const AUDIT_ITEM_CAP = 3;
export type StationId = "l1" | "l2" | "l3" | "l4" | "l5" | "l6";  // 內部 id，不進 UI 文字
export type StationState = "done" | "active" | "todo" | "unknown";
export type ChainStation = { ... };
export type ChainInput = { ... };          // 形狀由 P2-2a 決定，須寫成純 plain data
export function buildChainStations(input: ChainInput): ChainStation[];
export function renderGovChainHtml(stations: ChainStation[]): string;
export function renderGhostChainHtml(): string;
export function chainHealthLine(stations: ChainStation[]): string;
```

**函式名與 `AUDIT_ITEM_CAP` 是契約，`ChainInput` 的欄位不是** —— 後者由 P2-2a 定，
P2-2c 讀 `gov-chain.ts` 之後照著餵。

## 三、六站（硬契約）

序號 1–6，名稱取自 `flow-layers.ts` 的 `FLOW_LAYER_DEFS[].name`，**不得再造一份對照表**：

| # | id | 名稱 |
|---|---|---|
| 1 | `l1` | 意圖 |
| 2 | `l2` | 規格 |
| 3 | `l3` | 計劃 |
| 4 | `l4` | 實作 |
| 5 | `l5` | 驗證 |
| 6 | `l6` | 交付 |

## 四、渲染規則（硬契約）

1. **active 站恰好 1 個**，且只有它渲染 `.gc-todo` 與 `.gc-go`
2. **缺資料整段不渲染**，不留 `—` 空殼
3. `passWhen` 一律取 `layer.passWhen`（`FlowLayer` 上的動態值），
   **不得取 `FLOW_LAYER_DOCS[].passWhen`** —— 那是靜態值，對 vibe 說謊
4. 稽核微列上限 `AUDIT_ITEM_CAP`（3）
5. UI 新增行**不得出現 `L0`–`L4` 字樣**；`l1`–`l6` 這種內部 id 與程式註解不受限
6. `planStepsKnown === false` 時 `l3` 為 `"unknown"`，顯示「桌面版才量得到」，
   **且重算 active 時跳過該站**
