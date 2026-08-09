/**
 * 把掃到的 `openspec/` 路徑整理成畫面要的分群。
 *
 * 純函式、零 I/O。抽出來是為了能直接測 —— 這段的錯（全部塞進一個
 * 叫 `changes` 的群組）在畫面上要有真實資料才看得出來。
 *
 * 分群單位是 **change**，不是 `openspec/` 的第一層。OpenSpec 的工作單位就是
 * 一個 change 資料夾（proposal + design + tasks + delta specs）；用第一層分群
 * 會讓三個 change 的檔案並排成三份 tasks.md 和八份 spec.md，分不出誰是誰。
 */

export type OsKind = "root" | "change" | "spec";

export type OsRow = {
  /** 原始相對路徑（含專案資料夾名） */
  rel: string;
  /** 檔名 */
  name: string;
  /** change 底下的 delta spec 標出 domain；其餘為空 */
  sub: string;
};

export type OsGroup = {
  label: string;
  kind: OsKind;
  rows: OsRow[];
};

/** artifact 依 schema 順序排，不是字母序 —— proposal 先於 tasks 是有意義的 */
const ARTIFACT_ORDER = ["proposal.md", "design.md", "tasks.md", ".openspec.yaml"];

function artifactRank(name: string): number {
  const i = ARTIFACT_ORDER.indexOf(name);
  return i >= 0 ? i : ARTIFACT_ORDER.length;
}

const KIND_ORDER: Record<OsKind, number> = { root: 0, change: 1, spec: 2 };

/** 從全部掃到的路徑挑出 openspec 底下的 */
export function openspecFiles(allPaths: readonly string[]): string[] {
  return allPaths.filter((x) => /(^|\/)openspec\//i.test(x));
}

export function groupOpenspecFiles(files: readonly string[]): OsGroup[] {
  const groups = new Map<string, OsGroup>();

  for (const f of files) {
    const rest = f.replace(/^.*?openspec\//i, "");
    const parts = rest.split("/");

    let key: string;
    let label: string;
    let kind: OsKind;
    if (parts[0] === "changes" && parts.length > 2) {
      // changes/archive/2025-01-24-add-2fa/... 的工作單位是那個帶日期的資料夾
      const isArchive = parts[1] === "archive" && parts.length > 3;
      const id = isArchive ? parts[2] : parts[1];
      key = `c:${isArchive ? "archive/" : ""}${id}`;
      label = isArchive ? `archive/${id}` : id;
      kind = "change";
    } else if (parts[0] === "specs" && parts.length > 1) {
      key = `s:${parts[1]}`;
      label = `specs/${parts[1]}`;
      kind = "spec";
    } else {
      key = "root";
      label = "openspec/";
      kind = "root";
    }

    const g = groups.get(key) ?? { label, kind, rows: [] };
    const name = parts[parts.length - 1] ?? f;
    // change 底下的 delta spec 要標出是哪個 domain，不然三個 spec.md 一模一樣
    const specIdx = parts.indexOf("specs");
    const sub =
      kind === "change" && specIdx > 0 && parts.length > specIdx + 1
        ? `specs/${parts[specIdx + 1]}`
        : "";
    g.rows.push({ rel: f, name, sub });
    groups.set(key, g);
  }

  for (const g of groups.values()) {
    g.rows.sort((a, b) => artifactRank(a.name) - artifactRank(b.name) || a.rel.localeCompare(b.rel));
  }

  return [...groups.values()].sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.label.localeCompare(b.label),
  );
}

/**
 * 把 `allPaths` 的一筆換成真正的檔案位置。
 *
 * **三種形狀都會進來**，因為掃描來源不只一個：
 *   1. 絕對路徑 —— 原生資料夾掃描（`scanFromNativeFolder`）存的就是這個
 *   2. `<專案資料夾>/openspec/…` —— 瀏覽器 `webkitRelativePath` 帶前綴
 *   3. `openspec/…` —— 已經去過前綴的相對路徑
 *
 * 原本只處理 2 與 3，於是第 1 種會被當成相對路徑再接一次 root，組出
 * `/…/Project_X//Users/…/Project_X/openspec/README.md` 這種雙串路徑，
 * 點 OpenSpec 任何檔案都回「找不到檔案」。絕對路徑必須先擋在最前面。
 */
export function absolutePathFor(rootPath: string, rel: string): string {
  // 已經是絕對路徑就別再動它 —— 這是原生掃描的常態，不是例外
  if (rel.startsWith("/")) return rel;

  const base = rootPath.replace(/\/+$/, "");
  const folder = base.split("/").pop() ?? "";
  const trimmed = folder && rel.startsWith(`${folder}/`) ? rel.slice(folder.length + 1) : rel;
  return `${base}/${trimmed}`;
}
