import {
  APP_VARIANT,
  blankSections,
  buildSeedCase,
  buildStarterAgents,
  CUSTOM_SECTION_ID,
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
  SEED_WORKFLOW_SKELETONS,
  TEST_CASE_DOCS,
  withCustomSection,
} from "./seed";
import { draftRelease, validateVersion, type Release, type ReleaseItem, type ReleaseLevelId, type VersionPolicy, policyOf } from "../lib/release";
import { normalizeShortCode } from "../lib/function-wishlist";
import { canAddItem } from "../lib/release-track";
import { logEvent } from "../lib/event-writer";
import { isNative, native } from "../lib/native";
import type {
  ActorKind,
  AgentBackend,
  AgentFamily,
  AgentJob,
  AgentTaskType,
  AISettings,
  AppState,
  Approval,
  CaseDecision,
  CaseRecord,
  CaseStage,
  Comment,
  Employee,
  FullCat,
  PrdVersion,
  Project,
  ProjectImportSummary,
  Section,
  Session,
  Template,
  WorkflowStageDef,
} from "./types";
import { FULL_CATS, jobLanded, pendingAgentJobsOf, resolveEditTarget, stageKind } from "./types";
import { buildProjectProfile, emptySectionValues } from "../lib/export";
import {
  allStagesSettled,
  canCommit,
  type CommitBlockCode,
  capVersions,
  changedFieldCount,
  pickBaseline,
  isNewRound,
  pickLatestCommit,
  stagesAfterResubmit,
} from "../lib/prd-versions";
import { canResolveComment, migrateComments, projectOfComment } from "../lib/comment-scope";
import { canEditContent } from "../lib/permissions";
import {
  appendInto,
  findOrphans,
  visibleValues,
  withoutField,
  type OrphanEntry,
  type OrphanRef,
} from "../lib/orphan-content";
import { applyMeta, metaFromSections, orphanSectionIds, pickDomain } from "../lib/section-meta";
import { DEFAULT_DOMAIN, domainPacks, reloadUserPacks } from "./domains";
import { autoRescanUserDomains } from "../lib/user-domains";
import { resolveDomain } from "../lib/domain-pack";
import {
  migrateAiWriting,
  resolveWriting,
  setField,
  setInherit,
  setSectionPrompt,
  type InheritableField,
  type ResolvedWriting,
} from "../lib/ai-writing-config";
import {
  backendIdError,
  backendUsers,
  DEFAULT_BACKEND_ID,
  isCliTool,
  listBackends,
  migrateBackends,
  resolveBackend,
  withMigratedBackends,
  type BackendPatch,
} from "../lib/agent-backend";
import { BASE_GATE_SPEC } from "../lib/prd-gates";
import type { GateSpec } from "../lib/gate-rules";
import type { ProjectCandidate } from "../lib/folder-import";
import { mapCandidateToSectionValues } from "../lib/folder-import";
import {
  canApprove,
  canPeerReview,
  normalizeAgentFamily,
  validateEmployeeRole,
} from "../lib/permissions";
import {
  canSignStage,
  caseHasRun,
  normalizeStageAssignee,
  separationOfDuties,
  stageAssignment,
  stagesFromWorkflow,
} from "../lib/signoff";
import { hasHumanApproval, resolveWorkflow } from "../lib/workflow-resolve";
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
  // 「XX 自訂章節」在這裡追加，不在 resolveDomain 裡：領域包會在 base 後面補
  // 自己的章節，先追加就會被擠到中間、編號也錯。兩條路徑都要包，退路漏掉的
  // 症狀是「領域包寫壞之後範本插入無處可去」。
  try {
    return withCustomSection(
      resolveDomain(domain, domainPacks(), {
        sections: SEED_SECTIONS,
        gates: BASE_GATE_SPEC,
      }).sections,
    );
  } catch {
    // 領域包寫壞不該讓整個 App 開不起來——退回通用 7 章，使用者至少還能工作
    return withCustomSection(SEED_SECTIONS);
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

/**
 * 「這個案子還沒送出審閱」—— 簽核類動作共用的擋詞。
 *
 * 建專案時就會先開一個個案（走建立當下的**全域**流程），所以草稿專案也有關卡
 * 可以按。在那上面留下痕跡的代價不是白做工，是**永久的**：送審看到痕跡就不重建
 * 個案，那套全域關卡於是被寫進 `project.workflowStages`，而 `p.workflowStages ?? landed`
 * 落地過就不再覆寫 —— 範本骨架與領域包的合規關卡從此不會出現，重新套範本也救不回來。
 */
const NOT_SUBMITTED = "這個案子還沒送出審閱";

/** 領域包宣告的追加關卡。領域包壞掉時退回「不追加」，不讓整條送審路徑爆掉 */
function domainStages(domain: string): WorkflowStageDef[] {
  try {
    return resolveDomain(domain, domainPacks(), {
      sections: SEED_SECTIONS,
      gates: BASE_GATE_SPEC,
    }).stages;
  } catch {
    return [];
  }
}

/**
 * 五類骨架**目前生效的那一份** —— 管理中心的覆寫優先，沒改過的走種子。
 *
 * 為什麼每次呼叫都重算而不是快取：覆寫住在 `state` 裡，而 `state` 每次異動都是
 * 一個新物件。快取一份的話，使用者在管理中心改完骨架、下一個專案送審跑的還是
 * 舊的 —— 而畫面上那份改好的骨架看起來完全正常。
 *
 * 空陣列的覆寫視同「沒有覆寫」：`setWorkflowSkeleton` 本來就擋掉空陣列，這裡
 * 是第二道 —— localStorage 是使用者改得到的，而一個空骨架會讓那一類的專案
 * 送審之後得到一個零關卡的流程，`allStagesSettled` 對零關卡回 false，案子
 * 永遠結不了。
 */
function liveSkeletons(): Record<FullCat, WorkflowStageDef[]> {
  const over = state.workflowSkeletons ?? {};
  const out = {} as Record<FullCat, WorkflowStageDef[]>;
  for (const cat of FULL_CATS) {
    const custom = over[cat];
    const src = custom?.length ? custom : SEED_WORKFLOW_SKELETONS[cat];
    // 複製一份：`resolveWorkflow` 的結果會被寫進 `project.workflowStages` 再繼續改，
    // 共用參考的話改一個專案會動到 state 裡的骨架本身
    out[cat] = src.map((s) => ({ ...s }));
  }
  return out;
}

/**
 * 這個專案**應該**跑哪一套流程 —— 範本分類給骨架，領域包疊加合規關卡。
 *
 * 純粹是算出來的，不看專案上已經落地的那一份。要拿「這個案子實際在跑的流程」
 * 請用 `workflowFor()`。
 *
 * 骨架來源一律走 `liveSkeletons()`，**不是直接讀 `SEED_WORKFLOW_SKELETONS`** ——
 * 直接讀種子的話，管理中心那整塊骨架編輯 UI 就是一個改了不生效的表單：存得進去、
 * 重新載入還在、送審卻完全不理它。`resolveWorkflow` 的第三個參數就是為此留的。
 */
function resolveWorkflowFor(p: Project | undefined): WorkflowStageDef[] {
  const skeleton = p?.templateStages?.length ? p.templateStages : undefined;
  const stages = domainStages(domainOf(p));
  // 自訂範本自帶骨架時，它就是骨架本身，不再依 cat 查表 ——
  // 也不理管理中心的五類覆寫：那份骨架是這個範本自己宣告的
  if (skeleton) {
    return resolveWorkflow(p?.templateCat ?? null, stages, {
      lean: skeleton,
      narrative: skeleton,
      enterprise: skeleton,
      agile: skeleton,
      technical: skeleton,
    });
  }
  return resolveWorkflow(p?.templateCat ?? null, stages, liveSkeletons());
}

/**
 * 這個案子**實際在跑**的流程。
 *
 * 落地過的專案一律用自己那一份 —— 這是 D2 的整個重點：第一次送審之後改範本
 * 不影響進行中的案子。`signoffTimeline` 靠 stageId 跨輪串接決策，重解析出來的
 * 關卡 id 會隨範本／領域包變動，一變第一輪的意見就顯示「（已移除的關卡）」。
 *
 * 沒落地過的（舊資料、還沒送過審）退回全域 `workflowStages` —— 那是這個欄位
 * 出現之前唯一存在的流程，跑到一半的案子不能因為升級就換一套關卡。
 * 注意判斷的是 `undefined` 而不是長度：空陣列是「這個專案的流程真的沒有關卡」。
 */
function workflowFor(p: Project | undefined): WorkflowStageDef[] {
  return p?.workflowStages ?? state.workflowStages;
}

/**
 * 「這一次送審會不會建立關卡、會建哪幾關」—— `submitForReview` 與送審對話框
 * **共用的同一段判斷**。
 *
 * 為什麼一定要共用：UI 要先問「每一關派給誰」，而 `assignments` 只在
 * `caseFromWorkflow` 那一次生效。UI 自己重寫一份「這次會不會落地」的判斷，
 * 兩份就會分岔 —— 而分岔的症狀是「對話框問了指派，送審卻沒套用」：
 * 沒有錯誤訊息，關卡全部顯示「待指派」，看起來像使用者自己沒選。
 *
 * `landsNow` ⇔ `!caseHasRun(live)` ⇔ 這次會走 `caseFromWorkflow`。
 */
function submitPlanFor(id: string): { landsNow: boolean; stages: WorkflowStageDef[] } {
  const project = state.projects.find((p) => p.id === id);
  const existing = state.cases[id];
  const live = existing && !existing.withdrawn ? existing : undefined;

  // 建專案時就會先開一個個案（走全域預設流程），所以「有個案」不等於
  // 「這個案子跑過」。判準收在 `caseHasRun` —— 它問的是流程狀態上有沒有進展，
  // 不是「有沒有人在上面留下字」。差別很要緊：判成 true 就會把舊個案的關卡
  // 永久寫進 `project.workflowStages`，之後重新套範本也救不回來。
  const touched = caseHasRun(live);

  const stages = project?.workflowStages
    ? // 落地過的一律沿用自己那一份 —— 連「範本換了類別」都不重算。
      // D2 拍板的取捨：紀錄的連續性比流程的即時性重要
      project.workflowStages
    : touched
      ? // 舊資料：跑到一半、但還沒有落地欄位的案子。**用它自己的關卡當流程**，
        // 不要重解析 —— 重解析會換掉 stageId，第一輪的意見在紀錄上就變成
        // 「（已移除的關卡）」。升級不能讓跑到一半的案子壞掉。
        workflowFromCase(live!)
      : resolveWorkflowFor(project);

  return { landsNow: !touched, stages };
}

/**
 * 依專案**當下在跑的**流程建個案。
 *
 * 所有重建個案的路徑都走這裡，不再各自讀全域 `state.workflowStages` ——
 * 那正是「改 A 專案的流程、B 專案下次送審也跟著變」的來源。
 */
/**
 * 從一個跑到一半的個案反推流程定義。
 *
 * 只在移轉時用得到：`Project.workflowStages` 出現之前送出去的案子沒有落地流程，
 * 而重解析會換掉 stageId。反推出來的定義保留原本的 id，紀錄才接得起來。
 *
 * `defaultActor` 推不出來（個案上沒有這個資訊），依指派對象是不是 agent 來猜；
 * 沒指派的猜 agent —— 這個欄位只影響 Wave 2 送審對話框的預設選項，猜錯的代價
 * 是使用者要多改一次下拉選單，不是流程跑錯。
 */
function workflowFromCase(c: CaseRecord): WorkflowStageDef[] {
  const byId = Object.fromEntries(state.employees.map((e) => [e.id, e]));
  return [...c.stages]
    .sort((a, b) => a.order - b.order)
    .map((s, i) => ({
      id: s.stageDefId || s.id,
      order: i + 1,
      name: s.name,
      defaultAssigneeId: s.assigneeId ?? null,
      required: s.required ?? true,
      mode: s.mode ?? "parallel",
      kind: stageKind(s),
      defaultActor: (s.assigneeId && byId[s.assigneeId]?.kind === "human" ? "human" : "agent") as ActorKind,
      ...(s.editTarget ? { editTarget: { ...s.editTarget } } : {}),
    }));
}

function caseForProject(projectId: string): CaseRecord {
  const p = state.projects.find((x) => x.id === projectId);
  return caseFromWorkflow(projectId, workflowFor(p), state.employees);
}

/** 把改好的骨架寫回「這個專案自己的結構」，並重算目前畫面的章節 */
function applyStructure(projectId: string, sections: Section[]): { ok: boolean } {
  const overrides = { ...(state.projectSections ?? {}), [projectId]: sections.map((x) => ({ ...x })) };
  state = {
    ...state,
    projectSections: overrides,
    sections: projectId === state.activeProjectId ? withCustomFor(projectId, sections) : state.sections,
  };
  touchProjectMeta(projectId);
  emit();
  return { ok: true };
}

/**
 * 解析某專案當下該看到的 sections（骨架 + 該專案的標記）。
 *
 * 有專案自己的結構就用它，否則走領域包。順序不能反 —— 領域包優先的話，
 * 使用者手改的章節每次載入都會被蓋回去。
 */
function sectionsForProject(
  p: Project | undefined,
  metaBag: AppState["projectSectionMeta"],
  overrides?: AppState["projectSections"],
  noCustom?: AppState["projectNoCustom"],
): Section[] {
  const own = p ? overrides?.[p.id] : undefined;
  const raw = own?.length ? withCustomSection(own) : domainSections(domainOf(p));
  const skeleton = p && noCustom?.[p.id] ? raw.filter((x) => x.id !== CUSTOM_SECTION_ID) : raw;
  return applyMeta(skeleton, p ? metaBag[p.id] : undefined);
}

/**
 * 補上「自訂章節」，除非這個專案把它刪掉了。
 *
 * 每一條重算骨架的路徑都要走這裡。漏掉的那一條會讓被刪掉的自訂章節
 * 在某個操作之後**默默長回來** —— 使用者只會覺得「刪不掉」。
 */
function withCustomFor(projectId: string | undefined, sections: Section[]): Section[] {
  if (projectId && state.projectNoCustom?.[projectId]) {
    return sections.filter((x) => x.id !== CUSTOM_SECTION_ID);
  }
  return withCustomSection(sections);
}

/**
 * 刪掉「自訂章節」。正文一併刪 —— 跟刪其他章節同一條規則。
 *
 * 骨架（projectSections）不用動：那一節本來就不在裡面。
 */
function removeCustomSection(pid: string): { ok: boolean; reason?: string } {
  const shown = sectionsForProject(
    state.projects.find((p) => p.id === pid),
    state.projectSectionMeta,
    state.projectSections,
    state.projectNoCustom,
  );
  if (!shown.some((x) => x.id === CUSTOM_SECTION_ID)) return { ok: false, reason: "這個專案已經沒有自訂章節了" };
  if (shown.length <= 1) return { ok: false, reason: "至少要留一節" };

  const docs = { ...(state.projectSectionValues[pid] ?? {}) };
  delete docs[CUSTOM_SECTION_ID];
  const drafts = { ...(state.prdDrafts[pid] ?? {}) };
  delete drafts[CUSTOM_SECTION_ID];
  // 不走 applyStructure：那會順手把骨架釘進 projectSections，等於因為刪了一節
  // 就讓這個專案脫離領域包（之後領域包更新它收不到）。這裡只多一個旗標。
  const noCustom = { ...(state.projectNoCustom ?? {}), [pid]: true };
  state = {
    ...state,
    projectNoCustom: noCustom,
    projectSectionValues: { ...state.projectSectionValues, [pid]: docs },
    prdDrafts: { ...state.prdDrafts, [pid]: drafts },
    ...(pid === state.activeProjectId ? { sectionValues: docs } : {}),
    sections:
      pid === state.activeProjectId
        ? sectionsForProject(
            state.projects.find((p) => p.id === pid),
            state.projectSectionMeta,
            state.projectSections,
            noCustom,
          )
        : state.sections,
  };
  touchProjectMeta(pid);
  emit();
  return { ok: true };
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
    // 已停用的 Approval 只有三態；`skipped` 與 `changes_requested` 都沒有對應詞，
    // 前者退成「未指派」、後者退成「審閱中」—— 這個鏡像只餵舊的審閱頁，
    // 真相在 CaseStage
    state: s.state === "skipped" ? "empty" : s.state === "changes_requested" ? "pending" : s.state,
  }));
}

function caseFromWorkflow(
  projectId: string,
  workflow: WorkflowStageDef[],
  employees: Employee[],
  /** 逐關指派：`stageDefId → 執行者 id`。送審對話框選的東西 */
  assignments?: Record<string, string | null>,
): CaseRecord {
  // 關卡本身怎麼長出來搬進了 `lib/signoff.ts` 的 `stagesFromWorkflow` ——
  // 簽核頁送審前的預覽要畫「送審時真的會建立的那一份」，兩邊必須是同一支函式。
  // 在這裡留一份自己的迴圈，就是把「畫面說的跟實際跑的不是同一件事」重新種一次。
  const stages: CaseStage[] = stagesFromWorkflow(projectId, workflow, employees, assignments);
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

function seedState(): AppState {
  const isTest = APP_VARIANT === "test";
  const sections = withCustomSection(
    isTest ? structuredClone(SEED_SECTIONS) : blankSections(structuredClone(SEED_SECTIONS)),
  );
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
    activeOpenSpecChange: "",
    activeOpenSpecFile: "",
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

// export 是給測試用的：load() 只在模組第一次 import 時跑，測試檔共用進程
// 搶不到那個時機，只能直接對這個函式驗「存進去的欄位讀得回來」。
export function migrateProject(raw: Record<string, unknown>, employees: Employee[]): Project {
  const owner = String(raw.owner ?? "未知");
  const match = employees.find((e) => e.name === owner);
  return {
    id: String(raw.id ?? `p_${Date.now()}`),
    title: String(raw.title ?? "未命名"),
    customName: raw.customName ? String(raw.customName) : undefined,
    // 第四次：漏了這行，設過的簡寫重新載入就沒了，wishlist 取號會卡在「先設簡寫」。
    shortCode: normalizeShortCode(String(raw.shortCode ?? "")) ?? undefined,
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
    // 第三次踩同一個坑：漏了這行，改採 vX.YY.ZZ 每次重新載入就退回 loose，
    // 版號紀錄卡又重新問一次 —— 選擇「存了」但被這裡吃掉。
    versionPolicy: raw.versionPolicy === "strict" ? "strict" : undefined,
    // 第五、六、七次。同一個坑的註解上面已經寫了三遍，所以這裡只講後果：
    // 漏了 workflowStages，跑到一半的案子重新載入就退回全域流程，關卡 id 跟著
    // 變，第一輪的簽核意見在紀錄上變成「（已移除的關卡）」—— 而簽核紀錄
    // 正是這整套東西的賣點。漏了 templateCat 則是每次重載都退回 lean 骨架。
    // cast 換成 `sanitizeStageDefs`：這兩份都會被畫成 HTML（管理中心的落地流程
    // 檢視、送審指派對話框），而缺 `kind` 的元素會讓那一整頁停止 render
    workflowStages: sanitizeStageDefs(raw.workflowStages),
    templateCat: raw.templateCat ? (raw.templateCat as FullCat) : undefined,
    templateStages: sanitizeStageDefs(raw.templateStages),
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

/**
 * 收斂一份關卡定義的**形狀**（不是內容）。
 *
 * ## 為什麼需要這一支
 *
 * `WorkflowStageDef` 的 `kind` / `defaultActor` / `mode` 是聯合型別，而畫面上到處
 * 是 `STAGE_KIND_LABEL[s.kind]` 這種查表。缺值時查表回 `undefined`，下一步
 * `escapeHtml(undefined)` 就是 `undefined.replace` → TypeError → `renderLandedFlows`
 * 整支炸掉 → `render()` 中斷 → 掛在 `store.subscribe` 上的 `renderCases()` 從此
 * 每次狀態變動都再炸一次。**管理中心半殘，而且沒有任何錯誤訊息指向資料。**
 *
 * 型別謊報的來源有兩條，吃的是同一份資料：
 * - `load()`——localStorage 使用者改得到
 * - `importState()`——設定頁的「匯入工作區 JSON」。這一條**原本完全沒有收斂**，
 *   而 Wave 1 之前的匯出檔根本沒有 `kind` / `defaultActor` 這兩個欄位
 *
 * ## 為什麼是 spread 而不是逐欄位重建
 *
 * `migrateProject` 上面那串「第三、五、六、七次踩同一個坑」的註解講的就是逐欄位
 * 重建的代價：忘了列的欄位在重新載入時無聲消失。這裡只**覆寫**查表會用到的那幾個，
 * 其餘一律原樣帶過 —— 不認得的欄位不是我們的敵人，`undefined.replace` 才是。
 */
export function sanitizeStageDef(raw: unknown, index: number): WorkflowStageDef {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const order = Number(s.order);
  return {
    ...(s as unknown as WorkflowStageDef),
    id: String(s.id ?? `w_import_${index + 1}`),
    name: String(s.name ?? `關卡 ${index + 1}`),
    order: Number.isFinite(order) ? order : index + 1,
    // 退路選 review：假設「只出意見」比假設「會覆寫 PRD 內文」安全
    kind: s.kind === "edit" ? "edit" : "review",
    // 退路選 human：假設「要人做」比假設「機器會自己跑」安全
    defaultActor: s.defaultActor === "agent" ? "agent" : "human",
    // 退路選 parallel。`sequential` 會讓升級後跑到一半的案子突然多出順序閘門，
    // 第二關的人按不下去卻不知道為什麼（load() 的移轉註解已經寫過一次）
    mode: s.mode === "sequential" ? "sequential" : "parallel",
    required: s.required === false ? false : true,
    defaultAssigneeId: typeof s.defaultAssigneeId === "string" ? s.defaultAssigneeId : null,
  };
}

/** 見 `sanitizeStageDef`。空陣列回 `undefined` —— 對齊 `migrateProject` 的既有語意 */
export function sanitizeStageDefs(raw: unknown): WorkflowStageDef[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined;
  return raw.map((s, i) => sanitizeStageDef(s, i));
}

/**
 * 收斂存檔裡的骨架覆寫。回傳 `undefined` 代表「沒有任何覆寫」。
 *
 * 為什麼要驗：localStorage 是使用者改得到的，而這份資料直接決定送審會落地
 * 哪幾關。空陣列與不認得的分類都靜默丟掉 —— 前者會造出結不了案的專案，
 * 後者會在管理中心變成一份看得到、卻對不上任何一個編輯器的孤兒。
 */
function sanitizeSkeletons(
  raw: unknown,
): Partial<Record<FullCat, WorkflowStageDef[]>> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const src = raw as Record<string, unknown>;
  const out: Partial<Record<FullCat, WorkflowStageDef[]>> = {};
  for (const cat of FULL_CATS) {
    const v = src[cat];
    // 骨架吃的是同一種元素，收斂也要同一套 —— 兩條路各自 cast 的話，
    // 「管理中心炸掉」這條會從骨架編輯器那一邊原封不動地回來
    const stages = sanitizeStageDefs(v);
    if (stages) out[cat] = stages;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * 補齊個案：round 從 1 起算、log 給空陣列、關卡補 mode 與 required。
 * 舊個案沒有決策紀錄可以還原，紀錄從這一版之後才開始長。
 *
 * 抽成共用函式的理由跟 `sanitizeStageDefs` 同一條：`load()` 與 `importState()`
 * 吃的是同一份資料，而只有 `load()` 這一條補過。匯入一份舊備份之後
 * `st.required` 是 `undefined`，`allStagesSettled` 那一類判斷就跟著換一個答案。
 */
function normalizeCases(
  raw: unknown,
  workflowStages: readonly WorkflowStageDef[],
  /**
   * 收斂 `assigneeName` 用。舊存檔裡有一批被寫成「某某 · 已簽」的關卡，
   * 只修寫入端的話它們重新載入之後照樣同時顯示「已簽」與「待簽核」。
   */
  employees: readonly Employee[],
): Record<string, CaseRecord> {
  const defByStageId = Object.fromEntries(workflowStages.map((w) => [w.id, w]));
  return Object.fromEntries(
    Object.entries((raw ?? {}) as Record<string, CaseRecord>).map(([k, c]) => [
      k,
      {
        ...c,
        round: c.round ?? 1,
        log: Array.isArray(c.log) ? c.log : [],
        stages: (c.stages ?? []).map((st) =>
          normalizeStageAssignee(
            {
              ...st,
              mode: st.mode ?? defByStageId[st.stageDefId]?.mode ?? "parallel",
              required: st.required ?? defByStageId[st.stageDefId]?.required ?? true,
            },
            employees,
          ),
        ),
      },
    ]),
  );
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

    // 移轉：既有關卡一律補 `parallel`。**不能給 sequential** —— 那會讓升級後
    // 跑到一半的案子突然多出順序閘門，第二關的人按不下去卻不知道為什麼。
    const workflowStages = (
      Array.isArray(parsed.workflowStages) && parsed.workflowStages.length
        ? (parsed.workflowStages as WorkflowStageDef[])
        : base.workflowStages
    ).map((w) => ({ ...w, mode: w.mode ?? ("parallel" as const) }));

    const cases = normalizeCases(parsed.cases, workflowStages, employees);
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

    const projectSections = (parsed.projectSections as AppState["projectSections"]) ?? {};
    const sections = sectionsForProject(
      withDomain.find((p) => p.id === activeProjectId),
      projectSectionMeta,
      projectSections,
      parsed.projectNoCustom as AppState["projectNoCustom"],
    );

    return {
      ...base,
      ...parsed,
      projects: APP_VARIANT === "prod" ? withDomain.filter((p) => !p.isSample) : withDomain,
      sections,
      projectSections,
      projectSectionMeta,
      sectionValues: activeDocs,
      projectSectionValues,
      // 舊存檔沒有這兩個欄位 —— 補空的，不要讓 undefined 流進畫面
      prdDrafts: (parsed.prdDrafts as AppState["prdDrafts"] | undefined) ?? {},
      prdVersions: (parsed.prdVersions as AppState["prdVersions"] | undefined) ?? {},
      sampleSectionValues: parsed.sampleSectionValues ?? null,
      // 舊存檔沒有這兩個欄位。`...parsed` 不會蓋掉 base 的空字串（JSON 不帶
      // undefined），但型別上仍可能是 undefined —— 明寫一次比較誠實，也擋掉
      // 有人手動塞非字串進 localStorage 的情況。
      activeOpenSpecChange:
        typeof parsed.activeOpenSpecChange === "string" ? parsed.activeOpenSpecChange : "",
      activeOpenSpecFile:
        typeof parsed.activeOpenSpecFile === "string" ? parsed.activeOpenSpecFile : "",
      // 舊存檔的留言沒有 projectId。掛到當時的 active 專案 —— 那是唯一
      // 說得出口的猜測（留言本來就是在某個專案的審閱頁上寫的），而且
      // 不掛的話它們會變成孤兒：任何專案都看不到、也永遠無法標記已解決。
      comments: migrateComments(parsed.comments ?? base.comments, activeProjectId),
      approvals: activeCase
        ? approvalsFromCase(activeCase)
        : (parsed.approvals ?? base.approvals),
      workflowStages,
      // 骨架覆寫：只收真的是「非空陣列」的那幾類。`...parsed` 本來就會帶過來，
      // 這一行是為了擋掉手改過的 localStorage —— 一個 `{lean: []}` 會讓
      // lean 專案送審之後得到零關卡的流程，而那種案子永遠結不了案。
      // 認不得的分類一併丟掉，留著只會在管理中心變成一份看不到也刪不掉的資料。
      workflowSkeletons: sanitizeSkeletons(parsed.workflowSkeletons),
      cases,
      activeProjectId,
      templates: mergeTemplates(parsed.templates, base.templates),
      employees,
      currentUser,
      session,
      locked: activeCase?.locked ?? parsed.locked ?? false,
      // `withMigratedBackends` 收斂後端清單：手改過的 localStorage 會讓一筆
      // `kind:"cli", tool:"sh"` 直接變成清單裡的合法後端，而那個欄位最後會走到
      // 原生執行路徑。這裡丟掉認不得的形狀，不修補。
      settings: withMigratedBackends({
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
        // 撰寫設定經歷過兩次改版（頂層 → 角色 → 領域），淺合併會留下混種物件。
        // migrateAiWriting 認得三代格式，一律收斂成 byDomain。
        aiWriting: migrateAiWriting((parsed.settings as AISettings | undefined)?.aiWriting),
      }),
      showSamples: APP_VARIANT === "prod" ? false : parsed.showSamples !== false,
      // 舊工作單補 `landed`。跑完卻沒有這個欄位的，副作用在升級前就已經由
      // `invokeAgent` 直接寫進文件了 —— 不補的話 Wave 2 的「待確認」清單會把
      // 它們整批翻出來，而按下去是**第二次**落地（同一則留言貼兩遍）
      agentJobs: Array.isArray(parsed.agentJobs)
        ? (parsed.agentJobs as AgentJob[]).map((j) => ({ ...j, landed: jobLanded(j) }))
        : [],
      releases: Array.isArray(parsed.releases) ? (parsed.releases as Release[]) : [],
      onboardingComplete,
    };
  } catch {
    return seedState();
  }
}

/**
 * 這個專案還有幾份「跑完了、但人還沒拍板」的 Agent 分析。
 *
 * 篩選條件本身住在 `types.pendingAgentJobsOf`（純函式，headless 測得到每一條
 * 分支）。這裡只負責把 state 交給它 —— 條件寫在這支裡的話，簽核頁的攔截
 * 對話框就得再寫一份，而兩份分岔的症狀是「對話框說沒有待辦，按下去卻還是被擋」。
 */
function pendingJobsFor(projectId: string): AgentJob[] {
  return pendingAgentJobsOf(state.agentJobs, projectId);
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

/**
 * `project.json` 自動同步——名稱／簡寫／版號政策／描述／標籤／資料夾綁定
 * 這些欄位一變就順手重寫一次，不必使用者記得手動按「匯出 Profile」。
 *
 * 只在桌面殼裡動作：瀏覽器版沒有真正的資料夾可以寫，`native.writeExport`
 * 在那裡會退成瀏覽器下載——自動觸發的下載對使用者是意外，不是幫忙。
 * 沒有 rootPath 一樣跳過，理由與 `audit()` 相同。
 */
function syncProfile(state: AppState, projectId: string): void {
  if (!isNative()) return;
  try {
    const p = state.projects.find((x) => x.id === projectId);
    const root = p?.importSummary?.rootPath;
    if (!p || !root) return;
    void native.writeExport(root, "project.json", JSON.stringify(buildProjectProfile(p), null, 2));
  } catch {
    /* 同步失敗不影響業務動作 */
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
    syncProfile(state, projectId);
  },

  setProjects(projects: Project[]) {
    state = { ...state, projects };
    emit();
  },

  addProject(p: Project) {
    const bag = snapshotActiveDocs(state);
    // 空白正文袋要照**新專案自己的領域**算，不是照當下開著的那個專案。
    // 拿錯來源時症狀很輕（缺 key 會 `?? {}`），所以會一路錯下去不被發現。
    if (!bag[p.id]) bag[p.id] = blankDocsForSections(sectionsForProject(p, state.projectSectionMeta, state.projectSections, state.projectNoCustom));
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
            [id]: caseForProject(id),
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
    for (const id of ids) syncProfile(state, id);
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
  // ── AI 撰寫設定（依領域包） ─────────────────────────────────

  /** 這個領域實際生效的撰寫設定（自訂值疊在通用值上） */
  writingFor(domain: string): ResolvedWriting {
    return resolveWriting(state.settings.aiWriting.byDomain, domain);
  },

  /** 目前作用中專案所屬領域的撰寫設定 —— 產生 prompt 時用這個 */
  activeWriting(): ResolvedWriting {
    return this.writingFor(domainOf(state.projects.find((p) => p.id === state.activeProjectId)));
  },

  /** 某領域下該有哪些章節（領域包會追加章節，設定頁要照著列） */
  sectionsForDomain(domain: string): Section[] {
    return domainSections(domain);
  },

  /** 切換某欄位／章節是否沿用通用（key 見 ai-writing-config） */
  setDomainInherit(domain: string, key: string, on: boolean) {
    const aw = state.settings.aiWriting;
    state = {
      ...state,
      settings: {
        ...state.settings,
        aiWriting: { ...aw, byDomain: setInherit(aw.byDomain, domain, key, on) },
      },
    };
    emit();
  },

  /** 寫入某領域的自訂值 */
  setDomainWriteField(domain: string, field: InheritableField, value: string) {
    const aw = state.settings.aiWriting;
    state = {
      ...state,
      settings: {
        ...state.settings,
        aiWriting: { ...aw, byDomain: setField(aw.byDomain, domain, field, value) },
      },
    };
    emit();
  },

  /** 寫入某章節的提示詞 */
  setDomainSectionPrompt(domain: string, sectionId: string, value: string) {
    const aw = state.settings.aiWriting;
    state = {
      ...state,
      settings: {
        ...state.settings,
        aiWriting: {
          ...aw,
          byDomain: setSectionPrompt(aw.byDomain, domain, sectionId, value),
        },
      },
    };
    emit();
  },

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
   * 送審前的**唯讀**預檢 —— 「現在按下去，送得出去嗎」。不寫任何 state。
   *
   * ## 為什麼需要它
   *
   * 指派對話框開在 commit **之前**（放之後的話，使用者一按取消就留下一個
   * 沒人要的版本快照）。於是「有沒有東西可送」若只留在 `commitForReview`，
   * 使用者會**先逐關選完人、按下送出，才被告知根本沒東西可送** —— 整段白做。
   * Scott 2026-08-26 實測撞到的就是這個。
   *
   * ## 這裡**不重寫規則**
   *
   * 跟 `commitForReview` 走同一支 `canCommit`、同一份 baseline、同一個
   * `hasUnsaved`。這個 repo 已經因為「UI 自己再算一份」吃過兩次虧
   * （`submitPlan` 抽出來就是為了防這件事）。兩份判斷分岔的症狀是
   * 「預檢說可以、真的送出卻被擋」或反過來 —— 兩種都很難查，因為畫面上
   * 兩邊各自都是對的。
   *
   * `commitForReview` 自己那道閘門**沒有被拿掉**：它直接呼叫這一支，
   * 所以它仍然是最後一道防線，不是只有 UI 在擋。
   *
   * ## 成本注意
   *
   * `changedFieldCount` 會逐欄位跑行級 diff。`renderCoach()` 每個按鍵都跑一次，
   * 所以呼叫端在有未儲存草稿時應該先用 `hasUnsaved()` 短路，不要每個按鍵都問。
   * **那是呼叫端的節流，不是另一份規則** —— 答案不會因此不同。
   */
  commitPrecheck(): {
    ok: boolean;
    code?: "no-project" | CommitBlockCode;
    reason?: string;
  } {
    const pid = state.activeProjectId;
    if (!pid) return { ok: false, code: "no-project", reason: "沒有選擇專案" };
    // 用同一支 canCommit —— 它的規則有測試釘住，但先前沒有被執行路徑呼叫，
    // 於是「跟主線零差異不可送審」只存在於測試與文件裡，實際按下去照樣送出。
    const baseline = this.prdBaseline(pid);
    const gate = canCommit({
      hasUnsaved: this.hasUnsaved(),
      // 沒有主線代表這是第一版，一律視為有差異
      changedFields: baseline ? changedFieldCount(baseline.docs, state.sectionValues) : 1,
    });
    return gate.ok ? { ok: true } : { ok: false, code: gate.code, reason: gate.reason };
  },

  /**
   * 送審 = commit：對整份 PRD 拍快照。
   *
   * 有未儲存的草稿就先擋下 —— 送出一份「跟你螢幕上看到的不一樣」的版本
   * 是最難察覺也最貴的錯誤。
   */
  commitForReview(message: string): { ok: boolean; reason?: string; version?: PrdVersion } {
    // 閘門整段委派給 `commitPrecheck()`：UI 的預檢與這裡問的是**同一支**，
    // 兩邊不可能給出不同答案。
    const gate = this.commitPrecheck();
    if (!gate.ok) return { ok: false, reason: gate.reason };
    const pid = state.activeProjectId;
    // 型別收斂用 —— `commitPrecheck()` 的 `no-project` 已經擋過這一條
    if (!pid) return { ok: false, reason: "沒有選擇專案" };
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
    syncProfile(state, id);
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
    syncProfile(state, id);
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
    syncProfile(state, id);
    return { ok: true };
  },

  /**
   * 專案簡寫（wishlist 取號前綴）。空字串＝清掉。
   * 不合法的值拒收，不要截成看起來像成功。
   */
  setProjectShortCode(id: string, raw: string): { ok: boolean; reason?: string } {
    const user = state.currentUser;
    if (user.accessRole !== "admin" && user.accessRole !== "editor") {
      return { ok: false, reason: "無權限改簡寫" };
    }
    if (!state.projects.some((p) => p.id === id)) {
      return { ok: false, reason: "找不到專案" };
    }
    const trimmed = raw.trim();
    let code: string | undefined;
    if (trimmed) {
      const next = normalizeShortCode(trimmed);
      if (!next) return { ok: false, reason: "簡寫只能是 1 到 5 個英文字母" };
      code = next;
    }
    state = {
      ...state,
      projects: state.projects.map((p) =>
        p.id === id
          ? {
              ...p,
              shortCode: code,
              updated: "剛剛",
              lastFileAt: nowIso(),
            }
          : p,
      ),
    };
    emit();
    syncProfile(state, id);
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
      state.projectSections,
      state.projectNoCustom,
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
        state.projectSections,
        state.projectNoCustom,
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
    // 切領域＝明確的「重建骨架」，所以清掉這個專案自己的結構覆寫。
    // 留著的話畫面會顯示新領域，章節卻還是舊的那一套 —— 兩個地方說反話。
    const nextOverrides = { ...(state.projectSections ?? {}) };
    delete nextOverrides[projectId];
    const metaBag =
      projectId === state.activeProjectId
        ? { ...state.projectSectionMeta, [projectId]: metaFromSections(state.sections) }
        : state.projectSectionMeta;
    state = {
      ...state,
      projects,
      projectSections: nextOverrides,
      projectSectionMeta: metaBag,
      sections:
        projectId === state.activeProjectId
          ? sectionsForProject(
              projects.find((p) => p.id === projectId),
              metaBag,
              nextOverrides,
              state.projectNoCustom,
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

  /**
   * 這個專案的孤兒正文，逐段列出。
   *
   * 用 `sectionsFor(pid)` 與 `projectSectionValues[pid]` —— **不能用 active
   * 的 `sections` / `sectionValues`**。不同專案的骨架不一樣，拿 active 那份
   * 去算別的專案，會把人家好端端的內容判成孤兒，或反過來把真的孤兒漏掉。
   * 正上方的 `orphanSectionIds()` 就是 active-only 的那一版，不要照抄。
   */
  orphansOf(projectId: string): OrphanEntry[] {
    return findOrphans(
      this.sectionsFor(projectId),
      visibleValues(state.projectSectionValues[projectId] ?? {}, state.prdDrafts[projectId] ?? {}),
    );
  },

  /**
   * 所有已知領域包攤平後的章節池，只給孤兒面板查「原本叫什麼名字」用——
   * 跟 `sectionsFor()` 不同，這份不代表任何專案現在的骨架，純粹是一本
   * 「這個 id 曾經在哪個領域包裡叫什麼」的字典。id 撞名時後面覆蓋前面，
   * 查標題不要求唯一。查不到（多半是 `applyFullTemplate()` 套的一次性範本，
   * 不屬於任何領域包）就是真的查不到，`labelForOrphan` 會照實回退成原始 id。
   */
  orphanLabelPool(): Section[] {
    const byId = new Map<string, Section>();
    for (const name of Object.keys(domainPacks())) {
      for (const s of domainSections(name)) byId.set(s.id, s);
    }
    return [...byId.values()];
  },

  /**
   * 這段孤兒是不是真的孤兒——`sectionId`／`fieldKey` 是否都不在目前骨架裡。
   * `moveOrphan`／`dropOrphan` 呼叫前都要過這關，理由見那兩支的註解。
   */
  isOrphanRef(projectId: string, ref: OrphanRef): boolean {
    const target = this.sectionsFor(projectId).find((s) => s.id === ref.sectionId);
    return !target?.fields.some((f) => f.key === ref.fieldKey);
  },

  /**
   * 把一段孤兒搬進現有章節的某個欄位。
   *
   * 落點寫進**草稿**而不是正文：跟 AI 產出、跟套範本的示範內容同一條規則——
   * 使用者要看過、按過存檔，才算他認可的字。來源則直接從已儲存正文移除，
   * 因為孤兒沒有「草稿／已儲存」的分別，它只活在正文袋裡。
   *
   * 來源的草稿也要一起清掉。留著的話 `saveSections()` 會照草稿自己的
   * sectionId 寫回正文 —— 孤兒在存檔那一刻復活，而且不會有任何訊息。
   */
  moveOrphan(projectId: string, from: OrphanRef, to: OrphanRef): { ok: boolean; reason?: string } {
    if (!canEditContent(state.currentUser)) return { ok: false, reason: "目前身分無法編輯內文" };
    const docs = state.projectSectionValues[projectId] ?? {};
    const drafts = state.prdDrafts[projectId] ?? {};
    // 孤兒可能只活在草稿裡（換骨架前打了字但還沒存）——只看已存的會找不到，
    // 明明有字卻回「找不到」是騙使用者
    const text = drafts[from.sectionId]?.[from.fieldKey] ?? docs[from.sectionId]?.[from.fieldKey];
    if (typeof text !== "string" || !text.trim()) return { ok: false, reason: "找不到這一段孤兒內容" };
    // 來源必須真的是孤兒——否則呼叫端傳一個還在骨架裡的章節，這支會把正常
    // 內容當孤兒搬走，使用者毫無防備地永久失去一段還在用的正文
    if (!this.isOrphanRef(projectId, from)) {
      return { ok: false, reason: "來源不是孤兒內容，不能用這個動作搬移" };
    }

    // 落點必須在骨架裡，否則搬完只是換一個位置繼續當孤兒
    const target = this.sectionsFor(projectId).find((s) => s.id === to.sectionId);
    if (!target?.fields.some((f) => f.key === to.fieldKey)) {
      return { ok: false, reason: "落點章節或欄位不在目前結構裡" };
    }

    // 疊在「現在看得到的值」上：有草稿接草稿，沒有才接已儲存的。
    // 一律用已儲存的當底，會把使用者還沒存的那段字吃掉。
    const base = drafts[to.sectionId]?.[to.fieldKey] ?? docs[to.sectionId]?.[to.fieldKey] ?? "";

    const nextDrafts = withoutField(
      { ...drafts, [to.sectionId]: { ...(drafts[to.sectionId] ?? {}), [to.fieldKey]: appendInto(base, text) } },
      from,
    );

    state = {
      ...state,
      projectSectionValues: { ...state.projectSectionValues, [projectId]: withoutField(docs, from) },
      prdDrafts: { ...state.prdDrafts, [projectId]: nextDrafts },
      ...(projectId === state.activeProjectId ? { sectionValues: withoutField(docs, from) } : {}),
    };
    touchProjectMeta(projectId);
    emit();
    return { ok: true };
  },

  /**
   * 永久刪掉一段孤兒。沒有垃圾桶、沒有 undo —— 擋在前面的是 UI 的確認對話框。
   * 來源的草稿一併清掉，理由同 `moveOrphan`：留著會在存檔時復活。
   */
  dropOrphan(projectId: string, from: OrphanRef): { ok: boolean; reason?: string } {
    if (!canEditContent(state.currentUser)) return { ok: false, reason: "目前身分無法編輯內文" };
    const docs = state.projectSectionValues[projectId] ?? {};
    // 理由同 moveOrphan：孤兒可能只活在草稿裡，只看已存的會誤判成「找不到」
    const text = state.prdDrafts[projectId]?.[from.sectionId]?.[from.fieldKey] ?? docs[from.sectionId]?.[from.fieldKey];
    if (typeof text !== "string" || !text.trim()) return { ok: false, reason: "找不到這一段孤兒內容" };
    // 理由同 moveOrphan：擋住呼叫端拿還在骨架裡的章節來當孤兒永久刪除
    if (!this.isOrphanRef(projectId, from)) {
      return { ok: false, reason: "來源不是孤兒內容，不能用這個動作刪除" };
    }

    const nextDocs = withoutField(docs, from);
    state = {
      ...state,
      projectSectionValues: { ...state.projectSectionValues, [projectId]: nextDocs },
      prdDrafts: {
        ...state.prdDrafts,
        [projectId]: withoutField(state.prdDrafts[projectId] ?? {}, from),
      },
      ...(projectId === state.activeProjectId ? { sectionValues: nextDocs } : {}),
    };
    touchProjectMeta(projectId);
    emit();
    return { ok: true };
  },

  /* ─── 專案自己的章節結構 ─── */

  /**
   * 把目前的骨架固定成「這個專案自己的」。
   *
   * 任何一次結構編輯之前都要先做這件事，否則改完之後 `load()` 會從領域包
   * 重算，使用者的修改**靜默消失**（沒有錯誤、沒有提示，只是下次打開就沒了）。
   */
  private_pinSections(projectId: string, sections?: Section[]) {
    const cur =
      sections ??
      state.projectSections?.[projectId] ??
      sectionsForProject(
        state.projects.find((p) => p.id === projectId),
        state.projectSectionMeta,
        state.projectSections,
        state.projectNoCustom,
      );
    // 固定下來的是骨架，不含 `custom` —— 那一節由 withCustomSection 永遠補在最後
    return cur.filter((x) => x.id !== CUSTOM_SECTION_ID).map((x) => ({ ...x }));
  },

  /** 套用整份 PRD 範本：**置換**整份章節，編號與命名一律照範本 */
  applyFullTemplate(
    projectId: string,
    sections: Section[],
    seed: Record<string, Record<string, string>> = {},
    /**
     * 這份範本的分類與自帶骨架。**決定這個專案之後跑哪一套簽核流程。**
     *
     * 可以不給（舊呼叫端、或不是從範本頁進來的路徑），那時專案維持原本的
     * 分類 —— 沒有分類的走 `lean`。不是每一種套用骨架的動作都該重設簽核流程。
     */
    template?: { cat?: FullCat; stages?: WorkflowStageDef[] },
  ): { ok: boolean; reason?: string; count?: number } {
    if (!canEditContent(state.currentUser)) return { ok: false, reason: "目前身分無法編輯內文" };
    if (!sections.length) return { ok: false, reason: "這份範本讀不出任何章節標題" };

    const overrides = { ...(state.projectSections ?? {}), [projectId]: sections.map((x) => ({ ...x })) };
    const nextSections = withCustomFor(projectId, sections);

    // 範本的示範內容進**草稿**，不是已儲存 —— 跟 AI 產出同一條規則：
    // 不是使用者打的字就不該直接變成正文
    const drafts = { ...state.prdDrafts };
    if (Object.keys(seed).length) {
      const cur = { ...(drafts[projectId] ?? {}) };
      for (const [sid, fields] of Object.entries(seed)) {
        const nonEmpty = Object.fromEntries(Object.entries(fields).filter(([, v]) => v.trim()));
        if (Object.keys(nonEmpty).length) cur[sid] = { ...(cur[sid] ?? {}), ...nonEmpty };
      }
      drafts[projectId] = cur;
    }

    state = {
      ...state,
      projectSections: overrides,
      prdDrafts: drafts,
      // 換骨架 = 舊的標記對不上新的章節 id，留著只會讓分數與勾選錯位
      projectSectionMeta: { ...state.projectSectionMeta, [projectId]: {} },
      sections: projectId === state.activeProjectId ? nextSections : state.sections,
      // 換整份範本 = 換簽核骨架。但**不動已經落地的流程** —— 進行中的案子
      // 換掉關卡 id 會讓第一輪的意見顯示「（已移除的關卡）」
      projects: template
        ? state.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  ...(template.cat ? { templateCat: template.cat } : {}),
                  ...(template.stages?.length ? { templateStages: template.stages } : {}),
                }
              : p,
          )
        : state.projects,
    };
    touchProjectMeta(projectId);
    emit();
    return { ok: true, count: sections.length };
  },

  /** 改章節的編號或標題 */
  renameSection(sectionId: string, patch: { n?: string; title?: string }): { ok: boolean; reason?: string } {
    if (!canEditContent(state.currentUser)) return { ok: false, reason: "目前身分無法編輯內文" };
    if (sectionId === CUSTOM_SECTION_ID) return { ok: false, reason: "自訂章節是固定的收納區，不能改名" };
    const pid = state.activeProjectId;
    if (!pid) return { ok: false, reason: "沒有選取專案" };
    const pinned = this.private_pinSections(pid).map((x) =>
      x.id === sectionId
        ? { ...x, ...(patch.n !== undefined ? { n: patch.n.trim() || x.n } : {}), ...(patch.title !== undefined ? { title: patch.title.trim() || x.title } : {}) }
        : x,
    );
    return applyStructure(pid, pinned);
  },

  /** 刪掉一整節。**正文一併刪** —— 留著是看不見的孤兒，匯出時才會突然冒出來 */
  removeSection(sectionId: string): { ok: boolean; reason?: string } {
    if (!canEditContent(state.currentUser)) return { ok: false, reason: "目前身分無法編輯內文" };
    const pid = state.activeProjectId;
    if (!pid) return { ok: false, reason: "沒有選取專案" };
    // 自訂章節不在 projectSections 裡（每次推導由 withCustomSection 補上），
    // 所以它得靠旗標刪 —— 從陣列裡拿掉的話下次載入又會長回來。
    if (sectionId === CUSTOM_SECTION_ID) return removeCustomSection(pid);
    const pinned = this.private_pinSections(pid);
    if (pinned.length <= 1) return { ok: false, reason: "至少要留一節" };
    const next = pinned.filter((x) => x.id !== sectionId);
    if (next.length === pinned.length) return { ok: false, reason: "找不到這一節" };

    const docs = { ...(state.projectSectionValues[pid] ?? {}) };
    delete docs[sectionId];
    const drafts = { ...(state.prdDrafts[pid] ?? {}) };
    delete drafts[sectionId];
    state = {
      ...state,
      projectSectionValues: { ...state.projectSectionValues, [pid]: docs },
      prdDrafts: { ...state.prdDrafts, [pid]: drafts },
      ...(pid === state.activeProjectId ? { sectionValues: docs } : {}),
    };
    return applyStructure(pid, next);
  },

  /** 改子章節（欄位）的標題 */
  renameField(sectionId: string, key: string, label: string): { ok: boolean; reason?: string } {
    if (!canEditContent(state.currentUser)) return { ok: false, reason: "目前身分無法編輯內文" };
    const pid = state.activeProjectId;
    if (!pid) return { ok: false, reason: "沒有選取專案" };
    const text = label.trim();
    if (!text) return { ok: false, reason: "標題不能是空的" };
    const pinned = this.private_pinSections(pid).map((x) =>
      x.id === sectionId
        ? { ...x, fields: x.fields.map((f) => (f.key === key ? { ...f, label: text } : f)) }
        : x,
    );
    return applyStructure(pid, pinned);
  },

  /** 刪掉一個子章節（欄位）。正文一併刪，理由同 removeSection */
  removeField(sectionId: string, key: string): { ok: boolean; reason?: string } {
    if (!canEditContent(state.currentUser)) return { ok: false, reason: "目前身分無法編輯內文" };
    const pid = state.activeProjectId;
    if (!pid) return { ok: false, reason: "沒有選取專案" };
    const pinned = this.private_pinSections(pid);
    const target = pinned.find((x) => x.id === sectionId);
    if (!target) return { ok: false, reason: "找不到這一節" };
    if (target.fields.length <= 1) return { ok: false, reason: "每一節至少要留一個欄位 —— 要整節拿掉請刪章節" };

    const next = pinned.map((x) =>
      x.id === sectionId ? { ...x, fields: x.fields.filter((f) => f.key !== key) } : x,
    );
    const docs = { ...(state.projectSectionValues[pid] ?? {}) };
    if (docs[sectionId]) {
      const sec = { ...docs[sectionId] };
      delete sec[key];
      docs[sectionId] = sec;
    }
    state = {
      ...state,
      projectSectionValues: { ...state.projectSectionValues, [pid]: docs },
      ...(pid === state.activeProjectId ? { sectionValues: docs } : {}),
    };
    return applyStructure(pid, next);
  },

  /** 這個專案的章節是不是自己改過的（UI 要提示「已脫離領域包」） */
  hasOwnSections(projectId?: string): boolean {
    const pid = projectId ?? state.activeProjectId;
    return Boolean(pid && state.projectSections?.[pid]?.length);
  },

  /** 放棄自己的結構，回到領域包的骨架 */
  resetSections(projectId?: string): { ok: boolean } {
    const pid = projectId ?? state.activeProjectId;
    if (!pid) return { ok: false };
    const next = { ...(state.projectSections ?? {}) };
    delete next[pid];
    // 「回到領域包骨架」包含把自訂章節帶回來 —— 那一節本來就是骨架的一部分
    const noCustom = { ...(state.projectNoCustom ?? {}) };
    delete noCustom[pid];
    state = {
      ...state,
      projectSections: next,
      projectNoCustom: noCustom,
      sections:
        pid === state.activeProjectId
          ? sectionsForProject(
              state.projects.find((p) => p.id === pid),
              state.projectSectionMeta,
              next,
              noCustom,
            )
          : state.sections,
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

  /**
   * 工作台-OpenSpec上次開的 change。
   *
   * 值相同就整個跳過 —— `emit()` 會 persist 並通知所有 listener，而這一支
   * 會在 render 路徑上被呼叫到（頁面進場時要把記憶寫回去）。無條件 emit
   * 等於每次重繪都觸發下一次重繪。
   */
  setActiveOpenSpecChange(id: string) {
    if (state.activeOpenSpecChange === id) return;
    state = { ...state, activeOpenSpecChange: id };
    emit();
  },

  /** 同上，記的是檔案絕對路徑。傳空字串代表「沒有開著的檔」。 */
  setActiveOpenSpecFile(path: string) {
    if (state.activeOpenSpecFile === path) return;
    state = { ...state, activeOpenSpecFile: path };
    emit();
  },

  setPendingInsert(body: string | null) {
    state = { ...state, pendingInsert: body };
    emit();
  },

  /**
   * 把刪掉的「自訂章節」放回來。
   *
   * 章節範本只有那一節裝得下（插進「當下開著的那一章」會讓同一份範本每次
   * 落在不同地方）。所以插入前先確保它在。
   */
  restoreCustomSection(projectId?: string): { ok: boolean } {
    const pid = projectId ?? state.activeProjectId;
    if (!pid || !state.projectNoCustom?.[pid]) return { ok: false };
    const noCustom = { ...state.projectNoCustom };
    delete noCustom[pid];
    state = {
      ...state,
      projectNoCustom: noCustom,
      sections:
        pid === state.activeProjectId
          ? sectionsForProject(
              state.projects.find((p) => p.id === pid),
              state.projectSectionMeta,
              state.projectSections,
              noCustom,
            )
          : state.sections,
    };
    emit();
    return { ok: true };
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
      // 「有沒有簽核這件能力」**加上專案層級的職責分立**。
      //
      // 傳關卡層級的 `canSignStage` 進去會擋掉合法的覆核（留言不屬於任何一關），
      // 但退回純角色的 `canApprove` 是另一個極端：`canResolveComment` 自己那份
      // 自審規則只擋「editor 覆核自己的檔案」，完全沒有 agent 族系那一條。
      // 於是同族系 agent 可以把自己家族寫的文件上的**所有**審查留言標記為已解決。
      // `separationOfDuties` 正好是專案層級、不看關卡的那一份判斷。
      hasApprove:
        canApprove(state.currentUser) && separationOfDuties(state.currentUser, project).can,
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
            [id]: caseForProject(id),
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
      state.projectSections,
      state.projectNoCustom,
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
          [id]: caseForProject(id),
        },
      };
    }
    syncApprovalsFromActiveCase();
    emit();
  },

  /**
   * 簽核。
   *
   * `stageIds` 給了就**只簽那幾關**；不給維持原本的「簽我能簽的全部」。
   * 這個差別是簽核管理頁需要的：在那裡按某一關的核准，不該順手把其他關也簽掉
   * （admin 尤其明顯 —— 舊行為對 admin 是一鍵全簽）。
   *
   * `comment` 是簽核意見，連同時間與簽核者一起寫進被簽的那幾關。
   */
  approveAndLock(
    opts: {
      comment?: string;
      stageIds?: string[];
      /**
       * 管理員代簽。**理由必填**，而且每一關都會單獨留一筆 `override` 決策 ——
       * 四眼原則要的是「看得到」：不禁止一個人走完流程，但那件事必須在紀錄上
       * 跟一般核准長得不一樣。
       */
      override?: { reason: string };
    } = {},
  ): {
    ok: boolean;
    reason?: string;
    allDone?: boolean;
    signed?: number;
    /** S1 閘門擋下時，還有幾份分析等著拍板。UI 靠這個數字決定要不要開攔截對話框 */
    pendingJobs?: number;
  } {
    const project =
      state.projects.find((p) => p.id === state.activeProjectId) ??
      state.projects.find((p) => p.id === "p1") ??
      state.projects[0];
    if (!project) return { ok: false, reason: "找不到專案" };
    const c = state.cases[project.id];
    if (c?.withdrawn) return { ok: false, reason: "此案已抽單，無法簽核" };
    // 還沒送審的個案是建專案時順手開的（走建立當下的全域流程），它的關卡不是
    // 這個專案要跑的那一套。在上面簽字會讓送審誤判成「這案子跑過了」，
    // 於是那套全域流程被永久寫進專案，範本骨架再也不會出現
    if (project.status === "draft") return { ok: false, reason: NOT_SUBMITTED };

    const u = state.currentUser;
    if (opts.override && u.accessRole !== "admin") {
      return { ok: false, reason: "只有管理員可以代簽" };
    }
    if (opts.override && !opts.override.reason.trim()) {
      return { ok: false, reason: "代簽一定要寫理由 —— 那是紀錄上唯一說得出「為什麼一個人簽完全部」的地方" };
    }

    const only = opts.stageIds?.length ? new Set(opts.stageIds) : null;
    let blockedReason: string | undefined;
    const at = new Date().toISOString();
    const round = c?.round ?? 1;
    const decisions: CaseDecision[] = [];
    let signed = 0;

    const sign = (s: CaseStage, kind: "approved" | "override"): CaseStage => {
      signed++;
      const comment = (kind === "override" ? opts.override!.reason : (opts.comment ?? "")).trim();
      decisions.push({
        id: `d-${at}-${s.id}-${decisions.length}`,
        stageId: s.id,
        round,
        at,
        byId: u.id,
        byName: u.name,
        kind,
        comment,
      });
      return {
        ...s,
        state: "approved" as const,
        // `assigneeName` 只存「這一關派給誰」。以前這裡覆寫成 `"名字 · 已簽"`，
        // 而 `stagesAfterResubmit` 重送審時只把 `state` 退回 pending —— 那行字
        // 沒人清，同一關就同時宣稱「待簽核」與「Scott · 已簽」。而且原本的
        // `assigneeId` 是保留的，改派下拉顯示 agent、旁邊那行字顯示簽核者。
        // 「誰簽的」寫在下面三欄（`decidedBy*`），畫面讀 `state` + `decidedByName`。
        // 本來就沒派人的關卡（`empty`）才把簽核者填進去 —— 那是它真的執行者。
        assigneeId: s.assigneeId ?? u.id,
        assigneeName: s.assigneeId ? s.assigneeName : u.name,
        decidedAt: at,
        decidedById: u.id,
        decidedByName: u.name,
        ...(comment ? { comment } : {}),
      };
    };

    const open = (s: CaseStage) =>
      s.state === "pending" || s.state === "empty" || s.state === "changes_requested";

    // 權限判斷收斂成單一入口。以前這裡是行內條件，而職責分立在
    // `permissions.canApproveProject`、關卡歸屬在 `signoff.canSignStage` ——
    // 三份判斷各自演化，畫面要解釋「為什麼不能按」時第三份根本沒得呼叫。
    // 代簽也走同一支：它放行的只有關卡歸屬與順序閘門，職責分立照擋。
    const stages = (c?.stages ?? []).map((s) => {
      if (only && !only.has(s.id)) return s;
      if (!open(s)) return s;
      const ability = canSignStage(u, project, s, c, {
        override: Boolean(opts.override),
        // 員工清單傳進去，族系隔離才判得到「這一關派給了誰」——
        // 不傳的話只剩「按按鈕的人是不是 agent」，而簽的永遠是人
        employees: state.employees,
      });
      if (!ability.can) {
        // 指名單關被擋下時，那個理由就是要顯示給使用者的解釋
        if (only) blockedReason ??= ability.reason;
        return s;
      }
      return sign(s, opts.override ? "override" : "approved");
    });

    // 代簽以外，不再有 admin 的隱形一鍵全簽 —— 舊行為是「只要你是 admin，
    // 按一次就把所有未簽關卡吃掉」，畫面上完全看不出來發生了什麼事
    const nextStages = stages;
    // 講得出**為什麼**不能簽，不是含糊的「不是你可以簽的」——
    // canSignStage 的 reason 本來就是寫給使用者讀的
    if (only && signed === 0) return { ok: false, reason: blockedReason ?? "這一關現在不是你可以簽的" };
    if (!only && signed === 0) return { ok: false, reason: "現在沒有你可以簽的關卡" };
    const allDone = allStagesSettled(nextStages);
    // ── S1 結案閘門 ──────────────────────────────────────────────
    //
    // 結案會 `locked: true`，而 `saveAgentResult` 對鎖定的案子一律回
    // 「此案已結案鎖定」。所以案子一鎖，所有還沒拍板的分析就**永遠**落不了地：
    // 一份跑了三十秒、使用者還沒讀的分析，會因為他按了最後一關的核准而消失在
    // 一顆按不動的灰鈕後面。
    //
    // Scott 拍板擋在這一端（S1）：不是等鎖定之後解釋那顆灰鈕，而是不讓案子鎖定。
    // 位置是硬的 —— 在 `nextStages` 與 `allDone` 都算完之後、寫進 state 之前。
    // 提前到迴圈之前的話擋不掉「這一簽剛好讓案子結案」的那一次；放到寫入之後
    // 就得再回滾一次已經改掉的 state。
    //
    // **中途簽一關不受影響**：只有 `allDone` 才進這個分支。
    if (allDone) {
      const pending = pendingJobsFor(project.id);
      if (pending.length) {
        return {
          ok: false,
          reason: `還有 ${pending.length} 份 Agent 分析沒拍板 —— 結案後就永遠落不了地了`,
          pendingJobs: pending.length,
        };
      }
    }
    const base0 = c ?? caseForProject(project.id);
    const nextCase: CaseRecord = {
      ...base0,
      stages: nextStages,
      log: [...(base0.log ?? []), ...decisions],
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
    return { ok: true, allDone, signed };
  },

  /**
   * 要求修改 —— 審閱者的負向決策。
   *
   * 這是這套流程原本完全缺席的一半：以前發現問題時唯一能做的是「不按核准」，
   * 而那在畫面上跟「還沒輪到他」一模一樣。理由必填，因為作者要靠它知道改什麼。
   *
   * 不動專案狀態（仍是 review）—— 「待修正」由關卡推導。那個狀態詞彙表牽動
   * 專案清單、總覽、側欄三處，為了這件事去動它不划算。
   */
  requestChanges(stageId: string, comment: string): { ok: boolean; reason?: string } {
    const project = state.projects.find((p) => p.id === state.activeProjectId);
    if (!project) return { ok: false, reason: "找不到專案" };
    const c = state.cases[project.id];
    if (!c) return { ok: false, reason: "這個專案還沒有簽核個案" };
    if (c.withdrawn) return { ok: false, reason: "此案已抽單" };
    if (project.status === "draft") return { ok: false, reason: NOT_SUBMITTED };
    const body = comment.trim();
    if (!body) return { ok: false, reason: "要求修改一定要寫理由 —— 作者要靠它知道改什麼" };

    const u = state.currentUser;
    const stage = c.stages.find((x) => x.id === stageId);
    if (!stage) return { ok: false, reason: "找不到這一關" };
    const ability = canSignStage(u, project, stage, c, { employees: state.employees });
    if (!ability.can) return { ok: false, reason: ability.reason };

    const at = new Date().toISOString();
    const decision: CaseDecision = {
      id: `d-${at}-${stageId}`,
      stageId,
      round: c.round ?? 1,
      at,
      byId: u.id,
      byName: u.name,
      kind: "changes_requested",
      comment: body,
    };
    const nextCase: CaseRecord = {
      ...c,
      // 要求修改會解鎖：案子不再是「全部通過」的狀態
      locked: false,
      stages: c.stages.map((x) =>
        x.id === stageId
          ? {
              ...x,
              state: "changes_requested" as const,
              decidedAt: at,
              decidedById: u.id,
              decidedByName: u.name,
              comment: body,
            }
          : x,
      ),
      log: [...(c.log ?? []), decision],
    };
    state = {
      ...state,
      cases: { ...state.cases, [project.id]: nextCase },
      locked: false,
      projects: state.projects.map((p) =>
        p.id === project.id ? { ...p, status: "review" as const, updated: "剛剛" } : p,
      ),
    };
    syncApprovalsFromActiveCase();
    audit(state, project.id, "gate.fail", `prd:${project.id}`, { stage: stage.name });
    emit();
    return { ok: true };
  },

  /**
   * 保留意見 —— 留話但**不改變關卡狀態**（GitHub PR review 的第三態）。
   *
   * 為什麼值得有：多數審閱意見不是「這樣不行」而是「這裡我有疑問」。
   * 逼人在核准與駁回之間二選一，結果是意見被寫進別的地方，或乾脆不說。
   */
  addStageComment(stageId: string, comment: string): { ok: boolean; reason?: string } {
    const project = state.projects.find((p) => p.id === state.activeProjectId);
    if (!project) return { ok: false, reason: "找不到專案" };
    const c = state.cases[project.id];
    if (!c) return { ok: false, reason: "這個專案還沒有簽核個案" };
    if (c.withdrawn) return { ok: false, reason: "此案已抽單" };
    // 送審會依專案落地的流程**重建個案**，重建時 `log` 從空的開始 ——
    // 現在留下的意見會靜默消失。擋在這裡比讓人白打一段字好
    if (project.status === "draft") return { ok: false, reason: NOT_SUBMITTED };
    const body = comment.trim();
    if (!body) return { ok: false, reason: "意見是空的" };
    const stage = c.stages.find((x) => x.id === stageId);
    if (!stage) return { ok: false, reason: "找不到這一關" };

    const u = state.currentUser;
    const at = new Date().toISOString();
    const decision: CaseDecision = {
      id: `d-${at}-${stageId}-c`,
      stageId,
      round: c.round ?? 1,
      at,
      byId: u.id,
      byName: u.name,
      kind: "comment",
      comment: body,
    };
    state = {
      ...state,
      cases: { ...state.cases, [project.id]: { ...c, log: [...(c.log ?? []), decision] } },
    };
    emit();
    return { ok: true };
  },

  /**
   * 略過一個**非必簽**關卡。
   *
   * `skipped` 這個狀態在型別裡躺了很久卻沒有任何程式路徑能產生它，
   * 所以「非必簽」等於沒有出口。這支就是那個出口。必簽關卡不給略過 ——
   * 那會讓 required 這個設定變成裝飾。
   */
  skipStage(
    stageId: string,
    comment: string,
  ): { ok: boolean; reason?: string; pendingJobs?: number } {
    const project = state.projects.find((p) => p.id === state.activeProjectId);
    if (!project) return { ok: false, reason: "找不到專案" };
    const c = state.cases[project.id];
    if (!c) return { ok: false, reason: "這個專案還沒有簽核個案" };
    if (project.status === "draft") return { ok: false, reason: NOT_SUBMITTED };
    const stage = c.stages.find((x) => x.id === stageId);
    if (!stage) return { ok: false, reason: "找不到這一關" };
    if (stage.required !== false) return { ok: false, reason: "必簽關卡不能略過" };
    const u = state.currentUser;
    // 略過**就是一種結案決策**，所以走跟核准同一支判斷。原本這裡是行內條件
    // （admin 或本關負責人），繞過了 `hasPermission(approve)`、職責分立、
    // 以及 `withdrawn`／`locked` —— 於是「唯一入口」那句註解不成立，而且
    // 同族系 agent 可以把自己家族寫的文件上的非必簽關卡直接結案。
    const ability = canSignStage(u, project, stage, c, { employees: state.employees });
    if (!ability.can) return { ok: false, reason: ability.reason };

    const at = new Date().toISOString();
    const body = comment.trim();
    const nextStages = c.stages.map((x) =>
      x.id === stageId
        ? { ...x, state: "skipped" as const, decidedAt: at, decidedById: u.id, decidedByName: u.name, ...(body ? { comment: body } : {}) }
        : x,
    );
    const allDone = allStagesSettled(nextStages);
    // S1 閘門的第二條路。`skipStage` 跟 `approveAndLock` 都會 `locked: allDone`，
    // 所以閘門只放在 UI 或只放在其中一支的話，另一支會靜默走過去 —— 略過最後一個
    // 非必簽關卡照樣把案子鎖上，那幾份分析照樣落不了地，而且完全沒有症狀。
    if (allDone) {
      const pending = pendingJobsFor(project.id);
      if (pending.length) {
        return {
          ok: false,
          reason: `還有 ${pending.length} 份 Agent 分析沒拍板 —— 結案後就永遠落不了地了`,
          pendingJobs: pending.length,
        };
      }
    }
    state = {
      ...state,
      cases: {
        ...state.cases,
        [project.id]: {
          ...c,
          stages: nextStages,
          locked: allDone,
          log: [
            ...(c.log ?? []),
            { id: `d-${at}-${stageId}-s`, stageId, round: c.round ?? 1, at, byId: u.id, byName: u.name, kind: "skipped" as const, comment: body },
          ],
        },
      },
      locked: allDone,
    };
    syncApprovalsFromActiveCase();
    emit();
    return { ok: true };
  },

  /**
   * 送出審閱 —— **流程在這裡落地到專案上**。
   *
   * 第一次送審時把「範本分類 + 領域包」算出來的關卡複製一份寫進
   * `project.workflowStages`，之後改範本不影響這個案子。已經落地的專案重送審
   * **沿用同一組關卡 id**：`signoffTimeline` 靠 stageId 跨輪串接決策，id 一變
   * 第一輪的意見就會顯示「（已移除的關卡）」，而那正是簽核紀錄最該講清楚的一段。
   *
   * `assignments` 是逐關指派（`stageDefId → 執行者 id`，`null` = 這一關不派人）。
   * 只在**建立關卡的那一次**生效 —— 已經在跑的案子要改人請走
   * `reassignCaseStage`，那條路徑會留下紀錄。
   */
  /**
   * 送審前的預判：這一次會不會建立關卡、會建哪幾關。
   *
   * 給送審對話框用 —— 只有 `landsNow === true` 的那一次 `assignments` 才生效，
   * 已落地的案子重送審直接送（S2：改人走簽核頁的 `reassignCaseStage`，
   * 那條路徑會留下紀錄）。純讀，不動 state。
   */
  submitPlan(projectId?: string): { landsNow: boolean; stages: WorkflowStageDef[] } {
    // 預設專案的解析要跟 `submitForReview` 逐字一致，否則對話框問的是 A 專案、
    // 送審送的是 B 專案。
    return submitPlanFor(projectId ?? state.activeProjectId ?? "p1");
  },

  submitForReview(
    projectId?: string,
    commitId?: string,
    assignments?: Record<string, string | null>,
  ) {
    // 只有「真的有東西變了」才算新的一輪：換了快照，或上一輪有人要求修改。
    // 同一份內容重按送審不該把輪次灌高，那會讓紀錄的分組失去意義。
    const id = projectId ?? state.activeProjectId ?? "p1";
    const existing = state.cases[id];
    const live = existing && !existing.withdrawn ? existing : undefined;

    // 判斷整段抽到 `submitPlanFor` —— 送審對話框要先問「每一關派給誰」，
    // 而它必須用**同一份**判斷才知道 `assignments` 這次到底會不會生效。
    const { landsNow, stages: landed } = submitPlanFor(id);
    const touched = !landsNow;

    // 沒留下痕跡的個案照新流程重建。不重建的話，第一次送審跑的會是建專案當下
    // 那套全域預設關卡，而專案上剛落地的流程只是一份沒人用的資料 —— 兩者不一致
    // 而且畫面上完全看不出來。
    const c = touched ? live! : caseFromWorkflow(id, landed, state.employees, assignments);
    // 判斷抽進 `isNewRound`：舊條件是 `commitId !== c.reviewCommitId`，而全新案子的
    // `reviewCommitId` 是 null，第一次送審必然不相等 —— 於是紀錄上永遠沒有第 1 輪。
    const nextRound = isNewRound(c.stages, c.reviewCommitId ?? null, commitId ?? null);
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
          // 進入新一輪。紀錄靠它講得出因果：「第 1 輪資安要求修改 → 第 2 輪重送」
          round: (c.round ?? 1) + (nextRound ? 1 : 0),
          log: c.log ?? [],
          withdrawn: false,
          withdrawnAt: null,
          withdrawnBy: null,
          withdrawReason: null,
          locked: false,
        },
      },
      locked: false,
      projects: state.projects.map((p) =>
        p.id === id
          ? {
              ...p,
              status: "review",
              updated: "剛剛",
              // 流程落地。已經有的不覆寫 —— 重送審沿用同一組關卡 id
              workflowStages: p.workflowStages ?? landed,
            }
          : p,
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
      // 新關卡預設串行（市場常態）；既有關卡在移轉時給 parallel 以保留現行行為
      mode: partial?.mode ?? "sequential",
      // 手動加的關卡預設只出意見。預設成 edit 等於讓使用者在管理中心點兩下
      // 就多出一個會改 PRD 內文的關卡，而畫面上跟 review 關卡長得一樣
      kind: partial?.kind ?? "review",
      defaultActor: partial?.defaultActor ?? "agent",
      ...(partial?.editTarget ? { editTarget: partial.editTarget } : {}),
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

  /* ─── 管理中心：五類 PRD 骨架 ─── */

  /**
   * 五類骨架目前生效的內容（覆寫優先，否則種子）。純讀，回傳的是複本。
   *
   * 管理中心與 `resolveWorkflowFor` **共用這一份**。管理中心自己去讀
   * `SEED_WORKFLOW_SKELETONS` 的話，畫面會永遠顯示種子 —— 使用者改完看到的是
   * 改前的內容，於是再改一次，然後以為存檔壞了。
   */
  workflowSkeletons(): Record<FullCat, WorkflowStageDef[]> {
    return liveSkeletons();
  },

  /**
   * 覆寫某一類的骨架。
   *
   * 兩條拒絕路徑，都不是形式檢查：
   * - **空陣列** —— 那一類的專案送審會得到零關卡的流程，而 `allStagesSettled`
   *   對零關卡回 false，案子從此結不了案，也沒有任何一顆按鈕解得開。
   * - **沒有「我核准」** —— 這一類 PRD 就再也沒有人簽過。整條流程還是會跑、
   *   還是會顯示「已完成」，只是那個「完成」背後沒有任何一個人的決定。
   *   `hasHumanApproval` 同時要求 `defaultActor === "human"`：一關叫「我核准」
   *   但預設執行者是 agent，等於讓 agent 核准自己的分析。
   *
   * `order` 一律重編 1..n —— 呼叫端傳進來的順序才是使用者看到的順序，
   * 而它手上那份的 `order` 可能是刪掉中間一關之後留下的洞。
   */
  setWorkflowSkeleton(
    cat: FullCat,
    stages: WorkflowStageDef[],
  ): { ok: boolean; reason?: string } {
    if (!FULL_CATS.includes(cat)) return { ok: false, reason: "不認得這個範本分類" };
    if (!stages.length) {
      return { ok: false, reason: "骨架不能是空的 —— 零關卡的流程送出去就永遠結不了案" };
    }
    if (!hasHumanApproval(stages)) {
      return {
        ok: false,
        reason: "骨架一定要留一關由人核准 —— 少了它，這一類 PRD 就再也沒有人簽過",
      };
    }
    state = {
      ...state,
      workflowSkeletons: {
        ...(state.workflowSkeletons ?? {}),
        [cat]: stages.map((s, i) => ({ ...s, order: i + 1 })),
      },
    };
    emit();
    return { ok: true };
  },

  /**
   * 還原成種子骨架 —— **把 key 刪掉**，不是複製一份種子進去。
   *
   * 複製一份的話，之後種子骨架任何一次修正都到不了這個使用者手上：他的
   * localStorage 裡凍著一份「還原當下」的複本，而畫面上跟真的還原一模一樣。
   */
  resetWorkflowSkeleton(cat: FullCat): void {
    if (!state.workflowSkeletons || !(cat in state.workflowSkeletons)) return;
    const next = { ...state.workflowSkeletons };
    delete next[cat];
    state = { ...state, workflowSkeletons: next };
    emit();
  },

  /**
   * 讓一個專案的流程**回到未落地狀態**，並把個案一起重建 —— 下次送出審閱會照
   * 現在的範本骨架與領域包重新解析一份新的關卡。
   *
   * ## 為什麼連個案一起重建（2026-08-26 Scott 拍板）
   *
   * 原本這裡只清 `project.workflowStages`。對一個**已經跑過簽核**的案子，
   * `submitPlanFor` 走 `caseHasRun(live) === true` → `workflowFromCase(live)`，
   * 從個案自己反推流程，**根本不回頭讀骨架** —— 所以那顆鈕對它是個 no-op：
   * 清掉一份沒人會再讀的紀錄，其餘什麼都沒發生。
   *
   * 現在個案跟著重建，`caseHasRun` 的四個判準（`reviewCommitId`、非 comment 的
   * `log`、關卡狀態、已存的 `agentResult`）隨新個案一起歸零，`submitPlan().landsNow`
   * 因此變回 true。**畫面上的文案要跟這件事一致**（`REAPPLY_COPY`）——
   * 上一輪的缺陷是鈕說「會清掉簽核狀態」而它什麼都沒做；反過來做了卻不說，
   * 是同一個缺陷換個方向。
   *
   * ## `CaseRecord.log` 不留 —— 兩個獨立的理由
   *
   * 1. **留著這顆鈕就又變回 no-op。** `caseHasRun` 直接讀它
   *    （`log.some(d => d.kind !== "comment")`），一筆核准就足以讓下次送審不重解析。
   *    要留就得改 `caseHasRun`，而那支管的是每一次送審，不是這一批的地盤。
   * 2. **留著會讓紀錄說謊。** 關卡 id 是 `cs-<stageDefId>-<projectId>`，而重套的
   *    前提就是骨架換了 → def id 換了 → 留下來的每一筆在 `signoffTimeline` 都是
   *    「（已移除的關卡）」；更糟的是新個案是 `round: 1`、舊紀錄也帶著 1..N，
   *    `groupTimelineByRound` 會把重套**之前**的決策併進**現在這一輪**。那不是
   *    保留歷史，是把歷史接到一份它沒發生過的流程上。
   *
   * 要真的留住那段歷史，該做的是一個有自己輪次與關卡名快照的「案件歷程封存」，
   * 不是在 `CaseRecord` 上掛一個側欄位。那不屬於這一批。
   *
   * ## 為什麼不是 `caseForProject()`
   *
   * 它走 `workflowFor()` → 落地那份、否則**全域** `state.workflowStages`；而這顆鈕
   * 承諾的是**骨架 + 領域包**（`resolveWorkflowFor`），也就是 `submitPlanFor` 下次
   * 真的會用的那一份。用 `caseForProject` 的話，管理員眼前這份個案會在下次送審被
   * 靜默換成另一份關卡。重建的原語仍然是同一支 `caseFromWorkflow`，**沒有第二條
   * 清簽章的路** —— `reopenCase` / `applyWorkflowToCase` / 這裡，三個呼叫端都是它。
   *
   * 鎖定與抽單的案子照舊拒絕，一條都沒放寬：前者的流程已經是歷史紀錄，
   * 後者要走 `reopenCase`。
   */
  reapplyWorkflow(projectId: string): { ok: boolean; reason?: string } {
    if (state.currentUser.accessRole !== "admin") {
      return { ok: false, reason: "僅管理員可重新套用範本流程" };
    }
    const p = state.projects.find((x) => x.id === projectId);
    if (!p) return { ok: false, reason: "找不到這個專案" };
    const c = state.cases[projectId];
    if (c?.locked) {
      return { ok: false, reason: "此案已結案鎖定 —— 已鎖定的流程是紀錄，不能重套" };
    }
    if (c?.withdrawn || p.status === "withdrawn") {
      return { ok: false, reason: "已抽單的案子請先「重開案件」" };
    }
    // 照**下次送審會用的那一份**重建。`resolveWorkflowFor` 是純算出來的，
    // 不看 `p.workflowStages`，所以先算後刪或先刪後算都一樣 —— 這裡不依賴順序
    const fresh = caseFromWorkflow(projectId, resolveWorkflowFor(p), state.employees);
    state = {
      ...state,
      projects: state.projects.map((x) => {
        if (x.id !== projectId) return x;
        // 真的把 key 拿掉。給 `undefined` 也行（JSON 會丟掉），但留著一個
        // 值是 undefined 的 key 會讓 `p.workflowStages ?? landed` 之外的
        // 判斷（`'workflowStages' in p`）讀到相反的答案
        const { workflowStages: _dropped, ...rest } = x;
        return rest as Project;
      }),
      cases: { ...state.cases, [projectId]: fresh },
    };
    // 簽核頁的 `approvals` 是個案的鏡像。不同步的話，重套完的案子在畫面上
    // 還掛著剛剛被清掉的那幾個「已簽」，而資料裡已經沒有了
    if (projectId === state.activeProjectId) syncApprovalsFromActiveCase();
    // 刻意不寫 event log：`EventKind` 沒有對應的種類，而為了這一個動作硬借
    // 一個現有的 kind（`review.withdraw`？`decision.record`？）會讓任何依 kind
    // 聚合的治理統計把它算成別的東西。要留紀錄就該新增一個 kind，那不屬於這一批
    emit();
    return { ok: true };
  },

  /* ─── 管理中心：個案調整 ─── */
  ensureCase(projectId: string): CaseRecord {
    if (state.cases[projectId] && !state.cases[projectId]!.withdrawn) {
      return state.cases[projectId]!;
    }
    const c = caseForProject(projectId);
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
      c = caseForProject(projectId);
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
        // 改派只改「派給誰」。原本這裡對已核准的關卡補上「· 已簽」後綴，
        // 於是這個欄位同時是狀態欄 —— 而重送審把狀態退回 pending 時沒人清得掉。
        ...stageAssignment(emp),
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
      c = caseForProject(projectId);
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
    const c = caseForProject(projectId);
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
    const c = caseForProject(projectId);
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

  /**
   * 匯入一份工作區 JSON。
   *
   * ## 這一條路要跟 `load()` 收斂同一套
   *
   * 原本這裡只做淺合併：`projects[].workflowStages` 的元素形狀完全沒有驗過，
   * 而 `load()` 那條路有 `migrateProject` / `sanitizeSkeletons`。**兩條吃的是同一份
   * 資料，卻只有一條在把關。** 後果不是理論上的：一份缺 `kind` 的關卡定義會讓
   * 管理中心的 `escapeHtml(STAGE_KIND_LABEL[s.kind])` 丟 TypeError，整頁停止
   * render，而且它掛在 `store.subscribe` 上，之後每次狀態變動都再炸一次。
   *
   * 所以下面四行是**明寫在 spread 之後**的：`...newState` 會把未收斂的原值蓋回來，
   * 順序反了等於什麼都沒做。
   */
  importState(newState: Partial<AppState>) {
    const base = seedState();
    // migrateProject 要拿員工名單去補 ownerId／authorAgentFamily —— 跟 load() 一樣
    // 優先用匯入檔自己的名單，沒有才回落種子
    const employees: Employee[] =
      Array.isArray(newState.employees) && newState.employees.length
        ? (newState.employees as Employee[])
        : base.employees;
    const workflowStages = (
      sanitizeStageDefs(newState.workflowStages) ?? base.workflowStages
    ).map((w) => ({ ...w, mode: w.mode ?? ("parallel" as const) }));
    const merged = {
      ...base,
      ...newState,
      // aiWriting 是後加的巢狀物件，淺合併會讓舊存檔拿到 undefined。
      // backends 同理，而且它的來源是可以手改的備份檔 —— 走跟 load() 同一支收斂。
      settings: withMigratedBackends({
        ...DEFAULT_SETTINGS,
        ...(newState.settings ?? {}),
        // 匯入的備份可能是任何一代格式 —— 走同一條遷移，不要兩條路徑各修各的
        aiWriting: migrateAiWriting(newState.settings?.aiWriting),
      }),
      projects: Array.isArray(newState.projects)
        ? newState.projects.map((pr) =>
            migrateProject(pr as unknown as Record<string, unknown>, employees),
          )
        : base.projects,
      workflowStages,
      workflowSkeletons: sanitizeSkeletons(newState.workflowSkeletons),
      cases: normalizeCases(newState.cases, workflowStages, employees),
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
        sections: withCustomSection(structuredClone(SEED_SECTIONS)),
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

  /* ─── Agent 後端清單 ─────────────────────────────────────────
   *
   * 純邏輯全部在 `lib/agent-backend.ts`（測得到）；這裡只做三件事：
   * 讀 state、驗證、寫 state。
   *
   * 一條貫穿全部方法的規則：**`default` 不是清單裡的一筆資料，是全域 AI
   * 設定的投影。** 所以它不可刪、不可改成 CLI，而改它就是改全域設定 ——
   * 存一份副本的話，使用者在設定頁換金鑰之後 agent 仍然會用舊的那把，
   * 而畫面上完全看不出來。
   */

  /** 目前存在的所有後端，`default` 一定在第一筆。UI 一律讀這支，不要直接讀 `settings.backends` */
  listBackends(): AgentBackend[] {
    return listBackends(state.settings);
  },

  /** 某個 agent 實際會用哪個後端。永遠給得出答案（找不到就回 `default`） */
  resolveBackend(agentId: string): AgentBackend {
    return resolveBackend(agentId, state.employees, state.settings);
  },

  addBackend(b: AgentBackend): { ok: boolean; reason?: string } {
    const idErr = backendIdError(b.id, listBackends(state.settings));
    if (idErr) return { ok: false, reason: idErr };
    if (b.kind === "cli" && !isCliTool(b.tool)) {
      return { ok: false, reason: `不支援的 CLI 工具「${String(b.tool)}」` };
    }
    // 走跟 load()／importState() 同一支收斂 —— 新增這條路如果自己驗一套，
    // 就會出現「加得進去、重新載入之後消失」的資料
    const clean = migrateBackends([b])[0];
    if (!clean) return { ok: false, reason: "後端設定不完整或形狀不支援" };
    state = {
      ...state,
      settings: { ...state.settings, backends: [...(state.settings.backends ?? []), clean] },
    };
    emit();
    return { ok: true };
  },

  updateBackend(id: string, patch: BackendPatch): { ok: boolean; reason?: string } {
    const want = id.trim();
    const cliFields = patch.tool !== undefined || patch.pathOverride !== undefined;
    const apiFields =
      patch.provider !== undefined ||
      patch.model !== undefined ||
      patch.endpoint !== undefined ||
      patch.apiKey !== undefined ||
      patch.localModelName !== undefined ||
      patch.temperature !== undefined;

    if (want === DEFAULT_BACKEND_ID) {
      if (cliFields) return { ok: false, reason: "預設後端是 API 後端，不能改成 CLI 後端" };
      if (patch.label !== undefined) {
        return { ok: false, reason: "預設後端的名稱由全域 AI 設定推導，不可單獨命名" };
      }
      // 改預設後端 ＝ 改全域設定。這是「一份真相」的實作，不是捷徑。
      const s: Partial<AISettings> = {};
      if (patch.provider !== undefined) s.provider = patch.provider;
      if (patch.model !== undefined) s.model = patch.model;
      if (patch.endpoint !== undefined) s.endpoint = patch.endpoint;
      if (patch.apiKey !== undefined) s.apiKey = patch.apiKey;
      if (patch.localModelName !== undefined) s.localModelName = patch.localModelName;
      if (patch.temperature !== undefined) s.temperature = patch.temperature;
      this.updateSettings(s);
      return { ok: true };
    }

    const list = state.settings.backends ?? [];
    const cur = list.find((b) => b.id === want);
    if (!cur) return { ok: false, reason: "找不到這個後端" };

    if (cur.kind === "cli") {
      if (apiFields) return { ok: false, reason: "CLI 後端沒有模型／金鑰這些欄位" };
      if (patch.tool !== undefined && !isCliTool(patch.tool)) {
        return { ok: false, reason: `不支援的 CLI 工具「${String(patch.tool)}」` };
      }
    } else if (cliFields) {
      return { ok: false, reason: "API 後端沒有 CLI 工具欄位" };
    }

    const next = { ...cur, ...patch } as AgentBackend;
    const clean = migrateBackends([next])[0];
    if (!clean) return { ok: false, reason: "改完之後的後端形狀不支援" };
    state = {
      ...state,
      settings: { ...state.settings, backends: list.map((b) => (b.id === want ? clean : b)) },
    };
    emit();
    return { ok: true };
  },

  /**
   * 刪除仍被 agent 綁著的後端要**擋下來並說出是誰在用**。
   *
   * 靜默刪掉的話那些 agent 會留著一個懸空 id；解析雖然會回退到 default
   * （所以不會爆），但使用者從此看到的是「我明明選了 opencode」而它走的是 API。
   * 那種不一致沒有錯誤訊息，只有帳單。
   */
  removeBackend(id: string): { ok: boolean; reason?: string } {
    const want = id.trim();
    if (want === DEFAULT_BACKEND_ID) {
      return { ok: false, reason: "預設後端不可刪除 —— 它是所有 agent 的回退目標" };
    }
    const list = state.settings.backends ?? [];
    if (!list.some((b) => b.id === want)) return { ok: false, reason: "找不到這個後端" };
    const users = backendUsers(want, state.employees);
    if (users.length) {
      const names = users.map((u) => `「${u.name}」`).join("、");
      return { ok: false, reason: `${names} 仍在使用這個後端，請先改綁其他後端` };
    }
    state = {
      ...state,
      settings: { ...state.settings, backends: list.filter((b) => b.id !== want) },
    };
    emit();
    return { ok: true };
  },

  /** 綁定／解綁。傳 `null` 是解綁，解綁之後回落 `default` */
  setAgentBackend(agentId: string, backendId: string | null): { ok: boolean; reason?: string } {
    const e = state.employees.find((x) => x.id === agentId);
    if (!e || e.kind !== "agent") return { ok: false, reason: "不是 Agent" };
    const want = (backendId ?? "").trim();
    if (!want) return this.updateEmployee(agentId, { backendId: undefined });
    // 不存在就擋 —— 寫進去的懸空 id 之後沒有任何地方會再檢查一次
    if (!listBackends(state.settings).some((b) => b.id === want)) {
      return { ok: false, reason: `找不到後端「${want}」` };
    }
    return this.updateEmployee(agentId, { backendId: want });
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

  /** 建立時決定動哪一段 —— 層級決定取號要過哪一道閘門 */
  createRelease(projectId?: string, level: ReleaseLevelId = "patch"): Release {
    const pid = projectId ?? state.activeProjectId;
    const r = { ...draftRelease(pid, `rel-${Date.now()}`, nowIso()), level, releasedAt: null };
    state = { ...state, releases: [r, ...state.releases] };
    emit();
    return r;
  },

  /** 版號改動要先過驗證，呼叫端拿到 ok:false 就不要寫進去 */
  updateRelease(id: string, patch: Partial<Release>): { ok: boolean; reason?: string } {
    const cur = state.releases.find((r) => r.id === id);
    if (!cur) return { ok: false, reason: "找不到這一版" };
    if (patch.version !== undefined) {
      const proj = state.projects.find((x) => x.id === cur.projectId);
      const v = validateVersion(patch.version, cur.projectId, state.releases, id, policyOf(proj));
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

  /**
   * 加一個項目。**擋兩件事**：跨路線的來源，以及已被別的版號收走的 ref。
   *
   * 擋在 store 而不是只擋在畫面上：候選清單已經過濾過，但手打與之後可能
   * 出現的其他入口不會，而重複收同一筆 commit 的後果是兩份 release note
   * 都宣稱擁有它，讀的人無從判斷。
   */
  addReleaseItem(id: string, item: Omit<ReleaseItem, "id">): { ok: boolean; reason?: string } {
    const cur = state.releases.find((r) => r.id === id);
    if (!cur) return { ok: false, reason: "找不到這一版" };
    const check = canAddItem(cur, item, state.releases);
    if (!check.ok) return check;

    const withId: ReleaseItem = { ...item, id: `ri-${Date.now()}-${Math.round(performance.now())}` };
    state = {
      ...state,
      releases: state.releases.map((r) =>
        r.id === id ? { ...r, items: [...r.items, withId], updatedAt: nowIso() } : r,
      ),
    };
    emit();
    return { ok: true };
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

  /**
   * 切換版號政策。**單向：loose → strict 可以，反過來不行。**
   *
   * 擋回頭不是為了懲罰反悔。strict 底下發出去的版號帶著保證 ——
   * `v1.02.00` 的 YY 是「這一版走過 OpenSpec」的憑證。退回 loose 之後
   * 那個保證沒有東西背書，而號已經在 git tag 與別人的 changelog 裡了。
   *
   * 換句話說：可以撤回的是規則，撤不回的是已經用那條規則發出去的號。
   */
  setVersionPolicy(projectId: string, policy: VersionPolicy): { ok: boolean; reason?: string } {
    const p = state.projects.find((x) => x.id === projectId);
    if (!p) return { ok: false, reason: "找不到這個專案" };
    if (policyOf(p) === "strict" && policy === "loose") {
      return {
        ok: false,
        reason: "這個專案已經採 vX.YY.ZZ，不能改回寬鬆 —— 已經發出去的版號會失去依據。",
      };
    }
    if (policyOf(p) === policy) return { ok: true };
    state = {
      ...state,
      projects: state.projects.map((x) =>
        x.id === projectId ? { ...x, versionPolicy: policy } : x,
      ),
    };
    emit();
    syncProfile(state, projectId);
    return { ok: true };
  },

  /**
   * 正式放行。**取號是規劃，放行才是「要出去了」。**
   *
   * 分成兩個動作而不是自動推導：push 出去收不回來，那個決定要有一個
   * 明確按下去的瞬間。放行後內容不能再改（`canAddItem` 會擋）。
   */
  releaseNow(id: string): { ok: boolean; reason?: string } {
    const cur = state.releases.find((r) => r.id === id);
    if (!cur) return { ok: false, reason: "找不到這一版" };
    if (cur.releasedAt) return { ok: false, reason: "這一版已經放行過了" };
    if (!cur.items.length) return { ok: false, reason: "這一版還沒有任何內容" };
    const iso = nowIso();
    state = {
      ...state,
      releases: state.releases.map((r) =>
        r.id === id ? { ...r, releasedAt: iso, updatedAt: iso } : r,
      ),
    };
    emit();
    return { ok: true };
  },

  /** 撤回放行。還沒 push 出去之前反悔是正常的，所以這條路要留著。 */
  unreleaseNow(id: string): { ok: boolean; reason?: string } {
    const cur = state.releases.find((r) => r.id === id);
    if (!cur) return { ok: false, reason: "找不到這一版" };
    state = {
      ...state,
      releases: state.releases.map((r) =>
        r.id === id ? { ...r, releasedAt: null, updatedAt: nowIso() } : r,
      ),
    };
    emit();
    return { ok: true };
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
    /** 綁定簽核關卡：結果會貼在那一關上（簽核頁的「執行分析」走這裡） */
    stageId?: string;
    /** 綁定版號：送交執行的進度會貼回那一版（版本取號頁） */
    releaseId?: string;
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

    // 綁關卡的任務只在案子真的送審之後才成立。草稿專案的個案是建立當下順手開的，
    // 送審會照落地流程整個重建 —— 現在跑出來的分析存下去也會靜默消失，而工作單
    // 已標 `saved`、`discardAgentResult` 也拒絕重來，那份分析救不回來
    if (opts.stageId && project.status === "draft") {
      return { ok: false, reason: NOT_SUBMITTED };
    }

    // 同 family 不可**審查**自己家族寫的文件。
    //
    // 判準是「這次任務是不是在審」，不是「有沒有綁關卡」：族系隔離守的是審查，
    // 不是撰寫。`edit`／`coach` 是 agent 在產出內文，而 agent 寫 PRD 正是這個
    // 產品在做的事 —— 擋掉 claude 幫 claude 寫的「文件補完」保護不了任何東西。
    //
    // 原本這裡只擋 `approve`，而簽核頁的審查關卡送的是 `task: "review"`
    // （`pages/signoff.ts`），所以真實的 agent 審查路徑全程沒有族系檢查。
    if (
      (opts.task === "approve" || opts.task === "review") &&
      project.authorAgentFamily &&
      agent.agentFamily &&
      project.authorAgentFamily === agent.agentFamily
    ) {
      return {
        ok: false,
        reason: `同一種 Agent（${agent.agentFamily}）已撰寫此文件，不可再擔任審查`,
      };
    }

    const jobId = `job-${Date.now()}`;
    const job: AgentJob = {
      id: jobId,
      agentId: agent.id,
      agentName: `${agent.name} · ${agent.accessRole === "approver" ? "核准" : "編輯"}`,
      projectId: project.id,
      projectTitle: project.title,
      ...(opts.stageId ? { stageId: opts.stageId } : {}),
      ...(opts.releaseId ? { releaseId: opts.releaseId } : {}),
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
                  // 跑完了但還沒落地。失敗的工作單不進這個狀態 —— 沒有結果可以存，
                  // 標成待確認只會在畫面上多一顆按不出東西的按鈕
                  ...(status === "done" ? { landed: "pending" as const } : {}),
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
        // **這個專案的**正文，不是畫面上正在開著的那一份。
        //
        // 原本讀 `state.sectionValues`（＝ active 專案的投影）。對別的專案下
        // 工作單時，送進模型的會是另一個專案的內文 —— 分析看起來完全正常，
        // 只是講的是錯的文件。簽核頁對非 active 專案執行分析就會踩到。
        const bag =
          project.id === state.activeProjectId
            ? state.sectionValues
            : (state.projectSectionValues[project.id] ?? {});
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

        // **這裡刻意什麼都不改。**
        //
        // 以前跑完就直接寫 state：`edit`/`coach` 把摘要追加進「開放問題」欄位、
        // `review`/`approve` 自動貼一則留言。使用者沒機會看完整內容再決定 ——
        // 文件被改了，而且沒有任何地方問過他。更糟的是那份摘要寫的是
        // 「見進場紀錄全文」，等於在 PRD 裡留一行指向別處的佔位字串。
        //
        // 落地改由 `saveAgentResult` / `discardAgentResult` 拍板，工作單先停在
        // `landed: "pending"`。
        mark("done", result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        mark("failed", `進場失敗：${msg}`);
      }
    })();

    return { ok: true, jobId };
  },

  /**
   * 這個專案還有哪幾份 Agent 分析在等人拍板（新到舊）。純讀，不動 state。
   *
   * 兩個用途共用同一份判斷，這是重點：結案閘門用它決定「擋不擋」，簽核頁的
   * 攔截對話框用它列出「要處理哪幾張」。UI 自己再篩一次的話，兩份條件會分岔，
   * 而症狀是「對話框說沒有待辦，按下去卻還是被擋」—— 一個沒有出口的迴圈。
   */
  pendingAgentJobs(projectId: string): AgentJob[] {
    return pendingJobsFor(projectId);
  },

  /**
   * 把一份跑完的 Agent 結果**落地**。
   *
   * 這是 `invokeAgent` 拿掉自動副作用之後的另一半：跑完只是有了結果，要不要
   * 進到文件裡是一個獨立的、使用者按下去的決定。
   *
   * 兩種落地方式，由關卡的 `kind` 決定（舊個案沒有 kind，一律當 `review`）：
   * - `review` —— 意見**釘在關卡上**（寫進 `CaseStage.comment`），不碰 PRD 內文。
   *   沒有綁關卡的一般進場（Agent 管理頁）退回貼一則留言，那是它唯一的去處。
   * - `edit` —— 寫進關卡指定的 PRD 欄位。`editTarget` 缺值時退回「開放問題」，
   *   那是舊版靜默追加摘要的地方 —— 落地目標不變，變的是這次問過人。
   *
   * 為什麼 `edit` 是整段替換而不是逐條套用：逐條勾選的 diff UI 這一輪不做
   * （規格「不做」那一節）。整段替換配上存檔前的前後對照，是這個階段講得清楚
   * 而且不會騙人的做法。
   */
  saveAgentResult(jobId: string): { ok: boolean; reason?: string } {
    const job = state.agentJobs.find((j) => j.id === jobId);
    if (!job) return { ok: false, reason: "找不到這張工作單" };
    if (job.status !== "done") return { ok: false, reason: "這張工作單還沒跑完" };
    if (!job.result.trim()) return { ok: false, reason: "這張工作單沒有結果可以存" };
    // 已經落地過的不再落地一次。重複按下去會把同一份意見貼兩遍，
    // 而簽核紀錄上那兩筆看起來像兩次獨立的審查。
    // 沒有 `landed` 的是升級前的舊工作單 —— 它們的副作用當年已經寫進文件了
    if (jobLanded(job) === "saved") return { ok: false, reason: "這份結果已經存過了" };

    const at = nowIso();
    const c = state.cases[job.projectId];
    const stage = job.stageId ? c?.stages.find((s) => s.id === job.stageId) : undefined;

    // 綁關卡的落地會改**文件或簽核個案**，所以要有閘門。原本這支完全沒有：
    // 沒有權限、沒有 `locked`、沒有 `withdrawn`、沒有 `project.status`。
    // 舊版把這個寫入藏在 `invokeAgent` 裡時同樣沒閘門，但這批把它拉出來變成
    // 一支公開的 store API —— 等於把只有背景流程走得到的寫入變成 Wave 2
    // 隨時可按的按鈕。趕在 UI 接上之前補，成本最低。
    if (job.stageId) {
      const project = state.projects.find((p) => p.id === job.projectId);
      if (!project) return { ok: false, reason: "找不到專案" };
      if (!stage) return { ok: false, reason: "找不到這一關" };
      if (!c || c.withdrawn) return { ok: false, reason: "此案已抽單" };
      if (c.locked) return { ok: false, reason: "此案已結案鎖定" };
      if (project.status !== "review") {
        return { ok: false, reason: "這個案子目前不在審閱中，無法落地" };
      }
      // `edit` 關卡真的會覆寫 PRD 內文，所以要的是編輯權限而不是簽核權限
      if (stageKind(stage) === "edit" && !canEditContent(state.currentUser)) {
        return { ok: false, reason: "目前身分無法編輯內文" };
      }
    }

    if (stage && stageKind(stage) === "edit") {
      // 退路走共用的 `resolveEditTarget`：pop-up 的「現值」左欄、指派時的警語、
      // 以及這裡真正的寫入，三者必須指向同一個欄位。分岔的話三個畫面各自都對，
      // 只有文件是錯的。
      const target = resolveEditTarget(stage.editTarget);
      const bag = state.projectSectionValues[job.projectId] ?? {};
      const section = bag[target.sectionId] ?? {};
      state = {
        ...state,
        projectSectionValues: {
          ...state.projectSectionValues,
          [job.projectId]: {
            ...bag,
            [target.sectionId]: { ...section, [target.fieldKey]: job.result },
          },
        },
        // 正文袋與畫面上那一份是同一件事的兩個投影，只改一邊會讓編輯台
        // 顯示舊內容直到切換專案為止
        ...(job.projectId === state.activeProjectId
          ? {
              sectionValues: {
                ...state.sectionValues,
                [target.sectionId]: {
                  ...(state.sectionValues[target.sectionId] ?? {}),
                  [target.fieldKey]: job.result,
                },
              },
            }
          : {}),
      };
    } else if (stage) {
      // review 關卡：分析釘在關卡上。寫 `agentResult` 而不是 `comment` ——
      // 後者是**簽核意見**（`sign()` / `requestChanges` / `skipStage` 都寫它），
      // 兩邊共用一個欄位會互相覆寫：簽核者留的那句話會被四千字分析吃掉，
      // 而 `stageReasons` 與舊個案的反推路徑會把 agent 的分析當成簽核者說的話
      // 掛在人名下。不動關卡狀態 —— 存下分析不等於簽了它。
      state = {
        ...state,
        cases: {
          ...state.cases,
          [job.projectId]: {
            ...c!,
            stages: c!.stages.map((s) =>
              s.id === stage.id ? { ...s, agentResult: job.result.slice(0, 4000) } : s,
            ),
          },
        },
      };
    } else {
      // 沒綁關卡的一般進場：留言是它唯一的去處
      const agent = state.employees.find((e) => e.id === job.agentId);
      state = {
        ...state,
        comments: [
          {
            id: `c${Date.now()}`,
            projectId: job.projectId,
            author: job.agentName,
            authorId: job.agentId,
            avatar: agent?.avatar ?? "AI",
            time: "剛剛",
            anchor: "§ Agent 進場",
            body: job.result.slice(0, 1200),
            resolved: false,
          },
          ...state.comments,
        ],
      };
    }

    state = {
      ...state,
      agentJobs: state.agentJobs.map((j) => (j.id === jobId ? { ...j, landed: "saved" as const } : j)),
    };
    touchProjectMeta(job.projectId);
    audit(state, job.projectId, "agent.result.saved", `prd:${job.projectId}`, {
      job: jobId,
      stage: job.stageId ?? "none",
      at,
    });
    emit();
    return { ok: true };
  },

  /**
   * 丟掉一份跑完的 Agent 結果。
   *
   * **全文留著**，只把落地狀態標成 `discarded`：使用者要看得到「我叫它跑過、
   * 而且我決定不用」。刪掉全文的話，那個決定在紀錄上跟「從來沒跑過」一模一樣。
   */
  discardAgentResult(jobId: string): { ok: boolean; reason?: string } {
    const job = state.agentJobs.find((j) => j.id === jobId);
    if (!job) return { ok: false, reason: "找不到這張工作單" };
    if (jobLanded(job) === "saved") {
      return { ok: false, reason: "這份結果已經存進文件了，不能改成不採用" };
    }
    state = {
      ...state,
      agentJobs: state.agentJobs.map((j) =>
        j.id === jobId ? { ...j, landed: "discarded" as const } : j,
      ),
    };
    emit();
    return { ok: true };
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
