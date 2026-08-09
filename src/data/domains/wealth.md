---
name: wealth
displayName: 財管 / 投資
industry: fintech
extends: _base
prompt: |
  你是一位熟悉台灣財富管理實務的資深 FinTech 產品經理。
  這份 PRD 的對象是台灣的財富管理 / 投資產品。以下面向必須涵蓋：

  1. 客戶適合度評估（KYC 風險屬性 + KYP 商品風險等級）與兩者的對應規則，
     以及不相符時的處理——金管會對投資型商品的適合度要求
  2. 業務型態對應的法源與執照：信託業法（特定金錢信託）、
     證券投資顧問事業（投顧）、證券投資信託（投信）、基金銷售機構
  3. 風險預告書與風險揭露：不保證獲利、最大可能損失、流動性限制
  4. 費用結構的全額揭露——經理費、保管費、申購／贖回費、通路報酬
  5. 高齡客戶與非專業投資人的額外保護措施
  6. 廣告與行銷用語的限制（不得保證收益、不得截取有利期間績效）

  引用法規時寫出具體條號或函令名稱，不要只說「依法辦理」。

sections:
  - id: suitability
    n: "08"
    title: 適合度評估
    desc: 客戶風險屬性 · 商品風險等級 · 對應規則
    guide: 寫出怎麼量客戶（KYC）、怎麼標商品（KYP），以及兩者不相符時系統會做什麼。「提醒客戶」不是措施，要寫出擋或不擋。
    tips:
      - 風險屬性的問卷面向與分級要寫出來，不只寫「共 5 級」
      - 不相符時的處理要二選一：擋下，或留下客戶簽署紀錄
      - 高齡與非專業投資人的額外程序要另外寫
    example: "客戶分 RR1–RR5，商品同級。客戶級別低於商品即擋下；65 歲以上加錄音與二次確認。"
    fields:
      - key: kyc
        label: 客戶風險屬性評估
        hint: 問卷面向 · 分級 · 重評頻率
        type: textarea
        rows: 5
      - key: kyp
        label: 商品風險等級
        hint: 分級依據 · 誰維護 · 更新頻率
        type: textarea
        rows: 4
      - key: mismatch
        label: 不相符時的處理
        hint: 擋下 / 簽署紀錄 · 高齡加強程序
        type: textarea
        rows: 5
    checks:
      - id: c1
        label: 客戶與商品分級可對應
        pass: false
      - id: c2
        label: 不相符時有明確處理
        pass: false

  - id: wealth_compliance
    n: "09"
    title: 法遵與執照
    desc: 信託業法 · 投顧 / 投信 · 廣告限制
    guide: 先確定這個服務在做什麼業務，才知道要哪張執照。推薦標的、代客操作、單純銷售是三件不同的事，適用的法源也不同。
    tips:
      - 寫出業務型態與對應法源條號
      - 若涉及推薦或建議，說明是否構成投顧業務
      - 行銷用語限制要進 PRD，不要留給行銷自己判斷
    example: "屬特定金錢信託（信託業法 §18）之基金銷售，不提供個別標的建議，故不構成投顧業務。文案禁用「保證」「穩賺」。"
    fields:
      - key: business_type
        label: 業務型態與法源
        hint: 型態 · 法條 · 執照狀態
        type: textarea
        rows: 5
      - key: marketing
        label: 廣告與行銷用語限制
        hint: 禁用語 · 績效呈現規則
        type: textarea
        rows: 4

  - id: fees_disclosure
    n: "10"
    title: 費用結構
    desc: 經理費 · 保管費 · 申贖費 · 通路報酬
    guide: 客戶實際付出的每一塊錢都要列出來，包含他看不到的通路報酬。只寫「免手續費」而不寫內含費用，是最常見的申訴來源。
    tips:
      - 每行一項費用，寫出計費基礎與收取方
      - 通路報酬（後收／分成）也要揭露
      - 給一個具體金額的試算例，不要只給費率
    example: "• 經理費 1.5%/年（內扣）• 保管費 0.2%/年 • 申購費 1.5%（可折讓）• 通路報酬：經理費之 60%"
    fields:
      - key: fee_items
        label: 費用項目
        hint: 每行一項（名目 · 費率 · 收取方 · 內扣或外收）
        type: textarea
        rows: 6
      - key: example_calc
        label: 費用試算例
        hint: 以具體投資金額示範一年總成本
        type: textarea
        rows: 4

  - id: risk_disclosure
    n: "11"
    title: 風險揭露
    desc: 風險預告書 · 最大損失 · 流動性限制
    guide: 寫出客戶在簽下去之前會看到什麼、在哪一步看到、要不要留下紀錄。風險揭露不是免責條款，是讓客戶真的知道會賠多少。
    tips:
      - 明確寫出「不保證獲利」與最大可能損失
      - 流動性限制（閉鎖期、贖回時間）要單獨寫
      - 揭露的呈現時點與留存紀錄要指名
    example: "申購前強制閱讀風險預告書並勾選；揭露最大損失可達本金全部；贖回 T+5 到帳，閉鎖期 6 個月。留存勾選時戳。"
    fields:
      - key: disclosure
        label: 風險揭露內容
        hint: 不保證獲利 · 最大損失 · 主要風險因子
        type: textarea
        rows: 6
      - key: liquidity
        label: 流動性限制
        hint: 閉鎖期 · 贖回時序 · 提前贖回代價
        type: textarea
        rows: 4

gates:
  - rules:
      - id: wealth-suitability-mapping
        level: block
        label: 客戶與商品分級無法對應
        detail: 需寫出客戶風險屬性分級（如 RR1–RR5 或等級數）
        section: suitability
        fields: [kyc]
        require: { kind: match, re: "RR\\d|風險屬性|等級|分級|級別" }
    pass:
      id: wealth-suitability-mapping-ok
      label: 客戶風險分級已寫
      detail: 偵測到分級敘述

  - rules:
      - id: wealth-mismatch-action
        level: block
        label: 不相符時沒有明確處理
        detail: 「提醒客戶」不是措施——要寫出擋下，或留下客戶簽署紀錄
        section: suitability
        fields: [mismatch]
        require: { kind: match, re: "擋|阻擋|禁止|不得|簽署|同意書|錄音|二次確認" }
    pass:
      id: wealth-mismatch-action-ok
      label: 不相符處理已寫
      detail: 偵測到擋下或簽署紀錄機制

  - rules:
      - id: wealth-license
        level: block
        label: 未寫明業務型態與法源
        detail: 需指出信託業法／投顧／投信等適用法源與條號
        section: wealth_compliance
        fields: [business_type]
        require: { kind: match, re: "信託業法|投顧|投信|證券投資|銷售機構|§|第\\s*\\d+\\s*條" }
    pass:
      id: wealth-license-ok
      label: 業務法源已對應
      detail: 偵測到法源引用

  - rules:
      - id: wealth-marketing-limit
        level: warn
        label: 缺行銷用語限制
        detail: 禁用語與績效呈現規則要進 PRD，不要留給行銷自己判斷
        section: wealth_compliance
        fields: [marketing]
        require: { kind: minLength, n: 15 }

  - rules:
      - id: wealth-fee-items
        level: warn
        label: 費用項目不足
        detail: 目前 {count} 項，財管商品通常至少涵蓋經理費、保管費、申贖費三項
        section: fees_disclosure
        fields: [fee_items]
        require: { kind: bullets, min: 3 }

  - rules:
      - id: wealth-no-guarantee
        level: block
        label: 風險揭露未寫明不保證獲利與最大損失
        detail: 風險揭露不是免責條款——要讓客戶知道會賠多少
        section: risk_disclosure
        fields: [disclosure]
        require: { kind: match, re: "不保證|最大損失|本金|虧損|風險預告" }
    pass:
      id: wealth-no-guarantee-ok
      label: 風險揭露已寫明
      detail: 偵測到不保證獲利或最大損失敘述

  - rules:
      - id: wealth-liquidity
        level: warn
        label: 流動性限制未寫
        detail: 閉鎖期與贖回時序要單獨寫，別藏在風險揭露段落裡
        section: risk_disclosure
        fields: [liquidity]
        require: { kind: match, re: "閉鎖|贖回|T\\+\\d|\\d+\\s*[日月年]|流動性" }
---

財管領域包。章節接在通用 7 章之後（08–11），比其他領域多一段。

多的那一段是「費用結構」與「風險揭露」拆開寫。合成一段的誘惑很大，
但這兩件事的失效模式不同：費用寫不清楚是申訴，風險寫不清楚是裁罰。
