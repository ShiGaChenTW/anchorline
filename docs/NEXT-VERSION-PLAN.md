# 下一版規劃 — Grok × Codex 圓桌彙整（2026-08-14）

> 素材：`plans/opaleye__2026-08-14-1949__uat-checklist.md` 的 later 清單與決策紀錄。
> 兩位評審獨立作業：Grok（使用者價值視角，讀碼抓缺口）、Codex/GPT-5.4（工程視角，逐項指到檔案行號）。
> 本檔是工程票據源：每一項可直接開成 openspec change 或 plans/ 計劃。

## 怎麼讀這份清單

- 兩位評審**意見相左的地方保留兩造理由**，裁決寫明依據。
- 優先度：P0＝正確性（資料遺失／指標說謊）、P1＝下一版該做、P2＝排得進就做、P3＝有理由才做。
- 「切入點」都經 Codex 讀碼驗證過行號；「未實機驗證」的推導有標註。

---

## Wave 1 — 正確性修復（先止血）

| # | 標題 | 優先度 | 量 | 切入點 | 判定依據 |
|---|---|---|---|---|---|
| W1-1 | UAT 說明草稿跨題遺失 | **P0** | S | `src/pages/tracking.ts:737-763,1272-1280` | Codex 讀碼推導：Cato F1 的 `mousedown preventDefault` 修法製造了 F1'——A 題打完說明直接按 B 題結果鈕，A 的 blur 不觸發、`render(true)` 繞過 `isEditingNote` 護欄，說明無聲消失。修法＝module-level `Map<itemId,string>` 草稿層（~15 行），**不用** localStorage。Grok 原判「砍」係基於 F1 已修的假設，Codex 推導更深，採 Codex。⚠️ 未實機重現，動手前先重現一次 |
| W1-2 | 送出／DIFF／族系鈕補 mousedown guard | P1 | S | `src/pages/tracking.ts:737-749` | 與 W1-1 同族：guard 只掛在 `[data-verdict]`，`#uat-send`/`#uat-diff`/`[data-fam]` 沒掛 |
| W1-3 | OpenSpec 步驟拉低治理覆蓋率 | **P0** | M | `src/lib/governance.ts:28,50-56` · `src/pages/tracking.ts:1162-1167` | 每完成一個 openspec 步驟，覆蓋率就掉一格——核心指標對自家最推薦的工作流**系統性反向計分**。修法＝`isGoverned` 認第二種 subject 形狀 `openspec:<changeId>/<N.M>`（用目錄 id 不用 H1 標題），`knownAnchorsOf` 一併收 openspec 步驟 id。**不**給 openspec 塞 anchor（守 D10a）。覆蓋率數字會跳一次，畫面要講出來 |
| W1-4 | js_dialogs completionHandler 硬化 | P1 | S | `src-tauri/src/js_dialogs.rs:34-36,47-124` | WKWebView 契約：completionHandler 沒被呼叫＝ObjC 例外直接終止 App。三個 handler 包 `catch_unwind`，錯誤路徑一律以「取消」語意收尾；`install()` 結果接進 `ping` 的 capabilities，前端可偵測降級（wry 升版改 delegate 結構時的保險） |
| W1-5 | 側欄 badge 勾選後不更新 | P1 | S | `src/lib/rail-nav.ts:191-221,253-260` | 只在切專案時刷新。修法＝匯出 `invalidateUatBadge()`，`onSetVerdict` 成功路徑呼叫（~8 行）。Grok 原判「緩」，但成本低到不值得掛帳 |
| W1-6 | 中文標題檔名 | P1 | S | `src/cli/uat.ts:41-48,116-127` | 現況 `[^\x00-\x7F]` 把 CJK 全刷掉→全部報告叫 `uat-<時間戳>.md`，git diff／列表／交接三處失去辨識度，且是 supersede 的前置。修法＝直接放行 CJK 進檔名，只擋 `/ \ : * ? " < > \|` 與控制字元。⚠️ macOS NFD 正規化，跨程序路徑比對留意。三套 slug（uat/change-templates/prd-template）策略不一致，統一列後續 |
| W1-7 | CRLF 假衝突產生器 | P2 | S | `src/lib/plan-writer.ts:99,109,130,157` · `src/lib/uat-parser.ts:300,361` · `src/lib/plan-parser.ts:165-184` | 從 nit 升級：`mintMissingIds` 會把 CRLF 檔就地轉 LF，下一次 `safeApply` 的位元組級 hash 比對必失敗，回報「檔案被改過」拒寫——症狀長得像併發衝突。Windows 已在 bundle targets。修法＝每個 mutator 偵測 eol（~6 行 ×3）＋CRLF round-trip 測試。Grok 判砍（單人 macOS），Codex 找到具體壞法，採 Codex |
| W1-8 | scan_plans 刪重複 stat | P2 | XS | `src-tauri/src/commands.rs:355-360,441` | DirEntry metadata 已在手上又多 stat 一次，免費修 |

## Wave 2 — UAT 迴圈補全（讓已上線的鏈跑完整輪）

| # | 標題 | 優先度 | 量 | 切入點 | 判定依據 |
|---|---|---|---|---|---|
| W2-1 | 跨專案「待實測收件匣」 | **P0** | M | `src/lib/uat-pending.ts`（`plansDirsOf` 只算 active 專案） | Grok：agent 幫 B 專案出的題，人在 A 專案時 badge 顯示 0；錯過一次喚醒，報告就從系統裡消失 |
| W2-2 | 「本輪收工」＋報告歸檔 | P1 | S | `src/lib/uat-parser.ts:260`（status 純推導） | Grok：測 5/8 就走人的報告永遠「進行中」，待實測數字只進不出，兩週後 badge 沒人信 |
| W2-3 | 重測輪次 supersede（限縮版） | P1 | S | `src/lib/uat-parser.ts`（preamble）· `src/lib/uat-pending.ts:41-61` · `src/cli/uat.ts:116-127` | 真症狀是**兩輪並存**都算待實測（中文標題永不撞名）。Codex 便宜設計：preamble 寫 `> 重測自：<路徑>`，parser 抽 `supersedes?`，pending 踢掉被 supersede 的檔（~30 行）。**不建 round 資料模型**——anchor 每輪重鑄，題目層級對不起來是已承認的上限 |
| W2-4 | 失敗題落地成可追蹤工作項 | P1 | M | 待設計（掛 dashboard／tracking） | Grok：失敗現在只活在 md＋一段剪貼簿指令；PM 要的是「這專案還欠幾個修」，不是「上次那份報告在哪」 |
| W2-5 | 待實測列 a11y／可測性 | P2 | S | `src/pages/overview.ts:474-490` · `shared.css`（`.ov-uat` 規則整段不存在，死 class） | 不是無障礙是**可測性**：AX 樹看不到，agent 就驗不了自己剛做的東西。Codex 修正診斷：已是真 button，成因候選＝grid 文字曝露或 `title` 蓋掉名稱計算——**先用 Accessibility Inspector 定位再動手**，驗收必須看 AX 樹 |

## Wave 3 — 平台與流程

| # | 標題 | 優先度 | 量 | 切入點 | 判定依據 |
|---|---|---|---|---|---|
| W3-1 | 自動更新通道（updater 先行，簽名緩） | P1 | M | `src-tauri/tauri.conf.json` bundle 段 | Codex 重新定義利息：不是「別人裝不了」，是**每次驗證要手動換裝**，單一 session 內重複了四次、還產生過一次假 bug 報告。`tauri-plugin-updater` 與 Apple 簽章互相獨立；未簽名 dmg 也能自動更新（代價：更新後一次 `xattr`）。Apple 簽章（$99/yr＋CI keychain）等對外發布再做 |
| W3-2 | 版號流程 dogfood 一輪 | P1 | S | 流程，不是碼 | Grok：唯一有時間成本的帳——愈晚 dogfood 錯的版號愈多。剛好拿這一版當實驗品 |
| W3-3 | 011 願景欄位納入 gate | P2 | S | `src/lib/prd-gates.ts:33-42` | 單人簽核下 gate 是自我約束；先確認擋的是真的會錯的東西，否則多一道會習慣性略過的門。等 principal 裁決 |

## 明確砍掉／緩辦（有理由的不做）

| 項目 | 裁決 | 理由 |
|---|---|---|
| 一鍵複製失敗交接 | 砍（陳帳） | **已經出貨**（`src/lib/uat-fix-handoff.ts` + tracking 送出流程）；剩的是 `[DEFERRED-VERIFY]` enabled 路徑驗證，併入 principal 實測 |
| 失敗快速捕捉（截圖／語音） | 砍；留一行 placeholder | 語音＝麥克風權限＋音檔外送，抵觸橋的「不外流」原則；截圖＝橋上第一個媒體擷取 action，安全論證成本 >> 價值。便宜替代：說明欄 placeholder 教「⌘⇧4 截圖、貼路徑」。Grok 的「貼上剪貼簿圖片」切片留給以後真的痛再評 |
| 掃描 mtime 快取（完整版） | 緩 | 364 KB/s 還不痛；Rust 端 `Mutex<HashMap>` 版可零改橋合約，等痛了做。風險：mtime 精度誤判會讓畫面停在舊內容且無錯誤 |
| 覆蓋率載入 N× 掃描 | 緩 | 已有逐專案增量重繪緩解；改共用快取時往「未治理」方向倒，符合既有保守偏誤原則 |
| App Apple 簽名 | 緩 | 單機單人，簽名解的是散佈問題，場景還不存在 |
| 說明草稿 localStorage 持久化 | 砍（被 W1-1 取代） | 跨報告會殘留陳舊草稿；記憶體 Map 草稿層已覆蓋真實遺失路徑 |

## 建議出貨順序

**W1-1 → W1-2 → W1-6 → W2-3 → W2-2 → W2-1 → W1-3 → W1-5 → W2-5 → W1-4 → W1-7/W1-8 → W3-1 → W3-2**

（融合兩造：Grok 的 F→A→N2→N1→I 主線，插入 Codex 的 P0/P1 正確性修復；W3-2 dogfood 貫穿整版，從第一個 commit 就開始取號。）

## 兩造分歧的裁決紀錄

1. **說明草稿**：Grok 砍（暴露窗口幾秒）vs Codex P0（找到 F1 修法製造的新競態）→ **採 Codex**，但要求動手前先實機重現。
2. **CRLF**：Grok 砍（單人 macOS 無第二寫入者）vs Codex 做（mintMissingIds 轉檔→hash 假衝突，Windows 在 targets）→ **採 Codex**，機制具體。
3. **側欄 badge**：Grok 緩（分母會腐爛）vs Codex 做（8 行）→ **做**，但排在 W2 分母修正之後合入。
4. **supersede 優先度**：Grok P1 [HIGH]（兩輪並存）vs Codex P2（限縮設計）→ P1，用 Codex 的設計。
