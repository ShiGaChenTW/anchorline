/**
 * 送審前「每一關派給誰」對話框的內容與結果 —— 全部純函式，零 I/O。
 *
 * ## 為什麼這一份要獨立成檔
 *
 * Wave 1 的 F0 是這樣壞的：`applyFullTemplate` 新增的第 4 個參數只有測試在傳，
 * 生產唯一呼叫端沒傳，於是整批工作的核心功能在 App 裡是零，而 1563 個測試全綠。
 * `submitForReview` 的 `assignments` 是**一模一樣的形狀** —— 一個 Wave 1 就備好、
 * 但生產端到現在還沒傳的選填參數。
 *
 * 修法跟 F0 一樣：把「產生指派」與「讀回指派」抽成生產端與測試端**共用**的函式，
 * 測試才驗得到 `editor.ts` 那一行到底有沒有把東西交出去。只呼叫 store 的測試
 * 驗不到那一行 —— 那正是 F0 當初躲過 1563 個測試的縫。
 *
 * ## 為什麼預設值要算，不能留空
 *
 * 五類骨架的 `defaultAssigneeId` 全部是 `null`（`seed.ts`）。對話框如果照著填，
 * 使用者看到的是一整排「— 不指派 —」，而按下送出就得到一份沒有任何人在上面的
 * 流程 —— 跟不開這個對話框的結果一樣。所以預設值走 `defaultActor`：
 * 骨架說這一關該給 agent 就挑一個 agent，說該給人就挑「我」。
 */
import type {
  Employee,
  FullCat,
  Section,
  StageEditTarget,
  WorkflowStageDef,
} from "../data/types";
import { escapeHtml } from "./ui";

/** `stageDefId → 執行者 id`。`null` = 這一關明確不派人 */
export type Assignments = Record<string, string | null>;

/** 整份 PRD 範本分類的顯示名。`templates.ts` 的 CAT_LABEL 是頁面私有的，那份含章節分類 */
export const FULL_CAT_LABEL: Record<FullCat, string> = {
  lean: "精簡型",
  narrative: "敘事型",
  enterprise: "完整型",
  agile: "敏捷型",
  technical: "技術型",
};

const KIND_LABEL = { review: "審閱", edit: "改稿" } as const;
const MODE_LABEL = { sequential: "串行", parallel: "並行" } as const;

/** `editTarget` 省略時 `saveAgentResult` 的落地目標。兩邊要講同一個欄位 */
const FALLBACK_EDIT_TARGET: StageEditTarget = { sectionId: "open", fieldKey: "oq" };

/** 這個帳號能不能被指派：停用的不列（`active` 省略視為啟用，那是既有資料的形狀） */
function assignable(e: Employee): boolean {
  return e.active !== false;
}

/**
 * `edit` 關卡會被整段覆寫的那個欄位的中文名。
 *
 * 查不到就顯示 id —— 顯示一個看不懂的 key 也好過顯示一個猜錯的欄位名：
 * 這行字的用途是讓使用者在指派的當下就知道哪一關會動內文，猜錯比不知道更糟。
 */
export function editTargetLabel(
  target: StageEditTarget | undefined,
  sections: readonly Section[],
): string {
  const t = target ?? FALLBACK_EDIT_TARGET;
  const field = sections.find((s) => s.id === t.sectionId)?.fields.find((f) => f.key === t.fieldKey);
  if (field) return field.label;
  // 退回目標查不到時（章節被刪掉／改名）仍要講得出人話
  if (!target) return "開放問題";
  return `${t.sectionId}.${t.fieldKey}`;
}

/**
 * 每一關的預設選取。
 *
 * 順序是硬的：`defaultAssigneeId` 有值就用它（那是流程設計者明確指定的人），
 * 否則才依 `defaultActor` 猜。猜不到就 `null` —— 不要退回「隨便挑一個」，
 * 那會讓一個沒人注意的下拉把工作派給不相干的 agent。
 */
export function buildAssignments(
  stages: readonly WorkflowStageDef[],
  employees: readonly Employee[],
  currentUser: Employee | null | undefined,
): Assignments {
  const byId = new Map(employees.map((e) => [e.id, e]));
  const firstAgent = employees.find((e) => assignable(e) && e.kind === "agent");
  const out: Assignments = {};
  for (const s of stages) {
    const explicit = s.defaultAssigneeId;
    if (explicit && assignable(byId.get(explicit) ?? ({ active: false } as Employee))) {
      out[s.id] = explicit;
      continue;
    }
    if (s.defaultActor === "human") {
      out[s.id] = currentUser && assignable(currentUser) ? currentUser.id : null;
      continue;
    }
    out[s.id] = firstAgent?.id ?? null;
  }
  return out;
}

/** 下拉的三段選項。「我」單獨列在最上面，所以兩個 optgroup 都要把自己排除掉 */
export function assignOptionGroups(
  employees: readonly Employee[],
  currentUser: Employee | null | undefined,
): { me: Employee | null; agents: Employee[]; humans: Employee[] } {
  const me = currentUser && assignable(currentUser) ? currentUser : null;
  // 排除用 `currentUser.id` 而不是 `me?.id`：目前使用者被停用時 `me` 是 null，
  // 拿 null 去比就等於沒排除 —— 一個「不能被指派」的人反而出現在人的那一組裡。
  const rest = employees.filter((e) => assignable(e) && e.id !== currentUser?.id);
  return {
    me,
    agents: rest.filter((e) => e.kind === "agent"),
    humans: rest.filter((e) => e.kind !== "agent"),
  };
}

function optionHtml(id: string, label: string, selected: boolean): string {
  return `<option value="${escapeHtml(id)}"${selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
}

function selectHtml(
  stage: WorkflowStageDef,
  groups: ReturnType<typeof assignOptionGroups>,
  picked: string | null,
): string {
  const bits = [optionHtml("", "— 不指派 —", picked === null)];
  if (groups.me) bits.push(optionHtml(groups.me.id, `我（${groups.me.name}）`, picked === groups.me.id));
  if (groups.agents.length) {
    bits.push(
      `<optgroup label="Agent">${groups.agents.map((e) => optionHtml(e.id, e.name, picked === e.id)).join("")}</optgroup>`,
    );
  }
  if (groups.humans.length) {
    bits.push(
      `<optgroup label="人">${groups.humans.map((e) => optionHtml(e.id, e.name, picked === e.id)).join("")}</optgroup>`,
    );
  }
  return `<select data-stage="${escapeHtml(stage.id)}" aria-label="${escapeHtml(stage.name)} 的執行者">${bits.join("")}</select>`;
}

/**
 * 對話框內容。**回傳的字串會原樣塞進 `askCustom` 的 `bodyHtml`**，
 * 所以這裡是 escape 的唯一責任點：關卡名與員工名都可能是使用者打的字。
 */
export function assignDialogHtml(
  stages: readonly WorkflowStageDef[],
  employees: readonly Employee[],
  currentUser: Employee | null | undefined,
  sections: readonly Section[],
  defaults: Assignments,
): string {
  const groups = assignOptionGroups(employees, currentUser);
  const rows = [...stages]
    .sort((a, b) => a.order - b.order)
    .map((s) => {
      const tags = [`<span class="tag">${KIND_LABEL[s.kind]}</span>`];
      if (s.required === false) tags.push(`<span class="tag">非必簽</span>`);
      tags.push(`<span class="sub">${MODE_LABEL[s.mode ?? "parallel"]}</span>`);
      // edit 關卡的警語不是裝飾：使用者在指派的**當下**就該知道哪一關會動內文，
      // 而不是在 agent 跑完、按下存檔之後才發現整段被換掉。
      const warn =
        s.kind === "edit"
          ? `<p class="assign-warn">這一關存檔時會整段覆寫「${escapeHtml(editTargetLabel(s.editTarget, sections))}」</p>`
          : "";
      return `
        <div class="assign-row" data-stage-row="${escapeHtml(s.id)}">
          <div class="assign-head">
            <span class="assign-order">${s.order}</span>
            <span class="assign-name">${escapeHtml(s.name)}</span>
            ${tags.join("")}
          </div>
          ${warn}
          ${selectHtml(s, groups, defaults[s.id] ?? null)}
        </div>`;
    });
  return `<div class="assign-list">${rows.join("")}</div>`;
}

/**
 * 從對話框讀回指派。
 *
 * 空字串的 option 是「不指派」，要變成 `null` 而不是 `""` ——
 * `caseFromWorkflow` 用 `w.id in assignments` 判斷「有沒有提到這一關」，
 * `""` 會被當成一個查不到的員工 id，結果跟 `null` 一樣但意圖不同；
 * 真正的差別在於 `null` 是使用者按出來的決定，測試要驗得到。
 */
export function readAssignments(root: HTMLElement): Assignments {
  const out: Assignments = {};
  for (const el of Array.from(root.querySelectorAll<HTMLSelectElement>("select[data-stage]"))) {
    const id = el.dataset.stage;
    if (!id) continue;
    out[id] = el.value ? el.value : null;
  }
  return out;
}
