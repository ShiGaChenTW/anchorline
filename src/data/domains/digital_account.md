---
name: digital_account
displayName: 數位帳戶 / 數位銀行
industry: fintech
extends: _base
prompt: |
  你是一位熟悉台灣銀行業實務的資深 FinTech 產品經理。
  這份 PRD 的對象是台灣的數位帳戶 / 數位銀行產品。以下法遵面向必須涵蓋：

  1. KYC 第一／二／三類帳戶的差異，以及各類對應的業務權限與額度限制
  2. AML 交易監控門檻，與可疑交易通報（STR）的觸發條件與負責人
  3. 個資法第 27 條的安全維護義務，以及告知、同意、最小蒐集三原則
  4. 金管會數位帳戶相關函令
  5. 聯徵中心通報義務

  引用法規時寫出具體條號或函令名稱，不要只說「依主管機關規定」。

sections:
  - id: kyc_aml
    n: "08"
    title: KYC / AML 合規要點
    desc: 身分驗證 · 風險等級 · 交易監控
    guide: 明確寫出身分驗證流程走到哪一類帳戶、各風險等級對應什麼差異化措施、交易監控的門檻與觸發後的處理路徑。只寫「符合法規」等於沒寫。
    tips:
      - 風險等級要對應到可執行的差異化措施，不是標籤
      - STR 通報門檻與負責人要寫明，含觸發後的時限
      - 寫出哪些情境會降級或凍結帳戶
    example: "第二類帳戶：非臨櫃開戶，轉出上限 5 萬/日；命中名單或短期多筆拆單時降級為第三類並人工複核。"
    fields:
      - key: identity_flow
        label: 身分驗證流程
        hint: 走到第幾類帳戶 · 各類的權限與額度
        type: textarea
        rows: 6
      - key: monitoring
        label: 交易監控規則
        hint: 門檻 · 觸發條件 · 處理路徑
        type: textarea
        rows: 5
      - key: str
        label: STR 通報要點
        hint: 每行一條（門檻／負責人／時限）
        type: textarea
        rows: 4
    checks:
      - id: c1
        label: 三類帳戶的權限差異已寫明
        pass: false
      - id: c2
        label: 監控門檻可量化
        pass: false

  - id: privacy_security
    n: "09"
    title: 個資保護與資安要求
    desc: 個資法 §27 · 蒐集最小化 · 加密與稽核
    guide: 對應個資法第 27 條的安全維護義務，並寫出蒐集了哪些個資、為什麼需要、保存多久、誰能存取。
    tips:
      - 逐項列出蒐集的個資欄位與其必要性
      - 寫出保存期限與屆期處理
      - 存取控制與稽核軌跡要指名到角色
    example: "身分證影像僅於開戶驗證期間保存 30 日，加密落地，僅法遵角色可調閱且留下稽核紀錄。"
    fields:
      - key: pii_scope
        label: 蒐集範圍與必要性
        hint: 欄位 · 用途 · 保存期限
        type: textarea
        rows: 6
      - key: safeguards
        label: 安全維護措施
        hint: 對應個資法第 27 條
        type: textarea
        rows: 5

  - id: regulatory_filing
    n: "10"
    title: 主管機關申報事項
    desc: 金管會 · 聯徵 · 洗錢防制中心
    guide: 列出這個產品會觸發哪些申報或通報義務，各自的對象、頻率與負責角色。漏一個就是上線後才發現。
    tips:
      - 每行一個機關，寫出通報事由與頻率
      - 標註哪些是上線前必須完成的
    example: "• 金管會：數位存款帳戶開辦前函報 • 聯徵：新開戶通報，T+1 • 洗防中心：STR 個案通報"
    fields:
      - key: filings
        label: 申報／通報清單
        hint: 每行一個機關（事由 · 頻率 · 負責角色）
        type: textarea
        rows: 6

stages:
  # 金融四包共用的追加關卡。名字必須與其他三包**逐字相同** ——
  # resolveWorkflow 的去重鍵是名字，差一個空格就會變成兩個長得一樣的關卡。
  - id: ws-fin-compliance
    order: 1
    name: 金融法遵與風險
    defaultAssigneeId: null
    required: true
    mode: sequential
    kind: review
    defaultActor: agent

gates:
  - rules:
      - id: kyc-risk-tiers
        level: block
        label: KYC 缺風險等級對應
        detail: 需寫出第一／二／三類帳戶的差異與對應權限
        section: kyc_aml
        fields: [identity_flow]
        require: { kind: match, re: "第[一二三]類|KYC ?[123]|風險等級", flags: i }
    pass:
      id: kyc-risk-tiers-ok
      label: KYC 風險等級已對應
      detail: 偵測到帳戶分類或風險等級敘述

  - rules:
      - id: kyc-monitoring-threshold
        level: warn
        label: 交易監控缺可量化門檻
        detail: 建議寫出金額或次數門檻，而非「異常時」
        section: kyc_aml
        fields: [monitoring]
        require: { kind: match, re: "\\d+\\s*萬|\\d+\\s*筆|\\d+\\s*%|門檻" }

  - rules:
      - id: aml-str-items
        level: warn
        label: STR 通報要點不足
        detail: 目前 {count} 條，建議至少 2 條（門檻與負責人）
        section: kyc_aml
        fields: [str]
        require: { kind: bullets, min: 2 }

  - rules:
      - id: privacy-art27
        level: block
        label: 未對應個資法第 27 條
        detail: 安全維護措施需明確對應個資法第 27 條
        section: privacy_security
        fields: [safeguards]
        require: { kind: match, re: "第\\s*27\\s*條|個資法" }
    pass:
      id: privacy-art27-ok
      label: 已對應個資法
      detail: 偵測到個資法條號引用

  - rules:
      - id: filing-coverage
        level: warn
        label: 申報清單可能不完整
        detail: 目前 {count} 項，數位帳戶通常至少涵蓋金管會、聯徵、洗防中心三方
        section: regulatory_filing
        fields: [filings]
        require: { kind: bullets, min: 3 }
---

數位帳戶領域包。章節接在通用 7 章之後（08–10）。

刻意不把 prd-agent 那 9 個 `required_sections` 全部搬過來：其中 6 個
（產品概述／目標客群／使用者旅程／功能規格／成功指標／風險）在 Anchorline
已有對應的通用章節，重複開一份只會讓同一件事有兩個地方可寫。真正沒有
對應物的只有 KYC/AML、個資保護、主管機關申報這三個——所以只加這三個。
