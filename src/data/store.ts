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
  PrdVersion,
  Project,
  ProjectImportSummary,
  Section,
  Session,
  Template,
  WorkflowStageDef,
} from "./types";
import { emptySectionValues } from "../lib/export";
import {
  allStagesSettled,
  canCommit,
  capVersions,
  changedFieldCount,
  pickBaseline,
  pickLatestCommit,
  stagesAfterResubmit,
} from "../lib/prd-versions";
import { canResolveComment, migrateComments, projectOfComment } from "../lib/comment-scope";
import { applyMeta, metaFromSections, orphanSectionIds, pickDomain } from "../lib/section-meta";
import { DEFAULT_DOMAIN, domainPacks, reloadUserPacks } from "./domains";
import { autoRescanUserDomains } from "../lib/user-domains";
import { resolveDomain } from "../lib/domain-pack";
import { BASE_GATE_SPEC } from "../lib/prd-gates";
import type { GateSpec } from "../lib/gate-rules";
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
 * 章節骨架＝專案領域包解析的結果，每次載入重新算，不從 localStorage 讀。
 *
 * 舊版把整份 sections（含 guide / tips / fields 定義）存進 localStorage，再用
 * `mergeSectionsWithSeed` 把種子的新欄位補回去——那是「持久化了不該持久化的東西」
 * 之後被迫長出的補丁。骨架是程式碼（現在是領域包）的產物，重算永遠正確；
 * 真正需要留著的只有使用者手動產生的 status / score / checks，那些進
 * `projectSectionMeta`。
 */
function domainOf(p: Project | undefined): string {
  return pickDomain(p?.domain, Object.keys(domainPacks()), DEFAULT_DOMAIN);
}

function domainSections(domain: string): Section[] {
  try {
    return resolveDomain(domain, domainPacks(), {
      sections: SEED_SECTIONS,
      gates: BASE_GATE_SPEC,
    }).sections;
  } catch {
    // 領域包寫壞不該讓整個 App 開不起來——退回通用 7 章，使用者至少還能工作
    return SEED_SECTIONS;
  }
}

function domainGates(domain: string): GateSpec {
  try {
    return resolveDomain(domain, domainPacks(), {
      sections: SEED_SECTIONS,
      gates: BASE_GATE_SPEC,
    }).gateSpec;
  } catch {
    return BASE_GATE_SPEC;
  }
}

/** 解析某專案當下該看到的 sections（骨架 + 該專案的標記） */
function sectionsForProject(
  p: Project | undefined,
  metaBag: AppState["projectSectionMeta"],
): Section[] {
  return applyMeta(domainSections(domainOf(p)), p ? metaBag[p.id] : undefined);
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
    reviewCommitId: null,
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
    projectSectionMeta: {},
    prdDrafts: {},
    prdVersions: {},
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
    // 漏列這一行的代價：換過的領域每次重新載入就悄悄變回 generic，
    // 章節與 gate 一起退回通用版，而使用者寫的內容還在——看起來像資料掉了。
    // 上面那行註解（tags）就是同一個坑，這是第二次。
    domain: raw.domain ? String(raw.domain) : undefined,
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

    // 遷移：沒有 domain 的專案一律 generic。通用不是「特例」，是一個叫 generic
    // 的領域包——少了這一步，程式裡就會長出「有 domain」跟「沒有 domain」兩條路徑。
    const withDomain = projects.map((p) => (p.domain ? p : { ...p, domain: DEFAULT_DOMAIN }));

    let projectSectionMeta =
      (parsed.projectSectionMeta as AppState["projectSectionMeta"] | undefined) ?? {};
    // 舊狀態的 status / score / checks 都在全域 sections 上，而那份**就是**當時
    // active 專案的標記。每次載入都重取（不是只在 bag 空的時候），否則上一輪
    // 沒切過專案就關掉 App，那些勾選會不見。
    if (activeProjectId && Array.isArray(parsed.sections)) {
      projectSectionMeta = {
        ...projectSectionMeta,
        [activeProjectId]: metaFromSections(parsed.sections as Section[]),
      };
    }

    const sections = sectionsForProject(
      withDomain.find((p) => p.id === activeProjectId),
      projectSectionMeta,
    );

    return {
      ...base,
      ...parsed,
      projects: APP_VARIANT === "prod" ? withDomain.filter((p) => !p.isSample) : withDomain,
      sections,
      projectSectionMeta,
      sectionValues: activeDocs,
      projectSectionValues,
      // 舊存檔沒有這兩個欄位 —— 補空的，不要讓 undefined 流進畫面
      prdDrafts: (parsed.prdDrafts as AppState["prdDrafts"] | undefined) ?? {},
      prdVersions: (parsed.prdVersions as AppState["prdVersions"] | undefined) ?? {},
      sampleSectionValues: parsed.sampleSectionValues ?? null,
      // 舊存檔的留言沒有 projectId。掛到當時的 active 專案 —— 那是唯一
      // 說得出口的猜測（留言本來就是在某個專案的審閱頁上寫的），而且
      // 不掛的話它們會變成孤兒：任何專案都看不到、也永遠無法標記已解決。
      comments: migrateComments(parsed.comments ?? base.comments, activeProjectId),
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
    // 空白正文袋要照**新專案自己的領域**算，不是照當下開著的那個專案。
    // 拿錯來源時症狀很輕（缺 key 會 `?? {}`），所以會一路錯下去不被發現。
    if (!bag[p.id]) bag[p.id] = blankDocsForSections(sectionsForProject(p, state.projectSectionMeta));
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
    domain: string = DEFAULT_DOMAIN,
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
      // 空白 key 依**匯入時選的領域**算，不是當下開著的專案
      const full = blankDocsForSections(domainSections(pickDomain(domain, Object.keys(domainPacks()), DEFAULT_DOMAIN)));
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
        domain: pickDomain(domain, Object.keys(domainPacks()), DEFAULT_DOMAIN),
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
    // 專案移除了，它的草稿與整條版本線也要跟著走 —— 留著就是永遠不會再被
    // 讀到的孤兒資料，而每份 commit 是整份 PRD 快照，佔的空間不小。
    const drafts = { ...state.prdDrafts };
    delete drafts[id];
    const versions = { ...state.prdVersions };
    delete versions[id];
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
      prdDrafts: drafts,
      prdVersions: versions,
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

  /**
   * 直接寫進已儲存的正文。
   *
   * **一般編輯不要走這裡** —— 使用者打字請用 `setSectionDraft`，按下儲存才
   * 用 `saveSection`。這支保留給「本來就等於已儲存」的寫入：匯入、還原快照、
   * 核准後合併主線。分兩支的理由是取消自動存檔之後，「已儲存」必須是一個
   * 使用者明確做過的動作，不能被任何一個 setter 順手改掉。
   */
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

  // ── 草稿（未儲存）────────────────────────────────────────────
  //
  // 取消自動存檔之後每個按鍵寫這裡。持久化，所以當機不掉字；
  // 但它不是「已儲存」，異動高亮就是拿它跟 projectSectionValues 比。

  /** 使用者打字的落點。與已儲存值相同時自動清掉草稿 —— 改回原樣就不算 dirty。 */
  setSectionDraft(sectionId: string, key: string, value: string) {
    const pid = state.activeProjectId;
    if (!pid) return;
    const saved = state.sectionValues[sectionId]?.[key] ?? "";
    const proj = { ...(state.prdDrafts[pid] ?? {}) };
    const sec = { ...(proj[sectionId] ?? {}) };

    if (value === saved) delete sec[key];
    else sec[key] = value;

    if (Object.keys(sec).length) proj[sectionId] = sec;
    else delete proj[sectionId];

    const prdDrafts = { ...state.prdDrafts };
    if (Object.keys(proj).length) prdDrafts[pid] = proj;
    else delete prdDrafts[pid];

    state = { ...state, prdDrafts };
    emit();
  },

  /** 這個欄位現在該顯示什麼：有草稿用草稿，否則用已儲存的 */
  sectionFieldValue(sectionId: string, key: string): string {
    const pid = state.activeProjectId;
    const draft = pid ? state.prdDrafts[pid]?.[sectionId]?.[key] : undefined;
    return draft ?? state.sectionValues[sectionId]?.[key] ?? "";
  },

  /** 已儲存的值 —— 異動高亮的基準 */
  sectionFieldSaved(sectionId: string, key: string): string {
    return state.sectionValues[sectionId]?.[key] ?? "";
  },

  /** 有未儲存變更的章節 id */
  dirtySectionIds(): string[] {
    const pid = state.activeProjectId;
    return pid ? Object.keys(state.prdDrafts[pid] ?? {}) : [];
  },

  isSectionDirty(sectionId: string): boolean {
    const pid = state.activeProjectId;
    return Boolean(pid && state.prdDrafts[pid]?.[sectionId]);
  },

  hasUnsaved(): boolean {
    return this.dirtySectionIds().length > 0;
  },

  /** 把草稿寫進已儲存的正文。不給 sectionId 就存全部。 */
  saveSections(sectionId?: string): { ok: boolean; saved: number } {
    const pid = state.activeProjectId;
    if (!pid) return { ok: false, saved: 0 };
    const drafts = state.prdDrafts[pid] ?? {};
    const ids = sectionId ? (drafts[sectionId] ? [sectionId] : []) : Object.keys(drafts);
    if (!ids.length) return { ok: true, saved: 0 };

    const sectionValues = { ...state.sectionValues };
    for (const sid of ids) {
      sectionValues[sid] = { ...(sectionValues[sid] ?? {}), ...drafts[sid] };
    }
    const bag = { ...state.projectSectionValues, [pid]: sectionValues };

    const nextDrafts = { ...drafts };
    for (const sid of ids) delete nextDrafts[sid];
    const prdDrafts = { ...state.prdDrafts };
    if (Object.keys(nextDrafts).length) prdDrafts[pid] = nextDrafts;
    else delete prdDrafts[pid];

    state = { ...state, sectionValues, projectSectionValues: bag, prdDrafts };
    touchProjectMeta(pid);
    emit();
    return { ok: true, saved: ids.length };
  },

  /** 丟掉草稿，回到已儲存的內容。不給 sectionId 就丟全部。 */
  discardDrafts(sectionId?: string): number {
    const pid = state.activeProjectId;
    if (!pid) return 0;
    const drafts = state.prdDrafts[pid] ?? {};
    const ids = sectionId ? (drafts[sectionId] ? [sectionId] : []) : Object.keys(drafts);
    if (!ids.length) return 0;
    const next = { ...drafts };
    for (const sid of ids) delete next[sid];
    const prdDrafts = { ...state.prdDrafts };
    if (Object.keys(next).length) prdDrafts[pid] = next;
    else delete prdDrafts[pid];
    state = { ...state, prdDrafts };
    emit();
    return ids.length;
  },

  // ── 版本線（送審 = commit，核准 = merge）─────────────────────

  prdVersionsOf(projectId?: string): PrdVersion[] {
    return state.prdVersions[projectId ?? state.activeProjectId] ?? [];
  },

  /** 最近一次核准合併的版本 —— 主線，也是「這一輪改了什麼」的比較基準 */
  prdBaseline(projectId?: string): PrdVersion | null {
    return pickBaseline(this.prdVersionsOf(projectId));
  },

  /**
   * 審閱中要看的那一份快照。
   *
   * 優先用個案綁定的 commit；沒有綁定（舊資料）才退回最新的一份。
   * 審閱頁的正文、diff 與核准合併都必須用同一個來源，否則使用者看到的、
   * 核准的、被合併的會是三份不同的東西。
   */
  prdReviewCommit(projectId?: string): PrdVersion | null {
    const pid = projectId ?? state.activeProjectId;
    const pinned = state.cases[pid]?.reviewCommitId;
    const versions = this.prdVersionsOf(pid);
    if (pinned) return versions.find((v) => v.id === pinned && v.kind === "commit") ?? null;
    return pickLatestCommit(versions);
  },

  /** 最近一次送審的快照 —— 審閱者看的就是這一份 */
  prdLatestCommit(projectId?: string): PrdVersion | null {
    return pickLatestCommit(this.prdVersionsOf(projectId));
  },

  /**
   * 送審 = commit：對整份 PRD 拍快照。
   *
   * 有未儲存的草稿就先擋下 —— 送出一份「跟你螢幕上看到的不一樣」的版本
   * 是最難察覺也最貴的錯誤。
   */
  commitForReview(message: string): { ok: boolean; reason?: string; version?: PrdVersion } {
    const pid = state.activeProjectId;
    if (!pid) return { ok: false, reason: "沒有選擇專案" };
    // 用同一支 canCommit —— 它的規則有測試釘住，但先前沒有被執行路徑呼叫，
    // 於是「跟主線零差異不可送審」只存在於測試與文件裡，實際按下去照樣送出。
    const baseline = this.prdBaseline(pid);
    const gate = canCommit({
      hasUnsaved: this.hasUnsaved(),
      // 沒有主線代表這是第一版，一律視為有差異
      changedFields: baseline ? changedFieldCount(baseline.docs, state.sectionValues) : 1,
    });
    if (!gate.ok) return { ok: false, reason: gate.reason };
    const u = state.currentUser;
    const version: PrdVersion = {
      id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      kind: "commit",
      at: nowIso(),
      byId: u.id,
      byName: u.name,
      message: message.trim(),
      docs: structuredClone(state.sectionValues),
    };
    state = {
      ...state,
      prdVersions: { ...state.prdVersions, [pid]: capVersions([version, ...(state.prdVersions[pid] ?? [])]) },
    };
    emit();
    return { ok: true, version };
  },

  /**
   * 核准 = merge：把最近一次送審的快照併進主線。
   *
   * 合併的是**那個 commit**，不是「現在的內容」—— 審閱者核准的是他看過的
   * 那一份。送審後又改的東西留在 working copy，等下一次送審。
   */
  mergeApproved(message = ""): { ok: boolean; reason?: string; version?: PrdVersion } {
    const pid = state.activeProjectId;
    if (!pid) return { ok: false, reason: "沒有選擇專案" };
    // 合併「這次審閱綁定的那一份」，不是「最新的那一份」。
    // 送審後又 commit 一次的話，最新的那份沒有人審過 —— 合併它等於把
    // 沒被看過的內容當成已核准，而畫面上不會有任何提示。
    const pinnedId = state.cases[pid]?.reviewCommitId ?? null;
    const versions = this.prdVersionsOf(pid);
    const commit = pinnedId
      ? (versions.find((v) => v.id === pinnedId && v.kind === "commit") ?? null)
      : pickLatestCommit(versions);
    if (!commit) {
      return {
        ok: false,
        reason: pinnedId
          ? "找不到這次審閱綁定的送審版本（可能已被清理）"
          : "還沒有送審過的版本可以合併",
      };
    }
    const u = state.currentUser;
    const version: PrdVersion = {
      id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      kind: "merge",
      at: nowIso(),
      byId: u.id,
      byName: u.name,
      message: message.trim() || `核准並合併 ${commit.id}`,
      docs: structuredClone(commit.docs),
    };
    state = {
      ...state,
      prdVersions: { ...state.prdVersions, [pid]: [version, ...(state.prdVersions[pid] ?? [])] },
    };
    emit();
    return { ok: true, version };
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

  /** 目前專案領域的 gate 規則（通用 + 領域）。呼叫端傳給 `evaluatePrdGates`。 */
  activeGateSpec(): GateSpec {
    return domainGates(domainOf(state.projects.find((p) => p.id === state.activeProjectId)));
  },

  /** 指定專案的 gate 規則。跨專案總覽要用這個，不能共用 active 的那份。 */
  gateSpecFor(projectId: string): GateSpec {
    return domainGates(domainOf(state.projects.find((p) => p.id === projectId)));
  },

  /**
   * 指定專案的章節。跨專案總覽算「幾章空白」時要用這個——
   * 不同領域章節數不同，拿 active 那份去算別的專案一定錯。
   */
  sectionsFor(projectId: string): Section[] {
    return sectionsForProject(
      state.projects.find((p) => p.id === projectId),
      state.projectSectionMeta,
    );
  },

  /**
   * 自訂領域包被重新掃描後叫這支：重讀註冊表並依新的領域重算目前章節。
   * 不動任何正文——包被移除時，原本屬於它的章節內容變成孤兒，不刪。
   */
  refreshDomainPacks() {
    reloadUserPacks();
    state = {
      ...state,
      sections: sectionsForProject(
        state.projects.find((p) => p.id === state.activeProjectId),
        state.projectSectionMeta,
      ),
    };
    emit();
  },

  /** 目前專案的領域 prompt（base + 領域），供 AI 助教與草稿生成疊在最前面 */
  activeDomainPrompt(): string {
    const name = domainOf(state.projects.find((p) => p.id === state.activeProjectId));
    try {
      return resolveDomain(name, domainPacks(), { sections: SEED_SECTIONS, gates: BASE_GATE_SPEC }).prompt;
    } catch {
      return "";
    }
  },

  /**
   * 換領域。章節骨架跟著換，但**不刪任何正文**——不屬於新領域的章節內容
   * 留在 `projectSectionValues` 裡變成孤兒。「寫到一半發現選錯領域」比
   * 「鎖死不給改」常見得多，而靜默刪掉使用者寫過的字是不可原諒的那種錯。
   */
  setProjectDomain(projectId: string, domain: string): { ok: boolean; reason?: string } {
    if (!domainPacks()[domain]) return { ok: false, reason: `找不到領域「${domain}」` };
    const projects = state.projects.map((p) => (p.id === projectId ? { ...p, domain } : p));
    const metaBag =
      projectId === state.activeProjectId
        ? { ...state.projectSectionMeta, [projectId]: metaFromSections(state.sections) }
        : state.projectSectionMeta;
    state = {
      ...state,
      projects,
      projectSectionMeta: metaBag,
      sections:
        projectId === state.activeProjectId
          ? sectionsForProject(
              projects.find((p) => p.id === projectId),
              metaBag,
            )
          : state.sections,
    };
    emit();
    return { ok: true };
  },

  /** 目前專案有正文、但不屬於目前領域的章節 id（UI 用來提示孤兒內容） */
  orphanSectionIds(): string[] {
    return orphanSectionIds(state.sections, state.sectionValues);
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

    // 用留言自己的專案，不是硬編的 p1。
    //
    // 原本這裡是 `projects.find(p => p.id === "p1") ?? projects[0]` —— 因為
    // Comment 當時沒有 projectId，判不出這則留言屬於誰。後果是自審檢查會拿
    // **別的專案**的作者去比對：在自己的專案上該擋的沒擋，在別人的專案上
    // 反而可能被誤擋。兩種都不會有任何錯誤訊息，只會靜靜地判錯。
    const project = projectOfComment(comment, state.projects);
    const check = canResolveComment({
      user: state.currentUser,
      project,
      hasPeerReview: canPeerReview(state.currentUser, project).ok,
      hasApprove: canApproveProject(state.currentUser, project).ok,
    });
    if (!check.ok) return check;
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

    // 1) 快照目前專案的正文與章節標記
    const bag = snapshotActiveDocs(state);
    const metaBag = {
      ...state.projectSectionMeta,
      ...(state.activeProjectId ? { [state.activeProjectId]: metaFromSections(state.sections) } : {}),
    };
    // 2) 依目標專案的領域重算章節骨架，再疊回它自己的標記
    const nextSections = sectionsForProject(
      state.projects.find((p) => p.id === id),
      metaBag,
    );
    // 3) 載入目標專案正文（無則依新骨架給空白）
    const nextDocs = bag[id] ?? blankDocsForSections(nextSections);
    bag[id] = nextDocs;

    state = {
      ...state,
      activeProjectId: id,
      sections: nextSections,
      sectionValues: structuredClone(nextDocs),
      projectSectionValues: bag,
      projectSectionMeta: metaBag,
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

  approveAndLock(): { ok: boolean; reason?: string; allDone?: boolean } {
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
    const allDone = allStagesSettled(nextStages);
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
    return { ok: true, allDone };
  },

  submitForReview(projectId?: string, commitId?: string) {
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
          // 綁定這次審閱要看／要合併的那一份快照
          reviewCommitId: commitId ?? c.reviewCommitId ?? null,
          // 換了一份新快照就要重新簽。
          // 沿用舊簽核等於把「工程看過 V1」當成「工程看過 V2」—— 簽核軌跡
          // 會顯示已過關，但那一關的人根本沒看過現在要合併的內容。
          stages: stagesAfterResubmit(c.stages, c.reviewCommitId ?? null, commitId ?? null),
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
    const merged = {
      ...seedState(),
      ...newState,
      settings: { ...DEFAULT_SETTINGS, ...(newState.settings ?? {}) },
    };
    // 匯入的備份可能是 Comment 還沒有 projectId 的年代產生的。
    // 載入路徑有跑 migration，匯入路徑原本沒有 —— 於是舊備份匯進來之後
    // 所有留言都被專案過濾掉，看起來像是留言全部消失。
    state = {
      ...merged,
      comments: migrateComments(merged.comments ?? [], merged.activeProjectId ?? ""),
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
                projectId: job.projectId,
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

/**
 * 開 App 時對齊自訂領域包資料夾。
 *
 * 預設關（見 `UserDomainCache.autoRescan`），開了才會走這一段。放在這裡而不是
 * 每個頁面各叫一次：漏掉一個頁面的症狀是「在那一頁看不到新加的領域」，
 * 那種不一致比多一次磁碟走訪難查得多。
 *
 * 非同步且吞掉錯誤：領域包資料夾被移走、外接碟沒掛，都不該讓 App 開不起來。
 */
void autoRescanUserDomains()
  .then((changed) => {
    if (changed) store.refreshDomainPacks();
  })
  .catch(() => {
    /* 掃不到就用快取，這不是錯誤 */
  });
