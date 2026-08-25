import type { Release } from "../lib/release";

/** 僅保留 kami（紙）與 github（暗） */
export type ThemeId = "kami" | "github" | "terminal";

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
  /**
   * 綁定的簽核關卡。有值代表這一單是「替某一關做的分析」，
   * 簽核頁會把結果貼在那一關上。沒有 stageId 的是一般進場（Agent 管理頁）。
   */
  stageId?: string;
  /** 綁定的版號。送交執行的工作單帶這個，版本取號頁把進度貼回那一版 */
  releaseId?: string;
  task: AgentTaskType;
  status: AgentJobStatus;
  note: string;
  result: string;
  createdAt: string;
  finishedAt: string | null;
  /**
   * 這份結果**落地了沒有**。
   *
   * 原本 `invokeAgent` 跑完直接改 state：`edit`/`coach` 把摘要追加進「開放問題」，
   * `review`/`approve` 自動貼一則留言。使用者沒機會看完整內容再決定 —— 文件被
   * 改了，而且沒有任何地方問過他。現在跑完停在 `pending`，等
   * `saveAgentResult` / `discardAgentResult` 拍板。
   *
   * 為什麼存在工作單上而不是記憶體：重整頁面不該遺失待確認的結果。放記憶體的話
   * 那份跑了三十秒的分析會在按 F5 的瞬間消失，而且看起來像從來沒跑過。
   *
   * 沒有這個欄位的是**舊工作單**（升級前跑完的）。它們的副作用早就寫進 state 了，
   * 當成 `saved` 處理才不會讓歷史紀錄突然全部變成「待確認」。
   */
  landed?: "pending" | "saved" | "discarded";
};

/**
 * 這張工作單的落地狀態 —— **舊工作單一律當成已落地**。
 *
 * 上面那段註解本來就這樣寫，但沒有任何程式碼實作它：`saveAgentResult` 只擋
 * `landed === "saved"`，`undefined` 一路放行。後果是升級前跑完的工作單
 * （副作用當年已經由 `invokeAgent` 直接寫進文件）會被**第二次**落地 ——
 * 同一則留言貼兩遍，而紀錄上那兩筆看起來像兩次獨立的審查。
 *
 * 還沒跑完的沒有 `landed` 是另一回事：那是還沒開始，不是做完了，所以退 `pending`。
 */
export function jobLanded(
  j: Pick<AgentJob, "landed" | "status">,
): "pending" | "saved" | "discarded" {
  if (j.landed) return j.landed;
  return j.status === "done" ? "saved" : "pending";
}

/**
 * 這張工作單是不是「跑完了、但人還沒拍板」。
 *
 * 四個條件缺一不可：
 * - **綁了關卡**（`stageId`）—— 沒綁關卡的一般進場（Agent 管理頁）落地目標是
 *   留言，跟簽核結案無關。拿它擋結案會讓使用者在簽核頁上看到一份根本不屬於
 *   這個流程的東西，而且那一頁沒有地方可以處理它
 * - `status === "done"` —— 失敗／取消／還在跑的都不是「等人決定」
 * - `jobLanded(j) === "pending"` —— **不能寫成 `j.landed === "pending"`**。
 *   升級前的舊工作單沒有 `landed` 欄位，`jobLanded` 把它們算成 `saved`
 *   （副作用當年已經寫進文件了）。直接比欄位的話那批舊單會全部變成擋門的幽靈，
 *   而且永遠拍不掉 —— `saveAgentResult` 對它們回「這份結果已經存過了」
 * - **結果非空** —— 空字串存不進去（`saveAgentResult` 自己也擋）。拿一份存不了的
 *   東西擋著結案，使用者會卡在一個沒有出口的迴圈裡
 */
export function isPendingAgentJob(j: AgentJob): boolean {
  return (
    !!j.stageId && j.status === "done" && jobLanded(j) === "pending" && j.result.trim() !== ""
  );
}

/**
 * 某個專案還在等人拍板的工作單，新到舊。
 *
 * `invokeAgent` 是 `[job, ...prev]`，`filter` 保序，所以不用再排一次。
 * 純函式：store 的結案閘門與簽核頁的攔截對話框共用這一支 —— 兩邊各篩一次的話
 * 條件會分岔，而症狀是「對話框說沒有待辦，按下去卻還是被擋」。
 */
export function pendingAgentJobsOf(jobs: readonly AgentJob[], projectId: string): AgentJob[] {
  return jobs.filter((j) => j.projectId === projectId && isPendingAgentJob(j));
}

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
  /**
   * 專案簡寫：1–5 個英文字母，大寫。Function wish list 取號用
   * （`SNOTE` + 流水號 → `SNOTE-001`）。未設就不能新增願望。
   */
  shortCode?: string;
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
   * 版號政策。未設 = `loose`（這條規則出現之前的行為）。
   *
   * **選了 `strict` 就回不去**，`store.setVersionPolicy` 會擋。
   * 定義與理由在 `lib/release.ts` 的 `VersionPolicy`。
   */
  versionPolicy?: "loose" | "strict";
  /**
   * 領域包名稱（`src/data/domains/*.md` 的 name）。未設 = `generic`。
   * 可以改：改了之後不屬於新領域的章節內容會變成孤兒，但**不刪**——
   * 「寫到一半發現選錯領域」比「鎖死不給改」常見得多。
   */
  domain?: string;
  /**
   * 這個專案自己的簽核流程。**第一次送審時落地**，之後改範本不影響進行中的案子。
   *
   * 為什麼要複製一份而不是每輪重解析：`signoffTimeline` 靠 `stageId` 跨輪串接
   * 決策，而重解析出來的關卡 id 會隨範本／領域包變動。id 一變，第一輪的意見
   * 就會顯示「（已移除的關卡）」—— 那正是簽核紀錄最該講清楚的一段。
   *
   * 沒有這個欄位代表**還沒落地**（尚未送過審，或舊資料）。消費端不可以把
   * 「空陣列」跟「沒有這個欄位」當成同一件事：前者是「這個專案的流程真的沒有
   * 關卡」，後者要退回全域 `AppState.workflowStages`。
   */
  workflowStages?: WorkflowStageDef[];
  /**
   * 這個專案套的是哪一類整份 PRD 範本。決定簽核骨架（見 `lib/workflow-resolve.ts`）。
   *
   * 沒有這個欄位的專案（沒套過整份範本、或舊資料）走 `lean` —— 最精簡的那一套。
   * 這裡刻意**不存範本 id**：範本會被改、被刪，而骨架只跟「哪一類」有關。
   */
  templateCat?: FullCat;
  /**
   * 自訂範本自帶的骨架，套用時從 `Template.stages` 複製下來。
   *
   * 有值就取代 `templateCat` 推出來的那一套。內建的十份範本都沒有這個欄位 ——
   * 它留給「同一類但流程要不一樣」的自訂範本。
   */
  templateStages?: WorkflowStageDef[];
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

/**
 * 關卡要 agent 做哪一種事。
 *
 * `review` = 只出意見，不碰 PRD 內文；`edit` = 提議內文修改。
 *
 * 為什麼要分：這兩種結果的「存檔」意義完全不同 —— review 存下來是把意見釘在
 * 關卡上（可逆、不動文件），edit 存下來會覆寫某個 PRD 欄位（動到文件本體）。
 * 用同一個確認流程處理兩者，等於讓人用同一個心理成本按下兩種後果差很多的按鈕。
 */
export type StageKind = "review" | "edit";

/**
 * `edit` 關卡存檔時要寫進哪個欄位。
 *
 * 為什麼要明寫而不是讓 agent 自己挑：agent 挑錯欄位時，使用者是在按下存檔
 * **之後**才發現內容跑到別章去了。關卡定義好目標，存檔前才講得出
 * 「現值 vs 新值」這組對照 —— 沒有目標就沒有現值可比。
 */
export type StageEditTarget = {
  sectionId: string;
  fieldKey: string;
};

/** 簽核流程關卡定義（流程設計） */
export type WorkflowStageDef = {
  id: string;
  order: number;
  name: string;
  defaultAssigneeId: string | null;
  /** 見 `StageKind`。這個欄位是必填的：漏了就會退回「全部當 review」的舊行為 */
  kind: StageKind;
  /**
   * 這一關**原本設計給誰做**。
   *
   * 跟 `defaultAssigneeId` 不同：那個是「預先綁死的某一個人」，這個是「該找哪一種
   * 執行者」。個人工作台上具體要派哪個 agent 是送審當下才決定的，但「我核准」
   * 那一關永遠只能是人，這件事屬於流程定義而不是每次指派。
   */
  defaultActor: ActorKind;
  /** `edit` 關卡才有意義。省略時存檔會退回「開放問題」欄位（見 store.saveAgentResult） */
  editTarget?: StageEditTarget;
  /**
   * 非必簽的關卡**不擋結案**，而且可以被明確「略過」。
   *
   * 這個旗標本來是死的：UI 可以取消勾選，但 `allStagesSettled` 要求每一關
   * 都結案，所以非必簽照樣擋著（prod 種子的「法務」就是 `required:false`）。
   */
  required: boolean;
  /**
   * 串行的關卡要等前面所有關卡結案才輪得到；並行的隨時可簽。
   *
   * **移轉時既有關卡一律給 `parallel`** —— 那是現行行為，不能因為升級就把
   * 跑到一半的案子擋住。新增關卡預設 `sequential`（市場常態）。
   */
  mode: StageMode;
};

export type StageMode = "sequential" | "parallel";

/**
 * 關卡狀態。
 *
 * `changes_requested` 是審閱者的負向決策 —— 在這之前這套流程只有「核准」，
 * 發現問題時唯一能做的是不按按鈕，而那在畫面上跟「還沒輪到他」一模一樣。
 */
export type CaseStageState =
  | "approved"
  | "changes_requested"
  | "pending"
  | "empty"
  | "skipped";

/** 一次決策。**不覆蓋**，每一次都往 `CaseRecord.log` 追加。 */
export type CaseDecision = {
  id: string;
  stageId: string;
  /** 第幾輪送審。重送 +1，讓紀錄看得出「這是第二輪才提的意見」 */
  round: number;
  at: string;
  byId: string;
  byName: string;
  kind: DecisionKind;
  /** `changes_requested` 與 `override` 必填 */
  comment: string;
};

/**
 * `comment` 是「保留意見」：留話但**不改變關卡狀態**（照抄 GitHub PR review
 * 的第三態）。`override` 是管理員代簽，必填理由，紀錄上跟一般核准分開標示。
 */
export type DecisionKind = "approved" | "changes_requested" | "comment" | "skipped" | "override";

/** 個案上的關卡實例（可異動關卡人員） */
export type CaseStage = {
  id: string;
  stageDefId: string;
  order: number;
  name: string;
  assigneeId: string | null;
  assigneeName: string;
  state: CaseStageState;
  /**
   * 決策戳記。**全部 optional** —— 這四個欄位是後來補的，舊個案沒有，
   * 畫面顯示「—」而不是假裝有。
   *
   * 為什麼不重用 `assigneeName`：簽核路徑一度把它覆寫成 `"名字 · 已簽"`，
   * 那個欄位就同時扛「被指派給誰」與「誰簽的」兩件事 —— 重送審把 `state` 退回
   * `pending` 之後那行字沒人清，同一關同時顯示「待簽核」與「某某 · 已簽」
   * （B1，2026-08-26 修）。`assigneeName` 現在只存「派給誰」，
   * 「誰簽的」一律以 `state` + `decidedByName` 為準。
   */
  decidedAt?: string;
  decidedById?: string;
  decidedByName?: string;
  /**
   * **簽核意見** —— 核准／要求修改／略過時人留的那一句話，會進簽核紀錄。
   *
   * 只有簽核路徑寫得到這裡。Agent 的分析全文請寫 `agentResult`：兩者共用一個
   * 欄位時會互相覆寫，而 `stageReasons` 與舊個案的反推路徑讀的都是這一欄 ——
   * 症狀是簽核紀錄把 agent 的四千字分析當成「簽核者留的話」掛在人名下。
   */
  comment?: string;
  /**
   * 這一關的 Agent 分析全文（使用者按過存檔才有）。
   *
   * 跟 `comment` 分開放不是為了整齊，是因為兩者的**作者不同**：一個是機器的
   * 意見，一個是人的決定。混在一起之後，畫面沒有任何辦法分辨那段字是誰寫的。
   */
  agentResult?: string;
  /** 這個關卡實例的順序模式。舊資料沒有就當 `parallel`（＝現行行為） */
  mode?: StageMode;
  /** 非必簽的關卡不擋結案。舊資料沒有就當必簽（＝現行行為） */
  required?: boolean;
  /**
   * 這一關要 agent 做哪一種事。**舊資料沒有就當 `review`** —— 那是這個欄位
   * 出現之前唯一存在的行為，跑到一半的案子不該因為升級突然變成會改內文。
   */
  kind?: StageKind;
  /** `edit` 關卡的落地目標，從關卡定義複製下來 */
  editTarget?: StageEditTarget;
};

/** 舊個案的關卡沒有 kind 欄位，一律當 review（＝這個欄位出現之前的行為） */
export function stageKind(s: Pick<CaseStage, "kind">): StageKind {
  return s.kind ?? "review";
}

/**
 * `edit` 關卡真正會被覆寫的那個欄位。
 *
 * `editTarget` 省略時退回「開放問題」—— 那是舊版 `invokeAgent` 靜默追加摘要的
 * 地方，落地目標不變，變的是這次會先問過人。
 *
 * **為什麼要有這一支**：這個退路原本是三份各自寫死的物件字面值
 * （`store.saveAgentResult`、`submit-assign` 的警語、W2-B 的前後對照）。
 * 三份分岔的症狀是最惡劣的一種：指派時的警語說會覆寫 A 欄、pop-up 的左欄顯示
 * A 欄的現值、而存檔寫進 B 欄 —— 三個畫面各自都「對」，只有文件是錯的。
 */
export function resolveEditTarget(target: StageEditTarget | undefined): StageEditTarget {
  return target ?? { sectionId: "open", fieldKey: "oq" };
}

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
  /**
   * 第幾輪送審。第一次送審是 1，每次重送 +1。
   *
   * 有了輪次，紀錄才講得出因果：「第 1 輪資安要求修改 → 第 2 輪重送 → 通過」。
   * 舊資料沒有這個欄位，移轉時補 1。
   */
  round?: number;
  /**
   * 所有決策，**只追加不覆蓋**。
   *
   * `CaseStage` 上那組 `decidedAt/By/comment` 是「最新一筆的投影」，方便清單
   * 直接讀；真相在這裡。少了它，第二輪的決策會把第一輪的意見蓋掉。
   */
  log?: CaseDecision[];
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

/**
 * 範本分兩種：
 * - `section` 章節範本 —— 一段可以插進 PRD 的骨架（原本的功能）
 * - `full` 整份 PRD 範本 —— 一份完整文件的章節結構
 *
 * 舊資料（localStorage 裡的自訂範本）沒有這個欄位，一律當 `section`。
 */
export type TemplateKind = "section" | "full";

/** 章節範本的分類 */
export type SectionCat =
  | "core"
  | "security"
  | "growth"
  | "platform"
  | "openspec"
  | "delivery"
  | "research";

/** 整份 PRD 範本的分類 —— 依「寫給誰看、要多重」分，不依產業分 */
export type FullCat = "lean" | "narrative" | "enterprise" | "agile" | "technical";

/**
 * 五類的**列舉**。型別列不出成員，而「對每一類各做一件事」的地方需要真的跑得完。
 *
 * 為什麼放在 `types.ts` 而不是跟 `FULL_CAT_LABEL` 放在一起：那份住在
 * `lib/submit-assign.ts`，而那個檔 import 了 `ui.ts`（`escapeHtml`）。
 * store 要用這份列舉來合併骨架覆寫 —— 從那裡拿等於把 DOM 工具拉進 store 的
 * 相依圖，headless 測試會在 import 時就炸。這裡零依賴。
 *
 * 少一類的症狀：那一類的骨架覆寫存得進去、卻永遠不會被 `resolveWorkflowFor`
 * 讀到 —— 管理中心改完顯示已儲存，送審跑的還是舊骨架。
 */
export const FULL_CATS: readonly FullCat[] = [
  "lean",
  "narrative",
  "enterprise",
  "agile",
  "technical",
];

export type TemplateCat = SectionCat | FullCat;

export type Template = {
  id: string;
  cat: TemplateCat;
  title: string;
  blurb: string;
  uses: number;
  body: string;
  /** 省略 = `section`。整份範本必須明寫 `full`。 */
  kind?: TemplateKind;
  /** 這份範本的出處（人看的名字），整份範本才有 */
  source?: string;
  sourceUrl?: string;
  /**
   * 這份範本自帶的簽核骨架。**整份範本才有。**
   *
   * 省略時走 `resolveWorkflow` 依 `cat` 給的五類骨架 —— 那是絕大多數情況。
   * 這個欄位留給「同一類但流程要不一樣」的自訂範本，不是給內建的十份用的。
   */
  stages?: WorkflowStageDef[];
};

/** 舊資料沒有 kind 欄位，一律當章節範本 */
export function templateKind(t: Template): TemplateKind {
  return t.kind ?? "section";
}

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

/**
 * API 通路。`auto` 沿用舊行為（用模型 ID 前綴猜），其餘是使用者的明示指定。
 *
 * 前綴推斷對 `gemini-*` / `claude-*` / `gpt-*` 以外的任何東西都會失敗 ——
 * 自架 gateway、Azure 部署名、OpenRouter 的 `vendor/model` 寫法、任何改名過的
 * 模型，全部掉進 custom。通路是使用者知道而我們猜不到的事實，讓他直接講。
 */
export type AIProvider = "auto" | "gemini" | "openai" | "anthropic" | "openrouter" | "ollama" | "custom";

export type AISettings = {
  /**
   * 模型名稱自由填。寫死聯集只會在下一次模型改版時過期，
   * 而使用者永遠比這份型別新。
   */
  model: string;
  /** 預設 auto —— 舊設定沒有這個欄位，讀進來就是 undefined，行為與從前相同。 */
  provider?: AIProvider;
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
    /** 預設 Split / Write / Preview */
    defaultMode: "split" | "write" | "preview";
    /** 預覽欄語意高亮（待決／風險等） */
    semanticHighlight: boolean;
    /** 高亮強度：soft 僅待決+風險；medium 含指標／完成／引用 */
    highlightIntensity: "soft" | "medium";
    /** 減少注意力導引動畫（亦尊重系統 prefers-reduced-motion） */
    reduceMotion: boolean;
  };
  /**
   * AI prompt 覆寫。key = prompt-registry 的 id。
   * 只存「與預設不同」的部分 —— 存回預設值等於清掉覆寫。
   * jsonMode 刻意不在這裡：回傳格式接的是解析器，不是偏好。
   */
  promptOverrides?: Record<string, { system?: string; temperature?: number }>;
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
  /**
   * 專案自己的章節結構，蓋過領域包推出來的骨架。
   *
   * **為什麼要多這一層：** 骨架本來每次載入都從領域包重算，`load()` 會把
   * 存起來的 `sections` 丟掉、只留 status/score/checks。那個設計對「領域包
   * 改了，所有專案跟著更新」是對的，但它同時讓「這個專案自己改章節」變成
   * 不可能 —— 改完重開就沒了，而且不會有錯誤訊息。
   *
   * 有這個鍵的專案就用這一份；沒有的照舊走領域包。套用整份 PRD 範本、
   * 改名、刪章節都會寫進來。切換領域包會清掉它（那是明確的「重建骨架」）。
   */
  projectSections?: Record<string, Section[]>;
  /**
   * 哪些專案不要「自訂章節」。
   *
   * `withCustomSection()` 會在每次推導骨架時把那一節補回最後面 —— 所以它
   * 不能靠「從 projectSections 拿掉」來刪，拿掉了下一次載入又長回來，而且
   * 沒有任何錯誤訊息。要刪它只能用一個明確的旗標。
   *
   * 插入章節範本時會自動清掉這個旗標：那些段落只有這一節裝得下。
   * key = projectId
   */
  projectNoCustom?: Record<string, boolean>;
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
  /**
   * 五類 PRD 骨架的**覆寫**。沒有這個欄位（或某一類沒有）就走 `SEED_WORKFLOW_SKELETONS`。
   *
   * 為什麼是 `Partial` 而不是把五類全存下來：全存的話，種子骨架之後任何一次
   * 修正都到不了已經存過檔的使用者手上 —— 他們的 localStorage 裡凍著一份
   * 上一版的複本，而畫面上完全看不出來那是舊的。只存「使用者真的改過的那幾類」，
   * 其餘永遠跟著程式碼走。
   *
   * ⚠️ 改這裡**只影響之後第一次送審的專案**。已落地的案子沿用自己那一份
   * （`Project.workflowStages`），不重算 —— 那是 D2 拍板的取捨。
   */
  workflowSkeletons?: Partial<Record<FullCat, WorkflowStageDef[]>>;
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
  /**
   * 工作台-OpenSpec上次開的 change（`openspec/changes/<id>` 的目錄名）。
   *
   * 跟 `activeSectionId` 同一種東西：「上次停在哪」。空字串代表沒有記憶，
   * 頁面會自己退回第一個未封存的 change —— 記的那個可能已經被封存或改名，
   * 所以消費端一律要對現有清單驗過再用，不能直接信任。
   */
  activeOpenSpecChange: string;
  /** 同上，記的是上次開的檔案絕對路徑。檔可能已經不在，讀失敗就清掉。 */
  activeOpenSpecFile: string;
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
