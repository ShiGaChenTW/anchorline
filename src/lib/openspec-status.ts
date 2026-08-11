/**
 * OpenSpec 進度 —— 只解析 CLI 的 `--json`，不碰 `openspec/` 底下任何檔案內容。
 *
 * **為什麼不自己讀 spec.md**：上游格式會演進，自己解析等於維護一份會跟上游分岔的
 * 第二實作。CLI 已經提供結構化狀態，而原生橋本來就在跑 git / fastfetch / onefetch，
 * 多跑一個 openspec 是同一件事。（見 `plans/2026-08-08_openspec-tracking-adoption-report.md` §五）
 *
 * 這個檔只做純運算：吃 CLI 的原始輸出字串，吐型別化結果。I/O 在呼叫端。
 * 形狀實測自 openspec v1.6.0（2026-08-09）。
 */

/** CLI 的四種 artifact 狀態。依相依順序排列，第一個 ready 就是下一步。 */
export type ArtifactStatus = "done" | "ready" | "blocked" | "skipped";

export type OpenspecArtifact = {
  id: string;
  outputPath: string;
  status: ArtifactStatus;
  missingDeps?: string[];
};

export type OpenspecChange = {
  name: string;
  isComplete: boolean;
  applyRequires: string[];
  artifacts: OpenspecArtifact[];
};

/** `openspec list --json` 的一列。tasks 計數是 CLI 自己算的，直接用。 */
export type OpenspecListEntry = {
  name: string;
  completedTasks: number;
  totalTasks: number;
  lastModified: string;
  status: string;
};

/** CLI 不在、不是 openspec 專案、輸出壞掉 —— 全部走這個，不是錯誤。 */
export type OpenspecUnavailable = { available: false; reason: string };
export type OpenspecReport = {
  available: true;
  changes: OpenspecChange[];
  /**
   * `openspec list --json` 的原始列。**判讀一律走 `changes`**，這裡只多帶
   * `list` 才有而 `status` 沒有的兩樣東西：`lastModified` 與 tasks 計數。
   *
   * 為什麼要：畫面要回答「這個 change 幾天沒動了」。時間盲是 ADHD 的核心缺損，
   * 而「三天沒動」跟「剛剛才動」對要不要現在接手是完全不同的答案。
   * 選填 —— 舊呼叫端（`overview.ts`）不讀它，不必跟著改。
   */
  listed?: OpenspecListEntry[];
};
export type OpenspecResult = OpenspecReport | OpenspecUnavailable;

const KNOWN_STATUS: ArtifactStatus[] = ["done", "ready", "blocked", "skipped"];

function asStatus(v: unknown): ArtifactStatus {
  return KNOWN_STATUS.includes(v as ArtifactStatus) ? (v as ArtifactStatus) : "blocked";
}

/** 壞 JSON 一律回 null，由呼叫端決定退路。這個函式沒有 throw 路徑。 */
function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 解析 `openspec list --json`。認不得就回空陣列，不丟例外。 */
export function parseOpenspecList(raw: string): OpenspecListEntry[] {
  const d = safeParse(raw) as { changes?: unknown[] } | null;
  if (!d || !Array.isArray(d.changes)) return [];
  return d.changes
    .map((c) => c as Record<string, unknown>)
    .filter((c) => typeof c.name === "string" && c.name)
    .map((c) => ({
      name: c.name as string,
      completedTasks: Number(c.completedTasks) || 0,
      totalTasks: Number(c.totalTasks) || 0,
      lastModified: String(c.lastModified ?? ""),
      status: String(c.status ?? ""),
    }));
}

/** 解析 `openspec status --change <id> --json`。 */
export function parseOpenspecStatus(raw: string): OpenspecChange | null {
  const d = safeParse(raw) as Record<string, unknown> | null;
  if (!d || typeof d.changeName !== "string") return null;
  const arts = Array.isArray(d.artifacts) ? d.artifacts : [];
  return {
    name: d.changeName,
    isComplete: d.isComplete === true,
    applyRequires: Array.isArray(d.applyRequires) ? d.applyRequires.map(String) : [],
    artifacts: arts
      .map((a) => a as Record<string, unknown>)
      .filter((a) => typeof a.id === "string")
      .map((a) => ({
        id: a.id as string,
        outputPath: String(a.outputPath ?? ""),
        status: asStatus(a.status),
        ...(Array.isArray(a.missingDeps) ? { missingDeps: a.missingDeps.map(String) } : {}),
      })),
  };
}

/**
 * 下一步該寫哪個 artifact。
 *
 * CLI 已經依相依順序排好，所以「第一個 ready」就是答案 —— 不需要自己算相依圖。
 * 全部 done 或全部 blocked 時回 null，呼叫端顯示「沒有下一步」而不是硬編一個。
 */
export function nextArtifact(change: OpenspecChange): OpenspecArtifact | null {
  return change.artifacts.find((a) => a.status === "ready") ?? null;
}

/**
 * artifact 完成率。skipped 算完成 —— schema 說「dependencies are enablers, not gates」，
 * 跳過 design 是合法的完成路徑，把它算成未完成會讓進度永遠到不了 100%。
 */
export function openspecProgressPct(changes: OpenspecChange[]): number | null {
  const all = changes.flatMap((c) => c.artifacts);
  if (!all.length) return null;
  const done = all.filter((a) => a.status === "done" || a.status === "skipped").length;
  return Math.round((done / all.length) * 100);
}

/** 給焦點卡的一句話。沒有 change 就明講，不要顯示 0%。 */
export function openspecHeadline(result: OpenspecResult): string {
  if (!result.available) return result.reason;
  if (!result.changes.length) return "沒有進行中的 change";
  const open = result.changes.filter((c) => !c.isComplete);
  if (!open.length) return `${result.changes.length} 個 change 都完成了`;
  const next = nextArtifact(open[0]!);
  return next ? `下一步：寫 ${next.outputPath}（${open[0]!.name}）` : `${open[0]!.name} 沒有可寫的下一步`;
}
