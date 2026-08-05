/**
 * MarkaMD 風格雙欄：寫作 | 即時預覽
 * + 行號 gutter（與文字間距 5px）
 * + Markdown 工具列
 * + 預覽語意高亮（不改 textarea 內文）
 */
import { store } from "../../data/store";
import { renderMarkdown } from "./markdown";
import {
  applyFocusHighlight,
  applySemanticHighlight,
  caretLineText,
  lineHighlightKind,
  type HighlightOpts,
} from "./semantic-highlight";
import { markHighlightEnter } from "../attention-motion";

export type MdFieldOptions = {
  key: string;
  label: string;
  hint?: string;
  value: string;
  rows?: number;
  readOnly?: boolean;
};

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type ToolbarCmd =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "codeblock"
  | "h2"
  | "h3"
  | "ul"
  | "ol"
  | "task"
  | "quote"
  | "link"
  | "hr"
  | "table";

const TOOLS: { cmd: ToolbarCmd; label: string; title: string }[] = [
  { cmd: "bold", label: "B", title: "粗體 ** **（⌘B）" },
  { cmd: "italic", label: "I", title: "斜體 * *（⌘I）" },
  { cmd: "strike", label: "S", title: "刪除線 ~~ ~~" },
  { cmd: "code", label: "</>", title: "行內程式碼 ` `" },
  { cmd: "codeblock", label: "{ }", title: "程式碼區塊 ```" },
  { cmd: "h2", label: "H2", title: "二級標題" },
  { cmd: "h3", label: "H3", title: "三級標題" },
  { cmd: "ul", label: "• 列表", title: "無序清單" },
  { cmd: "ol", label: "1. 列表", title: "有序清單" },
  { cmd: "task", label: "☑", title: "待辦清單" },
  { cmd: "quote", label: "❝", title: "引用" },
  { cmd: "link", label: "🔗", title: "連結（⌘K）" },
  { cmd: "hr", label: "—", title: "分隔線" },
  { cmd: "table", label: "表格", title: "插入表格" },
];

function toolbarHtml(readOnly: boolean): string {
  if (readOnly) return "";
  return `<div class="mdv-toolbar" role="toolbar" aria-label="Markdown 工具">
    ${TOOLS.map(
      (t) =>
        `<button type="button" class="mdv-tool" data-mdv-cmd="${t.cmd}" title="${escapeAttr(t.title)}">${escapeAttr(t.label)}</button>`,
    ).join("")}
  </div>`;
}

/** 產生雙欄 Markdown 欄位 HTML */
export function mdFieldHtml(opts: MdFieldOptions): string {
  const rows = opts.rows ?? 8;
  const ro = opts.readOnly ? "readonly disabled" : "";
  const ed = store.get().settings.editor ?? {
    showLineNumbers: true,
    showToolbar: true,
    defaultMode: "split" as const,
    semanticHighlight: true,
    highlightIntensity: "soft" as const,
  };
  const mode = ed.defaultMode || "split";
  const showLn = ed.showLineNumbers !== false;
  const showTb = ed.showToolbar !== false && !opts.readOnly;
  const hlOn = ed.semanticHighlight !== false;

  return `
  <div class="field mdv-field" data-od-id="field-${escapeAttr(opts.key)}" data-mdv-key="${escapeAttr(opts.key)}" data-show-ln="${showLn ? "1" : "0"}">
    <div class="mdv-field-head">
      <label>${escapeAttr(opts.label)}${opts.hint ? `<span>${escapeAttr(opts.hint)}</span>` : ""}</label>
      <div class="mdv-mode" role="group" aria-label="編輯模式">
        <button type="button" class="mdv-mode-btn${mode === "split" ? " on" : ""}" data-mdv-mode="split" title="寫作 + 預覽">雙欄</button>
        <button type="button" class="mdv-mode-btn${mode === "write" ? " on" : ""}" data-mdv-mode="write" title="只寫作">寫作</button>
        <button type="button" class="mdv-mode-btn${mode === "preview" ? " on" : ""}" data-mdv-mode="preview" title="只預覽">預覽</button>
      </div>
    </div>
    ${showTb ? toolbarHtml(!!opts.readOnly) : ""}
    <div class="mdv-pane mdv-pane--${mode}" data-mdv-pane>
      <div class="mdv-write">
        <div class="mdv-write-inner${showLn ? " has-gutter" : ""}">
          <div class="mdv-gutter" data-mdv-gutter aria-hidden="true"${showLn ? "" : " hidden"}>1</div>
          <textarea data-key="${escapeAttr(opts.key)}" rows="${rows}" ${ro} spellcheck="true" placeholder="支援 Markdown（# 標題、- 列表、**粗體**…）">${escapeAttr(opts.value)}</textarea>
        </div>
      </div>
      <div class="mdv-split" aria-hidden="true"></div>
      <div class="mdv-preview-wrap">
        <div class="mdv-preview-label">
          <span>預覽 · 語意高亮</span>
          <span class="mdv-hl-controls" role="group" aria-label="高亮">
            <label class="mdv-hl-check" title="待決／風險等色塊（僅預覽）">
              <input type="checkbox" data-mdv-hl ${hlOn ? "checked" : ""} />
              高亮
            </label>
            <button type="button" class="mdv-hl-todos" data-mdv-hl-todos aria-pressed="false" title="淡化非待決／風險段落">只看待決</button>
          </span>
        </div>
        <article class="mdv-prose mdv-preview" data-mdv-preview></article>
      </div>
    </div>
  </div>`;
}

function updateGutter(gutter: HTMLElement, text: string, showDots: boolean) {
  const lines = text.length ? text.split("\n") : [""];
  let html = "";
  for (let i = 0; i < lines.length; i++) {
    const kind = showDots ? lineHighlightKind(lines[i]!) : null;
    const dot = kind ? `<i class="mdv-gutter-dot mdv-gutter-dot--${kind}" title="${kind}"></i>` : "";
    html += `<span class="mdv-gutter-line">${i + 1}${dot}</span>`;
  }
  gutter.innerHTML = html;
}

function readHighlightOpts(field: HTMLElement): HighlightOpts {
  const ed = store.get().settings.editor;
  const toggle = field.querySelector<HTMLInputElement>("[data-mdv-hl]");
  const todosBtn = field.querySelector<HTMLButtonElement>("[data-mdv-hl-todos]");
  const enabled = toggle ? toggle.checked : ed?.semanticHighlight !== false;
  const todosOnly = todosBtn?.getAttribute("aria-pressed") === "true";
  return {
    enabled,
    intensity: ed?.highlightIntensity === "medium" ? "medium" : "soft",
    todosOnly,
  };
}

function insertAround(
  ta: HTMLTextAreaElement,
  before: string,
  after: string,
  placeholder = "文字",
): void {
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const val = ta.value;
  const selected = val.slice(start, end);
  const body = selected || placeholder;
  const next = val.slice(0, start) + before + body + after + val.slice(end);
  ta.value = next;
  const selStart = start + before.length;
  const selEnd = selStart + body.length;
  ta.focus();
  ta.setSelectionRange(selected ? selStart : selStart, selected ? selEnd : selStart + body.length);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

function prefixLines(ta: HTMLTextAreaElement, prefix: string): void {
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const val = ta.value;
  const lineStart = val.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  let lineEnd = val.indexOf("\n", end);
  if (lineEnd < 0) lineEnd = val.length;
  const block = val.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const numbered = prefix === "1. ";
  const nextBlock = lines
    .map((ln, i) => {
      const p = numbered ? `${i + 1}. ` : prefix;
      if (!ln.trim()) return ln;
      if (ln.startsWith(p)) return ln;
      return p + ln;
    })
    .join("\n");
  ta.value = val.slice(0, lineStart) + nextBlock + val.slice(lineEnd);
  ta.focus();
  ta.setSelectionRange(lineStart, lineStart + nextBlock.length);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

function runCmd(ta: HTMLTextAreaElement, cmd: ToolbarCmd): void {
  switch (cmd) {
    case "bold":
      insertAround(ta, "**", "**", "粗體");
      break;
    case "italic":
      insertAround(ta, "*", "*", "斜體");
      break;
    case "strike":
      insertAround(ta, "~~", "~~", "刪除");
      break;
    case "code":
      insertAround(ta, "`", "`", "code");
      break;
    case "codeblock":
      insertAround(ta, "```\n", "\n```", "code");
      break;
    case "h2":
      prefixLines(ta, "## ");
      break;
    case "h3":
      prefixLines(ta, "### ");
      break;
    case "ul":
      prefixLines(ta, "- ");
      break;
    case "ol":
      prefixLines(ta, "1. ");
      break;
    case "task":
      prefixLines(ta, "- [ ] ");
      break;
    case "quote":
      prefixLines(ta, "> ");
      break;
    case "link": {
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const selected = ta.value.slice(start, end) || "連結文字";
      insertAround(ta, "[", "](https://)", selected === "連結文字" ? "連結文字" : selected);
      break;
    }
    case "hr": {
      const start = ta.selectionStart;
      const val = ta.value;
      const insert = (start > 0 && val[start - 1] !== "\n" ? "\n" : "") + "---\n";
      ta.value = val.slice(0, start) + insert + val.slice(ta.selectionEnd);
      const pos = start + insert.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      break;
    }
    case "table": {
      const table = "| 欄位 | 說明 |\n| --- | --- |\n|  |  |\n";
      const start = ta.selectionStart;
      const val = ta.value;
      ta.value = val.slice(0, start) + table + val.slice(ta.selectionEnd);
      ta.focus();
      ta.setSelectionRange(start + table.length, start + table.length);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      break;
    }
  }
}

/** 綁定單欄：即時預覽 + 行號 + 工具列；回傳 cleanup */
export function bindMdField(
  root: HTMLElement,
  onInput?: (key: string, value: string) => void,
): () => void {
  const cleanups: Array<() => void> = [];
  const ed = store.get().settings.editor;

  root.querySelectorAll<HTMLElement>(".mdv-field").forEach((field) => {
    const ta = field.querySelector<HTMLTextAreaElement>("textarea[data-key]");
    const preview = field.querySelector<HTMLElement>("[data-mdv-preview]");
    const pane = field.querySelector<HTMLElement>("[data-mdv-pane]");
    const gutter = field.querySelector<HTMLElement>("[data-mdv-gutter]");
    const writeInner = field.querySelector<HTMLElement>(".mdv-write-inner");
    if (!ta || !preview || !pane) return;

    const showLn = field.dataset.showLn === "1" && ed?.showLineNumbers !== false;

    let lastHlSig = "";
    let hlEnterTimer: ReturnType<typeof setTimeout> | null = null;
    const hlSignature = () => {
      const counts: Record<string, number> = {};
      preview.querySelectorAll("[data-hl]").forEach((node) => {
        const k = node.getAttribute("data-hl") || "";
        counts[k] = (counts[k] || 0) + 1;
      });
      return Object.keys(counts)
        .sort()
        .map((k) => `${k}:${counts[k]}`)
        .join("|");
    };

    const refreshPreview = () => {
      preview.innerHTML = renderMarkdown(ta.value);
      const opts = readHighlightOpts(field);
      applySemanticHighlight(preview, opts);
      if (opts.enabled) {
        applyFocusHighlight(preview, caretLineText(ta));
        // 僅在語意標記集合變化時入場（避免每鍵重播）
        const sig = hlSignature();
        if (sig !== lastHlSig) {
          lastHlSig = sig;
          if (hlEnterTimer) clearTimeout(hlEnterTimer);
          hlEnterTimer = setTimeout(() => markHighlightEnter(preview), 260);
        }
      } else {
        lastHlSig = "";
      }
    };
    const refreshGutter = () => {
      if (gutter && showLn) {
        const opts = readHighlightOpts(field);
        updateGutter(gutter, ta.value, opts.enabled);
      }
    };
    const refreshFocus = () => {
      if (!readHighlightOpts(field).enabled) return;
      applyFocusHighlight(preview, caretLineText(ta));
    };
    refreshPreview();
    refreshGutter();

    const syncScroll = () => {
      if (gutter && showLn) gutter.scrollTop = ta.scrollTop;
    };

    const onTa = () => {
      refreshPreview();
      refreshGutter();
      const key = ta.dataset.key;
      if (key && onInput) onInput(key, ta.value);
    };
    ta.addEventListener("input", onTa);
    ta.addEventListener("scroll", syncScroll);
    ta.addEventListener("keyup", refreshFocus);
    ta.addEventListener("click", refreshFocus);
    ta.addEventListener("select", refreshFocus);
    cleanups.push(() => {
      ta.removeEventListener("input", onTa);
      ta.removeEventListener("scroll", syncScroll);
      ta.removeEventListener("keyup", refreshFocus);
      ta.removeEventListener("click", refreshFocus);
      ta.removeEventListener("select", refreshFocus);
    });

    const hlToggle = field.querySelector<HTMLInputElement>("[data-mdv-hl]");
    if (hlToggle) {
      const onHl = () => {
        // 寫回設定（本機偏好）
        const cur = store.get().settings.editor;
        store.updateSettings({
          editor: {
            ...cur,
            semanticHighlight: hlToggle.checked,
          },
        });
        refreshPreview();
        refreshGutter();
      };
      hlToggle.addEventListener("change", onHl);
      cleanups.push(() => hlToggle.removeEventListener("change", onHl));
    }

    const todosBtn = field.querySelector<HTMLButtonElement>("[data-mdv-hl-todos]");
    if (todosBtn) {
      const onTodos = () => {
        const next = todosBtn.getAttribute("aria-pressed") !== "true";
        todosBtn.setAttribute("aria-pressed", next ? "true" : "false");
        todosBtn.classList.toggle("on", next);
        refreshPreview();
      };
      todosBtn.addEventListener("click", onTodos);
      cleanups.push(() => todosBtn.removeEventListener("click", onTodos));
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (ta.readOnly || ta.disabled) return;
      const meta = e.metaKey || e.ctrlKey;
      if (e.key === "Tab") {
        e.preventDefault();
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const val = ta.value;
        if (e.shiftKey) {
          const ls = val.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
          let le = val.indexOf("\n", end);
          if (le < 0) le = val.length;
          const block = val.slice(ls, le);
          const next = block
            .split("\n")
            .map((ln) =>
              ln.startsWith("  ") ? ln.slice(2) : ln.startsWith("\t") ? ln.slice(1) : ln,
            )
            .join("\n");
          ta.value = val.slice(0, ls) + next + val.slice(le);
          ta.setSelectionRange(ls, ls + next.length);
        } else {
          ta.value = val.slice(0, start) + "  " + val.slice(end);
          ta.setSelectionRange(start + 2, start + 2);
        }
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      if (meta && e.key.toLowerCase() === "b") {
        e.preventDefault();
        runCmd(ta, "bold");
      } else if (meta && e.key.toLowerCase() === "i") {
        e.preventDefault();
        runCmd(ta, "italic");
      } else if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        runCmd(ta, "link");
      }
    };
    ta.addEventListener("keydown", onKeyDown);
    cleanups.push(() => ta.removeEventListener("keydown", onKeyDown));

    field.querySelectorAll<HTMLButtonElement>("[data-mdv-mode]").forEach((btn) => {
      const handler = () => {
        const mode = btn.dataset.mdvMode || "split";
        field.querySelectorAll(".mdv-mode-btn").forEach((b) => b.classList.remove("on"));
        btn.classList.add("on");
        pane.classList.remove("mdv-pane--split", "mdv-pane--write", "mdv-pane--preview");
        pane.classList.add(`mdv-pane--${mode}`);
      };
      btn.addEventListener("click", handler);
      cleanups.push(() => btn.removeEventListener("click", handler));
    });

    field.querySelectorAll<HTMLButtonElement>("[data-mdv-cmd]").forEach((btn) => {
      const handler = () => {
        if (ta.readOnly || ta.disabled) return;
        const cmd = btn.dataset.mdvCmd as ToolbarCmd;
        if (cmd) runCmd(ta, cmd);
      };
      btn.addEventListener("click", handler);
      cleanups.push(() => btn.removeEventListener("click", handler));
    });

    if (!showLn && writeInner) {
      writeInner.classList.remove("has-gutter");
      gutter?.setAttribute("hidden", "");
    }
  });

  return () => cleanups.forEach((fn) => fn());
}
