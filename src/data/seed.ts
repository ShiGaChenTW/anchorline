import type {
  AISettings,
  Approval,
  CaseRecord,
  Comment,
  Employee,
  Project,
  Section,
  Template,
  WorkflowStageDef,
} from "./types";

/**
 * 正式版唯一範例（章節正文／留言／簽核皆對齊此專案）。
 * 獨立定義，避免 prod bundle 被 SEED_PROJECTS_ALL 拖入其餘 7 筆。
 */
export const SAMPLE_PROJECT_2FA: Project = {
  id: "p1",
  title: "SaaS 雙重驗證（2FA）",
  status: "review",
  pct: 82,
  owner: "Scott",
  ownerId: "scott",
  authorId: "scott",
  authorAgentFamily: null,
  mine: true,
  updated: "今天 14:22",
  tag: "identity",
  isSample: true,
};

const appVariant = (import.meta as ImportMeta & { env?: Record<string, string> }).env
  ?.VITE_APP_VARIANT;

export const APP_VARIANT: "prod" | "test" = appVariant === "test" ? "test" : "prod";

/** 正式版：不內建示範專案（首次引導後由使用者建立／匯入） */
export const SEED_PROJECTS_PROD: Project[] = [];

/**
 * 測試版完整示範列表（僅在 VITE_APP_VARIANT=test 時掛入 SEED_PROJECTS，
 * 以 if 分支協助 bundler 做 dead-code elimination）。
 */
function buildTestProjects(): Project[] {
  return [
    SAMPLE_PROJECT_2FA,
    {
      id: "p2",
      title: "工作區角色權限重構",
      status: "draft",
      pct: 41,
      owner: "Scott",
      ownerId: "scott",
      authorId: "scott",
      authorAgentFamily: null,
      mine: true,
      updated: "昨天",
      tag: "platform",
      isSample: true,
    },
    {
      id: "p3",
      title: "稽核日誌匯出 API",
      status: "approved",
      pct: 100,
      owner: "Scott",
      ownerId: "scott",
      authorId: "claude-edit",
      authorAgentFamily: "claude",
      mine: true,
      updated: "3 天前",
      tag: "security",
      isSample: true,
    },
    {
      id: "p4",
      title: "自助帳單與發票",
      status: "draft",
      pct: 18,
      owner: "Scott",
      ownerId: "scott",
      authorId: "codex-edit",
      authorAgentFamily: "codex",
      mine: true,
      updated: "5 天前",
      tag: "growth",
      isSample: true,
    },
    {
      id: "p5",
      title: "行動端離線草稿同步",
      status: "review",
      pct: 67,
      owner: "Scott",
      ownerId: "scott",
      authorId: "scott",
      authorAgentFamily: null,
      mine: true,
      updated: "今天 09:10",
      tag: "mobile",
      isSample: true,
    },
    {
      id: "p6",
      title: "SOC 2 證據自動化收集",
      status: "review",
      pct: 74,
      owner: "Scott",
      ownerId: "scott",
      authorId: "grok-edit",
      authorAgentFamily: "grok",
      mine: true,
      updated: "2 天前",
      tag: "security",
      isSample: true,
    },
    {
      id: "p7",
      title: "多區域資料落地選項",
      status: "draft",
      pct: 29,
      owner: "Scott",
      ownerId: "scott",
      authorId: "agy-edit",
      authorAgentFamily: "agy",
      mine: true,
      updated: "1 週前",
      tag: "platform",
      isSample: true,
    },
    {
      id: "p8",
      title: "引導式 onboarding 改版",
      status: "approved",
      pct: 100,
      owner: "Scott",
      ownerId: "scott",
      authorId: "scott",
      authorAgentFamily: null,
      mine: true,
      updated: "2 週前",
      tag: "growth",
      isSample: true,
    },
    ...TEST_CASE_PROJECTS,
  ];
}

/**
 * 三個驗收用測試案例（僅測試版）。
 *
 * 刻意走三個不同方向，各自打中不同的程式路徑，
 * 三個都看過就等於把最近這批改動走完一遍：
 *
 *   A 匯入專案      → 檔案樹的「來源／產出」徽章、章節定位列、tasks.md 回讀
 *   B 手動無資料夾  → 檔案樹空狀態、「指定專案資料夾」、綁定詢問對話框
 *   C 全空白        → 反轉揭露（gate 有阻擋仍收合）、灰 ○ 不用紅 ✗、起手式骨架、進度膠囊
 */
export const TEST_CASE_PROJECTS: Project[] = [
  {
    id: "t1",
    title: "測試案例 A · 匯入專案（含 OpenSpec 產出）",
    status: "draft",
    pct: 72,
    owner: "Scott",
    ownerId: "scott",
    authorId: "scott",
    authorAgentFamily: null,
    mine: true,
    updated: "剛剛",
    tag: "測試",
    isSample: true,
    isImported: true,
    sourceFolder: "checkout-revamp",
    importSummary: {
      folderName: "checkout-revamp",
      // 刻意留空：指向不存在的假路徑會讓儀表板量出一片空白，
      // 看起來像壞掉。空字串會走「還沒指定資料夾」，那是誠實的狀態。
      rootPath: "",
      scannedAt: "2026-08-07T04:00:00.000Z",
      overallScore: 72,
      coveragePct: 71,
      progressPct: 72,
      matchedFiles: [
        { slot: "readme", path: "checkout-revamp/README.md", contentScore: 80 },
        { slot: "problem", path: "checkout-revamp/docs/problem.md", contentScore: 76 },
        { slot: "goals", path: "checkout-revamp/docs/goals.md", contentScore: 71 },
        { slot: "metrics", path: "checkout-revamp/docs/metrics.md", contentScore: 64 },
        { slot: "stories", path: "checkout-revamp/docs/stories.md", contentScore: 58 },
        { slot: "prd", path: "checkout-revamp/openspec/PRD.md", contentScore: 90 },
        { slot: "tasks", path: "checkout-revamp/openspec/tasks.md", contentScore: 86 },
        { slot: "proposal", path: "checkout-revamp/openspec/proposal.md", contentScore: 83 },
      ],
      missingRequired: [],
      allPaths: [
        "checkout-revamp/README.md",
        "checkout-revamp/LICENSE",
        "checkout-revamp/docs/problem.md",
        "checkout-revamp/docs/goals.md",
        "checkout-revamp/docs/metrics.md",
        "checkout-revamp/docs/stories.md",
        "checkout-revamp/openspec/PRD.md",
        "checkout-revamp/openspec/tasks.md",
        "checkout-revamp/openspec/proposal.md",
        "checkout-revamp/src/checkout.ts",
        "checkout-revamp/notes/scratch.md",
      ],
    },
  },
  {
    id: "t2",
    title: "測試案例 B · 手動新建（沒有資料夾）",
    status: "draft",
    pct: 34,
    owner: "Scott",
    ownerId: "scott",
    authorId: "scott",
    authorAgentFamily: null,
    mine: true,
    updated: "剛剛",
    tag: "測試",
    isSample: true,
  },
  {
    id: "t3",
    title: "測試案例 C · 全空白（結構 gate 全擋）",
    status: "draft",
    pct: 0,
    owner: "Scott",
    ownerId: "scott",
    authorId: "scott",
    authorAgentFamily: null,
    mine: true,
    updated: "剛剛",
    tag: "測試",
    isSample: true,
  },
];

/** 三個測試案例各自的章節正文（掛進 projectSectionValues） */
export const TEST_CASE_DOCS: Record<string, Record<string, Record<string, string>>> = {
  // A：填到接近可送審 —— gate 只剩警告，用來驗「快過關才展開」那一側
  t1: {
    summary: {
      what: "把結帳流程從三頁式改成單頁，並支援 Apple Pay / Google Pay 一鍵付款。",
      who: "行動端一般消費者，以及客服退單處理人員。",
      why: "行動端結帳放棄率 68%，遠高於桌面端 31%，Q3 營收目標缺口的主因。",
      tech: "沿用既有 Stripe Payment Element；刻意不自建卡號欄位、不導入新的 state 管理套件。",
    },
    problem: {
      problem:
        "行動端使用者在三頁式結帳中平均要點 11 次才能完成付款，其中第二頁（配送方式）放棄率最高。\n客服每週約 40 通電話與「按了付款沒反應」有關，實際是第三頁 timeout 後靜默失敗。",
      quote: "「我以為付好了，隔天才發現訂單根本沒成立。」— 客服工單 #48213",
    },
    goals: {
      goals:
        "- 行動端結帳放棄率由 68% 降到 45% 以下\n- 完成付款平均點擊數由 11 降到 4 以內\n- 付款失敗有明確錯誤訊息，不再靜默失敗",
      nongoals:
        "- 不做訂閱制與分期付款\n- 不重寫購物車，只動結帳\n- 不支援桌面端版面調整（本期只針對行動端）",
    },
    metrics: {
      m1: "放棄率 ≤ 45%（目前 68%）· 完成付款 p95 ≤ 8 秒 · 付款失敗有訊息比例 100%",
    },
    stories: {
      stories:
        "- As a 行動端消費者, I want 一鍵用 Apple Pay 付款, so that 我不用手動輸入卡號。\n- As a 客服, I want 看到付款失敗的實際原因, so that 我能直接告訴客人下一步。",
    },
    scope: {
      ms: "- M0 單頁結帳骨架（可演示的垂直切片）\n- M1 Apple Pay / Google Pay 接入\n- M2 錯誤訊息與 timeout 處理\n- M3 灰度 10% → 100%",
    },
    open: { oq: "" },
  },
  // B：手動寫了一半 —— 有內容但沒有資料夾，用來驗綁定流程
  t2: {
    summary: {
      what: "內部工具：把每週營運報表從人工貼 Excel 改成自動產生。",
      who: "營運團隊 6 人，每週一早上要交報表給主管。",
      why: "",
      tech: "",
    },
    problem: {
      problem: "每週一早上有人要花 90 分鐘手動貼數字，貼錯過三次，其中一次讓主管在會議上引用了錯的數字。",
      quote: "",
    },
    goals: { goals: "- 報表產生時間由 90 分鐘降到 5 分鐘以內", nongoals: "" },
    metrics: { m1: "" },
    stories: { stories: "" },
    scope: { ms: "" },
    open: { oq: "" },
  },
  // C：完全空白 —— 全部欄位留空，用來驗「還沒開始 ≠ 做錯了」與安靜失敗
  t3: {
    summary: { what: "", who: "", why: "", tech: "" },
    problem: { problem: "", quote: "" },
    goals: { goals: "", nongoals: "" },
    metrics: { m1: "" },
    stories: { stories: "" },
    scope: { ms: "" },
    open: { oq: "" },
  },
};

/** 依建置變體：test=多範例，正式版=空列表 */
export const SEED_PROJECTS: Project[] =
  APP_VARIANT === "test" ? buildTestProjects() : SEED_PROJECTS_PROD;

/** 正式版啟動用幽靈使用者（引導完成前不可登入） */
export const GHOST_USER: Employee = {
  id: "__setup__",
  name: "尚未設定",
  title: "待建立管理員",
  avatar: "?",
  email: "",
  accessRole: "admin",
  kind: "human",
  agentFamily: null,
  password: "",
  active: false,
  isCurrent: true,
};

/** 正式版預設簽核流：不綁示範 Agent */
export const SEED_WORKFLOW_PROD: WorkflowStageDef[] = [
  { id: "ws-eng", order: 1, name: "工程", defaultAssigneeId: null, required: true, mode: "sequential" },
  { id: "ws-design", order: 2, name: "設計", defaultAssigneeId: null, required: true, mode: "parallel" },
  { id: "ws-sec", order: 3, name: "資安", defaultAssigneeId: null, required: true, mode: "parallel" },
  { id: "ws-legal", order: 4, name: "法務", defaultAssigneeId: null, required: false, mode: "sequential" },
];

/** 把章節骨架清空為可填寫空白（正式版用） */
export function blankSections(sections: Section[]): Section[] {
  return sections.map((s) => ({
    ...s,
    status: "empty" as const,
    score: 0,
    fields: s.fields.map((f) => ({ ...f, value: "" })),
    checks: s.checks.map((c) => ({ ...c, pass: false })),
  }));
}

/**
 * 章節範本插入的統一去處：永遠是 PRD 的最後一章。
 *
 * 插入的段落不屬於任何既有章節；落在「當下開著的那一章」會讓同一份範本每次
 * 跑到不同地方，事後沒人找得到。編號要在骨架解析完之後才算，因為領域包會在
 * base 後面追加自己的章節（通用 8 章 → 09；payment 多 3 章 → 12）。
 */
export const CUSTOM_SECTION_ID = "custom";

/** 把「XX 自訂章節」接到骨架尾端，編號取當下最後一章 + 1。已存在就原樣返回。 */
export function withCustomSection(sections: Section[]): Section[] {
  if (sections.some((s) => s.id === CUSTOM_SECTION_ID)) return sections;
  return [
    ...sections,
    {
      id: CUSTOM_SECTION_ID,
      n: String(sections.length + 1).padStart(2, "0"),
      title: "自訂章節",
      desc: "章節範本插入的段落統一集中在這裡",
      status: "empty",
      guide:
        "從「章節範本」插入的段落會依序追加到這一節。這裡是自由區：既有章節放不下的補充、附錄、額外骨架都寫在這。",
      tips: [
        "插入多份範本時會依序往下接，順序即插入順序",
        "內容穩定之後，該歸屬既有章節的段落請搬回去",
      ],
      example: "",
      fields: [
        {
          key: "body",
          label: "自訂內容",
          hint: "Markdown；範本插入的段落會追加在既有內容之後",
          type: "textarea",
          rows: 16,
          value: "",
        },
      ],
      checks: [],
      score: 0,
    },
  ];
}

export const SEED_SECTIONS: Section[] = [
  {
    id: "summary",
    n: "01",
    title: "三行摘要",
    desc: "功能說明與願景 · 做什麼 · 給誰 · 為何現在 · 技術線選型",
    status: "done",
    guide: "開頭先用「功能說明與願景」講清楚這個專案的主要目的、軟體功能與實際要達成的事 —— 敘事給人讀動機，條列讓功能可逐項核對，人與機器都要讀得懂。接著用三句話讓忙碌的審閱者 10 秒內抓住全貌；再補技術線選型，讓工程／架構一眼知道「用什麼做、刻意不選什麼」。避免行話堆疊與無邊界的技術清單。",
    tips: [
      "功能說明與願景：敘事開頭、條列收尾 —— 敘事講為什麼，條列讓功能與目標可逐項核對",
      "寫具體對象，不要寫「所有使用者」",
      "「為何現在」要有外部壓力或內部期限",
      "不要在摘要塞成功指標細節",
      "技術線選型：主路徑 2–5 條即可；至少寫一項「刻意不選」與原因",
    ],
    example:
      "為 Northwind 登入流程加入 TOTP 與安全金鑰，讓企業客戶通過資安審核。技術線：TOTP + WebAuthn；不選簡訊 OTP（SIM 交換與成本）。",
    fields: [
      {
        key: "vision",
        label: "專案功能說明與願景",
        hint: "先用 2–3 句敘事講主要目的與實際要達成的事，再條列主要功能與目標。敘事給人讀動機，條列給機器（與審閱者）逐項核對 —— 兩者都要有",
        type: "textarea",
        rows: 8,
        value:
          "Northwind 的企業合約一再卡在同一個地方：登入只有密碼一道防線，資安審查過不了。本專案在既有登入／SSO 流程上補齊第二因素驗證，讓客戶的資安審核不再是簽約的阻擋項 —— 目的不是「多一個功能」，而是把安全性從銷售障礙變成賣點。\n\n主要功能：\n• TOTP 驗證（Authenticator App，RFC 6238）\n• WebAuthn／FIDO2 安全金鑰（Enterprise 方案）\n• 工作區層級的強制政策與一次性復原碼\n• 設定與變更全程寫入稽核日誌\n\n實際要達成：\n• Q4 前通過 SOC 2 相關審查項目\n• 解除三筆待簽合約的 2FA 前提條件",
      },
      { key: "what", label: "做什麼", hint: "一句話描述交付物", type: "textarea", rows: 2, value: "在 Northwind SaaS 登入流程加入 TOTP 與 WebAuthn 第二因素，並支援工作區強制政策與復原碼。" },
      { key: "who", label: "給誰", hint: "主要受益者", type: "text", value: "企業租戶管理員、一般成員、需通過 SOC 2 審核的資安團隊" },
      { key: "why", label: "為何現在", hint: "時機與壓力", type: "textarea", rows: 3, value: "近六次企業資安審查中有三次將缺少第二因素列為阻擋項；三筆待簽合約將 2FA 列為簽約前提，目標在 Q4 前關閉缺口。" },
      {
        key: "tech",
        label: "技術線選型",
        hint: "主技術路徑 · 關鍵元件 · 刻意不選（每行一條，可用 •）",
        type: "textarea",
        rows: 5,
        value:
          "• 認證擴充：在既有登入／SSO 流上掛第二因素（相容 OIDC／SAML 既有路徑）\n• 第二因素：TOTP（RFC 6238，Authenticator App）+ WebAuthn／FIDO2 安全金鑰（Enterprise）\n• 復原：可列印／下載／輪替的一次性復原碼\n• 稽核：設定、變更、移除寫入稽核日誌\n• 刻意不選：簡訊／語音 OTP（SIM 交換風險與通道成本）",
      },
    ],
    checks: [
      { id: "c1", label: "有明確交付物（非願景口號）", pass: true },
      { id: "c2", label: "受益者可指認到角色", pass: true },
      { id: "c3", label: "時機與外部壓力可驗證", pass: true },
      { id: "c4", label: "技術線選型含主路徑與至少一項不選", pass: true },
    ],
    score: 92,
  },
  {
    id: "problem",
    n: "02",
    title: "問題陳述",
    desc: "痛點、對象、佐證",
    status: "done",
    guide: "一段話說明現況傷害誰；附上一則真實引言。避免把解法寫進問題。",
    tips: ["先寫失敗模式，再寫頻率／代價", "區分外部客戶 vs 內部營運痛點", "引言最好來自實際訪談或工單"],
    example: "「我們很喜歡產品，但兩次資安審查都卡在沒有 TOTP。補上就能簽約。」— 客戶 CTO",
    fields: [
      { key: "problem", label: "問題段落", hint: "150–250 字", type: "textarea", rows: 6, value: "目前僅密碼守護工作區。對需符合 SOC 2 Type II 的企業租戶，這是控制面缺口而非觀感問題。近六次企業資安審查有三次將缺少第二因素列為阻擋。內部亦然：擁有正式環境存取的工程師與僅檢視權限的行銷成員共用同一驗證面，我們依賴政策而非態勢。" },
      { key: "quote", label: "客戶／夥伴引言", hint: "一句話 + 職稱", type: "textarea", rows: 3, value: "「我們很喜歡產品，但缺少 TOTP 在三次審查中出現兩次。補上我們就能簽約。」— Maya Reddy · CTO, Pioneer Robotics" },
    ],
    checks: [
      { id: "c1", label: "未在問題段預設解法", pass: true },
      { id: "c2", label: "有可追溯佐證（審查／工單）", pass: true },
      { id: "c3", label: "引言具名或可匿名但具體", pass: true },
    ],
    score: 88,
  },
  {
    id: "goals",
    n: "03",
    title: "目標與非目標",
    desc: "雙欄邊界",
    status: "done",
    guide: "目標可驗收；非目標明確「這次不做」。非目標能減少範圍蔓延。",
    tips: ["每條目標可對應測試或演示", "非目標寫「延後原因」更有說服力", "避免「提升體驗」這類無法驗收句"],
    example: "目標：付費方案支援 TOTP。非目標：簡訊 OTP（成本與 SIM 交換風險，列 Q1 評估）。",
    fields: [
      { key: "goals", label: "目標", hint: "每行一條", type: "textarea", rows: 5, value: "• 所有付費方案支援 TOTP（Authy / 1Password / Google Authenticator）\n• Enterprise 支援安全金鑰（WebAuthn）\n• 管理員可強制工作區全員啟用 2FA\n• 可列印／下載／重新產生復原碼\n• 設定、變更、移除寫入稽核日誌" },
      { key: "nongoals", label: "非目標", hint: "每行一條", type: "textarea", rows: 4, value: "• 簡訊／語音 OTP（成本與 SIM 交換風險）\n• 生物辨識裝置綁定的跨裝置漫遊（跟 WebAuthn 路線圖）\n• 取代現有 SSO／SAML 流程\n• 強制免費方案啟用 2FA" },
    ],
    checks: [
      { id: "c1", label: "目標可驗收", pass: true },
      { id: "c2", label: "至少 3 條非目標", pass: true },
      { id: "c3", label: "目標與非目標無互相矛盾", pass: true },
    ],
    score: 90,
  },
  {
    id: "metrics",
    n: "04",
    title: "成功指標",
    desc: "指標 / 目標 / 量測",
    status: "warn",
    guide: "每列：指標名稱、目標值、量測方式。避免只有虛榮指標。",
    tips: ["至少一項領先指標 + 一項落後指標", "寫清楚分母（誰算啟用）", "資安相關可加合規里程碑"],
    example: "企業租戶 2FA 覆蓋率 ≥ 80%（90 天）· 量測：工作區政策 + 成員啟用事件。",
    fields: [
      { key: "m1", label: "指標列（Markdown 表可）", hint: "指標 | 目標 | 量測", type: "textarea", rows: 6, value: "指標 | 目標 | 量測\n---|---|---\n企業租戶 2FA 覆蓋率 | ≥ 80%（GA 後 90 天） | 工作區強制政策 + 成員啟用事件\n因缺少 2FA 卡住的資安審查 | 歸零（兩季內） | 銷售／資安聯合追蹤表\n2FA 設定完成率 | ≥ 70% 開始設定者完成 | 漏斗：開始 → 驗證 → 復原碼確認\n登入失敗率（2FA 相關） | < 2% 額外失敗 | 認證服務錯誤碼" },
    ],
    checks: [
      { id: "c1", label: "每列含目標值", pass: true },
      { id: "c2", label: "量測方式可實作", pass: true },
      { id: "c3", label: "含至少一個領先指標", pass: false },
    ],
    score: 72,
  },
  {
    id: "stories",
    n: "05",
    title: "使用者故事",
    desc: "As-a / I-want / So-that",
    status: "done",
    guide: "每則故事一個角色、一個意圖、一個價值。可加驗收條件。",
    tips: ["角色用產品內真實角色名", "避免「作為使用者我想要系統…」", "資安故事要寫威脅模型連結"],
    example: "作為工作區管理員，我想要強制全員 2FA，以便通過客戶資安問卷。",
    fields: [
      { key: "stories", label: "故事列表", hint: "編號 + 三句式", type: "textarea", rows: 7, value: "1. 作為成員，我想要綁定 TOTP，以便在密碼外多一層保護。\n2. 作為工作區管理員，我想要強制全員 2FA，以便通過客戶資安問卷。\n3. 作為遺失手機的成員，我想要用復原碼登入，以便不中斷工作。\n4. 作為資安審核員，我想要匯出 2FA 啟用稽核紀錄，以便佐證控制有效。\n5. 作為 Enterprise 管理員，我想要允許安全金鑰，以便符合硬體金鑰政策。" },
    ],
    checks: [
      { id: "c1", label: "皆為三句式", pass: true },
      { id: "c2", label: "覆蓋管理員與終端使用者", pass: true },
      { id: "c3", label: "含復原／例外路徑", pass: true },
    ],
    score: 86,
  },
  {
    id: "scope",
    n: "06",
    title: "範圍與里程碑",
    desc: "3–4 個階段",
    status: "warn",
    guide: "每個里程碑：產出、依賴、大致工時。標出可單獨上線的切片。",
    tips: ["M0 最好是可演示的垂直切片", "標出跨隊依賴（設計、法務、資安）", "不要把「研究」當唯一里程碑產出"],
    example: "M1：TOTP 自願啟用 · M2：復原碼 + 稽核 · M3：強制政策 · M4：WebAuthn",
    fields: [
      { key: "ms", label: "里程碑", hint: "階段 / 產出 / 時間", type: "textarea", rows: 6, value: "M1 自願 TOTP（3 週）— 設定與登入挑戰，個人設定頁\nM2 復原與稽核（2 週）— 復原碼、稽核事件、協助中心文案\nM3 工作區強制（2 週）— 管理員政策、寬限期、鎖定流程\nM4 WebAuthn Enterprise（3 週）— 安全金鑰註冊與登入" },
    ],
    checks: [
      { id: "c1", label: "3–4 個可交付階段", pass: true },
      { id: "c2", label: "標註依賴或風險", pass: false },
      { id: "c3", label: "有可單獨上線切片", pass: true },
    ],
    score: 68,
  },
  {
    id: "open",
    n: "07",
    title: "開放問題",
    desc: "問題 + 負責人",
    status: "empty",
    guide: "每個問題要有 assignee 與決策期限，否則會變成永久待辦。",
    tips: ["寫成可回答的問題，不要寫主題標籤", "區分產品決策 vs 工程調查", "已決問題移出並記結論"],
    example: "寬限期預設 7 天還是 14 天？→ 產品 · 8/12 前",
    fields: [
      { key: "oq", label: "開放問題", hint: "問題 · 負責人 · 期限", type: "textarea", rows: 5, value: "• 強制 2FA 的寬限期預設幾天？— 林可晴 · 待決\n• 復原碼用盡後的協助流程是否走 Zendesk？— 周承翰 · 待決\n• WebAuthn 是否允許平台驗證器（Touch ID）？— 黃詩涵 · 待決" },
    ],
    checks: [
      { id: "c1", label: "每題有負責人", pass: true },
      { id: "c2", label: "每題有期限", pass: false },
      { id: "c3", label: "少於 8 題（避免規格癱瘓）", pass: true },
    ],
    score: 54,
  },
];

/**
 * 整份 PRD 範本 —— 市場上通行的十種寫法，依「寫給誰看、要多重」分五類。
 *
 * 每一份都標出處：範本會被照抄，抄的人有權知道自己抄的是誰的方法論，以及
 * 那套方法論原本假設的情境（Shape Up 假設六週固定週期，PR/FAQ 假設有對外
 * 發表的一天）。抄走假設卻不知道假設存在，是範本最常見的災難。
 *
 * 出處查證日：2026-08-11。
 */
export const SEED_FULL_TEMPLATES: Template[] = [
  // ── 精簡型 ──────────────────────────────────────────────────
  {
    id: "f1",
    kind: "full",
    cat: "lean",
    title: "一頁式 PRD（1-pager）",
    blurb: "五個標題、一頁寫完。現代新創主流，也是這套工具的預設節奏。",
    source: "現代新創通行寫法（Lenny / Aakash Gupta 等現代 PRD 指南）",
    sourceUrl: "https://www.news.aakashg.com/p/product-requirements-documents-prds",
    uses: 0,
    body: "# [功能名稱]\n\n**負責人：** ｜ **日期：** ｜ **狀態：** 草稿 / 審閱中 / 已核准\n\n## 1. 問題\n[誰在痛、多常痛、痛的代價是多少。用證據，不用形容詞]\n\n## 2. 提案\n[使用者會看到什麼、做什麼。描述體驗，不描述實作]\n\n## 3. 成功指標\n- 主要：[一個數字 + 目標 + 期限]\n- 護欄：[不能因此惡化的數字]\n\n## 4. 不做什麼\n- [刻意排除的範圍]（原因：…）\n\n## 5. 開放問題\n| # | 問題 | 誰能回答 | 最晚需要 |\n|---|---|---|---|\n| 1 | … | … | … |",
  },
  {
    id: "f2",
    kind: "full",
    cat: "lean",
    title: "精實 MVP PRD（假設驅動）",
    blurb: "把整份文件當成一組待驗證的假設，寫明「什麼結果會讓我們收手」。",
    source: "Lean Startup 假設驗證框架",
    uses: 0,
    body: "# [MVP 名稱]\n\n## 我們相信\n[目標客群] 有 [問題]，因為 [證據]。\n\n## 最小驗證\n我們要打造 [最小的東西] 來驗證這件事。\n\n## 核心假設\n| # | 假設 | 類型 | 怎麼驗 | 判定門檻 |\n|---|---|---|---|---|\n| 1 | … | 需求 / 價值 / 可行性 | … | … |\n\n## 這一輪要學到什麼\n- …（學習目標，不是交付目標）\n\n## 成功／失敗判準\n- 繼續投入：[指標] ≥ [值]\n- 轉向：[指標] 落在 [區間]\n- 收手：[指標] ≤ [值]\n\n## 刻意不做\n- …\n\n## 時間盒\n[幾週。到期就檢視結果，不延長]",
  },

  // ── 敘事型 ──────────────────────────────────────────────────
  {
    id: "f3",
    kind: "full",
    cat: "narrative",
    title: "Amazon PR/FAQ（Working Backwards）",
    blurb: "先寫上市新聞稿與 FAQ，再回推要做什麼。逼你先講清楚客戶得到什麼。",
    source: "Amazon Working Backwards（PR/FAQ）",
    uses: 0,
    body: "# 新聞稿（假設今天已經上線）\n\n## 標題\n[一句話，客戶看得懂的白話]\n\n## 副標\n[給誰、解決什麼]\n\n## 摘要段\n[地點、日期]—— [公司] 今天推出 [產品]，讓 [客群] 可以 [價值]。\n\n## 問題段\n[今天客戶怎麼受苦]\n\n## 解法段\n[我們怎麼解決]\n\n## 主管引言\n> 「…」—— [姓名]，[職稱]\n\n## 客戶引言\n> 「…」—— [客戶姓名]，[公司]\n\n## 如何開始\n[客戶下一步做什麼]\n\n---\n\n# 對外 FAQ\n**Q：這要多少錢？**\nA：…\n\n**Q：跟現有的 [X] 有什麼不同？**\nA：…\n\n---\n\n# 對內 FAQ\n**Q：市場規模與商業模式？**\nA：…\n\n**Q：最大的技術風險是什麼？**\nA：…\n\n**Q：我們為什麼有資格做這件事？**\nA：…\n\n**Q：什麼情況下我們會失敗？**\nA：…",
  },
  {
    id: "f4",
    kind: "full",
    cat: "narrative",
    title: "六頁敘事備忘錄",
    blurb: "散文而非條列，會議前 20 分鐘靜讀。條列會藏掉推理過程，散文藏不住。",
    source: "Amazon 六頁備忘錄（Narrative Memo）",
    uses: 0,
    body: "# [主題]\n\n> 全文以完整段落書寫，不用條列。資料放附錄。\n\n## 一、背景\n[讀者需要知道的前情，假設他完全沒跟過這件事]\n\n## 二、現況與問題\n[目前發生什麼、量化的傷害]\n\n## 三、我們的提案\n[主張。以及為什麼是這個而不是別的]\n\n## 四、我們考慮過但沒選的路\n[選項、取捨、為什麼放棄]\n\n## 五、風險與我們的準備\n[最可能出錯的地方，以及發生時怎麼辦]\n\n## 六、要什麼決定\n[要與會者決定什麼，決定的期限]\n\n## 附錄\n- A. 數據\n- B. 客戶原話\n- C. 財務估算",
  },

  // ── 完整型 ──────────────────────────────────────────────────
  {
    id: "f5",
    kind: "full",
    cat: "enterprise",
    title: "傳統完整 PRD（跨部門審閱版）",
    blurb: "工程／設計／法務／資安都要簽的那種。章節多，但每章都有人在等。",
    source: "Marty Cagan 四段式 PRD 的企業擴充版",
    uses: 0,
    body: "# [產品／功能名稱] PRD\n\n| 項目 | 內容 |\n|---|---|\n| 文件狀態 | 草稿 / 審閱中 / 已核准 |\n| 目標版本 | |\n| 文件負責人 | |\n| 工程負責人 | |\n| 設計負責人 | |\n| QA 負責人 | |\n\n## 1. 目的與背景\n[這個專案支撐哪一個組織目標]\n\n## 2. 目標與非目標\n**目標**\n- [可驗收]\n\n**非目標**\n- [延後原因]\n\n## 3. 使用者與情境\n| 角色 | 情境 | 現在怎麼做 | 痛點 |\n|---|---|---|---|\n\n## 4. 功能需求\n| # | 使用者故事 | 優先度 | 驗收條件 |\n|---|---|---|---|\n| R1 | 作為…我想要…以便… | P0 | … |\n\n## 5. 非功能需求\n| 面向 | 要求 | 怎麼量 |\n|---|---|---|\n| 效能 | | |\n| 可用性 | | |\n| 安全 | | |\n| 無障礙 | | |\n\n## 6. 相依與假設\n- 依賴：…\n- 假設：…（假設若不成立會怎樣）\n\n## 7. 風險\n| 風險 | 機率 | 影響 | 緩解 | 負責人 |\n|---|---|---|---|---|\n\n## 8. 里程碑與上線計畫\n| 階段 | 範圍 | 時間 | 出口條件 |\n|---|---|---|---|\n\n## 9. 成功指標\n| 指標 | 基準 | 目標 | 量測方式 |\n|---|---|---|---|\n\n## 10. 開放問題\n| # | 問題 | 誰能回答 | 最晚需要 |\n|---|---|---|---|",
  },
  {
    id: "f6",
    kind: "full",
    cat: "enterprise",
    title: "金融／法遵 PRD",
    blurb: "多一層法規依據、資料分類與稽核軌跡 — 金管會與內稽會逐條問的那幾項。",
    source: "金融業內控與資安審查常見要求整理",
    uses: 0,
    body: "# [業務功能] PRD（法遵版）\n\n## 1. 業務背景與法規依據\n- 業務目的：…\n- 適用法規／函令：…\n- 內部規章：…\n\n## 2. 目標與非目標\n- 目標：…\n- 非目標：…\n\n## 3. 業務流程\n[主流程 + 例外流程 + 人工介入點]\n\n## 4. 客戶身分與授權\n- KYC／再驗證觸發條件：…\n- 授權層級與雙人覆核：…\n\n## 5. 資料\n| 欄位 | 分類 | 是否個資 | 加密 | 保存年限 | 銷毀方式 |\n|---|---|---|---|---|---|\n\n## 6. 風險控管\n| 風險類型 | 情境 | 控制措施 | 監控指標 |\n|---|---|---|---|\n| 作業風險 | | | |\n| 詐欺風險 | | | |\n| 資安風險 | | | |\n\n## 7. 稽核軌跡\n- 記錄事件：…\n- 保存位置與年限：…\n- 誰可以查、怎麼查：…\n\n## 8. 異常與客訴處理\n- 對客說明：…\n- 補救與返還機制：…\n\n## 9. 上線與退場\n- 分階段放量與觀察指標：…\n- 回滾條件與步驟：…\n- 業務退場時的客戶權益處理：…\n\n## 10. 待審查事項\n| # | 事項 | 送審單位 | 狀態 |\n|---|---|---|---|",
  },

  // ── 敏捷型 ──────────────────────────────────────────────────
  {
    id: "f7",
    kind: "full",
    cat: "agile",
    title: "Atlassian 產品需求藍圖",
    blurb: "文件表頭 + 目標 + 假設 + 需求表 + 不做清單，直接對到 Jira issue。",
    source: "Atlassian Confluence Product Requirements Blueprint",
    sourceUrl: "https://www.atlassian.com/software/confluence/templates/product-requirements",
    uses: 0,
    body: "# [專案名稱]\n\n| 項目 | 內容 |\n|---|---|\n| 目標發布 | |\n| Epic | [連結] |\n| 文件負責人 | |\n| 設計 | |\n| 技術主導 | |\n| QA | |\n\n## 目標\n[這個專案怎麼支撐組織更大的目標]\n\n## 成功指標\n| 指標 | 目標 |\n|---|---|\n\n## 假設\n- 使用者假設：…\n- 技術限制：…\n- 商業目標假設：…\n\n## 里程碑\n| 里程碑 | 日期 | 內容 |\n|---|---|---|\n\n## 需求\n| # | 需求 | 使用者故事 | 重要性 | Jira | 備註 |\n|---|---|---|---|---|---|\n| 1 | | 作為…我想要…以便… | 必要 / 次要 | | |\n\n## 使用者互動與設計\n[設計稿連結、關鍵畫面說明]\n\n## 待確認問題\n| 問題 | 答案 |\n|---|---|\n\n## 不做\n- …",
  },
  {
    id: "f8",
    kind: "full",
    cat: "agile",
    title: "Shape Up Pitch",
    blurb: "五要素：問題、胃口、解法、兔子洞、不做。先定時間再定範圍。",
    source: "Basecamp《Shape Up》第 1.5 章「Write the Pitch」",
    sourceUrl: "https://basecamp.com/shapeup/1.5-chapter-06",
    uses: 0,
    body: "# Pitch：[名稱]\n\n## 1. 問題（Problem）\n[原始的點子、一個使用情境、或我們親眼看到的事。一個具體故事勝過一段歸納]\n\n## 2. 胃口（Appetite）\n[我們願意花多少時間：小批次 2 週 / 大批次 6 週]\n\n> 胃口是限制，不是估算。範圍要塞進胃口，不是胃口去配合範圍。\n\n## 3. 解法（Solution）\n[核心元素，用胖筆觸描述 —— 夠具體讓人懂，夠模糊讓工程有空間]\n\n[附草圖／流程]\n\n## 4. 兔子洞（Rabbit holes）\n- [已知會吃掉時間的細節，以及我們的處理方式]\n\n## 5. 不做（No-gos）\n- [為了塞進胃口，刻意排除的功能或情境]",
  },

  // ── 技術型 ──────────────────────────────────────────────────
  {
    id: "f9",
    kind: "full",
    cat: "technical",
    title: "Google 式設計文件（Design Doc）",
    blurb: "脈絡、目標／非目標、設計、考慮過的其他方案 — 重點在取捨被寫下來。",
    source: "Design Docs at Google（industrialempathy.com）",
    sourceUrl: "https://www.industrialempathy.com/posts/design-docs-at-google/",
    uses: 0,
    body: "# [系統／功能] 設計文件\n\n**作者：** ｜ **審閱者：** ｜ **日期：**\n\n## 脈絡與範圍\n[讀者需要的背景。假設他知道這個領域，但不知道這件事]\n\n## 目標\n- …\n\n## 非目標\n- …（是可以合理當成目標、但我們刻意不當目標的事）\n\n## 實際設計\n[系統怎麼運作。圖、資料流、介面、儲存]\n\n### API／介面\n\n### 資料模型\n\n### 錯誤與降級行為\n\n## 考慮過的其他方案\n### 方案 A：[名稱]\n- 取捨：…\n- 為什麼不選：…\n\n### 方案 B：[名稱]\n- 取捨：…\n- 為什麼不選：…\n\n## 跨領域考量\n- 安全與隱私：…\n- 可觀測性：…\n- 成本：…\n- 遷移與相容性：…\n\n## 未解問題\n- …",
  },
  {
    id: "f10",
    kind: "full",
    cat: "technical",
    title: "OpenSpec Change 全套",
    blurb: "proposal + spec delta + tasks 三件一組，交給 agent 直接開工。",
    source: "OpenSpec 官方文件（docs/concepts.md）",
    uses: 0,
    body: "# Proposal: [變更名稱]\n\n## Intent\n[為什麼現在要做，誰在痛]\n\n## Scope\nIn scope:\n- …\n\nOut of scope:\n- …（延後原因）\n\n## Approach\n[高層次做法。技術取捨留給 design.md]\n\n---\n\n# Spec Delta\n\n## ADDED Requirements\n\n### Requirement: [新行為]\nThe system MUST [可觀察的行為]。\n\n#### Scenario: [正常路徑]\n- GIVEN [前提]\n- WHEN [動作]\n- THEN [可驗證結果]\n\n#### Scenario: [例外路徑]\n- GIVEN [異常前提]\n- WHEN [同樣動作]\n- THEN [錯誤處理]\n\n## MODIFIED Requirements\n\n### Requirement: [既有行為名稱（原字不動）]\n[新敘述]\n（Previously: [舊敘述]）\n\n---\n\n# Tasks\n\n## 1. [第一組]\n- [ ] 1.1 [一次做得完的動作]\n\n## 2. 驗證\n- [ ] 2.1 [怎麼知道真的做完了]",
  },
];

export const SEED_TEMPLATES: Template[] = [
  { id: "t1", cat: "core", title: "三行摘要", blurb: "功能與願景 / 做什麼 / 給誰 / 為何現在 — 審閱者 10 秒抓重點。", uses: 0, body: "## 專案功能說明與願景\n（2–3 句敘事：主要目的與實際要達成的事）\n\n主要功能：\n- …\n- …\n\n## 摘要\n- **做什麼：** …\n- **給誰：** …\n- **為何現在：** …" },
  { id: "t2", cat: "core", title: "問題陳述 + 引言", blurb: "痛點段落搭配具名客戶引言，禁止先寫解法。", uses: 0, body: "## 問題\n[現況傷害誰、頻率、代價]\n\n> 「引言」— 姓名 · 職稱，公司" },
  { id: "t3", cat: "core", title: "目標 / 非目標", blurb: "雙欄邊界，非目標寫延後原因。", uses: 0, body: "## 目標\n- [可驗收]\n\n## 非目標\n- [延後原因]" },
  { id: "t4", cat: "core", title: "成功指標表", blurb: "指標 | 目標 | 量測 — 含領先與落後指標。", uses: 0, body: "| 指標 | 目標 | 量測 |\n|---|---|---|\n| … | … | … |" },
  { id: "t5", cat: "core", title: "使用者故事", blurb: "As-a / I-want / So-that，含例外路徑。", uses: 0, body: "作為 [角色]，我想要 [能力]，以便 [價值]。\n驗收：\n- …" },
  { id: "t6", cat: "core", title: "里程碑切片", blurb: "3–4 階段，每段可單獨上線。", uses: 0, body: "### M1 — 名稱（工期）\n- 產出：\n- 依賴：\n- 風險：" },
  { id: "t7", cat: "security", title: "威脅模型摘要", blurb: "資產、攻擊者、緩解 — 資安審閱友善。", uses: 0, body: "## 威脅模型\n- **資產：**\n- **攻擊者：**\n- **緩解控制：**\n- **殘餘風險：**" },
  { id: "t8", cat: "security", title: "合規對照", blurb: "對應 SOC 2 / ISO 控制項與證據。", uses: 0, body: "| 控制 | 需求 | 本功能證據 |\n|---|---|---|\n| CC6.1 | … | … |" },
  { id: "t9", cat: "security", title: "資料分類與滯留", blurb: "PII 欄位、加密、保存期限。", uses: 0, body: "## 資料\n- 欄位：\n- 分類：\n- 加密：靜態 / 傳輸\n- 滯留：" },
  { id: "t10", cat: "growth", title: "實驗設計", blurb: "假設、變體、成功門檻、停止條件。", uses: 0, body: "## 實驗\n- 假設：\n- 變體：\n- 主要指標：\n- 門檻：\n- 停止條件：" },
  { id: "t11", cat: "growth", title: "定價與包裝影響", blurb: "方案可用性、升級路徑、溝通。", uses: 0, body: "## 包裝\n- Free / Pro / Ent：\n- 升級觸發：\n- 對客溝通：" },
  { id: "t12", cat: "platform", title: "API 契約草稿", blurb: "端點、錯誤碼、相容性承諾。", uses: 0, body: "## API\n`POST /v1/…`\n- 請求：\n- 回應：\n- 錯誤：\n- 相容性：" },
  // ── OpenSpec ────────────────────────────────────────────────
  // 格式取自 openspec 官方文件（docs/concepts.md）：三層固定
  // ## Purpose → ### Requirement: → #### Scenario:，動詞用 RFC 2119。
  { id: "t13", cat: "openspec", title: "Requirement + Scenario", blurb: "OpenSpec 規格的最小單位 — 行為契約配可驗證情境。", uses: 0, body: "### Requirement: [這個系統應該做到什麼]\nThe system SHALL [可觀察的行為]。\n\n#### Scenario: [正常路徑]\n- GIVEN [前提狀態]\n- WHEN [觸發動作]\n- THEN [可驗證的結果]\n- AND [附帶結果]\n\n#### Scenario: [例外路徑]\n- GIVEN [異常前提]\n- WHEN [同樣的動作]\n- THEN [錯誤處理]" },
  { id: "t14", cat: "openspec", title: "Delta Spec（ADDED / MODIFIED / REMOVED）", blurb: "只描述這次改什麼，不重述整份規格 — brownfield 用。", uses: 0, body: "## ADDED Requirements\n\n### Requirement: [新行為]\nThe system MUST [行為]。\n\n#### Scenario: [情境]\n- GIVEN …\n- WHEN …\n- THEN …\n\n## MODIFIED Requirements\n\n### Requirement: [既有行為名稱（原字不動）]\n[新的敘述]\n（Previously: [舊的敘述]）\n\n## REMOVED Requirements\n\n### Requirement: [要移除的行為]\n（[為什麼不再需要]）" },
  { id: "t15", cat: "openspec", title: "OpenSpec Proposal", blurb: "Intent / Scope / Approach — change 資料夾的入口文件。", uses: 0, body: "# Proposal: [變更名稱]\n\n## Intent\n[為什麼現在要做這件事，誰在痛]\n\n## Scope\nIn scope:\n- …\n\nOut of scope:\n- …（寫明延後原因）\n\n## Approach\n[高層次做法。技術取捨留給 design.md]" },
  { id: "t16", cat: "openspec", title: "Tasks 實作清單", blurb: "階層編號 + checkbox，agent 與人共用同一份進度。", uses: 0, body: "# Tasks\n\n## 1. [第一組]\n- [ ] 1.1 [一次能做完的動作]\n- [ ] 1.2 …\n\n## 2. [第二組]\n- [ ] 2.1 …\n- [ ] 2.2 …\n\n## 3. 驗證\n- [ ] 3.1 [怎麼知道真的做完了]" },

  // ── 交付 ────────────────────────────────────────────────────
  { id: "t17", cat: "delivery", title: "上線與回滾計畫", blurb: "分階段放量、回滾條件、負責人 — 出事時照著做。", uses: 0, body: "## 上線\n| 階段 | 範圍 | 觀察指標 | 停留時間 |\n|---|---|---|---|\n| 1 | 內部 | … | 1 天 |\n| 2 | 5% | … | 2 天 |\n| 3 | 全量 | … | — |\n\n## 回滾條件（任一成立就回滾）\n- [指標] 惡化超過 [門檻]\n- …\n\n## 回滾步驟\n1. …\n\n## 負責人\n- 上線：\n- On-call：" },
  { id: "t18", cat: "delivery", title: "決策紀錄（ADR）", blurb: "背景、選項、決定、後果 — 半年後還看得懂為什麼。", uses: 0, body: "# ADR-[編號]：[決策標題]\n\n**狀態：** 提案中 / 已採用 / 已取代\n**日期：** \n\n## 背景\n[什麼情況逼我們必須做決定]\n\n## 選項\n| 選項 | 優點 | 代價 |\n|---|---|---|\n| A | … | … |\n| B | … | … |\n\n## 決定\n選 [X]，因為 […]。\n\n## 後果\n- 我們接受：…\n- 我們放棄：…\n- 之後若 [條件] 成立，應重新評估。" },
  { id: "t19", cat: "delivery", title: "風險登記表", blurb: "機率 × 影響 × 緩解 × 負責人，不寫負責人等於沒登記。", uses: 0, body: "| 風險 | 機率 | 影響 | 緩解措施 | 負責人 | 觸發訊號 |\n|---|---|---|---|---|---|\n| … | 高/中/低 | 高/中/低 | … | … | … |" },
  { id: "t20", cat: "delivery", title: "相依與阻塞", blurb: "誰擋住我們、我們擋住誰，含最晚需要的日期。", uses: 0, body: "## 我們依賴\n| 對象 | 需要什麼 | 最晚需要 | 目前狀態 |\n|---|---|---|---|\n| … | … | … | 已確認/等待中/未接洽 |\n\n## 依賴我們\n| 對象 | 需要我們什麼 | 承諾時間 |\n|---|---|---|\n| … | … | … |" },
  { id: "t21", cat: "delivery", title: "發布檢查清單", blurb: "上線前最後一關 — 每一項都要有人勾。", uses: 0, body: "## 發布前\n- [ ] 功能開關預設為關\n- [ ] 監控與告警已建立\n- [ ] 回滾步驟已實測\n- [ ] 文件／說明已更新\n- [ ] 客服與業務已告知\n\n## 發布後 24 小時\n- [ ] 錯誤率在基準內\n- [ ] 核心指標無異常\n- [ ] 回報管道無新型客訴" },

  // ── 研究 ────────────────────────────────────────────────────
  { id: "t22", cat: "research", title: "使用者訪談摘要", blurb: "原話優先於歸納 — 歸納會漂，原話不會。", uses: 0, body: "## 受訪者\n[角色 · 情境 · 日期]\n\n## 他實際說的（原話）\n> 「…」\n> 「…」\n\n## 他實際做的（觀察）\n- …\n\n## 我的解讀\n- …（標明這是解讀，不是他說的）\n\n## 對這份 PRD 的影響\n- …" },
  { id: "t23", cat: "research", title: "競品對照", blurb: "比行為不比功能清單 — 功能清單誰都寫得長。", uses: 0, body: "| 面向 | 我們 | [競品 A] | [競品 B] |\n|---|---|---|---|\n| 使用者第一次要做什麼 | … | … | … |\n| 最常用的路徑幾步 | … | … | … |\n| 失敗時怎麼處理 | … | … | … |\n| 收費方式 | … | … | … |\n\n## 我們刻意不做的\n- …（以及為什麼）" },
  { id: "t24", cat: "research", title: "開放問題紀錄", blurb: "問題、卡住誰、需要誰回答、最晚何時要答案。", uses: 0, body: "| # | 問題 | 卡住什麼 | 誰能回答 | 最晚需要 | 狀態 |\n|---|---|---|---|---|---|\n| 1 | … | … | … | … | 待回覆 |" },

  // ── 核心補充 ────────────────────────────────────────────────
  { id: "t25", cat: "core", title: "非功能需求（NFR）", blurb: "效能、可用性、無障礙 — 沒寫數字就不算需求。", uses: 0, body: "| 面向 | 要求 | 怎麼量 |\n|---|---|---|\n| 效能 | [p95 < N ms] | … |\n| 可用性 | [月度 99.x%] | … |\n| 容量 | [同時 N 人 / N req/s] | … |\n| 無障礙 | [WCAG 2.2 AA] | … |\n| 相容性 | [瀏覽器／OS 範圍] | … |\n| 在地化 | [語系] | … |" },
  { id: "t26", cat: "core", title: "量測與埋點計畫", blurb: "先想清楚要回答什麼問題，再決定埋什麼點。", uses: 0, body: "## 這個功能要回答的問題\n1. …\n\n## 事件\n| 事件名 | 何時觸發 | 屬性 | 回答上面哪一題 |\n|---|---|---|---|\n| … | … | … | 1 |\n\n## 判定成功的門檻\n- [指標] 在 [期間] 內達到 [數值]\n\n## 什麼情況算失敗（要收手）\n- …" },

  ...SEED_FULL_TEMPLATES,
];

/** 示範留言 —— 全部屬於示範專案 p1 */
export const SEED_COMMENTS: Comment[] = [
  {
    id: "c1",
    projectId: "p1",
    author: "Codex",
    authorId: "codex-approve",
    avatar: "X+",
    time: "2 小時前",
    anchor: "§ 成功指標",
    body: "80% 覆蓋率的分母是「有強制政策的企業租戶」還是「所有企業成員」？建議寫進量測欄，避免實作時爭議。",
    resolved: false,
  },
  {
    id: "c2",
    projectId: "p1",
    author: "Grok",
    authorId: "grok-edit",
    avatar: "G",
    time: "昨天",
    anchor: "§ 里程碑 · 寬限期",
    body: "若寬限期是 7 天，管理員設定頁需要倒數與例外名單。14 天則可簡化第一版。我傾向 14，等產品拍板。",
    resolved: false,
  },
  {
    id: "c3",
    projectId: "p1",
    author: "Claude Code",
    authorId: "claude-approve",
    avatar: "C+",
    time: "3 小時前",
    anchor: "§ 開放問題 · WebAuthn",
    body: "平台驗證器（Touch ID / Windows Hello）建議允許，但 Enterprise 政策要能限制為「僅漫遊金鑰」。我核准前需要這條寫進非目標或目標。",
    resolved: false,
  },
];

export const SEED_APPROVALS: Approval[] = [
  { id: "eng", role: "工程", name: "Codex · 核准", state: "approved", assigneeId: "codex-approve" },
  { id: "design", role: "設計", name: "Grok · 核准", state: "approved", assigneeId: "grok-approve" },
  { id: "sec", role: "資安", name: "Claude Code · 核准", state: "pending", assigneeId: "claude-approve" },
  { id: "legal", role: "法務", name: "Agy · 核准", state: "empty", assigneeId: "agy-approve" },
];

/** 預設簽核流程設計 */
export const SEED_WORKFLOW: WorkflowStageDef[] = [
  { id: "ws-eng", order: 1, name: "工程", defaultAssigneeId: "codex-approve", required: true, mode: "sequential" },
  { id: "ws-design", order: 2, name: "設計", defaultAssigneeId: "grok-approve", required: true, mode: "parallel" },
  { id: "ws-sec", order: 3, name: "資安", defaultAssigneeId: "claude-approve", required: true, mode: "parallel" },
  { id: "ws-legal", order: 4, name: "法務", defaultAssigneeId: "agy-approve", required: false, mode: "sequential" },
];

export function buildSeedCase(projectId: string, employees: Employee[]): CaseRecord {
  const byId = Object.fromEntries(employees.map((e) => [e.id, e]));
  const stages = SEED_WORKFLOW.map((w, i) => {
    const emp = w.defaultAssigneeId ? byId[w.defaultAssigneeId] : null;
    const seed = SEED_APPROVALS[i];
    return {
      id: seed?.id ?? w.id,
      stageDefId: w.id,
      order: w.order,
      name: w.name,
      assigneeId: emp?.id ?? null,
      assigneeName: seed?.name ?? (emp ? emp.name : "待指派"),
      state: (seed?.state ?? "empty") as CaseRecord["stages"][0]["state"],
      mode: w.mode,
      required: w.required,
    };
  });
  return {
    projectId,
    stages,
    round: 1,
    log: [],
    reviewCommitId: null,
    withdrawn: false,
    withdrawnAt: null,
    withdrawnBy: null,
    withdrawReason: null,
    locked: false,
  };
}

/** 測試版示範帳號（密碼一律 demo）；正式版不載入 */
export const SEED_EMPLOYEES_DEMO: Employee[] = [
  {
    id: "scott",
    name: "Scott",
    title: "Workspace 管理員",
    avatar: "S",
    email: "scott@anchorline.local",
    accessRole: "admin",
    kind: "human",
    agentFamily: null,
    password: "demo",
    isCurrent: true,
    active: true,
  },
  {
    id: "claude-approve",
    name: "Claude Code",
    title: "Claude Code · 核准 Agent",
    avatar: "C+",
    email: "claude.approve@agents.local",
    accessRole: "approver",
    kind: "agent",
    agentFamily: "claude",
    password: "demo",
    isCurrent: false,
    active: true,
    agentEnabled: true,
    agentRoleBrief:
      "你是 Claude Code 核准 Agent。負責 PRD 資安與合規面向的簽核，檢查威脅模型、驗收與殘餘風險是否清楚。不可修改內文，只能簽核或退回意見。",
    agentPrompt:
      "Role: Approver (Claude Code)\nGoal: Review PRD for security completeness before approval.\nRules:\n- Never rewrite body content\n- Flag missing non-goals / threat model / recovery paths\n- Approve only when residual risk is explicit\nLanguage: zh-TW",
  },
  {
    id: "claude-edit",
    name: "Claude Code",
    title: "Claude Code · 編輯 Agent",
    avatar: "C",
    email: "claude.edit@agents.local",
    accessRole: "editor",
    kind: "agent",
    agentFamily: "claude",
    password: "demo",
    isCurrent: false,
    active: true,
    agentEnabled: true,
    agentRoleBrief:
      "你是 Claude Code 編輯 Agent。負責結構化撰寫與補強 PRD 章節，產出可驗收的目標、故事與里程碑。",
    agentPrompt:
      "Role: Editor (Claude Code)\nGoal: Draft and improve PRD sections with clear acceptance criteria.\nStyle: precise, structured, zh-TW\nAvoid: vague marketing language",
  },
  {
    id: "codex-approve",
    name: "Codex",
    title: "Codex · 核准 Agent",
    avatar: "X+",
    email: "codex.approve@agents.local",
    accessRole: "approver",
    kind: "agent",
    agentFamily: "codex",
    password: "demo",
    isCurrent: false,
    active: true,
    agentEnabled: true,
    agentRoleBrief:
      "你是 Codex 核准 Agent。偏工程可行性簽核：API 邊界、依賴、實作風險。不可改內文。",
    agentPrompt:
      "Role: Approver (Codex)\nFocus: engineering feasibility, API contracts, dependencies.\nOutput: approve / request-changes with bullet reasons.",
  },
  {
    id: "codex-edit",
    name: "Codex",
    title: "Codex · 編輯 Agent",
    avatar: "X",
    email: "codex.edit@agents.local",
    accessRole: "editor",
    kind: "agent",
    agentFamily: "codex",
    password: "demo",
    isCurrent: false,
    active: true,
    agentEnabled: true,
    agentRoleBrief:
      "你是 Codex 編輯 Agent。補強技術範圍、API 契約草稿與里程碑切片。",
    agentPrompt:
      "Role: Editor (Codex)\nWrite technical scope, milestones, and API sketches.\nPrefer tables and checklists. Language: zh-TW",
  },
  {
    id: "grok-approve",
    name: "Grok",
    title: "Grok · 核准 Agent",
    avatar: "G+",
    email: "grok.approve@agents.local",
    accessRole: "approver",
    kind: "agent",
    agentFamily: "grok",
    password: "demo",
    isCurrent: false,
    active: true,
    agentEnabled: true,
    agentRoleBrief:
      "你是 Grok 核准 Agent。偏產品敘事與策略清晰度簽核，挑戰模糊假設。",
    agentPrompt:
      "Role: Approver (Grok)\nChallenge weak problem statements and vanity metrics.\nApprove only when why-now and success metrics are crisp.",
  },
  {
    id: "grok-edit",
    name: "Grok",
    title: "Grok · 編輯 Agent",
    avatar: "G",
    email: "grok.edit@agents.local",
    accessRole: "editor",
    kind: "agent",
    agentFamily: "grok",
    password: "demo",
    isCurrent: false,
    active: true,
    agentEnabled: true,
    agentRoleBrief:
      "你是 Grok 編輯 Agent。 sharpen 問題陳述、為何現在、成功指標與敘事張力。",
    agentPrompt:
      "Role: Editor (Grok)\nSharpen narrative: problem, why-now, metrics.\nTone: direct, specific, zh-TW",
  },
  {
    id: "agy-approve",
    name: "Agy",
    title: "Agy · 核准 Agent",
    avatar: "A+",
    email: "agy.approve@agents.local",
    accessRole: "approver",
    kind: "agent",
    agentFamily: "agy",
    password: "demo",
    isCurrent: false,
    active: true,
    agentEnabled: true,
    agentRoleBrief:
      "你是 Agy 核准 Agent。偏流程與角色責任簽核，確保簽核鏈與例外路徑完整。",
    agentPrompt:
      "Role: Approver (Agy)\nCheck RACI, exception paths, and workflow completeness before approval.",
  },
  {
    id: "agy-edit",
    name: "Agy",
    title: "Agy · 編輯 Agent",
    avatar: "A",
    email: "agy.edit@agents.local",
    accessRole: "editor",
    kind: "agent",
    agentFamily: "agy",
    password: "demo",
    isCurrent: false,
    active: true,
    agentEnabled: true,
    agentRoleBrief:
      "你是 Agy 編輯 Agent。補流程步驟、開放問題負責人與決策期限。",
    agentPrompt:
      "Role: Editor (Agy)\nFill process steps, open questions with owners and deadlines.\nLanguage: zh-TW",
  },
];

/** 正式版無示範帳號；測試版載入完整 demo 名單 */
export const SEED_EMPLOYEES: Employee[] =
  APP_VARIANT === "test" ? SEED_EMPLOYEES_DEMO : [];

/**
 * 正式版引導可選「安裝入門 Agent 包」：僅 Agent、不含 Scott。
 * 密碼由使用者管理員另行管理；預設仍可用自訂密碼登入 Agent。
 */
export function buildStarterAgents(adminPassword: string): Employee[] {
  return SEED_EMPLOYEES_DEMO.filter((e) => e.kind === "agent").map((e) => ({
    ...structuredClone(e),
    password: adminPassword || e.password,
    isCurrent: false,
    active: true,
    agentEnabled: true,
  }));
}

export const DEFAULT_SETTINGS: AISettings = {
  model: "gemini-2.5-flash",
  provider: "auto",
  apiKey: "",
  endpoint: "https://generativelanguage.googleapis.com/v1beta",
  localModelName: "llama3.2",
  temperature: 0.7,
  persona: "executive",
  language: "zh-TW",
  aiWriting: {
    // generic（通用）是繼承基底，永遠存在。其餘領域只在使用者真的覆寫時才出現 ——
    // 預先塞五個空領域只會讓「有沒有設定過」變得看不出來。
    byDomain: { generic: { globalInstruction: "", styleSample: "", sectionPrompts: {} } },
    overwriteFilled: false,
  },
  enableLinters: {
    requireNonGoals: true,
    requireMetrics: true,
    requireStoriesAC: true,
    warnVagueTerms: true,
  },
  editor: {
    showLineNumbers: true,
    showToolbar: true,
    defaultMode: "split",
    semanticHighlight: true,
    highlightIntensity: "soft",
    reduceMotion: false,
  },
};


