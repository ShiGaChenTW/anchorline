---
# ─────────────────────────────────────────────────────────────
# 領域包範本 — 複製這個檔，改成你的產業。
#
# 檔名隨意（`insurance.md`、`我的銀行.md` 都可以），真正決定身分的是下面的 `name`。
# `_` 開頭的包不會出現在下拉選單裡，所以這一份自己不會被選到。
#
# 三件事會被領域包改變：
#   1. sections — PRD 多出哪些章節
#   2. gates    — 哪些條件沒滿足就擋簽核（可重播、決定性）
#   3. prompt   — AI 助教與草稿生成時，疊在最前面的領域知識
# ─────────────────────────────────────────────────────────────

name: _template                    # 必填。英數與底線，這是專案存的識別碼，改了等於換一個領域
displayName: 領域包範本            # 必填。下拉選單顯示的名字
industry: 你的產業                 # 選填。目前只當標籤，不影響行為
extends: _base                     # 選填。只允許一層，通常就是 _base

# 疊在 system prompt 最前面。寫「必須涵蓋什麼」與「引用哪些法規」，
# 不要寫「請寫得專業一點」——那種話模型本來就會做。
prompt: |
  你是一位熟悉〈你的產業〉的資深產品經理。
  這份 PRD 的對象是〈產品類型〉。以下面向必須涵蓋：

  1. 〈法規或標準名稱與條號〉
  2. 〈第二個必須涵蓋的面向〉

  引用法規時寫出具體條號或函令名稱，不要只說「依相關規定」。

# 新增的章節。接在通用 7 章之後，所以編號從 "08" 開始。
# 同 id 會覆寫通用章節的欄位（少用——通常你只是想加，不是想改）。
sections:
  - id: your_section               # 必填。英數與底線。gates 用這個 id 指過來
    n: "08"                        # 顯示編號。不要跟既有章節重號
    title: 你的章節標題
    desc: 副標 · 用 · 分隔
    guide: 寫給使用者看的一段指引。說清楚「寫成什麼樣算合格」，不要只說「請填寫」。
    tips:
      - 一條具體的提醒
      - 另一條（這些會變成空白章節的起手骨架）
    example: 一個具體到可以照抄改寫的短例子。
    fields:
      - key: your_field            # 必填。同一章節內不可重複
        label: 欄位名稱
        hint: 提示文字（灰字）
        type: textarea             # textarea 或 text
        rows: 5
    checks:                        # 選填。人工勾選的自我檢查清單
      - id: c1
        label: 一條可以自己確認的事
        pass: false

# 擋簽核的硬規則。只有四種 predicate，刻意不做布林組合——
# 需要判斷力的東西交給 AI 助教出建議，不要塞進這裡。
#
#   { kind: present }                       欄位都不可空白
#   { kind: minLength, n: 30 }              文字長度下限
#   { kind: match, re: "正規表達式", flags: i }   要命中
#   { kind: bullets, min: 3 }               列點條目數下限（沒有列點符號時退回用 ; ； 換行 切）
#
# level: block 擋送審與簽核 / warn 只提醒
# detail 可用 {count}（實際計數）與 {missing}（未填欄位）兩個佔位符
gates:
  - rules:
      - id: your-rule-id           # 必填。全域唯一
        level: block
        label: 沒寫〈某個必要的東西〉
        detail: 說明為什麼這件事非寫不可，以及要寫成什麼樣
        section: your_section
        fields: [your_field]       # 省略 = 整章欄位合併判定
        require: { kind: match, re: "關鍵字|另一個關鍵字" }
    pass:                          # 選填。通過時給一句正面回饋
      id: your-rule-id-ok
      label: 〈某個必要的東西〉已寫
      detail: 偵測到對應敘述

# 只給寫作教練看的軟提示。不進 gate、不影響任何人能不能送審。
# 語法與 gates 完全相同——想提醒但不想擋的，放這裡。
hints:
  - rules:
      - id: your-hint-id
        level: warn
        label: 〈某段〉可以再具體一點
        detail: 建議補上數字或期限
        section: your_section
        fields: [your_field]
        require: { kind: minLength, n: 40 }
---

正文不會被使用。所有語意都在上面的 frontmatter 裡——
刻意不留 body，避免重蹈 prd-agent 的 D-1（模板正文載入後從未進 prompt）。

## 怎麼用

1. 複製這個檔到你的領域包資料夾，改名（例如 `insurance.md`）
2. 至少改掉 `name` / `displayName` / `prompt`，其他先刪掉也能跑
3. 偏好設定 →「領域包」→ 選擇資料夾（或按「重新讀取」）
4. 新建專案時就能選到它

寫壞了不會讓 App 開不起來：解析失敗的檔會在偏好設定裡列出檔名與原因，
其他領域包照常運作。
