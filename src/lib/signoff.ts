/**
 * 簽核的判斷與敘事 —— 全部純函式，零 I/O、零 DOM。
 *
 * ## 為什麼要有這個檔
 *
 * 「這個人現在能不能簽這一關」目前**散在兩個地方**：專案層級的職責分立在
 * `permissions.ts` 的 `canApproveProject`，關卡層級的歸屬是寫在
 * `store.approveAndLock` 迴圈裡的行內條件。畫面要顯示「為什麼這顆按鈕不能按」
 * 的時候，第二個判斷根本沒有東西可以呼叫 —— 只能再抄一份，然後兩份慢慢分岔。
 *
 * ## 簽核紀錄是「併出來的」，不是某個地方存好的
 *
 * 這條時間軸有四個來源，各自只知道故事的一段：關卡上的決策戳記、
 * `prdVersions` 的送審與合併、`CaseRecord` 的抽單欄位、以及稽核事件。
 * 稽核事件**只有桌面版＋有綁資料夾的專案才寫得出來**，所以它是加分項不是骨幹；
 * 少了它時間軸仍然成立，只是少幾筆。這件事要寫在畫面上，不能讓人以為
 * 「沒有紀錄」等於「沒發生過」。
 */
import type {
  AgentJob,
  CaseDecision,
  CaseRecord,
  CaseStage,
  Employee,
  PrdVersion,
  Project,
  WorkflowStageDef,
} from "../data/types";
import { isPendingAgentJob, stageKind } from "../data/types";
import { hasPermission } from "./permissions";
import { stageBlockedBy } from "./prd-versions";

export type SignAbility =
  | { can: true }
  /** 不能簽，而且要講得出是哪一種不能 —— 「按鈕是灰的」不是解釋 */
  | { can: false; reason: string };

/**
 * 職責分立 —— 誰**永遠**不能簽這份文件，跟關卡是哪一關無關。
 *
 * ## 為什麼族系隔離排在自審之前
 *
 * 這套工具原本假設「公司有很多人」：擋自審靠的是總會有第二個人來簽。個人
 * 工作台沒有那個第二個人 —— 實際上場的是一排 agent，而使用者很自然會拿同一家
 * 模型去審它自己寫的東西。那條路上沒有任何人會發現問題，因為審查者跟作者
 * 共用同一組盲點。所以族系隔離在這裡是**主要守門**，不是自審規則的補充條款，
 * 判定順序也照這個優先級排：先講族系，再講本人。
 *
 * ## 族系比對的主體是「這一關派給誰」，不是「誰按下按鈕」
 *
 * 這條規則原本只看 `user.kind === "agent"`，而那在真實流程裡**永遠不會觸發**：
 * agent 只跑 `invokeAgent` 產出分析，簽核的一律是人（`approveAndLock` 的
 * `currentUser` 是 human admin）。於是「同一家模型審自己家寫的文件」全程零攔阻，
 * 而 D3 明寫族系隔離是主要守門。
 *
 * 會不會發生同族系審查，取決於**這一關派給了哪個執行者**。所以主要判斷是
 * `stage.assigneeId` 指向的那個人；`user` 那一條保留下來當第二層 —— agent 直接
 * 當簽核者的路徑目前走不到，但走得到的時候它仍然該擋。
 *
 * ## 只擋 review 關卡
 *
 * 族系隔離守的是**審查**，不是撰寫。`edit` 關卡（「文件補完」）是 agent 在
 * 產出內文，而 agent 寫 PRD 正是這個產品在做的事 —— 擋掉 claude 幫 claude 寫的
 * 文件補完保護不了任何東西，只會讓人困惑。那一關的把關發生在人看過前後對照
 * 才按存檔的那一刻。
 *
 * 導出是給 `store.resolveComment` 用的：留言覆核要的是**專案層級**的職責分立
 * （不帶 stage 呼叫即可）。收斂時那裡被換成純角色的 `canApprove`，等於讓同族系
 * agent 可以把自己家族寫的文件上的所有審查留言標記為已解決。
 */
export function separationOfDuties(
  user: Employee,
  project: Project | null | undefined,
  /** 這一關與員工清單。省略時只做專案層級的判斷（留言覆核就是這樣用） */
  stage?: CaseStage,
  employees?: readonly Employee[],
): SignAbility {
  if (!project) return { can: true };

  // 這一關的**執行者**與作者同族系 → 擋。**沒有 admin 例外**：
  // 代簽可以繞過「這一關不是你的」，繞不過「審查者跟作者是同一顆腦袋」。
  if (stage && employees && stage.assigneeId && stageKind(stage) === "review") {
    const executor = employees.find((e) => e.id === stage.assigneeId);
    if (
      executor?.kind === "agent" &&
      executor.agentFamily &&
      project.authorAgentFamily === executor.agentFamily
    ) {
      return {
        can: false,
        reason: `這一關派給了 ${executor.agentFamily} 家族的 Agent，而本文件正是 ${project.authorAgentFamily} 家族撰寫 —— 請改派其他族系的執行者`,
      };
    }
  }

  // 簽核者本身是同族系 agent。真實流程裡簽的是人，所以這一條走不到 ——
  // 留著是因為它一旦走得到就一定要擋，而規則本身沒有錯，錯的是只有它。
  if (
    user.kind === "agent" &&
    project.authorAgentFamily &&
    user.agentFamily &&
    project.authorAgentFamily === user.agentFamily
  ) {
    return {
      can: false,
      reason: `同一種 Agent（${project.authorAgentFamily}）已撰寫此文件，不可再擔任核准角色`,
    };
  }

  // 人的自審：admin 例外照舊 —— 那是既有行為，而且 admin 代簽會另外留一筆
  // `override` 決策，紀錄上看得見「一個人簽完全部」這件事
  if (user.accessRole !== "admin" && project.authorId === user.id) {
    return { can: false, reason: "不可核准自己撰寫的文件" };
  }

  return { can: true };
}

/**
 * 這個案子**跑過簽核流程**了嗎。
 *
 * ## 為什麼這個判斷這麼要緊
 *
 * 建專案時就會先開一個個案（走建立當下的全域預設流程），所以「有個案」不等於
 * 「跑過」。送審靠這個判斷決定要不要照專案自己那份流程重建個案，而**判成 true
 * 就會把舊個案的關卡永久寫進 `project.workflowStages`** —— `p.workflowStages ?? landed`
 * 落地過就不再覆寫，之後重新套範本也救不回來。
 *
 * 所以這裡問的必須是「流程狀態上有沒有進展」，不是「有沒有人在上面留下字」。
 * `kind: "comment"`（保留意見）不改變任何關卡的狀態：把它算成跑過，等於送審前
 * 隨手加註一句，這個專案就永久沿用建專案當下那套全域關卡 —— 範本骨架與領域包
 * 的合規關卡從此不會出現，而且畫面上沒有任何提示。
 */
export function caseHasRun(c: CaseRecord | null | undefined): boolean {
  if (!c) return false;
  if (c.reviewCommitId) return true;
  // 決策裡只有「保留意見」不算；其餘（核准／要求修改／略過／代簽）都改變流程狀態
  if (c.log?.some((d) => d.kind !== "comment")) return true;
  return c.stages.some(
    (s) =>
      s.state === "approved" ||
      s.state === "changes_requested" ||
      // 略過是結案的一種。漏掉它時剛好被上面的 log 判斷蓋住 —— 兩個判準
      // 互相補償是巧合不是設計，把 log 收緊之後就會真的漏
      s.state === "skipped" ||
      // 存過的 agent 分析也是痕跡：重建個案會讓它靜默消失，而工作單已標
      // `saved`、`discardAgentResult` 也拒絕重來，那份分析救不回來
      Boolean(s.agentResult?.trim()),
  );
}

/**
 * 從流程定義長出個案關卡 —— **建立關卡的唯一原語**。
 *
 * 原本是 `store.caseFromWorkflow` 的函式體。搬出來的理由只有一個：簽核頁在
 * 送審前要畫「送審時**真的會建立**的那一份流程」，而 UI 照著 `WorkflowStageDef`
 * 自己再刻一份的話，兩份會分岔 —— 分岔的症狀正是這一輪要修的缺陷：
 * 畫面顯示的關卡 ≠ 送審會建立的關卡，沒有錯誤訊息，看起來完全正常。
 *
 * 所以預覽與真的送審現在跑的是**同一支函式、同一份輸入**。要讓它們講不同的話，
 * 得先讓這支函式對同樣的輸入回不同的答案。
 *
 * `assignments` 見 `caseFromWorkflow` 原註解：`w.id in assignments` 判斷「有沒有
 * 提到這一關」，`null` 是明確的「這一關不派人」，跟沒提到不同。
 */
export function stagesFromWorkflow(
  projectId: string,
  workflow: readonly WorkflowStageDef[],
  employees: readonly Employee[],
  assignments?: Record<string, string | null>,
): CaseStage[] {
  const byId = Object.fromEntries(employees.map((e) => [e.id, e]));
  return [...workflow]
    .sort((a, b) => a.order - b.order)
    .map((w) => {
      // 逐關指派蓋過範本的預設執行者。`null` 是明確的「這一關不派人」，
      // 跟「沒有提到這一關」不同 —— 後者才退回 defaultAssigneeId
      const picked = assignments && w.id in assignments ? assignments[w.id] : w.defaultAssigneeId;
      const emp = picked ? byId[picked] : null;
      return {
        id: `cs-${w.id}-${projectId}`,
        stageDefId: w.id,
        order: w.order,
        name: w.name,
        assigneeId: emp?.id ?? null,
        assigneeName: emp ? emp.name : "待指派",
        state: emp ? ("pending" as const) : ("empty" as const),
        mode: w.mode ?? "parallel",
        required: w.required,
        // kind 與 editTarget 從流程定義複製到個案上。不複製的話，簽核頁要靠
        // stageDefId 回頭查流程定義 —— 而流程可能已經被改過，那時查到的
        // 是「現在的定義」，不是這個案子當初依據的那一份
        kind: w.kind,
        ...(w.editTarget ? { editTarget: { ...w.editTarget } } : {}),
      };
    });
}

/**
 * 簽核頁該畫哪一份關卡 —— **送審前的那份個案關卡是假的**。
 *
 * ## 缺陷長什麼樣
 *
 * `addProject` 建專案時就先開了一個個案，走的是**建立當下的全域**流程
 * （`seed.ts` 的四關：工程／設計／資安／法務）。而這個專案真正要跑的骨架
 * 要到第一次送審才落地。於是簽核頁在送審前顯示的，是一套送出那一刻就會被
 * 整批換掉的關卡 —— 而頭條還寫著「流程有 4 關，按送出審閱之後才會開始跑」，
 * 暗示這 4 關就是要跑的那一份。
 *
 * ## 判斷一律問 `store.submitPlan()`
 *
 * 這裡**不重寫一份 `caseHasRun`**。那正是 W2-A 把判斷抽進 `submitPlan` 要防的
 * 分岔，而分岔的症狀就是這次這種「畫面說的跟實際跑的不是同一件事」。
 *
 * `view` 是餵給 `signoffSummary` / `stageRows` 的那一份個案：預覽時是照送審
 * 計畫算出來的替身，其餘欄位（`withdrawn`、`locked`、`reviewCommitId`）原封
 * 沿用真的那一份 —— 抽單的案子仍然要講「此案已抽單」，不能被預覽蓋掉。
 */
export type SignoffStageView = {
  /** true = 眼前這份關卡是送審時就會被整批換掉的，畫面上必須標明是預覽 */
  preview: boolean;
  /** 要畫在畫面上的關卡 */
  stages: CaseStage[];
  /** 餵給 `signoffSummary` / `stageRows` 的個案（預覽時是替身） */
  view: CaseRecord | undefined;
};

export function signoffStageView(opts: {
  projectId: string;
  /** `store.submitPlan(projectId)` 的回傳，原封不動 */
  plan: { landsNow: boolean; stages: readonly WorkflowStageDef[] };
  c: CaseRecord | undefined;
  employees: readonly Employee[];
}): SignoffStageView {
  const { projectId, plan, c, employees } = opts;
  if (!plan.landsNow) return { preview: false, stages: c?.stages ?? [], view: c };
  const stages = stagesFromWorkflow(projectId, plan.stages, employees);
  const view: CaseRecord = c
    ? { ...c, stages }
    : {
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
  return { preview: true, stages, view };
}

/**
 * 這個人現在能不能簽這一關 —— **簽核權限的唯一入口**。
 *
 * 以前這件事散在三個地方各判一次：`permissions.canApproveProject`（專案層級的
 * 職責分立）、這支（關卡層級的歸屬）、以及 `store.approveAndLock` 迴圈裡的
 * 行內條件。三份判斷慢慢分岔，而畫面要解釋「為什麼這顆按鈕不能按」的時候，
 * 第三份根本沒有東西可以呼叫，只能再抄一次。
 *
 * 順序是刻意的：先講案子層級的阻擋（抽單／已結案），再講順序閘門，再講職責
 * 分立，最後才是關卡歸屬。反過來的話，一個被抽單的案子會顯示「這關不是你的」，
 * 而真正的原因是整個案子都停了。
 *
 * `reason` 是**使用者會讀到的解釋**，不是除錯訊息。「按鈕是灰的」不是解釋。
 */
export function canSignStage(
  user: Employee,
  project: Project,
  stage: CaseStage,
  c: CaseRecord | undefined,
  opts: {
    /**
     * 管理員代簽。放行的只有「這一關不是你的」與順序閘門 —— 那正是代簽的定義。
     * 職責分立擋下來的一律照擋：代簽的用意是讓一個人走完流程**而且看得見**，
     * 不是讓他變成任何人。
     */
    override?: boolean;
    /**
     * 員工清單 —— 用來查**這一關的執行者**是誰家的模型。
     *
     * 沒給就只做得到「按按鈕的人」那一層族系判斷，而那一層在真實流程裡從來
     * 不會觸發（簽的永遠是人）。呼叫端拿得到員工清單時務必傳進來。
     */
    employees?: readonly Employee[];
  } = {},
): SignAbility {
  if (!c) return { can: false, reason: "這個專案還沒有簽核個案" };
  if (c.withdrawn) return { can: false, reason: "此案已抽單" };
  if (stage.state === "approved") return { can: false, reason: "這一關已核准" };
  if (stage.state === "skipped") return { can: false, reason: "這一關已略過" };

  if (!hasPermission(user, "approve")) {
    return { can: false, reason: "目前角色無簽核權限（需核准人員或管理員）" };
  }

  const duties = separationOfDuties(user, project, stage, opts.employees);
  if (!duties.can) return duties;

  if (opts.override) {
    return user.accessRole === "admin"
      ? { can: true }
      : { can: false, reason: "只有管理員可以代簽" };
  }

  // 順序閘門：串行的關卡被前面擋住時，說「這一關不是你的」是錯的診斷
  const blocker = stageBlockedBy(stage, c.stages);
  if (blocker) return { can: false, reason: `等「${blocker}」先過` };

  if (user.accessRole === "admin") return { can: true };
  if (stage.assigneeId === user.id) return { can: true };
  if (!stage.assigneeId && user.accessRole === "approver") return { can: true };
  return {
    can: false,
    reason: stage.assigneeId ? `這一關指派給 ${stage.assigneeName || "其他人"}` : "這一關未指派",
  };
}

/**
 * 這個人在這個案子上簽得動任何一關嗎。
 *
 * 給「核准並鎖定」那顆按鈕用 —— 它按下去是 `approveAndLock()` 不帶
 * `stageIds`，語意就是「把我簽得動的都簽掉」。所以它的 enable 條件必須跟
 * 那個迴圈用同一個判斷，否則會出現按得下去卻回「現在沒有你可以簽的關卡」。
 *
 * 沒有任何一關可簽時要講得出**第一個**理由，不是含糊的「無法簽核」；
 * 全部關卡都簽完的情況另外講，那不是「沒有權限」。
 */
export function canSignAnyStage(
  user: Employee,
  project: Project,
  c: CaseRecord | undefined,
  /** 員工清單。傳進去才判得到「這一關的執行者跟作者同族系」 */
  employees?: readonly Employee[],
): SignAbility {
  if (!c) return { can: false, reason: "這個專案還沒有簽核個案" };
  if (!c.stages.length) return { can: false, reason: "這個流程還沒有關卡" };
  const abilities = c.stages.map((s) => canSignStage(user, project, s, c, { employees }));
  if (abilities.some((a) => a.can)) return { can: true };
  const open = c.stages.filter((s) => s.state !== "approved" && s.state !== "skipped");
  if (!open.length) return { can: false, reason: "所有關卡都已結案" };
  const first = abilities.find((a) => !a.can) as { can: false; reason: string };
  return { can: false, reason: first.reason };
}

export type StageRow = {
  stage: CaseStage;
  /** 中文狀態詞。`skipped` 在現行程式碼裡沒有任何路徑產生，但舊資料可能有 */
  label: string;
  ability: SignAbility;
};

export function stageRows(
  user: Employee,
  project: Project,
  c: CaseRecord | undefined,
): StageRow[] {
  const label: Record<CaseStage["state"], string> = {
    approved: "已核准",
    changes_requested: "要求修改",
    pending: "待簽核",
    empty: "未指派",
    skipped: "略過",
  };
  return [...(c?.stages ?? [])]
    .sort((a, b) => a.order - b.order)
    .map((stage) => ({ stage, label: label[stage.state], ability: canSignStage(user, project, stage, c) }));
}

export type SignoffSummary = {
  approved: number;
  total: number;
  /** 還沒簽、而且是**我**可以簽的那幾關 */
  mine: CaseStage[];
  /** 在等別人的那幾關 */
  waiting: CaseStage[];
  state: "none" | "draft" | "review" | "needs_fix" | "withdrawn" | "approved";
  headline: string;
  detail: string;
  /** 被要求修改的關卡。`needs_fix` 時畫面要直接列出來 */
  changesRequested: CaseStage[];
};

/**
 * 送審前那句頭條的兩種講法。
 *
 * 舊的那句「流程有 N 關。到編輯台按『送出審閱』之後才會開始跑」在預覽狀態下
 * 是假的 —— 它暗示眼前這 N 關就是要跑的那一份，而那份個案關卡送出那一刻就會
 * 被整批換掉。文案與行為對不上，不管往哪個方向錯都是同一個缺陷。
 *
 * 預覽那句敢說「送出審閱時才會照現在的範本建立」，是因為
 * `signoffStageView` 畫的就是 `store.submitPlan()` 交出來的那一份。
 * 測試 `送審前的頭條講的話，跟 submitPlan 真的會建立的那份逐字對得上` 釘住這件事。
 */
export const PREVIEW_DETAIL = (n: number) =>
  `這是預覽 —— 送出審閱時才會照現在的範本建立這 ${n} 關，屆時會逐關問你派給誰。`;

export function signoffSummary(
  user: Employee,
  project: Project,
  c: CaseRecord | undefined,
  /**
   * `preview: true` = `c` 是 `signoffStageView` 算出來的替身，關卡還沒建立。
   * 選填是刻意的：既有呼叫端（畫唯讀卡片的那幾處）不需要知道這件事。
   */
  opts?: { preview?: boolean },
): SignoffSummary {
  const rows = stageRows(user, project, c);
  const approved = rows.filter((r) => r.stage.state === "approved").length;
  const total = rows.length;
  const mine = rows.filter((r) => r.ability.can).map((r) => r.stage);
  const waiting = rows
    .filter((r) => !r.ability.can && r.stage.state !== "approved" && r.stage.state !== "skipped")
    .map((r) => r.stage);
  const changesRequested = rows
    .filter((r) => r.stage.state === "changes_requested")
    .map((r) => r.stage);
  // 必簽關卡才決定「是不是全過了」—— 非必簽的沒簽不擋
  const gating = rows.filter((r) => r.stage.required !== false);
  const allSettled = gating.length > 0 && gating.every((r) => r.stage.state === "approved");

  if (!c || !total) {
    return {
      approved,
      total,
      mine,
      waiting,
      changesRequested,
      state: "none",
      headline: "還沒有簽核個案",
      detail: "在管理中心設定簽核流程，或直接送出審閱 —— 送審時會依目前流程建立關卡。",
    };
  }
  if (c.withdrawn) {
    return {
      approved,
      total,
      mine,
      waiting,
      changesRequested,
      state: "withdrawn",
      headline: "此案已抽單",
      detail: c.withdrawReason?.trim() || "沒有留下抽單理由。",
    };
  }
  if (!c.reviewCommitId) {
    return {
      approved,
      total,
      mine,
      waiting,
      changesRequested,
      state: "draft",
      headline: "尚未送審",
      detail: opts?.preview
        ? PREVIEW_DETAIL(total)
        : `流程有 ${total} 關。到編輯台按「送出審閱」之後才會開始跑。`,
    };
  }
  // 有人要求修改 → 球在作者身上，這比「還有幾關沒簽」重要得多
  if (changesRequested.length) {
    return {
      approved,
      total,
      mine,
      waiting,
      changesRequested,
      state: "needs_fix",
      headline: `要修改 —— ${changesRequested.length} 關退回`,
      detail: changesRequested
        .map((s) => `${s.name}：${s.comment?.trim() || "（沒有寫理由）"}`)
        .join("　"),
    };
  }
  if (allSettled) {
    return {
      approved,
      total,
      mine,
      waiting,
      changesRequested,
      state: "approved",
      headline: "必簽關卡都過了",
      detail: c.locked ? "案件已鎖定，內容已合併回主線。" : "可以合併回主線了。",
    };
  }
  if (mine.length) {
    return {
      approved,
      total,
      mine,
      waiting,
      changesRequested,
      state: "review",
      headline: `輪到你了 —— ${mine.length} 關等你簽`,
      detail: mine.map((s) => s.name).join("、"),
    };
  }
  // 被順序擋住時要講得出在等哪一關，而不是含糊的「審閱中」
  const firstWait = waiting[0];
  const blocker = firstWait ? stageBlockedBy(firstWait, c.stages) : null;
  return {
    approved,
    total,
    mine,
    waiting,
    changesRequested,
    state: "review",
    headline: blocker
      ? `等「${blocker}」先過`
      : firstWait
        ? `等 ${firstWait.assigneeName || "待指派"} 簽 ${firstWait.name}`
        : "審閱中",
    detail: waiting.length > 1 ? `後面還有 ${waiting.length - 1} 關。` : "簽完這一關就可以合併。",
  };
}

/**
 * 頭條那顆主要按鈕 —— **只給走得通的下一步**。
 *
 * 從 `pages/signoff.ts` 抽出來，因為這一輪的缺陷有一半長在這裡：Scott 的截圖上
 * 是「核准『工程』→」，而那顆鈕按下去必被 `approveAndLock` 的
 * 「這個案子還沒送出審閱」擋回來 —— 順帶一提，「工程」那一關送出審閱時
 * 根本就會被換掉。一顆註定失敗的主要按鈕比沒有按鈕更糟。
 *
 * 兩處改動：
 * 1. `draft` 排到 `mine` 之前。還沒送審時唯一走得通的下一步是去送審，
 *    不是去簽一關簽不動的關卡
 * 2. `preview` 時一律不給簽核鈕 —— 那些關卡的 id 還不存在於 `state.cases`
 *
 * 回傳的是**資料不是 HTML**：頁面只負責畫。這樣「預覽狀態下不得出現核准鈕」
 * 才驗得到，而不是去 grep 頁面原始碼。
 */
export type SignoffCta =
  | { kind: "link"; href: string; label: string }
  | { kind: "approve"; stage: CaseStage }
  | null;

export function signoffCta(sum: SignoffSummary, opts?: { preview?: boolean }): SignoffCta {
  // 被退回時球在作者身上，主要動作是「去改」而不是「去簽」
  if (sum.state === "needs_fix") return { kind: "link", href: "editor.html", label: "去編輯台修改 →" };
  // 全過之後路不能斷在句號上 —— 下一步是拿這份簽核紀錄去取版號
  if (sum.state === "approved") return { kind: "link", href: "releases.html", label: "前往版本取號 →" };
  if (sum.state === "draft") return { kind: "link", href: "editor.html", label: "去編輯台送審 →" };
  if (opts?.preview) return null;
  const mine = sum.mine[0];
  return mine ? { kind: "approve", stage: mine } : null;
}

// ── 關卡上的 Agent 分析 ─────────────────────────────────────────

/**
 * 這一關最新的一筆分析工作單。
 *
 * 指派 Agent 到關卡原本**只是寫個名字** —— 沒有任何東西會因此執行，
 * 而畫面上看起來跟「已安排分析」一模一樣。接起來之後，關卡要能回答
 * 「我指派的 Agent 做了沒、結果是什麼」，資料就從這裡拿。
 *
 * 取最新一筆而不是全部：重跑是常態（改完再分析一次），舊結果屬於
 * 舊內容，列出來只會跟現況混在一起。
 */
export function stageAnalysis(
  jobs: readonly AgentJob[],
  projectId: string,
  stageId: string,
): AgentJob | null {
  // agentJobs 新的在前（invokeAgent 是 [job, ...prev]），順序掃第一筆就是最新
  return jobs.find((j) => j.projectId === projectId && j.stageId === stageId) ?? null;
}

/**
 * 這一關在關卡列上要畫出來的工作單，**由新到舊**。
 *
 * ## 這一支存在的理由是一條 major 缺陷
 *
 * 畫面用兩個窄化決定「畫哪一張」，而擋結案的 `isPendingAgentJob` 兩個都不看：
 *
 * - `stageAnalysis` 只回**最新一筆** → 按過「重新分析」之後，前一份仍然 pending
 *   卻在畫面上消失
 * - 呼叫端的 `isAgent` 看的是**當下的**指派對象 → 把關卡改派給人，整行分析
 *   連「查看結果」鈕一起消失
 *
 * 兩條的症狀一樣：**結案被擋下「還有 N 份沒拍板」，而使用者盯著關卡列
 * 找不到那 N 份在哪。** 唯一還看得到它們的地方是 S1 攔截對話框。
 *
 * 所以這一支的合約只有一句：**只要一張工作單擋得住結案，它就一定在回傳的
 * 陣列裡。** 修法刻意不是「放寬閘門」或「把它藏起來」—— 那兩條都是讓畫面
 * 說謊來換一時的一致，而這整套東西的賣點就是簽核紀錄講的是實話。
 *
 * 顯示用的那一張（有沒有在跑、「重新分析」鈕要不要 disabled）仍然是 `[0]`，
 * 語意跟改動前一致。
 */
export function stageAnalysisJobs(opts: {
  jobs: readonly AgentJob[];
  projectId: string;
  stageId: string;
  /** 這一關**現在**指派給 agent 嗎。false 時只畫擋得住結案的那些 */
  isAgent: boolean;
}): AgentJob[] {
  const { jobs, projectId, stageId, isAgent } = opts;
  const out: AgentJob[] = [];
  const latest = stageAnalysis(jobs, projectId, stageId);
  if (isAgent && latest) out.push(latest);
  for (const j of jobs) {
    if (j.projectId !== projectId || j.stageId !== stageId) continue;
    if (!isPendingAgentJob(j)) continue;
    if (out.some((k) => k.id === j.id)) continue;
    out.push(j);
  }
  return out;
}

export type AnalysisVerdict = "approve" | "fix" | null;

/**
 * 從分析全文抽出結論。
 *
 * prompt 要求第一行只寫「建議核准」或「建議修改」；模型不一定守規矩，
 * 所以往前幾行找，找不到就回 null —— **畫面顯示「看全文」而不是猜一個**。
 * 猜錯的結論比沒有結論糟：人會信任那個章。
 */
export function analysisVerdict(result: string): AnalysisVerdict {
  const lines = result.split("\n").slice(0, 5);
  for (const raw of lines) {
    const line = raw.replace(/[*#>\s：:「」]/g, "");
    if (!line) continue;
    if (line.startsWith("建議核准")) return "approve";
    if (line.startsWith("建議修改") || line.startsWith("建議退回")) return "fix";
  }
  return null;
}

// ── 簽核紀錄 ────────────────────────────────────────────────────

export type TimelineKind =
  | "submit"
  | "approve"
  | "approved"
  | "changes_requested"
  | "comment"
  | "skipped"
  | "override"
  | "merge"
  | "withdraw"
  | "audit";

export type TimelineEntry = {
  kind: TimelineKind;
  /** ISO；沒有時間的來源給空字串，排序時沉到最後 */
  at: string;
  who: string;
  title: string;
  detail: string;
  /** 第幾輪。版本事件與稽核事件推不出輪次，給 0 表示「不分輪」 */
  round: number;
};

export type TimelineInput = {
  c: CaseRecord | undefined;
  versions: PrdVersion[];
  /** 稽核事件（桌面版＋已綁資料夾才有）。`{at, kind, actorName}` */
  audit?: { at: string; kind: string; actorName: string; reason?: string }[];
};

const AUDIT_TITLE: Record<string, string> = {
  "review.submit": "送出審閱",
  "review.approve": "全部關卡核准",
  "review.withdraw": "抽單",
  "gate.pass": "簽核了部分關卡",
  "gate.fail": "要求修改",
};

const DECISION_TITLE: Record<CaseDecision["kind"], (stage: string) => string> = {
  approved: (n) => `核准「${n}」`,
  changes_requested: (n) => `要求修改「${n}」`,
  comment: (n) => `對「${n}」留下意見`,
  skipped: (n) => `略過「${n}」`,
  override: (n) => `以管理員身分代簽「${n}」`,
};

/**
 * 決策紀錄改讀 `CaseRecord.log`。
 *
 * 舊版是從關卡上那組「最新一筆」的戳記反推的，所以第二輪的決策會把第一輪的
 * 意見蓋掉 —— 而「第 1 輪資安要求修改、第 2 輪才通過」正是簽核紀錄最該講的
 * 那件事。`log` 只追加不覆蓋，這裡直接讀它。
 *
 * 沒有 `log` 的舊個案退回原本的反推法，才不會一升級就整段變空白。
 */
export function signoffTimeline(input: TimelineInput): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  const c = input.c;
  const stageName = new Map((c?.stages ?? []).map((s) => [s.id, s.name]));

  if (c?.log?.length) {
    for (const d of c.log) {
      const name = stageName.get(d.stageId) ?? "（已移除的關卡）";
      out.push({
        kind: d.kind,
        at: d.at,
        who: d.byName,
        title: DECISION_TITLE[d.kind](name),
        detail: d.comment.trim() || "（沒有留下意見）",
        round: d.round,
      });
    }
  } else {
    // 舊個案：只有關卡上的最新戳記可以反推，拿得到多少算多少
    for (const s of c?.stages ?? []) {
      if (s.state !== "approved") continue;
      out.push({
        kind: "approve",
        at: s.decidedAt ?? "",
        who: s.decidedByName || s.assigneeName || "—",
        title: `核准「${s.name}」`,
        detail: s.comment?.trim() || "（沒有留下意見）",
        round: 0,
      });
    }
  }

  for (const v of input.versions) {
    out.push({
      kind: v.kind === "merge" ? "merge" : "submit",
      at: v.at,
      who: v.byName,
      title: v.kind === "merge" ? "合併回主線" : "送出審閱（建立快照）",
      detail: v.message?.trim() || v.id,
      round: 0,
    });
  }

  if (c?.withdrawn) {
    out.push({
      kind: "withdraw",
      at: c.withdrawnAt ?? "",
      who: c.withdrawnBy || "—",
      title: "抽單",
      detail: c.withdrawReason?.trim() || "沒有留下理由",
      round: 0,
    });
  }

  // 稽核事件只補「本地沒有對應紀錄」的那幾種。決策已經逐筆列過了，
  // 再列一次只是同一件事說兩遍。
  for (const e of input.audit ?? []) {
    if (e.kind === "review.approve" || e.kind === "gate.pass" || e.kind === "gate.fail") continue;
    if (e.kind === "review.submit" && input.versions.length) continue;
    if (e.kind === "review.withdraw" && c?.withdrawn) continue;
    out.push({
      kind: "audit",
      at: e.at,
      who: e.actorName,
      title: AUDIT_TITLE[e.kind] ?? e.kind,
      detail: e.reason?.trim() || "來自稽核軌跡",
      round: 0,
    });
  }

  // 沒有時間的沉到最後：那是舊資料，不該插在今天發生的事中間
  return out.sort((a, b) => {
    if (!a.at && !b.at) return 0;
    if (!a.at) return 1;
    if (!b.at) return -1;
    return b.at.localeCompare(a.at);
  });
}

/**
 * 依輪分組，新的一輪在前。
 *
 * 平鋪的時間軸在多輪之後讀不出因果 —— 「要求修改」跟三筆核准混在一起，
 * 看不出哪幾筆是同一份內容上發生的。`round: 0` 的（送審快照、合併、稽核）
 * 掛在「不分輪」那一組。
 */
export function groupTimelineByRound(entries: TimelineEntry[]): { round: number; entries: TimelineEntry[] }[] {
  const byRound = new Map<number, TimelineEntry[]>();
  for (const e of entries) {
    const list = byRound.get(e.round) ?? [];
    list.push(e);
    byRound.set(e.round, list);
  }
  return [...byRound.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([round, list]) => ({ round, entries: list }));
}
