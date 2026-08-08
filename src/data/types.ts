import type { Release } from "../lib/release";

/** 僅保留 kami（紙）與 github（暗） */
export type ThemeId = "kami" | "github";

export type ProjectStatus = "draft" | "review" | "approved" | "withdrawn";

/** 系統存取角色（人員可任一種；Agent 僅 editor / approver） */
export type AccessRole = "admin" | "approver" | "editor";

export type ActorKind = "human" | "agent";

/** Agent 族系 — 同一 family 撰寫的文件不可再由同 family 核准 */
export type AgentFamily = "claude" | "codex" | "grok" | "agy" | "gpt" | "gemini" | "local" | "other";

export type AgentTaskType = "edit" | "approve" | "review" | "coach";

export type AgentJobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

/** 呼叫 Agent 進場作業的工作單 */
export type AgentJob = {
  id: string;
  agentId: string;
  agentName: string;
  projectId: string;
  projectTitle: string;
  task: AgentTaskType;
  status: AgentJobStatus;
  note: string;
  result: string;
  createdAt: string;
  finishedAt: string | null;
};

/** 匯入掃描摘要（存於專案，供側欄／列表顯示） */
export type ProjectImportSummary = {
  folderName: string;
  rootPath: string;
  scannedAt: string;
  overallScore: number;
  coveragePct: number;
  progressPct: number;
  matchedFiles: { slot: string; path: string; contentScore: number }[];
  missingRequired: string[];
  /**
   * 掃到的所有相對路徑（不含內文）。用來畫檔案樹。
   * 只存路徑不存內容：localStorage 有容量上限，內文是最大宗。
   */
  allPaths?: string[];
};

export type Project = {
  id: string;
  title: string;
  /**
   * 使用者自訂顯示名稱。有值時側欄／列表優先顯示；
   * 未自訂則顯示 title（匯入時通常為資料夾名）。
   */
  customName?: string;
  status: ProjectStatus;
  pct: number;
  owner: string;
  ownerId: string;
  authorId: string;
  /** 若作者為 agent，記錄族系以供簽核隔離 */
  authorAgentFamily?: AgentFamily | null;
  mine: boolean;
  /** 相對時間字串（列表用，如「剛剛」） */
  updated: string;
  /** ISO 時間：最後一次內容／檔案更新（側欄卡片第二行） */
  lastFileAt?: string;
  tag: string;
  /** 種子／示範專案，可一鍵隱藏 */
  isSample?: boolean;
  /** 資料夾匯入產生 */
  isImported?: boolean;
  /** 來源資料夾名稱（顯示用） */
  sourceFolder?: string;
  /** 專案介紹，使用者手寫。與 PRD 章節無關，是給人看的一句話。 */
  description?: string;
  /**
   * 使用者自訂標籤。用來搜尋與分群。
   * 與上面的 `tag`（單一、系統給的分類）不同：這個是完全自由的多值欄位。
   */
  tags?: string[];
  /** 匯入評分與對應摘要 */
  importSummary?: ProjectImportSummary;
};

/** 側欄／列表顯示名稱：自訂名 → 標題 → 資料夾名 */
export function projectDisplayName(p: Project): string {
  const custom = (p.customName ?? "").trim();
  if (custom) return custom;
  const title = (p.title ?? "").trim();
  if (title) return title;
  const folder = (p.sourceFolder ?? "").trim();
  if (folder) return folder;
  return "未命名專案";
}

/** 簽核流程關卡定義（流程設計） */
export type WorkflowStageDef = {
  id: string;
  order: number;
  name: string;
  defaultAssigneeId: string | null;
  required: boolean;
};

export type CaseStageState = "approved" | "pending" | "empty" | "skipped";

/** 個案上的關卡實例（可異動關卡人員） */
export type CaseStage = {
  id: string;
  stageDefId: string;
  order: number;
  name: string;
  assigneeId: string | null;
  assigneeName: string;
  state: CaseStageState;
};

/** 個案簽核狀態（含抽單） */
export type CaseRecord = {
  projectId: string;
  stages: CaseStage[];
  withdrawn: boolean;
  withdrawnAt: string | null;
  withdrawnBy: string | null;
  withdrawReason: string | null;
  locked: boolean;
};

export type FieldDef = {
  key: string;
  label: string;
  hint?: string;
  type: "text" | "textarea";
  rows?: number;
  value: string;
};

export type CheckDef = {
  id: string;
  label: string;
  pass: boolean;
};

export type Section = {
  id: string;
  n: string;
  title: string;
  desc: string;
  status: "done" | "warn" | "empty";
  guide: string;
  tips: string[];
  example: string;
  fields: FieldDef[];
  checks: CheckDef[];
  score: number;
};

export type TemplateCat =
  | "core"
  | "security"
  | "growth"
  | "platform"
  | "openspec"
  | "delivery"
  | "research";

export type Template = {
  id: string;
  cat: TemplateCat;
  title: string;
  blurb: string;
  uses: number;
  body: string;
};

export type Comment = {
  id: string;
  author: string;
  authorId?: string;
  avatar: string;
  time: string;
  anchor: string;
  body: string;
  resolved: boolean;
};

export type Approval = {
  id: string;
  role: string;
  name: string;
  assigneeId?: string;
  state: "approved" | "pending" | "empty";
};

export type AISettings = {
  /**
   * 模型名稱自由填。寫死聯集只會在下一次模型改版時過期，
   * 而使用者永遠比這份型別新。供應商靠前綴判斷（gemini/claude/gpt/local-smart）。
   */
  model: string;
  apiKey: string;
  endpoint: string;
  /**
   * OpenAI 相容／Ollama 實際模型名（如 llama3.2、qwen2.5、mistral）。
   * 僅在 model === local-smart 或自訂端點時使用。
   */
  localModelName: string;
  temperature: number;
  persona: "concise" | "detailed" | "technical" | "executive";
  language: "zh-TW" | "en-US";
  enableLinters: {
    requireNonGoals: boolean;
    requireMetrics: boolean;
    requireStoriesAC: boolean;
    warnVagueTerms: boolean;
  };
  /** 編輯台偏好 */
  editor: {
    /** 顯示行號（左側 gutter，與文字間距 5px） */
    showLineNumbers: boolean;
    /** 顯示 Markdown 工具列 */
    showToolbar: boolean;
    /** 預設雙欄 / 寫作 / 預覽 */
    defaultMode: "split" | "write" | "preview";
    /** 預覽欄語意高亮（待決／風險等） */
    semanticHighlight: boolean;
    /** 高亮強度：soft 僅待決+風險；medium 含指標／完成／引用 */
    highlightIntensity: "soft" | "medium";
    /** 減少注意力導引動畫（亦尊重系統 prefers-reduced-motion） */
    reduceMotion: boolean;
  };
};

export type Employee = {
  id: string;
  name: string;
  /** 職稱顯示（非系統權限） */
  title: string;
  avatar: string;
  email: string;
  /** 系統角色 */
  accessRole: AccessRole;
  kind: ActorKind;
  /** Agent 族系；human 為 null */
  agentFamily: AgentFamily | null;
  /** 示範登入密碼（本地原型） */
  password: string;
  isCurrent?: boolean;
  /** 帳號是否啟用（可登入） */
  active?: boolean;
  /** Agent：系統 prompt */
  agentPrompt?: string;
  /** Agent：角色說明 / role 內容 */
  agentRoleBrief?: string;
  /** Agent：執行中開關（可被呼叫進場） */
  agentEnabled?: boolean;
};

export type Session = {
  userId: string;
  loggedInAt: string;
};

export type AppState = {
  projects: Project[];
  sections: Section[];
  /** 目前 active 專案的章節正文（編輯／審閱讀此） */
  sectionValues: Record<string, Record<string, string>>;
  /**
   * 每專案獨立正文袋。切換 activeProjectId 時與 sectionValues 對調。
   * key = projectId
   */
  projectSectionValues: Record<string, Record<string, Record<string, string>>>;
  /** 隱藏範例時暫存的正文，以便一鍵還原 */
  sampleSectionValues: Record<string, Record<string, string>> | null;
  comments: Comment[];
  /** @deprecated 相容審閱頁；以 cases[active].stages 為準並同步 */
  approvals: Approval[];
  /** 簽核流程設計（有序關卡） */
  workflowStages: WorkflowStageDef[];
  /** 各專案個案簽核狀態 */
  cases: Record<string, CaseRecord>;
  /** 審閱頁目前關注的專案 id */
  activeProjectId: string;
  templates: Template[];
  employees: Employee[];
  currentUser: Employee;
  session: Session | null;
  locked: boolean;
  pendingInsert: string | null;
  activeSectionId: string;
  settings: AISettings;
  /** 是否展示種子範例專案與範例內文 */
  showSamples: boolean;
  /** Agent 進場作業佇列 */
  agentJobs: AgentJob[];
  /** 使用者自行取號的版本（含內容編列）。型別在 lib/release.ts */
  releases: Release[];
  /**
   * 首次使用引導是否完成（正式版）。
   * 測試版預設 true（略過引導、保留示範資料）。
   */
  onboardingComplete: boolean;
};

export const ACCESS_ROLE_LABEL: Record<AccessRole, string> = {
  admin: "管理員",
  approver: "核准人員",
  editor: "編輯人員",
};

export const AGENT_FAMILY_LABEL: Record<AgentFamily, string> = {
  claude: "Claude Code",
  codex: "Codex",
  grok: "Grok",
  agy: "Agy",
  gpt: "GPT 系",
  gemini: "Gemini 系",
  local: "本地 Agent",
  other: "其他 Agent",
};

export const AGENT_TASK_LABEL: Record<AgentTaskType, string> = {
  edit: "撰寫／編輯",
  approve: "簽核",
  review: "覆核留言",
  coach: "品質教練",
};
