import { describe, expect, test } from "bun:test";
import { itemsFromProbe, type CtxProbe } from "../src/lib/context-menu-items";

function probe(partial: Partial<CtxProbe>): CtxProbe {
  return {
    editable: false,
    hasSelection: false,
    href: null,
    projectId: null,
    commitHash: null,
    filePath: null,
    sectionTitle: null,
    ...partial,
  };
}

describe("itemsFromProbe", () => {
  test("editable field with no selection: paste and select-all, cut/copy disabled", () => {
    const ids = itemsFromProbe(probe({ editable: true, hasSelection: false })).map((i) => i.id);
    expect(ids).toEqual(["cut", "copy", "paste", "select-all"]);
    const cut = itemsFromProbe(probe({ editable: true, hasSelection: false })).find((i) => i.id === "cut");
    expect(cut?.enabled).toBe(false);
  });

  test("editable field with selection enables cut/copy", () => {
    const cut = itemsFromProbe(probe({ editable: true, hasSelection: true })).find((i) => i.id === "cut");
    expect(cut?.enabled).toBe(true);
  });

  test("plain selection only offers copy", () => {
    const items = itemsFromProbe(probe({ hasSelection: true }));
    expect(items.map((i) => i.id)).toEqual(["copy"]);
  });

  test("project card lists jump actions", () => {
    const ids = itemsFromProbe(probe({ projectId: "p1" }))
      .filter((i) => i.kind === "item")
      .map((i) => i.id);
    expect(ids).toEqual([
      "proj-dash",
      "proj-edit",
      "proj-track",
      "proj-hist",
      "proj-uat",
      "proj-rename",
      "proj-close",
    ]);
  });

  test("does not start or end with a separator", () => {
    const items = itemsFromProbe(
      probe({ hasSelection: true, href: "editor.html", commitHash: "abc" }),
    );
    expect(items[0]?.kind).toBe("item");
    expect(items[items.length - 1]?.kind).toBe("item");
  });
});
