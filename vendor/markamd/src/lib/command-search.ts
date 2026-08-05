import type { Command } from "./commands";

function clean(value: string): string {
  return value.trim().toLowerCase();
}

function scoreCommand(command: Command, query: string): number {
  const q = clean(query);
  if (!q) return 0;

  const label = clean(command.label);
  const hint = clean(command.hint ?? "");
  const shortcut = clean(command.shortcut ?? "");
  const keywords = (command.keywords ?? []).map(clean);

  if (label === q) return 100;
  if (label.startsWith(q)) return 90;
  if (label.includes(q)) return 75;
  if (keywords.some((keyword) => keyword === q)) return 70;
  if (keywords.some((keyword) => keyword.startsWith(q))) return 62;
  if (keywords.some((keyword) => keyword.includes(q))) return 54;
  if (hint.includes(q)) return 38;
  if (shortcut.includes(q)) return 24;
  return -1;
}

export function filterAndRankCommands(commands: Command[], query: string): Command[] {
  const q = clean(query);
  if (!q) return commands;

  return commands
    .map((command, index) => ({ command, index, score: scoreCommand(command, q) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.command);
}
