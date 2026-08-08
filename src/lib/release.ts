/**
 * 版本取號與內容編列。
 *
 * **核心規則：版號一律由使用者決定，系統絕不自動指定。**
 *
 * 系統會做的只有兩件事：告訴你上一版是什麼（讓你有參照）、以及在你打的
 * 版號重複或格式不合時攔下來。它不會幫你 +1，也不會在你沒填的時候塞一個
 * 預設值 —— 版號是對外承諾，那個決定必須是人做的。
 *
 * 純函式、零 I/O，方便直接測。
 */

/** 內容項目的完成狀態 —— 一版裡可以同時有做完的和還沒做的 */
export type ReleaseItemState = "done" | "planned";

/** 項目從哪裡來。manual 是使用者自己打的。 */
export type ReleaseItemSource = "section" | "commit" | "manual";

export type ReleaseItem = {
  id: string;
  text: string;
  state: ReleaseItemState;
  source: ReleaseItemSource;
  /** 來源的原始識別（章節 id / commit hash），manual 為空 */
  ref?: string;
};

export type ReleaseStatus = "draft" | "locked" | "handed";

export type Release = {
  id: string;
  projectId: string;
  /** 使用者輸入的版號，原文保留 */
  version: string;
  title: string;
  note: string;
  status: ReleaseStatus;
  items: ReleaseItem[];
  createdAt: string;
  updatedAt: string;
  /** 送交執行的時間；沒送過為 null */
  handedAt: string | null;
};

// ── 版號驗證 ────────────────────────────────────────────────────

export type VersionCheck = { ok: true } | { ok: false; reason: string };

/**
 * 版號格式檢查。刻意寬鬆 —— 只擋掉「一定會出問題」的，不強迫 semver。
 *
 * 有人用 v1.2.3、有人用 2026.08、有人用 R42。硬要 semver 只會讓使用者
 * 為了通過驗證去改自己的慣例，那是工具越權。
 */
export function checkVersionFormat(raw: string): VersionCheck {
  const v = raw.trim();
  if (!v) return { ok: false, reason: "版號不能空白 —— 這個欄位只有你能決定" };
  if (v.length > 40) return { ok: false, reason: "版號太長（上限 40 字）" };
  if (/\s/.test(v)) return { ok: false, reason: "版號中間不要有空白" };
  // git tag 不接受這些字元；就算不打 tag，路徑與檔名也會出事
  if (/[~^:?*[\]\\/@{}]/.test(v)) return { ok: false, reason: "版號不能包含 ~ ^ : ? * [ ] \\ / @ { }" };
  if (/^[.-]|[.-]$/.test(v)) return { ok: false, reason: "版號不要以 . 或 - 開頭／結尾" };
  return { ok: true };
}

/** 同一個專案裡不能有兩個一樣的版號（忽略大小寫） */
export function isVersionTaken(
  version: string,
  projectId: string,
  releases: readonly Release[],
  exceptId?: string,
): boolean {
  const v = version.trim().toLowerCase();
  return releases.some(
    (r) => r.projectId === projectId && r.id !== exceptId && r.version.trim().toLowerCase() === v,
  );
}

export function validateVersion(
  version: string,
  projectId: string,
  releases: readonly Release[],
  exceptId?: string,
): VersionCheck {
  const fmt = checkVersionFormat(version);
  if (!fmt.ok) return fmt;
  if (isVersionTaken(version, projectId, releases, exceptId)) {
    return { ok: false, reason: `版號「${version.trim()}」已經用過了` };
  }
  return { ok: true };
}

/**
 * 上一個版號 —— **只作為參照顯示，不拿來自動填**。
 * 依建立時間取最新的，不做版號大小比較：使用者的編號慣例不一定可比較。
 */
export function lastVersionOf(projectId: string, releases: readonly Release[]): string | null {
  const mine = releases
    .filter((r) => r.projectId === projectId)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return mine[0]?.version ?? null;
}

// ── 統計 ────────────────────────────────────────────────────────

export type ReleaseProgress = { done: number; planned: number; total: number; pct: number };

export function releaseProgress(r: Release): ReleaseProgress {
  const done = r.items.filter((i) => i.state === "done").length;
  const total = r.items.length;
  return {
    done,
    planned: total - done,
    total,
    pct: total ? Math.round((done / total) * 100) : 0,
  };
}

// ── 送交執行用的交辦單 ──────────────────────────────────────────

/**
 * 交辦單。給人讀也給 agent 讀，所以用 markdown 而不是 JSON ——
 * agent 讀 markdown 沒問題，人讀 JSON 很痛苦。
 *
 * 尚未開發的項目排在前面：那才是要交辦出去做的事。已完成的放後面當範圍說明。
 */
export function buildHandoff(r: Release, projectTitle: string): string {
  const p = releaseProgress(r);
  const planned = r.items.filter((i) => i.state === "planned");
  const done = r.items.filter((i) => i.state === "done");
  const line = (i: ReleaseItem) =>
    `- [${i.state === "done" ? "x" : " "}] ${i.text}${i.ref ? `　\`${i.ref}\`` : ""}`;

  return [
    `# 版本交辦：${r.version}${r.title ? ` — ${r.title}` : ""}`,
    "",
    `**專案**：${projectTitle}`,
    `**版號**：${r.version}（由使用者指定）`,
    `**進度**：${p.done}/${p.total} 已完成（${p.pct}%）`,
    "",
    ...(r.note.trim() ? ["## 版本說明", "", r.note.trim(), ""] : []),
    "## 待開發（這次要做的）",
    "",
    ...(planned.length ? planned.map(line) : ["（無）"]),
    "",
    "## 已完成（本版範圍內，已經做好的）",
    "",
    ...(done.length ? done.map(line) : ["（無）"]),
    "",
    "## 完成後",
    "",
    `- 全部待開發項目勾完後，用 \`git tag -a ${r.version} -m '${r.version}'\` 標版`,
    "- 版號由使用者決定，不要自行改動或遞增",
  ].join("\n");
}

/** 新建一筆草稿。版號留白 —— 由使用者填，這裡不預設任何值。 */
export function draftRelease(projectId: string, id: string, now: string): Release {
  return {
    id,
    projectId,
    version: "",
    title: "",
    note: "",
    status: "draft",
    items: [],
    createdAt: now,
    updatedAt: now,
    handedAt: null,
  };
}
