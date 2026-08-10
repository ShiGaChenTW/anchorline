/** Minimal ANSI helpers for Anchorline track TUI (no blessed dependency). */

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

/**
 * 單一 code point 的顯示寬度：0 = 零寬（控制字／組合附加），2 = 全形，1 = 其他。
 *
 * 舊規則是「碼點 > 0xFF 就算 2」。中文碰巧對，但框線 │ ─、圖示 ▶ • ✔ ⚠、
 * spinner 全部被誤判成 2 格，垂直分隔線因此在 31–34 欄之間飄。
 * 症狀是邊框歪掉而不是錯誤訊息，所以很難歸因回這個函式——別再換回近似規則。
 */
function charWidth(cp: number): number {
  if (cp === 0) return 0;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0; // 控制字
  if (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe20 && cp <= 0xfe2f)
  ) {
    return 0; // 組合附加符號
  }
  if (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    cp === 0x2014 || // em dash —— East Asian Ambiguous，macOS 中文終端實測 2 格
    cp === 0x2026 || // ellipsis 同上。Ambiguous 類不能靠通用 wcwidth，只能按目標終端釘死
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2;
  }
  return isEmojiPresentation(cp) ? 2 : 1;
}

/**
 * Emoji_Presentation = Yes 的碼位（預設彩色呈現 → 終端佔 2 格）。
 * 刻意不含 ✔(2714) ✗(2717) ⚠(26A0) ⏸(23F8)——那些是「文字呈現」，1 格，
 * 正是我們拿來當 UI 圖示的那批。把它們算成 2 會再次撞破邊框。
 */
function isEmojiPresentation(cp: number): boolean {
  if (cp >= 0x1f000 && cp <= 0x1faff) return true;
  return (
    cp === 0x231a || cp === 0x231b ||
    (cp >= 0x23e9 && cp <= 0x23ec) || cp === 0x23f0 || cp === 0x23f3 ||
    (cp >= 0x25fd && cp <= 0x25fe) ||
    (cp >= 0x2614 && cp <= 0x2615) ||
    (cp >= 0x2648 && cp <= 0x2653) ||
    cp === 0x267f || cp === 0x2693 || cp === 0x26a1 ||
    (cp >= 0x26aa && cp <= 0x26ab) || (cp >= 0x26bd && cp <= 0x26be) ||
    (cp >= 0x26c4 && cp <= 0x26c5) || cp === 0x26ce || cp === 0x26d4 ||
    cp === 0x26ea || (cp >= 0x26f2 && cp <= 0x26f3) || cp === 0x26f5 ||
    cp === 0x26fa || cp === 0x26fd ||
    cp === 0x2705 || (cp >= 0x270a && cp <= 0x270b) || cp === 0x2728 ||
    cp === 0x274c || cp === 0x274e || (cp >= 0x2753 && cp <= 0x2755) || cp === 0x2757 ||
    (cp >= 0x2795 && cp <= 0x2797) || cp === 0x27b0 || cp === 0x27bf ||
    (cp >= 0x2b1b && cp <= 0x2b1c) || cp === 0x2b50 || cp === 0x2b55
  );
}

/**
 * 切成「顯示格」並標好寬度。變體選擇子改寫前一格：
 * U+FE0F 升為 2、U+FE0E 降為 1——它們自己不佔格。
 */
export function cells(s: string): { ch: string; w: number }[] {
  const out: { ch: string; w: number }[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0xfe0f || cp === 0xfe0e) {
      const prev = out[out.length - 1];
      if (prev) {
        prev.ch += ch;
        prev.w = cp === 0xfe0f ? 2 : 1;
      }
      continue;
    }
    out.push({ ch, w: charWidth(cp) });
  }
  return out;
}

/** 顯示寬度（忽略 ANSI）。截斷／補齊／邊框計算一律走這個，不可有例外。 */
export function dw(s: string): number {
  let w = 0;
  for (const c of cells(stripAnsi(s))) w += c.w;
  return w;
}

/**
 * 契約：回傳值的 dw() 必等於 width。過寬截斷、過窄補空白，兩路都封口。
 *
 * 不能直接對上色字串跑 cells()：ESC 本身零寬，但後面的 `[38;5;Nm` 會被當成
 * 可見文字，裁一半就把控制碼殘片印上畫面並推歪邊框。所以逐段跳過 SGR。
 */
export function pad(s: string, width: number, align: "left" | "right" = "left"): string {
  if (width <= 0) return "";
  const cur = dw(s);
  if (cur === width) return s;
  if (cur < width) {
    const padN = width - cur;
    return align === "left" ? s + " ".repeat(padN) : " ".repeat(padN) + s;
  }

  const ell = "…";
  const ellW = dw(ell);
  const useEll = ellW <= width;
  const budget = useEll ? width - ellW : width;
  let out = "";
  let w = 0;
  let pos = 0;
  let open = false;
  let clipped = false;

  const take = (visible: string) => {
    for (const c of cells(visible)) {
      if (w + c.w > budget) {
        clipped = true;
        return;
      }
      out += c.ch;
      w += c.w;
    }
  };

  for (const m of s.matchAll(/\x1b\[[0-9;]*m/g)) {
    take(s.slice(pos, m.index));
    if (clipped) break;
    out += m[0];
    open = m[0] !== `${ESC}[0m`;
    pos = (m.index ?? pos) + m[0].length;
  }
  if (!clipped) take(s.slice(pos));

  if (useEll) out += ell;
  if (open) out += `${ESC}[0m`;
  // 寬字邊界會整格捨棄，結果可能比 width 窄；不補足右緣就少一格，邊框照樣歪。
  return out + " ".repeat(Math.max(0, width - dw(out)));
}

export function enterAlt() {
  if (!process.stdout.isTTY) return;
  // ?7l 關自動換行：整寬的一列畫到最後一欄會觸發換行與捲動，把整個版面往下推歪。
  process.stdout.write(`${ESC}[?1049h${ESC}[?25l${ESC}[?7l${ESC}[H${ESC}[2J`);
}

export function leaveAlt() {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`${ESC}[?7h${ESC}[?25h${ESC}[?1049l`);
}

/**
 * DEC 同步輸出：終端先把整幀合成完再一次顯示，消除逐列送出造成的撕裂。
 * 不支援的終端會忽略這兩個序列，所以不需要偵測。
 */
export function syncFrame(body: string): string {
  return `${ESC}[?2026h${body}${ESC}[?2026l`;
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
