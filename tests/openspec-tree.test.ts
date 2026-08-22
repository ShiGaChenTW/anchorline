import { describe, expect, test } from "bun:test";
import {
  absolutePathFor,
  groupOpenspecFiles,
  openspecFiles,
  specRows,
} from "../src/lib/openspec-tree";

/** Project_Border-loom_rust 實際掃到的 17 個路徑（2026-08-08） */
const REAL = [
  "Project_Border-loom_rust/openspec/changes/prompt-library/specs/prompt-picker/spec.md",
  "Project_Border-loom_rust/openspec/changes/prompt-library/specs/prompt-library/spec.md",
  "Project_Border-loom_rust/openspec/changes/prompt-library/tasks.md",
  "Project_Border-loom_rust/openspec/changes/prompt-library/design.md",
  "Project_Border-loom_rust/openspec/changes/prompt-library/proposal.md",
  "Project_Border-loom_rust/openspec/changes/establish-tauri-rust-mainline/specs/tauri-release-verification/spec.md",
  "Project_Border-loom_rust/openspec/changes/establish-tauri-rust-mainline/specs/release-line-separation/spec.md",
  "Project_Border-loom_rust/openspec/changes/establish-tauri-rust-mainline/specs/tauri-rust-mainline/spec.md",
  "Project_Border-loom_rust/openspec/changes/establish-tauri-rust-mainline/tasks.md",
  "Project_Border-loom_rust/openspec/changes/establish-tauri-rust-mainline/design.md",
  "Project_Border-loom_rust/openspec/changes/establish-tauri-rust-mainline/proposal.md",
  "Project_Border-loom_rust/openspec/changes/harden-release-foundation/specs/release-readiness/spec.md",
  "Project_Border-loom_rust/openspec/changes/harden-release-foundation/specs/runtime-reconciliation/spec.md",
  "Project_Border-loom_rust/openspec/changes/harden-release-foundation/specs/bounded-workload/spec.md",
  "Project_Border-loom_rust/openspec/changes/harden-release-foundation/tasks.md",
  "Project_Border-loom_rust/openspec/changes/harden-release-foundation/design.md",
  "Project_Border-loom_rust/openspec/changes/harden-release-foundation/proposal.md",
];

describe("openspecFiles", () => {
  test("只挑 openspec/ 底下的", () => {
    expect(openspecFiles(["a/README.md", "a/openspec/config.yaml", "b/src/x.ts"])).toEqual([
      "a/openspec/config.yaml",
    ]);
  });

  test("不把 my-openspec-notes/ 之類誤判進來", () => {
    expect(openspecFiles(["docs/my-openspec-notes/a.md"])).toEqual([]);
  });

  test("路徑最前面就是 openspec/ 也要收", () => {
    expect(openspecFiles(["openspec/specs/auth/spec.md"])).toHaveLength(1);
  });
});

describe("groupOpenspecFiles — 真實資料", () => {
  const groups = groupOpenspecFiles(REAL);

  test("依 change 分成三群，不是全部塞進 changes", () => {
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.label)).toEqual([
      "establish-tauri-rust-mainline",
      "harden-release-foundation",
      "prompt-library",
    ]);
    expect(groups.every((g) => g.kind === "change")).toBe(true);
  });

  test("17 個檔一個都沒掉", () => {
    expect(groups.reduce((n, g) => n + g.rows.length, 0)).toBe(REAL.length);
  });

  test("artifact 依 schema 順序，不是字母序", () => {
    const g = groups.find((x) => x.label === "prompt-library")!;
    expect(g.rows.map((r) => r.name)).toEqual([
      "proposal.md",
      "design.md",
      "tasks.md",
      "spec.md",
      "spec.md",
    ]);
  });

  test("delta spec 標出 domain，否則三個 spec.md 分不出誰是誰", () => {
    const g = groups.find((x) => x.label === "harden-release-foundation")!;
    const specs = g.rows.filter((r) => r.name === "spec.md").map((r) => r.sub);
    expect(specs.sort()).toEqual([
      "specs/bounded-workload",
      "specs/release-readiness",
      "specs/runtime-reconciliation",
    ]);
  });

  test("非 spec 的 artifact 沒有 sub", () => {
    const g = groups.find((x) => x.label === "prompt-library")!;
    expect(g.rows.find((r) => r.name === "tasks.md")!.sub).toBe("");
  });
});

describe("groupOpenspecFiles — 其他形狀", () => {
  test("openspec/specs/<domain> 自成一群", () => {
    const g = groupOpenspecFiles([
      "p/openspec/specs/auth/spec.md",
      "p/openspec/specs/payments/spec.md",
    ]);
    expect(g.map((x) => [x.label, x.kind])).toEqual([
      ["specs/auth", "spec"],
      ["specs/payments", "spec"],
    ]);
  });

  test("根目錄檔（config.yaml）排最前面", () => {
    const g = groupOpenspecFiles([
      "p/openspec/specs/auth/spec.md",
      "p/openspec/changes/add-x/proposal.md",
      "p/openspec/config.yaml",
    ]);
    expect(g.map((x) => x.kind)).toEqual(["root", "change", "spec"]);
    expect(g[0].label).toBe("openspec/");
  });

  test("archive 底下用帶日期的資料夾當群組，不是全部叫 archive", () => {
    const g = groupOpenspecFiles([
      "p/openspec/changes/archive/2025-01-24-add-2fa/proposal.md",
      "p/openspec/changes/archive/2025-02-01-fix-auth/proposal.md",
    ]);
    expect(g.map((x) => x.label)).toEqual([
      "archive/2025-01-24-add-2fa",
      "archive/2025-02-01-fix-auth",
    ]);
  });

  test("空陣列不炸", () => {
    expect(groupOpenspecFiles([])).toEqual([]);
  });
});

describe("absolutePathFor", () => {
  // 這一組是漏掉的那個形狀。原生資料夾掃描（scanFromNativeFolder）存進
  // allPaths 的就是絕對路徑，但實作與測試都只想過「相對路徑」，於是 root
  // 被再接一次，組出 `/…/Proj//Users/…/Proj/openspec/x.md`。
  // 症狀是點 OpenSpec 任何檔案都回「找不到檔案」。
  test("已經是絕對路徑就原樣回傳，不能再接一次 root", () => {
    const abs = "/Users/s/Projects/Border-loom/openspec/config.yaml";
    expect(absolutePathFor("/Users/s/Projects/Border-loom", abs)).toBe(abs);
  });

  test("絕對路徑即使不在 rootPath 底下也不改寫", () => {
    const abs = "/Volumes/ext/other/openspec/a.md";
    expect(absolutePathFor("/Users/s/Projects/Border-loom", abs)).toBe(abs);
  });

  test("回傳的路徑永遠不含連續斜線", () => {
    const abs = "/Users/s/Projects/Border-loom/openspec/config.yaml";
    expect(absolutePathFor("/Users/s/Projects/Border-loom", abs)).not.toContain("//");
    expect(absolutePathFor("/Users/s/p/", "openspec/a.md")).not.toContain("//");
  });

  test("相對路徑帶專案資料夾名時要去掉，不然會多一層", () => {
    expect(
      absolutePathFor("/Users/s/Projects/Border-loom", "Border-loom/openspec/config.yaml"),
    ).toBe("/Users/s/Projects/Border-loom/openspec/config.yaml");
  });

  test("相對路徑沒帶前綴時直接接", () => {
    expect(absolutePathFor("/Users/s/Projects/Border-loom", "openspec/config.yaml")).toBe(
      "/Users/s/Projects/Border-loom/openspec/config.yaml",
    );
  });

  test("rootPath 尾端有斜線也要正確", () => {
    expect(absolutePathFor("/Users/s/p/", "openspec/a.md")).toBe("/Users/s/p/openspec/a.md");
  });

  test("資料夾名剛好是路徑的前綴子字串時不能誤切", () => {
    // rootPath 資料夾叫 "loom"，路徑第一段是 "loom-extra" —— 不該被當成前綴
    expect(absolutePathFor("/Users/s/loom", "loom-extra/openspec/a.md")).toBe(
      "/Users/s/loom/loom-extra/openspec/a.md",
    );
  });
});

describe("specRows", () => {
  const rows = (paths: string[]) => specRows(groupOpenspecFiles(openspecFiles(paths)));

  test("只挑 openspec/specs/，change 底下的 delta spec 不算", () => {
    expect(
      rows([
        "P/openspec/specs/auth/spec.md",
        "P/openspec/changes/add-2fa/specs/auth/spec.md",
        "P/openspec/changes/add-2fa/proposal.md",
        "P/openspec/config.yaml",
      ]),
    ).toEqual([{ rel: "P/openspec/specs/auth/spec.md", label: "auth" }]);
  });

  test("一個 domain 多個檔時標籤補上檔名，兩列才分得開", () => {
    expect(
      rows(["P/openspec/specs/auth/spec.md", "P/openspec/specs/auth/design.md"]).map((r) => r.label),
      // 群組內的排序沿用 ARTIFACT_ORDER（design 先於 spec），這裡只驗標籤分得開
    ).toEqual(["auth/design.md", "auth"]);
  });

  test("沒有 specs/ 就是空清單，不是 throw", () => {
    expect(rows(["P/openspec/changes/add-2fa/proposal.md"])).toEqual([]);
  });
});
