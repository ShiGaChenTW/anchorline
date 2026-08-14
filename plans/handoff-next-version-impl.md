# Handoff — 下一版實作（Wave 1 + Wave 2）

**交棒人：** Miles（main session）· 2026-08-15
**接棒人：** 本 worktree 的 Claude Code —— 你是這一輪的 **PM**
**規格來源：** `docs/NEXT-VERSION-PLAN.md`（Grok × Codex 圓桌彙整，含每項的檔案行號切入點與裁決紀錄）
**背景敘事版：** `docs/next-version-plan.html`（給 principal 讀的，你也可以讀來抓輕重）

## 任務

實作 NEXT-VERSION-PLAN 的 **Wave 1（正確性止血）與 Wave 2（UAT 迴圈補全）**，
依計劃裡的「建議出貨順序」推進。Wave 3 的 W3-1（updater）做完前兩波還有餘裕再做；
W3-3（011 gate）**不做**——等 principal 裁決。

## 你的工作方式（沿用 opaleye 輪的成功模式）

你是 PM，不是唯一寫手。判準級 / parser 級的決策**親自寫**（例：W2-3 supersede 的
preamble 欄位、W1-3 的 governance subject 第二形狀），其餘派工：

- **Forge**（`Agent(subagent_type="Forge")`，GPT-5.4 via codex exec）— 純函式、測試、
  突變測試。repo 規則：他寫的測試要能抓到你埋的 bug 才算數。
- **Engineer**（Claude coder，`Agent(subagent_type="Engineer")`）— UI 落地
  （tracking / overview / rail-nav 的畫面改動）。
- **GrokResearcher** — 每一波完成後的第二眼缺口審查（他上一輪抓到 3 個真缺陷，
  用同樣的「讀碼挑戰清單」格式）。
- **Cato** — 全部完成後的收尾審計（read-only，structured findings）。

## 鐵則（違反任何一條就不算完成）

1. **W1-1 動手前先實機重現**——那條遺失路徑是 Codex 讀碼推導，還沒被目擊過。
   重現不了就記錄過程並回報，不要修一個不存在的 bug。
2. **W2-5（a11y）先用 Accessibility Inspector / Interceptor 定位成因再動手**，
   驗收必須看 AX 樹，截圖與 grep 不算證據（計劃裡寫明兩個候選假設）。
3. 每項出貨前：`bunx tsc --noEmit` ＋ `bun test`（基準 1048）＋（動 Rust 時）
   `cargo test` 全綠。UI 改動用 Interceptor 在自己的 dev server 驗
   （**專用埠 `--strictPort`，別碰 5173** —— 見 repo CLAUDE.md）。
4. **W1-3 改判準會讓歷史覆蓋率數字跳一次**——畫面上要講出來，不能讓使用者
   以為資料壞了。守 D10a：不給 openspec 檔案塞 anchor。
5. **版號 dogfood（W3-2）從第一個 commit 就開始**：在安裝版 App 的版本取號頁
   替這一輪取號（strict 政策：ZZ 小修或 YY 走 openspec），照它的流程編列、
   放行、PUSH——這本身就是 W3-2 的交付。卡住的地方就是 bug，記下來。
6. Commit 訊息照 repo 慣例（主旨講改了什麼、內文講為什麼；計劃步驟帶
   `anc:t=` 錨點就寫進 subject）。
7. 完成後：**開 PR 回 main（不要直接推 main）**，用 `orca` 或
   cross-session 訊息通知 main session（Miles），並用 Uat skill 替這一輪
   出一份實測清單給 principal。

## 順序（照計劃的建議出貨順序）

W1-1 說明草稿遺失（P0，先重現）→ W1-2 mousedown guard → W1-6 中文檔名 →
W2-3 supersede（preamble 限縮版）→ W2-2 收工歸檔 → W2-1 跨專案收件匣 →
W1-3 治理計分 → W1-5 badge invalidate → W2-5 a11y → W1-4 js_dialogs 硬化 →
W1-7 CRLF ＋ W1-8 刪重複 stat →（餘裕才做）W3-1 updater。

W2-4（失敗題落地成工作項）是 M 級且要設計——**先寫設計段落給 main session
過目再動工**，不要直接開寫。

## 追蹤

開工時在 `plans/` 建追蹤文檔（repo CLAUDE.md 的觸發規則），逐項勾選、
記錄裁決；Grok/Cato 的審查結果進決策紀錄，不另開檔。
