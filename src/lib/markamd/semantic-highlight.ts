/**
 * 文件內容語意高亮（只動 preview DOM，不改 textarea）
 * ADHD：soft 僅 risk/todo + focus；medium 再加 metric/done/quote
 */

export type HighlightIntensity = "soft" | "medium";

export type HighlightOpts = {
  enabled: boolean;
  intensity: HighlightIntensity;
  /** 淡化非待決／風險段落 */
  todosOnly?: boolean;
};

const HL_CLASSES = [
  "hl-focus",
  "hl-todo",
  "hl-risk",
  "hl-done",
  "hl-metric",
  "hl-quote",
  "hl-mark",
] as const;

const TODO_RE =
  /待決|待定|待確認|待拍板|未定|TBD|TODO|FIXME|？？|\?\?|開放問題|尚待/i;
const RISK_RE =
  /風險|阻擋|BLOCK|合規|SOC\s*2|資安審查|違規|漏洞|威脅|釣魚|攻擊|缺口|嚴重|阻擋項/i;
const DONE_RE = /已完成|已關閉|已解決|已核准|已簽|✔|✓/;
const METRIC_RE =
  /[≥≤<>]=?\s*\d|\d+\s*%|\d+\s*天|\d+\s*週|\d+\s*人|覆蓋率|完成率|歸零|eng-weeks?/i;

const BLOCK_SEL = "p, li, td, th, blockquote, h1, h2, h3, h4";

function clearHl(el: Element) {
  for (const c of HL_CLASSES) el.classList.remove(c);
  el.removeAttribute("data-hl");
}

function classify(text: string, tag: string, intensity: HighlightIntensity): string | null {
  if (RISK_RE.test(text)) return "hl-risk";
  if (TODO_RE.test(text)) return "hl-todo";
  if (intensity === "soft") return null;
  if (tag === "BLOCKQUOTE") return "hl-quote";
  if (METRIC_RE.test(text)) return "hl-metric";
  if (DONE_RE.test(text)) return "hl-done";
  return null;
}

/** 對 preview 根節點套用語意 class */
export function applySemanticHighlight(root: HTMLElement, opts: HighlightOpts): void {
  root.classList.toggle("mdv-hl-on", opts.enabled);
  root.classList.toggle("mdv-hl-soft", opts.intensity === "soft");
  root.classList.toggle("mdv-hl-medium", opts.intensity === "medium");
  root.classList.toggle("mdv-hl-todos-only", !!opts.todosOnly && opts.enabled);

  root.querySelectorAll(BLOCK_SEL).forEach((el) => {
    if (el.closest("pre, code")) return;
    clearHl(el);
    if (!opts.enabled) return;

    const text = (el.textContent || "").trim();
    if (!text) return;

    const checkbox = el.querySelector<HTMLInputElement>('input[type="checkbox"]');
    let cls: string | null = null;
    if (checkbox?.checked && opts.intensity === "medium") {
      cls = "hl-done";
    } else {
      cls = classify(text, el.tagName, opts.intensity);
    }
    if (cls) {
      el.classList.add(cls);
      el.setAttribute("data-hl", cls);
    }
  });

  // markdown-it-mark → <mark>
  root.querySelectorAll("mark").forEach((m) => {
    if (opts.enabled) m.classList.add("hl-mark");
    else m.classList.remove("hl-mark");
  });
}

/** 目前游標所在行文字 */
export function caretLineText(ta: HTMLTextAreaElement): string {
  const pos = ta.selectionStart ?? 0;
  const val = ta.value;
  const start = val.lastIndexOf("\n", Math.max(0, pos - 1)) + 1;
  let end = val.indexOf("\n", pos);
  if (end < 0) end = val.length;
  return val.slice(start, end);
}

/** 依游標行在 preview 標 hl-focus（不影響語意 class） */
export function applyFocusHighlight(root: HTMLElement, line: string): void {
  root.querySelectorAll(".hl-focus").forEach((el) => el.classList.remove("hl-focus"));
  const trimmed = line.trim();
  if (trimmed.length < 3) return;

  // 去掉 markdown 標記後比對
  const needle = trimmed
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/^>\s+/, "")
    .replace(/\*\*|__/g, "")
    .slice(0, 64);
  if (needle.length < 3) return;

  const blocks = root.querySelectorAll(BLOCK_SEL);
  for (const el of blocks) {
    if (el.closest("pre, code")) continue;
    const t = (el.textContent || "").trim();
    if (!t) continue;
    if (t.includes(needle) || needle.includes(t.slice(0, Math.min(24, t.length)))) {
      el.classList.add("hl-focus");
      // 若在 todos-only 模式，確保 focus 仍可見
      return;
    }
  }
}

/** 行是否語意標記（gutter 圓點） */
export function lineHighlightKind(line: string): "risk" | "todo" | "metric" | null {
  if (RISK_RE.test(line)) return "risk";
  if (TODO_RE.test(line)) return "todo";
  if (METRIC_RE.test(line)) return "metric";
  return null;
}
