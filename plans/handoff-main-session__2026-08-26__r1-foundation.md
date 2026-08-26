# Handoff — Anchorline R1 地基探測

- 更新：2026-08-26（R1 地基探測完成）
- `main` 與 `origin/main` 同步於 **`7603b70`**（本 session 未動任何原始碼）
- 已安裝：`/Applications/Anchorline.app`（sha256 `36a56cfcdf13`、commit `d355a08`）
- 本 session **零 source 改動**，只新增一份報告 —— 所以 tsc / bun test / vite build 沒有重跑的必要

## 一句話

**Wave 3 的 R1 已經驗完地基，結論是「現在的形狀做不得」，但找到了做得的形狀：
錨定片段替換 ＋ 錨點涵蓋率閘門。規格仍未拍板，不要直接開工。**

## 先讀哪一份

`plans/r1-foundation-probe__2026-08-26.md`（230 行）—— 本 session 的全部產出。
前段是 35 樣本的格式／縮水數據，末段（probe4）是編輯原語對照，答案在末段。

其餘背景仍看 `plans/handoff-main-session__2026-08-26__wave2-done.md`。

## 這輪查證出來的四件事

1. **格式完全不是風險。** 35 個樣本、4 顆模型、3 家廠商，JSON 解析 35/35、
   380 個提案欄位零幻覺 sectionId/fieldKey、零 markdown 圍籬。
   `wave3-requirements.md` 岔路 4 擔心的「解析失敗要退回散文」是保險，不是主風險。

2. **真正的地基裂縫是靜默縮水，而且是通例。** 35/35 每一次都至少把一個長欄位
   砍到剩不到一半。`metrics.m1`（3,440 字的指標表）在 ox-alpha 是
   **16/16 次被改、16/16 次壓到原文的 11–21%**。反方向也一致：20 字的
   `summary.who` 每次被膨脹 4–12 倍。**模型是在把每一欄拉向它心中的固定長度。**

3. **prompt 層級擋不住。** V2 把三條硬指令寫進 prompt（未點名處逐字保留／
   表格列數不得減少／交出前自己比對長度），`metrics.m1` 照樣 0.12–0.28，
   跟沒守門的對照組沒有分別。**別再往調 prompt 的方向花時間。**

4. **錨定片段替換把破壞變成一個算得出來的數字。** V3 用
   `oldText`（逐字錨點）→ `newText`。同樣會破壞，但破壞時錨點是**整欄的 100%**；
   真正的局部修改錨點只佔 1–3%。門檻設在 50% 就攔下全部 5 筆破壞、放行 2 筆真修改。
   整段替換沒有這個訊號 —— 短的 `newValue` 可能是合理精簡，程式分不出來。
   理想形狀實例：`V3-ox-alpha-5` 對整份 PRD 只回一筆
   `oldText: "人只在例外時介入。ㄅ"` → `newText: "人只在例外時介入。"`，十個字改掉一個錯字。

## 一併查證出來的三個既有缺陷（都還沒修）

1. **生產送給模型的 PRD 只有三分之一。** `store.ts:3778` 每欄 `.slice(0, 400)`、
   `:3789` 全文 `.slice(0, 6000)`。真實 PRD 13,194 字 → 4,483 字，14 欄裡 8 欄
   被從中間切斷。**現在的 AI 結構審查本來就在審殘篇。** 是獨立真缺陷，該修 ——
   但**修了不會改善縮水**（探測送的就是全文）。
2. **關卡存不下結構化結果。** `store.ts:3921` `agentResult: job.result.slice(0, 4000)`，
   而結構化輸出每份 18–28 KB。存下去必成不合法 JSON。
3. **寫不進去也留不下前後。** 沒有 store API 能對「指定專案的任意 sectionId/fieldKey」
   寫值並留歷史（`setSectionField` 只動 active 專案、不留歷史）。這是 R2 的缺口，
   **R1 不能先於 R2 做**。附帶 `persist()` 的 `catch { /* ignore quota */ }` 會靜默吞掉超額。

## 下一步（全部未拍板，不要直接開工）

1. 拿「錨定 ＋ 涵蓋率閘門」再跑一輪，量閘門的偽陽性（擋掉真正該做的重寫）有多高。
2. 決定門檻與被擋下時的 UI：「這是重寫不是修改，要看全文對照」還是直接不給套用。
3. 這兩條成立之後 R1 才有值得投的形狀，而 R2 的前後紀錄仍必須先落地。
4. R1 兩種架構都會踩到母規格明寫的「不做：逐條勾選套用的 diff UI」，要重新拍板。

## 還沒收的線頭

- **28 題 UAT 報告一個字都沒被寫入**（28/28「未測」）。Scott 說「測完了」但報告是空的。
  **下一個 session 第一句先問**：是 App 沒存回去（那是 UAT 功能本身的 bug），
  還是他沒走報告直接手測？（上一份 handoff 就掛著，本 session 問了但還沒得到答覆）
- **OpenRouter 額度用盡**（HTTP 402）。opus 的樣本只拿到 3 個就是這個原因。
  補額度後可把 opus 補到 n=8。免費替代通道見下。
- **`~/Documents` 的 TCC 權限在 session 中途被 macOS 收回過**（`Operation not permitted`，
  關掉沙箱也一樣），後來由 Scott 手動恢復。再遇到就是去
  系統設定 → 隱私權與安全性 → 檔案與資料夾／完整磁碟取用權。
- 舊帳照舊：對話框遷移的實機 UAT、W3 的 11 題視覺驗收、wave1+2 的 10 題、
  `plans/wave2-spec.md` 檔尾的 P-1～P-6 / B1B2 / S-1～S-7 尚未併進報告。
- ElevenLabs 額度用盡（`quota_exceeded`），語音通知發不出去。

## 這輪學到、值得帶走的四件事

1. **驗地基要拿真資料。** 這次的 PRD 是 Scott 實機 localStorage 裡的
   `Project_Anchorline` 專案本身（8 章 14 欄 13,194 字）。假資料的欄位都是短的，
   `metrics.m1` 那條 3,440 字的裂縫根本不會出現。
   取法：`~/Library/WebKit/dev.anchorline.app/…/localstorage.sqlite3` 的
   `anchorline:state:v6:prod`，值是 UTF-16LE blob。
2. **額度見底時 opencode 是可用的補樣本通道。**
   `opencode run --pure --dir <scratchpad> -m opencode-go/ox-alpha-free`，
   輸出去掉 ANSI 與 `> build · model` 標頭行就是乾淨 JSON。免費，
   代價是慢 5–7 倍（中位 327–440 秒），而且長 payload 會有約 3/10 被截斷，要重試。
3. **長跑不要包 `timeout`、不要接管線。** 第一輪 `timeout 900 bun probe.ts | tail`
   在 15 分鐘被砍，而 `tail` 讓整條管線 **exit 0** —— 看起來像正常結束。
   一律 `run_in_background`。
4. **自己的推論也要被自己的實驗否證。** 報告初版寫「縮水有一半責任在 400 字截斷」，
   而探測送的就是完整全文 —— 這條被自己的資料推翻，已在報告內留下更正而非改寫。
