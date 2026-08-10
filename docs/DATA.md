# 資料落在哪裡

這個 App 會在你的專案資料夾裡寫東西。**只有一個地方，而且只寫一種檔。**

---

## `<專案>/.anchorline/`

```
.anchorline/
├── .gitattributes        # *.jsonl merge=union（只在缺檔時種下，不覆寫）
└── log/
    ├── 2026-08.jsonl     # 稽核軌跡，append-only，按月分片
    └── 2026-09.jsonl
```

除此之外，App **不會**在你的專案裡建立任何檔案。`plans/*.md` 的勾選是修改
既有檔案的一個字元（見下）。

---

## 為什麼是 JSONL，不是 SQLite

|                             | JSONL | SQLite       |
| --------------------------- | ----- | ------------ |
| git 可 diff                 | ✅    | ❌ 二進位    |
| agent 用一行 shell 就能追加 | ✅    | ❌ 要 driver |
| 壞掉的影響範圍              | 一行  | 整個檔       |
| 查詢效能                    | 全掃  | 索引         |

單人專案的量級（< 10 萬筆）換不到查詢優勢，卻換來「二進位進 git」和
「agent 寫不進去」兩個真痛。

**SQLite 的正確位置是可拋棄的衍生索引**：由 JSONL 重建、進 `.gitignore`、
可隨時刪。那樣它是加法不是遷移。目前還不需要。

## 為什麼按月分片

git 每次 commit 存整顆 blob。一個持續長大的單檔每天 commit 一次會讓 repo 爆炸。

量級推估：agent 是主要開發者，掛上 hook 後每專案每日 300–1000 筆、約 200 B/筆
→ **每年 20–70 MB／專案**。月分片同時解決 git 膨脹、掃描邊界、保存期限。

## `merge=union`

append-only 的檔在分支合併時 **100% 衝突在檔尾**。事件自帶時間戳可重排，
所以 union 合併是一行解法：

```
*.jsonl merge=union
```

App 只在 `.anchorline/.gitattributes` 不存在時種下它，**不覆寫你改過的設定**。

---

## 進不進 git？

**預設不進。** 根目錄的 `.gitignore` 有：

```
.anchorline/log/
```

原因見 [`SECURITY.md`](SECURITY.md) §4：append-only 的機密洩漏刪不掉。

三個選項，你自己決定：

| 選項                   | 適合                                                  |
| ---------------------- | ----------------------------------------------------- |
| **(a) 全進 git**       | 你確定 payload 白名單夠嚴，而且想要完整可 diff 的歷史 |
| **(b) 全不進**（預設） | 只當本機稽核軌跡，要對外時才匯出脫敏摘要              |
| **(c) 分兩份**         | 脫敏摘要進 git，完整原始流留本機。**建議**            |

要改成 (a)，把那行從 `.gitignore` 拿掉之前，先讀一次
`src/lib/event-log.ts` 的 `PAYLOAD_ALLOW`，確認裡面沒有你不想公開的欄位。

---

## 事件長什麼樣

```jsonc
{
  "v": 1, // schema 版本，append-only 格式的唯一逃生口
  "event_id": "01K2Q9V4B7XM8N", // 去重鍵。hook 會重複觸發
  "ts": "2026-08-09T14:23:11Z", // ISO-8601 UTC，不存時區
  "project": "my-app",
  "actor": { "kind": "agent", "family": "claude", "name": "Claude" },
  "run_id": "01K2Q9…", // 一次 agent session（選填）
  "kind": "task.done",
  "subject": "anc:t=HNTPRY5R", // join key：task id / section id / commit hash
  "ref": "https://github.com/o/r/commit/abc123", // 選填
  "payload": { "title": "補上穩定錨點" }, // 走欄位白名單
}
```

`subject` 是整條軌跡串得起來的原因：同一個 task 的編輯、commit、簽核、PR
全部掛在同一個值上。

**錨點宣稱的是「連結」，不是「等價」。** 它說「這件事是為了那個步驟做的」，
不說「這件事就等於那個步驟描述的內容」。兩者會漂移 —— 開始做 X、途中發現 Y
才是真正該做的、於是做了 Y。那不是造假，那是工程。

所以這裡**不做語意比對**。自動判斷會在多數（正當的）漂移上誤報，而一個常常
誤報的警告會被學會忽略，然後連真的那次也一起錯過。改成兩件便宜的事：
軌跡把「計劃說要做什麼」與「實際做了什麼」並排顯示，判斷交給讀的人；
交接 prompt 要求 agent 自己說明差異 —— 實測它們本來就會講。

## 誰會寫進去

| Writer             | 觸發                                                        |
| ------------------ | ----------------------------------------------------------- |
| App 內動作         | 送審／核准／抽單／取號／勾選步驟                            |
| Claude Code hook   | agent 每次編輯（你自己裝，App 只提供指令）                  |
| `bun run backfill` | 把既有 git 歷史回填成事件（冪等，`event_id` = commit hash） |

---

## 另一個會被改的東西：`plans/*.md`

在 Task Tracking 勾一個步驟時，App 會改你的 plan 檔——**只改那一行的方框字元**，
其餘一字不動（不重新產生 markdown，那會把你手寫的縮排與註解正規化掉）。

寫入前一律**重讀磁碟並比對內容雜湊**。如果 agent 在你讀取到寫入之間動過同一份
檔案，寫入會被擋下並告訴你發生了什麼（「新增 3 個步驟」），一個位元組都不會寫。

實作與測試：`src/lib/plan-writer.ts`、`tests/plan-writer.test.ts`。

---

## App 自己的設定

介面偏好、專案清單、PRD 內文存在 WebView 的 `localStorage`，key 前綴 `anchorline:`。
那是 App 的資料，不是你的專案資料——刪掉只會回到初始狀態，不會動到磁碟上的檔案。
