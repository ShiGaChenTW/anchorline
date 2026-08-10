# GitHub PR 是什麼 —— 給 PM 與 AI 開發者的說明

> 寫作背景：`plans/2026-08-09_dev-workbench-upgrade-eval.md` §十一 評估「GitHub 狀態追蹤 · PR 同步」時，需要先把 PR 這個機制講清楚。
> 日期：2026-08-09

---

## 一、一句話

**Pull Request 是一個「請把我這條分支的改動併進主線」的提案，附帶一個公開的討論與審查空間。**

名字有點誤導。它不是「拉取」，是「請求對方拉取」——你在自己的分支上做完事，跟主線說：這些改動我覺得可以進來了，你看一下。

技術上它其實很薄：GitHub 只是拿你的分支和目標分支算一個 diff，然後在那個 diff 旁邊掛上留言、審查狀態、自動檢查結果。**PR 本身不改任何程式碼**，它只是一個「還沒發生的合併」的暫存狀態。真正發生事情的是按下 Merge 的那一刻。

用 PRD 的語言講：**PR 之於 commit，就像送審之於草稿。** 把寫好的東西丟出去、等人蓋章、蓋完才生效——PR 是這件事在程式碼世界的同一個機制。

---

## 二、它解決什麼問題

| 沒有 PR 時 | 有 PR 時 |
|---|---|
| 改動直接進主線，壞了才發現 | 合併前有一道關卡 |
| 「這行為什麼這樣寫」只能問人或考古 | 討論留在 diff 旁邊，永久可查 |
| 測試在你電腦上跑過就算 | CI 自動在乾淨環境跑一次 |
| 一次改 50 個檔，沒人看得動 | 一個 PR 一件事，可審查的單位 |
| 外部貢獻者無法安全參與 | 陌生人可以提案而不需要寫入權 |

**最後一條是 PR 這個機制誕生的原因。** 開源專案不可能給全世界 push 權限，所以要有一個「你可以提議、但由我決定要不要收」的協議。對一個你沒有寫入權的 repo，PR 是唯一的入口。

---

## 三、一個 PR 的生命週期

```
開分支 → 改東西 → push → 開 PR
                              ↓
                      CI 自動跑（checks）
                              ↓
                      人審查 → 留言 → 你改 → 再 push
                              ↓
                      Approve → Merge → 分支刪掉
```

對應的指令：

```bash
git switch -c feat/my-change     # 開分支
# ...改東西...
git commit -am "說明改了什麼"
git push -u origin feat/my-change
gh pr create --fill              # 開 PR（gh CLI）
gh pr view --web                 # 在瀏覽器打開
gh pr merge --squash --delete-branch
```

---

## 四、看懂一個 PR 的狀態

`gh pr list --json` 會給你這幾個欄位，它們就是 PR 的全部狀態：

| 欄位 | 意思 | 常見值 |
|---|---|---|
| `isDraft` | 草稿。還在做，別審 | `true` / `false` |
| `reviewDecision` | 人的審查結論 | `APPROVED` · `CHANGES_REQUESTED` · **空字串＝沒人審過** |
| `statusCheckRollup` | CI 燈。紅的通常不能併 | 陣列；空陣列＝這個 repo 沒有 CI |
| `mergeable` | 有沒有跟主線衝突 | `MERGEABLE` · `CONFLICTING` |
| `createdAt` / `updatedAt` | 開了多久、多久沒動 | ISO 時間 |

**讀法**：`isDraft: false` + `reviewDecision: ""` + `mergeable: "MERGEABLE"` = 這個 PR 完全準備好了，卡點只有「沒人按 Merge」。

---

## 五、四種使用情境

### 1. Agent 產出的守門 ⭐ 這是 2026 年最重要的一種

Claude 或 Codex 一個 session 可以改 40 個檔案。直推 main 等於沒有任何人看過。讓 agent 開 PR、人只審 diff，是目前唯一能規模化的 AI 開發治理方式——**審 200 行 diff，比重讀 40 個檔案便宜一個數量級**。

這也是 PR 這個十幾年前為開源協作設計的機制，在 AI 時代被重新賦予意義的地方：它本來解的是「陌生人的程式碼怎麼安全收進來」，而 agent 正是一個**你無法完全信任、但產能極高的陌生貢獻者**。

> 延伸：GitHub 原生的守門機制（CODEOWNERS、branch protection）只認「人」，不認「這是哪一家 AI 寫的」。要做到「Claude 寫的 PR 不能由 Claude 核准」這種職務分離，得在 GitHub 之外補一層。見升級評估報告 §11.2。

### 2. 對外貢獻

沒有寫入權時的唯一途徑。Fork → 改 → 開 PR → 等維護者。開源世界的標準禮儀。

### 3. 有協作者時的預設流程

兩個人以上改同一個 repo，PR 是最低成本的「不要互相踩到」機制。單人專案這條權重很低。

### 4. 給自己一個暫停點

單人也可以開 PR——不是為了給別人審，是為了**在合併前強迫自己看一次完整 diff**，順便讓 CI 跑一輪。缺點是慢。

---

## 六、什麼時候「不」該用 PR

這一段通常沒人講，但對單人開發者最重要。

**個人小工具直推 main 是對的。** PR 對單人專案的成本是真實的：每次多開分支、多開 PR、多按一次 Merge，而審查的人還是你自己。一個 repo 幾十個 commit 零個 PR，不是缺點，是合理的成本判斷。

**兩種情況值得改**：

1. **agent 一次改超過十來個檔案** —— 那個量不開 PR 就等於沒看
2. **任何有外人會看的 repo** —— 包括潛在雇主、客戶、開源使用者

**還有一個心理成本要算**：PR 本質上是一個**刻意製造的開放迴圈**。你開了它，它就在那裡等你回來處理。對多數團隊，那個迴圈的價值大於成本；對容易「開很多坑收不完」的人，每開一個 PR 就是多欠一筆。

所以如果要做 PR 追蹤工具，它的定位不該是「鼓勵你多開 PR」，而該是**還債提醒**——把那些開著沒人理的迴圈拉回視野。

---

## 七、常見誤解

| 誤解 | 實際 |
|---|---|
| 「PR 會改動程式碼」 | 不會。PR 只是一個暫存的提案，Merge 才改 |
| 「Merge 一定要 Approve」 | 不一定。除非設了 branch protection，否則自己就能併 |
| 「PR 一定要有 CI」 | 不一定。沒有 `.github/workflows` 的 repo，checks 就是空的 |
| 「Draft PR 沒有用」 | 有用。它是「我在做這個、還沒好」的公開宣告，避免撞車 |
| 「PR 越大越有效率」 | 相反。大 PR 沒人審得動，最後變成橡皮圖章 |
| 「Merge 完分支要留著」 | 刪掉。留著只會讓分支列表變成墓園 |

---

## 八、Merge 的三種方式

按下 Merge 前會讓你選，差別在 git 歷史長什麼樣：

| 方式 | 主線上留下 | 適合 |
|---|---|---|
| **Merge commit** | 所有 commit + 一個合併節點 | 想保留完整開發過程 |
| **Squash and merge** | **一個** commit | 大多數情況。PR 內的 20 個「修一下」不需要進主線 |
| **Rebase and merge** | 所有 commit，線性無合併節點 | 想要乾淨線性歷史，但會改寫 commit hash |

**預設建議 squash。** 一個 PR = 一件事 = 主線上一個 commit，`git log` 才讀得動。

---

## 九、給這個專案的結論

升級評估報告 §十一 的判斷，濃縮成三句：

1. **PR 追蹤的價值不在單一 repo，在跨 repo。** 單一專案可能零個 PR，但橫跨所有 repo 就會浮出「有幾個開著沒人理」。
2. **只讀，不寫。** `gh pr review --approve` 跟 `git push` 是同一類不可逆的對外動作。工具應該產生建議、由人自己執行——這是 `src/lib/git-doctor.ts` 已經立過的界線。
3. **PR 是治理鏈缺的那一段。** `PRD → gate → 簽核 → ??? → release`，中間站著 PR，而 PR 正是「人類審查」與「agent 產出」的交界點。

---

## 附錄：常用 gh 指令

```bash
gh pr list                          # 這個 repo 的 open PR
gh pr list --state all --limit 10   # 含已關閉的
gh pr view 1                        # 看 PR #1
gh pr view 1 --web                  # 在瀏覽器打開
gh pr checks                        # 看 CI 狀態
gh pr create --fill                 # 用 commit 訊息自動填 PR 標題/內文
gh pr merge --squash --delete-branch

# 跨 repo：你所有還開著的 PR（PR 雷達的核心指令）
gh search prs --author=@me --state=open --json repository,number,title,updatedAt
```

`gh search` 走 Search API，限制 30 req/min，比一般 REST 嚴——輪詢週期別短於 60 秒。
