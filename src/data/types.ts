export type ThemeId = "warp" | "kami" | "github" | "claude";

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

export type Project = {
  id: string;
  title: string;
  status: ProjectStatus;
  pct: number;
  owner: string;
  ownerId: string;
  authorId: string;
  /** 若作者為 agent，記錄族系以供簽核隔離 */
  authorAgentFamily?: AgentFamily | null;
  mine: boolean;
  updated: string;
  tag: string;
  /** 種子／示範專案，可一鍵隱藏 */
  isSample?: boolean;
};

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

export type TemplateCat = "core" | "security" | "growth" | "platform";

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
  model: "gemini-1.5-pro" | "gemini-1.5-flash" | "claude-3-5-sonnet" | "gpt-4o" | "local-smart";
  apiKey: string;
  endpoint: string;
  temperature: number;
  persona: "concise" | "detailed" | "technical" | "executive";
  language: "zh-TW" | "en-US";
  enableLinters: {
    requireNonGoals: boolean;
    requireMetrics: boolean;
    requireStoriesAC: boolean;
    warnVagueTerms: boolean;
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
  sectionValues: Record<string, Record<string, string>>;
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
