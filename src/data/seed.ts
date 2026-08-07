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
  { id: "ws-eng", order: 1, name: "工程", defaultAssigneeId: null, required: true },
  { id: "ws-design", order: 2, name: "設計", defaultAssigneeId: null, required: true },
  { id: "ws-sec", order: 3, name: "資安", defaultAssigneeId: null, required: true },
  { id: "ws-legal", order: 4, name: "法務", defaultAssigneeId: null, required: false },
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

export const SEED_SECTIONS: Section[] = [
  {
    id: "summary",
    n: "01",
    title: "三行摘要",
    desc: "做什麼 · 給誰 · 為何現在 · 技術線選型",
    status: "done",
    guide: "先用三句話讓忙碌的審閱者 10 秒內抓住全貌；再補技術線選型，讓工程／架構一眼知道「用什麼做、刻意不選什麼」。避免行話堆疊與無邊界的技術清單。",
    tips: [
      "寫具體對象，不要寫「所有使用者」",
      "「為何現在」要有外部壓力或內部期限",
      "不要在摘要塞成功指標細節",
      "技術線選型：主路徑 2–5 條即可；至少寫一項「刻意不選」與原因",
    ],
    example:
      "為 Northwind 登入流程加入 TOTP 與安全金鑰，讓企業客戶通過資安審核。技術線：TOTP + WebAuthn；不選簡訊 OTP（SIM 交換與成本）。",
    fields: [
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

export const SEED_TEMPLATES: Template[] = [
  { id: "t1", cat: "core", title: "三行摘要", blurb: "做什麼 / 給誰 / 為何現在 — 審閱者 10 秒抓重點。", uses: 128, body: "## 摘要\n- **做什麼：** …\n- **給誰：** …\n- **為何現在：** …" },
  { id: "t2", cat: "core", title: "問題陳述 + 引言", blurb: "痛點段落搭配具名客戶引言，禁止先寫解法。", uses: 96, body: "## 問題\n[現況傷害誰、頻率、代價]\n\n> 「引言」— 姓名 · 職稱，公司" },
  { id: "t3", cat: "core", title: "目標 / 非目標", blurb: "雙欄邊界，非目標寫延後原因。", uses: 140, body: "## 目標\n- [可驗收]\n\n## 非目標\n- [延後原因]" },
  { id: "t4", cat: "core", title: "成功指標表", blurb: "指標 | 目標 | 量測 — 含領先與落後指標。", uses: 88, body: "| 指標 | 目標 | 量測 |\n|---|---|---|\n| … | … | … |" },
  { id: "t5", cat: "core", title: "使用者故事", blurb: "As-a / I-want / So-that，含例外路徑。", uses: 112, body: "作為 [角色]，我想要 [能力]，以便 [價值]。\n驗收：\n- …" },
  { id: "t6", cat: "core", title: "里程碑切片", blurb: "3–4 階段，每段可單獨上線。", uses: 74, body: "### M1 — 名稱（工期）\n- 產出：\n- 依賴：\n- 風險：" },
  { id: "t7", cat: "security", title: "威脅模型摘要", blurb: "資產、攻擊者、緩解 — 資安審閱友善。", uses: 41, body: "## 威脅模型\n- **資產：**\n- **攻擊者：**\n- **緩解控制：**\n- **殘餘風險：**" },
  { id: "t8", cat: "security", title: "合規對照", blurb: "對應 SOC 2 / ISO 控制項與證據。", uses: 36, body: "| 控制 | 需求 | 本功能證據 |\n|---|---|---|\n| CC6.1 | … | … |" },
  { id: "t9", cat: "security", title: "資料分類與滯留", blurb: "PII 欄位、加密、保存期限。", uses: 29, body: "## 資料\n- 欄位：\n- 分類：\n- 加密：靜態 / 傳輸\n- 滯留：" },
  { id: "t10", cat: "growth", title: "實驗設計", blurb: "假設、變體、成功門檻、停止條件。", uses: 52, body: "## 實驗\n- 假設：\n- 變體：\n- 主要指標：\n- 門檻：\n- 停止條件：" },
  { id: "t11", cat: "growth", title: "定價與包裝影響", blurb: "方案可用性、升級路徑、溝通。", uses: 33, body: "## 包裝\n- Free / Pro / Ent：\n- 升級觸發：\n- 對客溝通：" },
  { id: "t12", cat: "platform", title: "API 契約草稿", blurb: "端點、錯誤碼、相容性承諾。", uses: 47, body: "## API\n`POST /v1/…`\n- 請求：\n- 回應：\n- 錯誤：\n- 相容性：" },
];

export const SEED_COMMENTS: Comment[] = [
  {
    id: "c1",
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
  { id: "ws-eng", order: 1, name: "工程", defaultAssigneeId: "codex-approve", required: true },
  { id: "ws-design", order: 2, name: "設計", defaultAssigneeId: "grok-approve", required: true },
  { id: "ws-sec", order: 3, name: "資安", defaultAssigneeId: "claude-approve", required: true },
  { id: "ws-legal", order: 4, name: "法務", defaultAssigneeId: "agy-approve", required: false },
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
    };
  });
  return {
    projectId,
    stages,
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
    email: "scott@specforge.local",
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
  apiKey: "",
  endpoint: "https://generativelanguage.googleapis.com/v1beta",
  localModelName: "llama3.2",
  temperature: 0.7,
  persona: "executive",
  language: "zh-TW",
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


