---
status: draft
created: 2026-09-02
owner: Scott
---

# Anchorline — 產品需求文件（逆向生成草稿）

> 用 `docs/TEMPLATE-prd-unified.md` 的結構,把散在 README、`docs/SCOPE.md`、`plans/` 母規格與 handoff 鏈裡的意圖收攏成一份——吃自己的狗糧。本文件是**逆向文件**:先有產品,後有 PRD;它的用途是柵欄與口徑,不是開發指令。
>
> **共存規則(2026-09-02 已釐清,Q-06)**:App 只在「本 repo 被註冊進 Anchorline 且走到送審/核准」時才會覆寫 `docs/PRD.md`(`prd-file.ts` 從 App state 渲染整份重寫,不讀回磁碟內容);未註冊前放這裡完全安全,且本檔受 git 追蹤、`.anchorline/prd/` 快照不覆寫,誤寫可 revert。日後要真狗糧:先把本檔匯入 App,再讓 App 接管此路徑。

## 0. 要不要寫這份 PRD

**本次判定:☑ 寫 PRD — Full。** 理由:整個產品的意圖目前散落在 40+ 份 `plans/` 文件與多層 handoff 鏈裡,任何新 session、新協作者(人或 agent)都要重讀整條鏈才能知道邊界在哪。一份 PRD 的價值在這裡不是規劃,是**收攏與設柵欄**。

## 1. 文件概況與修訂紀錄

### 1.1 文件紀錄

| 欄位 | 內容 |
|---|---|
| 專案／需求名稱 | Anchorline — 本機優先的開發專案工作台 |
| 負責人 | Scott(單人;PM 兼唯一使用者) |
| 平台 | Tauri 桌面 App(macOS 已實機驗證;Windows / Linux 僅 CI 建置) |
| 目前產品版號 | v0.1.0(`package.json` / `tauri.conf.json`) |
| 文件狀態 | draft(待 Scott 審) |
| 利害關係人 | Scott;實作與審查由多家 AI agent 分工(Engineer / Bellows / Cato / Relay 等) |

### 1.2 修訂紀錄

| 日期 | 版本 | 修改人 | 修改章節 | 變更內容 | 已通知 |
|---|---|---|---|---|---|
| 2026-09-02 | v0.1 | Miles(代筆) | 全部 | 從既有材料逆向生成初稿 | — |
| 2026-09-02 | v0.2 | Scott 拍板/Miles 代筆 | 2.3、10 | Q-01/Q-02 暫時不對外(暫緩)、Q-03 兩段式、Q-06 共存規則釐清 | — |
| 2026-09-02 | v0.3 | Scott 拍板/Miles 代筆 | 10 | 檔位系統 P1 五題定案(Q-08~Q-12),規格落 `openspec/changes/add-vibe-route/` | — |
| 2026-09-02 | v0.4 | Miles(代筆) | 7(新增) | Prior Art:27 組 GitHub 關鍵字 + 3 次 WebSearch,8 候選皆部分滿足,決策全新開發、僅架構參考 | — |
| 2026-09-02 | v0.4.1 | Miles(代筆) | 4 | §4 補記第四檔 vibe 路線(tiamat-fe 交叉比對抓到的漏記) | — |

## 2. 背景、目標與需求來源

### 2.1 摘要(審閱者 10 秒版)

| 欄位 | 內容 |
|---|---|
| 做什麼 | 給每個工作單元一個穩定錨點(`<!-- anc:t=XXXXXXXX -->`),把 PRD、簽核、plan checkbox、git commit、openspec change 串成一條可 replay 的治理鏈,外加落在磁碟上的 append-only 稽核軌跡。 |
| 給誰 | 在 vibe coding 時代帶著一隊 AI agent 開發的單人 PM／顧問——第一位使用者就是 Scott 本人。 |
| 為何現在 | AI agent 寫掉大部分程式碼之後,「怎麼證明 agent 做的事被治理過」成了缺口;市面工具都在解「讓 agent 跑更多」,沒人解這件事。 |
| 技術路線 | Tauri(Rust 殼)+ 無框架 TypeScript 多頁 HTML;bun 工具鏈;MIT 開源。 |

### 2.2 專案背景(問題陳述)

**誰的痛:單人 PM／顧問。** 沒有工程團隊、沒有第二個人當守門,需求文件、簽核、任務進度、版本紀錄全靠自己與一隊 AI agent。痛在三層:

1. **身分對不起來。** `plans/*.md` 的 checkbox、git commit、簽核、openspec change 各有各的身分——對不起來就只能各自顯示,「下一步做什麼／到哪了／為什麼變成這樣／實際發生了什麼」四題答不齊(多數工具只答得出前兩題)。
2. **agent 的產出無從證明被治理。** agent 看不到「為什麼」就會開心地把理由重構掉;而且同一族系的 agent 寫的文件由同族系核准,等於自己審自己——GitHub 的 CODEOWNERS 只認人,不認 AI 族系,抓不到這一類。
3. **ADHD 情境:空白頁殺死啟動。** 任務啟動、時間盲、工作記憶約 4 迴圈、顯著性偏誤、RSD 迴避——五個機制一起壞(`plans/2026-08-07_editor-adhd-redesign.md`)。介面必須讓使用者面對的永遠是「改一句話」而不是空白頁,而且**越掙扎時越安靜**,不是越吵。

### 2.3 目標與非目標

**目標**

1. 一條治理鏈:PRD 撰寫 → 結構 gate → 簽核 → openspec change → commits → PR → release,錨點是 join key。
2. 治理鏈可 replay,違規(含 agent 族系自審)會被標出——一條從不標違規的鏈沒有說服力。
3. ADHD-first 編輯台:引導撰寫、卡住時安靜、一次只指一個(焦點卡封頂 4 欄位)。
4. UAT 實測題逐題勾選、失敗必填說明、結果寫回同一份 markdown,agent 讀得回去。
5. 作為 G0「公開顧問作品」公開發布(MIT、GitHub release、brew cask——已達成,持續維護)。

**非目標(一)——明確不做**(主要出處 `docs/SCOPE.md` §6 與各規格「不做」節)

| 不做 | 為什麼 | 出處 |
|---|---|---|
| 瀏覽器版 | D5,降級路徑維護成本 > 價值 | `docs/SCOPE.md` |
| 自建 openspec `spec.md` parser | D10,只走官方 CLI `--json`;`tasks.md` checkbox 是 D10a 例外 | `docs/SCOPE.md` |
| Kanban／拖曳／優先級／指派／到期日 | Linear 的形狀,做進來就是兩套任務系統 | `docs/SCOPE.md` |
| agent 派工執行、`gh pr review --approve` 等寫入 | 原生端跑任意 prompt 等於拆掉注入防護;不可逆對外動作 | `docs/SCOPE.md` |
| PR diff 檢視器、SQLite、雲端同步／多人伺服器 | 過度專注黑洞;單人量級;本機＋檔案＋git 就是產品邊界 | `docs/SCOPE.md` |
| 拆 login / auth / employees 整條線 | Scott 明確選了不做 | `plans/Project_Anchorline__2026-08-25-2325__signoff-redesign.md` |
| 逐條勾選套用的 diff UI | 範圍控制;R1 已拍板走兩段式,第一階段不觸碰此柵欄;第二階段開工前若仍要 diff UI,屆時重開 | 同上＋`plans/wave3-requirements.md` |
| B2 輪次回溯遷移(既有個案 round 減一) | 會讓兩輪紀錄撞號併組,有反例測試釘住;代價是舊案輪次標籤偏高一 | `plans/wave3-requirements.md` |

**非目標(二)——還沒決定做／未收的線頭**(這一節是柵欄:列在這裡的東西,沒拍板前不開工)

| # | 線頭 | 狀態 | 出處 |
|---|---|---|---|
| 1 | **P-1~P-6**:送審前簽核頁預覽的 6 題 UAT(含 P-3 窄視窗版面,機器沒驗過) | 已實作、待實測,未併進 UAT 報告 | `plans/wave2-spec.md` 檔尾 |
| 2 | **B1/B2**:「已簽×待簽核」矛盾與輪次多算——已修、附 7 題 UAT | 已修未實測,未併進報告 | `plans/wave3-requirements.md` |
| 3 | **S-1~S-7**:送審預檢的 7 題 UAT(含 S-7 窄 toast,機器沒驗過) | 已修、待實測,未併進報告 | `plans/wave3-requirements.md` 檔尾 |
| 4 | **R1**:agent 建議附結構化 diff 與自動套用 | **拍板(09-02):兩段式**——第一階段只驗 agent 結構化輸出穩定度,不動 UI;穩了再進第二階段規格 | `plans/wave3-requirements.md` |
| 5 | **R2**:簽核期間內容變更的前後紀錄＋紀錄頁——`saveAgentResult` 目前不產生 `PrdVersion`,真缺口;五個岔路未拍板 | 同上 | `plans/wave3-requirements.md` |
| 6 | **匯出洩漏 API 金鑰**:`export.ts` 整包 `JSON.stringify(state)` 零 redaction | **拍板(09-02):暫緩**——暫時不對外,保 round-trip;自用期間備份檔含明文金鑰,注意存放位置。對外化時重開 | `plans/handoff-main-session__2026-08-26__agent-backends-w2-merged.md` |
| 7 | **W4 簽章與 notarization**(macOS $99/年、Windows 憑證):未簽章產物被 Gatekeeper / SmartScreen 擋 | **拍板(09-02):暫緩**——暫時不對外,費用不批;對外化時重開 | `docs/SCOPE.md` §5、README |
| 8 | `status-bar.ts`「結構可送審」與送審預檢同樣誤導,但跨全頁共用 | 留給下一輪判斷 | `plans/wave3-requirements.md` |
| 9 | 關卡已被移除的 pending 工作單只在 S1 攔截對話框找得到,要不要補「不屬於任何關卡的待拍板分析」區 | 未決 | `plans/handoff-main-session__2026-08-26__wave2-done.md` |
| 10 | Lite 路線章節編號跳號(01–05 後直接 11)——穩定編號是刻意的,但看起來像漏 | ⚠️ 待拍板 | `plans/Anchorline__2026-09-01-1200__prd-route-and-file-versioning.md` |
| 11 | CLI agent 後端通路(claude/grok/pi/agy)從未實機驗過;第三份 RUNNER 清單未對齊;`tracking.ts` 族系硬轉的 TypeError 隱患 | 待 UAT／待修 | `plans/handoff-main-session__2026-08-26__agent-backends-w2-merged.md` |
| 12 | UAT 舊帳:對話框遷移實測、W3 的 11 題視覺驗收、wave1+2 的 10 題;28 題 Wave 2 報告寫回為空之謎 | 待實測／待查 | `PROJECTS.md`、`plans/handoff-main-session__2026-08-26__wave2-done.md` |

### 2.4 成功指標

與 G0(公開顧問作品)／G1(內容節奏)掛鉤的**可觀察**指標。**這些指標永不 gate release**——它們量的是產品有沒有用,不是這一版能不能出門;能不能出門看第 8 節驗收標準。

| # | 指標 | 現況基準 | 目標值 | 量測方式 |
|---|---|---|---|---|
| M1 | 自用頻率:Scott 的其他專案(txtnimal、sysapp-tui…)經由 Anchorline 走 UAT／簽核的次數 | 已有(sysapp-tui 重測題在 Anchorline) | 每月 ≥ 2 個專案實際走過迴圈 | `plans/uat-*.md` 寫回紀錄 |
| M2 | UAT 迴圈完成率:出題 → 實測 → 結果寫回 markdown → agent 讀回,四步走完的比例 | 低(多份報告未寫回) | ≥ 80% | 報告檔的勾選與說明欄位 |
| M3 | 公開 release 節奏 | v0.1.0 已上 GitHub release + brew cask | 每季 ≥ 1 個帶 release notes 的版本 | GitHub Releases |
| M4 | 作為顧問作品的對外曝光:landing page＋至少一篇拆解產品決策的公開內容 | landing 已上線 | 2026 年內 ≥ 1 篇公開文章(供給 G1) | 發布連結 |
| M5 | ⚠️ 待拍板:是否納入外部訊號(stars／issue／brew 安裝數)——單人自用工具用外部指標可能扭曲方向 | — | — | — |

### 2.5 需求來源

| # | 來源 | 形態 |
|---|---|---|
| R-01 | Scott 實測口述與回報(例:wave3 的 R1/R2 原話、「送審預檢」撞牆) | `plans/wave3-requirements.md` 等 |
| R-02 | `docs/SCOPE.md` 的決策基線 D1–D10a 與四條工作線 | 決策紀錄 |
| R-03 | ADHD 重新設計診斷(五機制、R1 惡性迴路) | `plans/2026-08-07_editor-adhd-redesign.md` |
| R-04 | handoff 鏈的「還沒收的線頭」節 | `plans/handoff-main-session__*.md` |

## 3. 用戶

**主要**:Scott 本人——單人 PM／顧問,ADHD,帶多家 AI agent 分工開發,需要向自己(與未來的客戶)證明 agent 產出被治理過。
**次要**:開源後同型的單人開發者／顧問。⚠️ 待拍板:次要用戶是目標受眾還是順帶受益——這決定文件與 onboarding 要投多少。

代表性用戶故事:身為單人 PM,我想要送審時逐關指派 agent 或自己,以便同族系 agent 不會核准自己寫的文件;身為 ADHD 使用者,我想要卡住時介面變安靜而不是變紅,以便維持啟動;身為 agent 的委託人,我想要 UAT 結果寫回 markdown,以便 agent 直接讀回失敗說明。

## 4. 功能範圍(現有已交付能力)

以下照實列,全部在 `main` 並有測試覆蓋(bun test 2042 綠 / Rust 40+ 綠,2026-09-01 基準):

| 能力 | 內容 |
|---|---|
| 治理鏈與錨點 | `anc:t=` 錨點(舊 `sf:` 可讀)、append-only 稽核軌跡、治理 replay 標違規、覆蓋率從第一筆錨點事件起算 |
| 20 個畫面 | 專案總覽(焦點卡＋PR 雷達＋UAT 待測)、編輯台、審閱／簽核、Task Tracking、UAT、OpenSpec 工作區、檔案歷史、發布、Agents、設定等 |
| 簽核流程重設計(Wave 1+2) | 關卡骨架=範本分類(lean/narrative/enterprise/agile/technical)+領域包疊加;流程第一次送審落地到專案;agent 結果先看後存(`landed: pending`);族系隔離為主要守門;送審預檢提到對話框前 |
| Agent 執行後端(W1–W4) | API 與本機 CLI 雙通路;CLI 白名單 4 個(claude/grok/pi/agy),prompt 走 stdin 不進 argv;CLI 不可用時明確拒絕不靜默回退 |
| PRD 路線與檔案版本 | full/lite/vibe/openspec 四檔路線持久化(`src/lib/prd-triage.ts` `PRD_ROUTES`;vibe=「試作／探索」,`6dcd5c9`);狀態轉換自動寫 `docs/PRD.md` 與 `.anchorline/prd/` 快照 |
| ADHD 機制 | 反轉揭露(快過關才展開)、專注模式、進度膠囊、起手式填空、hyperfocus 守門、中斷復原、untouched≠錯 |
| 原生對話框遷移 | `src/lib/ask.ts` 取代全部 alert/confirm/prompt,修掉 tauri-plugin-dialog 恆真守門失效 |
| 散佈 | MIT、GitHub Releases 三平台、brew cask(未簽章)、landing page |

## 5. 產品架構(一段)

`src/lib/` 104 個模組,90 個零 I/O;`src/lib/native.ts` 是原生 bridge 唯一入口;`src-tauri/` Rust 殼 40+ command;`docs/BRIDGE.md` 是契約。三條安全界線:外部程式參數寫死在原生端、`git`/`openspec`/`gh` 只走唯讀子指令白名單、路徑必須落在已註冊專案根目錄內。判定邏輯一律純函式、`nowMs` 可注入——WKWebView 換 Tauri 時 47 個 lib 檔 39 個零改動,這條規則的回收證明。

## 6. 需求規格(核心迴圈)

```
PRD 編輯台(引導撰寫+結構 gate) → 送審(預檢→逐關指派→commit 快照)
→ 簽核(關卡逐關簽,gate 未過擋核准,族系隔離擋自審)
→ UAT(實測題勾選,結果寫回 plans/uat-*.md,agent 讀回)
→ openspec 治理(官方 CLI --json;唯一例外:changes/<id>/tasks.md checkbox 本地讀寫,D10a)
→ commits → PR → release,全程錨點串接、事件進稽核軌跡
```

邏輯規則的單一真相在程式碼與其檔頭註解(`governance.ts`、`focus-card.ts`、`log-views.ts`),本 PRD 不複寫細節——複寫會分岔。

## 7. Prior Art(2026-09-02,PriorArt 搜尋)

**結論:全新開發(已在做),沒有可直接採用的現成方案。** 跑了 27 組 GitHub 關鍵字(spec-driven development / PRD / openspec / audit trail / approval / governance / task tracker / tauri 等)加 3 次 WebSearch;去重後最接近的 8 個候選如下,覆蓋度全部停在「部分滿足」。

| repo | stars | 授權 | 最後 push | 功能覆蓋度 | 與需求的差距 |
|---|---|---|---|---|---|
| [Pimzino/spec-workflow-mcp](https://github.com/Pimzino/spec-workflow-mcp) | 4.3k | **GPL-3.0** | 2026-07-03(作者宣告暫停) | 部分滿足 | 有 dashboard + 簽核 + 修訂 + task 進度 + 實作 log,是最像的一個;但是 MCP server + 網頁,不是本機 App;沒有錨點 join key、沒有 agent 族系隔離、沒有 replay;GPL 進 MIT 專案合規成本不划算 |
| [Lumiaqian/openspec-mcp](https://github.com/Lumiaqian/openspec-mcp) | 31 | MIT | 2026-01-12(可能棄坑) | 部分滿足 | 直接包 OpenSpec 的 dashboard + approval + review comment,形狀與本專案的 OpenSpec 工作區重疊;但只有 openspec 一段,沒有 PRD 編輯台、UAT、稽核鏈 |
| [MrLesk/Backlog.md](https://github.com/MrLesk/Backlog.md) | 6.6k | MIT | 2026-09-01 | 部分滿足 | markdown-native 任務 + AC + DoD + 三道 review checkpoint,理念相鄰;但是 Kanban 形狀(D-scope 明確不做),沒有簽核關卡、族系隔離、稽核軌跡 |
| [Trusted-Autonomy/TrustedAutonomy](https://github.com/Trusted-Autonomy/TrustedAutonomy) | 7 | Apache-2.0 | 2026-08-28 | 部分滿足 | 「agent 產出先審後落地」+ 稽核軌跡,精神最接近 Q4;但解的是 runtime 檔案層(staging copy + diff 審核),不是文件治理層;Rust alpha,沒有 UI |
| [Chappygo-OS/Atomic-Spec](https://github.com/Chappygo-OS/Atomic-Spec) | 10 | MIT | 2026-08-23 | 部分滿足 | spec-kit 的強制版:gate 未過不得進下一站、4 個 human sign-off 點、traceability 矩陣;但是 prompt/CLI 框架,無 GUI、無 append-only 軌跡、無族系概念 |
| [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) | 66.9k | MIT | 2026-09-01 | 部分滿足 | 本專案已當上游依賴(D10 只走官方 CLI `--json`),它負責 change 生命週期,不負責簽核、UAT、稽核 |
| [github/spec-kit](https://github.com/github/spec-kit) | 132.9k | MIT | 2026-09-01 | 部分滿足 | constitution + spec 範本;沒有 GUI、簽核、軌跡;Python |
| [BloopAI/vibe-kanban](https://github.com/BloopAI/vibe-kanban) | 28k | Apache-2.0 | 2026-09-01 | 不相關 | agent 派工／並行執行,正是本專案「不做」那一格(agent 派工執行、Kanban) |

另有 [eyaltoledano/claude-task-master](https://github.com/eyaltoledano/claude-task-master)(28k,授權 NOASSERTION——LICENSE 非標準條文,程式碼不可引用)、gemini-cli-extensions/conductor(3.7k,Apache,spec→plan→implement 外掛,無 GUI)、joshrotenberg/adrs(127,Apache,Rust ADR CLI)——皆只覆蓋單一段。

**沒有任何候選做到的三件事**(本專案的差異化,與 §2.3 目標 1、2 對應):

1. 跨四種身分(plan checkbox / commit / 簽核 / openspec change)的穩定錨點 join key。
2. `authorAgentFamily` 族系隔離——同族 agent 不得核准同族文件,replay 會標違規。
3. ADHD-first 編輯台(反轉揭露、卡住時變安靜)+ UAT 結果寫回同一份 markdown 讓 agent 讀回。

**決策:**

- 採用線:無。
- 借用線:**只作架構參考,不引用程式碼**。Backlog.md 的「三道 review checkpoint」與 Atomic-Spec 的「gate 未過不得進站」可作簽核關卡設計的對照;spec-workflow-mcp 的實作 log 可作稽核軌跡呈現的對照。GPL 的那一份連參考也只看 README 與畫面,不讀原始碼。
- 排除:vibe-kanban / claude-task-master 落在明確不做的格子;openspec-mcp 半年沒動且只包 openspec 一段。

**三個月後要記得的事:** 這一輪的市場結論是「2026 的 SDD 工具全在解『讓 agent 跑更多』,治理／稽核那一層只有 TrustedAutonomy 與幾個 <10 stars 的 audit-trail 小專案在做,而且全在 runtime 層」。若日後出現同時做「文件治理 + 族系隔離 + 本機 App」的專案,再重跑一次 PriorArt。

參考:[Augment Code SDD 工具比較](https://www.augmentcode.com/tools/best-spec-driven-development-tools)、[BMAD vs Spec Kit vs OpenSpec](https://reenbit.com/bmad-vs-spec-kit-vs-openspec-choosing-your-spec-driven-ai-framework/)、[awesome-agent-orchestrators](https://github.com/andyrewlee/awesome-agent-orchestrators)。

## 8. 驗收標準(與成功指標分開;這些才 gate release)

| # | 驗收項目 | 預期結果 |
|---|---|---|
| AC-01 | `bun run typecheck` / `bun test` / `cargo test` / `vite build` | 全綠,測試數只增不減 |
| AC-02 | 治理 replay 對族系自審的個案 | 標出違規 |
| AC-03 | agent 分析未按「存進文件」時 | `sectionValues` 與 `comments` 逐字不變 |
| AC-04 | 涉及 UI 的變更 | 出 UAT 題並經實機勾選通過(視覺類機器測不到) |
| AC-05 | `docs/BRIDGE.md` 與實際 bridge 行為 | 一致(改行為必改文件) |

## 10. 開放問題(負責人皆 Scott)

| # | 問題 | 期限 | 狀態 |
|---|---|---|---|
| Q-01 | W4 簽章要不要花這 $99/年(線頭 #7) | 對外化時重開 | **已拍板(09-02):暫緩** |
| Q-02 | 匯出金鑰洩漏走 redaction 還是保 round-trip(線頭 #6) | 對外化時重開 | **已拍板(09-02):暫緩,保 round-trip** |
| Q-03 | R1 走「一次到位」還是「兩段式」(線頭 #4) | — | **已拍板(09-02):兩段式,先驗結構化輸出地基** |
| Q-04 | ⚠️ 待拍板:R2 紀錄載體用 `PrdVersion` 新 kind 還是另開 `contentChanges`(線頭 #5) | 待定 | 待決 |
| Q-05 | 28 題 Wave 2 UAT 報告為何全空:App 沒存回(bug)還是沒走報告手測(流程) | 待定 | 待查 |
| Q-06 | 本檔與 App 自動寫的 `docs/PRD.md` 的共存方式(見文首共存規則) | 註冊本 repo 進 App 前重看 | **已釐清(09-02):未註冊前無衝突;真狗糧時先匯入 App 再讓 App 接管** |
| Q-07 | ⚠️ 待拍板:成功指標要不要納外部訊號(M5) | 待定 | 待決 |
| Q-08 | 第四檔(檔位系統 P1)命名 | — | **已拍板(09-02):「試作／探索」,UI 不出現 L 編號** |
| Q-09 | vibe 檔與治理鏈 | — | **已拍板(09-02):一鍵自簽+錨點的最小治理,不完全跳過** |
| Q-10 | 升檔訊號閾值(P3 用,P1 先靜態文案) | 實測後調 | **已拍板(09-02):6 個 change / 3 題 UAT 失敗起步** |
| Q-11 | vibe 檔要不要產 openspec change | 升檔時重看 | **已拍板(09-02):不產,追蹤先用 plans 檔** |
| Q-12 | gate 的領域包 × 路線交叉優先序 | — | **已拍板(09-02):vibe 一律忽略領域包;lite/full 維持現行** |

> 檔位系統的完整規格不在本 PRD 複寫——單一真相在 `openspec/changes/add-vibe-route/`(P1 開工單)。

## 11. 送出前自檢

- [x] 開頭講「為什麼」,不是規則細節
- [x] 非目標 ≥ 3 條且標了出處;散落線頭已收攏進 2.3
- [x] 成功指標可觀察、與 G0/G1 掛鉤、明寫永不 gate release
- [ ] 開放問題每題有期限(目前皆「待定」,待 Scott 補)——⚠️ 待拍板
- [ ] Scott 審過並把 status 改為 active

> 本模板第 7(原型)、9(產品指標 GSM)節從缺:原型即產品本身(截圖在 `landing-assets/`);GSM 埋點對單人本機工具不成立,成功指標以 2.4 為準。⚠️ 待拍板:若日後面向次要用戶,第 9 節要補。
