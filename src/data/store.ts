import {
  APP_VARIANT,
  buildSeedCase,
  DEFAULT_SETTINGS,
  SEED_APPROVALS,
  SEED_COMMENTS,
  SEED_EMPLOYEES,
  SEED_PROJECTS,
  SEED_SECTIONS,
  SEED_TEMPLATES,
  SEED_WORKFLOW,
} from "./seed";
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
  Section,
  Session,
  Template,
  WorkflowStageDef,
} from "./types";
import { emptySectionValues } from "../lib/export";
import {
  canApproveProject,
  canPeerReview,
  normalizeAgentFamily,
  validateEmployeeRole,
} from "../lib/permissions";

/** v5：依建置變體分 key，避免正式／測試 App 共用 localStorage 互相污染 */
const KEY = `specforge:state:v5:${APP_VARIANT}`;
const LEGACY_KEY = "specforge:state:v4";
const SESSION_KEY = "specforge:session:v1";

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
  const sections = structuredClone(SEED_SECTIONS);
  const employees = structuredClone(SEED_EMPLOYEES);
  const current = employees.find((e) => e.isCurrent) ?? employees[0];
  const projects = structuredClone(SEED_PROJECTS);
  const cases: Record<string, CaseRecord> = {};
  for (const p of projects) {
    if (p.status === "review" || p.status === "approved") {
      cases[p.id] = buildSeedCase(p.id, employees);
    }
  }
  if (!cases.p1) cases.p1 = buildSeedCase("p1", employees);
  return {
    projects,
    sections,
    sectionValues: valuesFromSections(sections),
    sampleSectionValues: null,
    comments: structuredClone(SEED_COMMENTS),
    approvals: approvalsFromCase(cases.p1),
    workflowStages: structuredClone(SEED_WORKFLOW),
    cases,
    activeProjectId: "p1",
    templates: structuredClone(SEED_TEMPLATES),
    employees,
    currentUser: current,
    session: null,
    locked: false,
    pendingInsert: null,
    activeSectionId: "summary",
    settings: structuredClone(DEFAULT_SETTINGS),
    showSamples: true,
    agentJobs: [],
  };
}

function migrateProject(raw: Record<string, unknown>, employees: Employee[]): Project {
  const owner = String(raw.owner ?? "未知");
  const match = employees.find((e) => e.name === owner);
  return {
    id: String(raw.id ?? `p_${Date.now()}`),
    title: String(raw.title ?? "未命名"),
    status: (raw.status as Project["status"]) || "draft",
    pct: Number(raw.pct ?? 0),
    owner,
    ownerId: String(raw.ownerId ?? match?.id ?? ""),
    authorId: String(raw.authorId ?? raw.ownerId ?? match?.id ?? ""),
    authorAgentFamily: (raw.authorAgentFamily as AgentFamily | null) ?? match?.agentFamily ?? null,
    mine: Boolean(raw.mine),
    updated: String(raw.updated ?? ""),
    tag: String(raw.tag ?? "product"),
    isSample: raw.isSample === false ? false : Boolean(raw.isSample ?? true),
  };
}

function load(): AppState {
  try {
    let raw = localStorage.getItem(KEY);
    if (!raw) raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw) as Partial<AppState> & { employees?: unknown[] };
    const base = seedState();
    // v4：強制使用新人員名單（Scott + Agents），避免舊假資料殘留
    const employees = structuredClone(SEED_EMPLOYEES);
    const projects = Array.isArray(parsed.projects)
      ? parsed.projects.map((p) => migrateProject(p as unknown as Record<string, unknown>, employees))
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

    // session 若指到已移除的舊帳號，回退 Scott
    const sessionUser = session ? employees.find((e) => e.id === session!.userId) : null;
    const currentUser = sessionUser ?? employees.find((e) => e.id === "scott") ?? employees[0]!;
    if (!sessionUser) {
      session = null;
    }

    const workflowStages =
      Array.isArray(parsed.workflowStages) && parsed.workflowStages.length
        ? (parsed.workflowStages as WorkflowStageDef[])
        : base.workflowStages;
    const cases: Record<string, CaseRecord> = {
      ...base.cases,
      ...(parsed.cases ?? {}),
    };
    if (!cases.p1) cases.p1 = buildSeedCase("p1", employees);
    const activeProjectId = parsed.activeProjectId ?? "p1";
    const activeCase = cases[activeProjectId] ?? cases.p1;

    return {
      ...base,
      ...parsed,
      projects,
      sections: parsed.sections ?? base.sections,
      sectionValues: parsed.sectionValues ?? base.sectionValues,
      sampleSectionValues: parsed.sampleSectionValues ?? null,
      comments: parsed.comments ?? base.comments,
      approvals: approvalsFromCase(activeCase) ?? parsed.approvals ?? base.approvals,
      workflowStages,
      cases,
      activeProjectId,
      templates: parsed.templates ?? base.templates,
      employees,
      currentUser,
      session,
      locked: activeCase?.locked ?? parsed.locked ?? false,
      settings: { ...base.settings, ...(parsed.settings ?? {}) },
      showSamples: parsed.showSamples !== false,
      agentJobs: Array.isArray(parsed.agentJobs) ? (parsed.agentJobs as AgentJob[]) : [],
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

  setProjects(projects: Project[]) {
    state = { ...state, projects };
    emit();
  },

  addProject(p: Project) {
    state = { ...state, projects: [p, ...state.projects] };
    emit();
  },

  deleteProject(id: string): { ok: boolean; reason?: string } {
    const user = state.currentUser;
    if (user.accessRole !== "admin" && user.accessRole !== "editor") {
      return { ok: false, reason: "僅編輯人員或管理員可移除專案" };
    }
    state = { ...state, projects: state.projects.filter((p) => p.id !== id) };
    emit();
    return { ok: true };
  },

  setSectionValues(sectionId: string, values: Record<string, string>) {
    state = {
      ...state,
      sectionValues: {
        ...state.sectionValues,
        [sectionId]: { ...state.sectionValues[sectionId], ...values },
      },
    };
    emit();
  },

  setSectionField(sectionId: string, key: string, value: string) {
    const cur = state.sectionValues[sectionId] ?? {};
    state = {
      ...state,
      sectionValues: {
        ...state.sectionValues,
        [sectionId]: { ...cur, [key]: value },
      },
    };
    emit();
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
    state = { ...state, activeProjectId: id };
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

  /**
   * 呼叫 Agent 進場作業（原型：佇列 → 執行 → 完成，並寫入留言／草稿痕跡）
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

    // 非同步模擬進場
    window.setTimeout(() => {
      const cur = state.agentJobs.find((j) => j.id === jobId);
      if (!cur || cur.status === "cancelled") return;
      state = {
        ...state,
        agentJobs: state.agentJobs.map((j) =>
          j.id === jobId ? { ...j, status: "running" as const } : j,
        ),
      };
      emit();
    }, 400);

    window.setTimeout(() => {
      const cur = state.agentJobs.find((j) => j.id === jobId);
      if (!cur || cur.status === "cancelled") return;
      const promptHint = (agent.agentPrompt || "").slice(0, 120);
      const roleHint = (agent.agentRoleBrief || agent.title).slice(0, 80);
      let result = "";
      if (opts.task === "edit" || opts.task === "coach") {
        result = `【${agent.name}】已依 role／prompt 完成「${opts.task}」進場。\nRole: ${roleHint}\nPrompt 摘要: ${promptHint || "（未設定）"}\n建議：請至編輯工作台檢視章節補強。`;
        // 在開放問題章節留下痕跡
        const open = state.sectionValues["open"] ?? {};
        const prev = open.oq ?? "";
        const line = `\n• [Agent ${agent.name} · ${opts.task}] ${opts.note || "自動補強建議"} — 剛剛`;
        state = {
          ...state,
          sectionValues: {
            ...state.sectionValues,
            open: { ...open, oq: (prev + line).trim() },
          },
        };
      } else if (opts.task === "approve") {
        result = `【${agent.name}】簽核進場完成。已依核准 prompt 檢視「${project.title}」。`;
        // 標記自己的關卡
        const c = state.cases[project.id];
        if (c) {
          const stages = c.stages.map((s) =>
            s.assigneeId === agent.id && s.state !== "approved"
              ? {
                  ...s,
                  state: "approved" as const,
                  assigneeName: `${agent.name} · 已簽`,
                }
              : s,
          );
          state = {
            ...state,
            cases: { ...state.cases, [project.id]: { ...c, stages } },
          };
          if (project.id === state.activeProjectId) syncApprovalsFromActiveCase();
        }
      } else {
        result = `【${agent.name}】覆核進場完成，已留下審閱意見。`;
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
              body: opts.note || `依 role 完成覆核：${roleHint}`,
              resolved: false,
            },
            ...state.comments,
          ],
        };
      }

      state = {
        ...state,
        agentJobs: state.agentJobs.map((j) =>
          j.id === jobId
            ? {
                ...j,
                status: "done" as const,
                result,
                finishedAt: new Date().toISOString(),
              }
            : j,
        ),
      };
      emit();
    }, 1600);

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
