/**
 * 簽核骨架的解析與疊加 —— 全部純函式，零 I/O、零 DOM。
 *
 * ## 為什麼要有這個檔
 *
 * 簽核流程原本只有一份、存在 `AppState` 頂層，每次送審都把同一套關卡複製給
 * 每個專案。「不同類型 PRD 用不同簽核邏輯」沒有掛勾點 —— 改 A 專案的流程，
 * B 專案下次送審也跟著變，而且不會有任何提示。
 *
 * 現在流程是**算出來的**：範本分類給骨架，領域包疊加合規關卡。這支就是那個
 * 算式，跟 `gate-rules.ts` 一樣刻意留在純函式層 —— 它是整套簽核裡唯一有分支
 * 判斷的地方，測不到就等於沒人知道疊加規則實際上長什麼樣。
 *
 * ## 為什麼骨架是資料、疊加是程式
 *
 * 「哪一類有哪幾關」會隨產品判斷一直變，寫成程式的話每加一類 PRD 都要改這個
 * 檔；「同名不重複、我核准殿後、order 重編」則是不隨分類改變的合併語意。
 * 前者放 `seed.ts`，後者放這裡。這條線也讓領域包維持
 * 「加一個 .md 就加一個領域，零程式碼改動」的既有契約。
 */
import { HUMAN_APPROVAL_STAGE_NAME, SEED_WORKFLOW_SKELETONS } from "../data/seed";
import type { FullCat, WorkflowStageDef } from "../data/types";

/**
 * 金融四包（payment / lending / wealth / digital_account）共用的那一關。
 *
 * 名字集中在這裡是因為「同名不重複」的鍵就是名字：四份 `.md` 各自打一遍字面值時，
 * 其中一份多一個空格就會變成兩個不同的關卡，而畫面上那兩關長得一模一樣。
 */
export const FINANCIAL_COMPLIANCE_STAGE_NAME = "金融法遵與風險";

/**
 * 認不得的分類退回 `lean`。
 *
 * 為什麼不是丟錯誤：`cat` 也可能是章節範本的分類（`core` / `security` / …），
 * 那些是合法的 `TemplateCat`，只是不對應任何整份骨架。送審在那個情況下應該
 * 照最精簡的流程走，不是整條路徑爆掉。
 */
const FALLBACK_CAT: FullCat = "lean";

function skeletonFor(
  cat: FullCat | null | undefined,
  skeletons: Record<FullCat, WorkflowStageDef[]>,
): WorkflowStageDef[] {
  return (cat && skeletons[cat]) || skeletons[FALLBACK_CAT];
}

/**
 * 骨架 + 領域包疊加 → 一組可以落地到專案上的關卡。
 *
 * 合併規則（全部在測試裡逐條釘死）：
 * 1. **同名關卡不重複**，而且以骨架為準 —— 領域包蓋不掉骨架的 `kind` 與
 *    `required`。反過來的話，一個領域包就能把必簽關卡降級成非必簽，
 *    那是繞過簽核最安靜的一條路。
 * 2. 領域包的關卡插在「我核准」**之前**，彼此依自己的 `order` 排。
 * 3. `我核准` 一律殿後 —— 它是人在整份文件上的最後一道確認，後面再接任何
 *    自動關卡都會讓「我核准了」變成一句不完整的話。
 * 4. `order` 於合併後重新編號成 1..n。
 *
 * 回傳一律是**新物件**：呼叫端會把結果寫進 `project.workflowStages` 再繼續改
 * （指派執行者），共用參考的話改一個專案會動到骨架常數本身。
 */
export function resolveWorkflow(
  cat: FullCat | null | undefined,
  packStages?: readonly WorkflowStageDef[],
  skeletons: Record<FullCat, WorkflowStageDef[]> = SEED_WORKFLOW_SKELETONS,
): WorkflowStageDef[] {
  const base = skeletonFor(cat, skeletons);
  const taken = new Set(base.map((s) => s.name));

  const extra: WorkflowStageDef[] = [];
  for (const s of [...(packStages ?? [])].sort((a, b) => a.order - b.order)) {
    // 骨架已有同名的直接丟掉；領域包自己重複宣告的也只留第一份
    if (taken.has(s.name)) continue;
    taken.add(s.name);
    extra.push(s);
  }

  const merged = [...base.map((s) => ({ ...s })), ...extra.map((s) => ({ ...s }))];
  // 排序鍵只有「是不是我核准」一項。其餘維持插入順序 —— 骨架先、領域包後，
  // 各自內部已經照 order 排過了，再依 order 全域排一次會把兩邊交錯洗牌。
  const ordered = [
    ...merged.filter((s) => s.name !== HUMAN_APPROVAL_STAGE_NAME),
    ...merged.filter((s) => s.name === HUMAN_APPROVAL_STAGE_NAME),
  ];
  return ordered.map((s, i) => ({ ...s, order: i + 1 }));
}

/**
 * 這組關卡裡有沒有「我核准」。
 *
 * 落地時用來確認結果沒有退化成一條沒有人把關的流程 —— 五類骨架都自帶那一關，
 * 但自訂範本的 `stages` 是使用者寫的，那份可以完全不含它。
 */
export function hasHumanApproval(stages: readonly WorkflowStageDef[]): boolean {
  return stages.some((s) => s.name === HUMAN_APPROVAL_STAGE_NAME && s.defaultActor === "human");
}
