# Anchorline — W3 收尾：換裝痛點、T9 既有 bug、W3-3 裁決

**建立時間：** 2026-08-15 09:21
**最後更新：** 2026-08-15 09:21
**狀態：** 進行中
**角色：** PM（main session）— 實作派子 agent 與 Grok

## 背景

PR #7 已併 main（`213f88d`），HEAD `53596f9`，工作區乾淨、0 unpushed。
Scott 的 10 題 UAT 仍全數「未測」——整條 v0.01.01 收官線卡在他手上。
本輪做的是**不依賴 Scott 的剩餘帳**，等他勾完 UAT 再接收官。

來源：`plans/handoff-main-session__2026-08-15.md` §下一版帳本

## 本輪範圍

| # | 項目 | 誰做 | 狀態 |
|---|---|---|---|
| A | W3-1 範圍裁決：一鍵換裝 script vs 完整 updater 通道 | Grok（第二眼） | ✅ 完成 → 見下 |
| B | `bun run app:install` — build＋換裝＋sha256 雙邊比對＋open 一鍵化 | 子 agent（Engineer） | 進行中（已追加 7 條） |
| C | T9 疑似既有 bug 根因：非 git 專案 dashboard「改採 vX.YY.ZZ」三路啟動皆無反應 | 子 agent（唯讀分析） | 進行中 |
| D | W3-3 011 願景欄位入 gate | 子 agent（Engineer） | ✅ Scott 裁決 **warn 級** → 進行中 |
| E | **W3-1b build id 顯示** — App 內顯示版本·commit·build 時間 | 子 agent（Forge） | ✅ Scott 核准 → 進行中 |
| F | **裸 `confirm`/`prompt`/`alert` 全遷移** — 本輪只做盤點排序 | 子 agent（唯讀） | 進行中 |

**不做**：Scott 的 UAT（他的）、v0.01.01 編列放行（等 UAT）、Grok C12/C13、CATO-05（緩辦帳）。

## PM 判斷（待 Grok 覆核）

W3-1 被判 P1 的**理由是「每次驗證要手動換裝」**（NEXT-VERSION-PLAN.md:42），
不是散佈——簽名那條自己就寫了「單機單人，場景還不存在」。
既然痛點是本機換裝，`bun run app:install`（約 15 行）就打中同一個痛，
完整 updater（minisign 金鑰＋release 端點＋CI）留到真的要散佈再做。
Grok 的工作是挑這個判斷的毛病，不是背書。

## 進度日誌

- 09:21 — 開工。確認 main 乾淨、UAT 十題全未測、package.json 無任何 install script（痛點確認為真）。
- 09:35 — **A 項結案：Grok 判定 (a) 支持降級，但打穿計劃書三處事實錯誤**（查 tauri v2 官方文件＋plugin 原始碼，非憑記憶）：
  ① **updater 簽章金鑰是強制的**，官方原文 "This cannot be disabled"；`plugins/updater/src/config.rs` 的 `pubkey` 欄位無 `serde(default)`，缺了直接反序列化失敗；`updater.rs:740` 的 `verify_signature` 無條件執行、無 feature flag 可繞。計劃書「未簽名也能自動更新」為誤。
  ② **updater 不吃 dmg**，它吃 `Anchorline.app.tar.gz`（`bundle_update_macos` 只打包 `.app`）。「未簽名 dmg 也能自動更新」是概念混淆。
  ③ **「更新後一次 xattr」在本機情境不成立**：實測 `/Applications/Anchorline.app` 只有 `com.apple.provenance`、無 `com.apple.quarantine`；updater 的 macOS 安裝路徑（`updater.rs:1279-1385`）全程沒碰 xattr／codesign。那句是**散佈情境**的知識，被寫進一個同份文件自稱「不存在」的場景——文件內部自我矛盾。
- 09:35 — **Grok 對本機情境的量化**：updater 讓每輪驗證從 4 步變 **9 步**（版號要三處手動遞增否則 `release.version > current_version` 為 false 什麼都不會發生、sig 內容每 build 都變要手貼 latest.json、release build 強制 https 故本機要開 `dangerousInsecureTransportProtocol` 並跑 localhost server、換裝後仍要手動重啟）。**對「手動換裝」這個痛點，updater 是負向的**——不是成本高的正解，是方向相反的解。
- 09:35 — **Grok 攻下我判斷的一半**：痛點原文有兩個成分「重複四次」＋「產生過一次假 bug 報告」。install script 只解第一個。假 bug 的機制是**跑著的 App 不是剛 build 的那個、而畫面上沒有任何東西會說**——實測 `/Applications` 版本與剛 build 的 Info.plist **都是 1.1.0**，兩個 build 之間零可見差異。忘了跑 script 跟忘了跑 cp 症狀一模一樣。故新開 **W3-1b：App 內顯示 build id**（`1.1.0 · 53596f9 · 08-15 08:50`），XS，價值高於整條 updater。
- 09:35 — **W3-1 原票作廢，拆三張**：`W3-1a` 一鍵換裝 script（P1/S）· `W3-1b` build 辨識（P1/XS）· `W3-1c` updater **綁** Apple 簽章（降 P3，觸發條件寫死「第一台非 Scott 本人的機器要安裝時」——兩者在唯一有意義的場景裡是耦合的，未簽名 app 被下載會帶 quarantine 被 Gatekeeper 擋，「updater 先行、簽名緩」的拆法在結構上就錯）。
- 09:35 — 我被指正的一筆：「1/20 成本」是憑空數字，無依據。改寫為可查核形式——**install script ≈ S；完整 updater ≥ M+，且引入一把不能遺失的長期金鑰**（後半句才是真成本，不是行數）。另：計劃書給 W3-1 標「量=M、切入點=tauri.conf.json bundle 段」本身就估錯對象——完整 updater 不可能只改一個 config 段，那個 M 其實是照 install script 的規模估的。
- 09:35 — **誤導源**：`vendor/markamd/AGENTS.md:19` 寫「Tauri updater artifacts are enabled in src-tauri/tauri.conf.json」——那是**被 vendor 進來的別的專案**的文件，Anchorline 自己的 conf 完全沒 updater 設定。任何 agent grep 到這行都可能得出「已經配好了」的錯誤結論，該加免責註記。
- 09:40 — 追加 7 條驗收條件給 B 項 agent：回滾式換裝（mv 備份→cp→驗→才刪，失敗 mv 回去，關掉「App 直接消失」這個 failure mode）、sha256 不符要 exit 1＋回滾而非 warn、`--test` 變體、不要碰 xattr（特別是 `xattr -cr`）、印 build 指紋、mtime 早於最後 commit 要警告、`open -a` 後 poll `pgrep` 確認真的起得來。

- 09:52 — **B 項第一輪回來（在 worktree `agent-a462943ca534a1cbd`，未 commit）**：`scripts/install-app.ts` + `tests/install-app.test.ts` + package.json 一行。tsc 綠、bun test **1154**（基準 1126，+28，零迴歸）。幾個比我要求更好的決定：目錄雜湊改「清單雜湊」（`<kind> <mode> <digest> <path>` 排序後合併再取 sha256——`find -exec shasum` 順序不可重現、會跟 symlink、且看不到權限位，掉執行位的壞 bundle 純內容雜湊會說「一致」）；關舊版用 `pgrep -f <安裝版執行檔完整路徑>` + SIGTERM→SIGKILL 而非 `osascript quit`（後者會跳自動化授權對話框，一個要人按確認的步驟就毀掉「一鍵」前提；比對完整路徑是為了不誤殺 `Anchorline Test.app` 的同名 `anchorline` 進程）；`verifyDigests` 擋空字串與非 64 位小寫 hex（雜湊算失敗回空字串時天真的 `a===b` 會判過）；`open` 帶完整路徑而非 `open -a Anchorline`（後者 LaunchServices 可能挑到 `target/` 底下那份，又驗到不是安裝版的東西）；複製用 `ditto`。
- 09:52 — **但 7 條追加沒進去**（agent 收工比訊息送達快）——關鍵的第 1 條「先 rmSync 再 ditto」正是要消滅的 failure mode。已打回同一個 worktree 補完，並要求**回滾路徑真的觸發過一次**（tmp 目標人為讓 sha256 失敗）再回報，不收推論。

- 10:05 — **C 項結案：T9 的「非 git」是紅鯡魚，根因是裸 `confirm()`。**
  - **失效點**：`src/pages/dashboard.ts:669-685` 的 `if (!confirm(…)) return;`。按鈕在 `dashboard.ts:163`（`policyHtml()` 的 loose 分支），handler 在 `bindIdentEditing()`（664-690）由 `renderStats()`（560）掛上。
  - **機制**：`src-tauri/src/js_dialogs.rs` 檔頭註解自己寫過——wry 0.55 的 WKWebView UI delegate 只實作檔案選擇面板，WebKit 對未實作的 delegate**當作使用者立刻取消**，所以正式版裡 `confirm()` 永遠回 false 且**零錯誤**。完全對得上「click 進來 → 立刻 return → 零 toast、零狀態變化、`[js-dialogs]` 零筆日誌」。
  - **四條假設全被反證排除**（不是猜的）：handler 沒掛上（非 git 路徑照樣走 `cardTags()`→`bindIdentEditing()`）、重複 id 綁錯（`d-policy-strict` 全 repo 僅渲染端與綁定端各一，`policyCard()` 與 `cardTags()` 互斥）、CSS 裁掉（`shared.css:8880` 的 `.d-top > .d-card{height:auto}` 特異度 0,2,0 壓過 9077 的 `overflow:hidden`，且非 git 分支內容遠短於卡片高度）、上層攔截（全域唯一 capture-phase listener 在 `rail-projects.ts:409`，只在側欄新增選單開啟時掛）。
  - **git 與非 git 共用同一個 `policyHtml()` 與同一個 handler**，故預測 git 專案上一樣壞——這是可證偽的預測，已寫進 UAT 第 9 題的步驟 4。
  - **確定是既有 bug**：`git blame` 指向 `a589d71`（2026-08-12「版號政策的切換入口」），之後一行未動；`git log -S 'd-policy-strict'` 只有這一筆；PR #7 動 dashboard.ts 的三個 commit（`4780653` 覆蓋率說明、`3729371` 待修卡、`71850be` supersede 全集解）逐一看過 diff，**都沒碰 `policyHtml`/`cardTags`/`bindIdentEditing`**。
  - **同族地雷（比這個 bug 本身更重要）**：全 repo 還有約 **23 處裸 `confirm()`／`prompt()`**（settings/signoff/admin/templates/openspec/write/dashboard）＋ **7 處 `window.confirm`**（editor/releases）共享同一個失效模式。`releases.ts:257-259` 已把「確認做在卡片裡、不壓在系統對話框上」寫成專案規矩，`dashboard.ts:670` 是漏網之魚。
  - **最小修法（未實作）**：照 `releases.ts:266-270` / `509-527` 的 `rl-arm`/`rl-arm-go` 兩段式，改 `policyHtml()`（+4 行 HTML）與 `bindIdentEditing()`（+10 行）＋3 行 CSS。**對 git 專案零影響**（同一段 HTML，改一次兩邊同時好）；`store.setVersionPolicy()`、`policyOf()`、持久化都不用動。
  - **順手發現的地雷**：`dashboard.ts:610-613` 的 cached 路徑 `if (cached){renderStats(cached);return;}` 在 `load()` 的 try/catch（615-630）**之外**——`renderStats` 拋例外會讓畫面停在已渲染未綁定的狀態，且是靜默 unhandled rejection。目前無證據被觸發，值得順手包進 try。
  - **誠實邊界**：靜態只能確定「JS 這側渲染與綁定都對，失效必在 handler 第一行的 confirm」，定不了當時那個 dev binary 裡 `confirm()` 為何回 false（執行期 delegate 狀態）。另外**「AX press 也沒反應」「鍵盤也沒反應」不構成獨立證據**——追蹤文檔 02:30 條目③自己記過 WKWebView 對 AX value-set 與 postToPid 鍵擊多數不理，三路實際上只有滑鼠那路是有效訊號。
- 10:05 — 據此改寫 UAT 第 9 題：加上「再測一個 git 專案」的步驟 4，並把三種結果組合各自的判讀寫進預期。一次實測就能定案，不用來回。

- 10:20 — **Scott 三項裁決全數照建議**：W3-3 走 **warn 級**（理由：被例行略過的 block 會教人忽略所有 gate，代價大於漏填 vision）；W3-1b **做**；裸 confirm 遷移票 **開**。
- 10:20 — **但 F 項本輪只做盤點，不動手**。理由：已確認的實例 `dashboard.ts:669-685` 正是 Scott UAT 第 9 題的受測物，先修掉他的考卷就作廢。盤點產出可直接照做的工作清單（逐筆 `檔案:行號`＋使用者眼中是什麼＋P0/P1/P2＋遷移工法＋工作量＋出貨批次），T9 結果一到就能開工。
- 10:20 — D／E 兩項派進**各自的 worktree**（不是主 checkout）。理由：03:20 那條付過學費的規則——多個 agent 同時在同一棵樹上會互相清掉未 commit 的變更。

- 10:32 — **D 項（W3-3）完成**，在 worktree `agent-a5dd8b5008390ea9e`，未 commit。只動兩檔（`prd-gates.ts` +35、`tests/prd-gates.test.ts` +41），`gate-rules.ts` 一字未動、`summary-incomplete` 原封不動。
  - **設計：兩條 warn 短路串接，不是一條**。`summary-vision-thin`（`minLength` n=60）＋`summary-vision-outline`（`match` `^\s*(?:[-*•]|\d+[.)])`，flags=m）。理由：一條 minLength 過了門檻就閉嘴，等於**用字數當願景品質的代理指標**；hint 要的是兩件不同的事（敘事給人讀動機、條列給人與機器逐項核對），兩件事就兩條規則。**口號不論寫多長都逃不掉**——這是串起來才有的性質，不是挑對門檻。
  - **唯一需要判斷的取捨**：outline 用 `match` 而非既有的 `bullets` predicate——`bullets` 找不到列點符號時會退回用 `;；換行` 切分（`gate-rules.ts:125`），所以**一段分三段的純敘事會被算成三條而過關**，正好是這條規則要抓的那一種。`bullets` 會系統性漏掉它的主要目標。
  - **已知 false positive（agent 主動認的）**：行內列舉（「主要功能：TOTP、WebAuthn、復原碼」）會吃到一則 outline warn。留著，因為 detail 明講了怎麼清除（行首加 `-`／`•`／`1.`）。若實際出現得比預期頻繁，正解是放寬 `LIST_ITEM_RE`，**不是換回 `bullets`**。
  - **不發 pass**：pass 會進 score 分母，改 score 是獨立決策，且會打破既有 characterization test。warn 只需提醒，不需獎勵。
  - **測試四態＋一條反向護欄**：沒填／一行口號／敘事＋條列／敘事夠長但沒條列，外加「願景全空時 `summary-incomplete` 不出現且 `blocks===0`」——把「vision 不進 block」釘成契約而非靠 code review 記得。
  - **基準它自己量過**：`git stash` 後在同一 worktree 跑得 1126，`stash pop` 後 1131，差 5 = 新增測試。零迴歸。**沒有採信轉述的數字**。
  - **沒驗的（agent 自陳）**：UI 呈現完全沒開瀏覽器看過（靜態掃過 `src/pages/`／`status-bar.ts`／`flow-layers.ts`／`ai-coach.ts` 確認無硬編 finding id、全按 `level` 泛型渲染，但「應該」不是「看過」）；60 這個門檻是對照既有門檻（tech 12／goals 20／metrics 30／problem 40）推的相對值，**無真實 PRD 長度樣本**；未填願景的既有 PRD 會 score −5，沒盤點過實際有幾份會掉分。

- 10:48 — **F 項盤點完成。數字訂正：34 處，不是 30。** 裸 `confirm` 18＋`window.confirm` 7＋裸 `prompt` 5＋`window.prompt` 4。前一輪漏數了 4 處 `window.prompt`（editor ×3、review ×1）。**全 repo 零個 `alert()` 呼叫點**（唯一字面 `alert(` 在 `tests/diff-summary.test.ts:49`，是 XSS 測試 payload 字串）——所以 `js_dialogs.rs:58-84` 的 alert delegate 是死碼。34 處全在 `src/pages/` 的 10 個檔，`src/lib/`／`.html`／`scripts/` 各 0。
- 10:48 — 🔴 **最重要的發現：`src/pages/admin.ts:389` 是 fail-OPEN，其餘 33 顆都是 fail-closed。**
  ```ts
  const reason = prompt("抽單原因", "需求變更／管理者抽單") ?? "";
  if (reason === null) return;            // 死分支：?? "" 已經把 null 吃掉
  const r = store.withdrawCase(id, reason);
  ```
  桌面殼裡 `prompt()` 回 null → `?? ""` 轉成 `""` → 守衛永遠不成立 → 直接 `withdrawCase(id, "")`，而 `store.ts:2375` 是 `withdrawReason: reason || "管理者抽單"`。**結果：按抽單，案件在零確認、零輸入的情況下被抽掉，簽核紀錄的理由被自動補成「管理者抽單」，還跳「已抽單」toast。** 治理鏈上唯一一顆會靜默寫入錯誤紀錄的。
  - **PM 已自行讀 `admin.ts:383-395` 與 `store.ts:2366-2381` 兩處原始碼確認**，不是採信轉述。
  - `rg` 掃過全 repo，`?? ""` 套在 prompt 上是**孤例**，無第二處。
  - **已修並 commit `3ee1f6f`**（只拿掉 `?? ""`，把 null 交回守衛，fail-open → fail-closed）。tsc 綠、`bun test` 1126 全綠。完整的頁內確認遷移仍排批次 1。
  - 附帶事實：**tsc `strict: true` 抓不到 `string === null` 這種死比較**——修之前 tsc 一樣是綠的。
- 10:48 — **現成可抄的元件都找到了，不用新造**：toast 在 `src/lib/ui.ts:1-21`（已是全 App 預設，這就是 repo 裡 0 個 alert 的原因）；兩段式樣板 `releases.ts:266-272`＋`509-527`＋`shared.css:13964-13974`（class 綁死 `rl-` 前綴，要抽泛用）；**卡內「理由必填」輸入** `signoff.ts:317-322`＋`417-431`（`admin.ts:389` 與 `review.ts:802` 直接照抄）；**卡內就地改名** `rail-projects.ts:556-625`（editor 的 4 個改名 prompt 照抄）；modal `ui.ts:31-52`。**缺的是泛用 `armConfirm()` helper 與 `.btn-danger`**，要在批次 1 立起來。
- 10:48 — **四批出貨計劃**（每筆都有 `檔案:行號`＋使用者眼中是什麼＋嚴重度＋工法＋工作量依據）：
  - **批次 1（M）— 治理鏈 P0 全集 8 筆＋泛用元件 enabler**：`admin.ts:389`（已先修 fail-open）、`dashboard.ts:670`（T9 受測物）、`review.ts:802` 代簽理由、`signoff.ts:433/439` 重開案件與套用流程、`admin.ts:380/271` 套用流程與刪關卡、`releases.ts:492` 刪版本。**八顆按鈕全在 `.ts` template literal 裡，不用碰任何 `.html`。**
  - **批次 2（L）— `editor.ts` 全 9 筆**：同檔同次 UAT 能全驗。其中 `editor.ts:683 confirmLeaveFile()` 與 `1883` 送審提示是**設計題**，建議拆獨立小票不要卡住其他七筆。
  - **批次 3（M）— `templates.ts` 全 7 筆**：prompt 全是輸入類、得走 modal，而 `templates.html` 已有三個 modal 骨架可用。
  - **批次 4（M）— 尾巴 10 筆**：散在 settings／openspec／write／admin，都只是套批次 1 的 helper。要改三個 `.html`。
  - **`openspec.ts:449`（一鍵 openspec init）被 `isNative()` 擋住＝只在桌面版出現＝100% 落在壞掉路徑上**。想早點驗證 helper 在真桌面殼有效，把它提到批次 1 是合理的。
- 10:48 — **四筆「需個案設計」**：`editor.ts:683`（同步回傳 boolean，三個呼叫端靠回傳值決定流程，改非同步會傳染整條鏈——agent 明說兩條可行方向都會改變既有語意、不敢代選）；`editor.ts:1883`（是三選一不是 yes/no，兩顆按鈕表達不了）；`write.ts:275/303`（confirm 發生在已開啟的 modal 裡，合理解法是把逐項確認整個拿掉、改在「開始產生」按鈕上做一次——**這是設計變更不是機械遷移，要 Scott 點頭**）。

- 11:05 — **E 項（W3-1b）完成**，worktree `agent-ad187fbbdbe44f845`，commit `e8e3e00`（在該分支，未併 main）。
  - ⚠️ **必須揭露：這不是 GPT-5.4 寫的。** Forge 的 `codex exec` 第一步就回 `You've hit your usage limit … try again at Aug 20th, 2026`，帳號層級額度用盡到 8/20，`~/.codex/config.toml` 與環境變數都沒有 `OPENAI_API_KEY` 可繞。agent **沒有靜默降級**，明講程式碼是它自己（Claude-family）寫的。**若派 Forge 的理由之一是「換一個認知血統降低共同盲點」，那個價值這次沒有實現**——8/20 後可重跑 Forge，或改派 Anvil（Kimi-family）覆核。
  - **位置：狀態列 `#app-status-bar` 右側、時鐘之後。** 理由：這是 repo 裡唯一同時滿足「每頁都有」與「不用改 17 個 HTML」的位置（footer 由 `auth.ts` 的 `requireAuth()` 注入，17 個進入點共用）。側欄底部會跟 `.rail-foot--user` 搶位置，且側欄可收合、收起來就看不到。
  - **自動化契約**：`#app-build-stamp` / `[data-build-stamp]`，分項免 parse：`data-build-version`、`data-build-commit`、`data-build-dirty`、`data-build-time`（ISO 原始值）。
  - **實測注入值**（從 `dist/assets/status-bar-*.js` 抓到的字面量，非推論）：`VITE_BUILD_COMMIT:"53596f9"`、`VITE_BUILD_DIRTY:"true"`、`VITE_BUILD_TIME:"2026-08-15T03:31:08.970Z"`、`VITE_BUILD_VERSION:"1.1.0"`。畫面字串：乾淨 `1.1.0 · 53596f9 · 08-15 11:31`／髒 `1.1.0 · 53596f9+ · …`／dev `1.1.0-dev · 53596f9+ · …`／git 全掛 `unknown · unknown · unknown`。
  - **兩個設計判斷值得記**：dev 保留真實 commit 只在版號加 `-dev`（純寫 `dev` 會把「這是哪一份 code」丟掉，而那正是這功能要答的問題）；commit 取不到時**不加** `+`（`unknown+` 讀起來像另一種錯誤）。
  - **複製**：`.app-status-bar` 整條是 `user-select: none`，所以新規則明寫 `user-select: text`（WKWebView 要 `-webkit-` 前綴）；綁定走 document 事件委派，因為 `renderStatusBar()` 每次 store 變動都重寫 `innerHTML`、掛節點上的 listener 會被洗掉。
  - **主題四層完全沒碰**（沿用 `var(--fs-1)`／`var(--meta)`，與隔壁 `.app-status-clock` 同組）。零新增相依。
  - 閘門：tsc exit 0、`bun test` **1140 pass / 0 fail**（基準 1126，+14 全新增）。
- 11:05 — 🔍 **今天第二個 tsc 盲點**：`tsconfig.json` 的 `include` 只有 `src/**/*.ts`，**`vite.config.ts` 根本不在型別檢查範圍內**——agent 第一版在該檔留了重複的 `const appVariant`，tsc 全綠，是 `bunx vite build` 才炸出 `The symbol "appVariant" has already been declared`。（第一個盲點：`strict: true` 抓不到 `string === null` 的死比較，見 10:48 條目。）**兩個都不是 bug，是「綠燈的涵蓋範圍比想像小」——值得記進下一版的檢查清單。**
- 11:05 — **W3-1b 的 `[DEFERRED-VERIFY]` 待驗條件**（Scott 重載 Interceptor 擴充後）：`document.querySelector('#app-build-stamp')` 非 null 且 `.dataset.buildStamp` 符合 `^\S+ · \S+ · \d{2}-\d{2} \d{2}:\d{2}$`；截圖確認在狀態列最右、單行不換行、沒擠掉 `.app-status-user`；**實際拖曳選取**（`user-select` 覆寫失敗時畫面完全正常，只有拖曳才看得出來）；縮到 900px 以下仍可見。
- 11:05 — **W3-1b 其他沒驗的（agent 自陳）**：沒跑完整 `tauri build`（只跑前端半段 `bunx vite build` 並從 `dist/` 證明注入是建置期而非執行期；「tauri build 呼叫同一個 vite build」是推論不是證據）；**登入頁與 onboarding 頁沒有這個標記**（`requireAuth()` 對這兩頁提早 return，「任何一頁都看得到」嚴格說有兩個例外，agent 選擇據實回報而不擴大改動）；`unknown` 降級路徑只有單元測試覆蓋，沒在真的無 git 環境跑過。
- 11:05 — **兩個完成的 worktree 已各自 commit 在自己的分支上**（`389b7a5` W3-3、`e8e3e00` W3-1b），**尚未併 main**。理由：先把成果釘住免得被後續 agent 清掉（03:20 的教訓），併不併、什麼時候併是 Scott 的決定。

- 11:25 — **Scott 裁決：①視覺驗證交給使用者測 ②三條分支併 main。**
- 11:25 — **已併 main（本機，未 push）**：`1947544` merge W3-3、`757422e` merge W3-1b，加上先前的 `3ee1f6f`。
  **合併後重驗**（兩個 agent 各自驗過，但合併是它們可能互撞的地方）：tsc exit 0、`bun test` **1145 pass / 0 fail**（1126 + 5 + 14，加總對得起來、零迴歸）、`bunx vite build` 綠。
  順手驗注入值仍正確：`dist/assets/status-bar-4RARSKYh.js` 裡是 `VITE_BUILD_COMMIT:"757422e"`——**正好是這次的 merge commit，證明它真的跟著 HEAD 走**，不是寫死。
- 11:25 — **視覺驗證出成 11 題實測報告**：`plans/uat-建置識別碼與願景-gate-視覺驗收.md`（UAT-20260815-02），App 已喚醒。
  出題時的兩個判斷：**第 2 題比對雜湊與 `git log -1`** —— 那才是這個功能存在的理由（其餘幾題只驗它長得對不對，這題驗它說的是不是真話）；**拖曳選取與點擊複製拆成兩題** —— `user-select` 覆寫失敗時畫面完全正常，跟剪貼簿 API 失敗是兩種不同的壞法，混一題就分不出是誰壞。
  前置寫了重新 build＋換裝，所以**這份與 wave1+2 那份 10 題會跑在同一個新 build 上**，不用裝兩次。

## 阻塞 / 待決議

- **F 項實作卡在 Scott 的 UAT 第 9 題**（不是技術阻塞，是排序）。
- W3-1a（install script）回滾路徑補完中，尚未 commit，在 worktree `agent-a462943ca534a1cbd`。

## 結束摘要

（未完成）
