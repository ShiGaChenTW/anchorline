/**
 * 可拖曳調整側欄寬度：
 * 1) 左側 App rail（導覽＋專案卡片）
 * 2) 編輯台兩側：章節大綱 / 寫作教練
 */

const RAIL_KEY = "anchorline:layout:rail-w";
const OUTLINE_KEY = "anchorline:layout:outline-w";
const COACH_KEY = "anchorline:layout:coach-w";

const RAIL_MIN = 180;
const RAIL_MAX = 420;
const OUTLINE_MIN = 160;
const OUTLINE_MAX = 420;
const COACH_MIN = 200;
const COACH_MAX = 480;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function readNum(key: string, fallback: number): number {
  try {
    const v = localStorage.getItem(key);
    if (v == null) return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function writeNum(key: string, n: number) {
  try {
    localStorage.setItem(key, String(Math.round(n)));
  } catch {
    /* ignore */
  }
}

function makeHandle(side: "left" | "right", title: string): HTMLElement {
  const h = document.createElement("div");
  h.className = `resize-handle resize-handle--${side}`;
  h.setAttribute("role", "separator");
  h.setAttribute("aria-orientation", "vertical");
  h.setAttribute("aria-label", title);
  h.title = title;
  h.tabIndex = 0;
  return h;
}

function bindDrag(
  handle: HTMLElement,
  opts: {
    getStart: () => number;
    onMove: (w: number) => void;
    onEnd: (w: number) => void;
    /** 向右拖是否增加寬度（左側欄 true；右側欄 false） */
    growRight: boolean;
    min: number;
    max: number;
  },
) {
  let startX = 0;
  let startW = 0;
  let dragging = false;

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const next = clamp(startW + (opts.growRight ? dx : -dx), opts.min, opts.max);
    opts.onMove(next);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    handle.releasePointerCapture(e.pointerId);
    document.body.classList.remove("is-resizing");
    const dx = e.clientX - startX;
    const next = clamp(startW + (opts.growRight ? dx : -dx), opts.min, opts.max);
    opts.onEnd(next);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  };

  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startW = opts.getStart();
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add("is-resizing");
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  });

  // 鍵盤微調
  handle.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 24 : 8;
    let w = opts.getStart();
    if (e.key === "ArrowLeft") {
      w = clamp(w + (opts.growRight ? -step : step), opts.min, opts.max);
    } else if (e.key === "ArrowRight") {
      w = clamp(w + (opts.growRight ? step : -step), opts.min, opts.max);
    } else return;
    e.preventDefault();
    opts.onMove(w);
    opts.onEnd(w);
  });
}

/** 左側 App 導覽欄可調寬 */
export function initRailResize() {
  const shell = document.querySelector(".shell") as HTMLElement | null;
  const rail = document.querySelector(".rail") as HTMLElement | null;
  if (!shell || !rail || shell.querySelector(".resize-handle--rail")) return;

  // 隱藏側欄的窄屏不裝
  if (window.matchMedia("(max-width: 900px)").matches) return;

  const w0 = clamp(readNum(RAIL_KEY, 240), RAIL_MIN, RAIL_MAX);
  document.documentElement.style.setProperty("--rail-w", `${w0}px`);
  shell.style.gridTemplateColumns = `minmax(${RAIL_MIN}px, var(--rail-w)) 6px minmax(0, 1fr)`;

  const handle = makeHandle("left", "拖曳調整導覽欄寬度");
  handle.classList.add("resize-handle--rail");
  // 插在 rail 後面
  rail.insertAdjacentElement("afterend", handle);

  bindDrag(handle, {
    getStart: () =>
      clamp(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--rail-w")) || w0, RAIL_MIN, RAIL_MAX),
    onMove: (w) => {
      document.documentElement.style.setProperty("--rail-w", `${w}px`);
    },
    onEnd: (w) => writeNum(RAIL_KEY, w),
    growRight: true,
    min: RAIL_MIN,
    max: RAIL_MAX,
  });
}

/** 編輯台：大綱（左）與教練（右）可調寬 */
export function initWorkbenchResize() {
  const wb = document.querySelector(".wb") as HTMLElement | null;
  if (!wb || wb.dataset.resizeBound === "1") return;
  const outline = wb.querySelector(".wb-col:not(.editor-pane):not(.coach)") as HTMLElement | null
    ?? wb.querySelector('[data-od-id="outline-col"]') as HTMLElement | null;
  const editor = wb.querySelector(".editor-pane, [data-od-id='editor-col']") as HTMLElement | null;
  const coach = wb.querySelector(".coach, [data-od-id='coach-col']") as HTMLElement | null;
  if (!outline || !editor) return;

  wb.dataset.resizeBound = "1";

  let outlineW = clamp(readNum(OUTLINE_KEY, 240), OUTLINE_MIN, OUTLINE_MAX);
  let coachW = coach ? clamp(readNum(COACH_KEY, 300), COACH_MIN, COACH_MAX) : 0;

  const apply = () => {
    if (coach && getComputedStyle(coach).display !== "none") {
      wb.style.gridTemplateColumns = `${outlineW}px 6px minmax(0, 1fr) 6px ${coachW}px`;
    } else {
      wb.style.gridTemplateColumns = `${outlineW}px 6px minmax(0, 1fr)`;
    }
  };
  apply();

  // 在 outline 後插入 handle
  const hLeft = makeHandle("left", "拖曳調整章節大綱寬度");
  hLeft.classList.add("resize-handle--outline");
  outline.insertAdjacentElement("afterend", hLeft);
  bindDrag(hLeft, {
    getStart: () => outlineW,
    onMove: (w) => {
      outlineW = w;
      apply();
    },
    onEnd: (w) => {
      outlineW = w;
      writeNum(OUTLINE_KEY, w);
      apply();
    },
    growRight: true,
    min: OUTLINE_MIN,
    max: OUTLINE_MAX,
  });

  if (coach) {
    const hRight = makeHandle("right", "拖曳調整寫作教練寬度");
    hRight.classList.add("resize-handle--coach");
    editor.insertAdjacentElement("afterend", hRight);
    // coach 在 handle 後面
    if (hRight.nextElementSibling !== coach) {
      hRight.insertAdjacentElement("afterend", coach);
    }
    bindDrag(hRight, {
      getStart: () => coachW,
      onMove: (w) => {
        coachW = w;
        apply();
      },
      onEnd: (w) => {
        coachW = w;
        writeNum(COACH_KEY, w);
        apply();
      },
      growRight: false,
      min: COACH_MIN,
      max: COACH_MAX,
    });
  }

  // 視窗變窄時重算（教練可能被 CSS 隱藏）
  window.addEventListener("resize", () => apply());
}

/** 在有 .shell / .wb 的頁面自動啟用 */
export function initResizablePanels() {
  initRailResize();
  if (document.querySelector(".wb")) {
    // 等 layout 穩定
    requestAnimationFrame(() => {
      initWorkbenchResize();
      // 收縮按鈕（大綱／教練／導覽）
      import("./panel-collapse")
        .then((m) => m.initPanelCollapse())
        .catch(() => {
          /* ignore */
        });
    });
  } else {
    import("./panel-collapse")
      .then((m) => m.initPanelCollapse())
      .catch(() => {
        /* ignore */
      });
  }
}
