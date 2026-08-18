import { describe, expect, test } from "bun:test";
import {
  filterProjects,
  nextProjectSort,
  parseProjectSort,
  projectFolderLabel,
  projectSortIndicator,
  sortProjects,
} from "../src/lib/project-list";
import type { Project } from "../src/data/types";

function proj(p: Partial<Project> & { id: string }): Project {
  return {
    title: p.id,
    status: "draft",
    pct: 0,
    owner: "Scott",
    ownerId: "u1",
    authorId: "u1",
    mine: true,
    updated: "剛剛",
    tag: "",
    ...p,
  } as Project;
}

const A = proj({ id: "a", title: "Anchorline", status: "review", pct: 80, lastFileAt: "2026-08-18T10:00:00Z", sourceFolder: "Project_Anchorline" });
const B = proj({ id: "b", title: "Border Loom", customName: "織機", status: "draft", pct: 20, lastFileAt: "2026-08-10T10:00:00Z", importSummary: { folderName: "Project_Border-loom", rootPath: "/x", scannedAt: "", overallScore: 0, coveragePct: 0, progressPct: 0, matchedFiles: [], missingRequired: [] } });
const C = proj({ id: "c", title: "sysapp", status: "approved", pct: 80, mine: false, description: "清單衛生", tags: ["uat"] });

const ALL = [A, B, C];

describe("篩選", () => {
  test("all 不過濾", () => {
    expect(filterProjects(ALL, { status: "all", tags: [], q: "" }).map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  test("狀態與我的取交集", () => {
    expect(filterProjects(ALL, { status: "draft", tags: [], q: "" }).map((p) => p.id)).toEqual(["b"]);
    expect(filterProjects(ALL, { status: "mine", tags: [], q: "" }).map((p) => p.id)).toEqual(["a", "b"]);
  });

  test("標籤是 AND", () => {
    expect(filterProjects(ALL, { status: "all", tags: ["uat"], q: "" }).map((p) => p.id)).toEqual(["c"]);
    expect(filterProjects(ALL, { status: "all", tags: ["uat", "缺"], q: "" })).toEqual([]);
  });

  test("搜尋比對顯示名、介紹、擁有者", () => {
    expect(filterProjects(ALL, { status: "all", tags: [], q: "織機" }).map((p) => p.id)).toEqual(["b"]);
    expect(filterProjects(ALL, { status: "all", tags: [], q: "衛生" }).map((p) => p.id)).toEqual(["c"]);
  });

  test("空白搜尋不當成條件", () => {
    expect(filterProjects(ALL, { status: "all", tags: [], q: "   " })).toHaveLength(3);
  });
});

describe("排序", () => {
  test("null 維持原順序且不改輸入", () => {
    const input = [C, A];
    expect(sortProjects(input, null).map((p) => p.id)).toEqual(["c", "a"]);
    expect(input.map((p) => p.id)).toEqual(["c", "a"]);
  });

  test("狀態走工作流順序，不是字母", () => {
    const r = sortProjects(ALL, { key: "status", dir: "asc" });
    expect(r.map((p) => p.status)).toEqual(["draft", "review", "approved"]);
  });

  test("進度同分用標題當第二鍵", () => {
    const r = sortProjects([A, C], { key: "pct", dir: "asc" });
    expect(r.map((p) => p.id)).toEqual(["a", "c"]);
  });

  test("資料夾空字串最小", () => {
    const r = sortProjects(ALL, { key: "folder", dir: "asc" });
    expect(r.map((p) => p.id)[0]).toBe("c");
  });

  test("folder 標籤優先用 importSummary.folderName", () => {
    expect(projectFolderLabel(B)).toBe("Project_Border-loom");
    expect(projectFolderLabel(A)).toBe("Project_Anchorline");
    expect(projectFolderLabel(C)).toBe("");
  });
});

describe("表頭三態", () => {
  test("同一欄：asc → desc → 回到預設", () => {
    let s = nextProjectSort(null, "pct");
    expect(s).toEqual({ key: "pct", dir: "asc" });
    s = nextProjectSort(s, "pct");
    expect(s).toEqual({ key: "pct", dir: "desc" });
    s = nextProjectSort(s, "pct");
    expect(s).toBeNull();
  });

  test("換欄從 asc 開始", () => {
    expect(nextProjectSort({ key: "pct", dir: "desc" }, "title")).toEqual({ key: "title", dir: "asc" });
  });

  test("只有正在排序的欄畫箭頭", () => {
    expect(projectSortIndicator({ key: "pct", dir: "asc" }, "pct")).toBe("▲");
    expect(projectSortIndicator({ key: "pct", dir: "desc" }, "title")).toBe("");
    expect(projectSortIndicator(null, "pct")).toBe("");
  });

  test("下拉字串解析", () => {
    expect(parseProjectSort("title:desc")).toEqual({ key: "title", dir: "desc" });
    expect(parseProjectSort("bogus:asc")).toBeNull();
    expect(parseProjectSort("")).toBeNull();
  });
});
