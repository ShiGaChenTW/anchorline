/**
 * 簽核流程的**唯一資料來源**。
 *
 * 這個檔案是給人改的。`approval-flows.html` 只負責把它畫出來 ——
 * 流程圖、步驟表、條件表全部由這裡生成，改完存檔重新整理就看得到。
 * 不要去改 HTML 裡的圖，改這裡。
 *
 * 每個 flow：
 *   id / title / purpose  流程的目的（為什麼存在，不是做了什麼）
 *   roles                 適用角色
 *   trigger               什麼情況會走這條流程
 *   steps[]               每一步
 *     ├ id / name         節點代號與名稱（代號用在 edges）
 *     ├ kind              start | action | decision | end | blocked
 *     ├ actor             這一步由誰執行
 *     ├ purpose           這一步要達成什麼
 *     ├ pass[]            滿足條件（全部成立才能往下）
 *     ├ fail[]            否決條件（任一成立就擋下）
 *     └ code              對應的程式位置，方便對照
 *   edges[]               { from, to, label? }
 *
 * 來源：src/lib/permissions.ts、src/lib/prd-gates.ts、src/data/store.ts
 * （approveAndLock / submitForReview / withdrawCase / commitForReview / mergeApproved）
 */
window.APPROVAL_FLOWS = {
  meta: {
    product: "Anchorline",
    updated: "2026-08-10",
    note: "角色三種：管理員 admin、核准人員 approver、編輯人員 editor。Agent 只能是 editor 或 approver，不可為 admin。",
  },

  roles: [
    {
      id: "admin",
      name: "管理員",
      can: ["讀", "寫／編輯", "刪除", "簽核", "覆核", "帳號管理", "匯出", "全部權限"],
      note: "唯一能覆寫其他規則的角色。可一鍵簽完所有關卡、可抽已核准的案。",
    },
    {
      id: "approver",
      name: "核准人員",
      can: ["讀", "簽核", "匯出"],
      note: "不可改內文。走正式簽核（approve），不走覆核（peer review）。",
    },
    {
      id: "editor",
      name: "編輯人員",
      can: ["讀", "寫／編輯", "刪除", "維護", "覆核他人", "匯出"],
      note: "不可正式簽核。可覆核他人文件，不可覆核自己的。",
    },
  ],

  flows: [
    // ─────────────────────────────────────────────────────────
    {
      id: "main",
      title: "主流程：撰寫 → 送審 → 簽核 → 核准",
      purpose:
        "讓一份 PRD 從草稿走到「被正式承認」的狀態，並且每一次承認都對應一份不會再變的快照。",
      trigger: "編輯人員或管理員在編輯工作台完成內容，準備讓別人看。",
      roles: ["editor", "admin", "approver"],
      steps: [
        {
          id: "draft",
          name: "撰寫（草稿）",
          kind: "start",
          actor: "編輯人員／管理員",
          purpose: "把內容寫出來。此階段的修改只進草稿袋，不算數。",
          pass: ["具有 write 或 edit 權限", "專案未被鎖定（locked = false）"],
          fail: ["核准人員（approver）沒有 edit 權限，開啟後所有欄位唯讀", "案件已核准並鎖定"],
          code: "permissions.canEditContent / store.setSectionDraft",
        },
        {
          id: "save",
          name: "儲存（working copy）",
          kind: "action",
          actor: "編輯人員／管理員",
          purpose:
            "把草稿落地成「已儲存的內容」。這是後續所有比較的基準，也是送審快照的來源。",
          pass: ["該章節有未儲存的草稿"],
          fail: ["沒有變更時不做任何事（避免產生沒有意義的版本）"],
          code: "store.saveSections",
        },
        {
          id: "gate",
          name: "結構檢查（程式判定）",
          kind: "decision",
          actor: "系統（非 AI 判定）",
          purpose:
            "擋掉結構上不完整的規格，讓審閱者的時間花在判斷內容而不是抓缺漏。",
          pass: [
            "三行摘要 what／who／why 皆有內容",
            "Non-Goals ≥ 3 條",
            "目標欄 ≥ 20 字",
            "成功指標 ≥ 30 字",
          ],
          fail: [
            "任一 block 項未過 → canSubmit = false，送審鈕擋下",
            "warn 項不擋（技術線選型、指標不可量測、問題陳述偏短、開放問題缺期限）",
          ],
          code: "prd-gates.evaluatePrdGates → canSubmit",
        },
        {
          id: "unsaved",
          name: "還有未儲存的變更？",
          kind: "decision",
          actor: "系統",
          purpose:
            "避免送出一份「跟作者螢幕上看到的不一樣」的版本 —— 審閱者核准的東西跟作者以為送出的東西不同，而兩邊都不會發現。",
          pass: ["沒有未儲存草稿 → 直接送審"],
          fail: ["有未儲存草稿 → 先問要不要全部儲存；選擇取消則中止送審"],
          code: "editor.ts btn-submit handler",
        },
        {
          id: "commit",
          name: "送審 = commit（整份快照）",
          kind: "action",
          actor: "編輯人員／管理員",
          purpose:
            "對整份 PRD 拍一份不會再變的快照。審閱者看的是這一份，不是送審之後又被改過的當下內容。",
          pass: ["結構檢查全過", "無未儲存變更"],
          fail: ["跟主線沒有任何差異時不產生 commit"],
          code: "store.commitForReview",
        },
        {
          id: "case",
          name: "建立／重用簽核個案",
          kind: "action",
          actor: "系統",
          purpose: "依工作流關卡定義展開這一案要走的關卡與負責人。",
          pass: ["既有個案未抽單 → 沿用", "已抽單或不存在 → 依 workflowStages 重建"],
          fail: [],
          code: "store.submitForReview / caseFromWorkflow",
        },
        {
          id: "stages",
          name: "逐關簽核",
          kind: "decision",
          actor: "各關卡負責人／核准人員／管理員",
          purpose: "讓各專業領域各自對自己負責的面向表態。",
          pass: ["所有 required 關卡為 approved 或 skipped"],
          fail: ["任一 required 關卡仍為 pending／empty → 專案停在 review"],
          code: "store.approveAndLock → allDone",
        },
        {
          id: "merge",
          name: "核准 = merge（併入主線）",
          kind: "action",
          actor: "核准人員／管理員",
          purpose:
            "把送審時那份快照併進主線，成為下一輪比較的基準。合併的不是「現在的內容」—— 審閱者核准的是他看過的那一份。",
          pass: ["所有關卡完成", "存在可合併的 commit"],
          fail: ["沒有送審過的版本 → 核准仍成立，但不產生 merge"],
          code: "store.mergeApproved",
        },
        {
          id: "locked",
          name: "已核准並鎖定",
          kind: "end",
          actor: "—",
          purpose: "凍結內容，避免核准後被無聲修改。",
          pass: ["locked = true、status = approved、pct = 100"],
          fail: ["要再改必須先抽單"],
          code: "store.approveAndLock → locked",
        },
      ],
      edges: [
        { from: "draft", to: "save", label: "按儲存 / ⌘S" },
        { from: "save", to: "gate", label: "按送出審閱" },
        { from: "gate", to: "draft", label: "不通過：回去補 block 項" },
        { from: "gate", to: "unsaved", label: "通過" },
        { from: "unsaved", to: "save", label: "有未存 → 先儲存" },
        { from: "unsaved", to: "commit", label: "乾淨" },
        { from: "commit", to: "case", label: "" },
        { from: "case", to: "stages", label: "" },
        { from: "stages", to: "stages", label: "還有 required 未簽" },
        { from: "stages", to: "merge", label: "全部完成" },
        { from: "merge", to: "locked", label: "" },
      ],
    },

    // ─────────────────────────────────────────────────────────
    {
      id: "approve-eligibility",
      title: "誰可以按下核准（迴避規則）",
      purpose:
        "確保「寫的人」與「核准的人」不是同一個意志 —— 包含人，也包含同一種 AI。",
      trigger: "任何人按下審閱頁的核准鈕時。",
      roles: ["approver", "admin", "editor"],
      steps: [
        {
          id: "login",
          name: "已登入？",
          kind: "decision",
          actor: "系統",
          purpose: "沒有身分就沒有責任歸屬。",
          pass: ["currentUser 存在且 active ≠ false"],
          fail: ["未登入 → 尚未登入"],
          code: "permissions.canApproveProject",
        },
        {
          id: "perm",
          name: "有 approve 權限？",
          kind: "decision",
          actor: "系統",
          purpose: "把簽核權綁在角色上，不靠自律。",
          pass: ["角色為 approver 或 admin"],
          fail: ["editor 無簽核權 → 目前角色無簽核權限"],
          code: "ROLE_PERMS",
        },
        {
          id: "self",
          name: "是自己寫的嗎？",
          kind: "decision",
          actor: "系統",
          purpose: "自己核准自己等於沒有審查。",
          pass: ["project.authorId ≠ 自己"],
          fail: ["authorId = 自己 → 不可核准自己撰寫的文件", "管理員例外，不受此限"],
          code: "canApproveProject 自審檢查",
        },
        {
          id: "family",
          name: "同一種 Agent 寫的嗎？",
          kind: "decision",
          actor: "系統",
          purpose:
            "同一個模型家族的偏誤是一致的。讓 Claude 核准 Claude 寫的東西，等於讓同一個腦袋自己檢查自己。",
          pass: ["核准者非 Agent，或與作者 agentFamily 不同"],
          fail: ["user.kind = agent 且 agentFamily 與 authorAgentFamily 相同 → 擋下"],
          code: "canApproveProject 族系檢查",
        },
        {
          id: "withdrawn",
          name: "案件已抽單？",
          kind: "decision",
          actor: "系統",
          purpose: "抽掉的案子不該還能被簽。",
          pass: ["case.withdrawn = false"],
          fail: ["已抽單 → 此案已抽單，無法簽核"],
          code: "store.approveAndLock",
        },
        {
          id: "gate2",
          name: "結構檢查可核准？",
          kind: "decision",
          actor: "系統",
          purpose: "核准的門檻不低於送審。",
          pass: ["canApprove = true（無 block 項）"],
          fail: ["有 block 項 → 無法核准"],
          code: "review.ts btn-approve",
        },
        { id: "ok", name: "可以核准", kind: "end", actor: "—", purpose: "進入逐關簽核。", pass: [], fail: [], code: "" },
        { id: "no", name: "擋下並說明原因", kind: "blocked", actor: "—", purpose: "每一種擋下都要講得出理由。", pass: [], fail: [], code: "" },
      ],
      edges: [
        { from: "login", to: "perm", label: "是" },
        { from: "login", to: "no", label: "否" },
        { from: "perm", to: "self", label: "有" },
        { from: "perm", to: "no", label: "無" },
        { from: "self", to: "family", label: "不是自己" },
        { from: "self", to: "no", label: "是自己（admin 除外）" },
        { from: "family", to: "withdrawn", label: "不同族系" },
        { from: "family", to: "no", label: "同族系" },
        { from: "withdrawn", to: "gate2", label: "未抽單" },
        { from: "withdrawn", to: "no", label: "已抽單" },
        { from: "gate2", to: "ok", label: "通過" },
        { from: "gate2", to: "no", label: "有 block 項" },
      ],
    },

    // ─────────────────────────────────────────────────────────
    {
      id: "stage-signing",
      title: "關卡簽核：誰能簽哪一關",
      purpose: "讓每一關的責任落在特定的人身上，同時保留管理員在流程卡住時的出口。",
      trigger: "通過核准資格檢查後，系統逐一處理該案的關卡。",
      roles: ["approver", "admin"],
      steps: [
        {
          id: "iter",
          name: "逐一檢視關卡",
          kind: "start",
          actor: "系統",
          purpose: "只處理還沒完成的關卡。",
          pass: ["關卡狀態為 pending 或 empty"],
          fail: ["已 approved 或 skipped 的關卡不再變動"],
          code: "approveAndLock stages.map",
        },
        {
          id: "who",
          name: "這一關輪得到你簽嗎？",
          kind: "decision",
          actor: "系統",
          purpose: "避免任何人隨手簽掉不屬於自己的關卡。",
          pass: [
            "你是 admin",
            "或這一關的 assigneeId 就是你",
            "或這一關沒有指定負責人，而你是核准人員",
          ],
          fail: ["以上皆非 → 這一關保持原狀，不被簽掉"],
          code: "approveAndLock 關卡歸屬判定",
        },
        {
          id: "sign",
          name: "標記為已簽",
          kind: "action",
          actor: "核准人員／管理員",
          purpose: "留下誰在什麼時候簽的。",
          pass: ["state → approved，assigneeName 標記「已簽」"],
          fail: [],
          code: "approveAndLock",
        },
        {
          id: "adminall",
          name: "管理員一鍵全簽",
          kind: "decision",
          actor: "管理員",
          purpose:
            "流程卡在找不到人的關卡時要有出口。代價是這個動作繞過了分工，所以只給 admin。",
          pass: ["操作者為 admin → 其餘未完成關卡一併簽掉"],
          fail: ["非 admin 時，只有「全部關卡本來就已完成」才會走這條"],
          code: "approveAndLock 一鍵全簽分支",
        },
        {
          id: "alldone",
          name: "全部完成？",
          kind: "decision",
          actor: "系統",
          purpose: "決定案件是停在審閱中還是進入已核准。",
          pass: ["每一關都是 approved 或 skipped → status = approved、locked = true、pct = 100"],
          fail: ["仍有未完成 → status 維持 review，不鎖定"],
          code: "approveAndLock allDone",
        },
      ],
      edges: [
        { from: "iter", to: "who", label: "" },
        { from: "who", to: "sign", label: "是" },
        { from: "who", to: "adminall", label: "否" },
        { from: "sign", to: "adminall", label: "" },
        { from: "adminall", to: "alldone", label: "" },
      ],
    },

    // ─────────────────────────────────────────────────────────
    {
      id: "withdraw",
      title: "抽單：把案子撤回",
      purpose: "讓已經送出（甚至已核准）的案子有回頭路，而不是靠改資料庫。",
      trigger: "需要撤回已送審或已核准的案件時。",
      roles: ["editor", "admin"],
      steps: [
        {
          id: "role",
          name: "角色可抽單？",
          kind: "decision",
          actor: "系統",
          purpose: "核准人員不該能撤掉自己正在審的案。",
          pass: ["角色為 admin 或 editor"],
          fail: ["approver → 僅管理員或編輯可抽單"],
          code: "store.withdrawCase",
        },
        {
          id: "approved",
          name: "案件已核准？",
          kind: "decision",
          actor: "系統",
          purpose: "已核准代表對外承諾過，撤回的門檻要更高。",
          pass: ["未核准 → editor 也可抽", "已核准 → 僅 admin 可抽"],
          fail: ["已核准且操作者為 editor → 已核准案件僅管理員可抽單"],
          code: "store.withdrawCase",
        },
        {
          id: "reason",
          name: "記錄抽單原因",
          kind: "action",
          actor: "操作者",
          purpose: "抽單一定要留下為什麼，否則之後沒人說得清這案怎麼消失的。",
          pass: ["withdrawn = true，記錄時間／人／原因（未填時預設「管理者抽單」）"],
          fail: [],
          code: "store.withdrawCase",
        },
        {
          id: "unlock",
          name: "解除鎖定",
          kind: "end",
          actor: "系統",
          purpose: "讓內容重新可編輯，下次送審會重建一個新的簽核個案。",
          pass: ["locked = false；下次 submitForReview 會重建 case"],
          fail: [],
          code: "store.submitForReview（withdrawn 時重建）",
        },
      ],
      edges: [
        { from: "role", to: "approved", label: "可以" },
        { from: "approved", to: "reason", label: "允許" },
        { from: "reason", to: "unlock", label: "" },
      ],
    },

    // ─────────────────────────────────────────────────────────
    {
      id: "peer-review",
      title: "覆核：留言標記已解決",
      purpose:
        "在正式簽核之外提供一層同儕檢查，讓問題在進到簽核關卡之前就被消化掉。",
      trigger: "審閱頁上有人針對章節留言，需要有人確認問題已處理。",
      roles: ["editor", "approver", "admin"],
      steps: [
        {
          id: "exists",
          name: "留言存在？",
          kind: "decision",
          actor: "系統",
          purpose: "基本前置。",
          pass: ["找得到該留言"],
          fail: ["留言不存在"],
          code: "store.resolveComment",
        },
        {
          id: "who2",
          name: "有覆核資格？",
          kind: "decision",
          actor: "系統",
          purpose: "覆核不是誰都能做，但也不必等到核准人員才動得了。",
          pass: ["admin 永遠可", "editor 具 peer_review 權限", "或具 approve 權限者"],
          fail: ["以上皆非 → 無權覆核"],
          code: "permissions.canPeerReview",
        },
        {
          id: "scope",
          name: "找得到留言所屬的專案？",
          kind: "decision",
          actor: "系統",
          purpose:
            "自審檢查要拿「這則留言所在專案」的作者去比對。比錯專案的話，該擋的不擋、不該擋的被擋，而且不會有任何錯誤訊息。",
          pass: ["comment.projectId 對應得到現存專案"],
          fail: ["對不到 → 找不到這則留言所屬的專案（不退回猜一個來用）"],
          code: "comment-scope.projectOfComment",
        },
        {
          id: "own",
          name: "是自己的文件嗎？",
          kind: "decision",
          actor: "系統",
          purpose: "自己消化自己的問題等於沒有覆核。",
          pass: ["文件作者不是自己"],
          fail: ["editor 且 project.authorId = 自己 → 編輯人員不可覆核自己的檔案"],
          code: "comment-scope.canResolveComment",
        },
        {
          id: "resolve",
          name: "標記已解決",
          kind: "end",
          actor: "覆核者",
          purpose: "把未解決留言數降下來，讓審閱者知道還剩什麼。",
          pass: ["comment.resolved = true"],
          fail: [],
          code: "store.resolveComment",
        },
      ],
      edges: [
        { from: "exists", to: "who2", label: "是" },
        { from: "who2", to: "scope", label: "有資格" },
        { from: "scope", to: "own", label: "找得到" },
        { from: "own", to: "resolve", label: "不是自己的" },
      ],
    },
  ],

  /** 結構檢查的判定項 —— 送審與核准共用同一份 */
  gates: [
    { level: "block", label: "三行摘要不完整", rule: "what／who／why 任一為空", note: "三個全空時標示為「還沒開始」而不是紅叉" },
    { level: "block", label: "Non-Goals 不足 3 條", rule: "條列數 < 3", note: "用來擋 scope 膨脹" },
    { level: "block", label: "目標過薄", rule: "目標欄 < 20 字", note: "需可驗收描述" },
    { level: "block", label: "成功指標空白", rule: "指標欄 < 30 字", note: "Desired Outcomes" },
    { level: "warn", label: "技術線選型未填", rule: "tech 欄 < 12 字", note: "不擋送審" },
    { level: "warn", label: "技術線選型缺邊界", rule: "未見「刻意不選」字樣", note: "不擋送審" },
    { level: "warn", label: "成功指標可能不可量測", rule: "未偵測到數字／%／期限／p95 等", note: "不擋送審" },
    { level: "warn", label: "問題陳述偏短", rule: "< 40 字", note: "不擋送審" },
    { level: "warn", label: "開放問題缺少期限", rule: "有內容但無日期／期限字樣", note: "不擋送審" },
    { level: "warn", label: "多個章節仍空白", rule: "空白章節 ≥ 3", note: "不擋送審" },
  ],

  /** 預設關卡（正式版）—— 可在管理中心調整 */
  stages: [
    { order: 1, name: "工程", required: true },
    { order: 2, name: "設計", required: true },
    { order: 3, name: "資安", required: true },
    { order: 4, name: "法務", required: false },
  ],
};
