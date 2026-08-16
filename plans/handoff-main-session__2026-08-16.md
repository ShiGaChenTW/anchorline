# Handoff — main session（Miles）交接

**交棒人：** Miles（main session）· 2026-08-15 深夜 → 08-16 凌晨
**接棒人：** 你 —— 接手 main session 的協調角色：對 Scott 彙報、守關卡、派工給 agent。
**上一份：** `plans/handoff-main-session__2026-08-15.md`（W3 收尾那一輪）

---

## 一句話現況

這一輪主線不在 Anchorline 而在 **LifeOS 的多代理路由開關**（四條獨立血統的產出車道 + 會真的擋人的配額閘門）；
Anchorline 是它的第一個實戰場：**36→實為 34 處原生對話框全部遷移到 App 內 helper，已合併並推上 `origin/main`**，
`main` = `95e0497`，tsc 乾淨、**1229 測試全綠**。
**現在卡在等 Scott 做實機 UAT** —— 對話框行為幾乎零自動化覆蓋，測試證不了。

---

## Anchorline：這一輪做了什麼

`main` 上的四個 commit（`dfbc355` 合併點 → `61b3aaf` → `95e0497`）：

| commit | 內容 |
|---|---|
| `d98fb6d` | 新增 `src/lib/ask.ts`（`askConfirm`/`askText`/`showAlert`）＋ `tests/ask.test.ts` 15 筆 |
| `84cd7fd` | `escapeHtml` 沿用 `ui.ts`，不新增第五份複本 |
| `0cb3a64` | 遷移 33 處呼叫點 |
| `5a36942` | 遷移最後一處 `confirmLeaveFile`＋新增 `switchSectionForced` |
| `61b3aaf` | **修 critical**：`openFileInEditor` 漏 `await`，守門形同虛設 |
| `95e0497` | **修 critical**：對話框開啟時隔離鍵盤事件、文字輸入自動取得焦點 |

**修的是什麼 bug：** `tauri-plugin-dialog` 把 `window.confirm` 蓋成 async 恆真函式，
全 App 每個 `if (!confirm(...)) return` 守門失效。2026-08-14 實測編輯台按 ✕ 無聲刪掉子章節，根因就是這個。

規格在 `plans/spec-dialog-migration.md`（含決定集、測試策略、數字更正紀錄）。

### ⚠️ 這批東西是「先合再審」進 main 的

Jules（Relay）只能讀預設分支，要讓它審就得先合。Scott 知情並選了這條路。
合併訊息裡有退回指令：`git revert -m 1 dfbc355`。

---

## 立刻要做的：Scott 的實機 UAT

**還沒出 UAT 題目。** 這是接棒後第一件事——用 `Skill("Uat")` 產出，重點題目：

1. **編輯台按 ✕ 刪子章節** —— 8/14 那個 bug 的原案，必須真的跳確認框
2. **開著檔案且有未存變更時，點檔案樹另一個檔** —— `61b3aaf` 修的那條路徑
3. **AI 撰寫面板按 Escape** —— `95e0497` 修的那條，過去會把面板拆掉且流程永久卡死
4. **抽單理由對話框** —— 焦點要在輸入框且文字被選取，不是停在「確認」鈕上
5. **`danger` 樣式** —— 22 處破壞性確認鈕應為紅底（`.btn-warn-confirm`）
6. **設定頁的四個對話框** —— 它在 iframe 內，對話框會對著 iframe 視埠定位（已知視覺缺陷，要確認可不可接受）

UAT 全過才可以拆 `src/lib/auth.ts` 的 `delete window.confirm` workaround——**那是最後一步，現在動會炸**。

---

## Anchorline 未收的線（依優先度）

| # | 項目 | 來源 |
|---|---|---|
| 1 | **實機 UAT**（見上） | 阻擋所有後續 |
| 2 | 拆 `auth.ts` workaround | 要等 1 |
| 3 | `templates.ts:639, 700` 跨 `await` 重讀模組層級可變狀態（`current` / `editingPack`）。TS 已知不健全性，tsc 抓不到 | Relay 稽核 LOW |
| 4 | `templates.ts:752-755` 三個連續對話框，長按 Enter 自動走完 | Relay 稽核 LOW |
| 5 | `.modal-back` z-index 40 低於 `.load-back` 350／`.awc-back` 360／`.set-modal-back` 400 —— 未來對話框可能疊在下面 | Relay 稽核 LOW |
| 6 | Anchorline 沒有 DOM 測試環境（63 檔零個碰 DOM），對話框只能靠 UAT | 獨立的票 |
| 7 | 舊帳：W3 的 11 題視覺驗收＋wave1+2 的 10 題 | 上一份 handoff |

---

## LifeOS：這一輪建立的東西（跨專案，會影響你怎麼派工）

### 路由開關（`~/.claude/CLAUDE.md` → `### Agent Routing Switch`）

取代了舊的「E3+ 必含 Forge」單條規則。**派工前先跑閘門**：

```bash
bun ${LIFEOS_DIR}/TOOLS/AgentQuota.ts --json
```

`routable: false` 的代理出局，走備援鏈 **Forge → Bellows → Relay → Engineer**。

四條線的現況（截至 08-16 凌晨）：

```
🔴 Forge (codex)    OpenAI    額度用盡 → 8/20 才回血
🔴 Cato (codex)     OpenAI    與 Forge 共用同一池，一起空
🟢 Bellows (Grok)   xAI       59% SuperGrok → 8/19 重置
⚪ Relay (Jules)    Google    已登入，~75 tasks/日
🚫 Anvil (Kimi)     Moonshot  無金鑰（Scott 決定不補）
```

**新代理定義：** `~/.claude/agents/Bellows.md`（xAI 量產，`--worktree` 原生隔離）、
`~/.claude/agents/Relay.md`（Google 非同步，不佔終端）。

### 三條會咬人的限制

1. **Relay 選不了分支。** `jules remote new` 只有 `--repo`/`--session`/`--parallel`。
   要它做的事必須先在預設分支上。這條就是「先合再審」的原因。
2. **Cato 不是獨立審查者。** 它跑 `codex exec`，Forge 空它就空。
   規則已改為「審查者＝任一未參與實作的廠商」，並明說**找不到合格審查者時要說出來，不要讓實作者自審**。
3. **Bellows 的 `maxTurns` 已從 30 提到 80。** 上一次它在「做完 35 處但沒 commit 沒驗證」的狀態下耗盡預算而死——
   未驗證的變更看起來跟驗證過的一模一樣，那是最糟的死法。準則已補「做完就 commit」。

### Session 長度提醒（新）

`~/.claude/hooks/SessionLength.hook.ts`，掛 `UserPromptSubmit`。
transcript 過 1.5／3.0／5.0 MB 各提醒一次（可用 `LIFEOS_SESSION_*_MB` 覆寫）。
**這份 handoff 就是它觸發的。**

### LifeOS 未收的線

- **`RouterSystem.md` 說 E1–E5 效力層級已於 2026-07-11 退役**，但 CLAUDE.md 的 `/e1`–`/e5` 還在、
  session hook 每輪還輸出 `TIER: E3`，而且那個 hook **每輪都噴 `unknown level 'standard'` 的推論錯誤**。
  新路由開關的「難度」信號建立在 E1–E5 上，需要釐清它到底算不算現行制度。
- `LIFEOS_CLAUDE_BLOCK_TOKEN_LIMIT` 未設，閘門的 Claude 那格還是原始 token 數不是百分比。
- 脈絡量「>200K」目前靠目測，該補進 `AgentQuota.ts`。
- Antigravity CLI 裝了但啟動方式不明（`~/.gemini/antigravity-cli/` 有 token 與 8/15 的 history，
  但 app 不在 `/Applications` 也不在 `~/Applications`）。

完整建置紀錄與決策理由：`~/.claude/LIFEOS/DOCUMENTATION/Router/2026-08-16-AgentRoutingSwitch-BuildLog.md`

---

## 給接棒者的三個提醒

1. **這一輪外部審查抓到 6 個我自己的錯**（漏 `await`、數字數錯、註解位置錯、規格自相矛盾、
   agent 定義的 model id 錯、把「讀不到」當成「不能用」兩次）。
   兩道自動化關卡（tsc + 1229 測試）**全部放行了那個 critical**。
   結論不是「要更小心」，是**跨廠商審查那條規則值得守**。
2. **Anchorline 的 `plans/` 有納入版控**，寫在那裡的東西會進 commit。
3. **`main` 目前乾淨且與 origin 同步**（`95e0497`）。動之前先 `git fetch` 確認。
