import {
  APP_VARIANT,
  blankSections,
  buildSeedCase,
  buildStarterAgents,
  DEFAULT_SETTINGS,
  GHOST_USER,
  SEED_APPROVALS,
  SEED_COMMENTS,
  SEED_EMPLOYEES,
  SEED_PROJECTS,
  SEED_SECTIONS,
  SEED_TEMPLATES,
  SEED_WORKFLOW,
  SEED_WORKFLOW_PROD,
  TEST_CASE_DOCS,
} from "./seed";
import { draftRelease, validateVersion, type Release, type ReleaseItem } from "../lib/release";
import { logEvent } from "../lib/event-writer";
import type {
  AgentFamily,
  AgentJob,
  AgentTaskType,
  AISettings,
  AppState,
  Approval,
  CaseRecord,
  CaseStage,
  Comment,
  Employee,
  Project,
  ProjectImportSummary,
  Section,
  Session,
  Template,
  WorkflowStageDef,
} from "./types";
import { emptySectionValues } from "../lib/export";
import type { ProjectCandidate } from "../lib/folder-import";
import { mapCandidateToSectionValues } from "../lib/folder-import";
import {
  canApproveProject,
  canPeerReview,
  normalizeAgentFamily,
  validateEmployeeRole,
} from "../lib/permissions";
import { nowIso } from "../lib/time-format";

/** v6：正式版無示範內容 + 首次引導；依變體分 key 避免互污染 */
const KEY = `anchorline:state:v6:${APP_VARIANT}`;
const LEGACY_KEY = `anchorline:state:v5:${APP_VARIANT}`;
const SESSION_KEY = "anchorline:session:v1";

/**
 * 將 SEED 章節結構合併進已存 sections（補新欄位／檢查項，不覆蓋使用者 status/score）
 * 例如「三行摘要」新增「技術線選型」後，舊 localStorage 也能看到該欄。
 */
function mergeSectionsWithSeed(existing: Section[]): Section[] {
  const seedById = new Map(SEED_SECTIONS.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const merged = existing.map((sec) => {
    seen.add(sec.id);
    const seed = seedById.get(sec.id);
    if (!seed) return sec;
    const fieldKeys = new Set(sec.fields.map((f) => f.key));
    const fields = [...sec.fields];
    for (const f of seed.fields) {
      if (!fieldKeys.has(f.key)) {
        fields.push({ ...f, value: "" });
      } else {
        // 同步 label/hint/rows（不改 value 定義在 section 的預設）
        const i = fields.findIndex((x) => x.key === f.key);
        if (i >= 0) {
          fields[i] = {
            ...fields[i]!,
            label: f.label,
            hint: f.hint,
            type: f.type,
            rows: f.rows,
          };
        }
      }
    }
    const checkIds = new Set(sec.checks.map((c) => c.id));
    const checks = [...sec.checks];
    for (const c of seed.checks) {
      if (!checkIds.has(c.id)) checks.push({ ...c, pass: false });
    }
    return {
      ...sec,
      title: seed.title || sec.title,
      desc: seed.desc || sec.desc,
      guide: seed.guide || sec.guide,
      tips: seed.tips?.length ? seed.tips : sec.tips,
      example: seed.example || sec.example,
      fields,
      checks,
    };
  });
  // 種子有、舊狀態沒有的章節（極少見）— 附加空白
  for (const seed of SEED_SECTIONS) {
    if (!seen.has(seed.id)) {
      merged.push({
        ...structuredClone(seed),
        fields: seed.fields.map((f) => ({ ...f, value: "" })),
        checks: seed.checks.map((c) => ({ ...c, pass: false })),
        status: "empty",
        score: 0,
      });
    }
  }
  return merged;
}

/** 從 section.fields.value 帶入種子正文 */
function valuesFromSections(sections: Section[]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const s of sections) {
    out[s.id] = {};
    for (const f of s.fields) out[s.id][f.key] = f.value;
  }
  return out;
}

function approvalsFromCase(c: CaseRecord | undefined): Approval[] {
  if (!c) return structuredClone(SEED_APPROVALS);
  return c.stages.map((s) => ({
    id: s.id,
    role: s.name,
    name: s.assigneeName,
    assigneeId: s.assigneeId ?? undefined,
    state: s.state === "skipped" ? "empty" : s.state,
  }));
}

function caseFromWorkflow(
  projectId: string,
  workflow: WorkflowStageDef[],
  employees: Employee[],
): CaseRecord {
  const byId = Object.fromEntries(employees.map((e) => [e.id, e]));
  const stages: CaseStage[] = [...workflow]
    .sort((a, b) => a.order - b.order)
    .map((w) => {
      const emp = w.defaultAssigneeId ? byId[w.defaultAssigneeId] : null;
      return {
        id: `cs-${w.id}-${projectId}`,
        stageDefId: w.id,
        order: w.order,
        name: w.name,
        assigneeId: emp?.id ?? null,
        assigneeName: emp ? emp.name : "待指派",
        state: emp ? ("pending" as const) : ("empty" as const),
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

function seedState(): AppState {
  const isTest = APP_VARIANT === "test";
  const sections = isTest
    ? structuredClone(SEED_SECTIONS)
    : blankSections(structuredClone(SEED_SECTIONS));
  const employees = structuredClone(SEED_EMPLOYEES);
  const current =
    employees.find((e) => e.isCurrent) ?? employees[0] ?? structuredClone(GHOST_USER);
  const projects = structuredClone(SEED_PROJECTS);
  const cases: Record<string, CaseRecord> = {};
  for (const p of projects) {
    if (p.status === "review" || p.status === "approved") {
      cases[p.id] = buildSeedCase(p.id, employees);
    }
  }
  if (isTest && !cases.p1) cases.p1 = buildSeedCase("p1", employees);

  const workflowStages = structuredClone(isTest ? SEED_WORKFLOW : SEED_WORKFLOW_PROD);
  const sectionValues = isTest
    ? valuesFromSections(structuredClone(SEED_SECTIONS))
    : emptySectionValues(sections);

  const activeId = projects[0]?.id ?? "";
  const projectSectionValues: AppState["projectSectionValues"] = {};
  if (activeId) projectSectionValues[activeId] = structuredClone(sectionValues);

  // 三個驗收測試案例各有自己的正文；沒有這步切過去會全部是空白，
  // A/B/C 的差異就不見了
  if (isTest) {
    const blank = emptySectionValues(sections);
    for (const [id, docs] of Object.entries(TEST_CASE_DOCS)) {
      projectSectionValues[id] = { ...structuredClone(blank), ...structuredClone(docs) };
    }
  }

  return {
    projects,
    sections,
    sectionValues,
    projectSectionValues,
    sampleSectionValues: null,
    comments: isTest ? structuredClone(SEED_COMMENTS) : [],
    approvals: isTest ? approvalsFromCase(cases.p1) : structuredClone(SEED_APPROVALS).map((a) => ({
      ...a,
      name: "待指派",
      state: "empty" as const,
      assigneeId: undefined,
    })),
    workflowStages,
    cases,
    activeProjectId: activeId,
    templates: structuredClone(SEED_TEMPLATES),
    employees,
    currentUser: current,
    session: null,
    locked: false,
    pendingInsert: null,
    activeSectionId: "summary",
    settings: structuredClone(DEFAULT_SETTINGS),
    showSamples: isTest,
    agentJobs: [],
    releases: [],
    onboardingComplete: isTest,
  };
}

/**
 * 範本合併：內建的以程式碼為準，使用者自訂的保留。
 *
 * 直接 `parsed.templates ?? base.templates` 會讓**已經用過這個 App 的人
 * 永遠看不到新增的內建範本** —— 他們的 localStorage 裡存著舊的那一份。
 * 同一個坑 `migrateProject` 漏掉 tags 時已經踩過一次。
 *
 * 內建範本的 uses 一律從 0 起算：舊的種子數字（128 / 96 / 140…）是編出來的，
 * 拿它當統計顯示等於騙人，與其想辦法保留不如丟掉重數。
 */
function mergeTemplates(stored: Template[] | undefined, seed: Template[]): Template[] {
  if (!Array.isArray(stored) || !stored.length) return seed;
  const seedIds = new Set(seed.map((t) => t.id));
  const custom = stored.filter((t) => !seedIds.has(t.id));
  const usesById = new Map(stored.map((t) => [t.id, t.uses] as const));
  const builtin = seed.map((t) => {
    const prev = usesById.get(t.id);
    // 舊資料裡的內建範本次數是假的；只有這一版之後累加出來的才留
    return prev !== undefined && t.uses > 0 ? { ...t, uses: prev } : t;
  });
  return [...builtin, ...custom];
}

function migrateProject(raw: Record<string, unknown>, employees: Employee[]): Project {
  const owner = String(raw.owner ?? "未知");
  const match = employees.find((e) => e.name === owner);
  return {
    id: String(raw.id ?? `p_${Date.now()}`),
    title: String(raw.title ?? "未命名"),
    customName: raw.customName ? String(raw.customName) : undefined,
    description: raw.description ? String(raw.description) : undefined,
    status: (raw.status as Project["status"]) || "draft",
    pct: Number(raw.pct ?? 0),
    owner,
    ownerId: String(raw.ownerId ?? match?.id ?? ""),
    authorId: String(raw.authorId ?? raw.ownerId ?? match?.id ?? ""),
    authorAgentFamily: (raw.authorAgentFamily as AgentFamily | null) ?? match?.agentFamily ?? null,
    mine: Boolean(raw.mine),
    updated: String(raw.updated ?? ""),
    lastFileAt: raw.lastFileAt
      ? String(raw.lastFileAt)
      : raw.importSummary && typeof (raw.importSummary as ProjectImportSummary).scannedAt === "string"
        ? (raw.importSummary as ProjectImportSummary).scannedAt
        : undefined,
    tag: String(raw.tag ?? "product"),
    // migrateProject 是逐欄位重建，忘了列的欄位會在重新載入時無聲消失
    tags: Array.isArray(raw.tags)
      ? (raw.tags as unknown[]).map((t) => String(t)).filter(Boolean)
      : undefined,
    isSample: raw.isSample === false ? false : Boolean(raw.isSample ?? true),
    isImported: Boolean(raw.isImported),
    sourceFolder: raw.sourceFolder ? String(raw.sourceFolder) : undefined,
    importSummary: raw.importSummary as ProjectImportSummary | undefined,
  };
}

function touchProjectMeta(projectId: string | undefined) {
  if (!projectId) return;
  const iso = nowIso();
  state = {
    ...state,
    projects: state.projects.map((p) =>
      p.id === projectId
        ? { ...p, updated: "剛剛", lastFileAt: iso }
        : p,
    ),
  };
}

/** 寫回目前 active 的 sectionValues 到 bag */
function snapshotActiveDocs(s: AppState): AppState["projectSectionValues"] {
  const bag = { ...s.projectSectionValues };
  if (s.activeProjectId) {
    bag[s.activeProjectId] = structuredClone(s.sectionValues);
  }
  return bag;
}

function blankDocsForSections(sections: Section[]): Record<string, Record<string, string>> {
  return emptySectionValues(sections);
}

function load(): AppState {
  try {
    let raw = localStorage.getItem(KEY);
    if (!raw) raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw) as Partial<AppState> & { employees?: unknown[] };
    const base = seedState();

    // 正式版：沿用使用者已建立的人員；測試版可回落示範名單
    const employees: Employee[] =
      Array.isArray(parsed.employees) && parsed.employees.length
        ? (parsed.employees as Employee[])
        : structuredClone(SEED_EMPLOYEES);

    const projects = Array.isArray(parsed.projects)
      ? parsed.projects.map((p) =>
          migrateProject(p as unknown as Record<string, unknown>, employees),
        )
      : base.projects;

    let session: Session | null = parsed.session ?? null;
    try {
      const sraw = localStorage.getItem(SESSION_KEY);
      if (sraw) {
        const s = JSON.parse(sraw) as { userId: string };
        if (s.userId) session = { userId: s.userId, loggedInAt: new Date().toISOString() };
      }
    } catch {
      /* ignore */
    }

    const sessionUser = session
      ? employees.find((e) => e.id === session!.userId && e.active !== false)
      : null;
    const currentUser =
      sessionUser ??
      employees.find((e) => e.isCurrent) ??
      employees[0] ??
      structuredClone(GHOST_USER);
    if (!sessionUser) session = null;

    const workflowStages =
      Array.isArray(parsed.workflowStages) && parsed.workflowStages.length
        ? (parsed.workflowStages as WorkflowStageDef[])
        : base.workflowStages;
    const cases: Record<string, CaseRecord> = {
      ...(parsed.cases ?? {}),
    };
    const activeProjectId =
      parsed.activeProjectId && projects.some((p) => p.id === parsed.activeProjectId)
        ? parsed.activeProjectId
        : (projects[0]?.id ?? "");
    const activeCase = activeProjectId ? cases[activeProjectId] : undefined;

    const onboardingComplete =
      typeof parsed.onboardingComplete === "boolean"
        ? parsed.onboardingComplete
        : APP_VARIANT === "test"
          ? true
          : employees.some((e) => e.kind === "human" && e.accessRole === "admin" && e.active !== false);

    const sectionValues = parsed.sectionValues ?? base.sectionValues;
    let projectSectionValues =
      (parsed.projectSectionValues as AppState["projectSectionValues"] | undefined) ?? {};
    // 遷移：舊狀態無 bag → 把目前正文掛到 active
    if (!Object.keys(projectSectionValues).length && activeProjectId) {
      projectSectionValues = { [activeProjectId]: structuredClone(sectionValues) };
    }
    // 確保 active 與 bag 同步（優先用 bag 內已存正文）
    const activeDocs =
      projectSectionValues[activeProjectId] ?? structuredClone(sectionValues);
    projectSectionValues = {
      ...projectSectionValues,
      [activeProjectId]: activeDocs,
    };

    const sections = mergeSectionsWithSeed(
      (parsed.sections as Section[] | undefined) ?? base.sections,
    );

    return {
      ...base,
      ...parsed,
      projects: APP_VARIANT === "prod" ? projects.filter((p) => !p.isSample) : projects,
      sections,
      sectionValues: activeDocs,
      projectSectionValues,
      sampleSectionValues: parsed.sampleSectionValues ?? null,
      comments: parsed.comments ?? base.comments,
      approvals: activeCase
        ? approvalsFromCase(activeCase)
        : (parsed.approvals ?? base.approvals),
      workflowStages,
      cases,
      activeProjectId,
      templates: mergeTemplates(parsed.templates, base.templates),
      employees,
      currentUser,
      session,
      locked: activeCase?.locked ?? parsed.locked ?? false,
      settings: {
        ...base.settings,
        ...(parsed.settings ?? {}),
        enableLinters: {
          ...base.settings.enableLinters,
          ...((parsed.settings as AISettings | undefined)?.enableLinters ?? {}),
        },
        editor: {
          ...base.settings.editor,
          ...((parsed.settings as AISettings | undefined)?.editor ?? {}),
        },
      },
      showSamples: APP_VARIANT === "prod" ? false : parsed.showSamples !== false,
      agentJobs: Array.isArray(parsed.agentJobs) ? (parsed.agentJobs as AgentJob[]) : [],
      releases: Array.isArray(parsed.releases) ? (parsed.releases as Release[]) : [],
      onboardingComplete,
    };
  } catch {
    return seedState();
  }
}

function syncApprovalsFromActiveCase() {
  const c = state.cases[state.activeProjectId];
  state = {
    ...state,
    approvals: approvalsFromCase(c),
    locked: c?.locked ?? state.locked,
  };
}

let state = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    if (state.session?.userId) {
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ userId: state.session.userId, at: Date.now() }),
      );
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  } catch {
    /* ignore quota */
  }
}

function emit() {
  persist();
  listeners.forEach((fn) => fn());
}


/**
 * Writer A —— App 內動作寫進稽核軌跡。
 *
 * **絕不擋業務動作。** 核准就是核准；log 寫不進去是 log 的問題。讓稽核軌跡
 * 去否決簽核，使用者第一次遇到就會把整個功能關掉。所以這裡吞掉所有錯誤，
 * 回傳值也不看。
 *
 * 專案沒綁資料夾（沒有 rootPath）就靜靜跳過 —— 事件沒有地方可以落地。
 */
function audit(
  state: AppState,
  projectId: string,
  kind: Parameters<typeof logEvent>[1]["kind"],
  subject: string,
  payload?: Record<string, unknown>,
): void {
  try {
    const p = state.projects.find((x) => x.id === projectId);
    const root = p?.importSummary?.rootPath;
    if (!root) return;
    const u = state.currentUser;
    logEvent(root, {
      project: p!.id,
      actor: {
        kind: u.kind === "agent" ? "agent" : "human",
        family: u.agentFamily ?? null,
        name: u.name,
      },
      kind,
      subject,
      ...(payload ? { payload } : {}),
    });
  } catch {
    /* 稽核失敗不影響業務動作 */
  }
}

export const store = {
  get(): AppState {
    return state;
  },

  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  reset() {
    const keepSession = state.session;
    state = seedState();
    state.session = keepSession;
    if (keepSession) {
      const u = state.employees.find((e) => e.id === keepSession.userId);
      if (u) state.currentUser = u;
    }
    emit();
  },

  login(userId: string, password?: string, skipPassword = false): boolean {
    const user = state.employees.find((e) => e.id === userId && e.active !== false);
    if (!user) return false;
    if (!skipPassword && password !== undefined && password !== user.password) return false;
    state = {
      ...state,
      currentUser: user,
      session: { userId: user.id, loggedInAt: new Date().toISOString() },
      employees: state.employees.map((e) => ({ ...e, isCurrent: e.id === user.id })),
      projects: state.projects.map((p) => ({
        ...p,
        mine: p.ownerId === user.id || p.authorId === user.id,
      })),
    };
    emit();
    return true;
  },

  logout() {
    state = { ...state, session: null };
    emit();
  },

  needsOnboarding(): boolean {
    if (APP_VARIANT === "test") return false;
    if (state.onboardingComplete) return false;
    const hasAdmin = state.employees.some(
      (e) => e.kind === "human" && e.accessRole === "admin" && e.active !== false && e.id !== "__setup__",
    );
    return !hasAdmin;
  },

  /**
   * 首次引導：建立工作區管理員並登入。
   */
  bootstrapAdmin(input: {
    name: string;
    email: string;
    password: string;
    title?: string;
  }): { ok: boolean; reason?: string; userId?: string } {
    const name = input.name.trim();
    const email = input.email.trim();
    const password = input.password;
    if (!name) return { ok: false, reason: "請填寫姓名" };
    if (!email || !email.includes("@")) return { ok: false, reason: "請填寫有效 Email" };
    if (!password || password.length < 4) return { ok: false, reason: "密碼至少 4 字元" };

    const id = `admin-${Date.now().toString(36)}`;
    const avatar = name.slice(0, 1).toUpperCase() || "A";
    const admin: Employee = {
      id,
      name,
      title: (input.title ?? "工作區管理員").trim() || "工作區管理員",
      avatar,
      email,
      accessRole: "admin",
      kind: "human",
      agentFamily: null,
      password,
      isCurrent: true,
      active: true,
    };

    // 清掉幽靈帳與示範殘留
    const rest = state.employees.filter((e) => e.id !== "__setup__" && e.id !== "scott");
    state = {
      ...state,
      employees: [admin, ...rest.filter((e) => e.kind === "agent")],
      currentUser: admin,
      session: { userId: admin.id, loggedInAt: new Date().toISOString() },
      showSamples: false,
      projects: state.projects.filter((p) => !p.isSample),
      comments: state.comments.filter((c) => !c.authorId?.startsWith("claude") && !c.authorId?.startsWith("codex")),
    };
    emit();
    return { ok: true, userId: id };
  },

  /** 引導步驟：安裝入門 Agent 包（可略過） */
  installStarterAgents(passwordForAgents?: string): { ok: boolean; count: number } {
    const pwd =
      passwordForAgents ||
      state.employees.find((e) => e.accessRole === "admin" && e.kind === "human")?.password ||
      "demo";
    const starters = buildStarterAgents(pwd);
    const existingIds = new Set(state.employees.map((e) => e.id));
    const toAdd = starters.filter((a) => !existingIds.has(a.id));
    if (!toAdd.length) return { ok: true, count: 0 };
    state = { ...state, employees: [...state.employees, ...toAdd] };
    emit();
    return { ok: true, count: toAdd.length };
  },

  completeOnboarding(opts?: { next?: "blank" | "beginner" | "import" }) {
    state = {
      ...state,
      onboardingComplete: true,
      showSamples: false,
    };
    emit();
    return opts?.next ?? "blank";
  },

  /** 從 Markdown 粗略匯入為新專案草稿 */
  importMarkdownProject(filename: string, markdown: string): { ok: boolean; projectId?: string; reason?: string } {
    const user = state.currentUser;
    if (!user || user.id === "__setup__" || user.active === false) {
      return { ok: false, reason: "請先完成管理員建立並登入" };
    }
    const titleMatch = markdown.match(/^#\s+(.+)$/m);
    const title =
      (titleMatch?.[1] ?? "").trim() ||
      filename.replace(/\.md$/i, "").trim() ||
      "匯入的 PRD";
    const id = `p${Date.now()}`;
    const p: Project = {
      id,
      title,
      customName: undefined,
      status: "draft",
      pct: 8,
      owner: user.name,
      ownerId: user.id,
      authorId: user.id,
      authorAgentFamily: user.kind === "agent" ? user.agentFamily : null,
      mine: true,
      updated: "剛剛",
      lastFileAt: nowIso(),
      tag: "import",
      isSample: false,
      isImported: true,
      sourceFolder: filename,
    };
    this.addProject(p);
    this.setActiveProject(id);
    // 盡量塞進摘要 what
    const body = markdown.replace(/^#\s+.+$/m, "").trim().slice(0, 4000);
    if (body) {
      this.setSectionField("summary", "what", body.slice(0, 500));
      this.setSectionField("problem", "problem", body.slice(0, 1500));
      this.updateSection("summary", { status: "warn" });
      this.updateSection("problem", { status: "warn" });
    }
    return { ok: true, projectId: id };
  },

  /**
   * 把一個既有專案綁到磁碟上的資料夾。
   *
   * 與「專案匯入」不同：不做評分、不覆蓋任何章節內容。只是記下
   * 「這份 PRD 對應到這個資料夾」，讓編輯台的檔案樹有東西可畫。
   * 手動新建的 PRD 通常是先有內容才有資料夾，內容不能被掃描結果蓋掉。
   */
  bindProjectFolder(
    projectId: string,
    folderName: string,
    folderPath: string,
    paths: string[],
    matchedFiles: { slot: string; path: string; contentScore: number }[] = [],
  ) {
    const existing = state.projects.find((p) => p.id === projectId);
    if (!existing) return;

    state = {
      ...state,
      projects: state.projects.map((p) =>
        p.id !== projectId
          ? p
          : {
              ...p,
              sourceFolder: folderName,
              lastFileAt: nowIso(),
              importSummary: {
                folderName,
                rootPath: folderPath,
                scannedAt: nowIso(),
                // 綁定不評分：這些數字留給真正的匯入流程
                overallScore: p.importSummary?.overallScore ?? 0,
                coveragePct: p.importSummary?.coveragePct ?? 0,
                progressPct: p.importSummary?.progressPct ?? 0,
                matchedFiles: matchedFiles.length ? matchedFiles : (p.importSummary?.matchedFiles ?? []),
                missingRequired: p.importSummary?.missingRequired ?? [],
                allPaths: paths,
              },
            },
      ),
    };
    emit();
  },

  setProjects(projects: Project[]) {
    state = { ...state, projects };
    emit();
  },

  addProject(p: Project) {
    const bag = snapshotActiveDocs(state);
    if (!bag[p.id]) bag[p.id] = blankDocsForSections(state.sections);
    state = {
      ...state,
      projects: [p, ...state.projects],
      projectSectionValues: bag,
    };
    emit();
  },

  /**
   * 確認匯入：將掃描候選轉成獨立專案 + 正文袋。
   * 回傳建立的專案 id 列表（第一個會設為 active）。
   */
  importProjectCandidates(
    candidates: ProjectCandidate[],
    folderName: string,
  ): { ok: boolean; projectIds: string[]; reason?: string } {
    const user = state.currentUser;
    if (!user || user.id === "__setup__" || user.active === false) {
      return { ok: false, projectIds: [], reason: "請先登入" };
    }
    if (user.accessRole === "approver") {
      return { ok: false, projectIds: [], reason: "核准人員無法匯入專案" };
    }
    const selected = candidates.filter((c) => c.selected && c.files.length >= 0);
    if (!selected.length) {
      return { ok: false, projectIds: [], reason: "請至少勾選一個專案" };
    }

    const bag = snapshotActiveDocs(state);
    const newProjects: Project[] = [];
    const ids: string[] = [];

    for (const c of selected) {
      const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const docs = mapCandidateToSectionValues(c);
      // 合併完整 section keys
      const full = blankDocsForSections(state.sections);
      for (const [sid, fields] of Object.entries(docs)) {
        full[sid] = { ...(full[sid] ?? {}), ...fields };
      }
      bag[id] = full;

      const missingRequired = c.slots
        .filter((s) => s.required && s.status === "missing")
        .map((s) => s.label);

      const summary: ProjectImportSummary = {
        folderName,
        rootPath: c.rootPath,
        scannedAt: new Date().toISOString(),
        overallScore: c.overallScore,
        coveragePct: c.coveragePct,
        progressPct: c.progressPct,
        matchedFiles: c.matches.map((m) => ({
          slot: m.slot,
          path: m.file.path,
          contentScore: m.contentScore,
        })),
        missingRequired,
        // 只留路徑不留內文，否則 localStorage 很快就爆
        allPaths: c.files.map((f) => f.path),
      };

      const folder = folderName || c.name || "匯入專案";
      const p: Project = {
        id,
        title: folder,
        // 未自訂名稱時顯示資料夾名
        customName: undefined,
        status: "draft",
        pct: Math.max(5, Math.min(95, c.progressPct)),
        owner: user.name,
        ownerId: user.id,
        authorId: user.id,
        authorAgentFamily: user.kind === "agent" ? user.agentFamily : null,
        mine: true,
        updated: "剛剛",
        lastFileAt: summary.scannedAt || nowIso(),
        tag: "import",
        isSample: false,
        isImported: true,
        sourceFolder: folder,
        importSummary: summary,
      };
      newProjects.push(p);
      ids.push(id);

      // 每個匯入的專案都要有自己的空白正文袋。
      // 少了這一步，總覽的 gateOf() 會 fallback 到 `{}` —— 那不是「空白文件」，
      // 而是「連 sections 骨架都沒有」，evaluatePrdGates 會據此判出 4 項阻擋。
      // 六個專案就憑空長出十幾項不存在的阻擋，首屏標題直接被灌水。
      if (!bag[id]) bag[id] = blankDocsForSections(state.sections);

      if (!state.cases[id]) {
        state = {
          ...state,
          cases: {
            ...state.cases,
            [id]: caseFromWorkflow(id, state.workflowStages, state.employees),
          },
        };
      }
    }

    const firstId = ids[0];
    const firstDocs = bag[firstId] ?? blankDocsForSections(state.sections);

    state = {
      ...state,
      projects: [...newProjects, ...state.projects],
      projectSectionValues: bag,
      activeProjectId: firstId,
      sectionValues: structuredClone(firstDocs),
    };
    syncApprovalsFromActiveCase();
    emit();
    return { ok: true, projectIds: ids };
  },

  /**
   * 退出追蹤：僅從工作區拿掉專案與正文袋，不刪磁碟檔案。
   */
  untrackProject(id: string): { ok: boolean; reason?: string } {
    const user = state.currentUser;
    if (user.accessRole !== "admin" && user.accessRole !== "editor") {
      return { ok: false, reason: "僅編輯人員或管理員可退出追蹤" };
    }
    if (!state.projects.some((p) => p.id === id)) {
      return { ok: false, reason: "找不到該專案" };
    }
    const bag = { ...state.projectSectionValues };
    delete bag[id];
    const cases = { ...state.cases };
    delete cases[id];
    const projects = state.projects.filter((p) => p.id !== id);
    let activeProjectId = state.activeProjectId;
    let sectionValues = state.sectionValues;
    if (activeProjectId === id) {
      activeProjectId = projects[0]?.id ?? "";
      sectionValues = activeProjectId
        ? structuredClone(bag[activeProjectId] ?? blankDocsForSections(state.sections))
        : blankDocsForSections(state.sections);
      if (activeProjectId) bag[activeProjectId] = sectionValues;
    }
    state = {
      ...state,
      projects,
      projectSectionValues: bag,
      cases,
      activeProjectId,
      sectionValues,
      locked: false,
    };
    syncApprovalsFromActiveCase();
    emit();
    return { ok: true };
  },

  /** @deprecated 請用 untrackProject（語意：退出追蹤，非刪檔） */
  deleteProject(id: string): { ok: boolean; reason?: string } {
    return this.untrackProject(id);
  },

  /** 清空工作區內所有追蹤專案（不碰磁碟） */
  untrackAllProjects(): { ok: boolean; count: number; reason?: string } {
    const user = state.currentUser;
    if (user.accessRole !== "admin" && user.accessRole !== "editor") {
      return { ok: false, count: 0, reason: "僅編輯人員或管理員可清空追蹤" };
    }
    const count = state.projects.length;
    state = {
      ...state,
      projects: [],
      projectSectionValues: {},
      cases: {},
      activeProjectId: "",
      sectionValues: blankDocsForSections(state.sections),
      comments: [],
      locked: false,
      approvals: structuredClone(SEED_APPROVALS).map((a) => ({
        ...a,
        name: "待指派",
        state: "empty" as const,
        assigneeId: undefined,
      })),
    };
    emit();
    return { ok: true, count };
  },

  setSectionValues(sectionId: string, values: Record<string, string>) {
    const sectionValues = {
      ...state.sectionValues,
      [sectionId]: { ...state.sectionValues[sectionId], ...values },
    };
    const bag = { ...state.projectSectionValues };
    if (state.activeProjectId) bag[state.activeProjectId] = sectionValues;
    state = { ...state, sectionValues, projectSectionValues: bag };
    touchProjectMeta(state.activeProjectId);
    emit();
  },

  setSectionField(sectionId: string, key: string, value: string) {
    const cur = state.sectionValues[sectionId] ?? {};
    const sectionValues = {
      ...state.sectionValues,
      [sectionId]: { ...cur, [key]: value },
    };
    const bag = { ...state.projectSectionValues };
    if (state.activeProjectId) bag[state.activeProjectId] = sectionValues;
    state = { ...state, sectionValues, projectSectionValues: bag };
    touchProjectMeta(state.activeProjectId);
    emit();
  },

  /** 自訂側欄顯示名稱（空字串＝清除自訂，改回資料夾／標題） */
  /** 專案介紹：純顯示用文字，不進 PRD 章節，也不影響任何 gate */
  setProjectDescription(id: string, description: string) {
    const text = description.trim();
    state = {
      ...state,
      projects: state.projects.map((p) =>
        p.id === id ? { ...p, description: text || undefined } : p,
      ),
    };
    emit();
  },

  /**
   * 專案標籤。全部走同一個 setter，不做 add/remove 兩支 ——
   * 呼叫端本來就拿得到完整清單，兩支 API 只會多出「誰負責去重」的問題。
   * 去重與正規化（去頭尾空白、丟掉空字串、忽略大小寫重複）統一在這裡做。
   */
  /**
   * 範本使用次數 +1。
   * 種子資料原本寫死 128 / 96 / 140 這些數字當作「使用次數」顯示 ——
   * 那是編的。全部歸零並改成真的在套用時累加，畫面上的數字才有意義。
   */
  bumpTemplateUse(id: string) {
    state = {
      ...state,
      templates: state.templates.map((t) => (t.id === id ? { ...t, uses: t.uses + 1 } : t)),
    };
    emit();
  },

  setProjectTags(id: string, tags: string[]) {
    const seen = new Set<string>();
    const clean: string[] = [];
    for (const raw of tags) {
      const t = raw.trim().replace(/\s+/g, " ");
      if (!t) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      clean.push(t);
    }
    state = {
      ...state,
      projects: state.projects.map((p) =>
        p.id === id ? { ...p, tags: clean.length ? clean : undefined } : p,
      ),
    };
    emit();
  },

  /** 目前所有專案用過的標籤，依使用次數多到少 —— 給輸入建議與篩選列用 */
  allTags(): { tag: string; count: number }[] {
    const by = new Map<string, { tag: string; count: number }>();
    for (const p of state.projects) {
      for (const t of p.tags ?? []) {
        const key = t.toLowerCase();
        const hit = by.get(key);
        if (hit) hit.count += 1;
        else by.set(key, { tag: t, count: 1 });
      }
    }
    return [...by.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  },

  renameProject(id: string, customName: string): { ok: boolean; reason?: string } {
    const user = state.currentUser;
    if (user.accessRole !== "admin" && user.accessRole !== "editor") {
      return { ok: false, reason: "無權限重新命名" };
    }
    if (!state.projects.some((p) => p.id === id)) {
      return { ok: false, reason: "找不到專案" };
    }
    const name = customName.trim();
    state = {
      ...state,
      projects: state.projects.map((p) =>
        p.id === id
          ? {
              ...p,
              customName: name || undefined,
              updated: "剛剛",
              lastFileAt: nowIso(),
            }
          : p,
      ),
    };
    emit();
    return { ok: true };
  },

  updateSection(sectionId: string, patch: Partial<Section>) {
    state = {
      ...state,
      sections: state.sections.map((s) => (s.id === sectionId ? { ...s, ...patch } : s)),
    };
    emit();
  },

  setCheck(sectionId: string, checkId: string, pass: boolean) {
    state = {
      ...state,
      sections: state.sections.map((s) => {
        if (s.id !== sectionId) return s;
        return {
          ...s,
          checks: s.checks.map((c) => (c.id === checkId ? { ...c, pass } : c)),
        };
      }),
    };
    emit();
  },

  setActiveSection(id: string) {
    state = { ...state, activeSectionId: id };
    emit();
  },

  setPendingInsert(body: string | null) {
    state = { ...state, pendingInsert: body };
    emit();
  },

  consumePendingInsert(): string | null {
    const body = state.pendingInsert;
    if (body) {
      state = { ...state, pendingInsert: null };
      emit();
    }
    return body;
  },

  setComments(comments: Comment[]) {
    state = { ...state, comments };
    emit();
  },

  addComment(c: Comment) {
    state = { ...state, comments: [c, ...state.comments] };
    emit();
  },

  resolveComment(id: string): { ok: boolean; reason?: string } {
    const comment = state.comments.find((c) => c.id === id);
    if (!comment) return { ok: false, reason: "留言不存在" };
    // Peer review rule: editors cannot resolve on their own docs (use active project p1 heuristic)
    const project = state.projects.find((p) => p.id === "p1") ?? state.projects[0];
    const peer = canPeerReview(state.currentUser, project);
    const isApprover = canApproveProject(state.currentUser, project).ok;
    if (!peer.ok && !isApprover && state.currentUser.accessRole !== "admin") {
      return { ok: false, reason: peer.reason ?? "無權覆核" };
    }
    // Editor cannot peer-review own work
    if (
      state.currentUser.accessRole === "editor" &&
      project &&
      (project.authorId === state.currentUser.id || comment.authorId === state.currentUser.id)
    ) {
      // Allow resolving others' comments on others' docs only — if own project, block
      if (project.authorId === state.currentUser.id) {
        return { ok: false, reason: "編輯人員不可覆核自己的檔案" };
      }
    }
    state = {
      ...state,
      comments: state.comments.map((c) => (c.id === id ? { ...c, resolved: true } : c)),
    };
    emit();
    return { ok: true };
  },

  setActiveProject(id: string) {
    if (!state.projects.some((p) => p.id === id)) return;
    if (id === state.activeProjectId) {
      // 仍確保 case 存在
      if (!state.cases[id]) {
        state = {
          ...state,
          cases: {
            ...state.cases,
            [id]: caseFromWorkflow(id, state.workflowStages, state.employees),
          },
        };
        syncApprovalsFromActiveCase();
        emit();
      }
      return;
    }

    // 1) 快照目前專案正文
    const bag = snapshotActiveDocs(state);
    // 2) 載入目標專案正文（無則空白）
    const nextDocs =
      bag[id] ?? blankDocsForSections(state.sections);
    bag[id] = nextDocs;

    state = {
      ...state,
      activeProjectId: id,
      sectionValues: structuredClone(nextDocs),
      projectSectionValues: bag,
    };
    if (!state.cases[id]) {
      state = {
        ...state,
        cases: {
          ...state.cases,
          [id]: caseFromWorkflow(id, state.workflowStages, state.employees),
        },
      };
    }
    syncApprovalsFromActiveCase();
    emit();
  },

  approveAndLock(): { ok: boolean; reason?: string } {
    const project =
      state.projects.find((p) => p.id === state.activeProjectId) ??
      state.projects.find((p) => p.id === "p1") ??
      state.projects[0];
    if (!project) return { ok: false, reason: "找不到專案" };
    const c = state.cases[project.id];
    if (c?.withdrawn) return { ok: false, reason: "此案已抽單，無法簽核" };
    const check = canApproveProject(state.currentUser, project);
    if (!check.ok) return check;

    const u = state.currentUser;
    const stages = (c?.stages ?? []).map((s) => {
      if (s.state === "pending" || s.state === "empty") {
        // 僅簽自己的關卡，或 admin 可簽全部 pending
        if (
          u.accessRole === "admin" ||
          s.assigneeId === u.id ||
          (!s.assigneeId && u.accessRole === "approver")
        ) {
          return {
            ...s,
            state: "approved" as const,
            assigneeId: s.assigneeId ?? u.id,
            assigneeName: `${u.name} · 已簽`,
          };
        }
      }
      return s;
    });
    // 若仍有 required pending，允許 admin 一鍵全簽
    let nextStages = stages;
    if (u.accessRole === "admin" || stages.every((s) => s.state === "approved" || s.state === "skipped")) {
      nextStages = stages.map((s) =>
        s.state === "approved" || s.state === "skipped"
          ? s
          : {
              ...s,
              state: "approved" as const,
              assigneeId: s.assigneeId ?? u.id,
              assigneeName: `${u.name} · 已簽`,
            },
      );
    }
    const allDone = nextStages.every((s) => s.state === "approved" || s.state === "skipped");
    const nextCase: CaseRecord = {
      ...(c ?? caseFromWorkflow(project.id, state.workflowStages, state.employees)),
      stages: nextStages,
      locked: allDone,
      withdrawn: false,
    };
    state = {
      ...state,
      cases: { ...state.cases, [project.id]: nextCase },
      locked: allDone,
      projects: state.projects.map((p) =>
        p.id === project.id
          ? {
              ...p,
              status: allDone ? "approved" : "review",
              pct: allDone ? 100 : p.pct,
              updated: "剛剛",
            }
          : p,
      ),
    };
    syncApprovalsFromActiveCase();
    audit(state, project.id, allDone ? "review.approve" : "gate.pass", `prd:${project.id}`, {
      stage: allDone ? "all" : "partial",
      count: nextStages.filter((s) => s.state === "approved").length,
    });
    emit();
    return { ok: true };
  },

  submitForReview(projectId?: string) {
    const id = projectId ?? state.activeProjectId ?? "p1";
    const existing = state.cases[id];
    const c =
      existing && !existing.withdrawn
        ? existing
        : caseFromWorkflow(id, state.workflowStages, state.employees);
    state = {
      ...state,
      activeProjectId: id,
      cases: {
        ...state.cases,
        [id]: {
          ...c,
          withdrawn: false,
          withdrawnAt: null,
          withdrawnBy: null,
          withdrawReason: null,
          locked: false,
        },
      },
      locked: false,
      projects: state.projects.map((p) =>
        p.id === id ? { ...p, status: "review", updated: "剛剛" } : p,
      ),
    };
    syncApprovalsFromActiveCase();
    audit(state, id, "review.submit", `prd:${id}`);
    emit();
  },

  /* ─── 管理中心：簽核流程設計 ─── */
  setWorkflowStages(stages: WorkflowStageDef[]) {
    state = {
      ...state,
      workflowStages: stages.map((s, i) => ({ ...s, order: i + 1 })),
    };
    emit();
  },

  addWorkflowStage(partial?: Partial<WorkflowStageDef>): WorkflowStageDef {
    const id = `ws-${Date.now()}`;
    const stage: WorkflowStageDef = {
      id,
      order: state.workflowStages.length + 1,
      name: partial?.name ?? `關卡 ${state.workflowStages.length + 1}`,
      defaultAssigneeId: partial?.defaultAssigneeId ?? null,
      required: partial?.required ?? true,
    };
    state = { ...state, workflowStages: [...state.workflowStages, stage] };
    emit();
    return stage;
  },

  updateWorkflowStage(id: string, patch: Partial<WorkflowStageDef>) {
    state = {
      ...state,
      workflowStages: state.workflowStages.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    };
    emit();
  },

  removeWorkflowStage(id: string) {
    state = {
      ...state,
      workflowStages: state.workflowStages
        .filter((s) => s.id !== id)
        .map((s, i) => ({ ...s, order: i + 1 })),
    };
    emit();
  },

  moveWorkflowStage(id: string, dir: -1 | 1) {
    const list = [...state.workflowStages].sort((a, b) => a.order - b.order);
    const i = list.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    state = {
      ...state,
      workflowStages: list.map((s, idx) => ({ ...s, order: idx + 1 })),
    };
    emit();
  },

  /* ─── 管理中心：個案調整 ─── */
  ensureCase(projectId: string): CaseRecord {
    if (state.cases[projectId] && !state.cases[projectId]!.withdrawn) {
      return state.cases[projectId]!;
    }
    const c = caseFromWorkflow(projectId, state.workflowStages, state.employees);
    state = { ...state, cases: { ...state.cases, [projectId]: c } };
    return c;
  },

  reassignCaseStage(
    projectId: string,
    stageId: string,
    assigneeId: string | null,
  ): { ok: boolean; reason?: string } {
    if (state.currentUser.accessRole !== "admin") {
      return { ok: false, reason: "僅管理員可異動關卡人員" };
    }
    let c = state.cases[projectId];
    if (!c || c.withdrawn) {
      c = caseFromWorkflow(projectId, state.workflowStages, state.employees);
      state = { ...state, cases: { ...state.cases, [projectId]: c } };
    }
    if (c.locked) return { ok: false, reason: "已鎖定案件不可異動關卡" };
    if (c.withdrawn) return { ok: false, reason: "已抽單案件請先重送" };
    const emp = assigneeId ? state.employees.find((e) => e.id === assigneeId) : null;
    if (assigneeId && !emp) return { ok: false, reason: "找不到指派對象" };
    if (emp && emp.accessRole === "editor" && emp.kind === "human") {
      // allow but warn — editors can be reassigned only if admin forces; agents ok as approver
    }
    const stages = c.stages.map((s) => {
      if (s.id !== stageId) return s;
      return {
        ...s,
        assigneeId: emp?.id ?? null,
        assigneeName: emp ? (s.state === "approved" ? `${emp.name} · 已簽` : emp.name) : "待指派",
        state: s.state === "approved" ? s.state : emp ? ("pending" as const) : ("empty" as const),
      };
    });
    state = {
      ...state,
      cases: { ...state.cases, [projectId]: { ...c, stages } },
    };
    if (projectId === state.activeProjectId) syncApprovalsFromActiveCase();
    emit();
    return { ok: true };
  },

  withdrawCase(projectId: string, reason: string): { ok: boolean; reason?: string } {
    if (state.currentUser.accessRole !== "admin" && state.currentUser.accessRole !== "editor") {
      return { ok: false, reason: "僅管理員或編輯可抽單" };
    }
    const project = state.projects.find((p) => p.id === projectId);
    if (!project) return { ok: false, reason: "找不到專案" };
    if (project.status === "approved") {
      if (state.currentUser.accessRole !== "admin") {
        return { ok: false, reason: "已核准案件僅管理員可抽單" };
      }
    }
    let c = state.cases[projectId];
    if (!c) {
      c = caseFromWorkflow(projectId, state.workflowStages, state.employees);
    }
    const next: CaseRecord = {
      ...c,
      withdrawn: true,
      withdrawnAt: new Date().toISOString(),
      withdrawnBy: state.currentUser.name,
      withdrawReason: reason || "管理者抽單",
      locked: false,
    };
    state = {
      ...state,
      cases: { ...state.cases, [projectId]: next },
      locked: projectId === state.activeProjectId ? false : state.locked,
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, status: "withdrawn", updated: "剛剛" } : p,
      ),
    };
    if (projectId === state.activeProjectId) syncApprovalsFromActiveCase();
    audit(state, projectId, "review.withdraw", `prd:${projectId}`, {
      reason: reason || "管理者抽單",
    });
    emit();
    return { ok: true };
  },

  reopenCase(projectId: string): { ok: boolean; reason?: string } {
    if (state.currentUser.accessRole !== "admin") {
      return { ok: false, reason: "僅管理員可重開抽單案件" };
    }
    const c = caseFromWorkflow(projectId, state.workflowStages, state.employees);
    state = {
      ...state,
      cases: { ...state.cases, [projectId]: c },
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, status: "review", updated: "剛剛" } : p,
      ),
    };
    if (projectId === state.activeProjectId) {
      state = { ...state, locked: false };
      syncApprovalsFromActiveCase();
    }
    emit();
    return { ok: true };
  },

  applyWorkflowToCase(projectId: string): { ok: boolean; reason?: string } {
    if (state.currentUser.accessRole !== "admin") {
      return { ok: false, reason: "僅管理員可套用流程到個案" };
    }
    const c = caseFromWorkflow(projectId, state.workflowStages, state.employees);
    state = {
      ...state,
      cases: { ...state.cases, [projectId]: c },
      projects: state.projects.map((p) =>
        p.id === projectId && p.status === "draft"
          ? { ...p, status: "review", updated: "剛剛" }
          : p.id === projectId
            ? { ...p, updated: "剛剛" }
            : p,
      ),
    };
    if (projectId === state.activeProjectId) {
      state = { ...state, locked: false };
      syncApprovalsFromActiveCase();
    }
    emit();
    return { ok: true };
  },

  updateSettings(patch: Partial<AISettings>) {
    state = {
      ...state,
      settings: { ...state.settings, ...patch },
    };
    emit();
  },

  importState(newState: Partial<AppState>) {
    state = {
      ...seedState(),
      ...newState,
      settings: { ...DEFAULT_SETTINGS, ...(newState.settings ?? {}) },
    };
    emit();
  },

  deleteTemplate(id: string) {
    state = {
      ...state,
      templates: state.templates.filter((t) => t.id !== id),
    };
    emit();
  },

  addTemplate(tpl: Template) {
    state = {
      ...state,
      templates: [tpl, ...state.templates],
    };
    emit();
  },

  addEmployee(emp: Employee): { ok: boolean; reason?: string } {
    const err = validateEmployeeRole(emp.kind, emp.accessRole);
    if (err) return { ok: false, reason: err };
    emp.agentFamily = normalizeAgentFamily(emp.kind, emp.agentFamily);
    state = {
      ...state,
      employees: [...state.employees, emp],
    };
    emit();
    return { ok: true };
  },

  updateEmployee(id: string, patch: Partial<Employee>): { ok: boolean; reason?: string } {
    const cur = state.employees.find((e) => e.id === id);
    if (!cur) return { ok: false, reason: "找不到人員" };
    const next = { ...cur, ...patch };
    const err = validateEmployeeRole(next.kind, next.accessRole);
    if (err) return { ok: false, reason: err };
    next.agentFamily = normalizeAgentFamily(next.kind, next.agentFamily);
    state = {
      ...state,
      employees: state.employees.map((e) => (e.id === id ? next : e)),
      currentUser: state.currentUser.id === id ? next : state.currentUser,
    };
    emit();
    return { ok: true };
  },

  deleteEmployee(id: string): { ok: boolean; reason?: string } {
    if (state.currentUser.id === id) return { ok: false, reason: "不可刪除目前登入身分" };
    state = {
      ...state,
      employees: state.employees.filter((e) => e.id !== id),
    };
    emit();
    return { ok: true };
  },

  setCurrentUser(id: string) {
    const target = state.employees.find((e) => e.id === id);
    if (!target) return;
    state = {
      ...state,
      currentUser: target,
      session: state.session
        ? { userId: target.id, loggedInAt: state.session.loggedInAt }
        : { userId: target.id, loggedInAt: new Date().toISOString() },
      employees: state.employees.map((e) => ({
        ...e,
        isCurrent: e.id === id,
      })),
      projects: state.projects.map((p) => ({
        ...p,
        mine: p.ownerId === id || p.authorId === id,
      })),
    };
    emit();
  },

  /** 一鍵移除／展示範例文件內容 */
  setShowSamples(show: boolean) {
    if (show === state.showSamples) return;
    if (!show) {
      // hide samples: stash content, blank values, filter still done in UI
      state = {
        ...state,
        showSamples: false,
        sampleSectionValues: structuredClone(state.sectionValues),
        sectionValues: emptySectionValues(state.sections),
        sections: state.sections.map((s) => ({
          ...s,
          status: "empty" as const,
          score: 0,
          checks: s.checks.map((c) => ({ ...c, pass: false })),
        })),
      };
    } else {
      const restored = state.sampleSectionValues
        ? structuredClone(state.sampleSectionValues)
        : valuesFromSections(structuredClone(SEED_SECTIONS));
      // re-seed from seed if stash empty-ish
      const seedVals = valuesFromSections(structuredClone(SEED_SECTIONS));
      const useSeed =
        !state.sampleSectionValues ||
        Object.values(state.sampleSectionValues).every((row) =>
          Object.values(row).every((v) => !v.trim()),
        );
      state = {
        ...state,
        showSamples: true,
        sectionValues: useSeed ? seedVals : restored,
        sampleSectionValues: null,
        sections: structuredClone(SEED_SECTIONS),
        projects: (() => {
          const nonSample = state.projects.filter((p) => !p.isSample);
          const samples = structuredClone(SEED_PROJECTS);
          return [...samples, ...nonSample];
        })(),
        comments: structuredClone(SEED_COMMENTS),
        approvals: structuredClone(SEED_APPROVALS),
        locked: false,
      };
    }
    emit();
  },

  visibleProjects(): Project[] {
    if (state.showSamples) return state.projects;
    return state.projects.filter((p) => !p.isSample);
  },

  /* ─── Agent 設定與進場呼叫 ─── */
  setAgentEnabled(id: string, enabled: boolean): { ok: boolean; reason?: string } {
    const e = state.employees.find((x) => x.id === id);
    if (!e || e.kind !== "agent") return { ok: false, reason: "不是 Agent" };
    return this.updateEmployee(id, { agentEnabled: enabled });
  },

  updateAgentProfile(
    id: string,
    patch: { agentPrompt?: string; agentRoleBrief?: string; title?: string; agentEnabled?: boolean },
  ): { ok: boolean; reason?: string } {
    const e = state.employees.find((x) => x.id === id);
    if (!e || e.kind !== "agent") return { ok: false, reason: "不是 Agent" };
    return this.updateEmployee(id, patch);
  },

  // ── 版本取號 ─────────────────────────────────────────────────
  // 版號一律由使用者填。這裡沒有任何 +1 或預設值的邏輯，是刻意的：
  // 版號是對外承諾，那個決定必須是人做的。

  releasesOf(projectId?: string): Release[] {
    const pid = projectId ?? state.activeProjectId;
    return state.releases
      .filter((r) => r.projectId === pid)
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  createRelease(projectId?: string): Release {
    const pid = projectId ?? state.activeProjectId;
    const r = draftRelease(pid, `rel-${Date.now()}`, nowIso());
    state = { ...state, releases: [r, ...state.releases] };
    emit();
    return r;
  },

  /** 版號改動要先過驗證，呼叫端拿到 ok:false 就不要寫進去 */
  updateRelease(id: string, patch: Partial<Release>): { ok: boolean; reason?: string } {
    const cur = state.releases.find((r) => r.id === id);
    if (!cur) return { ok: false, reason: "找不到這一版" };
    if (patch.version !== undefined) {
      const v = validateVersion(patch.version, cur.projectId, state.releases, id);
      if (!v.ok) return v;
    }
    state = {
      ...state,
      releases: state.releases.map((r) =>
        r.id === id ? { ...r, ...patch, updatedAt: nowIso() } : r,
      ),
    };
    emit();
    return { ok: true };
  },

  deleteRelease(id: string) {
    state = { ...state, releases: state.releases.filter((r) => r.id !== id) };
    emit();
  },

  addReleaseItem(id: string, item: Omit<ReleaseItem, "id">) {
    const withId: ReleaseItem = { ...item, id: `ri-${Date.now()}-${Math.round(performance.now())}` };
    state = {
      ...state,
      releases: state.releases.map((r) =>
        r.id === id ? { ...r, items: [...r.items, withId], updatedAt: nowIso() } : r,
      ),
    };
    emit();
  },

  updateReleaseItem(id: string, itemId: string, patch: Partial<ReleaseItem>) {
    state = {
      ...state,
      releases: state.releases.map((r) =>
        r.id === id
          ? {
              ...r,
              items: r.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
              updatedAt: nowIso(),
            }
          : r,
      ),
    };
    emit();
  },

  removeReleaseItem(id: string, itemId: string) {
    state = {
      ...state,
      releases: state.releases.map((r) =>
        r.id === id
          ? { ...r, items: r.items.filter((i) => i.id !== itemId), updatedAt: nowIso() }
          : r,
      ),
    };
    emit();
  },

  markReleaseHanded(id: string) {
    const iso = nowIso();
    state = {
      ...state,
      releases: state.releases.map((r) =>
        r.id === id ? { ...r, status: "handed", handedAt: iso, updatedAt: iso } : r,
      ),
    };
    emit();
  },

  /**
   * 呼叫 Agent 進場：佇列 → 真實 LLM 執行 → 完成／失敗（無 API Key 則 failed，不產生假結果）
   */
  invokeAgent(opts: {
    agentId: string;
    projectId?: string;
    task: AgentTaskType;
    note?: string;
  }): { ok: boolean; reason?: string; jobId?: string } {
    const agent = state.employees.find((e) => e.id === opts.agentId && e.kind === "agent");
    if (!agent) return { ok: false, reason: "找不到 Agent" };
    if (agent.active === false) return { ok: false, reason: "Agent 帳號已停用" };
    if (agent.agentEnabled === false) return { ok: false, reason: "Agent 已關閉，請先啟動" };

    // 任務與角色匹配
    if (opts.task === "approve" && agent.accessRole !== "approver" && agent.accessRole !== "admin") {
      return { ok: false, reason: "此 Agent 無核准角色" };
    }
    if (
      (opts.task === "edit" || opts.task === "coach") &&
      agent.accessRole !== "editor" &&
      agent.accessRole !== "admin"
    ) {
      return { ok: false, reason: "此 Agent 無編輯角色" };
    }

    const project =
      state.projects.find((p) => p.id === (opts.projectId ?? state.activeProjectId)) ??
      state.projects[0];
    if (!project) return { ok: false, reason: "找不到專案" };

    // 同 family 不可核准自己寫的文件
    if (
      opts.task === "approve" &&
      project.authorAgentFamily &&
      agent.agentFamily &&
      project.authorAgentFamily === agent.agentFamily
    ) {
      return {
        ok: false,
        reason: `同一種 Agent（${agent.agentFamily}）已撰寫此文件，不可再擔任核准`,
      };
    }

    const jobId = `job-${Date.now()}`;
    const job: AgentJob = {
      id: jobId,
      agentId: agent.id,
      agentName: `${agent.name} · ${agent.accessRole === "approver" ? "核准" : "編輯"}`,
      projectId: project.id,
      projectTitle: project.title,
      task: opts.task,
      status: "queued",
      note: opts.note?.trim() || `呼叫執行：${opts.task}`,
      result: "",
      createdAt: new Date().toISOString(),
      finishedAt: null,
    };

    state = { ...state, agentJobs: [job, ...state.agentJobs].slice(0, 80) };
    emit();

    // 真實模型進場（非假 2FA 模擬）
    void (async () => {
      const mark = (status: AgentJob["status"], result?: string) => {
        state = {
          ...state,
          agentJobs: state.agentJobs.map((j) =>
            j.id === jobId
              ? {
                  ...j,
                  status,
                  ...(result != null ? { result } : {}),
                  ...(status === "done" || status === "failed"
                    ? { finishedAt: new Date().toISOString() }
                    : {}),
                }
              : j,
          ),
        };
        emit();
      };

      mark("running");
      try {
        const { runAgentTask, isAiConfigured } = await import("../lib/ai-coach");
        if (!isAiConfigured()) {
          mark(
            "failed",
            "無法進場：尚未設定 API Key。請至偏好設定填入模型與金鑰後重試。",
          );
          return;
        }
        const bag = state.sectionValues;
        const contextSnippet = Object.entries(bag)
          .map(([sid, fields]) => {
            const title = state.sections.find((s) => s.id === sid)?.title ?? sid;
            const body = Object.entries(fields)
              .map(([k, v]) => `${k}: ${String(v).slice(0, 400)}`)
              .join("\n");
            return `## ${title}\n${body}`;
          })
          .join("\n\n");

        const result = await runAgentTask({
          agentName: agent.name,
          agentRole: agent.agentRoleBrief || agent.title,
          agentPrompt: agent.agentPrompt || "",
          task: opts.task,
          projectTitle: project.title,
          note: opts.note || "",
          contextSnippet,
        });

        // 僅留下意見／開放問題線索，不自動「假核准」
        if (opts.task === "edit" || opts.task === "coach") {
          const open = state.sectionValues["open"] ?? {};
          const prev = open.oq ?? "";
          const line = `\n• [Agent ${agent.name} · ${opts.task}] ${opts.note || "進場建議"} — 剛剛（見進場紀錄全文）`;
          state = {
            ...state,
            sectionValues: {
              ...state.sectionValues,
              open: { ...open, oq: (prev + line).trim() },
            },
          };
        } else if (opts.task === "review" || opts.task === "approve") {
          state = {
            ...state,
            comments: [
              {
                id: `c${Date.now()}`,
                author: agent.name,
                authorId: agent.id,
                avatar: agent.avatar,
                time: "剛剛",
                anchor: "§ Agent 進場",
                body: result.slice(0, 1200),
                resolved: false,
              },
              ...state.comments,
            ],
          };
        }

        mark("done", result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        mark("failed", `進場失敗：${msg}`);
      }
    })();

    return { ok: true, jobId };
  },

  cancelAgentJob(jobId: string) {
    state = {
      ...state,
      agentJobs: state.agentJobs.map((j) =>
        j.id === jobId && (j.status === "queued" || j.status === "running")
          ? { ...j, status: "cancelled" as const, finishedAt: new Date().toISOString() }
          : j,
      ),
    };
    emit();
  },
};

export function liveScore(section: Section, values: Record<string, string>): number {
  const text = Object.values(values).join("\n");
  let score = section.score;
  if (text.length < 40) score = Math.min(score, 40);
  const failed = section.checks.filter((c) => !c.pass).length;
  score = Math.max(0, Math.min(100, score - failed * 8 + Math.min(10, Math.floor(text.length / 80))));
  return score;
}

export function evaluateChecks(section: Section, values: Record<string, string>) {
  return section.checks.map((c) => {
    let pass = c.pass;
    if (section.id === "open" && c.id === "c2") {
      pass = /\d{1,2}\/\d{1,2}|Q\d|週|前/.test(values.oq ?? "");
    }
    if (section.id === "metrics" && c.id === "c3") {
      pass = /完成率|漏斗|開始/.test(values.m1 ?? "");
    }
    if (section.id === "scope" && c.id === "c2") {
      pass = /依賴|風險|設計|法務|資安/.test(values.ms ?? "");
    }
    return { ...c, pass };
  });
}
