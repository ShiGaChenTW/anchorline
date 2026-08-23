# aidesigner 重新設計產品介紹網站

> 建立：2026-08-23 · 狀態：進行中

## 目標

用 aidesigner（ultradesign）為 Anchorline 生一份全新的產品介紹網站，
落在 `landing-aid.html`，與既有手刻的 `landing.html` 並排比較，不覆蓋。

## 約束

**aidesigner 只剩 2 credits**（限額 5、已用 3）。預算配置：
1 次 `generate_design`（ultradesign）+ 1 次 `refine_design` 備用。
沒有試錯空間 —— 方向先跟 Scott 確認過再開槍。

## 決策

- **方向**：完全重新設計（不用 enhance 沿用現有頁面）— Scott 拍板 2026-08-23
- **產物位置**：新檔 `landing-aid.html`，`landing.html` 不動 — Scott 拍板
- **不建 brand kit**：會吃掉 1 credit，refine 就沒餘裕了

## 餵給 aidesigner 的內容素材

來源 README.md + docs/SCOPE.md，九個區塊：Hero（join key 洞察＋錨點視覺）／
四個問題（Q3 Q4 加重）／七關治理鏈／authorAgentFamily／五個主要畫面／
一次只指一個／工程證據（47 模組 40 純函式、換殼 39 檔不動）／安裝／Footer。

視覺：warp 暖暗終端調（bg #161412、accent #f59e0b），
形狀語言取自 App icon 的三層堆疊層片。

## 步驟

- [x] 讀 README / SCOPE / landing.html / logo 取素材
- [x] 確認 credit 餘額與方向（AskUserQuestion）
- [x] 送出 generate_design（ultradesign, desktop）
- [x] 收回 HTML，寫入 `landing-aid.html`（787 行）
- [x] Interceptor 開真實 Chrome 驗證渲染（截圖）
- [x] 決定不用最後 1 credit —— 留給 Scott 看過後的具體回饋
- [ ] 交給 Scott 並排比較 landing.html vs landing-aid.html

## 結束摘要

**產物**：`landing-aid.html`（787 行），與 `landing.html` 並存，後者一行未動。

### 落檔時修掉的四處事實錯誤

aidesigner 生的內容有四個地方是編的，落檔時對著 repo 修掉：

| 生成的 | 實際 | 來源 |
|---|---|---|
| `anc:t=20260518000123` | 8 碼，如 `anc:t=058W9SNK` | grep plans/ |
| `.anchorline/gates/0001.json` 等七個路徑 | 只有 `.anchorline/log/2026-08.jsonl`，按月分片 | docs/DATA.md |
| `v0.1.0` + 三個死連結 `#` | v1.3.0，連結指向 GitHub Releases | package.json |
| 缺少「怎麼讓 agent 跑更多 vs 怎麼證明被治理過」對比區塊 | 手動補上（prompt 有要求但沒生出來） | README |

另外把 `document.write` 產生治理鏈那段改成靜態 HTML，nav 移除指向不存在區塊的 `#security`。

### 驗證

- 真實 Chrome（interceptor-test 隔離 profile）渲染全頁，5262px，無水平捲動
- 修掉一個版面 bug：Hero 節點列的虛線穿過標籤正中央（`top-1/2` → `top-6`）
- 截圖 `~/Downloads/anchorline-landing-aid-v3.png`

### 兩個已知天花板

1. **Tailwind 走 CDN**（`cdn.tailwindcss.com`）。比較用沒問題，要上線得換建置期 CSS——CDN 版會拖 ~400KB JIT compiler 進來並造成 FOUC。Phosphor 圖示同理，應改內嵌 SVG。
2. **捲動進場動畫未驗證**。`.reveal` 靠 IntersectionObserver，隱藏分頁裡完全不觸發（實測 32 個 `.reveal` 有 0 個 active）。這輪是注入 style 強制展開來驗版面；動畫本身要 `VerifyViewport.ts`，而它這次起不來（CDP context 缺失，兩次）。

### credit

用掉 1（ultradesign 生成），**剩 1**。沒有拿去 refine——留給 Scott 看過之後的具體回饋，那比我猜方向值錢。

---

## 2026-08-23 下午 — 真實 App 截圖接進 landing-aid.html

**起點**：Scott 問「網頁哪些畫面會用到 app 截圖，直接調整」＋「第一屏能不能放實際操作影片或動畫」。

### 盤點結果：兩份 landing 都是零張真圖

`grep -nE '<img|<video' landing.html landing-aid.html` 全空。整頁視覺都是 CSS 手畫的抽象塊。
會用到截圖的位置只有三處：

| 位置 | 現況 | 判定 |
|---|---|---|
| Section 1 Hero「Anchor Visual Motif」 | 四節點虛線鏈（概念圖） | **換成真截圖** — 概念在 Section 3 已經講一次，第一屏該給證據 |
| Section 5「主要畫面（五個核心視圖）」 | 5 欄 × `h-32` CSS wireframe | **要改版面才放得下真圖**。128px 高塞真截圖只會糊成一團，五格縮圖比五張乾淨 wireframe 更糟 |
| Section 3 治理鏈 / Section 4 agent family | 概念圖 | 維持，本來就不該是截圖 |

### 已完成

- `landing-assets/screen-overview.webp`（1280×880，58KB）— 真實 App 專案總覽
- Hero 的四節點鏈改成這張圖；`anc:t=058W9SNK` 標題與說明留著當前導
- 卡片 `max-w-4xl` → `max-w-5xl`，圖用 `<figure>` 包
- **不畫假視窗外框**：截圖自帶 macOS 標題列，再畫一層會出現兩排紅綠燈（第一版犯過，已修）

驗證：real Chrome `eval` 回報 `complete:true / natural 1280x880 / rendered 956x657 / 無水平捲動 / docH 5878`；
Hero 區塊截圖目視確認。

### 卡住的地方

**macOS 跳出 TCC 對話框「Anchorline.app 想要取用你『文件』檔案夾中的檔案」，擋住 App。**
系統權限對話框不代按 — 要 Scott 自己點。點完才能補拍編輯台／審閱／計劃追蹤／Agents。

### 抓 App 截圖的兩個坑（下次直接用）

1. **`macos click <ref>`（AX press）才會動；`macos click X,Y` 座標點擊完全不生效。**
   而且 ref 每換一頁就過期，要重讀 tree 用 label 重新解析 —— 見 `nav.py`。
2. **`macos screenshot --app` 在視窗被遮住時回**舊影格**，hash 一模一樣但畫面是幾分鐘前的。**
   改成 `--mode display --target-max-long-edge 6000` 全螢幕拍，再依 `macos windows` 的 frame ×2
   （Retina）用 magick 裁。這才是可信的路。
3. aria-modal 會把兄弟節點從 AX tree 藏掉 —— 開場問候視窗還在時，整個側欄讀不到，
   看起來像「AX 沒暴露 webview」，其實只是被 modal 蓋住。

### 下一步

1. Scott 點掉 TCC 對話框
2. 補拍 編輯台／審閱／計劃追蹤（＋Agents 若進得去）
3. Section 5 改版面（大圖 + 縮圖切換，不是 5 欄小格）
4. 第一屏影片：`<figure>` 已經留好位置，原地換 `<video autoplay muted loop playsinline poster>` 即可

---

## 補記 — 改用測試版示範資料（Scott 指示：畫面不得出現真實專案）

**做法**：`bun run app:install --test` 裝 `Anchorline Test.app`
（`dev.anchorline.app.test`，bundle id 與正式版不同 → 資料完全隔離），
用它內建的 8 個泛用 SaaS 示範專案拍圖。

`landing-assets/screen-overview.webp` 已整張換成示範資料版（1280×848，62KB），
**裁掉 App 自帶標題列**（上緣 32px，「測試版（含示範資料）」字樣在裡面），
改由 `<figure>` 畫一條中性視窗列。真實專案名一個都不在頁面上。

驗證：real Chrome `eval` → `complete:true / natural 1280x848 / 無水平捲動`；Hero 截圖目視。

### 這一輪踩到、下次會再踩的坑

1. **`showSamples` 是個會刪資料的開關。** 專案清單頁的「隱藏範例文件」按下去不是 filter，
   是把 sample 專案從 state 移掉（`store.ts` 2767–2801）。我用**過期的 ref** 誤按了它，
   11 個示範專案當場消失，還以為是資料被清掉。
   → **絕對不要手動點 `eN`**。ref 每次換頁就失效，同一個編號在下一頁是完全不同的按鈕。
   一律重讀 tree、用 label 重新解析（`walk.py` 的 `find()`）。
2. **測試版儲存要清乾淨才會重新 seed**：`~/Library/{WebKit,Application Support,Caches}/dev.anchorline.app.test`
   三個都要刪，而且**要先 kill App 等 5 秒**再刪，否則 WebKit 會把記憶體狀態寫回去。
3. **首次啟動有兩層覆蓋層**會擋住 AX tree（aria-modal 會把兄弟節點藏掉）：
   問候視窗（`關閉`）與新手導覽（`略過導覽` / `知道了`）。都要清掉側欄才讀得到。
4. `find("關閉")` 是**前綴比對**，會誤中「關閉設定」。要收斂成完整 label。

### 還沒拍到的畫面

編輯台／審閱／計劃追蹤／Agents。卡在**總覽頁的焦點卡 CTA「打開這個專案 →」沒出現在 AX tree**，
進不去專案脈絡。下次先解這題（可能要等頁面 render 完再讀，或改從側欄專案清單點進去）。
