---
name: insurance
displayName: 保險 / 保代
industry: fintech
extends: _base
prompt: |
  你是一位熟悉台灣保險實務的資深產品經理。
  這份 PRD 的對象是台灣的保險商品或保經代平台。以下面向必須涵蓋：

  1. 保險法第 148 條之 1 的資訊揭露義務
  2. 招攬人員登錄與資格（保險業務員管理規則）
  3. 要保書告知義務與據實說明，以及未告知的契約效果
  4. 不保事項與除外責任——理賠爭議最大宗的來源
  5. 契約撤銷權（收到保單翌日起 10 日內）

  引用法規時寫出具體條號，不要只說「依保險法規定」。

sections:
  - id: policy_terms
    n: "08"
    title: 保單條款要點
    desc: 承保範圍 · 不保事項 · 契約撤銷
    guide: 承保什麼、不承保什麼、以及客戶在什麼情況下可以反悔。不保事項寫得含糊，上線後就是理賠爭議。
    tips:
      - 不保事項逐條列出，不要用「等」字收尾
      - 契約撤銷權的起算日與期限要寫明
      - 除外責任與不保事項是兩件事，分開寫
    example: "不保事項：• 故意行為 • 犯罪行為所致 • 未告知既往症於等待期內發生者。契約撤銷：收到保單翌日起 10 日內。"
    fields:
      - key: coverage
        label: 承保範圍
        hint: 保什麼 · 給付條件 · 等待期
        type: textarea
        rows: 5
      - key: exclusions
        label: 不保事項
        hint: 每行一條
        type: textarea
        rows: 6
      - key: cancellation
        label: 契約撤銷權
        hint: 起算日 · 期限 · 退費方式
        type: textarea
        rows: 3
    checks:
      - id: c1
        label: 不保事項逐條可讀，沒有用「等」收尾
        pass: false

  - id: solicitation
    n: "09"
    title: 招攬與告知義務
    desc: 業務員登錄 · 要保書告知 · 揭露
    guide: 誰可以賣、賣的時候必須說什麼、客戶必須告知什麼。這一段對應的是裁罰，不是體驗。
    tips:
      - 招攬人員的登錄狀態要能在流程中驗證
      - 告知事項未據實的契約效果要寫出來
    fields:
      - key: licensing
        label: 招攬人員資格與驗證
        hint: 登錄查核方式
        type: textarea
        rows: 4
      - key: disclosure
        label: 揭露與告知義務
        hint: 對應保險法第 148 條之 1
        type: textarea
        rows: 5

gates:
  - rules:
      - id: ins-exclusions
        level: block
        label: 不保事項不足
        detail: 目前 {count} 條。不保事項是理賠爭議最大宗，必須逐條列出
        section: policy_terms
        fields: [exclusions]
        require: { kind: bullets, min: 3 }
    pass:
      id: ins-exclusions-ok
      label: 不保事項已逐條列出
      detail: 偵測到足夠的條目

  - rules:
      - id: ins-cancellation
        level: block
        label: 未寫契約撤銷權
        detail: 需寫出起算日與期限（收到保單翌日起 10 日內）
        section: policy_terms
        fields: [cancellation]
        require: { kind: match, re: "撤銷|10\\s*日|十日|翌日" }
    pass:
      id: ins-cancellation-ok
      label: 契約撤銷權已寫
      detail: 偵測到撤銷期限敘述

  - rules:
      - id: ins-disclosure-148
        level: block
        label: 未對應保險法第 148 條之 1
        detail: 資訊揭露義務需明確對應法源
        section: solicitation
        fields: [disclosure]
        require: { kind: match, re: "148|保險法" }

  - rules:
      - id: ins-licensing
        level: warn
        label: 招攬人員資格驗證未寫
        detail: 登錄狀態要能在流程中查核，不能只寫「由業務員銷售」
        section: solicitation
        fields: [licensing]
        require: { kind: minLength, n: 20 }

hints:
  - rules:
      - id: ins-waiting-period
        level: warn
        label: 承保範圍可能缺等待期
        detail: 建議寫明等待期，這是客訴常見來源
        section: policy_terms
        fields: [coverage]
        require: { kind: match, re: "等待期|觀察期|\\d+\\s*[日天月]" }
---

給測試用的範例領域包。這一份**不在** `src/data/domains/`，所以不會編譯進 App——
它是要放進「領域包資料夾」讓 App 從外部讀進來的那種。
