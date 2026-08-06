/**
 * PRD 新手撰寫流程 — 步驟定義與範例句
 * 對應：projects 精靈 → editor 教練列
 */

export type BeginnerStepId =
  | "intro"
  | "one_liner"
  | "who_why"
  | "problem"
  | "goals_nongoals"
  | "metrics"
  | "confirm";

export type BeginnerStep = {
  id: BeginnerStepId;
  n: number;
  label: string;
  title: string;
  coach: string;
  tips: string[];
  /** 精靈填完後對應的編輯章節 id */
  editorSectionId?: string;
};

export const BEGINNER_STEPS: BeginnerStep[] = [
  {
    id: "intro",
    n: 0,
    label: "認識",
    title: "PRD 是什麼？",
    coach:
      "PRD（產品需求文件）讓工程、設計、資安在開工前對齊：做什麼、給誰、為何現在、刻意不做什麼、如何算成功。新手不必一次寫完整本——先完成摘要與邊界，再補細節。",
    tips: [
      "先寫問題與邊界，再寫解法細節",
      "Non-Goals ≥ 3 是送審硬門檻",
      "可隨時參考唯一範例「SaaS 雙重驗證（2FA）」",
    ],
  },
  {
    id: "one_liner",
    n: 1,
    label: "一句話",
    title: "標題與交付物",
    coach: "用一句話講清「這次要交付什麼」。標題要能獨立被搜尋；「做什麼」避免口號，寫成可交付物。",
    tips: ["壞例子：提升用戶體驗", "好例子：在登入流程加入 TOTP 與 WebAuthn"],
    editorSectionId: "summary",
  },
  {
    id: "who_why",
    n: 2,
    label: "對象",
    title: "給誰 · 為何現在",
    coach: "受益者要寫成角色（管理員、成員、資安），不要寫「所有人」。為何現在需要可驗證的壓力：合約、法規、事件、期限。",
    tips: ["角色可指認到工作職責", "時機最好有數字或外部期限"],
    editorSectionId: "summary",
  },
  {
    id: "problem",
    n: 3,
    label: "問題",
    title: "問題陳述",
    coach: "只寫痛點與佐證，不要先寫解法。一段話說明誰受傷、多常發生、代價是什麼。",
    tips: ["先失敗模式，再頻率／代價", "可附一句真實引言"],
    editorSectionId: "problem",
  },
  {
    id: "goals_nongoals",
    n: 4,
    label: "邊界",
    title: "目標與非目標",
    coach: "目標是可驗收結果；非目標是這次刻意不做的範圍。至少 3 條 Non-Goals，否則結構 gate 會擋送審。",
    tips: ["Non-Goals 不是藉口，是保護範圍", "目標用「可檢查」的句子"],
    editorSectionId: "goals",
  },
  {
    id: "metrics",
    n: 5,
    label: "指標",
    title: "成功指標",
    coach: "至少一個能量測的數字：覆蓋率、時間、錯誤率、簽約解鎖數。寫「指標 | 目標 | 量測方式」。",
    tips: ["寧可一個清楚數字，勝過五個模糊形容"],
    editorSectionId: "metrics",
  },
  {
    id: "confirm",
    n: 6,
    label: "建立",
    title: "確認並建立",
    coach: "建立後會開啟編輯工作台，並顯示新手教練列。依章節繼續補使用者故事、開放問題，再送審。",
    tips: ["建立後可隨時改", "按 ? 查看快捷鍵"],
  },
];

/** 編輯器教練：建議完成順序 */
export const EDITOR_BEGINNER_TRACK: {
  sectionId: string;
  label: string;
  hint: string;
}[] = [
  { sectionId: "summary", label: "三行摘要", hint: "做什麼 · 給誰 · 為何現在 · 技術線選型" },
  { sectionId: "problem", label: "問題陳述", hint: "痛點與佐證，勿先寫解法" },
  { sectionId: "goals", label: "目標／非目標", hint: "Non-Goals ≥ 3" },
  { sectionId: "metrics", label: "成功指標", hint: "至少一個可量測數字" },
  { sectionId: "stories", label: "使用者故事", hint: "角色 · 行為 · 價值 + AC" },
  { sectionId: "open", label: "開放問題", hint: "問題 · 負責人 · 期限" },
];

export const BEGINNER_EXAMPLES = {
  title: "SaaS 雙重驗證（2FA）",
  what: "在登入流程加入 TOTP 與 WebAuthn 第二因素，並支援工作區強制政策與復原碼。",
  who: "企業租戶管理員、一般成員、需通過 SOC 2 審核的資安團隊",
  why: "近六次企業資安審查中有三次將缺少第二因素列為阻擋項；三筆待簽合約將 2FA 列為簽約前提。",
  tech: "• TOTP + WebAuthn\n• 工作區強制政策與復原碼\n• 刻意不選：簡訊 OTP",
  problem:
    "目前僅密碼守護工作區。對需符合 SOC 2 Type II 的企業租戶，這是控制面缺口。近六次企業資安審查有三次將缺少第二因素列為阻擋。",
  ng1: "不重做整個帳號系統或改密碼規則",
  ng2: "不支援簡訊 OTP 作為預設第二因素（僅 TOTP / WebAuthn）",
  ng3: "本版不做行動 App 內嵌驗證器 SDK",
  goals: "• 工作區可強制 2FA\n• 成員可綁定 TOTP 或安全金鑰\n• 提供復原碼並可輪替",
  metrics: "強制 2FA 覆蓋率 | ≥ 80% 企業租戶 | 90 天內\n復原流程成功率 | ≥ 95% | 支援工單抽樣",
};

const BEGINNER_KEY = "specforge:beginner-mode";

export function setBeginnerMode(on: boolean) {
  try {
    if (on) sessionStorage.setItem(BEGINNER_KEY, "1");
    else sessionStorage.removeItem(BEGINNER_KEY);
  } catch {
    /* ignore */
  }
}

export function isBeginnerMode(): boolean {
  try {
    return sessionStorage.getItem(BEGINNER_KEY) === "1";
  } catch {
    return false;
  }
}
