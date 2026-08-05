import { useEffect, useState } from "react";

type Tip = {
  text: string;
  left: number;
  top: number;
  /** true = positioned below trigger, false = above */
  below: boolean;
};

const SHOW_DELAY_MS = 320;
const HIDE_DELAY_MS = 80;

/**
 * Mount once near the app root. Watches `[data-tooltip]` elements globally
 * and renders a themed hovercard near the hovered trigger. Suppress the
 * native `title` tooltip by using `data-tooltip` instead.
 */
export function TooltipRoot() {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    let showTimer: number | undefined;
    let hideTimer: number | undefined;
    let currentTrigger: HTMLElement | null = null;

    const findTrigger = (el: Element | null): HTMLElement | null => {
      let node = el;
      while (node && node !== document.body) {
        if (node instanceof HTMLElement && node.dataset.tooltip) return node;
        node = node.parentElement;
      }
      return null;
    };

    const compute = (el: HTMLElement): Tip => {
      const rect = el.getBoundingClientRect();
      const text = el.dataset.tooltip ?? "";
      // place below if trigger sits in the top half of the viewport
      const below = rect.top + rect.height / 2 < window.innerHeight / 2;
      const idealLeft = rect.left + rect.width / 2;
      const top = below ? rect.bottom + 6 : rect.top - 6;
      // approximate width (mono nowrap, capped at 280 to match CSS max-width).
      // 6.6 ≈ mono char width at 11px + 16px padding budget.
      const PADDING = 12;
      const approxWidth = Math.min(280, text.length * 6.6 + 16);
      const halfW = approxWidth / 2;
      const left = Math.max(
        PADDING + halfW,
        Math.min(window.innerWidth - PADDING - halfW, idealLeft),
      );
      return { text, left, top, below };
    };

    const scheduleShow = (el: HTMLElement) => {
      if (showTimer != null) window.clearTimeout(showTimer);
      showTimer = window.setTimeout(() => {
        setTip(compute(el));
      }, SHOW_DELAY_MS);
    };

    const scheduleHide = () => {
      if (showTimer != null) window.clearTimeout(showTimer);
      if (hideTimer != null) window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setTip(null), HIDE_DELAY_MS);
    };

    const onOver = (e: MouseEvent) => {
      const target = findTrigger(e.target as Element);
      if (!target) return;
      if (target === currentTrigger) return;
      currentTrigger = target;
      scheduleShow(target);
    };

    const onOut = (e: MouseEvent) => {
      const target = findTrigger(e.target as Element);
      if (!target) return;
      const next = findTrigger((e.relatedTarget as Element) ?? null);
      if (next === target) return;
      if (next === currentTrigger) return;
      currentTrigger = next;
      if (!next) scheduleHide();
      else scheduleShow(next);
    };

    // hide when scrolling, key presses, or window blur — avoid stale positions
    const dismiss = () => {
      currentTrigger = null;
      if (showTimer != null) window.clearTimeout(showTimer);
      setTip(null);
    };

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    document.addEventListener("scroll", dismiss, true);
    document.addEventListener("keydown", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("scroll", dismiss, true);
      document.removeEventListener("keydown", dismiss);
      window.removeEventListener("blur", dismiss);
      if (showTimer != null) window.clearTimeout(showTimer);
      if (hideTimer != null) window.clearTimeout(hideTimer);
    };
  }, []);

  if (!tip) return null;
  return (
    <div
      className={`mdv-tooltip mdv-tooltip--${tip.below ? "below" : "above"}`}
      role="tooltip"
      style={{
        left: tip.left,
        top: tip.top,
      }}
    >
      {tip.text}
    </div>
  );
}
