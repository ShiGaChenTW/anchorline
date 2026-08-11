/**
 * 側邊欄專案卡片：自訂名稱／資料夾名 + 最後更新時間。
 * 側邊欄「目前工作區」上下文（取代 titlebar 長專案名）。
 */
import { store } from "../data/store";
import { projectDisplayName, type Project } from "../data/types";
import { IC } from "./rail-nav";
import { formatLastUpdate } from "./time-format";
import { escapeHtml, toast } from "./ui";

export type RailContextOpts = {
  /** 例如：審閱 / 編輯 / 專案 */
  mode: string;
  projectName?: string;
  statusLabel?: string;
  statusTone?: "draft" | "review" | "ok" | "warn";
  meta?: string;
};

/**
 * 把「目前頁面 · 專案名」放到左側欄（不再塞 titlebar）
 */
/**
 * 「目前」這張卡固定存在。
 *
 * 之前只有 editor / overview / dashboard / review 四頁會呼叫 syncRailContext，
 * 其餘七頁（專案清單、Task Tracking、章節範本、偏好設定、Agent、管理、版本取號）
 * 根本不會建立這張卡 —— 所以它在某些頁面「消失」不是被隱藏，是從來沒生成過。
 * 改成側欄一初始化就先把骨架放好，四頁再各自填細節。
 */
function ensureContextCard(): HTMLElement | null {
  const rail = document.querySelector(".rail");
  if (!rail) return null;
  let el = document.getElementById("rail-context");
  if (el) return el;
  el = document.createElement("div");
  el.id = "rail-context";
  el.className = "rail-context";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.setAttribute("aria-label", "目前工作區");
  el.innerHTML = `
    <div class="rail-context-kicker">目前</div>
    <div class="rail-context-mode"></div>
    <div class="rail-context-project"></div>
    <div class="rail-context-status rail-context-status--draft" hidden></div>
    <div class="rail-context-meta" hidden></div>
  `;
  const brand = rail.querySelector(".rail-brand");
  if (brand) brand.insertAdjacentElement("afterend", el);
  else rail.prepend(el);
  return el;
}

function setText(root: HTMLElement, sel: string, text: string) {
  const n = root.querySelector(sel);
  if (n && n.textContent !== text) n.textContent = text;
}

/**
 * 沒有呼叫 syncRailContext 的頁面也要有這張卡。
 * 從目前頁面與 active 專案推一組合理的預設值。
 */
export function ensureRailContextDefaults(pageLabel: string) {
  if (document.getElementById("rail-context")?.querySelector(".rail-context-mode")?.textContent) {
    return; // 已經有頁面填過細節就不要覆蓋
  }
  const st = store.get();
  const cur = st.projects.find((p) => p.id === st.activeProjectId);
  syncRailContext({
    mode: pageLabel,
    projectName: cur ? projectDisplayName(cur) : "未選擇專案",
    statusLabel: cur ? statusLabel(cur) : "",
    statusTone: cur ? statusTone(cur) : "draft",
  });
}

export function syncRailContext(opts: RailContextOpts) {
  const el = ensureContextCard();
  if (!el) return;

  const name = (opts.projectName ?? "").trim() || "未選擇專案";
  const tone = opts.statusTone ?? "draft";
  const status = (opts.statusLabel ?? "").trim();
  const meta = (opts.meta ?? "").trim();

  // 逐欄位更新，不重建 innerHTML。
  // 這張卡每次 store emit 都會被同步一次；整塊重畫的代價是每次都閃一下，
  // 而且會把使用者選取的文字、hover 狀態一併清掉。
  setText(el, ".rail-context-mode", opts.mode);
  const proj = el.querySelector(".rail-context-project") as HTMLElement | null;
  if (proj && proj.textContent !== name) {
    proj.textContent = name;
    proj.title = name;
  }

  const st = el.querySelector(".rail-context-status") as HTMLElement | null;
  if (st) {
    st.hidden = !status;
    if (status && st.textContent !== status) st.textContent = status;
    st.className = `rail-context-status rail-context-status--${tone}`;
    st.hidden = !status;
  }
  const mt = el.querySelector(".rail-context-meta") as HTMLElement | null;
  if (mt) {
    mt.hidden = !meta;
    if (meta && mt.textContent !== meta) mt.textContent = meta;
  }

  // 側欄品牌名固定（titlebar 已移除）
  document.querySelectorAll(".rail-brand strong, .rail-brand-text strong").forEach((n) => {
    n.textContent = "Anchorline";
  });
}

/**
 * 側欄兩個區塊（工作區 / 專案）的收合。
 *
 * 狀態掛在 <html> 的 class，不是節點自己 —— initRailNav 每次進頁都會整段重建
 * nav.innerHTML，狀態放在節點上等於每次換頁都歸零。
 */
const SECTION_KEYS = {
  ws: "anchorline:collapse:ws",
  projects: "anchorline:collapse:projects",
} as const;

type SectionKey = keyof typeof SECTION_KEYS;

function sectionCollapsed(key: SectionKey): boolean {
  try {
    return localStorage.getItem(SECTION_KEYS[key]) === "1";
  } catch {
    return false;
  }
}

function setSectionCollapsed(key: SectionKey, on: boolean) {
  try {
    localStorage.setItem(SECTION_KEYS[key], on ? "1" : "0");
  } catch {
    /* private mode */
  }
  document.documentElement.classList.toggle(`rail-${key}-collapsed`, on);
}

/**
 * 把某個 .nav-label 變成可收合的區塊標題。
 * 每次 render 都呼叫（自帶存在性守衛）——區塊標題會被 innerHTML 重建。
 */
function ensureSectionToggle(label: Element, key: SectionKey, name: string) {
  const on = sectionCollapsed(key);
  document.documentElement.classList.toggle(`rail-${key}-collapsed`, on);

  let btn = label.querySelector<HTMLButtonElement>(".rail-sec-toggle");
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rail-sec-toggle";
    btn.innerHTML = `<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M12.78 6.22a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 7.28a.75.75 0 0 1 1.06-1.06L8 9.94l3.72-3.72a.75.75 0 0 1 1.06 0z"/></svg>`;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const next = !sectionCollapsed(key);
      setSectionCollapsed(key, next);
      btn!.setAttribute("aria-expanded", next ? "false" : "true");
      btn!.title = next ? `展開${name}` : `收合${name}`;
    });
    label.classList.add("rail-sec-head");
    label.appendChild(btn);
  }
  btn.setAttribute("aria-expanded", on ? "false" : "true");
  btn.setAttribute("aria-label", on ? `展開${name}` : `收合${name}`);
  btn.title = on ? `展開${name}` : `收合${name}`;
}

function bumpCounts() {
  import("./rail-nav")
    .then((m) => m.refreshNavCounts())
    .catch(() => {
      /* ignore */
    });
}

/**
 * 選中專案後掛在那張卡片底下的動作列。
 *
 * 「編輯工作台」與「Task Tracking」都是**對某一個專案**做的事，放在固定導覽區
 * 等於要人先在腦裡把「我選的是哪個專案」跟「這顆按鈕會作用在誰身上」接起來。
 * 貼在卡片下方，主詞就寫在正上方一行。
 *
 * 字級與圖示比主導覽小一號 —— 它是卡片的附屬動作，不該跟導覽搶重量。
 */
/**
 * 工作區的三個入口：專案總覽、專案清單、審閱佇列。
 *
 * 三者都是「看全部」的視圖，不屬於任何一張專案卡片，所以放在專案清單**之前**
 * 自成一列 —— 之前它們散在兩個地方（總覽／清單擠在「專案 N」那行的中間，
 * 審閱佇列在區塊標題右上角），同一類東西分三處，每次都要重新找。
 *
 * 每次 render 都呼叫（自帶存在性守衛）：initRailNav 會整段重建 nav.innerHTML，
 * 只掛一次的話任何一次重建都會把它抹掉。
 */
/**
 * 「工作區」那一組 —— 四個**跨專案**的視圖。
 *
 * 同時也是「現在沒有選中任何專案」的判準來源（`onWorkspacePage`）：
 * 兩者共用一份清單，才不會在這裡加一個入口、忘了另一邊而讓選取狀態說謊。
 */
/**
 * 只有 href，**刻意不含 icon**。
 *
 * `rail-nav.ts` 與這個檔互相 import（它要 `renderRailProjects`，這裡要 `IC`）。
 * 在模組頂層讀 `IC.*` 會在這個循環還沒解開時求值，整個模組以
 * `Cannot access 'IC' before initialization` 掛掉 —— 而症狀是側欄整塊不見、
 * 頁面停在「載入中…」，完全指不到這一行。icon 只在函式裡取，就沒有這個問題。
 */
const WORKSPACE_HREFS = ["overview.html", "projects.html", "review.html", "templates.html"] as const;

/**
 * 現在這一頁是不是跨專案視圖。
 *
 * 是的話，下面的專案清單**不標選中、也不展開那三個動作**：這四頁看的是
 * 全部專案，卻同時把某一張卡片標亮並在它底下列出「PRD 審閱監控／編輯工作台／
 * Task Tracking」，等於宣稱你正在那個專案裡 —— 你不在。而且那三個入口一旦
 * 出現就會被點，點下去才發現它帶你去的是「上次選的那個」，不是你剛剛在看的。
 */
function onWorkspacePage(): boolean {
  const here = location.pathname.split("/").pop() || "";
  return (WORKSPACE_HREFS as readonly string[]).includes(here);
}

function ensureWorkspaceNav(nav: Element) {
  const workLabel = Array.from(nav.querySelectorAll(".nav-label")).find(
    (el) => /工作區/.test(el.textContent || "") && !el.classList.contains("rail-proj-head"),
  );
  if (!workLabel) return;

  ensureSectionToggle(workLabel, "ws", "工作區");

  // href 順序與 WORKSPACE_HREFS 對齊 —— 那一份是「哪幾頁不算選中專案」的判準
  const items: { href: string; label: string; icon: string; count?: "review" | "templates"; title: string }[] = [
    { href: WORKSPACE_HREFS[0], label: "專案總覽", icon: IC.dashboard, title: "所有專案的彙整儀表板" },
    { href: WORKSPACE_HREFS[1], label: "專案清單", icon: IC.projects, title: "可篩選、可搜尋的專案清單" },
    { href: WORKSPACE_HREFS[2], label: "審閱佇列", icon: IC.review, count: "review", title: "待審與待簽核的規格" },
    { href: WORKSPACE_HREFS[3], label: "章節範本", icon: IC.templates, count: "templates", title: "可直接插入的段落骨架" },
  ];

  let row = nav.querySelector(".rail-wsnav") as HTMLElement | null;
  if (!row) {
    row = document.createElement("div");
    row.className = "rail-wsnav";
    // 直接沿用 .nav-item —— 這一組跟主導覽是同一種東西（去某一頁），
    // 自己另做一套外觀只會讓側欄出現兩種「可點的列」。
    row.innerHTML = items
      .map(
        (it) =>
          `<a class="nav-item" href="${it.href}" title="${escapeHtml(it.title)}">
            <svg class="ic" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${it.icon}</svg>
            ${escapeHtml(it.label)}
            ${it.count ? `<span class="count" data-nav-count="${it.count}">0</span>` : ""}
          </a>`,
      )
      .join("");
    workLabel.insertAdjacentElement("afterend", row);
  }

  // 目前所在的那一個標起來
  const here = location.pathname.split("/").pop() || "";
  row.querySelectorAll<HTMLAnchorElement>(".nav-item").forEach((a2) => {
    const on = a2.getAttribute("href") === here;
    a2.classList.toggle("active", on);
    if (on) a2.setAttribute("aria-current", "page");
    else a2.removeAttribute("aria-current");
  });
}

function projActionsHtml(): string {
  const items = [
    { href: "write.html", label: "PRD 審閱監控", icon: IC.write },
    { href: "signoff.html", label: "簽核管理", icon: IC.signoff },
    { href: "editor.html", label: "編輯工作台", icon: IC.editor },
    { href: "tracking.html", label: "Task Tracking", icon: IC.tracking },
  ];
  // 現在站在哪一頁要標出來。上面的「工作區」那一組早就這麼做了，這三個沒有 ——
  // 結果是在編輯台跟在 PRD 審閱監控看到的側欄長得一模一樣，位置感全靠記憶。
  const here = location.pathname.split("/").pop() || "";
  return `<div class="rail-proj-actions" role="group" aria-label="這個專案可以做的事">
    ${items
      .map((it) => {
        const on = it.href === here;
        // 內層 span 才是選中底色的載體：外層 <a> 的兩個 pseudo 被樹狀幹線與
        // 橫枝佔著，底色畫在外層會把那兩條線一起框進去，看起來像框歪了。
        return `<a class="rail-proj-action${on ? " on" : ""}" href="${it.href}"${
          on ? ' aria-current="page"' : ""
        }><span class="rail-proj-action-in"><svg class="ic" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${it.icon}</svg><span>${it.label}</span></span></a>`;
      })
      .join("")}
  </div>`;
}

function statusTone(p: Project): NonNullable<RailContextOpts["statusTone"]> {
  if (p.status === "approved") return "ok";
  if (p.status === "review") return "warn";
  return "draft";
}

function statusLabel(p: Project): string {
  if (p.status === "approved") return "已核准";
  if (p.status === "review") return "審閱中";
  if (p.status === "withdrawn") return "已抽單";
  return "草稿";
}

/**
 * 上一次畫出來的內容簽章。
 *
 * store 每一次 emit 都會叫這支重畫（自動存檔、追蹤刷新、切頁…），
 * 無條件重設 innerHTML 的代價是：畫面閃、展開的 details 收合、
 * hover 與鍵盤焦點全部歸零。內容沒變就整段跳過。
 */
let lastRailSig = "__init__";

export function renderRailProjects(host?: HTMLElement | null) {
  const nav = host ?? document.querySelector(".rail-nav");
  if (!nav) return;

  let block = document.getElementById("rail-projects-block");
  if (!block) {
    block = document.createElement("div");
    block.id = "rail-projects-block";
    block.className = "rail-projects-block";
    const workLabel = Array.from(nav.querySelectorAll(".nav-label")).find((el) =>
      /工作區/.test(el.textContent || ""),
    );
    const firstNav = nav.querySelector("a.nav-item");
    if (workLabel) {
      workLabel.insertAdjacentElement("afterend", block);
    } else if (firstNav) {
      nav.insertBefore(block, firstNav);
    } else {
      nav.insertBefore(block, nav.firstChild);
    }
  }

/**
 * 「＋」的選單。三條進場路徑放在同一顆按鈕底下：
 * 匯入既有資料夾、從零新建、新手引導。
 *
 * ADHD：三顆並排的按鈕會逼人先比較再決定；一顆 ＋ 打開才做選擇，
 * 決策點只有一個，而且選項自帶一句說明。
 */
const ADD_ITEMS: { href: string; label: string; desc: string }[] = [
  { href: "projects.html?import=1", label: "專案匯入", desc: "掃描既有資料夾，自動對應 PRD 章節" },
  { href: "projects.html?new=1", label: "新建 PRD", desc: "從空白開始，精靈帶你走一遍" },
  { href: "projects.html?beginner=1", label: "新手引導", desc: "多一點提示與範例，第一次寫就選這個" },
];

function bindAddMenu(block: HTMLElement) {
  const btn = block.querySelector("#rail-proj-add") as HTMLButtonElement | null;
  if (!btn) return;

  const close = () => {
    document.getElementById("rail-add-menu")?.remove();
    btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onKey);
  };
  function onDocClick(e: MouseEvent) {
    const menu = document.getElementById("rail-add-menu");
    if (!menu) return;
    if (menu.contains(e.target as Node) || btn!.contains(e.target as Node)) return;
    close();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (document.getElementById("rail-add-menu")) {
      close();
      return;
    }
    const menu = document.createElement("div");
    menu.id = "rail-add-menu";
    menu.className = "rail-add-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML = ADD_ITEMS.map(
      (it) => `
        <a class="rail-add-item" role="menuitem" href="${it.href}">
          <strong>${it.label}</strong>
          <span>${it.desc}</span>
        </a>`,
    ).join("");
    // 掛在 body 而不是側欄裡：側欄有 overflow: auto，掛在裡面會被裁掉
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect();
    menu.style.top = `${Math.round(r.bottom + 6)}px`;
    menu.style.left = `${Math.round(Math.min(r.left - 8, window.innerWidth - menu.offsetWidth - 12))}px`;
    btn.setAttribute("aria-expanded", "true");
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onKey);
    (menu.querySelector("a") as HTMLElement | null)?.focus();
  });
}

  ensureWorkspaceNav(nav);

  const projects = store.visibleProjects();
  // 跨專案視圖上沒有「目前這個專案」—— 不標選中，也不展開專案動作
const activeId = onWorkspacePage() ? "" : store.get().activeProjectId;

  // 簽章要用**畫面上真的看得到的值**，不是原始資料。
  //
  // 第一版用了 lastFileAt（ISO 時間戳）—— 但 touchProjectMeta 在每一次
  // setSectionField 都會把它設成 nowIso()，等於在編輯台打一個字簽章就變一次，
  // 守衛完全失效、整份清單照樣每個按鍵重建一遍。
  // 改用 formatLastUpdate 的輸出（「3 小時前」這種），它一分鐘才會變一次。
  const sig = [
    activeId,
    projects
      .map((p) => {
        const when = formatLastUpdate(
          p.lastFileAt || p.importSummary?.scannedAt || p.updated,
        );
        return `${p.id}:${projectDisplayName(p)}:${p.status}:${when}:${p.isImported ? 1 : 0}`;
      })
      .join("|"),
  ].join("#");
  if (sig === lastRailSig && document.getElementById("rail-projects-block")?.children.length) {
    bumpCounts();
    return;
  }
  lastRailSig = sig;

  if (!projects.length) {
    block.innerHTML = `
      <div class="nav-label rail-proj-head">
        <span>專案</span>
        <button type="button" class="rail-proj-add" id="rail-proj-add" title="新增" aria-label="新增" aria-haspopup="true" aria-expanded="false">+</button>
      </div>
      <div class="rail-projects-empty">尚無專案<br /><span class="muted">新建或匯入資料夾</span></div>
    `;
    bindAddMenu(block);
    ensureProjToggle(block);
    bumpCounts();
    return;
  }

  block.innerHTML = `
    <div class="nav-label rail-proj-head">
      <span>專案 <span class="rail-proj-count">${projects.length}</span></span>
      <button type="button" class="rail-proj-add" id="rail-proj-add" title="新增" aria-label="新增" aria-haspopup="true" aria-expanded="false">+</button>
    </div>
    <div class="rail-projects" role="list" aria-label="專案清單" id="rail-projects-list">
      ${projects
        .map((p) => {
          const name = projectDisplayName(p);
          const on = p.id === activeId ? " on" : "";
          const when = formatLastUpdate(p.lastFileAt || p.importSummary?.scannedAt || p.updated);
          const folderHint = p.sourceFolder && !p.customName
            ? escapeHtml(p.sourceFolder)
            : p.customName
              ? escapeHtml(p.sourceFolder || p.title)
              : "";
          const badge = p.isImported
            ? `<span class="rail-proj-tag">匯入</span>`
            : p.isSample
              ? `<span class="rail-proj-tag sample">範例</span>`
              : `<span class="rail-proj-tag new">新建</span>`;
          return `
            <article class="rail-proj-card${on}" data-project-id="${escapeHtml(p.id)}" role="listitem" title="${escapeHtml(name)}${folderHint ? ` · ${folderHint}` : ""}">
              <button type="button" class="rail-proj-card-main" data-open-id="${escapeHtml(p.id)}">
                <span class="rail-proj-card-top">
                  <span class="rail-proj-status rail-proj-status--${statusTone(p)}" title="${statusLabel(p)}"></span>
                  <span class="rail-proj-card-title">${escapeHtml(name)}</span>
                </span>
                <span class="rail-proj-card-sub">${escapeHtml(when)}${badge}</span>
              </button>
              <button type="button" class="rail-proj-card-rename" data-rename-id="${escapeHtml(p.id)}" title="自訂專案名稱" aria-label="重新命名 ${escapeHtml(name)}">✎</button>
            </article>${on ? projActionsHtml() : ""}`;
        })
        .join("")}
    </div>
  `;

  block.querySelectorAll<HTMLButtonElement>("[data-open-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      // 編輯名稱中不要切專案
      if (btn.closest(".rail-proj-card")?.classList.contains("is-renaming")) return;
      const id = btn.dataset.openId;
      if (!id) return;
      store.setActiveProject(id);
      // 點專案卡片一律進儀表板 —— 與專案列表的卡片同一個行為。
      // 已經在儀表板上就重載，讓量測與畫面對上新專案。
      const path = location.pathname + location.href;
      if (path.includes("dashboard.html")) {
        location.reload();
        return;
      }
      location.href = "dashboard.html";
    });
  });

  block.querySelectorAll<HTMLButtonElement>("[data-rename-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.renameId;
      if (!id) return;
      beginInlineRename(block, id);
    });
  });

  bindAddMenu(block);
  ensureProjToggle(block);
  bumpCounts();
}

/** 「專案 N」那一行的收合鈕（每次重建後重掛） */
function ensureProjToggle(block: HTMLElement) {
  const head = block.querySelector(".rail-proj-head");
  if (head) ensureSectionToggle(head, "projects", "專案清單");
}

/*
 * 拖曳調整清單高度的功能退休了。
 *
 * 它存在的理由是「清單太高會把下面的導覽推出畫面」—— 但下面的東西
 * （「其他功能」那一區）已經搬進設定，清單現在是側欄下半唯一的內容，
 * 直接撐滿剩餘空間即可。留著把手只是讓人去調一個沒有取捨的東西，
 * 而且它下方那塊空白正是使用者回報的問題。
 */

/**
 * 頁內重新命名（WKWebView 不支援 window.prompt）
 */
function beginInlineRename(block: HTMLElement, id: string) {
  const p = store.get().projects.find((x) => x.id === id);
  if (!p) return;

  const card = Array.from(block.querySelectorAll<HTMLElement>(".rail-proj-card")).find(
    (el) => el.dataset.projectId === id,
  );
  if (!card) return;

  // 已在編輯：聚焦
  const existing = card.querySelector<HTMLInputElement>(".rail-proj-rename-input");
  if (existing) {
    existing.focus();
    existing.select();
    return;
  }

  const fallback = (p.sourceFolder || p.title || "").trim() || "專案";
  const current = (p.customName || projectDisplayName(p)).trim();
  card.classList.add("is-renaming");

  const main = card.querySelector(".rail-proj-card-main");
  const renameBtn = card.querySelector(".rail-proj-card-rename");
  if (main) (main as HTMLElement).style.display = "none";
  if (renameBtn) (renameBtn as HTMLElement).style.display = "none";

  const form = document.createElement("div");
  form.className = "rail-proj-rename-form";
  form.innerHTML = `
    <label class="rail-proj-rename-label">自訂名稱
      <span class="rail-proj-rename-hint">留空＝${escapeHtml(fallback)}</span>
    </label>
    <input type="text" class="rail-proj-rename-input" maxlength="80" value="${escapeHtml(current)}" />
    <div class="rail-proj-rename-actions">
      <button type="button" class="btn btn-sm btn-primary rail-proj-rename-save">儲存</button>
      <button type="button" class="btn btn-sm btn-ghost rail-proj-rename-cancel">取消</button>
    </div>
  `;
  card.appendChild(form);

  const input = form.querySelector<HTMLInputElement>(".rail-proj-rename-input")!;
  const save = () => {
    const next = input.value;
    const r = store.renameProject(id, next);
    if (!r.ok) {
      toast(r.reason ?? "重新命名失敗");
      return;
    }
    // 必須先解除 is-renaming 再重繪：subscribe 會跳過「編輯中」卡片
    card.classList.remove("is-renaming");
    form.remove();
    renderRailProjects();
    // 側欄「目前」區塊也同步新名稱
    const active = store.get().activeProjectId === id;
    if (active) {
      const p2 = store.get().projects.find((x) => x.id === id);
      if (p2) {
        const name = projectDisplayName(p2);
        const ctx = document.querySelector(".rail-context-project");
        if (ctx) ctx.textContent = name;
      }
    }
    toast(next.trim() ? `已命名為「${next.trim()}」` : "已清除自訂名稱");
  };
  const cancel = () => {
    card.classList.remove("is-renaming");
    renderRailProjects();
  };

  form.querySelector(".rail-proj-rename-save")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    save();
  });
  form.querySelector(".rail-proj-rename-cancel")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    cancel();
  });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      save();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      cancel();
    }
  });
  input.addEventListener("click", (ev) => ev.stopPropagation());

  // 下一個 frame 聚焦（WKWebView 較穩）
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

/** 供專案列表等外部觸發側欄頁內重新命名 */
export function startProjectRename(id: string) {
  renderRailProjects();
  requestAnimationFrame(() => {
    const block = document.getElementById("rail-projects-block");
    if (!block) {
      toast("側欄專案清單尚未就緒");
      return;
    }
    beginInlineRename(block, id);
  });
}

let bound = false;

export function bindRailProjects() {
  renderRailProjects();
  if (bound) return;
  bound = true;
  store.subscribe(() => {
    // 重新命名編輯中不要洗掉表單
    if (document.querySelector(".rail-proj-card.is-renaming")) return;
    renderRailProjects();
  });
}
