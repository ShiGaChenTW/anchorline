import { useEffect } from "react";

type Options = {
  editorSelector?: string;
  previewSelector?: string;
  /** when this changes, re-bind in case DOM was replaced */
  rebindKey?: unknown;
};

/**
 * Proportional bidirectional scroll sync.
 *
 * Each side's handler is rAF-throttled (max one sync per frame). Echo
 * prevention is counter-based: before a programmatic write to dst, we mark
 * dst's expected-echo counter; the dst listener consumes the counter and
 * skips. no time-based lock -> snappy sync without echo loops.
 */
export function useSyncScroll({
  editorSelector = ".mdv-editor .cm-scroller",
  previewSelector = ".mdv-preview",
  rebindKey,
}: Options = {}): void {
  useEffect(() => {
    let editor: HTMLElement | null = null;
    let preview: HTMLElement | null = null;
    let rafId: number | undefined;
    const echo = { editor: 0, preview: 0 };

    const makeSync = (
      src: HTMLElement,
      dst: HTMLElement,
      srcKey: "editor" | "preview",
      dstKey: "editor" | "preview",
    ) => {
      let pending = false;
      return () => {
        if (echo[srcKey] > 0) {
          echo[srcKey] -= 1;
          return;
        }
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => {
          pending = false;
          const srcRange = src.scrollHeight - src.clientHeight;
          const dstRange = dst.scrollHeight - dst.clientHeight;
          if (srcRange <= 0 || dstRange <= 0) return;
          const ratio = src.scrollTop / srcRange;
          const target = ratio * dstRange;
          // Skip if already close enough, avoiding feedback work for tiny deltas.
          if (Math.abs(dst.scrollTop - target) < 1) return;
          echo[dstKey] += 1;
          dst.scrollTop = target;
        });
      };
    };

    let onEditor: (() => void) | undefined;
    let onPreview: (() => void) | undefined;

    const tryAttach = () => {
      editor = document.querySelector<HTMLElement>(editorSelector);
      preview = document.querySelector<HTMLElement>(previewSelector);
      if (!editor || !preview) {
        rafId = requestAnimationFrame(tryAttach);
        return;
      }
      onEditor = makeSync(editor, preview, "editor", "preview");
      onPreview = makeSync(preview, editor, "preview", "editor");
      editor.addEventListener("scroll", onEditor, { passive: true });
      preview.addEventListener("scroll", onPreview, { passive: true });
    };

    tryAttach();

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      if (editor && onEditor) editor.removeEventListener("scroll", onEditor);
      if (preview && onPreview) preview.removeEventListener("scroll", onPreview);
    };
  }, [editorSelector, previewSelector, rebindKey]);
}
