/**
 * PRD 版本線的純邏輯。
 *
 * git 心智模型：working copy →（送審）commit →（核准）merge。
 *
 * 為什麼獨立成一支而不是寫在 store 裡：`store.ts` 的相依鏈用到 Vite 專屬的
 * `import.meta.glob`，在 bun test 裡載不進來 —— 所以 store 至今零測試。
 * 版本語意（哪一份是主線、這一輪改了什麼、送審該不該被擋）是最不該靠
 * 手動點擊驗證的部分，把它放在純函式裡才進得了測試網。
 */
import { markChangedLines, type LineMark } from "./file-history";
import type { PrdVersion } from "../data/types";

/** 整份 PRD：sectionId → fieldKey → 內容 */
export type Docs = Record<string, Record<string, string>>;
/** 草稿袋：形狀同 Docs，但只含「改過的欄位」 */
export type Drafts = Record<string, Record<string, string>>;

/** 主線 = 最近一次核准合併。沒有就代表這份 PRD 還沒被核准過。 */
export function pickBaseline(versions: readonly PrdVersion[]): PrdVersion | null {
  return versions.find((v) => v.kind === "merge") ?? null;
}

/** 審閱者看的那一份 = 最近一次送審的快照 */
export function pickLatestCommit(versions: readonly PrdVersion[]): PrdVersion | null {
  return versions.find((v) => v.kind === "commit") ?? null;
}

/**
 * 把草稿疊在已儲存的正文上，得到「畫面上現在顯示的內容」。
 * 不改動任何一邊 —— 呼叫端拿去算 diff 或渲染。
 */
export function applyDrafts(saved: Docs, drafts: Drafts): Docs {
  if (!Object.keys(drafts).length) return saved;
  const out: Docs = { ...saved };
  for (const [sid, fields] of Object.entries(drafts)) {
    out[sid] = { ...(saved[sid] ?? {}), ...fields };
  }
  return out;
}

/**
 * 草稿寫入的正規化：跟已儲存值相同就不該留在草稿裡。
 *
 * 少了這一步，「改了又改回去」會永遠停在 dirty 狀態 —— 使用者看著一模一樣
 * 的文字卻被擋著不能送審，而且找不到哪裡不一樣。
 */
export function nextDraftValue(
  sectionDraft: Record<string, string> | undefined,
  key: string,
  value: string,
  savedValue: string,
): Record<string, string> | undefined {
  const sec = { ...(sectionDraft ?? {}) };
  if (value === savedValue) delete sec[key];
  else sec[key] = value;
  return Object.keys(sec).length ? sec : undefined;
}

export type FieldDiff = {
  sectionId: string;
  key: string;
  before: string;
  after: string;
  marks: LineMark[];
};

/**
 * 兩份快照之間的差異，逐欄位。
 *
 * 涵蓋三種：改過的欄位、新增的欄位（before 為空）、被清空的欄位
 * （after 為空）。整個章節被移除時，它底下每個有內容的欄位各算一筆 ——
 * 審閱者需要看到「這一節整個不見了」，而不是靜悄悄少一段。
 */
export function diffDocs(before: Docs, after: Docs): FieldDiff[] {
  const out: FieldDiff[] = [];
  const sectionIds = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const sectionId of [...sectionIds].sort()) {
    const b = before[sectionId] ?? {};
    const a = after[sectionId] ?? {};
    const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
    for (const key of [...keys].sort()) {
      const bv = b[key] ?? "";
      const av = a[key] ?? "";
      if (bv === av) continue;
      out.push({ sectionId, key, before: bv, after: av, marks: markChangedLines(bv, av) });
    }
  }
  return out;
}

/** 這一輪相對主線改了幾個欄位 —— 給送審前的確認畫面用 */
export function changedFieldCount(before: Docs, after: Docs): number {
  return diffDocs(before, after).length;
}

/**
 * 送審前的把關。
 *
 * 有未儲存的草稿一律擋下：送出一份「跟你螢幕上看到的不一樣」的版本，
 * 是最難察覺也最貴的錯誤 —— 審閱者核准的東西跟作者以為送出的東西不同，
 * 而兩邊都不會發現。
 */
export function canCommit(opts: {
  hasUnsaved: boolean;
  changedFields: number;
}): { ok: boolean; reason?: string } {
  if (opts.hasUnsaved) {
    return { ok: false, reason: "還有未儲存的變更 —— 先儲存，送審才會包含它們" };
  }
  if (opts.changedFields === 0) {
    return { ok: false, reason: "跟主線沒有差異，沒有東西可以送審" };
  }
  return { ok: true };
}

/**
 * 版本線保留上限。
 *
 * 每份 commit／merge 都是整份 PRD 的快照，只增不刪會把 localStorage 撐爆 ——
 * 而寫入失敗是靜默的：畫面看起來存好了，重新載入卻回到上一次成功的狀態。
 *
 * 保留最近 N 筆，但**最近一次 merge 永遠留著**：它是主線，是所有 diff 的
 * 比較基準，掉了就永遠算不出「這一版改了什麼」。
 */
export const MAX_VERSIONS_PER_PROJECT = 30;

export function capVersions(
  versions: readonly PrdVersion[],
  max = MAX_VERSIONS_PER_PROJECT,
): PrdVersion[] {
  if (versions.length <= max) return versions as PrdVersion[];
  const kept = versions.slice(0, max);
  if (kept.some((v) => v.kind === "merge")) return kept;
  const baseline = versions.find((v) => v.kind === "merge");
  return baseline ? [...kept.slice(0, max - 1), baseline] : kept;
}

/**
 * 全部關卡完成了嗎 —— 決定核准動作要不要併入主線。
 *
 * `approveAndLock` 在「只簽了自己那一關」時同樣視為成功（案件仍停在 review）。
 * 呼叫端若不看這個旗標就無條件 merge，等於第一個關卡簽名就把整份併進主線，
 * 其餘關卡的人根本還沒看 —— 多關卡簽核形同虛設。
 */
export function allStagesSettled(
  stages: readonly { state: StageStateLike; required?: boolean }[],
): boolean {
  // **只看必簽關卡。** 以前是「每一關都要結案」，於是管理中心那個
  // 「必簽關卡」核取方塊完全沒有作用 —— 取消勾選之後那一關照樣擋著結案，
  // 而且沒有任何動作能把它變成 skipped。prod 種子的「法務」就是這個狀態。
  const gating = stages.filter((s) => s.required !== false);
  if (!gating.length) return stages.length > 0;
  // 結案 = 已核准或已略過。「不能略過必簽關卡」是 `store.skipStage` 的守衛，
  // 不是這裡的 —— 這支只回答「還有沒有人擋著」，把兩件事混在一起會讓
  // 舊資料裡的 required+skipped 永遠結不了案。
  return gating.every((s) => s.state === "approved" || s.state === "skipped");
}

/**
 * 這一次送審算不算「新的一輪」。
 *
 * `prevCommitId` 為 `null` 代表**這份 PRD 從來沒送審過** —— 第一次送審是第 1 輪，
 * 不是「從第 1 輪進到第 2 輪」。舊條件只比 `next !== prev`，而 null !== "c1"
 * 恆真，於是全新案子第一次按送審 `round` 就跳到 2：紀錄上永遠沒有第 1 輪，
 * 而「第 2 輪」這個詞在畫面上指的是使用者做的第一件事。
 *
 * 有人要求修改過就算新的一輪，即使快照沒換 —— 作者動過東西，
 * 跟 `stagesAfterResubmit` 的作廢條件用同一條理由。
 */
export function isNewRound(
  stages: readonly { state: StageStateLike }[],
  prevCommitId: string | null,
  nextCommitId: string | null,
): boolean {
  if (!stages.length) return false;
  const newSnapshot =
    Boolean(prevCommitId) && Boolean(nextCommitId) && nextCommitId !== prevCommitId;
  return newSnapshot || stages.some((s) => s.state === "changes_requested");
}

type StageStateLike = "approved" | "changes_requested" | "pending" | "empty" | "skipped";

/**
 * 重新送審時，哪些關卡的簽核要作廢。
 *
 * 換了一份新快照就要重新簽：沿用舊簽核等於把「工程看過 V1」當成
 * 「工程看過 V2」，簽核軌跡顯示已過關，但那一關的人沒看過現在要合併的內容。
 */
export function stagesAfterResubmit<T extends { state: StageStateLike }>(
  stages: readonly T[],
  prevCommitId: string | null,
  nextCommitId: string | null,
): T[] {
  // 舊條件是「前後都存在且不同」，於是 `prevCommitId` 為 null 時（重開案件之後、
  // 或呼叫端沒帶 commitId）永遠不作廢。只要拿到一個新的快照 id 就該重簽。
  const newSnapshot = Boolean(nextCommitId) && nextCommitId !== prevCommitId;
  // 有人要求修改過，代表作者動了東西 —— 就算 commitId 沒換也要重簽，
  // 否則「資安說要改」跟「資安已核准」會同時掛在同一份上
  const hadChangeRequest = stages.some((s) => s.state === "changes_requested");
  if (!newSnapshot && !hadChangeRequest) return stages as T[];
  return stages.map((s) =>
    s.state === "approved" || s.state === "changes_requested"
      ? { ...s, state: "pending" as const }
      : s,
  );
}

/**
 * 關卡歸屬 + 順序閘門。**store 與畫面共用同一條規則**。
 *
 * 職責分立（作者不能簽自己的、同族 agent 不能簽自己家的）在
 * `canApproveProject` 已經擋在前面，這裡只管關卡層級。
 *
 * 順序閘門：串行的關卡要等所有 `order` 較小的關卡結案（approved 或 skipped）。
 * `changes_requested` **不算結案** —— 前面的人說要改，後面的人先簽沒有意義。
 */
export function stageBlockedBy(
  stage: { order: number; mode?: "sequential" | "parallel" },
  stages: readonly { order: number; name: string; state: StageStateLike }[],
): string | null {
  if ((stage.mode ?? "parallel") !== "sequential") return null;
  const before = stages
    .filter((s) => s.order < stage.order)
    .sort((a, b) => a.order - b.order);
  const blocker = before.find((s) => s.state !== "approved" && s.state !== "skipped");
  return blocker ? blocker.name : null;
}

