/**
 * MarkaMD 風格 Markdown 渲染（改編自 vendor/markamd/src/lib/markdown.ts）
 * MIT © mattenarle10/markamd — 精簡版：markdown-it + task lists + mark，無 Tauri/Shiki。
 */
import MarkdownIt from "markdown-it";
// CommonMark 的 flanking 規則會讓 `**專案：**內容` 這種中文寫法整段變成字面上的
// 星號——收尾 `**` 前面是全形標點、後面是文字時不算 right-flanking，粗體開不了。
// 我們的 UAT／PRD 檔頭幾乎全長這樣，所以閱讀模式看到的是一堆 `**`。
// 這支外掛就是 CommonMark 的 CJK emphasis 擴充，不要用 regex 前處理取代它：
// 前處理分不出程式碼區塊裡的星號。
import cjkFriendly from "markdown-it-cjk-friendly";
// @ts-expect-error no types for mark plugin in some installs
import mark from "markdown-it-mark";
// @ts-expect-error task-lists types optional
import taskLists from "markdown-it-task-lists";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: false,
  highlight: (code, lang) => {
    const language = (lang || "text").replace(/[^\w+-]/g, "") || "text";
    return `<pre class="mdv-code" data-lang="${escapeHtml(language)}"><code>${escapeHtml(code)}</code></pre>`;
  },
});

md.use(cjkFriendly);
md.use(taskLists, { enabled: false, label: true });
md.use(mark);

// 標題 slug（TOC / 錨點）
const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/ /g, "-")
    .replace(/^-|-$/g, "");

md.renderer.rules.heading_open = (tokens, idx, options, _env, self) => {
  const inline = tokens[idx + 1];
  if (inline?.type === "inline") {
    const id = slugify(inline.content);
    if (id) tokens[idx].attrSet("id", id);
  }
  return self.renderToken(tokens, idx, options);
};

/** 同步渲染 Markdown → 安全 HTML */
export function renderMarkdown(src: string): string {
  if (!src.trim()) {
    return `<p class="mdv-empty">（尚無內容 — 左側輸入 Markdown）</p>`;
  }
  try {
    return md.render(src);
  } catch {
    return `<pre class="mdv-error">${escapeHtml(src)}</pre>`;
  }
}

export { md as markamdMarkdownIt };
