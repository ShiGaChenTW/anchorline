import { describe, expect, test } from "bun:test";
import {
  extractFilePatch,
  parseNumstat,
  parseUnifiedPatch,
  renderPatch,
  toSplitRows,
} from "../src/lib/patch-view";

const SAMPLE = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const x = 1
-const y = 2
+const y = 3
+const z = 4
 const w = 5
`;

describe("parseNumstat", () => {
  test("reads added/deleted and binary dashes", () => {
    const files = parseNumstat("12\t3\tsrc/a.ts\n-\t-\tpic.png\n");
    expect(files).toEqual([
      { path: "src/a.ts", added: 12, deleted: 3 },
      { path: "pic.png", added: null, deleted: null },
    ]);
  });
});

describe("parseUnifiedPatch", () => {
  test("numbers old/new lines and classifies ops", () => {
    const p = parseUnifiedPatch(SAMPLE);
    expect(p.header[0]).toContain("diff --git");
    const ops = p.lines.map((l) => l.op);
    expect(ops[0]).toBe("hunk");
    expect(ops).toContain("del");
    expect(ops).toContain("add");
    const del = p.lines.find((l) => l.op === "del")!;
    const add = p.lines.filter((l) => l.op === "add");
    expect(del.text).toBe("const y = 2");
    expect(add.map((l) => l.text)).toEqual(["const y = 3", "const z = 4"]);
    expect(del.oldNo).toBe(2);
    expect(add[0]!.newNo).toBe(2);
  });
});

describe("toSplitRows", () => {
  test("pairs a deletion with the following addition", () => {
    const rows = toSplitRows(parseUnifiedPatch(SAMPLE).lines);
    const swapped = rows.find((r) => r.left.op === "del");
    expect(swapped?.left.text).toBe("const y = 2");
    expect(swapped?.right.op).toBe("add");
    expect(swapped?.right.text).toBe("const y = 3");
  });
});

describe("extractFilePatch", () => {
  test("cuts the requested file out of a multi-file patch", () => {
    const multi = `diff --git a/one.ts b/one.ts
--- a/one.ts
+++ b/one.ts
@@ -1 +1 @@
-a
+b
diff --git a/two.ts b/two.ts
--- a/two.ts
+++ b/two.ts
@@ -1 +1 @@
-c
+d
`;
    const cut = extractFilePatch(multi, "two.ts");
    expect(cut).toContain("two.ts");
    expect(cut).not.toContain("one.ts");
  });
});

describe("renderPatch", () => {
  test("unified emits escaped markup and +/− marks", () => {
    const html = renderPatch(SAMPLE, "unified");
    expect(html).toContain("hv-ln--add");
    expect(html).toContain("hv-ln--del");
    expect(html).not.toContain("<script");
    expect(html).toContain("y = 3");
  });

  test("split emits two cells per row", () => {
    const html = renderPatch(SAMPLE, "split");
    expect(html).toContain("hv-body--split");
    expect(html).toContain("hv-cell--del");
    expect(html).toContain("hv-cell--add");
  });

  test("empty patch explains itself", () => {
    expect(renderPatch("", "unified")).toContain("沒有可顯示");
  });
});
