---
name: lending
displayName: 信貸 / 貸款
industry: fintech
extends: _base
prompt: |
  你是一位熟悉台灣消費金融實務的資深 FinTech 產品經理。
  這份 PRD 的對象是台灣的個人信貸 / 貸款產品。以下面向必須涵蓋：

  1. 民法第 205 條週年利率上限 16%（2021 年修正，適用於約定利息）
  2. 總費用年百分率（APR）的揭露義務——利率之外的開辦費、帳管費都要計入
  3. 信用評分模型的因子與可解釋性，以及對申請人的拒貸理由告知
  4. 銀行法第 47-1 條（信用卡循環利率上限 15%）如適用
  5. 金融機構債權催收作業委外處理要點：催收時間限制、禁止騷擾第三人、
     委外機構的管理責任
  6. 逾期認列、轉呆帳與債權讓與的政策界線

  引用法規時寫出具體條號，不要只說「依主管機關規定」。

sections:
  - id: credit_risk
    n: "08"
    title: 信用評分與風控
    desc: 評分因子 · 拒貸理由 · 額度政策
    guide: 寫出評分模型用了哪些因子、各自的取得來源，以及被拒絕的申請人會收到什麼理由。「模型判定」不是理由。
    tips:
      - 因子要能對應到可取得的資料源（聯徵／內部往來／外部）
      - 寫出人工覆核的介入條件，不要全交給模型
      - 拒貸理由的告知內容要能通過主管機關檢視
    example: "主因子：聯徵近一年查詢次數、負債比、往來月數。負債比 > 22 倍轉人工覆核。拒貸告知列出前三大不利因子。"
    fields:
      - key: score_factors
        label: 評分因子
        hint: 每行一項（因子 · 資料來源 · 方向）
        type: textarea
        rows: 6
      - key: limits
        label: 額度與覆核政策
        hint: 分級額度 · 人工介入條件
        type: textarea
        rows: 5
      - key: adverse_action
        label: 拒貸理由告知
        hint: 告知內容與管道
        type: textarea
        rows: 4
    checks:
      - id: c1
        label: 每個因子都有可取得的資料源
        pass: false
      - id: c2
        label: 有人工覆核的介入條件
        pass: false

  - id: pricing_fees
    n: "09"
    title: 利率與費用
    desc: 利率區間 · APR · 民法 §205 上限
    guide: 寫出利率區間怎麼定、除了利息還收什麼費用，以及總費用年百分率怎麼算給客戶看。上限是法定的，不是產品決策。
    tips:
      - 週年利率不得逾 16%（民法第 205 條）
      - 開辦費、帳管費、提前清償違約金都要進 APR
      - 寫出最壞情況的客戶總負擔，不只寫最優惠利率
    example: "利率 3.88%–15.99%（民法 §205 上限內）；開辦費 3,000 元一次收。APR 區間 5.2%–17.4%，於申請頁揭露。"
    fields:
      - key: rate_structure
        label: 利率結構
        hint: 區間 · 分級依據 · 法定上限對應
        type: textarea
        rows: 5
      - key: fees
        label: 費用項目
        hint: 每行一項（名目 · 金額 · 收取時點）
        type: textarea
        rows: 5
      - key: apr
        label: 總費用年百分率揭露
        hint: 計算方式與揭露位置
        type: textarea
        rows: 4

  - id: collections
    n: "10"
    title: 催收與呆帳政策
    desc: 催收行為規範 · 逾期認列 · 委外管理
    guide: 逾期後每個階段誰做什麼、什麼時間可以聯絡、什麼絕對不能做。這一段寫得含糊，上線後就是客訴與裁罰。
    tips:
      - 對應金融機構債權催收作業委外處理要點的行為限制
      - 寫出逾期天數對應的階段與轉呆帳時點
      - 委外催收的機構管理與稽核責任要指名
    example: "M1 簡訊與電話（09:00–21:00，禁聯絡第三人）；M3 轉委外，委外機構每季稽核；逾 180 日轉呆帳。"
    fields:
      - key: stages
        label: 催收階段
        hint: 每行一階（逾期天數 · 手段 · 負責方）
        type: textarea
        rows: 6
      - key: conduct
        label: 行為規範與禁止事項
        hint: 聯絡時段 · 對象限制 · 委外管理
        type: textarea
        rows: 5
      - key: writeoff
        label: 逾期認列與轉呆帳
        hint: 天數門檻與會計處理
        type: textarea
        rows: 4

gates:
  - rules:
      - id: lending-rate-cap
        level: block
        label: 利率未對應法定上限
        detail: 需寫出利率區間並對應民法第 205 條週年利率 16% 上限
        section: pricing_fees
        fields: [rate_structure]
        require: { kind: match, re: "205|16\\s*%|上限|年利率|週年利率" }
    pass:
      id: lending-rate-cap-ok
      label: 利率上限已對應
      detail: 偵測到利率上限或法條引用

  - rules:
      - id: lending-apr
        level: warn
        label: 未見總費用年百分率揭露
        detail: 開辦費與帳管費都要計入 APR 並向客戶揭露
        section: pricing_fees
        fields: [apr]
        require: { kind: match, re: "APR|年百分率|總費用", flags: i }

  - rules:
      - id: lending-score-factors
        level: warn
        label: 評分因子不足
        detail: 目前 {count} 項，建議至少 3 項並各自標明資料來源
        section: credit_risk
        fields: [score_factors]
        require: { kind: bullets, min: 3 }

  - rules:
      - id: lending-adverse-action
        level: warn
        label: 缺拒貸理由告知
        detail: 「模型判定」不是理由——需寫出會告知申請人什麼
        section: credit_risk
        fields: [adverse_action]
        require: { kind: minLength, n: 20 }

  - rules:
      - id: lending-collections-conduct
        level: block
        label: 催收行為規範未寫明
        detail: 需對應委外處理要點：聯絡時段、第三人限制、委外機構管理
        section: collections
        fields: [conduct]
        require: { kind: match, re: "時段|時間|第三人|騷擾|委外|要點" }
    pass:
      id: lending-collections-ok
      label: 催收行為規範已寫
      detail: 偵測到行為限制敘述
---

信貸領域包。章節接在通用 7 章之後（08–10）。

同樣只加通用章節沒有對應物的三段：信用評分與風控、利率與費用、催收與呆帳。
產品概述／目標客群／申請流程／成功指標／風險在通用章節已有位置。
