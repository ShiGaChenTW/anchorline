/**
 * 工作台-OpenSpec 的畫面判定。I/O 不在這裡。
 *
 * 分頁預設、卡住原因、改名規則都是「兩個地方說反話」的高發區，
 * 所以抽成純函式，讓頁面只負責餵資料與接點擊。
 */
import { deriveChangeSlug } from "./change-templates";
import { nextArtifact, type OpenspecChange, type OpenspecListEntry } from "./openspec-status";

export const WORKBENCH_TABS = ["wishlist", "changes", "specs"] as const;
export type WorkbenchTab = (typeof WORKBENCH_TABS)[number];

export function isWorkbenchTab(v: string | null | undefined): v is WorkbenchTab {
  return v === "wishlist" || v === "changes" || v === "specs";
}

/**
 * 有未完成的 change 時不要把人丟回 Wishlist（那是在加速開新坑）。
 * URL 的 `tab` / `change` 蓋過一切；沒有未完成時才尊重記憶。
 */
export function resolveWorkbenchTab(input: {
  urlTab?: string | null;
  urlChange?: string | null;
  stored?: string | null;
  openChangeCount: number;
}): WorkbenchTab {
  if (isWorkbenchTab(input.urlTab)) return input.urlTab;
  if (input.urlChange) return "changes";
  if (input.openChangeCount > 0) {
    return input.stored === "specs" ? "specs" : "changes";
  }
  if (isWorkbenchTab(input.stored)) return input.stored;
  return "wishlist";
}

export type StallProgress = { closed: number; total: number };

export type ChangeStall = {
  why: string;
  actionLabel: string;
  /** 主按鈕要做的事。頁面再對成開檔／複製指令。 */
  actionKind: "open-artifact" | "open-tasks" | "archive" | "none";
  progressLabel: string;
  staleDays: number | null;
};

export function daysSince(iso: string, now = Date.now()): number | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = Math.floor((now - t) / 86_400_000);
  return d >= 0 ? d : 0;
}

function progressLabelOf(
  progress: StallProgress | null,
  listed: OpenspecListEntry | undefined,
): string {
  if (progress && progress.total > 0) return `${progress.closed}/${progress.total}`;
  if (listed && listed.totalTasks > 0) return `${listed.completedTasks}/${listed.totalTasks}`;
  return "—";
}

/**
 * 這一列為什麼還沒收、主按鈕該寫什麼。
 *
 * 資料來源與左欄分組相同（tasks 勾選 + CLI status），提示跟分類才不會說反話。
 */
export function changeStall(input: {
  archived: boolean;
  progress: StallProgress | null;
  health?: OpenspecChange | null;
  listed?: OpenspecListEntry | null;
  nextStep?: string | null;
  now?: number;
}): ChangeStall {
  const listed = input.listed ?? undefined;
  const progressLabel = progressLabelOf(input.progress, listed);
  const staleDays = listed?.lastModified ? daysSince(listed.lastModified, input.now) : null;
  const staleBit =
    staleDays != null && staleDays >= 3 ? ` · ${staleDays} 天沒動` : "";

  if (input.archived) {
    return {
      why: "已封存。這是歷史，不是待辦。",
      actionLabel: "",
      actionKind: "none",
      progressLabel,
      staleDays,
    };
  }

  const health = input.health ?? null;
  const next = health ? nextArtifact(health) : null;
  const blocked = health?.artifacts.filter((a) => a.status === "blocked") ?? [];
  const missing = [...new Set(blocked.flatMap((a) => a.missingDeps ?? []))];

  if (next && next.id !== "tasks") {
    return {
      why: missing.length
        ? `被擋住：缺 ${missing.join("、")}。下一步：寫 ${next.outputPath || next.id}。${staleBit}`.trim()
        : `下一步：寫 ${next.outputPath || next.id}。${staleBit}`.trim(),
      actionLabel: `寫 ${next.id}`,
      actionKind: "open-artifact",
      progressLabel,
      staleDays,
    };
  }

  const p = input.progress;
  if (!p || p.total <= 0) {
    return {
      why: `還沒有可勾的步驟（掃不到 tasks.md，或步驟是 0）。${staleBit}`.trim(),
      actionLabel: "開 tasks.md",
      actionKind: "open-tasks",
      progressLabel,
      staleDays,
    };
  }

  if (p.closed >= p.total) {
    return {
      why: `步驟勾完了，還沒 archive，所以還佔著清單。${staleBit}`.trim(),
      actionLabel: "複製 archive 指令",
      actionKind: "archive",
      progressLabel,
      staleDays,
    };
  }

  if (p.closed === 0) {
    const step = input.nextStep?.trim();
    return {
      why: `${p.total} 步一題都還沒勾。${step ? `第一步：${step}。` : ""}${staleBit}`.trim(),
      actionLabel: step ? `開始 ${step}` : "開始第一步",
      actionKind: "open-tasks",
      progressLabel,
      staleDays,
    };
  }

  const step = input.nextStep?.trim();
  return {
    why: step
      ? `停在「${step}」。${staleBit}`.trim()
      : `做到 ${p.closed}/${p.total}。${staleBit}`.trim(),
    actionLabel: step ? `繼續 ${step}` : "繼續下一步",
    actionKind: "open-tasks",
    progressLabel,
    staleDays,
  };
}

export type RenameResult = { ok: true; slug: string } | { ok: false; reason: string };

/**
 * 新 id 必須是 kebab-case，而且不能撞到現有的 change。
 * 中文標題推不出 slug —— 跟開新 change 同一條規則，避免大家都叫 `change`。
 */
export function validateChangeRename(
  oldId: string,
  raw: string,
  existingIds: readonly string[],
): RenameResult {
  if (oldId.includes("/") || oldId === "archive") {
    return { ok: false, reason: "已封存的 change 不能改名。" };
  }
  const slug = deriveChangeSlug(raw);
  if (!slug) {
    return { ok: false, reason: "請用英數與連字號，例如 add-habit-tracker。" };
  }
  if (slug === "archive") {
    return { ok: false, reason: "archive 是保留名稱。" };
  }
  if (slug === oldId) {
    return { ok: false, reason: "名稱沒有改。" };
  }
  if (existingIds.some((id) => id === slug)) {
    return { ok: false, reason: `已經有一個叫 ${slug} 的 change。` };
  }
  return { ok: true, slug };
}

/**
 * 改名後把 importSummary.allPaths 裡的舊資料夾換成新的。
 * 只動路徑段 `openspec/changes/<id>`，避免 `add-auth` 誤傷 `add-auth-flow`。
 */
export function rewriteChangePaths(
  paths: readonly string[],
  oldId: string,
  newId: string,
): string[] {
  const re = new RegExp(`(^|/)openspec/changes/${escapeRegExp(oldId)}(?=/|$)`, "g");
  return paths.map((p) => p.replace(/\\/g, "/").replace(re, `$1openspec/changes/${newId}`));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function archiveCommand(projectRoot: string, changeId: string): string {
  const root = projectRoot.replace(/'/g, `'\\''`);
  return `cd '${root}' && openspec archive ${changeId}`;
}
