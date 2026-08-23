# Handoff — main session（Miles）交接

**交棒人：** Miles（main session）· 2026-08-23 下午
**接棒人：** 你 —— 接手 main session，對 Scott 彙報
**上一份：** `plans/handoff-main-session__2026-08-23.md`（aidesigner 產 landing 候選稿那一輪）

---

## ⚠️ 你的角色：PM。實作一律派子 agent

**Scott 2026-08-23 明確指示：新 session 當 PM，實作派子 agent。**

這條蓋過你想自己動手的直覺。你負責的是：拆任務、寫清楚 brief、驗收回來的東西、對 Scott 彙報。
**你不寫 code、不自己跑截圖迴圈。**

派工前先跑閘門：

```bash
bun ${LIFEOS_DIR}/TOOLS/AgentQuota.ts --json     # routable:false 的席位出局
```

| 這一輪的工作 | 派給誰 | 為什麼 |
|---|---|---|
| 補拍四張 App 畫面（要跑 interceptor 迴圈、反覆試錯） | **Engineer** | 需要完整 repo 脈絡＋長迴圈試錯，正好放進獨立 context window，別髒了你這條 |
| Section 5 版面改版（HTML/Tailwind） | **Engineer** 或 **Bellows** | 單檔改動；要開分支逐步收斂就給 Bellows |
| 第一屏迴圈影片（錄製＋ffmpeg 編碼） | **Engineer** | 與截圖同一套工具鏈，最好跟上一項同一個 agent 接著做 |
| 改完的整體審查 | **Cato** | 審查者不得是實作者。codex 池專供審查，一定有額度 |

**派 Engineer 之前，把下面「抓 App 截圖的完整作法」整段貼進 brief。** 那些坑我踩過一輪了，
不貼過去它會原地再踩一次，每一個都是十幾個 tool call 的代價。

**Brief 寫理想狀態，不要寫步驟。** 講清楚「四張圖長什麼樣才算過」「證據要什麼」，
把工具交出去，讓它自己找路——除了下面那些「已驗證的地雷」，那些是必須照抄的。

---

## 一句話現況

Landing 候選稿 `landing-aid.html` 的**第一屏已經換成真實 App 截圖**，而且用的是
**測試版的示範資料**（Scott 要求畫面不得出現他的真實專案）。
剩下四張畫面沒拍、Section 5 版面沒改、第一屏影片沒錄。
`main` 與 origin 同步，**全部東西都還沒 `git add`**。

---

## Scott 拍過板的決定（別重新問）

1. **完全重新設計**，不沿用 `landing.html` 的視覺；兩份並存比較後再選
2. 產物落在 `landing-aid.html`，`landing.html` 一行都不動
3. **畫面不得出現真實專案名稱與內容** → 一律用 `Anchorline Test.app` 的示範資料拍
4. 第一屏要「簡單的 app 實際操作影片或動畫」→ 方向是**真的錄一段螢幕**塞
   `<video autoplay muted loop playsinline>`，不是手刻 CSS 假動畫

---

## 這一輪做了什麼

**沒有 commit。** 未追蹤檔案：

| 檔案 | 內容 |
|---|---|
| `landing-aid.html` | 787 行 → Hero 的四節點虛線鏈換成真截圖 |
| `landing-assets/screen-overview.webp` | 1280×848、62KB，測試版示範資料的「專案總覽」 |
| `plans/anchorline__2026-08-23-1200__aidesigner-landing.md` | 追蹤文檔，細節都在裡面 |
| `plans/handoff-main-session__2026-08-23.md` | 上一份交接 |

### 盤點結論：兩份 landing 原本一張真圖都沒有

`grep -nE '<img|<video' landing.html landing-aid.html` 全空，視覺 100% 是 CSS 手畫的。
會用到 App 截圖的只有三處：

| 位置 | 現況 | 判定 |
|---|---|---|
| **Hero「Anchor Visual Motif」** | ✅ 已換成真截圖 | 概念 Section 3 已經完整講一次，第一屏該給證據 |
| **Section 5「主要畫面（五個核心視圖）」** | 5 欄 × `h-32` CSS wireframe | **要先改版面**。128px 高塞真截圖只會糊成一團，五格爛縮圖比五張乾淨 wireframe 更糟 |
| Section 3 治理鏈 / Section 4 agent family | 概念圖 | 維持，本來就不該是截圖 |

### Hero 的兩個處理

- **裁掉 App 自帶標題列**（上緣 32px）—— 「Anchorline Test — 測試版（含示範資料）」字樣在裡面，
  改由 `<figure>` 自己畫一條中性視窗列。不改 source、不假造產品名。
- **不要畫兩層視窗外框**。第一版我在自帶標題列上又加一層假的，出現兩排紅綠燈。
  現在的規則是：截圖裁掉標題列 + 網頁畫一條 → 剛好一條。

驗證：real Chrome `eval` → `complete:true / natural 1280x848 / 無水平捲動 / docH 5878`，
Hero 區塊截圖目視確認。

---

## 抓 App 截圖的完整作法（派工時整段貼給 agent）

### 環境

```bash
# 測試版已裝好，示範資料是 8 個泛用 SaaS 專案，跟 Scott 的真實資料完全隔離
/Applications/Anchorline\ Test.app          # bundle id dev.anchorline.app.test
open -a "Anchorline Test"
# 重建：bun run app:install --test          （Rust 首次編譯約 1m30s，全程約 2m）
```

視窗固定 1280×880 @ (640,140)。示範帳號在登入頁已預填，密碼 `demo`，按「進入工作區」。

### 五條已驗證的規則

1. **導航只能用 `interceptor macos click <ref> --app "Anchorline Test"`（AX press）。**
   `macos click X,Y` 座標點擊**完全不生效**，試過視窗相對與螢幕絕對兩種座標系都不行。

2. **`eN` ref 每換一頁就失效，而且同一個編號在下一頁是完全不同的按鈕。**
   ⚠️ 我就是手動點了一個過期的 `e8`，結果按到專案清單頁的「隱藏範例文件」——
   那顆**不是 filter，是把 sample 專案從 state 移掉**（`src/data/store.ts` 2767–2801），
   11 個示範專案當場消失，我還以為資料庫壞了。
   → **每次都重讀 AX tree、用 label 重新解析 ref。絕對不要手動打 `eN`。**

3. **`aria-modal` 會把兄弟節點整個從 AX tree 藏掉。** 首次啟動有兩層覆蓋層會擋住側欄：
   問候視窗（按鈕 `關閉`）與新手導覽（`略過導覽` / `知道了`）。
   讀不到側欄時第一個假設是「有東西蓋著」，不是「AX 沒暴露 webview」。
   ⚠️ label 比對要**完整比對**：`關閉` 用前綴比對會誤中「關閉設定」。

4. **`macos screenshot --app` 在視窗被 TCC 對話框卡住時會回舊影格**——hash 一模一樣、
   畫面是幾分鐘前的，不報錯。正常情況下它是新鮮的，而且**不需要 focus**，
   不會去搶 Scott 的桌面。
   備援是 `--mode display --target-max-long-edge 6000` 全螢幕拍，再依
   `macos windows` 的 frame ×2（Retina）用 magick 裁 —— 但這條**要求視窗沒被遮住**，
   會拍到 Scott 前景的視窗，只在確知它在最上層時用。

5. **要重新 seed 示範資料**（被規則 2 那個開關刪掉時）：
   ```bash
   pkill -f "/Applications/Anchorline Test.app"; sleep 6      # 先等 5 秒以上
   rm -rf ~/Library/{WebKit,Application\ Support,Caches}/dev.anchorline.app.test
   open -a "Anchorline Test"
   ```
   ⚠️ **一定要先 kill 再等**，否則 WebKit 會把記憶體裡的舊狀態寫回去，刪了等於沒刪。
   三個目錄都要刪。

### 可以直接接手的腳本

`/private/tmp/claude-501/-Users-scottchen-Documents-20-Projects-Project-Anchorline/f29ddcd6-6a75-4287-97fe-4354c79245c6/scratchpad/walk.py`
—— 帶重試的導航＋截圖，已經處理掉覆蓋層與 ref 過期。
**scratchpad 是 session 專屬的，新 session 進不去。**
派工時把上面五條規則寫進 brief，讓 agent 自己重寫一份即可，那支腳本本身沒什麼好留戀的。

---

## 下一步（依序，全部派子 agent）

### 1. 補拍四張畫面 —— **卡住的地方在這裡**

要的是：**編輯台、審閱、計劃追蹤、Agents**。

**目前卡點：總覽頁焦點卡上的 CTA「打開這個專案 →」不出現在 AX tree 裡**，
所以進不去專案脈絡，而編輯台／計劃追蹤都在專案脈絡的側欄裡
（進去之後側欄會變成 `工作台-PRD / PRD 範本 / 審閱佇列 / 計劃追蹤 / 偏好設定`）。

兩個還沒試過的方向：
- 等頁面 render 完再讀 tree（目前是 click 後 sleep 4 秒，可能不夠）
- 改從側欄「專案 11」清單直接點專案進去，繞過焦點卡

⚠️ 另外注意：**專案清單頁在示範資料下顯示「還沒有任何專案」**，但總覽頁同時顯示 11 個。
沒查出原因。這頁不是 landing 需要的畫面，不用為它停下來，但別把它當成資料壞掉的證據。

### 2. Section 5 改版面

現在是 `md:grid-cols-3 lg:grid-cols-5` + `h-32`。真截圖要看得清楚，
建議改成大圖 + 縮圖切換，或 2–3 欄的大格子。**這是設計決定，改之前先跟 Scott 確認方向。**

### 3. 第一屏迴圈影片

`<figure>` 已經留好位置，原地換成
`<video autoplay muted loop playsinline poster="landing-assets/screen-overview.webp">` 即可，
版面不用動（`landing-aid.html` 裡有 `ponytail:` 註解標了這件事）。

內容建議：一個真實動作的閉環，例如「勾選 plans 的 checkbox → 治理鏈更新 → gate 轉綠」，
6–10 秒。錄製用 `interceptor macos capture start/frame/stop` 取 frames，
`ffmpeg` 編 h.264 mp4（`/opt/homebrew/bin/ffmpeg` 有）。目標 1–2MB。

### 4. Scott 目視評比 `landing.html` vs `landing-aid.html`，選定版本後才 commit

---

## 還沒收的線頭

### landing-aid.html 自己的兩個天花板（選它上線前必處理）

1. **Tailwind 走 `cdn.tailwindcss.com`** —— 會拖 ~400KB JIT compiler 並造成 FOUC，
   要換建置期產出的 CSS；Phosphor 圖示同理，應改內嵌 SVG。檔案裡有 `ponytail:` 註解標了。
2. **捲動進場動畫未驗證**。頁面 32 個 `.reveal` 全靠 IntersectionObserver，
   **隱藏分頁裡完全不觸發**——第一張截圖整片空白會讓人以為頁面壞了。
   截圖前要注入 style 硬性關掉 `.reveal` 的 opacity/transform/transition。
   正解是 `Tools/VerifyViewport.ts`，但 2026-08-23 起不來
   （`cdp context 'cdp:127-0-0-1' not found`，試兩次都是）。

`landing-aid.html` **沒有註冊進 `vite.config.ts`** 的 build input。只做比較不影響，真要上線得補。

### aidesigner

只剩 **1 個 credit**（限額 5、已用 4），`run_id` = `89fc6659-5072-4ab4-86e2-97852ade6d75`。
刻意留著給 Scott 的具體回饋。⚠️ **aidesigner 會編事實**——路徑、版本號、錨點格式都編過，
任何一輪 refine 回來都要重對一次 repo。

### 更早就欠的（前幾輪留下，仍未清）

- **對話框遷移（`95e0497`）的實機 UAT** —— UAT 題目**尚未產出**，
  而對話框行為幾乎零自動化覆蓋。過了才能拆 `auth.ts` 的 workaround。
- **W3 的 11 題視覺驗收**
- **wave1+2 的 10 題**

---

## 冷啟動指令

```bash
cd ~/Documents/20_Projects/Project_Anchorline
git status --short                      # 應該只有四個未追蹤項目

# 看目前的候選稿（不用起 server）
open -a "Google Chrome" "file://$(pwd)/landing-aid.html"

# 要改要驗就起自己的埠，5173 通常是別的 checkout
bunx vite --port 5199 --strictPort

# 拍圖用的測試版
open -a "Anchorline Test"
```

細節看 `plans/anchorline__2026-08-23-1200__aidesigner-landing.md`。
