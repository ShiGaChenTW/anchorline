/**
 * 專案清單的篩選與排序 —— 純函式，零 I/O、零 DOM。
 *
 * 「列表」與「卡片／資料夾」是同一份結果的兩種畫法。判定若留在
 * `pages/projects.ts` 的渲染函式裡，兩種畫法遲早各自帶一份條件，
 * 切換檢視筆數會變。所以篩選與排序只有這裡一份。
 *
 * 排序是三態：升冪 → 降冪 → 回到 `visibleProjects()` 的原順序。
 * 與範本庫 `template-view.ts` 同一契約，使用者不用學第二套。
 */
import { projectDisplayName, type Project, type ProjectStatus } from "../data/types";

export type ProjectSortKey = "title" | "status" | "pct" | "updated" | "folder";
export type ProjectSortDir = "asc" | "desc";
export type ProjectSortState = { key: ProjectSortKey; dir: ProjectSortDir } | null;

export type ProjectListFilter = {
  /** `"all"` 不過濾；`"mine"` 只看自己的；其餘依狀態 */
  status: "all" | "mine" | ProjectStatus;
  /** AND：選了兩個就是同時有這兩個標籤 */
  tags: readonly string[];
  q: string;
};

/** 工作流順序，不是字母序 —— 「草稿」不該排在「已核准」後面只因為碼點。 */
const STATUS_RANK: Record<ProjectStatus, number> = {
  draft: 0,
  review: 1,
  approved: 2,
  withdrawn: 3,
};

export function projectFolderLabel(p: Project): string {
  return p.importSummary?.folderName || p.sourceFolder || "";
}

/** 排序用的時間。相對字串（「剛剛」）比不了，有 ISO 才比得準。 */
export function projectUpdatedAt(p: Project): number {
  if (!p.lastFileAt) return 0;
  const t = Date.parse(p.lastFileAt);
  return Number.isNaN(t) ? 0 : t;
}

export function filterProjects(all: readonly Project[], f: ProjectListFilter): Project[] {
  const q = f.q.trim();
  const lower = q.toLowerCase();
  return all.filter((p) => {
    if (f.status === "mine" && !p.mine) return false;
    if (f.status !== "all" && f.status !== "mine" && p.status !== f.status) return false;
    if (f.tags.length) {
      const own = (p.tags ?? []).map((t) => t.toLowerCase());
      if (!f.tags.every((t) => own.includes(t.toLowerCase()))) return false;
    }
    if (!q) return true;
    return (
      p.title.toLowerCase().includes(lower) ||
      (p.customName ?? "").toLowerCase().includes(lower) ||
      (p.description ?? "").includes(q) ||
      p.owner.includes(q) ||
      p.tag.toLowerCase().includes(lower) ||
      (p.tags ?? []).some((t) => t.toLowerCase().includes(lower))
    );
  });
}

function valueOf(p: Project, key: ProjectSortKey): string | number {
  switch (key) {
    case "title":
      return projectDisplayName(p);
    case "status":
      return STATUS_RANK[p.status];
    case "pct":
      return p.pct;
    case "updated":
      return projectUpdatedAt(p);
    case "folder":
      return projectFolderLabel(p);
  }
}

export function sortProjects(list: readonly Project[], sort: ProjectSortState): Project[] {
  if (!sort) return [...list];
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = valueOf(a, sort.key);
    const vb = valueOf(b, sort.key);
    if (typeof va === "number" && typeof vb === "number") {
      if (va !== vb) return (va - vb) * sign;
      return projectDisplayName(a).localeCompare(projectDisplayName(b), "zh-Hant");
    }
    const cmp = String(va).localeCompare(String(vb), "zh-Hant");
    if (cmp !== 0) return cmp * sign;
    return projectDisplayName(a).localeCompare(projectDisplayName(b), "zh-Hant");
  });
}

export function nextProjectSort(current: ProjectSortState, key: ProjectSortKey): ProjectSortState {
  if (!current || current.key !== key) return { key, dir: "asc" };
  if (current.dir === "asc") return { key, dir: "desc" };
  return null;
}

export function projectSortIndicator(sort: ProjectSortState, key: ProjectSortKey): "" | "▲" | "▼" {
  if (!sort || sort.key !== key) return "";
  return sort.dir === "asc" ? "▲" : "▼";
}

export function parseProjectSort(raw: string | null | undefined): ProjectSortState {
  if (!raw) return null;
  const [key, dir] = raw.split(":");
  if (
    (key === "title" || key === "status" || key === "pct" || key === "updated" || key === "folder") &&
    (dir === "asc" || dir === "desc")
  ) {
    return { key, dir };
  }
  return null;
}
