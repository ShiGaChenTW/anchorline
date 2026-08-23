# Handoff — main session（Miles）交接

**交棒人：** Miles（main session）· 2026-08-23
**接棒人：** 你 —— 接手 main session，對 Scott 彙報
**上一份：** `plans/handoff-main-session__2026-08-21.md`（dashboard 簡寫欄位那一輪）

---

## 一句話現況

這一輪只做一件事：用 aidesigner 生了一份**全新的產品介紹網站候選稿** `landing-aid.html`，
跟既有手刻的 `landing.html` 並存比較，後者一行沒動。已在真實 Chrome 驗過渲染，
**等 Scott 目視評比**。`main` 與 origin 同步（0 commit 領先），兩個新檔都還沒 `git add`。

---

## 這一輪做了什麼

**沒有 commit。** 兩個未追蹤檔案：

| 檔案 | 內容 |
|---|---|
| `landing-aid.html` | 787 行，aidesigner ultradesign 生成 + 事實修正後的候選稿 |
| `plans/anchorline__2026-08-23-1200__aidesigner-landing.md` | 這一輪的追蹤文檔，細節都在裡面 |

### Scott 拍過板的兩個決定

1. **完全重新設計**（不是 enhance 沿用 `landing.html` 的視覺）
2. **產物落在新檔**，`landing.html` 不覆蓋，兩份並排比較後再決定

### 落檔時修掉的四處事實錯誤

aidesigner 生的內容有四處是編的。**接手時要知道這件事**——它會編路徑、編版本號、
編錨點格式，之後任何一輪 refine 回來都要重新對一次 repo：

| 生成的 | 實際 | 查證來源 |
|---|---|---|
| `anc:t=20260518000123` | 8 碼，如 `anc:t=058W9SNK` | `grep -rhoE 'anc:t=[A-Za-z0-9]+' plans/` |
| `.anchorline/gates/0001.json` 等七個路徑 | 只有 `.anchorline/log/2026-08.jsonl`，按月分片 | `docs/DATA.md` |
| `v0.1.0` + 三個死連結 `#` | v1.3.0，連結指向 GitHub Releases | `package.json` |
| 缺「怎麼讓 agent 跑更多 vs 怎麼證明被治理過」對比區塊 | 手動補上 | `README.md` |

另外把 `document.write` 產治理鏈那段改成靜態 HTML，nav 移除指向不存在區塊的 `#security`，
並修掉一個版面 bug（Hero 節點列虛線穿過標籤正中央，`top-1/2 -translate-y-1/2` → `top-6`）。

---

## 驗證做到哪

- 真實 Chrome（interceptor-test 隔離 profile，dev server `bunx vite --port 5199`）全頁渲染
  5262px、無水平捲動、Tailwind 有載入、底色 `rgb(22,20,18)` 正確
- 截圖 `~/Downloads/anchorline-landing-aid-v3.png`
- 已用 `open -a "Google Chrome" file://.../landing-aid.html` 開在 Scott 自己的瀏覽器

### 驗證時踩到的坑（會再踩，記著）

**頁面 32 個 `.reveal` 全靠 IntersectionObserver 進場，隱藏分頁裡它完全不觸發。**
第一張截圖整片空白，看起來像頁面壞了，其實是 Chrome 停掉隱藏分頁的 rendering lifecycle。
解法是注入 `style` 硬性關掉 `.reveal` 的 opacity/transform/transition 再截。
`Tools/VerifyViewport.ts` 是正解但這次起不來（`cdp context 'cdp:127-0-0-1' not found`，試兩次都是）。

**Phosphor 圖示在截圖裡看不到不是缺件**——DOM-render 會丟掉 CSS `::before` 生成內容。
用 `getComputedStyle` 量到實際佔 14–18px 才是證據。

---

## 下一步（依序）

1. **等 Scott 目視評比** `landing.html` vs `landing-aid.html`，拿到具體回饋
2. 回饋若需要重生 → 用**最後 1 個 aidesigner credit** 做 `refine_design`
   （`run_id` = `89fc6659-5072-4ab4-86e2-97852ade6d75`）
3. Scott 選定版本後才 `git add` + commit

---

## 還沒收的線頭

### 這一輪自己留的

- **aidesigner 只剩 1 credit**（限額 5、已用 4）。刻意沒花掉，留給 Scott 的具體回饋。
- **`landing-aid.html` 有兩個已知天花板，選它上線前一定要處理**：
  1. Tailwind 走 `cdn.tailwindcss.com` — 會拖 ~400KB JIT compiler 並造成 FOUC，
     要換建置期產出的 CSS；Phosphor 圖示同理，應改內嵌 SVG。
     檔案裡有 `ponytail:` 註解標了這件事。
  2. 捲動進場動畫**未驗證**（見上面的坑）。要驗得先修好 `VerifyViewport.ts`。
- `landing-aid.html` **沒有註冊進 `vite.config.ts`** 的 build input。只做比較不影響，
  真要上線得補。

### 更早就欠的（來自前幾輪，仍未清）

- **對話框遷移（`95e0497`）的實機 UAT** —— UAT 題目**尚未產出**，
  而對話框行為幾乎零自動化覆蓋。過了才能拆 `auth.ts` 的 workaround。
- **W3 的 11 題視覺驗收**
- **wave1+2 的 10 題**

---

## 冷啟動指令

```bash
cd ~/Documents/20_Projects/Project_Anchorline
git status --short                      # 應該只有兩個未追蹤檔案
bunx vite --port 5199 --strictPort      # 驗證用自己的埠，5173 可能是別的 checkout
open -a "Google Chrome" "file://$(pwd)/landing-aid.html"   # 直接看，不用起 server
```

細節看 `plans/anchorline__2026-08-23-1200__aidesigner-landing.md`。
