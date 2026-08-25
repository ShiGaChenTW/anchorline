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

/**
 * 標籤查表**一律要有退路**。
 *
 * `STAGE_KIND_LABEL[s.kind]` 在 `kind` 缺值時回 `undefined`，而下一步是
 * `escapeHtml(undefined)` → `undefined.replace` → TypeError。這不是在畫面上少一個
 * 字而已：`renderLandedFlows` 整支炸掉 → `render()` 中斷 → `renderCases()` 不再執行，
 * 而它掛在 `store.subscribe` 上，之後**每一次狀態變動都再炸一次**，管理中心從此半殘。
 *
 * 缺值從哪來：匯入工作區 JSON（Wave 1 之前的匯出檔沒有 `kind` / `defaultActor`）。
 * 收斂在 `store.sanitizeStageDefs` 補上了，這兩支是第二道 —— 一份存進 localStorage
 * 的舊資料不會因為我們今天加了收斂就自動變乾淨。
 */
export function stageKindLabel(kind: StageKind | undefined | null): string {
  return STAGE_KIND_LABEL[kind as StageKind] ?? STAGE_KIND_LABEL.review;
}

/** 見 `stageKindLabel`。退路選 `human`：假設「要人做」比假設「機器會自己跑」安全 */
export function stageActorLabel(actor: ActorKind | undefined | null): string {
  return STAGE_ACTOR_LABEL[actor as ActorKind] ?? STAGE_ACTOR_LABEL.human;
}

/** 見 `stageKindLabel`。`mode` 省略在既有資料裡是合法的，一律當並行 */
export function stageModeLabel(mode: StageMode | undefined | null): string {
  return mode === "sequential" ? "串行" : "並行";
}

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
 * 「重新套用範本」的文案。**分兩種案子，因為這顆鈕的後果嚴重度不同。**
 *
 * ## 兩種案子現在都是真的會發生事情
 *
 * 2026-08-26 Scott 拍板（D-3）：`reapplyWorkflow` 連個案一起重建。在那之前，
 * 這顆鈕對**已經跑過簽核**的案子是個 no-op —— `submitPlanFor` 走
 * `caseHasRun(live) === true` → `workflowFromCase(live)`，從個案自己反推流程，
 * 根本不回頭讀骨架。現在個案跟著重建，`caseHasRun` 的四個判準全部歸零，
 * 那顆鈕對它真的生效了。
 *
 * 代價也是真的：**既有簽章、每一筆簽核紀錄（`CaseRecord.log`）、以及已經存進
 * 關卡的 agent 分析全部消失，救不回來。** 這一批的第一版文案說「簽核狀態會被
 * 清掉」而其實什麼都沒做；這一版說同一句話，差別是**行為先做到了才寫**。
 * 文案與行為對不上，不管往哪個方向錯，都是同一個缺陷。
 *
 * ## 兩條的分界
 *
 * 判斷一律問 `store.submitPlan(pid).landsNow`，**不要在 UI 重寫一份 `caseHasRun`**
 * —— 那正是 W2-A 把判斷抽進 `submitPlan` 要防的分岔，而分岔的症狀就是上一輪在
 * 修的事：畫面說的跟實際發生的不是同一件事。
 *
 * ## 為什麼沒有「保留簽核紀錄」的那條指路
 *
 * 上一版的 `ranNote` 指向「個案調整 → 套用目前流程」。那句話現在**不能寫** ——
 * `applyWorkflowToCase` 走的是 `caseForProject()`，同樣是整份重建，簽章與 log
 * 一樣不留。這個 repo 裡沒有任何一條路能換掉關卡又保住簽核紀錄，寫一句指向
 * 不存在的退路，就是把上一輪那個缺陷換個方向再犯一次。
 */
export const REAPPLY_COPY = {
  /** `landsNow === true`：還沒有簽核痕跡，重套不會弄丟東西 */
  freshTitle: "重新套用範本流程？",
  freshBody:
    "這個案子還沒有任何簽核痕跡，所以重套不會弄丟東西：清掉它身上那份落地流程、" +
    "並把個案重建成照現在的範本骨架與領域包解析出來的關卡。下次送出審閱就用這一份。",
  /** 有效那條的按鈕字樣 */
  freshButton: "重新套用範本",
  /** 有效那條的 toast */
  okToast: "已重新套用範本 —— 個案已照現在的骨架重建，下次送審用這一份",

  /**
   * `landsNow === false`：跑過了。**這一條是破壞性的**，文案要講清楚失去什麼、
   * 以及失去之後救不回來。
   */
  ranTitle: "重新套用範本？既有簽章會被清掉",
  ranBody:
    "這個案子已經跑過簽核。重新套用會把個案整份重建成照現在的範本骨架與領域包" +
    "解析出來的關卡，所以既有的簽章、每一筆簽核紀錄（誰在第幾輪核准或要求修改）、" +
    "以及已經存進關卡的 agent 分析都會一起消失 —— 而且救不回來：沒有復原，" +
    "重簽一次也回不到原本那份紀錄。確定要換掉這個案子的流程再按。",
  /** 破壞性那條的按鈕字樣。鈕上就要看得出後果，不能等對話框才講 */
  ranButton: "重新套用範本（會清掉既有簽章）",
  /** 破壞性那條貼在鈕旁邊的說明。按之前就看得到，不是按下去才知道 */
  ranWarn:
    "這個案子已經跑過簽核 —— 重新套用會把既有簽章、簽核紀錄與已存的 agent 分析" +
    "一起清掉，而且救不回來。",
  /** 破壞性那條的 toast。真的清掉了就要說清掉了 */
  ranOkToast: "已重新套用範本 —— 既有簽章與簽核紀錄已清掉，個案照現在的骨架重建",
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
