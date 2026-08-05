/** Minimal ANSI helpers for SpecForge track TUI (no blessed dependency). */

export const ESC = "\x1b";

export function enabled(): boolean {
  if (process.env.NO_COLOR != null && process.env.NO_COLOR !== "") return false;
  return Boolean(process.stdout.isTTY);
}

export const c = {
  reset: enabled() ? `${ESC}[0m` : "",
  bold: enabled() ? `${ESC}[1m` : "",
  dim: enabled() ? `${ESC}[2m` : "",
  inverse: enabled() ? `${ESC}[7m` : "",
  fg: (n: number) => (enabled() ? `${ESC}[38;5;${n}m` : ""),
  bg: (n: number) => (enabled() ? `${ESC}[48;5;${n}m` : ""),
};

// Palette aligned with Warp / SCVB dark
export const pal = {
  text: c.fg(252),
  muted: c.fg(245),
  accent: c.fg(214), // amber
  success: c.fg(114),
  warn: c.fg(221),
  danger: c.fg(203),
  border: c.fg(240),
  title: c.fg(255),
};

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Rough display width (CJK = 2). */
export function dw(s: string): number {
  let w = 0;
  for (const ch of stripAnsi(s)) {
    const code = ch.codePointAt(0) ?? 0;
    w += code > 0xff ? 2 : 1;
  }
  return w;
}

export function pad(s: string, width: number, align: "left" | "right" = "left"): string {
  const cur = dw(s);
  if (cur >= width) {
    // truncate
    let out = "";
    let w = 0;
    for (const ch of stripAnsi(s)) {
      const cw = (ch.codePointAt(0) ?? 0) > 0xff ? 2 : 1;
      if (w + cw > width - 1) break;
      out += ch;
      w += cw;
    }
    return out + "…".padEnd(Math.max(0, width - dw(out + "…")), " ");
  }
  const padN = width - cur;
  return align === "left" ? s + " ".repeat(padN) : " ".repeat(padN) + s;
}

export function enterAlt() {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`${ESC}[?1049h${ESC}[?25l${ESC}[H${ESC}[2J`);
}

export function leaveAlt() {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`${ESC}[?25h${ESC}[?1049l`);
}

export function moveHome() {
  process.stdout.write(`${ESC}[H`);
}

export function clearDown() {
  process.stdout.write(`${ESC}[J`);
}

export function termSize(): { cols: number; rows: number } {
  return {
    cols: process.stdout.columns || 100,
    rows: process.stdout.rows || 30,
  };
}

export function hline(width: number, ch = "─"): string {
  return ch.repeat(Math.max(0, width));
}

export function boxLine(content: string, width: number, border = pal.border): string {
  const inner = width - 2;
  const body = pad(content, Math.max(0, inner));
  return `${border}│${c.reset}${body}${border}│${c.reset}`;
}
