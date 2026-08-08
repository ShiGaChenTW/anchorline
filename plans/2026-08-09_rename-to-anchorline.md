# 改名 Runbook — SpecForge → Anchorline（純英文名）

> 日期：2026-08-09 · 本輪只出評估與步驟，不改任何檔案
> 決定：產品名 **Anchorline**，不設中文名。UI 內文維持繁體中文。

---

## 一、時機判斷：現在是最便宜的一刻，而且窗口正在關

| 事實 | 查核方式 | 含意 |
|---|---|---|
| repo 仍是 **PRIVATE** | `gh repo view --json visibility` | 沒有 star / fork / 外部引用要維護 |
| **零 GitHub Release** | `gh release list` → 空 | 沒有已發佈的 DMG 檔名要相容 |
| `.specforge/` 全機**只有 1 個** | `fd -H -t d '^\.specforge$' ~` | 沒有使用者資料要遷移 |
| `sf:t=` 錨點全機**只有 68 個 / 5 檔** | `rg -l 'sf:t=' ~` | join key 改名是 sed，不是資料遷移 |
| **W3 開源化剛落地**（MIT + CONTRIBUTING + SECURITY） | `git show 684031c` | 一旦推出去，改名成本從一天變成永久 redirect 債 |

**結論：改名要做就現在做，在 MIT 專案公開之前。**

---

## 二、必須修正的一個前提（推翻我自己上一輪的判斷）

上一輪我主張「`sf:` 錨點是 wire format，凍結不動，改名只准動顯示層」。

**原則對，前提錯。** 那條原則的成立條件是「錨點已散落在使用者的 markdown 裡」。實測結果是 **68 個錨點、5 個檔案，全部在這個 repo 內**（外加一份 PAI skill 模板）。

→ 所以 **`sf:` → `anc:` 應該一起改，因為這是它唯一免費的時刻**。parser regex 留一版雙讀當保險：

```ts
// ponytail: 雙讀一版，下個版本拔掉 sf
const ANCHOR_RE = /(?:sf|anc):t=([A-Za-z0-9]+)/;
```

`sf` 原本是 SpecForge 的縮寫。不改的話，它會變成一個公開 MIT 專案裡沒有指涉對象的孤兒縮寫，每個 contributor 都要問一次。

---

## 三、範圍盤點（實測數字，已排除 node_modules / dist / vendor）

| 區域 | 出現次數 | 檔數 | 動作 |
|---|---|---|---|
| `src/` | 77 | 34 | 改（多為 localStorage key） |
| `mac-app-build/` | 33 | 3 | 改（舊 Swift 殼） |
| `src-tauri/` | 23 | 6 | 改（**含安全謂詞與契約測試**） |
| 根目錄 `*.html` | 24 | 14 | 改（`<title>` + theme bootstrap） |
| `docs/` | 15 | 3 | **重寫**（不只換字串） |
| 根目錄 `*.md` | 9 | 4 | **重寫** |
| `scripts/` `.github/` `*.json` `*.js` `*.css` | 8 | 5 | 改 |
| **`plans/`** | **70** | **9** | **不動 — 歷史紀錄** |
| `artifacts/` `dist/` | — | — | **不動 — 產出物** |

**活的目標 ≈ 179 處 / 64 檔。** logos/ 是純圖形無文字，**不需要重繪**。

---

## 四、分層工作清單

### P0 — 身分識別碼（1.5–2 hr，可獨立 commit、可獨立回滾）

| 檔案 | 改什麼 |
|---|---|
| `src-tauri/tauri.conf.json` | `productName: "PRD開發監控台"` → `"Anchorline"`；`identifier` → `dev.anchorline.app`；`window.title` |
| `src-tauri/Cargo.toml` | `name = "specforge"` → `anchorline`；`specforge_lib` → `anchorline_lib`；description |
| `src-tauri/src/paths.rs` | `.specforge` → `.anchorline`（8 處，**含 5 個測試斷言**） |
| `src-tauri/src/commands.rs` | 錯誤訊息字串（1 處） |
| `mac-app-build/Info.plist` | bundle id |
| `mac-app-build/build-dmg.sh` | bundle id ×2、app 名 ×2、DMG 檔名 |
| `mac-app-build/main.swift` | `__SPECFORGE_NATIVE__`、`messageHandlers.specforge`、`.specforge/handoff.json` |
| `package.json` | `name: pm-spec-scvb` → `anchorline`；`signal` script 路徑 |
| `scripts/specforge-active.sh` | `git mv` → `anchorline-active.sh` |
| 磁碟 `.specforge/` | `git mv .specforge .anchorline` |

### P0.5 — join key（30 min，需你點頭）

`sf:` → `anc:`：`src/lib/plan-parser.ts`、`src/lib/openspec-import.ts`、5 個 `.md` 的 68 個錨點。regex 雙讀一版。

### P1 — 對外文件（2–3 hr，**這是唯一需要重寫而非取代字串的部分**）

`README.md` · `docs/BRIDGE.md` · `docs/DATA.md` · `docs/SECURITY.md` · `CONTRIBUTING.md` · `SCOPE.md` · `brand-spec.md` · `THIRD_PARTY.md`

W3 剛把這些寫成對外的開源說明。名字換了，第一段的定位語氣要跟著換 —— 從「SpecForge PRD 工作台」變成「Anchorline，一把 join key」。README 首段加一行沿革：*Formerly SpecForge / PM-SPEC+SCVB.*

### P1.5 — UI 字串（2 hr）

14 個 `.html` 的 `<title>` + **那段 theme bootstrap inline script（16 份複製貼上）**；`src/` 34 檔的顯示字串。

### P2 — localStorage 前綴（1 hr，可選）

26 個 `specforge:*` key → `anchorline:*`，一次性遷移約 15 行（`store.ts` 的 v5→v6 `LEGACY_KEY` 已有前例）。**價值最低**：使用者看不到，只有開啟 DevTools 的 contributor 會看到。

### P2 — 外部（30 min）

GitHub repo rename（自動 redirect）· `git remote set-url` · Orca worktree 目錄名。

---

## 五、工作量

| 層 | 時數 | 是否阻擋開源 |
|---|---|---|
| P0 識別碼 | 1.5–2 | ✅ 是 |
| P0.5 join key | 0.5 | ✅ 是 |
| P1 文件 | 2–3 | ✅ 是 |
| P1.5 UI 字串 | 2 | ⬜ 否 |
| P2 localStorage | 1 | ⬜ 否 |
| P2 外部 | 0.5 | ⬜ 否 |
| **合計** | **7.5–9 hr（約一個工作天）** | 阻擋開源的只有前三層 = **4–5.5 hr** |

---

## 六、四個風險點

1. **`paths.rs` 的安全謂詞** — `.specforge` 是 `append_allowed()` 的判定字串，且有契約測試。改字串必須同步改測試，否則**測試全綠、但保護的是一個不存在的目錄**。這是全案唯一一個「改錯不會壞、安全模型靜默失效」的地方。**先改測試，看它紅，再改實作。**
2. **theme bootstrap inline script 是 16 份複製貼上** — 漏掉一個，那一頁載入時會閃一次白底。改完用 `rg -c 'specforge:theme' *.html` 驗證歸零。
3. **bundle id 換掉** → 你電腦上那個 `PRD開發監控台 測試.app` 會變成孤兒，要手動刪；它的 UserDefaults 不會跟著搬。
4. **Cargo crate rename** → `Cargo.lock` 重算、CI cache 失效、產物 binary 名改變（`release.yml` 若有寫死路徑要一起改）。第一次 CI 會慢。

---

## 七、建議順序（每步都是一個可回滾的 commit）

```
1. 先寫失敗的測試：paths.rs 斷言改成 .anchorline（紅）
2. P0 識別碼 + 讓測試變綠            → commit「改名：身分識別碼」
3. P0.5 sf: → anc:（regex 雙讀）      → commit「改名：join key」
4. bun run build + cargo test + 實機裝一次驗證
5. P1 文件重寫                        → commit「改名：對外文件」
6. P1.5 UI 字串                       → commit「改名：介面字串」
7. GitHub repo rename + remote 更新
8. （之後）P2 localStorage 遷移
```

---

## 八、需要你拍板的三件事

| # | 決定 | 我的建議 |
|---|---|---|
| 1 | bundle id 格式 | `dev.anchorline.app`（`anchorline.dev` 實測可註冊，`.app/.com` 已被占） |
| 2 | `sf:` → `anc:` 要不要一起改 | **要**。68 個錨點、5 個檔，現在免費，之後不會 |
| 3 | 中文產品名退場的連鎖 | 現行 `productName` 是 **`PRD開發監控台`**。改成 Anchorline 後，Dock／選單列／DMG／視窗標題全變英文，**UI 內文維持繁中**。確認這是你要的 |
