/**
 * 專案快照 —— AI 撰寫的前置條件。純函式、零 I/O。
 *
 * ## 為什麼要前置
 *
 * 沒讀過專案就寫出來的變更文件是編的。模型手上只有一個標題時，
 * 它會很流暢地寫出一份看起來合理、但跟這個 repo 沒有關係的提案。
 * 所以既有專案要先有一份「當時的專案長這樣」的摘要，才給寫。
 *
 * ## 為什麼不覆寫
 *
 * 快照的檔名帶時間、每次重讀都是新檔。覆寫掉就沒有東西可以回答
 * 「這中間變了什麼」—— 而那正是「落後多少」這個數字的來源。
 */

/** `<專案名>-<YYYYMMDD-HHmm>.md`，放在 `.anchorline/context/` */
export const SNAPSHOT_DIR = ".anchorline/context";

/** 檔名裡的專案名只留安全字元，其餘換成 `-`；空的就用 `project` */
export function snapshotSlug(projectName: string): string {
  const s = projectName
    .trim()
    .replace(/[/\\:*?"<>|\s]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "project";
}

export function snapshotFileName(projectName: string, at: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}`;
  return `${snapshotSlug(projectName)}-${stamp}.md`;
}

/** 從檔名把時間讀回來。認不得就回 null —— 使用者自己丟進來的檔不該讓畫面壞掉。 */
export function parseSnapshotTime(fileName: string): Date | null {
  const m = /-(\d{8})-(\d{4})\.md$/.exec(fileName);
  if (!m) return null;
  const d = m[1]!;
  const t = m[2]!;
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:00`;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at;
}

export type SnapshotFile = { name: string; mtimeMs: number };

/**
 * 最新的一份快照。**時間優先讀檔名**，讀不到才退回 mtime ——
 * 檔案被複製或搬動時 mtime 會變，而檔名裡的時間是快照真正產生的時刻。
 */
export function latestSnapshot(files: readonly SnapshotFile[]): { name: string; at: Date } | null {
  const withTime = files
    .map((f) => ({ name: f.name, at: parseSnapshotTime(f.name) ?? new Date(f.mtimeMs) }))
    .filter((f) => !Number.isNaN(f.at.getTime()));
  if (!withTime.length) return null;
  return withTime.sort((a, b) => b.at.getTime() - a.at.getTime())[0]!;
}

// ── 落後多少 ────────────────────────────────────────────────────

export type Staleness = {
  /** 快照之後有幾筆 commit */
  commitsBehind: number;
  /** 快照距今多久（毫秒） */
  ageMs: number;
  /** 該不該提醒重讀 */
  stale: boolean;
};

/** 超過這個天數就提醒，即使沒有新 commit —— 沒進版控的改動一樣會讓快照過期 */
export const STALE_DAYS = 7;

/**
 * 快照落後多少。
 *
 * 兩個判準都要看：**commit 數**回答「程式碼變了多少」，
 * **年齡**回答「這中間可能發生過沒進版控的事」。只看 commit 數的話，
 * 一個一週沒 commit 但改了一堆的專案會顯示「沒有落後」。
 */
export function staleness(
  snapshotAt: Date,
  commitTimes: readonly string[],
  nowMs: number,
): Staleness {
  const t = snapshotAt.getTime();
  const commitsBehind = commitTimes.filter((iso) => {
    const c = new Date(iso).getTime();
    return Number.isFinite(c) && c > t;
  }).length;
  const ageMs = Math.max(0, nowMs - t);
  return {
    commitsBehind,
    ageMs,
    stale: commitsBehind > 0 || ageMs > STALE_DAYS * 86_400_000,
  };
}

// ── 摘要組裝 ────────────────────────────────────────────────────

export type ScannedFile = { path: string; text: string };

export type SnapshotInput = {
  projectName: string;
  rootPath: string;
  at: Date;
  files: readonly ScannedFile[];
  /** git 一句話摘要，可為空 */
  gitLine: string;
  truncated: boolean;
};

/** 單一檔案在快照裡的內容上限。整包再大也不能讓一個檔吃掉全部。 */
export const PER_FILE_LIMIT = 6_000;

/**
 * 組成快照的 Markdown。
 *
 * 這份東西有兩個讀者：模型（當背景）與人（判斷這份快照涵蓋了什麼）。
 * 所以檔案清單放前面 —— 人只想知道「讀到了哪些」，不必捲過全部內容。
 */
export function buildSnapshot(input: SnapshotInput): string {
  const { projectName, rootPath, at, files, gitLine, truncated } = input;
  const out: string[] = [
    `# 專案快照：${projectName}`,
    "",
    `**產生時間：** ${at.toISOString()}`,
    `**專案路徑：** ${rootPath}`,
    `**檔案數：** ${files.length}`,
  ];
  if (gitLine) out.push(`**版控：** ${gitLine}`);
  if (truncated) {
    out.push("", "> ⚠️ 這份快照因為檔案數或大小上限而**沒有讀完整個資料夾**。");
  }
  out.push("", "## 檔案清單", "");
  out.push(...files.map((f) => `- \`${f.path}\``));
  out.push("", "## 內容", "");
  for (const f of files) {
    const body = f.text.length > PER_FILE_LIMIT ? `${f.text.slice(0, PER_FILE_LIMIT)}\n…（截斷）` : f.text;
    out.push(`### \`${f.path}\``, "", "```", body, "```", "");
  }
  return out.join("\n");
}
