# 產品介紹網站 — `landing.html`

> 建立：2026-08-09
> 目標：高度專業、有真實互動、去 AI 味的產品介紹頁。單一自足檔案，不依賴 `shared.css`（但沿用其 token 值）。

## 設計基準

- **視覺骨幹＝錨線本身**：一條貫穿全頁的垂直線，治理鏈的站點掛在上面。不是裝飾，是產品隱喻。
- **三套主題**：`warp` / `kami` / `github`——只做 `shared.css` 裡真的存在的三套（`claude` 在 brand-spec 有列但未實作）。key 沿用 `anchorline:theme`。
- **去 AI 味的具體操作**：不用紫藍漸層 hero、不用三張等寬圖示卡、不寫「提升你的工作流」這種句子。改用專案自己的文字與真實數字。
- **不做的事也要寫上去**：`明確不做` 表格直接上頁。願意公開拒絕清單的產品頁不像 AI 寫的。

## 已驗證數字（勿用未查證的）

| 事實 | 值 | 查法 |
|---|---|---|
| `src/lib` 模組 | 57 | `ls src/lib/*.ts \| wc -l` |
| 其中不碰 native/tauri | 47 | `grep -LE "from ['\"].*native\|@tauri-apps" src/lib/*.ts` |
| 測試檔 | 28 | `ls tests/*.test.ts \| wc -l` |
| Rust 殼 | 1393 行 · 12 action | `wc -l src-tauri/src/*.rs` |
| Tauri 權限 | 2（dialog:allow-open, opener:allow-open-path） | `docs/SECURITY.md` §1 |

> README 寫的「47 個模組」已過時（現為 57）；47 是「不碰 native 的數量」。頁面上用後者。

## 章節

- [x] 1. Chrome：sticky nav + 主題切換
- [x] 2. Hero：join key 問題 + 錨點 token
- [x] 3. 問題：四份資料對不起來 → 收斂到一條線（scroll 驅動）
- [x] 4. 治理鏈：七站，可點，右側顯示該站寫進稽核軌跡的事件
- [x] 5. Q1–Q4：Q3/Q4 是差異化
- [x] 6. `authorAgentFamily`：replay 標出違規（市面上沒有的機制）
- [x] 7. 安全界線：三條 + 永不執行清單
- [x] 8. 明確不做
- [x] 9. 安裝：複製按鈕 + 需求表 + 未簽章警告
- [x] 10. Footer

## 互動清單（全部要有真實行為，非動畫裝飾）

- [x] 主題切換 3 套，寫 `localStorage['anchorline:theme']`
- [x] 錨線 SVG 隨捲動描繪（`stroke-dashoffset`）
- [x] IntersectionObserver 進場（`prefers-reduced-motion` 時停用）
- [x] 治理鏈站點：滑鼠／鍵盤可選，切換右側事件面板
- [x] 安裝指令一鍵複製
- [x] 問題區段四張卡 scroll-linked 收斂

## 驗證

- [x] Pencil 整合瀏覽器實際載入 `file://` 並截圖
- [x] 三套主題各截一張
- [x] 窄視窗（430px）無水平溢出

## 結束摘要

產出 `landing.html`（單一檔案，只外連 Google Fonts）。所有文案取自
`README.md` / `SCOPE.md` / `docs/SECURITY.md` / `docs/DATA.md`，數字為當場查證。
三套主題與 App 的 token 值逐一對齊。

### 驗證過程中改掉的三件事

1. **整段淡入會讓內容消失。** 原本每個區塊都是 `opacity:0` 等 IntersectionObserver
   打開，結果 §03–§07 在截圖裡整片空白。改成：**文字一律先在**，只有錨線的連接線
   與違規行的底色掃動。內容的可見性不該押在 observer 有沒有觸發上——順帶一提，
   「每段都淡入」本身就是 AI 產生的網站最明顯的特徵之一。
2. **窄視窗橫向溢出 308px。** `.chrome-in` 是固定高度的 flex 且不換行，400px 時
   nav + 主題切換 + GitHub 擠不下就撐破版面。改為 ≤900px 收起章節導覽、≤560px
   收起文字標籤、並允許換行。實測 370px `sw=370`、1410px `sw=1410`，皆無溢出。
3. **主題偏好在載入時就被寫回 localStorage。** 使用者沒選過也會被釘上 `warp`，
   之後改預設對所有回訪者永遠不生效。改成只有真的按了切換才寫入。

### 已知落差

- `brand-spec.md` 列了第四套主題 `claude`（Terracotta），但 `shared.css` 裡沒有
  對應的 `data-theme="claude"` 定義。頁面只做實際存在的三套。要補的話得先在
  `shared.css` 補 token。
- `README.md` 寫「`src/lib` 47 個模組」已過時，實際 57 個；47 是「不碰 native
  的數量」。頁面上用後者，README 建議另外修。
