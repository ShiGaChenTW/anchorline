/**
 * 所有側欄統一收縮／展開按鈕
 * - App 左側導覽 rail
 * - 編輯台章節大綱
 * - 編輯台寫作教練
 */

const KEYS = {
  rail: "anchorline:collapse:rail",
  outline: "anchorline:collapse:outline",
  coach: "anchorline:collapse:coach",
  tkRail: "anchorline:collapse:tk-rail",
  tkSide: "anchorline:collapse:tk-side",
} as const;

function readCollapsed(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function chevron(dir: "left" | "right"): string {
  // left = 收起往左（面板在左側時）；right = 收起往右
  if (dir === "left") {
    return `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0z"/></svg>`;
  }
  return `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06z"/></svg>`;
}

function makeToggle(opts: {
  id: string;
  labelCollapse: string;
  labelExpand: string;
  side: "left" | "right";
}): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "panel-collapse-btn";
  btn.id = opts.id;
  btn.dataset.side = opts.side;
  btn.setAttribute("aria-expanded", "true");
  btn.title = opts.labelCollapse;
  btn.innerHTML = chevron(opts.side === "left" ? "left" : "right");
  return btn;
}

function makeExpandRail(side: "left" | "right", title: string, id: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `panel-expand-strip panel-expand-strip--${side}`;
  btn.id = id;
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.innerHTML = `${chevron(side === "left" ? "right" : "left")}<span class="panel-expand-label">${title}</span>`;
  return btn;
}

/** 左側 App 導覽欄 */
function initRailCollapse() {
  const shell = document.querySelector(".shell") as HTMLElement | null;
  const rail = document.querySelector(".rail") as HTMLElement | null;
  if (!shell || !rail || rail.dataset.collapseReady === "1") return;
  if (window.matchMedia("(max-width: 900px)").matches) return;

  rail.dataset.collapseReady = "1";

  const brand = rail.querySelector(".rail-brand");
  const toggle = makeToggle({
    id: "btn-collapse-rail",
    labelCollapse: "收縮導覽欄",
    labelExpand: "展開導覽欄",
    side: "left",
  });
  toggle.classList.add("panel-collapse-btn--rail");

  if (brand) {
    brand.classList.add("panel-head-with-toggle");
    brand.appendChild(toggle);
  } else {
    rail.prepend(toggle);
  }

  let expandStrip = document.getElementById("btn-expand-rail") as HTMLButtonElement | null;
  if (!expandStrip) {
    expandStrip = makeExpandRail("left", "導覽", "btn-expand-rail");
    shell.insertBefore(expandStrip, rail);
  }

  const apply = (collapsed: boolean) => {
    shell.classList.toggle("rail-collapsed", collapsed);
    rail.setAttribute("aria-hidden", collapsed ? "true" : "false");
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    toggle.title = collapsed ? "展開導覽欄" : "收縮導覽欄";
    toggle.innerHTML = chevron(collapsed ? "right" : "left");
    expandStrip!.hidden = !collapsed;
    // 隱藏 resize handle
    const handle = shell.querySelector(".resize-handle--rail") as HTMLElement | null;
    if (handle) handle.style.display = collapsed ? "none" : "";
    writeCollapsed(KEYS.rail, collapsed);
  };

  toggle.addEventListener("click", () => apply(true));
  expandStrip.addEventListener("click", () => apply(false));
  apply(readCollapsed(KEYS.rail));
}

/** 編輯台側欄（大綱 / 教練） */
function initWbColCollapse(
  colSel: string,
  key: keyof typeof KEYS,
  expandId: string,
  expandLabel: string,
  side: "left" | "right",
  collapseClass: string,
) {
  const wb = document.querySelector(".wb") as HTMLElement | null;
  const col = document.querySelector(colSel) as HTMLElement | null;
  if (!wb || !col || col.dataset.collapseReady === "1") return;

  col.dataset.collapseReady = "1";
  const head = col.querySelector(".wb-head");
  if (!head) return;

  head.classList.add("panel-head-with-toggle");
  const toggle = makeToggle({
    id: `btn-collapse-${key}`,
    labelCollapse: `收縮${expandLabel}`,
    labelExpand: `展開${expandLabel}`,
    side,
  });
  head.appendChild(toggle);

  let strip = document.getElementById(expandId) as HTMLButtonElement | null;
  if (!strip) {
    strip = makeExpandRail(side, expandLabel, expandId);
    strip.classList.add("panel-expand-strip--wb");
    if (side === "left") {
      wb.insertBefore(strip, col);
    } else {
      // after coach col
      col.insertAdjacentElement("afterend", strip);
    }
  }

  const apply = (collapsed: boolean) => {
    wb.classList.toggle(collapseClass, collapsed);
    col.setAttribute("aria-hidden", collapsed ? "true" : "false");
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    toggle.title = collapsed ? `展開${expandLabel}` : `收縮${expandLabel}`;
    toggle.innerHTML = chevron(
      collapsed ? (side === "left" ? "right" : "left") : side === "left" ? "left" : "right",
    );
    strip!.hidden = !collapsed;

    // hide matching resize handle
    if (key === "outline") {
      const h = wb.querySelector(".resize-handle--outline") as HTMLElement | null;
      if (h) h.style.display = collapsed ? "none" : "";
    }
    if (key === "coach") {
      const h = wb.querySelector(".resize-handle--coach") as HTMLElement | null;
      if (h) h.style.display = collapsed ? "none" : "";
    }

    // re-apply grid via resize module if present
    window.dispatchEvent(new CustomEvent("anchorline:panel-collapse", { detail: { key, collapsed } }));
    writeCollapsed(KEYS[key], collapsed);
  };

  toggle.addEventListener("click", () => apply(true));
  strip.addEventListener("click", () => apply(false));
  apply(readCollapsed(KEYS[key]));
}

/**
 * Task Tracking 的左右兩欄（計劃／結構檢查）。
 *
 * 刻意不跟 initWbColCollapse 併成一支：那支綁著 .wb 的 resize handle 與
 * grid 重算事件，tracking 這邊兩者都沒有。硬要共用就得加一堆 if，
 * 而編輯台那條路現在是好的 —— 不值得為了少 30 行去動它。
 *
 * 收起來靠 CSS class 換 grid-template-columns（見 tracking.html）；
 * 這裡不算 grid 寬度，因為 .tk-shell 的三欄是固定值，算了也只是重寫一次。
 */
function initTkColCollapse(
  colSel: string,
  key: "tkRail" | "tkSide",
  expandId: string,
  label: string,
  side: "left" | "right",
  collapseClass: string,
) {
  const shell = document.querySelector(".tk-shell") as HTMLElement | null;
  const col = document.querySelector(colSel) as HTMLElement | null;
  if (!shell || !col || col.dataset.collapseReady === "1") return;

  const head = col.querySelector(".tk-hd");
  if (!head) return;
  col.dataset.collapseReady = "1";

  head.classList.add("panel-head-with-toggle");
  const toggle = makeToggle({
    id: `btn-collapse-${expandId}`,
    labelCollapse: `收縮${label}`,
    labelExpand: `展開${label}`,
    side,
  });
  head.appendChild(toggle);

  // 窄條要落在原本那一欄的格線位置上，不能多出第四個 grid item——
  // 所以收起時那一欄是 display:none，不是被搬走。
  let strip = document.getElementById(expandId) as HTMLButtonElement | null;
  if (!strip) {
    strip = makeExpandRail(side, label, expandId);
    if (side === "left") shell.insertBefore(strip, col);
    else col.insertAdjacentElement("afterend", strip);
  }

  const apply = (collapsed: boolean) => {
    shell.classList.toggle(collapseClass, collapsed);
    col.setAttribute("aria-hidden", collapsed ? "true" : "false");
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    strip!.hidden = !collapsed;
    writeCollapsed(KEYS[key], collapsed);
  };

  toggle.addEventListener("click", () => apply(true));
  strip.addEventListener("click", () => apply(false));
  apply(readCollapsed(KEYS[key]));
}

function reflowWorkbench() {
  const wb = document.querySelector(".wb") as HTMLElement | null;
  if (!wb) return;
  const outlineCollapsed = wb.classList.contains("outline-collapsed");
  const coachCollapsed = wb.classList.contains("coach-collapsed");
  const coach = wb.querySelector(".coach, [data-od-id='coach-col']") as HTMLElement | null;
  const coachVisible = coach && getComputedStyle(coach).display !== "none" && !coachCollapsed;

  // 讀取目前寬度變數或預設
  const outlineW = outlineCollapsed
    ? 0
    : Math.max(160, parseInt(localStorage.getItem("anchorline:layout:outline-w") || "240", 10) || 240);
  const coachW = !coachVisible
    ? 0
    : Math.max(200, parseInt(localStorage.getItem("anchorline:layout:coach-w") || "300", 10) || 300);

  const parts: string[] = [];
  if (!outlineCollapsed) {
    parts.push(`${outlineW}px`, "6px");
  } else {
    parts.push("36px"); // expand strip
  }
  parts.push("minmax(0, 1fr)");
  if (coachVisible) {
    parts.push("6px", `${coachW}px`);
  } else if (coach && coachCollapsed && window.matchMedia("(min-width: 1101px)").matches) {
    parts.push("36px");
  }
  wb.style.gridTemplateColumns = parts.join(" ");
}

export function initPanelCollapse() {
  initRailCollapse();
  initWbColCollapse(
    '[data-od-id="outline-col"]',
    "outline",
    "btn-expand-outline",
    "大綱",
    "left",
    "outline-collapsed",
  );
  initWbColCollapse(
    '[data-od-id="coach-col"]',
    "coach",
    "btn-expand-coach",
    "教練",
    "right",
    "coach-collapsed",
  );

  initTkColCollapse(".tk-rail", "tkRail", "btn-expand-tk-rail", "計劃", "left", "tk-rail-collapsed");
  const onUatPage = /(?:^|\/)uat\.html(?:[?#]|$)/.test(location.pathname + location.href);
  if (!onUatPage) {
    initTkColCollapse(
      ".tk-side",
      "tkSide",
      "btn-expand-tk-side",
      "結構檢查",
      "right",
      "tk-side-collapsed",
    );
  }

  window.addEventListener("anchorline:panel-collapse", () => reflowWorkbench());
  reflowWorkbench();
  window.addEventListener("resize", () => reflowWorkbench());
}
