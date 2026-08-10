# 控制項統一：勾選框／下拉／輸入框／按鈕

> 建立：2026-08-10
> 目標：一套控制項語言 —— 同一組高度、圓角、邊框、focus。

## 盤點

### 靜態（原始碼）

| 控制項 | 數量 |
|---|---|
| `<button>` | 271（**78 種 class 組合**，41 個無 class） |
| 文字類 `<input>` | 36（+6 個沒寫 type） |
| `<select>` | 23 |
| `<textarea>` | 13 |
| checkbox | 20 · radio 3 · range 2 |

CSS 規則數：button 58 · input 35 · textarea 17 · **select 5** · **checkbox 1**（且限定 `#set-pane`）。

**根因：沒有任何全域表單基底。** `input` / `select` / `textarea` 從未被當作元素選擇器設定樣式，
只有 `.field input[type=text]` 這類特定包裝。沒被包住的控制項＝瀏覽器原生外觀。

41 個無 class 的 button 查過了，是主題切換（`[data-theme-value]`）與頁籤（`[role=tab]`），
由父容器上樣式 —— 不是漏網，不需要補 class。

### 動態（實際渲染，設定頁一頁）

| 控制項 | 視覺種類 | 明細 |
|---|---|---|
| button | **18 種** | 高度 20 / 22.4 / 28px，圓角 4 / 6px 混用 |
| select | 3 種 | 高度 21 / 28 / 40px，`appearance: auto` |
| input | 2 種 | 38 / 40px |
| textarea | 4 種 | 字級混入 17px |
| checkbox | 1 種 | `appearance: auto` = 完全原生 |

`appearance: auto` 是關鍵：select 與 checkbox 走 macOS 原生繪製，
跟其他自繪控制項不可能一致 —— 這不是調參數能解決的，必須關掉原生外觀自己畫。

## 設計

三段高度，所有控制項共用：

| Token | 值 | 用於 |
|---|---|---|
| `--ctl-h-sm` | 26px | 密集工具列（`.btn-sm`） |
| `--ctl-h-md` | 32px | 一般按鈕（`.btn`） |
| `--ctl-h-lg` | 40px | 表單欄位（input / select / textarea 首行） |

一個圓角 `--radius-sm`、一個邊框 `--border`、一個 `--focus-ring`（三個主題各自定義）。

- `select`：`appearance: none` + 自繪箭頭（跟隨主題兩種顏色）。
- `checkbox` / `radio`：`appearance: none` 自繪，選中填 `--accent`。
- 高度值刻意貼近現況（28→32、38→40），把版面風險壓到最低。

## 步驟

- [x] 1. 尺寸 token
- [x] 2. 全域表單基底 + select 自繪箭頭
- [x] 3. checkbox / radio 自繪
- [x] 4. 按鈕高度收斂成兩段
- [x] 5. 覆蓋既有的 select 專屬規則（emp-card / domain-bar）
- [x] 6. 驗證：重量一次，種類數要下降；三個主題各看一次

## 結束摘要

完成。

**改動後（同一頁重量）**

| 控制項 | 前 | 後 |
|---|---|---|
| input 文字類 | 2 種（38/40px） | **1 種**（40px） |
| select | 3 種（21/28/40px）· `appearance: auto` | **2 種**（32/40px，刻意的兩段）· `appearance: none` |
| checkbox | 原生 `appearance: auto` | **自繪**，17px、選中填 accent |
| `.btn` 家族 | 高度散在 20/22.4/28 | **26 / 32 / 40**，家族內零異常 |
| 下拉沒有箭頭的 | — | **0 / 17** |

非 `.btn` 家族的按鈕（專案卡 64px、分類頁籤 39px、圖示鈕 20–28px）刻意不收斂 ——
它們是卡片、頁籤、圖示可點區，不是表單按鈕，壓成同一高度只會讓資訊層級消失。

**過程中製造又修掉的問題**
加上 `appearance: none` 之後，四個頁面各自抄的一份欄位樣式用 `background:` **簡寫**
把自繪箭頭洗成 none —— 原生箭頭沒了、自繪箭頭也沒了，下拉變成完全看不出可以展開，
比改之前更糟。是量 `backgroundImage` 才發現的，肉眼掃過截圖時沒看出來。

修法有兩層：重複的整段刪掉（settings / admin / agents / login / releases 各一份），
真正需要保留的兩條改成 `background-color`。全 App 現在 17/17 個下拉都有箭頭，
深色與淺色主題各有自己的箭頭顏色。
