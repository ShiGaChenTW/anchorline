/**
 * 管理中心的關卡編輯器 —— 建 HTML、讀回表單、算落地統計。全部純函式，零 store。
 *
 * ## 為什麼要獨立成檔
 *
 * Wave 1 的 F0：新增的參數只有測試在傳，生產唯一呼叫端沒傳 —— 功能在 App 裡是零，
 * 而測試全綠。`kind` / `defaultActor` / `editTarget` 是**一模一樣的形狀**：三個
 * Wave 1 就加好、`updateWorkflowStage` 也收得下、但管理中心到現在一個都沒送出去的
 * 欄位。從 store 出發的測試永遠驗不到「那一列有沒有真的把它們讀出來」。
 *
 * 修法沿用 `submit-assign.ts` 的那一招：把「產生欄位」與「讀回欄位」抽成生產端與
 * 測試端**共用**的函式。測試對這裡的 `stageRowFieldsHtml()` 與 `stagePatchFrom()`
 * 下手，再用 source-grep 釘住 `admin.ts` 真的走這兩支。
 *
 * ## 為什麼選擇器要獨立成一份常數
 *
 * 這個檔裡有兩段程式必須逐字一致：**產生 HTML 的 class** 與**讀回時查的選擇器**。
 * 兩邊各自打字面值的話，改了一邊沒改另一邊 —— 表單畫得出來、按下儲存卻讀回空字串，
 * 於是那一關被靜默改成預設值（`kind` 退回 review、`editTarget` 被清掉）。
 * 沒有錯誤訊息，而使用者以為自己存好了一個會改內文的關卡。
 * `STAGE_FIELD_SEL` 是兩邊唯一的來源，測試也用它把這條迴路釘起來。
 */
import type {
  ActorKind,
  FullCat,
  Project,
  Section,
  StageEditTarget,
  StageKind,
  StageMode,
  WorkflowStageDef,
} from "../data/types";
import { FULL_CATS } from "../data/types";
import { escapeHtml } from "./ui";

/** 產生端與讀回端**唯一**的 class 來源。見檔頭。 */
export const STAGE_FIELD_SEL = {
  name: ".st-name",
  assignee: ".st-assignee",
  required: ".st-req",
  mode: ".st-mode",
  kind: ".st-kind",
  actor: ".st-actor",
  editWrap: ".st-edit-wrap",
  editSection: ".st-edit-section",
  editField: ".st-edit-field",
} as const;

/** class 名（不含前導的 `.`）—— 建 HTML 時用 */
function cls(sel: string): string {
  return sel.slice(1);
}

export const STAGE_KIND_LABEL: Record<StageKind, string> = {
  review: "審閱（只出意見）",
  edit: "改稿（會改 PRD 內文）",
};

export const STAGE_ACTOR_LABEL: Record<ActorKind, string> = {
  agent: "Agent",
  human: "我",
};

export const FULL_CAT_TITLE: Record<FullCat, string> = {
  lean: "精簡型（lean）",
  narrative: "敘事型（narrative）",
  enterprise: "完整型（enterprise）",
  agile: "敏捷型（agile）",
  technical: "技術型（technical）",
};

/**
 * D2 的那句話。**寫死在畫面上，不是註解。**
 *
 * 使用者改完骨架、回頭看現有專案完全沒變，第一個念頭是「沒存到」或「壞了」，
 * 然後去別的地方找開關改。這句話是唯一能攔住那條路的東西。
 */
export const SKELETON_D2_NOTICE =
  "改這裡只影響之後第一次送審的專案。已經落地的案子不會重算（D2）。";

/**
 * 「重新套用範本」的文案。**分兩種案子，因為這顆鈕的後果完全不同。**
 *
 * ## 為什麼要分
 *
 * `reapplyWorkflow` 只清掉 `project.workflowStages`。對一個**已經跑過簽核**的案子，
 * `submitPlanFor` 走的是 `caseHasRun(live) === true` 那一支 → `workflowFromCase(live)`，
 * 它從個案自己反推流程，**根本不回頭看骨架**。所以那顆鈕對它做的事是：
 * 清掉一份沒人會再讀的紀錄，其餘什麼都沒發生。
 *
 * 而第一版文案對使用者說的是「既有的簽核狀態會被清掉……關卡與已簽的紀錄都會換一份」。
 * 兩句都是假的（PM 用探針實測：`approved` 原封不動、下次送審 `landsNow: false`）。
 * **一顆 `danger: true` 的按鈕在說「我會破壞你的東西」，而它什麼都沒做** ——
 * 使用者要嘛不敢按一顆其實無害的鈕，要嘛按了以為重套好了。比功能沒做到更糟。
 *
 * 判斷一律問 `store.submitPlan(pid).landsNow`，**不要在 UI 重寫一份 `caseHasRun`** ——
 * 那正是 W2-A 把判斷抽進 `submitPlan` 要防的分岔，而分岔的症狀就是這一節在講的事：
 * 畫面說的跟實際發生的不是同一件事。
 */
export const REAPPLY_COPY = {
  /** `landsNow === true`：還沒有簽核痕跡，這顆鈕真的有效 */
  freshTitle: "重新套用範本流程？",
  freshBody:
    "這個案子還沒有任何簽核痕跡，所以重套是有效的：清掉它身上那份落地流程之後，" +
    "下次送出審閱會照現在的範本骨架與領域包重新解析一份新的關卡。",
  /**
   * `landsNow === false`：跑過了，這顆鈕不生效。
   *
   * 文案要做兩件事——講清楚它不會發生什麼，以及指路到真的做得到的地方
   * （既有的「個案調整 → 套用目前流程」，那支是 `applyWorkflowToCase`）。
   */
  ranNote:
    "這個案子已經跑過簽核，重新套用範本對它不生效 —— 下次送審仍會沿用它自己那一份關卡" +
    "（簽核紀錄靠 stageId 跨輪串接，換掉 id 會讓上一輪的意見變成「已移除的關卡」）。" +
    "要換掉這個案子的關卡，請到「個案調整」按「套用目前流程」。",
  /** 成功後的 toast。只有 `landsNow === true` 的案子按得到，所以這句話成立 */
  okToast: "已清掉落地流程 —— 下次送審會照現在的骨架重新解析",
} as const;

/* ─── 表單：產生 ─── */

function optionHtml(value: string, label: string, selected: boolean): string {
  return `<option value="${escapeHtml(value)}"${selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
}

/**
 * `editTarget` 的欄位下拉選項。
 *
 * 只列 `textarea` / `text` 這種放得下整段文字的欄位嗎？—— **不篩**。
 * 篩掉的欄位使用者在畫面上根本看不到，而 Wave 1 的 `editTarget` 型別允許任何
 * `fieldKey`；畫面篩、型別不篩的話，一個從別處存進來的合法目標會在這裡顯示成
 * 「— 不指定 —」，按下儲存就被清掉。列全部，讓使用者自己決定。
 */
export function editFieldOptionsHtml(
  sections: readonly Section[],
  sectionId: string,
  selectedFieldKey: string,
): string {
  const fields = sections.find((s) => s.id === sectionId)?.fields ?? [];
  return [
    optionHtml("", "— 不指定 —", !selectedFieldKey),
    ...fields.map((f) => optionHtml(f.key, f.label, f.key === selectedFieldKey)),
  ].join("");
}

function editSectionOptionsHtml(sections: readonly Section[], sectionId: string): string {
  return [
    optionHtml("", "— 不指定 —", !sectionId),
    ...sections.map((s) => optionHtml(s.id, `${s.n} ${s.title}`, s.id === sectionId)),
  ].join("");
}

/**
 * Wave 1 新加的三個欄位的 HTML。**全域關卡編輯器與五類骨架編輯器共用同一份。**
 *
 * 兩邊各刻一份的話，之後補第四個欄位一定會漏掉其中一邊 —— 而漏掉的那一邊
 * 不會報錯，只會在存檔時把新欄位靜默清成預設值。
 *
 * `editTarget` 那一組永遠在 DOM 裡，只用 `style.display` 藏 —— 不在 DOM 裡的話，
 * 使用者把 `kind` 切成 `edit` 就得整列重畫，而重畫會把他同一列還沒存的其他修改
 * （關卡名打到一半）一起丟掉。
 */
export function stageRowFieldsHtml(
  stage: WorkflowStageDef,
  sections: readonly Section[],
): string {
  const t = stage.editTarget;
  const isEdit = stage.kind === "edit";
  const kindOpts = (["review", "edit"] as StageKind[])
    .map((k) => optionHtml(k, STAGE_KIND_LABEL[k], stage.kind === k))
    .join("");
  const actorOpts = (["agent", "human"] as ActorKind[])
    .map((a) => optionHtml(a, STAGE_ACTOR_LABEL[a], stage.defaultActor === a))
    .join("");
  return `
    <label class="st-field-label" title="審閱只出意見；改稿會整段覆寫指定的 PRD 欄位">關卡型態
      <select class="${cls(STAGE_FIELD_SEL.kind)}">${kindOpts}</select>
    </label>
    <label class="st-field-label" title="這一關原本設計給誰做。送審指派對話框的預設值看這個">預設執行者
      <select class="${cls(STAGE_FIELD_SEL.actor)}">${actorOpts}</select>
    </label>
    <label class="st-field-label ${cls(STAGE_FIELD_SEL.editWrap)}" style="${isEdit ? "" : "display:none"}">覆寫章節
      <select class="${cls(STAGE_FIELD_SEL.editSection)}">${editSectionOptionsHtml(sections, t?.sectionId ?? "")}</select>
    </label>
    <label class="st-field-label ${cls(STAGE_FIELD_SEL.editWrap)}" style="${isEdit ? "" : "display:none"}">覆寫欄位
      <select class="${cls(STAGE_FIELD_SEL.editField)}">${editFieldOptionsHtml(sections, t?.sectionId ?? "", t?.fieldKey ?? "")}</select>
    </label>`;
}

/* ─── 表單：讀回 ─── */

/** 一列表單讀出來的原始字串。DOM 與純邏輯的交界就這一個型別 */
export type StageFormRaw = {
  name: string;
  assigneeId: string;
  required: boolean;
  mode: string;
  kind: string;
  actor: string;
  editSectionId: string;
  editFieldKey: string;
};

/**
 * 把一列表單的原始字串收斂成 `updateWorkflowStage` 吃得下的 patch。
 *
 * 三條硬規則：
 * 1. **`kind !== "edit"` 一律把 `editTarget` 清成 undefined。** 留著的話，使用者
 *    把一個改稿關卡改回審閱之後，那個目標還躺在資料裡；下次再切回改稿就會沿用
 *    一個他以為已經取消掉的欄位。
 * 2. **章節與欄位缺一不可。** 只選章節不選欄位 = 不是一個可寫入的位址，存成
 *    `{sectionId, fieldKey: ""}` 的話，落地時 `resolveEditTarget` 不會退回
 *    「開放問題」（它只認 undefined），而是往一個不存在的 key 寫。
 * 3. **認不得的 `kind` / `mode` / `actor` 退回預設而不是原樣塞進去。** 這幾個是
 *    聯合型別，型別上擋不住一個從 DOM 讀出來的任意字串。
 */
export function stagePatchFrom(raw: StageFormRaw): Partial<WorkflowStageDef> {
  const kind: StageKind = raw.kind === "edit" ? "edit" : "review";
  const actor: ActorKind = raw.actor === "human" ? "human" : "agent";
  const mode: StageMode = raw.mode === "sequential" ? "sequential" : "parallel";
  const editTarget: StageEditTarget | undefined =
    kind === "edit" && raw.editSectionId && raw.editFieldKey
      ? { sectionId: raw.editSectionId, fieldKey: raw.editFieldKey }
      : undefined;
  return {
    name: raw.name.trim() || "關卡",
    defaultAssigneeId: raw.assigneeId || null,
    required: raw.required,
    mode,
    kind,
    defaultActor: actor,
    editTarget,
  };
}

/**
 * 從一列 DOM 讀出原始字串。**headless 測不到這一支**（沒有 DOM），
 * 所以它刻意只做「查選擇器、取 value」，一行判斷都不放 —— 判斷全在
 * `stagePatchFrom` 裡，那支測得到。
 */
export function readStageForm(row: ParentNode): StageFormRaw {
  const val = (sel: string): string =>
    (row.querySelector(sel) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";
  return {
    name: val(STAGE_FIELD_SEL.name),
    assigneeId: val(STAGE_FIELD_SEL.assignee),
    required: Boolean((row.querySelector(STAGE_FIELD_SEL.required) as HTMLInputElement | null)?.checked),
    mode: val(STAGE_FIELD_SEL.mode),
    kind: val(STAGE_FIELD_SEL.kind),
    actor: val(STAGE_FIELD_SEL.actor),
    editSectionId: val(STAGE_FIELD_SEL.editSection),
    editFieldKey: val(STAGE_FIELD_SEL.editField),
  };
}

/* ─── 落地統計 ─── */

/**
 * 每一類骨架**已經被幾個專案落地**。
 *
 * 這個數字是 D2 那句話的證據：使用者看到「目前有 3 個專案落地了這一份」，才會
 * 相信「改這裡不會動到那 3 個」是設計而不是壞掉。
 *
 * 三個判準：
 * - 有 `workflowStages` 才算落地（`undefined` = 還沒送過審）
 * - 自帶骨架的專案（`templateStages`）**不算**進任何一類 —— 它落地的是範本自己
 *   那一份，不是這五類裡的任何一份。算進去的話，使用者改了 lean 骨架卻發現
 *   計數裡那個專案毫無關係
 * - 沒有 `templateCat` 的走 `lean`，跟 `resolveWorkflow` 的 `FALLBACK_CAT` 一致
 */
export function skeletonLandedCounts(projects: readonly Project[]): Record<FullCat, number> {
  const out = Object.fromEntries(FULL_CATS.map((c) => [c, 0])) as Record<FullCat, number>;
  for (const p of projects) {
    if (!p.workflowStages) continue;
    if (p.templateStages?.length) continue;
    const cat = p.templateCat ?? "lean";
    if (cat in out) out[cat] += 1;
  }
  return out;
}

/** 已落地流程的專案（C-3 的清單）。順序沿用 `projects`，不重排 */
export function landedFlowProjects(projects: readonly Project[]): Project[] {
  return projects.filter((p) => Boolean(p.workflowStages));
}
