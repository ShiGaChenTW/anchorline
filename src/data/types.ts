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
  /**
   * 領域包名稱（`src/data/domains/*.md` 的 name）。未設 = `generic`。
   * 可以改：改了之後不屬於新領域的章節內容會變成孤兒，但**不刪**——
   * 「寫到一半發現選錯領域」比「鎖死不給改」常見得多。
   */
  domain?: string;
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
  /**
   * 這次審閱對應的 commit id。
   *
   * 沒有這個欄位時，審閱頁顯示「當下已儲存的內容」、diff 比「最新 commit」、
   * 核准又合併「最新 commit」—— 三者各講各的。送審後再改一次並重新 commit，
   * 審閱者看到的、核准的、被合併的可能是三份不同的東西，而且不會有任何提示。
   *
   * 送審時寫入；核准合併只接受這一份。抽單或重建個案時清空。
   */
  reviewCommitId: string | null;
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

/** 章節上「使用者產生」的那一部分。骨架來自領域包，這裡只留人動過的痕跡。 */
export type SectionMeta = {
  status: Section["status"];
  score: number;
  checks: CheckDef[];
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
  /**
   * 這則留言屬於哪一個專案。
   *
   * 原本沒有這個欄位 —— 留言是全域的，每個專案的審閱頁都看得到別人的留言，
   * hub 的未解決計數與匯出也一併混在一起。`resolveComment` 因此無從判斷
   * 「這則留言的文件作者是誰」，只好用 `p1` 硬編當代打。
   *
   * 舊資料沒有這個欄位，載入時會補上（見 store 的 migration）。
   */
  projectId: string;
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

/**
 * 某個領域包的 AI 撰寫設定。
 *
 * **預設是自訂且空白**，沿用通用必須明示 —— 所以沿用狀態用 `inherit` 清單記，
 * 不能用「欄位是不是 undefined」來推斷（那樣沒設定過的領域會自動繼承）。
 *
 * 分開存還有一個好處：切成沿用時不必刪掉自訂內容，切回來原本寫的東西還在。
 */
export type DomainWriteConfig = {
  globalInstruction?: string;
  styleSample?: string;
  /** key = sectionId */
  sectionPrompts?: Record<string, string | undefined>;
  /**
   * 明確標記為「沿用通用」的欄位。
   * 值為 `globalInstruction` / `styleSample` / `sec:{sectionId}`。
   */
  inherit?: string[];
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
  /**
   * AI 撰寫設定。
   *
   * 參考 ChatPRD 的做法：內建 prompt 藏在後面（使用者不必自己工程化），
   * 但留出三個可調的旋鈕 —— 全域補充指令、每節覆寫、風格範本。
   * 三者都留空時行為與內建完全相同。
   */
  aiWriting: {
    /**
     * 依**領域包**分類的撰寫設定。key = 領域 id（generic / payment / lending …）。
     *
     * 分類軸選領域而不是自訂角色：領域包本來就存在，且它已經決定了這份 PRD
     * 有哪些章節。再開一套「角色」等於要使用者每次都想「這份該用哪個角色」，
     * 而答案幾乎總是跟領域一樣。
     *
     * `generic`（通用）是基底，其餘領域逐欄位沿用或覆寫。
     */
    byDomain: Record<string, DomainWriteConfig>;
    /** 已經有內容的章節要不要重寫。預設 false —— 覆蓋使用者寫好的東西是最不該預設發生的事 */
    overwriteFilled: boolean;
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

/**
 * PRD 的一個版本。
 *
 * 兩種：
 * - `commit` —— 送審時對**整份 PRD** 拍的快照。審閱者看到的是這一份，
 *   不是「送審之後又被改過的當下內容」。
 * - `merge` —— 核准時把該 commit 併進主線；它成為下一次比較的基準。
 *
 * 為什麼存整份而不是只存有改動的章節：審閱要能重建「當時送出去的完整版本」，
 * diff 由系統從兩個快照算出來就好。只存差異的話，任何一次資料結構調整都會讓
 * 舊版本無法重建。
 */
export type PrdVersion = {
  id: string;
  kind: "commit" | "merge";
  /** ISO 8601 */
  at: string;
  byId: string;
  byName: string;
  /** 送審說明／核准註記 */
  message: string;
  /** 整份 PRD：sectionId → fieldKey → 內容 */
  docs: Record<string, Record<string, string>>;
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
  /**
   * 每專案的章節狀態（status / score / checks 勾選）。
   *
   * 章節「骨架」由專案的領域包決定、每次載入重新解析；**只有這些使用者手動
   * 產生的標記需要留著**。分開存的另一個作用是修掉一個舊漏洞：以前 sections
   * 是全域單例，A 專案的「已完成」標記會出現在 B 專案上。
   * key = projectId → sectionId
   */
  projectSectionMeta: Record<string, Record<string, SectionMeta>>;
  /**
   * 未儲存的編輯 —— **不是**事實，只是還沒決定要不要留下的東西。
   *
   * 取消自動存檔之後，每個按鍵仍然寫進這裡並持久化，所以當機／關視窗
   * 不會掉字；但它跟 `projectSectionValues`（已儲存的正文）是分開的兩份，
   * 「改過但還沒存」才有明確定義，異動高亮才有基準可比。
   *
   * key = projectId → sectionId → fieldKey
   */
  prdDrafts: Record<string, Record<string, Record<string, string>>>;
  /**
   * 版本線。git 心智模型：working copy →（送審）commit →（核准）merge。
   * 最新的排在最前面。key = projectId
   */
  prdVersions: Record<string, PrdVersion[]>;
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
