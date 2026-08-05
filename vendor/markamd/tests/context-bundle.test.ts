import { expect, test } from "bun:test";
import { formatContextBundle, getContextBundleStats } from "../src/lib/context-bundle";

test("formats staged files as one prompt bundle with relative paths", () => {
  const bundle = formatContextBundle(
    [
      { path: "/notes/project/brief.md", content: "# Brief\n\nUse this." },
      { path: "/notes/project/tasks/today.md", content: "- fix pdf\n- ship tray\n" },
    ],
    "/notes/project",
  );

  expect(bundle).toBe([
    "# context bundle",
    "",
    "Files copied from marka.md for AI context.",
    "",
    "<!-- file: brief.md -->",
    "",
    "# Brief",
    "",
    "Use this.",
    "",
    "<!-- file: tasks/today.md -->",
    "",
    "- fix pdf",
    "- ship tray",
    "",
  ].join("\n"));
});

test("reports staged file and token stats", () => {
  const stats = getContextBundleStats([
    { path: "one.md", content: "one two three four" },
    { path: "two.md", content: "five six seven eight" },
  ]);

  expect(stats.files).toBe(2);
  expect(stats.tokens).toBeGreaterThan(0);
  expect(stats.formattedTokens).toMatch(/\d+/);
});
