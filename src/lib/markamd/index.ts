/**
 * MarkaMD 整合入口
 * 源碼完整副本：vendor/markamd（MIT · mattenarle10/markamd）
 * 編輯台使用精簡適配層：即時 Markdown 預覽雙欄。
 */
export { renderMarkdown, markamdMarkdownIt } from "./markdown";
export { mdFieldHtml, bindMdField, type MdFieldOptions } from "./md-field";
export {
  applySemanticHighlight,
  applyFocusHighlight,
  caretLineText,
  lineHighlightKind,
  type HighlightOpts,
  type HighlightIntensity,
} from "./semantic-highlight";
