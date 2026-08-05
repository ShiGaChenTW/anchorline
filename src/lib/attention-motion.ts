/**
 * 注意力導引動畫（Phase A+B）
 * - 單次 flash / pulse / enter，不做常駐娛樂動效
 * - 尊重 prefers-reduced-motion 與 settings.editor.reduceMotion
 */
import { store } from "../data/store";

const COOLDOWN_MS = 800;
const lastRun = new WeakMap<Element, Map<string, number>>();

export function prefersReducedMotion(): boolean {
  try {
    if (store.get().settings.editor?.reduceMotion === true) return true;
  } catch {
    /* store 可能尚未就緒 */
  }
  if (typeof matchMedia === "function") {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  return false;
}

/** 同步 html 標記，供 CSS 選擇器與除錯 */
export function syncMotionPreferenceClass(): void {
  const reduce = prefersReducedMotion();
  document.documentElement.classList.toggle("reduce-motion", reduce);
  document.documentElement.classList.toggle("attn-motion-on", !reduce);
}

function canRun(el: Element, kind: string): boolean {
  if (prefersReducedMotion()) return false;
  let map = lastRun.get(el);
  if (!map) {
    map = new Map();
    lastRun.set(el, map);
  }
  const now = performance.now();
  const prev = map.get(kind) ?? 0;
  if (now - prev < COOLDOWN_MS) return false;
  map.set(kind, now);
  return true;
}

function runClass(el: Element | null | undefined, cls: string, kind: string): void {
  if (!el || !canRun(el, kind)) return;
  el.classList.remove(cls);
  // reflow 以重播同 class
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
  const onEnd = (e: Event) => {
    if (e.target !== el) return;
    el.classList.remove(cls);
    el.removeEventListener("animationend", onEnd);
  };
  el.addEventListener("animationend", onEnd);
  // 保險：部分瀏覽器 animationend 遺失
  window.setTimeout(() => el.classList.remove(cls), 600);
}

/** 視線錨定：章節 / 段落一次柔光 */
export function flashFocus(el: Element | null | undefined): void {
  runClass(el, "attn-focus-flash", "focus");
}

/** 主 CTA 就緒等狀態轉換：單次 pulse */
export function pulseOnce(el: Element | null | undefined): void {
  runClass(el, "attn-pulse-once", "pulse");
}

/** 區塊入場（focus strip 等） */
export function enter(el: Element | null | undefined): void {
  runClass(el, "attn-enter", "enter");
}

/** 語意高亮新標記：對剛加上 data-hl 的節點 fade-in */
export function markHighlightEnter(root: Element | null | undefined): void {
  if (!root || prefersReducedMotion()) return;
  root.querySelectorAll("[data-hl]").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    // 已播放過則略過（用 dataset 記）
    if (node.dataset.attnHl === "1") return;
    node.dataset.attnHl = "1";
    node.classList.add("attn-hl-enter");
    const onEnd = () => {
      node.classList.remove("attn-hl-enter");
      node.removeEventListener("animationend", onEnd);
    };
    node.addEventListener("animationend", onEnd);
    window.setTimeout(() => node.classList.remove("attn-hl-enter"), 400);
  });
}

/** 抽屜 / details 展開時的內容淡入 */
export function expandEnter(el: Element | null | undefined): void {
  runClass(el, "attn-expand-enter", "expand");
}

let gateWasReady: boolean | null = null;

/**
 * Gate / 核准按鈕：從「不可」→「可」時 pulse 一次
 * @returns 是否觸發了 pulse
 */
export function pulseWhenBecameReady(
  btn: HTMLElement | null | undefined,
  isReady: boolean,
): boolean {
  if (!btn) {
    gateWasReady = isReady;
    return false;
  }
  const was = gateWasReady;
  gateWasReady = isReady;
  if (isReady && was === false) {
    pulseOnce(btn);
    return true;
  }
  return false;
}

/** 編輯台送審按鈕用獨立狀態（與審閱核准分開） */
let submitWasReady: boolean | null = null;

export function pulseSubmitWhenBecameReady(
  btn: HTMLElement | null | undefined,
  isReady: boolean,
): boolean {
  if (!btn) {
    submitWasReady = isReady;
    return false;
  }
  const was = submitWasReady;
  submitWasReady = isReady;
  if (isReady && was === false) {
    pulseOnce(btn);
    return true;
  }
  return false;
}
