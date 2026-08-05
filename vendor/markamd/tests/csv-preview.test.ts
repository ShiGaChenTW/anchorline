import { expect, test } from "bun:test";
import { parseCsvPreview } from "../src/lib/csv";

test("parses quoted csv cells for preview", () => {
  const preview = parseCsvPreview([
    "name,notes,total",
    '"Ada Lovelace","likes commas, math, and ""quotes""",42',
    '"Grace Hopper","line one',
    'line two",7',
  ].join("\n"));

  expect(preview.headers).toEqual(["name", "notes", "total"]);
  expect(preview.rows).toEqual([
    ["Ada Lovelace", 'likes commas, math, and "quotes"', "42"],
    ["Grace Hopper", "line one\nline two", "7"],
  ]);
  expect(preview.totalRows).toBe(2);
  expect(preview.totalColumns).toBe(3);
});

test("caps large csv previews", () => {
  const source = [
    "a,b,c",
    "1,2,3",
    "4,5,6",
    "7,8,9",
  ].join("\n");
  const preview = parseCsvPreview(source, 2, 2);

  expect(preview.headers).toEqual(["a", "b"]);
  expect(preview.rows).toEqual([
    ["1", "2"],
    ["4", "5"],
  ]);
  expect(preview.truncatedRows).toBe(true);
  expect(preview.truncatedColumns).toBe(true);
});
