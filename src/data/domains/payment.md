---
name: payment
displayName: 支付 / 錢包
industry: fintech
extends: _base
prompt: |
  你是一位熟悉台灣支付產業實務的資深 FinTech 產品經理。
  這份 PRD 的對象是台灣的支付 / 電子錢包產品。以下面向必須涵蓋：

  1. 電子支付機構管理條例（電支條例）的適用判斷——代理收付、儲值、
     國內外小額匯兌各自的門檻與許可要求
  2. 支付款項的信託或履約保證安排（電支條例第 22–24 條）
  3. 洗錢防制法與資恐防制法下的客戶審查、交易監控與可疑交易通報
  4. 清算與結算的時序（T+N）、失敗與退款路徑、爭議款處理
  5. 費率結構與對帳機制——與通路、商戶、清算機構三方的帳要對得起來
  6. 跨境情境另需注意外匯管理與央行申報

  引用法規時寫出具體條號或函令名稱。

sections:
  - id: clearing_settlement
    n: "08"
    title: 清算與結算流程
    desc: 金流路徑 · T+N · 失敗與退款
    guide: 畫出錢從付款人到收款人的每一站，各站之間隔多久，以及任何一站失敗時錢會停在哪裡、怎麼退。含糊的地方上線後都是爭議款。
    tips:
      - 寫出每一段的時序，不要只寫「即時」
      - 失敗路徑跟成功路徑一樣重要，兩條都要寫
      - 退款與爭議款的責任歸屬要指名到角色
    example: "授權即時 → 請款 T+0 批次 → 撥款商戶 T+2。授權成功但請款失敗：款項於待清算帳戶保留 3 日後自動解授權。"
    fields:
      - key: flow
        label: 金流路徑與時序
        hint: 每行一段（起訖 · 時序 · 承作方）
        type: textarea
        rows: 6
      - key: failure
        label: 失敗與退款路徑
        hint: 失敗情境 · 款項位置 · 退款時序
        type: textarea
        rows: 5
      - key: dispute
        label: 爭議款處理
        hint: 受理管道 · 舉證責任 · 時限
        type: textarea
        rows: 4
    checks:
      - id: c1
        label: 每一段都有明確時序
        pass: false
      - id: c2
        label: 失敗路徑已寫
        pass: false

  - id: payment_compliance
    n: "09"
    title: 法遵要點
    desc: 電支條例 · 信託履保 · 洗錢防制
    guide: 先判斷這個產品落在電支條例的哪一類（代理收付／儲值／匯兌），再寫出對應的許可、信託履保與洗防義務。判斷錯了，後面全部要重來。
    tips:
      - 明確寫出適用哪一類業務與對應門檻
      - 支付款項的信託或履約保證安排要指名機構
      - 洗防的客戶審查層級與交易監控門檻要可量化
    example: "屬代理收付實質交易款項；支付款項全額交付信託（電支條例 §22）。單筆逾 3 萬進行 EDD，命中名單即凍結並通報。"
    fields:
      - key: eact_scope
        label: 電支條例適用判斷
        hint: 業務類別 · 門檻 · 許可狀態
        type: textarea
        rows: 5
      - key: custody
        label: 支付款項保管安排
        hint: 信託或履約保證 · 承作機構
        type: textarea
        rows: 4
      - key: aml
        label: 洗錢防制措施
        hint: 客戶審查層級 · 監控門檻 · 通報
        type: textarea
        rows: 5

  - id: fees_reconciliation
    n: "10"
    title: 費率與對帳
    desc: 費率結構 · 三方對帳 · 差異處理
    guide: 寫出向誰收多少，以及每天怎麼確認自己的帳、通路的帳、商戶的帳三邊一致。對不起來的那筆錢由誰吸收要先講好。
    tips:
      - 費率要寫清楚計費基礎（筆數／金額／階梯）
      - 對帳頻率與差異容忍度要量化
      - 長帳與短帳的處理責任要指名
    example: "商戶手續費 1.55%（階梯至 1.2%）。每日 T+1 09:00 三方對帳，差異逾 100 元或 3 筆升級人工，長短帳由清算組於 T+3 前結清。"
    fields:
      - key: fee_schedule
        label: 費率結構
        hint: 每行一項（對象 · 計費基礎 · 費率）
        type: textarea
        rows: 5
      - key: reconciliation
        label: 對帳機制
        hint: 頻率 · 對象 · 差異門檻與升級
        type: textarea
        rows: 5

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
      - id: payment-eact-scope
        level: block
        label: 未判斷電支條例適用類別
        detail: 需寫出屬代理收付／儲值／匯兌哪一類，這決定後面所有義務
        section: payment_compliance
        fields: [eact_scope]
        require: { kind: match, re: "電支|電子支付|代理收付|儲值|匯兌" }
    pass:
      id: payment-eact-scope-ok
      label: 電支條例適用已判斷
      detail: 偵測到業務類別判斷

  - rules:
      - id: payment-custody
        level: block
        label: 支付款項保管安排未寫
        detail: 需寫出信託或履約保證安排（電支條例 §22–24）
        section: payment_compliance
        fields: [custody]
        require: { kind: match, re: "信託|履約保證|履保|專戶" }
    pass:
      id: payment-custody-ok
      label: 款項保管已安排
      detail: 偵測到信託或履約保證

  - rules:
      - id: payment-aml-threshold
        level: warn
        label: 洗防門檻不可量化
        detail: 建議寫出金額或次數門檻，而非「異常時」
        section: payment_compliance
        fields: [aml]
        require: { kind: match, re: "\\d+\\s*萬|\\d+\\s*筆|門檻|EDD|加強審查" }

  - rules:
      - id: payment-settlement-timing
        level: block
        label: 清算時序未寫明
        detail: 每一段都要有時序（T+N 或具體時間），「即時」不算
        section: clearing_settlement
        fields: [flow]
        require: { kind: match, re: "T\\+\\d|\\d+\\s*日|\\d+\\s*小時|\\d+\\s*分|批次" }
    pass:
      id: payment-settlement-timing-ok
      label: 清算時序已寫
      detail: 偵測到時序敘述

  - rules:
      - id: payment-failure-path
        level: warn
        label: 缺失敗與退款路徑
        detail: 失敗路徑跟成功路徑一樣重要——錢停在哪裡要寫出來
        section: clearing_settlement
        fields: [failure]
        require: { kind: minLength, n: 25 }

  - rules:
      - id: payment-recon
        level: warn
        label: 對帳機制缺頻率或差異門檻
        detail: 建議寫出對帳頻率與差異容忍度，並指名長短帳的處理責任
        section: fees_reconciliation
        fields: [reconciliation]
        require: { kind: match, re: "每日|每週|每月|T\\+\\d|差異|門檻" }
---

支付領域包。章節接在通用 7 章之後（08–10）。

電支條例的適用判斷放在最前面，是因為那一題答錯，信託履保、洗防層級、
許可申請全部會跟著錯——它不是一個章節，是後面所有章節的前提。
