import { expect, test } from "bun:test";
import { filterAndRankCommands } from "../src/lib/command-search";
import type { Command } from "../src/lib/commands";

const noop = () => undefined;

function cmd(id: string, label: string, extra: Partial<Command> = {}): Command {
  return { id, label, action: noop, ...extra };
}

test("ranks exact and prefix label matches ahead of keyword matches", () => {
  const results = filterAndRankCommands([
    cmd("context", "copy context bundle", { keywords: ["prompt", "tokens"] }),
    cmd("theme", "theme: codex", { keywords: ["palette", "appearance"] }),
    cmd("copy", "copy markdown to clipboard", { keywords: ["chat"] }),
  ], "copy");

  expect(results.map((item) => item.id)).toEqual(["context", "copy"]);
});

test("finds commands by aliases and hints", () => {
  const results = filterAndRankCommands([
    cmd("export", "export to pdf", { keywords: ["print", "document"] }),
    cmd("tutorial", "show quickstart tutorial", { hint: "replay onboarding" }),
    cmd("theme", "theme: latte", { keywords: ["palette"] }),
  ], "palette");

  expect(results.map((item) => item.id)).toEqual(["theme"]);
});

test("keeps original order for an empty query", () => {
  const commands = [
    cmd("open", "open file"),
    cmd("save", "save"),
    cmd("help", "show help"),
  ];

  expect(filterAndRankCommands(commands, "")).toBe(commands);
});
