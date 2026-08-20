import {
  AiError,
  critiqueSectionWithAI,
  generateAIDraft,
  getAiReadiness,
  isAiConfigured,
  polishTextWithAI,
} from "../lib/ai-coach";
import { askConfirm, askText } from "../lib/ask";
import { evaluateChecks, liveScore, store } from "../data/store";
import { CUSTOM_SECTION_ID } from "../data/seed";
import type { Project, Section } from "../data/types";
import { projectDisplayName } from "../data/types";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import { syncRailContext } from "../lib/rail-projects";
import {
  expandEnter,
  flashFocus,
  pulseSubmitWhenBecameReady,
  syncMotionPreferenceClass,
} from "../lib/attention-motion";
import {
  EDITOR_BEGINNER_TRACK,
  isBeginnerMode,
  setBeginnerMode,
} from "../lib/beginner-flow";
import { exportMarkdownFile } from "../lib/export";
import { fieldNo, numberedFieldLabel } from "../lib/field-number";
import { bindMdField, mdFieldHtml, setAllMdModes, type MdPaneMode } from "../lib/markamd";
import { renderMarkdown } from "../lib/markamd/markdown";
import { canEditContent } from "../lib/permissions";
import { deriveFlowLayers, renderFlowStripHtml } from "../lib/flow-layers";
import {
  buildFileTree,
  renderFileTreeHtml,
  SECTION_TO_OPENSPEC,
  sourceFileForSection,
} from "../lib/file-tree";
import { absolutePathFor, groupOpenspecFiles, openspecFiles } from "../lib/openspec-tree";
import { canEditFiles, readFile, shortPath, writeFile } from "../lib/file-editor";
import {
  addWish,
  archiveWish,
  emptyWishlist,
  parseWishlist,
  serializeWishlist,
  updateWish,
  wishlistLsKey,
  wishlistPath,
  writeWishHandoff,
  type WishlistDoc,
} from "../lib/function-wishlist";
import { isNative, isUnavailable, native } from "../lib/native";
import {
  changedLineCount,
  type LineMark,
  inlineDiff,
  loadSnapshots,
  markChangedLines,
  pushSnapshot,
  relativeTime,
  visibleSegs,
  type Seg,
} from "../lib/file-history";
import { initHelpOverlay } from "../lib/help-overlay";
import { askForProjectFolder } from "../lib/project-folder";
import { initFocusMode, renderProgress } from "../lib/focus-mode";
import {
  bindResumeTracking,
  ensureStarter,
  initHyperfocusGuard,
  markActivity,
  restoreCaret,
} from "../lib/writing-assist";
import { evaluatePrdGates, gateSummaryLine } from "../lib/prd-gates";
import { DEFAULT_DOMAIN, listDomains } from "../data/domains";
import { initTheme } from "../lib/theme";
import { renderDiffSummary } from "../lib/diff-summary";
import { changedFieldCount } from "../lib/prd-versions";
import { escapeHtml, initMobileNav, toast, updateUserRailFooter } from "../lib/ui";

/** MarkaMD 雙欄欄位清理 */
let unbindMd: (() => void) | null = null;

// plans/*.md 只在開發時預嵌。
// eager glob 會把「這個 repo 自己的」內部規劃文件整包打進 bundle ——
// 正式版曾因此多出一個 160KB chunk，等於把開發筆記發布給使用者。
// 桌面版本來就走原生橋讀「使用者選取專案」的 plans/，不靠這份預嵌；
// 瀏覽器版失去的只是開發用的假資料。
const planModules = (import.meta.env.DEV
  ? import.meta.glob("../../plans/*.md", {
      query: "?raw",
      import: "default",
      eager: true,
    })
  : {}) as Record<string, string>;

const __authed = requireAuth();
if (__authed) {
initTheme();
initMobileNav("editor");
bindLogout();
initHelpOverlay();
{
  const toolbar = document.querySelector(".toolbar");
  if (toolbar && !document.getElementById("flow-strip-host")) {
    const wrap = document.createElement("div");
    wrap.id = "flow-strip-host";
    toolbar.insertAdjacentElement("afterend", wrap);
  }
}

let idx = 0;
/** 用於章節切換時 flash 視線錨定 */
let prevIdx = -1;

function editable(): boolean {
  return canEditContent(store.get().currentUser) && !store.get().locked;
}

function activeProject(): Project | null {
  const st = store.get();
  const visible = st.projects.filter((p) => (st.showSamples ? true : !p.isSample));
  return (
    visible.find((p) => p.id === st.activeProjectId) ??
    visible[0] ??
    st.projects.find((p) => p.id === st.activeProjectId) ??
    st.projects[0] ??
    null
  );
}

/** 工具列綁定目前專案；專案名改放側欄（不再塞 titlebar） */
function syncProjectChrome() {
  const p = activeProject();
  const name = p ? projectDisplayName(p) : "未選擇專案";
  const meta =
    (p?.sourceFolder && p.sourceFolder.trim()) ||
    (p?.tag && p.tag.trim()) ||
    (p?.id ?? "—");

  const statusMap: Record<string, { label: string; tone: "draft" | "review" | "ok" | "warn"; cls: string }> = {
    draft: { label: "草稿", tone: "draft", cls: "pill pill-draft" },
    review: { label: "審閱中", tone: "review", cls: "pill pill-review" },
    approved: { label: "已核准", tone: "ok", cls: "pill pill-approved" },
    withdrawn: { label: "已抽單", tone: "warn", cls: "pill pill-draft" },
  };
  const stInfo = (p && statusMap[p.status]) || { label: "—", tone: "draft" as const, cls: "pill pill-draft" };

  syncRailContext({
    mode: "編輯工作台",
    projectName: name,
    statusLabel: stInfo.label,
    statusTone: stInfo.tone,
    meta: p ? meta : undefined,
  });

  const h1 = document.querySelector<HTMLElement>('[data-od-id="page-title"], .toolbar h1');
  if (h1) h1.textContent = name;

  // 不再寫「自動儲存 HH:MM」—— 那個標籤在取消自動存檔之後就是謊話，
  // 而且是最危險的那一種：使用者會相信東西已經存了。
  const sub = document.querySelector<HTMLElement>('[data-od-id="page-sub"], .toolbar .sub');
  if (sub) {
    const dirty = store.dirtySectionIds().length;
    sub.textContent = p
      ? dirty
        ? `${meta} · ${dirty} 個章節未儲存`
        : `${meta} · 已儲存`
      : "回總覽選一個專案";
    sub.classList.toggle("is-dirty", Boolean(p && dirty));
  }

  document.title = `${name} · 編輯 · Anchorline`;
}

function syncUser() {
  const u = store.get().currentUser;
  updateUserRailFooter(toRailUser(u));
  const banner = document.getElementById("perm-banner");
  if (banner) {
    if (!canEditContent(u)) {
      banner.hidden = false;
      banner.textContent = "目前身分為核准人員：可檢視，不可編輯內文。請至審閱頁簽核。";
    } else if (store.get().locked) {
      banner.hidden = false;
      banner.textContent = "規格已核准鎖定，內文唯讀。";
    } else {
      banner.hidden = true;
    }
  }
}

function sections(): Section[] {
  return store.get().sections;
}

/**
 * 這一節「畫面上該顯示的內容」= 已儲存的值疊上未儲存的草稿。
 *
 * 取消自動存檔之後，textarea 裡的東西可能還沒進 sectionValues；
 * 直接讀 sectionValues 會讓使用者重新進來時看到自己的字不見了。
 */
function valuesFor(s: Section): Record<string, string> {
  const saved = store.get().sectionValues[s.id] ?? {};
  const draft = store.get().prdDrafts[store.get().activeProjectId]?.[s.id];
  return draft ? { ...saved, ...draft } : saved;
}

/** 這一節已儲存的內容 —— 異動高亮的基準 */
function savedValuesFor(s: Section): Record<string, string> {
  return store.get().sectionValues[s.id] ?? {};
}

/**
 * 上層：專案資料夾檔案樹（哪些是 PRD 來源、哪些是 OpenSpec 產出）
 *
 * 用簽章擋掉不必要的重繪：store 每次按鍵都 emit，無條件重建會清掉
 * 使用者的展開／捲動狀態。
 */
let lastTreeSig = "__init__";

/**
 * 大綱欄的可收合區塊。三塊共用一支：OpenSpec 章節、Task List、專案檔案。
 * 收合狀態各自記在 localStorage —— 每次開編輯台都要重收一次是懲罰。
 */
function initCollapsible(btnId: string, bodyId: string, storageKey: string, label: string) {
  const btn = document.getElementById(btnId) as HTMLButtonElement | null;
  const body = document.getElementById(bodyId) as HTMLElement | null;
  if (!btn || !body) return;

  const apply = (collapsed: boolean) => {
    body.hidden = collapsed;
    btn.classList.toggle("is-collapsed", collapsed);
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    btn.title = `${collapsed ? "展開" : "收合"} ${label}`;
  };

  let collapsed = false;
  try {
    collapsed = localStorage.getItem(storageKey) === "1";
  } catch {
    /* private mode */
  }
  apply(collapsed);

  btn.addEventListener("click", () => {
    collapsed = !collapsed;
    apply(collapsed);
    try {
      localStorage.setItem(storageKey, collapsed ? "1" : "0");
    } catch {
      /* private mode */
    }
  });
}

const FT_COLLAPSE_KEY = "anchorline:file-tree-collapsed";

const FT_HEIGHT_KEY = "anchorline:file-tree-height";

/**
 * 檔案樹高度拖曳。
 * 「章節」與「專案檔案」誰該多分一點，只有當下在做什麼的你知道 ——
 * 寫死一個比例一定會有人不滿意，給把手比猜便宜。
 */
function initFileTreeResize() {
  const col = document.querySelector('[data-od-id="outline-col"]') as HTMLElement | null;
  const grip = document.getElementById("file-tree-resize") as HTMLElement | null;
  const host = document.getElementById("file-tree") as HTMLElement | null;
  if (!col || !grip || !host) return;

  const MIN = 90;
  const apply = (h: number) => col.style.setProperty("--ft-h", `${Math.round(h)}px`);

  try {
    const saved = Number(localStorage.getItem(FT_HEIGHT_KEY));
    if (saved >= MIN) apply(saved);
  } catch {
    /* private mode */
  }

  let startY = 0;
  let startH = 0;
  const max = () => Math.max(MIN, col.clientHeight - 180); // 章節至少留 180px

  const onMove = (e: PointerEvent) => {
    // 把手在檔案樹「上方」，往上拖 = 變高，所以要取負號
    apply(Math.min(max(), Math.max(MIN, startH - (e.clientY - startY))));
  };
  const onUp = () => {
    // 監聽掛在 window：滑鼠拖到把手外面（很常見）仍然要跟得上，
    // 而且 setPointerCapture 失敗時不會整個拖不動。
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    grip.classList.remove("is-dragging");
    document.body.style.userSelect = "";
    try {
      localStorage.setItem(FT_HEIGHT_KEY, String(host.offsetHeight));
    } catch {
      /* private mode */
    }
  };

  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    startY = e.clientY;
    startH = host.offsetHeight;
    grip.classList.add("is-dragging");
    document.body.style.userSelect = "none";
    try {
      grip.setPointerCapture(e.pointerId);
    } catch {
      /* 沒有 capture 也能拖，只是拖太快可能掉幀 */
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}


/** 檔案樹收合成一條標題列。狀態要留著 —— 每次開編輯台都要重收一次是懲罰。 */
function initFileTreeCollapse() {
  const col = document.querySelector('[data-od-id="outline-col"]') as HTMLElement | null;
  const btn = document.getElementById("btn-file-tree-toggle") as HTMLButtonElement | null;
  if (!col || !btn) return;

  const apply = (collapsed: boolean) => {
    col.classList.toggle("ft-collapsed", collapsed);
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    btn.title = collapsed ? "展開專案檔案" : "收合專案檔案";
  };

  let collapsed = false;
  try {
    collapsed = localStorage.getItem(FT_COLLAPSE_KEY) === "1";
  } catch {
    /* private mode */
  }
  apply(collapsed);

  btn.addEventListener("click", () => {
    collapsed = !collapsed;
    apply(collapsed);
    try {
      localStorage.setItem(FT_COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      /* private mode */
    }
  });
}

function renderFileTree() {
  const host = document.getElementById("file-tree");
  if (!host) return;
  const p = activeProject();
  const sig = `${p?.id ?? ""}|${p?.sourceFolder ?? ""}|${
    p?.importSummary?.allPaths?.length ?? 0
  }|${sections()[idx]?.id ?? ""}`;
  if (sig === lastTreeSig) return;
  lastTreeSig = sig;
  const tree = p ? buildFileTree(p, sections()) : null;
  const activeId = sections()[idx]?.id ?? "";
  host.innerHTML = renderFileTreeHtml(tree, activeId);

  host.querySelectorAll<HTMLButtonElement>("[data-ft-section]").forEach((btn) => {
    btn.onclick = async () => {
      const sid = btn.dataset.ftSection!;
      const i = sections().findIndex((s) => s.id === sid);
      if (i < 0) return;
      if (!(await goToSection(sid))) return;
      idx = i;
      render();
    };
  });

  // 空狀態的出口：手動新建的 PRD 也能在這裡補綁資料夾
  const bindBtn = document.getElementById("ft-bind-folder");
  if (bindBtn && p) {
    bindBtn.addEventListener("click", () => askForProjectFolder(p.id, projectDisplayName(p)));
  }

  host.querySelectorAll<HTMLButtonElement>("[data-ft-dir]").forEach((btn) => {
    btn.onclick = () => {
      const open = btn.getAttribute("aria-expanded") !== "false";
      btn.setAttribute("aria-expanded", open ? "false" : "true");
      btn.parentElement?.classList.toggle("is-collapsed", open);
    };
  });
}

/**
 * OpenSpec：偵測專案資料夾底下有沒有 `openspec/`，有就列出裡面的檔案。
 *
 * 分群與排序的邏輯在 `lib/openspec-tree.ts`（純函式、有測試）——
 * 這裡只負責畫出來與接點擊。
 *
 * App 只存掃到的路徑不存內文，所以這一塊回答的是「有沒有、有哪些」，
 * 不是內容。點檔名交給系統預設應用程式開。
 */
function renderOpenSpec() {
  const el = document.getElementById("os-files") ?? document.getElementById("openspec-list");
  if (!el) return;
  const p = activeProject();
  const root = p?.importSummary?.rootPath ?? "";
  const all = p?.importSummary?.allPaths ?? [];
  const files = openspecFiles(all);

  const countEl = document.getElementById("os-count");
  if (countEl) countEl.textContent = files.length ? `${files.length} 檔` : "無";

  if (!p) {
    el.innerHTML = `<p class="os-empty">還沒有選擇專案。</p>`;
  } else if (!all.length) {
    el.innerHTML = `<p class="os-empty">這份 PRD 還沒有對應的資料夾，掃不到 <code>openspec/</code>。</p>`;
  } else if (!files.length) {
    el.innerHTML = `<p class="os-empty">專案目錄底下沒有 <code>openspec/</code> 資料夾。匯出 OpenSpec 後會出現在這裡。</p>`;
  } else {
    el.innerHTML = groupOpenspecFiles(files)
      .map((g) => {
        const rows = g.rows
          .map(
            (r) => `<button type="button" class="os-row os-file-row"
                data-os-path="${escapeHtml(absolutePathFor(root, r.rel))}"
                title="開啟 ${escapeHtml(r.rel)}">
              <span class="os-dot done"></span>
              <span class="os-body">
                <span class="os-head">${escapeHtml(r.name)}</span>
                <span class="os-file">${escapeHtml(r.sub || g.label)}</span>
              </span>
            </button>`,
          )
          .join("");
        return `<p class="os-group os-group--${g.kind}">${escapeHtml(g.label)}<span>${g.rows.length}</span></p>${rows}`;
      })
      .join("");

    el.querySelectorAll<HTMLButtonElement>("[data-os-path]").forEach((btn) => {
      btn.onclick = () => {
        void openFileInEditor(btn.dataset.osPath ?? "");
      };
    });
  }

  const pid = p?.id ?? "";
  if (!wishBooted || pid !== lastWishProjectId) {
    wishBooted = true;
    lastWishProjectId = pid;
    void loadAndRenderWishlist();
  }
}

/**
 * Function wish list。I/O 在這裡，判定在 `function-wishlist.ts`。
 *
 * 不跟檔案列表共用 innerHTML：`render()` 會重畫 OpenSpec 檔案，
 * 願望的輸入框若被一起清掉，打到一半的字就沒了。
 */
let wishDoc: WishlistDoc = emptyWishlist();
let wishChecked = new Set<string>();
let wishComposing = false;
let wishEditingId: string | null = null;
let lastWishProjectId = "";
let wishBooted = false;
let wishBusy = false;

async function loadAndRenderWishlist() {
  wishDoc = await loadWishlist();
  wishChecked = new Set();
  wishComposing = false;
  wishEditingId = null;
  renderWishlist();
}

async function loadWishlist(): Promise<WishlistDoc> {
  const p = activeProject();
  if (!p) return emptyWishlist();
  const root = p.importSummary?.rootPath;
  if (root && canEditFiles()) {
    try {
      return parseWishlist(await readFile(wishlistPath(root)));
    } catch {
      /* 檔還不存在是常態，不是錯誤 */
    }
  }
  try {
    const raw = localStorage.getItem(wishlistLsKey(p.id));
    return raw ? parseWishlist(raw) : emptyWishlist();
  } catch {
    return emptyWishlist();
  }
}

async function persistWishlist(doc: WishlistDoc): Promise<void> {
  const p = activeProject();
  if (!p) throw new Error("還沒有選擇專案");
  const text = serializeWishlist(doc);
  const root = p.importSummary?.rootPath;
  if (root && isNative()) {
    const r = await native.writeWishlist(root, text);
    if (isUnavailable(r)) throw new Error(r.message);
  }
  try {
    localStorage.setItem(wishlistLsKey(p.id), text);
  } catch {
    /* quota —— 桌面版已經寫進檔了，瀏覽器版就只好說失敗 */
    if (!isNative()) throw new Error("瀏覽器存檔失敗（空間可能滿了）");
  }
}

function renderWishlist() {
  const host = document.getElementById("os-wish");
  if (!host) return;
  const p = activeProject();
  host.hidden = false;

  const active = wishDoc.active;
  const archived = wishDoc.archive;
  const count = active.length + archived.length;

  const compose = wishComposing
    ? `<div class="os-wish-compose">
        <textarea id="os-wish-text" rows="4" placeholder="期望的功能說明。寫完按存檔。"></textarea>
        <div class="os-wish-compose-actions">
          <button type="button" class="btn btn-sm btn-primary" id="os-wish-save">存檔</button>
          <button type="button" class="btn btn-sm btn-ghost" id="os-wish-cancel">取消</button>
        </div>
      </div>`
    : "";

  const activeRows = !p
    ? `<p class="os-empty">先選一個專案，願望會跟著專案走。</p>`
    : active.length
      ? active.map((it) => wishRowHtml(it, false)).join("")
      : `<p class="os-empty">還沒有願望。按新增，寫一段期望的功能說明。</p>`;

  const archiveBlock = archived.length
    ? `<p class="os-wish-group">封存<span>${archived.length}</span></p>
       ${archived.map((it) => wishRowHtml(it, true)).join("")}`
    : "";

  host.innerHTML = `
    <div class="os-wish-head">
      <h3 id="os-wish-title">Function wish list</h3>
      <span class="os-wish-count">${count || "—"}</span>
    </div>
    <p class="os-wish-lead">新增一段說明後存檔。勾選送出寫 spec；寫完標示已寫 spec 進封存。</p>
    ${compose}
    <div class="os-wish-toolbar">
      <button type="button" class="btn btn-sm" id="os-wish-add"${p && !wishComposing ? "" : " disabled"}>新增</button>
      <button type="button" class="btn btn-sm btn-primary" id="os-wish-send"${active.some((it) => wishChecked.has(it.id)) ? "" : " disabled"}>送出</button>
    </div>
    <p class="os-wish-group">Active<span>${active.length}</span></p>
    <div id="os-wish-active">${activeRows}</div>
    <div id="os-wish-archive">${archiveBlock}</div>
  `;

  bindWishlist();
  const ta = document.getElementById("os-wish-text") as HTMLTextAreaElement | null;
  ta?.focus();
}

function wishRowHtml(
  it: { id: string; text: string; status?: string },
  archived: boolean,
): string {
  if (wishEditingId === it.id) {
    return `<div class="os-wish-item is-editing" data-wish-id="${escapeHtml(it.id)}">
      <textarea data-wish-edit-text rows="3">${escapeHtml(it.text)}</textarea>
      <div class="os-wish-compose-actions">
        <button type="button" class="btn btn-sm btn-primary" data-wish-save-edit>儲存</button>
        <button type="button" class="btn btn-sm btn-ghost" data-wish-cancel-edit>取消</button>
      </div>
    </div>`;
  }
  const check = archived
    ? ""
    : `<input type="checkbox" data-wish-check="${escapeHtml(it.id)}"${wishChecked.has(it.id) ? " checked" : ""} aria-label="選取這則願望" />`;
  const badge = archived ? `<span class="os-wish-badge">${escapeHtml(it.status ?? "已寫 spec")}</span>` : "";
  const archiveBtn = archived
    ? ""
    : `<button type="button" data-wish-archive="${escapeHtml(it.id)}">已寫 spec</button>`;
  return `<div class="os-wish-item" data-wish-id="${escapeHtml(it.id)}">
    ${check}
    <div class="os-wish-item-body">
      <span class="os-wish-item-text">${escapeHtml(it.text)}</span>
      ${badge}
    </div>
    <div class="os-wish-item-actions">
      <button type="button" data-wish-edit="${escapeHtml(it.id)}">編輯</button>
      ${archiveBtn}
    </div>
  </div>`;
}

function bindWishlist() {
  const host = document.getElementById("os-wish");
  if (!host) return;

  host.querySelector<HTMLButtonElement>("#os-wish-add")?.addEventListener("click", () => {
    wishComposing = true;
    wishEditingId = null;
    renderWishlist();
  });
  host.querySelector<HTMLButtonElement>("#os-wish-cancel")?.addEventListener("click", () => {
    wishComposing = false;
    renderWishlist();
  });
  host.querySelector<HTMLButtonElement>("#os-wish-save")?.addEventListener("click", () => {
    const ta = host.querySelector<HTMLTextAreaElement>("#os-wish-text");
    void commitNewWish(ta?.value ?? "");
  });
  host.querySelector<HTMLButtonElement>("#os-wish-send")?.addEventListener("click", () => {
    void sendWishes();
  });

  host.querySelectorAll<HTMLInputElement>("[data-wish-check]").forEach((c) => {
    c.addEventListener("change", () => {
      const id = c.dataset.wishCheck ?? "";
      if (c.checked) wishChecked.add(id);
      else wishChecked.delete(id);
      const send = host.querySelector<HTMLButtonElement>("#os-wish-send");
      if (send) send.disabled = wishChecked.size === 0;
    });
  });
  host.querySelectorAll<HTMLButtonElement>("[data-wish-edit]").forEach((b) => {
    b.addEventListener("click", () => {
      wishEditingId = b.dataset.wishEdit ?? null;
      wishComposing = false;
      renderWishlist();
    });
  });
  host.querySelectorAll<HTMLButtonElement>("[data-wish-cancel-edit]").forEach((b) => {
    b.addEventListener("click", () => {
      wishEditingId = null;
      renderWishlist();
    });
  });
  host.querySelectorAll<HTMLButtonElement>("[data-wish-save-edit]").forEach((b) => {
    b.addEventListener("click", () => {
      const wrap = b.closest("[data-wish-id]");
      const id = wrap instanceof HTMLElement ? wrap.dataset.wishId ?? "" : "";
      const ta = wrap?.querySelector("textarea");
      void commitEditWish(id, ta?.value ?? "");
    });
  });
  host.querySelectorAll<HTMLButtonElement>("[data-wish-archive]").forEach((b) => {
    b.addEventListener("click", () => {
      void commitArchiveWish(b.dataset.wishArchive ?? "");
    });
  });
}

async function withWishLock(fn: () => Promise<void>) {
  if (wishBusy) return;
  wishBusy = true;
  try {
    await fn();
  } finally {
    wishBusy = false;
  }
}

async function commitNewWish(text: string) {
  await withWishLock(async () => {
    const next = addWish(wishDoc, text);
    if (!next) {
      toast("先寫一段期望的功能說明");
      return;
    }
    try {
      await persistWishlist(next);
    } catch (e) {
      toast(e instanceof Error ? e.message : "存檔失敗");
      return;
    }
    wishDoc = next;
    wishComposing = false;
    renderWishlist();
    toast("已存進 Function wish list");
  });
}

async function commitEditWish(id: string, text: string) {
  await withWishLock(async () => {
    const next = updateWish(wishDoc, id, text);
    if (!next) {
      toast("編輯後不能是空的");
      return;
    }
    try {
      await persistWishlist(next);
    } catch (e) {
      toast(e instanceof Error ? e.message : "存檔失敗");
      return;
    }
    wishDoc = next;
    wishEditingId = null;
    renderWishlist();
    toast("已更新");
  });
}

async function commitArchiveWish(id: string) {
  await withWishLock(async () => {
    const next = archiveWish(wishDoc, id);
    if (!next) return;
    try {
      await persistWishlist(next);
    } catch (e) {
      toast(e instanceof Error ? e.message : "封存失敗");
      return;
    }
    wishDoc = next;
    wishChecked.delete(id);
    renderWishlist();
    toast("已標示已寫 spec，移入封存");
  });
}

async function sendWishes() {
  const p = activeProject();
  const picked = wishDoc.active.filter((it) => wishChecked.has(it.id));
  if (!p || !picked.length) {
    toast("先勾選要寫成 spec 的願望");
    return;
  }
  writeWishHandoff({
    projectId: p.id,
    items: picked.map((it) => ({ id: it.id, text: it.text })),
  });
  window.location.href = "openspec.html";
}

/**
 * 領域選擇器 + 孤兒章節提示。
 *
 * 放在章節清單正上方，因為換領域最直接的後果就是下面那份清單會變——
 * 把因和果放在同一個視野裡，比放進偏好設定裡讓人自己連起來好。
 *
 * 孤兒提示是這裡的重點：換領域**不刪任何正文**，但不屬於新領域的章節
 * 會從清單上消失。沒有這行提示，那看起來就跟資料掉了一模一樣。
 */
function renderDomainBar() {
  const sel = document.getElementById("domain-select") as HTMLSelectElement | null;
  const orphanBox = document.getElementById("domain-orphans");
  if (!sel) return;
  const st = store.get();
  const project = st.projects.find((p) => p.id === st.activeProjectId);
  const current = project?.domain ?? DEFAULT_DOMAIN;
  const editable = canEditContent(st.currentUser) && !st.locked;

  const opts = listDomains();
  const sig = `${opts.map((o) => o.name).join(",")}|${current}|${editable}`;
  if (sel.dataset.sig !== sig) {
    sel.dataset.sig = sig;
    sel.innerHTML = opts
      .map(
        (o) =>
          `<option value="${escapeHtml(o.name)}"${o.name === current ? " selected" : ""}>${escapeHtml(o.displayName)}</option>`,
      )
      .join("");
    sel.disabled = !editable;
  }

  const orphans = store.orphanSectionIds();
  if (orphanBox) {
    orphanBox.hidden = orphans.length === 0;
    // 不列出章節 id——那是內部名稱，對使用者沒有意義。給數量與「還在」這件事就夠。
    orphanBox.textContent = orphans.length
      ? `${orphans.length} 個章節的內容不屬於目前領域。內容仍保留，換回原領域就會回來。`
      : "";
  }
}

/**
 * 章節底下的欄位樹。
 *
 * 編號沿用章節號再接序號：`01` 的三個欄位就是 `011` / `012` / `013`。
 * 這個編號在 PRD 裡是講得出口的座標（「012 給誰還沒寫」），比欄位 key
 * （`who`）對非工程的人友善，也比純標題好定位。
 *
 * 狀態只有「有沒有字」兩種，不做第三種 —— 欄位層級的品質判斷在教練欄，
 * 這裡是導覽不是評分。
 */
function outlineFieldsHtml(s: Section): string {
  const values = valuesFor(s);
  if (!s.fields.length) return "";
  return `<ul class="sec-fields" role="group" aria-label="${escapeHtml(s.title)} 的欄位">
    ${s.fields
      .map((f, n) => {
        const filled = (values[f.key] ?? "").trim().length > 0;
        return `<li>
          <button type="button" class="sec-field${filled ? " is-filled" : ""}" data-field-key="${escapeHtml(f.key)}"
                  title="${escapeHtml(f.hint || f.label)}">
            <span class="sec-field-n mono">${escapeHtml(s.n)}${n + 1}</span>
            <span class="sec-field-t">${escapeHtml(f.label)}</span>
            <span class="sec-field-dot" aria-label="${filled ? "已填" : "未填"}" role="img"></span>
          </button>
          <span class="sec-ops">
            <button type="button" class="sec-op" data-fld-rename="${escapeHtml(s.id)}" data-key="${escapeHtml(f.key)}"
                    title="改這個子章節的名稱">✎</button>
            <button type="button" class="sec-op sec-op--del" data-fld-del="${escapeHtml(s.id)}" data-key="${escapeHtml(f.key)}"
                    title="刪掉這個子章節（內容一併刪除）">✕</button>
          </span>
        </li>`;
      })
      .join("")}
  </ul>`;
}

function renderOutline() {
  renderFileTree();
  renderDomainBar();
  const el = document.getElementById("outline");
  if (!el) return;
  const list = sections();
  // ADHD：大綱只顯示編號＋標題＋狀態。說明一律走 title tooltip ——
  // 選中時展開第二排會讓整列跳動，而且那段字在右邊的教練欄已經有了。
  el.innerHTML = list
    .map((s, i) => {
      const st = s.status === "done" ? "done" : s.status === "warn" ? "warn" : "empty";
      const label = s.status === "done" ? "完成" : s.status === "warn" ? "待補" : "空白";
      const active = i === idx;
      // **只有選中的那一節展開欄位。** 七節同時攤開＝二十幾個資訊點，
      // 而其中只有一節是你現在在寫的；其餘的展開只是把「我在哪」藏進雜訊裡。
      const kids = active ? outlineFieldsHtml(s) : "";
      return `<div class="sec-group${active ? " active" : ""}">
      <button type="button" class="sec adhd-sec ${active ? "active" : ""}" data-i="${i}" role="option" aria-selected="${active}" aria-expanded="${active}" data-od-id="sec-${s.id}" title="${escapeHtml(s.desc)}">
      <span class="sec-caret" aria-hidden="true">${active ? "▾" : "▸"}</span>
      <span class="n">${s.n}</span>
      <span class="adhd-sec-body"><div class="t">${escapeHtml(s.title)}</div></span>
      <span class="st ${st}">${label}</span>
    </button>${
      // 自訂章節可以刪、但不能改名：它是章節範本的固定落點，改了名字之後
      // 「範本插到哪去了」就沒有答案了
      s.id === CUSTOM_SECTION_ID
        ? `<span class="sec-ops sec-ops--head">
             <button type="button" class="sec-op sec-op--del" data-sec-del="${escapeHtml(s.id)}" title="刪掉整節（內容一併刪除）">✕</button>
           </span>`
        : `<span class="sec-ops sec-ops--head">
             <button type="button" class="sec-op" data-sec-rename="${escapeHtml(s.id)}" title="改編號或標題">✎</button>
             <button type="button" class="sec-op sec-op--del" data-sec-del="${escapeHtml(s.id)}" title="刪掉整節（內容一併刪除）">✕</button>
           </span>`
    }${kids}</div>`;
    })
    .join("");

  el.querySelectorAll(".sec").forEach((btn) => {
    (btn as HTMLButtonElement).onclick = async () => {
      const i = Number((btn as HTMLElement).dataset.i);
      const s = sections()[i];
      if (s && !(await goToSection(s.id))) return;
      idx = i;
      render();
    };
  });

  // 點欄位：捲到那一格並讓游標落進去。只是導覽，不改任何內容。
  // 結構編輯。**改的是這個專案自己的骨架**，不是領域包 —— 改完之後這個專案
  // 就脫離領域包了（store.hasOwnSections()），要回去用「回到領域包骨架」。
  const structOp = (fn: () => { ok: boolean; reason?: string }, okMsg: string) => {
    const r = fn();
    toast(r.ok ? okMsg : (r.reason ?? "改不動"));
    if (r.ok) {
      idx = Math.min(idx, Math.max(0, sections().length - 1));
      render();
    }
  };

  el.querySelectorAll<HTMLButtonElement>("[data-sec-rename]").forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.dataset.secRename!;
      const cur = sections().find((x) => x.id === id);
      if (!cur) return;
      const n = await askText({ title: `章節編號（現在是 ${cur.n}）`, value: cur.n });
      if (n === null) return;
      const title = await askText({ title: `章節標題（現在是 ${cur.title}）`, value: cur.title });
      if (title === null) return;
      structOp(() => store.renameSection(id, { n, title }), "已改章節");
    };
  });

  el.querySelectorAll<HTMLButtonElement>("[data-sec-del]").forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.dataset.secDel!;
      const cur = sections().find((x) => x.id === id);
      if (!cur) return;
      const extra =
        id === CUSTOM_SECTION_ID
          ? "\n\n之後插入章節範本時它會自動回來（範本段落沒有別的落點）。"
          : "";
      if (!(await askConfirm({ title: `刪掉「${cur.n} ${cur.title}」整節？這一節已經寫的內容會一起刪掉。${extra}`, danger: true }))) return;
      structOp(() => store.removeSection(id), "已刪掉整節");
    };
  });

  el.querySelectorAll<HTMLButtonElement>("[data-fld-rename]").forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const sid = btn.dataset.fldRename!;
      const key = btn.dataset.key!;
      const sec = sections().find((x) => x.id === sid);
      const f = sec?.fields.find((x) => x.key === key);
      if (!sec || !f) return;
      const label = await askText({ title: `子章節名稱（現在是 ${numberedFieldLabel(sec, key)}）`, value: f.label });
      if (label === null) return;
      structOp(() => store.renameField(sid, key, label), "已改子章節");
    };
  });

  el.querySelectorAll<HTMLButtonElement>("[data-fld-del]").forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const sid = btn.dataset.fldDel!;
      const key = btn.dataset.key!;
      const sec = sections().find((x) => x.id === sid);
      if (!sec?.fields.find((x) => x.key === key)) return;
      if (!(await askConfirm({ title: `刪掉子章節「${numberedFieldLabel(sec, key)}」？裡面的內容會一起刪掉。`, danger: true }))) return;
      structOp(() => store.removeField(sid, key), "已刪掉子章節");
    };
  });

  el.querySelectorAll<HTMLButtonElement>("[data-field-key]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const key = btn.dataset.fieldKey!;
      const host = document.querySelector<HTMLElement>(`[data-od-id="field-${key}"]`);
      if (!host) return;
      host.scrollIntoView({ block: "center", behavior: "smooth" });
      host.querySelector<HTMLElement>("input, textarea")?.focus();
    };
  });

  const avg = Math.round(
    list.reduce((a, s) => a + liveScore(s, valuesFor(s)), 0) / list.length,
  );
  const pct = document.getElementById("outline-pct");
  if (pct) pct.textContent = `${avg}%`;

  renderOpenSpec();
}

/**
 * OpenSpec 檔案在編輯欄裡就地開啟。
 *
 * 為什麼不叫外部程式：點一個 proposal.md 是為了「看一眼順手改一句」，
 * 跳出去開別的編輯器等於離開現在的情境，回來還要重新找位置。
 *
 * 不自動存檔 —— 這是使用者專案裡的真實檔案，不是 App 自己的資料。
 * PRD 章節可以邊打邊存是因為那是 App 的東西，這裡不是。
 */
let openFile: { path: string; original: string } | null = null;

/**
 * 閱讀模式：把 Markdown 原始碼換成排版後的內容。
 *
 * 大部分時候點開 `proposal.md` 是為了**讀**，不是為了改一個字。等寬字 +
 * 滿版 `|---|---|` 表格 + 一堆反引號，讀起來要自己在腦裡跑一次 Markdown。
 *
 * 狀態放在模組層而不是每個檔各自記：換檔時模式要留著 —— 一路讀下來的人
 * 不該每點一個檔就被丟回原始碼。非 `.md` 的檔不給切（渲染出來會是一坨）。
 */
let fileReadMode = false;

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path);
}

function fileIsDirty(): boolean {
  if (!openFile) return false;
  const ta = document.getElementById("fv-text") as HTMLTextAreaElement | null;
  return Boolean(ta && ta.value !== openFile.original);
}

/** 有未存變更時攔一次。回 true 代表可以繼續。 */
async function confirmLeaveFile(): Promise<boolean> {
  if (!fileIsDirty()) return true;
  return askConfirm({
    title: `「${shortPath(openFile!.path)}」有還沒存的變更，要放棄嗎？`,
    danger: true,
  });
}

async function closeFileView(force = false) {
  if (!force && !(await confirmLeaveFile())) return false;
  openFile = null;
  render();
  return true;
}

/**
 * 切換 PRD 章節的唯一入口。
 *
 * `renderEditor()` 的第一行是 `if (renderFileView()) return;` —— 只要 `openFile`
 * 還在，章節內容就永遠畫不出來。而原本六個 `store.setActiveSection()` 呼叫點
 * 沒有任何一個會清掉它，所以「點過 OpenSpec 的檔案之後再點 PRD 章節，編輯區
 * 一片空白」。修在這裡而不是六個點各補一次：真正的事件是「換章節」，只有一個。
 *
 * 有未存變更時仍會攔一次 —— 換章節跟關檔一樣會讓編輯中的內容離開視野。
 */
async function goToSection(id: string): Promise<boolean> {
  if (openFile) {
    if (!(await confirmLeaveFile())) return false;
    // 直接清掉而不呼叫 closeFileView()：下面的 setActiveSection 會觸發 render，
    // 不需要為了同一次操作畫兩遍。
    openFile = null;
  }
  store.setActiveSection(id);
  return true;
}

/**
 * 換章節但不攔截。⚠️ 無條件清掉 openFile，呼叫前要確定那是你要的。
 *
 * 唯一的呼叫點是模組層級的「插入待處理範本」那一段（render() 之後）。那裡是
 * 初始化時跑一次，`openFile` 必為 null（唯一的賦值點在 openFileInEditor，需要
 * 使用者先開檔），所以實務上它跟 goToSection() 等價、不會少問任何一次。
 *
 * 之所以不直接用 goToSection()：那會讓 async 傳染到模組層級的初始化路徑，
 * 為了一個永遠不會觸發的確認框付出全域代價。
 *
 * 但這個函式本身沒有守門 —— 對任何 openFile 可能非空的呼叫點，用 goToSection()。
 */
function switchSectionForced(id: string) {
  openFile = null;
  store.setActiveSection(id);
}

async function openFileInEditor(path: string) {
  if (!canEditFiles()) {
    toast("在編輯欄開檔需要桌面版 App");
    return;
  }
  if (!(await confirmLeaveFile())) return;
  const label = document.getElementById("sec-label");
  if (label) label.textContent = "讀取中…";
  try {
    const text = await readFile(path);
    openFile = { path, original: text };
    // 換檔要重建，不能被上面的「同一個檔就跳過」擋掉
    document.getElementById("fv-text")?.remove();
    render();
    (document.getElementById("fv-text") as HTMLTextAreaElement | null)?.focus();
  } catch (e) {
    toast(e instanceof Error ? e.message : "讀取失敗");
    render();
  }
}

/**
 * 存檔前把改過的行標成橘色。
 *
 * textarea 沒辦法把部分文字上色，所以用「背板」：一個和 textarea 完全對齊、
 * 字體度量一致的 div 疊在底下畫色塊，textarea 自己的文字保持不透明蓋在上面。
 * 這是唯一不用換成 contenteditable（會壞掉 undo、輸入法、拼字）的做法。
 */
function renderHighlightBackdrop() {
  if (!openFile) return;
  const ta = document.getElementById("fv-text") as HTMLTextAreaElement | null;
  const back = document.getElementById("fv-backdrop");
  if (!ta || !back) return;

  const marks = markChangedLines(openFile.original, ta.value);
  // 編輯層只認 added / modified —— removed 的內容不在 textarea 裡，
  // 畫進來字數就會多於實際文字，游標位置跟畫面對不上。
  const byIndex = new Map(
    marks.filter((m) => m.kind !== "removed").map((m) => [m.index, m]),
  );
  const lines = ta.value.split("\n");

  // 只畫 same + add：兩者串起來剛好等於 textarea 現在的文字，才不會錯位。
  // 被刪掉的字不在 textarea 裡，硬畫進來游標位置就會跟畫面對不上 ——
  // 所以刪除線那一份放在「顯示刪除」的唯讀檢視與滑過的浮層裡。
  back.innerHTML = lines
    .map((ln, i) => {
      const m = byIndex.get(i);
      if (!m) return `<span class="fv-line">${escapeHtml(ln) || "&nbsp;"}</span>`;
      const segs =
        m.kind === "modified" ? visibleSegs(inlineDiff(m.before ?? "", ln)) : [{ text: ln, kind: "add" as const }];
      const inner =
        segs.map((sg) => `<span class="fv-${sg.kind}">${escapeHtml(sg.text)}</span>`).join("") ||
        "&nbsp;";
      return `<span class="fv-line fv-changed" data-fv-line="${i}"
        data-before="${escapeHtml(m.before ?? "")}"
        data-kind="${m.kind}">${inner}</span>`;
    })
    .join("\n");
  back.scrollTop = ta.scrollTop;
  back.scrollLeft = ta.scrollLeft;

  renderDiffPane();

  // 內容變動的唯一漏斗（還原、還原快照、儲存都會走到這）。閱讀模式開著時
  // 順手重畫排版 —— 不然按「還原」之後畫面上還是還原前的內容，而且沒有徵兆。
  const readPane = document.getElementById("fv-read-pane");
  if (readPane && !readPane.hidden) readPane.innerHTML = renderMarkdown(ta.value);

  const state = document.getElementById("fv-state");
  if (state) {
    const n = marks.length;
    state.textContent = n ? `${n} 行未儲存` : "已同步";
    state.className = `fv-state${n ? " is-dirty" : ""}`;
  }
}

/** 片段 → HTML。新增藍字、刪除紅字加刪除線。 */
function segsHtml(segs: readonly Seg[]): string {
  return segs
    .map((sg) => `<span class="fv-${sg.kind}">${escapeHtml(sg.text)}</span>`)
    .join("");
}

/**
 * 對比欄：完整的字級 diff，含被刪掉的字（紅字 + 刪除線）。
 *
 * 為什麼獨立一欄而不是畫在編輯層上：被刪掉的字**不在 textarea 裡**，
 * 畫進編輯層會讓畫面字數多於實際內容，游標位置就跟畫面對不上 ——
 * 你點某個位置，游標會跑到別的地方。所以編輯層只畫「沒動 + 新增」
 * （兩者串起來等於現在的文字），刪除的部分交給這一欄，兩邊捲動同步。
 *
 * 有改動時自動出現，沒改動時自動收起 —— 不必記得去按哪顆按鈕。
 */
function renderDiffPane() {
  if (!openFile) return;
  const host = document.getElementById("fv-review");
  const ta = document.getElementById("fv-text") as HTMLTextAreaElement | null;
  const wrap = document.getElementById("fv-diff-wrap");
  if (!host || !ta || !wrap) return;

  const marks = markChangedLines(openFile.original, ta.value);
  const hidden = wrap.dataset.forceHidden === "1";
  // 對比欄是給編輯用的。閱讀模式下它會從排版內容底下冒出來一整片等寬字 ——
  // 使用者剛按的是「不要看原始碼」。
  const reading = document.getElementById("fv-read-pane")?.hidden === false;
  wrap.hidden = hidden || reading || marks.length === 0;
  if (wrap.hidden) return;

  // removed 沒有對應的「改之後」行，用 index 當插入點掛在那一行之前。
  // 同一個 index 可能有好幾行被刪，所以是陣列不是單一值。
  const removedAt = new Map<number, string[]>();
  const byIndex = new Map<number, LineMark>();
  for (const m of marks) {
    if (m.kind === "removed") {
      const list = removedAt.get(m.index) ?? [];
      list.push(m.before ?? "");
      removedAt.set(m.index, list);
    } else {
      byIndex.set(m.index, m);
    }
  }
  const lines = ta.value.split("\n");

  const rowsHtml: string[] = [];
  const pushRemoved = (at: number) => {
    for (const gone of removedAt.get(at) ?? []) {
      rowsHtml.push(
        `<span class="fv-line fv-changed fv-line-removed"><span class="fv-del">${
          escapeHtml(gone) || "&nbsp;"
        }</span></span>`,
      );
    }
  };

  lines.forEach((ln, i) => {
    pushRemoved(i);
    const m = byIndex.get(i);
    if (!m) {
      rowsHtml.push(`<span class="fv-line">${escapeHtml(ln) || "&nbsp;"}</span>`);
      return;
    }
    const inner =
      m.kind === "modified"
        ? segsHtml(inlineDiff(m.before ?? "", ln))
        : `<span class="fv-add">${escapeHtml(ln) || "&nbsp;"}</span>`;
    rowsHtml.push(`<span class="fv-line fv-changed">${inner || "&nbsp;"}</span>`);
  });
  // 刪在檔案最後面的那幾行，掛在尾端
  pushRemoved(lines.length);

  host.innerHTML = rowsHtml.join("\n");
  host.scrollTop = ta.scrollTop;
}

/** 滑過改動的行 → 顯示改之前 / 改之後與修改人 */
function bindChangeTooltip(host: HTMLElement) {
  let tip: HTMLElement | null = null;
  const hide = () => {
    tip?.remove();
    tip = null;
  };
  host.addEventListener("mouseover", (e) => {
    const line = (e.target as HTMLElement).closest(".fv-changed") as HTMLElement | null;
    if (!line) return;
    hide();
    const kind = line.dataset.kind === "added" ? "新增" : "取代";
    const before = line.dataset.before ?? "";
    tip = document.createElement("div");
    tip.className = "fv-tip";
    tip.innerHTML = `
      <p class="fv-tip-head">${kind} · 尚未儲存</p>
      ${
        before
          ? `<p class="fv-tip-row"><span class="fv-tip-tag old">對比</span><code>${segsHtml(
              inlineDiff(before, line.textContent ?? ""),
            )}</code></p>`
          : `<p class="fv-tip-row"><span class="fv-tip-tag old">對比</span><em>（原本沒有這一行，整行都是新增）</em></p>`
      }
      <p class="fv-tip-who">${escapeHtml(store.get().currentUser?.name ?? "—")}</p>
    `;
    document.body.appendChild(tip);
    const r = line.getBoundingClientRect();
    tip.style.top = `${Math.round(r.bottom + 6)}px`;
    tip.style.left = `${Math.round(Math.min(r.left, window.innerWidth - tip.offsetWidth - 12))}px`;
  });
  host.addEventListener("mouseout", (e) => {
    if (!(e.target as HTMLElement).closest(".fv-changed")) return;
    hide();
  });
  host.addEventListener("scroll", hide, true);

  // 背板現在疊在 textarea 上面，改過的行會吃掉點擊。
  // 點下去要能把游標放進那一行，不然橘色行等於變成不能編輯。
  host.addEventListener("mousedown", (e) => {
    const line = (e.target as HTMLElement).closest(".fv-changed") as HTMLElement | null;
    if (!line) return;
    e.preventDefault();
    const ta = document.getElementById("fv-text") as HTMLTextAreaElement | null;
    if (!ta) return;
    const i = Number(line.dataset.fvLine ?? "0");
    const lines = ta.value.split("\n");
    const start = lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0);
    ta.focus();
    ta.setSelectionRange(start + lines[i].length, start + lines[i].length);
    hide();
  });
}

function snapshotListHtml(path: string): string {
  const snaps = loadSnapshots(path);
  if (!snaps.length) {
    return `<p class="fv-hist-empty">還沒有快照。每次儲存前會自動留一份存檔前的內容。</p>`;
  }
  return `<ul class="fv-hist-list">${snaps
    .map(
      (sn, i) => `<li class="fv-hist-item">
        <div class="fv-hist-meta">
          <strong>${escapeHtml(relativeTime(sn.at))}</strong>
          <span>${escapeHtml(sn.author)} · 改了 ${sn.changed} 行</span>
          <time>${escapeHtml(sn.at.slice(0, 16).replace("T", " "))}</time>
        </div>
        <button type="button" class="btn btn-sm" data-fv-restore="${i}">還原這一版</button>
      </li>`,
    )
    .join("")}</ul>`;
}

function renderFileView(): boolean {
  if (!openFile) return false;
  const label = document.getElementById("sec-label");
  if (label) label.textContent = shortPath(openFile.path);

  const body = document.getElementById("editor-body");
  if (!body) return true;

  // 已經開著同一個檔就什麼都不做。
  // render() 會被 store 的每一次 emit 觸發（自動存檔、追蹤刷新、側欄重繪…），
  // 無條件重建 textarea 等於每次都把使用者正在打的字換回磁碟原文 ——
  // 打一個字就消失，看起來就是「不能編輯」。
  const existing = document.getElementById("fv-text") as HTMLTextAreaElement | null;
  if (existing && existing.dataset.path === openFile.path) return true;

  body.innerHTML = `
    <div class="fv">
      <div class="fv-bar">
        <span class="fv-path mono" title="${escapeHtml(openFile.path)}">${escapeHtml(shortPath(openFile.path))}</span>
        <span class="fv-state" id="fv-state"></span>
        <button type="button" class="btn btn-sm" id="fv-read" aria-pressed="false"
                ${isMarkdownPath(openFile.path) ? "" : "hidden"}>閱讀模式</button>
        <button type="button" class="btn btn-sm" id="fv-hist">版本紀錄</button>
        <button type="button" class="btn btn-sm" id="fv-revert">還原</button>
        <button type="button" class="btn btn-sm btn-primary" id="fv-save">儲存</button>
        <button type="button" class="btn btn-sm btn-ghost" id="fv-close">回章節</button>
      </div>
      <div class="fv-stack">
        <div class="fv-backdrop" id="fv-backdrop" aria-hidden="true"></div>
        <textarea id="fv-text" class="fv-text" spellcheck="false"
                  data-path="${escapeHtml(openFile.path)}"
                  aria-label="${escapeHtml(shortPath(openFile.path))}">${escapeHtml(openFile.original)}</textarea>
      </div>
      <div class="fv-read mdv-prose" id="fv-read-pane" hidden></div>
      <div class="fv-diff-wrap" id="fv-diff-wrap" hidden>
        <p class="fv-diff-head">
          對比 · <span class="fv-add">新增</span> / <span class="fv-del">刪除</span>
          <button type="button" class="btn btn-sm btn-ghost" id="fv-diff-hide">收起</button>
        </p>
        <div class="fv-review" id="fv-review" aria-label="含刪除內容的字級對比"></div>
      </div>
      <div class="fv-hist" id="fv-hist-panel" hidden></div>
      <p class="fv-note" id="fv-note">改過但還沒存的行會標成橘色，滑過去看得到改前／改後與修改人。儲存前會自動留一份快照。</p>
    </div>
  `;

  const ta = document.getElementById("fv-text") as HTMLTextAreaElement;
  const backdrop = document.getElementById("fv-backdrop") as HTMLElement;
  renderHighlightBackdrop();
  bindChangeTooltip(backdrop);

  ta.addEventListener("input", renderHighlightBackdrop);
  // 背板要跟著捲，不然色塊會跟文字錯開
  ta.addEventListener("scroll", () => {
    backdrop.scrollTop = ta.scrollTop;
    backdrop.scrollLeft = ta.scrollLeft;
  });

  const histPanel = document.getElementById("fv-hist-panel") as HTMLElement;
  const refreshHist = () => {
    histPanel.innerHTML = snapshotListHtml(openFile!.path);
    histPanel.querySelectorAll<HTMLButtonElement>("[data-fv-restore]").forEach((b) => {
      b.addEventListener("click", async () => {
        const snaps = loadSnapshots(openFile!.path);
        const sn = snaps[Number(b.dataset.fvRestore)];
        if (!sn) return;
        if (!(await askConfirm({ title: `要把編輯區還原成 ${relativeTime(sn.at)} 的內容嗎？（還原後仍需按儲存才會寫回磁碟）`, danger: true })))
          return;
        ta.value = sn.text;
        renderHighlightBackdrop();
        toast("已還原到編輯區 —— 確認後按儲存");
      });
    });
  };

  const save = async () => {
    if (!openFile) return;
    const changed = changedLineCount(openFile.original, ta.value);
    if (!changed) {
      toast("沒有變更");
      return;
    }
    try {
      // 先留存檔前的內容當快照，再寫入 —— 順序反了就沒有東西可以還原
      pushSnapshot(openFile.path, {
        at: new Date().toISOString(),
        author: store.get().currentUser?.name ?? "—",
        text: openFile.original,
        changed,
      });
      await writeFile(openFile.path, ta.value);
      openFile.original = ta.value;
      renderHighlightBackdrop();
      if (!histPanel.hidden) refreshHist();
      toast(`已儲存 · 改了 ${changed} 行`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "儲存失敗");
    }
  };

  document.getElementById("fv-save")?.addEventListener("click", save);
  document.getElementById("fv-revert")?.addEventListener("click", () => {
    ta.value = openFile!.original;
    renderHighlightBackdrop();
  });
  document.getElementById("fv-close")?.addEventListener("click", () => void closeFileView());
  const diffWrap = document.getElementById("fv-diff-wrap") as HTMLElement;
  const review = document.getElementById("fv-review") as HTMLElement;
  document.getElementById("fv-diff-hide")?.addEventListener("click", () => {
    diffWrap.dataset.forceHidden = "1";
    diffWrap.hidden = true;
  });
  // 兩欄捲動同步，不然行對不上就失去對比的意義
  ta.addEventListener("scroll", () => {
    review.scrollTop = ta.scrollTop;
  });

  document.getElementById("fv-hist")?.addEventListener("click", () => {
    histPanel.hidden = !histPanel.hidden;
    if (!histPanel.hidden) refreshHist();
  });

  // ── 閱讀模式 ────────────────────────────────────────────────────
  // 渲染的是 `ta.value` 而不是 `openFile.original`：還沒存的修改也要看得到，
  // 否則「改完切過去確認排版」會拿到磁碟上的舊內容 —— 而且完全看不出來。
  const stack = body.querySelector(".fv-stack") as HTMLElement;
  const readPane = document.getElementById("fv-read-pane") as HTMLElement;
  const readBtn = document.getElementById("fv-read") as HTMLButtonElement | null;
  const note = document.getElementById("fv-note") as HTMLElement | null;
  const applyReadMode = () => {
    const on = fileReadMode && isMarkdownPath(openFile!.path);
    stack.hidden = on;
    readPane.hidden = !on;
    if (on) readPane.innerHTML = renderMarkdown(ta.value);
    if (readBtn) {
      readBtn.textContent = on ? "原始碼" : "閱讀模式";
      readBtn.setAttribute("aria-pressed", String(on));
      readBtn.classList.toggle("btn-primary", on);
    }
    if (note) {
      note.textContent = on
        ? "閱讀模式顯示排版後的內容（含未儲存的修改）。要改字請切回原始碼。"
        : "改過但還沒存的行會標成橘色，滑過去看得到改前／改後與修改人。儲存前會自動留一份快照。";
    }
    // 對比欄是給編輯看的；閱讀時收起來，切回去再由 renderDiffPane 決定要不要出現
    if (on) diffWrap.hidden = true;
    else renderHighlightBackdrop();
  };
  readBtn?.addEventListener("click", () => {
    fileReadMode = !fileReadMode;
    applyReadMode();
  });
  applyReadMode();
  ta.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save();
    }
  });
  return true;
}

/**
 * 儲存目前這一節的草稿。
 *
 * 取消自動存檔之後這是「內容真正落地」的唯一動作 —— 送審拍的快照、
 * 異動高亮的基準、gate 讀的內容，全部以已儲存的值為準。
 */
function saveCurrentSection(): void {
  const s = sections()[idx];
  if (!s) return;
  if (!store.isSectionDirty(s.id)) {
    toast("沒有需要儲存的變更");
    return;
  }
  store.saveSections(s.id);
  // 存去哪要講清楚 —— 使用者以為「儲存」會產生檔案（2026-08-12 回報）。
  // 內容存在 App 的專案資料裡，落地成檔案是「匯出 MD」的事
  toast(`已儲存「${s.title}」— 存在 App 專案資料裡；要存成檔案用「匯出 MD」`);
  render();
}

/** 儲存所有章節的草稿 */
function saveAllSections(): void {
  const n = store.dirtySectionIds().length;
  if (!n) {
    toast("沒有需要儲存的變更");
    return;
  }
  store.saveSections();
  toast(`已儲存 ${n} 個章節 — 存在 App 專案資料裡；要存成檔案用「匯出 MD」`);
  render();
}

/**
 * 章節欄位的異動高亮 —— 呈現交給共用元件 `diff-summary`，
 * 這裡只負責決定「哪個欄位、跟什麼比、掛在哪」。
 */
function renderFieldDiffs(s: Section): void {
  const saved = savedValuesFor(s);
  const shown = valuesFor(s);
  const body = document.getElementById("editor-body");
  if (!body) return;

  for (const f of s.fields) {
    const host = body.querySelector<HTMLElement>(`[data-od-id="field-${f.key}"]`);
    if (!host) continue;
    const before = saved[f.key] ?? "";
    const after = shown[f.key] ?? "";
    // 插在欄位標題之後 = 編輯器上方。掛在欄位底下時，紅藍字會落在
    // 600px 高的編輯器之下，打字當下完全看不到。
    const fieldHead = host.querySelector(".mdv-field-head, label");
    renderDiffSummary(host, before, after, { after: fieldHead });

    // 標記掛在欄位「標題」旁，不是只掛在底下的摘要。
    // 雙欄 Markdown 編輯器有 600px 以上高，打字時視線在上緣，底下的摘要
    // 整個在畫面外 —— 做了回饋卻看不到，等於沒做。
    host.classList.toggle("is-dirty-field", before !== after);
    const head = host.querySelector<HTMLElement>(".mdv-field-head, label");
    if (head) {
      head.querySelector(".field-dirty-chip")?.remove();
      if (before !== after) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "field-dirty-chip";
        chip.textContent = "未儲存 · 看變更";
        chip.title = "捲到這個欄位的變更摘要";
        chip.addEventListener("click", (e) => {
          e.preventDefault();
          host.querySelector(".field-diff")?.scrollIntoView({ block: "center", behavior: "smooth" });
        });
        head.appendChild(chip);
      }
    }
  }
}

/**
 * 儲存列：dirty 狀態 + 儲存／捨棄。
 *
 * 每次 renderEditor 都重畫（章節內容整段重建），所以自帶存在性守衛沒有意義 ——
 * 直接依當下狀態產生內容即可。
 */
function renderSaveBar(s: Section): void {
  const host = document.getElementById("sec-save-hint");
  if (!host) return;
  const dirty = store.isSectionDirty(s.id);
  const others = store.dirtySectionIds().filter((id) => id !== s.id).length;

  if (!dirty && !others) {
    host.className = "hint adhd-editor-hint";
    host.innerHTML = `已儲存 · <span class="mono">⌘S</span> 儲存 · <span class="mono">⌘↵</span> 下一節`;
    return;
  }

  host.className = "hint adhd-editor-hint sec-save-bar is-dirty";
  host.innerHTML = `
    <span class="sec-save-state">${
      dirty ? "這一節有未儲存的變更" : `其他 ${others} 個章節有未儲存的變更`
    }</span>
    ${others && dirty ? `<span class="sec-save-others">另有 ${others} 節未存</span>` : ""}
    <span class="spacer"></span>
    ${dirty ? `<button type="button" class="btn btn-sm" id="btn-sec-discard">捨棄這一節</button>` : ""}
    ${dirty ? `<button type="button" class="btn btn-sm btn-primary" id="btn-sec-save">儲存</button>` : ""}
    ${others ? `<button type="button" class="btn btn-sm" id="btn-sec-save-all">全部儲存</button>` : ""}
  `;

  document.getElementById("btn-sec-save")?.addEventListener("click", () => saveCurrentSection());
  document.getElementById("btn-sec-save-all")?.addEventListener("click", () => saveAllSections());
  document.getElementById("btn-sec-discard")?.addEventListener("click", async () => {
    if (!(await askConfirm({ title: `捨棄「${s.title}」未儲存的變更？改回上次儲存的內容。`, danger: true }))) return;
    store.discardDrafts(s.id);
    toast("已捨棄未儲存的變更");
    render();
  });
}

function currentEditorMode(): MdPaneMode {
  const mode = store.get().settings.editor?.defaultMode;
  return mode === "write" || mode === "preview" || mode === "split" ? mode : "split";
}

function applyEditorMode(mode: MdPaneMode, persist: boolean): void {
  const body = document.getElementById("editor-body");
  if (body) setAllMdModes(body, mode);
  document.querySelectorAll<HTMLButtonElement>("[data-ed-mode]").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.edMode === mode);
    btn.setAttribute("aria-pressed", btn.dataset.edMode === mode ? "true" : "false");
  });
  if (persist) {
    const cur = store.get().settings.editor;
    store.updateSettings({ editor: { ...cur, defaultMode: mode } });
  }
}

function syncEditorModeTabs(): void {
  applyEditorMode(currentEditorMode(), false);
}

function renderEditor() {
  if (renderFileView()) return;
  const list = sections();
  const s = list[idx];
  if (!s) return;
  const values = valuesFor(s);
  const label = document.getElementById("sec-label");
  if (label) label.textContent = `${s.n} · ${s.title}`;

  const fields = s.fields
    .map((f, i) => {
      const val = values[f.key] ?? "";
      // 編號跟大綱同一套（011、012…）—— 座標在每個顯示點都要長一樣
      const numbered = `${fieldNo(s.n, i)} ${f.label}`;
      if (f.type === "text") {
        return `<div class="field" data-od-id="field-${f.key}">
        <label>${escapeHtml(numbered)}<span>${escapeHtml(f.hint || "")}</span></label>
        <input type="text" data-key="${f.key}" value="${escapeHtml(val)}" />
      </div>`;
      }
      // 長文欄位：MarkaMD 風格雙欄 Markdown 寫作 + 即時預覽
      const rows = Math.max(f.rows || 6, 8);
      return mdFieldHtml({
        key: f.key,
        label: numbered,
        hint: f.hint || "Markdown",
        value: val,
        rows,
        readOnly: !editable(),
      });
    })
    .join("");

  const body = document.getElementById("editor-body");
  if (!body) return;

  unbindMd?.();
  unbindMd = null;

  // 這一節從哪個檔案來、匯出後會落在 OpenSpec 的哪裡
  const srcFile = sourceFileForSection(activeProject(), s.id);
  const exportAt = SECTION_TO_OPENSPEC[s.id] ?? "PRD.md › ## Technical Specifications";
  const originLine = srcFile
    ? `${srcFile} → ${exportAt}`
    : `只存在 Anchorline 內 → ${exportAt}`;

  // 章節導引可摺。空章節「不」展開：那時起手骨架按鈕會出現，
  // 它本身就是「怎麼開始」的答案，再攤開 4 條提示只是要人先讀 6 行才知道按哪個。
  // 寫到一半（有內容但還沒滿）才是真正需要提示的時機。
  const filledLen = Object.values(values).join("").trim().length;
  const guideOpen = filledLen >= 10 && filledLen < 40;

  body.innerHTML = `
    <header class="adhd-sec-header">
      <h3 data-od-id="section-title">${escapeHtml(s.title)}</h3>
      <p class="lead adhd-sec-lead">${escapeHtml(s.desc)}</p>
      <p class="sec-origin-line mono" title="${escapeHtml(originLine)}">${escapeHtml(originLine)}</p>
    </header>
    <details class="adhd-guide" data-od-id="guide" ${guideOpen ? "open" : ""}>
      <summary>本章怎麼寫 <span class="adhd-guide-meta">${s.tips.length} 提示</span></summary>
      <div class="guide">
        ${escapeHtml(s.guide)}
        <ul>${s.tips.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>
      </div>
    </details>
    ${fields}
    <div class="hint adhd-editor-hint" id="sec-save-hint"></div>
  `;

  // 一般 input
  body.querySelectorAll<HTMLInputElement>("input[data-key]").forEach((input) => {
    if (!editable()) {
      input.readOnly = true;
      input.disabled = true;
    }
    input.addEventListener("input", () => {
      if (!editable()) return;
      const key = input.dataset.key!;
      // 寫草稿，不寫已儲存 —— 「已儲存」必須是使用者按過儲存才成立
      store.setSectionDraft(s.id, key, input.value);
      const len = Object.values(valuesFor(s)).join("").length;
      if (len > 80 && s.status === "empty") {
        store.updateSection(s.id, { status: "warn" });
      }
      markActivity();
      renderCoach();
      renderOutline();
      renderProgress(idx, list.length);
      // 只重畫這兩塊，不走 render()：整段重建會把 textarea 換掉，
      // 游標與輸入法組字狀態都會沒。
      renderSaveBar(s);
      renderFieldDiffs(s);
    });
  });

  // MarkaMD 雙欄 textarea
  unbindMd = bindMdField(body, (key, value) => {
    if (!editable()) return;
    store.setSectionDraft(s.id, key, value);
    const len = Object.values(valuesFor(s)).join("").length;
    if (len > 80 && s.status === "empty") {
      store.updateSection(s.id, { status: "warn" });
    }
    markActivity();
    renderCoach();
    renderOutline();
    renderProgress(idx, list.length);
    renderSaveBar(s);
    renderFieldDiffs(s);
  });
  syncEditorModeTabs();

  renderSaveBar(s);
  renderFieldDiffs(s);

  const prev = document.getElementById("btn-prev") as HTMLButtonElement | null;
  const next = document.getElementById("btn-next") as HTMLButtonElement | null;
  if (prev) prev.disabled = idx === 0;
  if (next) next.textContent = idx === list.length - 1 ? "完成" : "下一節";
  renderProgress(idx, list.length);

  // ADHD 寫作輔助：空白章節給起手骨架；游標記錄與中斷復原
  // 起手骨架／AI 生稿／AI 潤色／AI 指令／範本插入 —— 全部寫進**草稿**，
  // 不直接寫已儲存。
  //
  // 兩個理由。一是取消自動存檔之後，「已儲存」必須是使用者明確做過的動作，
  // AI 產出的東西沒有理由跳過這道關。二是先前 AI 走 setSectionField 而手動
  // 輸入走 setSectionDraft，兩層會分岔：畫面顯示舊草稿、已儲存層卻已是 AI
  // 的版本，捨棄草稿會得到自己沒按過儲存的內容。
  //
  // 走草稿還有一個好處：異動高亮會直接把「AI 改了哪幾個字」畫出來。
  ensureStarter(s, values, (key, value) => {
    if (!editable()) return;
    store.setSectionDraft(s.id, key, value);
    store.updateSection(s.id, { status: "warn" });
    render();
  });
  bindResumeTracking(s.id);
  restoreCaret(s.id);

  syncUser();
}

function renderCoach() {
  const s = sections()[idx];
  if (!s) return;
  const values = valuesFor(s);
  const checks = evaluateChecks(s, values);
  const score = liveScore({ ...s, checks }, values);
  const passN = checks.filter((c) => c.pass).length;
  const settings = store.get().settings;

  const gate = evaluatePrdGates(store.get(), store.activeGateSpec());
  const coach = document.getElementById("coach-body");
  if (!coach) return;

  // ADHD：一次只強調「現在補什麼」；其餘收進 details
  const failing = checks.filter((c) => !c.pass);
  const nextCheck = failing[0];
  const scoreLabel = score >= 85 ? "可送審" : score >= 70 ? "接近完成" : "需補強";
  const gateBlocks = gate.findings.filter((f) => f.level === "block");
  // AI 是否就緒屬於設定狀態，不是「你寫錯了」——只放進 summary 行，不搶版面
  const aiReadyNow = getAiReadiness().ok;
  // ADHD R1 迴路反轉：原本 `gateOpen = !gate.canSubmit`，等於「越卡住畫面越吵」。
  // 改成只在快過關時才主動展開細節；卡住時保持安靜，數量留在 summary 行。
  const gateOpen = gate.canSubmit && gate.warns > 0;

  coach.innerHTML = `
    <div class="card adhd-coach-now" data-od-id="next-card">
      <p class="adhd-coach-kicker">現在做這一件</p>
      ${
        nextCheck
          ? `<h4 class="adhd-coach-now-title">補齊：${escapeHtml(nextCheck.label)}</h4>
             <p class="adhd-coach-now-detail">完成後分數與檢查會即時更新。一次只盯這一項。</p>`
          : `<h4 class="adhd-coach-now-title">本章檢查已過</h4>
             <p class="adhd-coach-now-detail">可按「下一節」，或結構 gate 全過後送出審閱。</p>`
      }
      ${
        failing.length > 1
          ? `<p class="adhd-coach-more-count">另外還有 ${failing.length - 1} 項稍後再補</p>`
          : ""
      }
    </div>

    <div class="card adhd-score-card" data-od-id="score-card">
      <div class="adhd-score-row">
        <div class="score-ring adhd-score-ring">
          <div class="ring" style="--p:${score}"><b>${score}</b></div>
        </div>
        <div class="adhd-score-meta">
          <div class="adhd-score-label">${scoreLabel}</div>
          <div class="mono adhd-score-pass">${passN}/${checks.length} 通過</div>
          <span class="pill pill-review adhd-model-pill">${escapeHtml(settings.model)}</span>
        </div>
      </div>
    </div>

    <details class="adhd-coach-details card" data-od-id="checklist-card" ${failing.length === 1 ? "open" : ""}>
      <summary>檢查清單 <span class="adhd-details-meta">${passN}/${checks.length}${failing.length > 1 ? ` · 還有 ${failing.length}` : ""}</span></summary>
      <div class="check-list">
        ${checks
          .map(
            (c) => `
          <label>
            <input type="checkbox" ${c.pass ? "checked" : ""} data-cid="${c.id}" />
            <span>${escapeHtml(c.label)}</span>
          </label>`,
          )
          .join("")}
      </div>
    </details>

    <details class="adhd-coach-details card" data-od-id="prd-gate-card" ${gateOpen ? "open" : ""}>
      <summary>結構 gate <span class="adhd-details-meta">${escapeHtml(gateSummaryLine(gate))}</span></summary>
      <div class="mono adhd-gate-score">score ${gate.score}</div>
      <div class="check-list">
        ${gate.findings
          .map((f) => {
            // 「還沒開始」用中性 ○／muted，不用紅 ✗。等級判定不變，只改視覺。
            const icon = f.untouched ? "○" : f.level === "pass" ? "✔" : f.level === "warn" ? "!" : "✗";
            const color = f.untouched
              ? "var(--muted)"
              : f.level === "pass"
                ? "var(--success)"
                : f.level === "warn"
                  ? "var(--warn)"
                  : "var(--danger)";
            return `<div class="adhd-gate-row${f.untouched ? " is-untouched" : ""}">
              <span style="color:${color}">${icon}</span>
              <span><strong>${escapeHtml(f.label)}</strong>
              <span class="adhd-gate-detail"> — ${escapeHtml(f.untouched ? "還沒開始" : f.detail)}</span></span>
            </div>`;
          })
          .join("")}
      </div>
      ${
        !gate.canSubmit
          ? `<p class="adhd-gate-block">有 BLOCK 項時無法送審${gateBlocks.length ? `（${gateBlocks.length}）` : ""}</p>`
          : `<p class="adhd-gate-ok">可送審</p>`
      }
      <p class="adhd-coach-link"><a href="tracking.html">開啟計劃追蹤 →</a></p>
    </details>

    <details class="adhd-coach-details card adhd-ai-card" data-od-id="ai-tools-card">
      <summary>AI 助教 <span class="adhd-details-meta">${
        aiReadyNow ? escapeHtml(settings.model) : "未設定"
      }</span></summary>
      <p class="adhd-ai-status" id="ai-config-status"></p>
      <div class="adhd-ai-actions">
        <button type="button" class="btn btn-sm btn-accent" id="btn-ai-draft">一鍵生稿</button>
        <button type="button" class="btn btn-sm" id="btn-ai-polish">語調潤色</button>
        <button type="button" class="btn btn-sm" id="btn-ai-deflate" title="拆長句、分段、刪樣板語 —— 不增加任何內容">去 AI 味</button>
        <button type="button" class="btn btn-sm" id="btn-ai-audit">本機＋AI 評估</button>
      </div>
      <div class="adhd-ai-prompt-row">
        <input type="text" id="ai-prompt-input" placeholder="指令，如：依本專案補技術線選型" />
        <button type="button" class="btn btn-sm btn-primary" id="btn-ai-send">送出</button>
      </div>
      <div id="ai-feedback" class="adhd-ai-feedback"></div>
      <p class="adhd-ai-hint"><a href="settings.html">偏好設定 → API Key</a></p>
    </details>

    <details class="adhd-coach-details card" data-od-id="example-card">
      <summary>好例子</summary>
      <div class="example">${escapeHtml(s.example)}</div>
    </details>
  `;

  coach.querySelectorAll<HTMLInputElement>(".check-list input").forEach((cb) => {
    cb.addEventListener("change", () => {
      store.setCheck(s.id, cb.dataset.cid!, cb.checked);
      renderCoach();
      renderOutline();
    });
  });

  const aiReady = getAiReadiness();
  const statusEl = document.getElementById("ai-config-status");
  if (statusEl) {
    if (aiReady.ok) {
      statusEl.innerHTML = `<span class="adhd-ai-ok">已設定 · ${escapeHtml(settings.model)}</span> 生稿／潤色／指令將呼叫真實 API。`;
      statusEl.className = "adhd-ai-status is-ready";
    } else {
      statusEl.innerHTML = `<span class="adhd-ai-bad">未就緒</span> ${escapeHtml(aiReady.reason)}`;
      statusEl.className = "adhd-ai-status is-blocked";
    }
  }

  const setAiBusy = (busy: boolean) => {
    ["btn-ai-draft", "btn-ai-polish", "btn-ai-audit", "btn-ai-send"].forEach((id) => {
      const b = document.getElementById(id) as HTMLButtonElement | null;
      if (b) b.disabled = busy || (!editable() && id !== "btn-ai-audit");
    });
  };

  const showAiError = (feedbackEl: HTMLElement | null, err: unknown) => {
    const msg = err instanceof AiError || err instanceof Error ? err.message : String(err);
    if (feedbackEl) {
      feedbackEl.innerHTML = `<div class="adhd-ai-err">${escapeHtml(msg)}</div>`;
    }
    toast(msg);
  };

  // 一鍵生稿 — 真實 API only
  document.getElementById("btn-ai-draft")?.addEventListener("click", async () => {
    if (!editable()) {
      toast("目前身分無法編輯內文");
      return;
    }
    if (!isAiConfigured()) {
      toast(getAiReadiness().ok ? "AI 未就緒" : (getAiReadiness() as { reason: string }).reason);
      return;
    }
    const feedbackEl = document.getElementById("ai-feedback");
    if (feedbackEl)
      feedbackEl.innerHTML = `<span class="adhd-ai-busy">正在呼叫 ${escapeHtml(settings.model)} 生稿《${escapeHtml(s.title)}》…</span>`;
    setAiBusy(true);
    try {
      const draft = await generateAIDraft(s, valuesFor(s));
      for (const key in draft) {
        store.setSectionDraft(s.id, key, draft[key]!);
      }
      toast("AI 生稿已套用");
      if (feedbackEl)
        feedbackEl.innerHTML = `<div class="adhd-ai-ok-msg">已更新欄位：${escapeHtml(Object.keys(draft).join("、"))}</div>`;
      renderEditor();
      renderOutline();
      renderCoach();
    } catch (e) {
      showAiError(feedbackEl, e);
    } finally {
      setAiBusy(false);
    }
  });

  // 語調潤色與去 AI 味 — 同一條迴圈，差別只在 mode
  const polishSection = async (mode: "concise" | "executive" | "technical" | "deflate") => {
    if (!editable()) {
      toast("目前身分無法編輯內文");
      return;
    }
    if (!isAiConfigured()) {
      const r = getAiReadiness();
      toast(r.ok ? "AI 未就緒" : r.reason);
      return;
    }
    const verb = mode === "deflate" ? "去 AI 味" : "潤色";
    const feedbackEl = document.getElementById("ai-feedback");
    if (feedbackEl)
      feedbackEl.innerHTML = `<span class="adhd-ai-busy">正在呼叫 ${escapeHtml(settings.model)} ${verb}…</span>`;
    setAiBusy(true);
    try {
      const current = valuesFor(s);
      let n = 0;
      for (const key of Object.keys(current)) {
        const v = current[key];
        if (!v?.trim()) continue;
        const polished = await polishTextWithAI(v, mode, {
          sectionTitle: s.title,
          fieldLabel: s.fields.find((f) => f.key === key)?.label,
        });
        store.setSectionDraft(s.id, key, polished);
        n++;
      }
      if (!n) {
        toast(`本章沒有可${verb}的內容`);
        if (feedbackEl) feedbackEl.innerHTML = `<div class="adhd-ai-err">請先撰寫內容再${verb}</div>`;
      } else {
        toast(`已${verb} ${n} 個欄位`);
        if (feedbackEl)
          feedbackEl.innerHTML = `<div class="adhd-ai-ok-msg">已用 ${escapeHtml(settings.model)} ${verb} ${n} 欄 —— 結果在草稿，儲存才算數</div>`;
        renderEditor();
        renderOutline();
        renderCoach();
      }
    } catch (e) {
      showAiError(feedbackEl, e);
    } finally {
      setAiBusy(false);
    }
  };
  document.getElementById("btn-ai-polish")?.addEventListener("click", () => {
    void polishSection(
      settings.persona === "concise" ? "concise" : settings.persona === "technical" ? "technical" : "executive",
    );
  });
  // 去 AI 味：只拆長句、分段、刪空話 —— 不加任何內容。給「AI 寫完之後救可讀性」用
  document.getElementById("btn-ai-deflate")?.addEventListener("click", () => void polishSection("deflate"));

  // 評估：本機規則一定跑；有 Key 再加深 AI
  document.getElementById("btn-ai-audit")?.addEventListener("click", async () => {
    const feedbackEl = document.getElementById("ai-feedback");
    if (feedbackEl)
      feedbackEl.innerHTML = `<span class="adhd-ai-busy">${isAiConfigured() ? "本機規則 + AI 評估中…" : "本機規則檢查中…"}</span>`;
    setAiBusy(true);
    try {
      const critique = await critiqueSectionWithAI(s, valuesFor(s), settings, store.activeGateSpec());
      if (feedbackEl) {
        feedbackEl.innerHTML = `
          <div class="adhd-ai-critique">
            <strong>${escapeHtml(critique.summary)}</strong>
            <div class="adhd-ai-score">分數 ${critique.score} · ${critique.grade}${critique.localOnly ? " · 僅本機" : ""}</div>
            <ul>
              ${critique.warnings.map((w) => `<li class="w">${escapeHtml(w)}</li>`).join("")}
              ${critique.suggestions.map((sg) => `<li class="s">${escapeHtml(sg)}</li>`).join("")}
            </ul>
          </div>
        `;
      }
    } catch (e) {
      showAiError(feedbackEl, e);
    } finally {
      setAiBusy(false);
    }
  });

  // 自訂指令 — 真實 API only
  document.getElementById("btn-ai-send")?.addEventListener("click", async () => {
    if (!editable()) {
      toast("目前身分無法編輯內文");
      return;
    }
    if (!isAiConfigured()) {
      const r = getAiReadiness();
      toast(r.ok ? "AI 未就緒" : r.reason);
      return;
    }
    const input = document.getElementById("ai-prompt-input") as HTMLInputElement | null;
    const promptText = input?.value.trim();
    if (!promptText) {
      toast("請先輸入提問或指令");
      return;
    }
    const feedbackEl = document.getElementById("ai-feedback");
    if (feedbackEl)
      feedbackEl.innerHTML = `<span class="adhd-ai-busy">處理指令：「${escapeHtml(promptText)}」…</span>`;
    setAiBusy(true);
    try {
      const patch = await generateAIDraft(s, valuesFor(s), promptText);
      for (const key in patch) {
        store.setSectionDraft(s.id, key, patch[key]!);
      }
      toast("AI 已依指令更新內容");
      if (input) input.value = "";
      if (feedbackEl)
        feedbackEl.innerHTML = `<div class="adhd-ai-ok-msg">已更新：${escapeHtml(Object.keys(patch).join("、"))}</div>`;
      renderEditor();
      renderOutline();
      renderCoach();
    } catch (e) {
      showAiError(feedbackEl, e);
    } finally {
      setAiBusy(false);
    }
  });

  // 未設定 Key：生稿／潤色／指令禁用；評估仍可用（本機）
  if (!isAiConfigured()) {
    ["btn-ai-draft", "btn-ai-polish", "btn-ai-send"].forEach((id) => {
      const b = document.getElementById(id) as HTMLButtonElement | null;
      if (b) {
        b.disabled = true;
        b.title = "請先在偏好設定填入 API Key";
      }
    });
    const inp = document.getElementById("ai-prompt-input") as HTMLInputElement | null;
    if (inp) {
      inp.disabled = true;
      inp.placeholder = "需先設定 API Key";
    }
  }

  if (!editable()) {
    coach.querySelectorAll("button, input").forEach((el) => {
      if ((el as HTMLElement).id === "btn-ai-audit") return;
      (el as HTMLButtonElement).disabled = true;
    });
  }
}

function sectionFilled(sectionId: string): boolean {
  const vals = store.get().sectionValues[sectionId] ?? {};
  return Object.values(vals).some((v) => String(v).trim().length > 0);
}

function renderBeginnerCoach() {
  const params = new URLSearchParams(location.search);
  if (params.get("beginner") === "1") setBeginnerMode(true);
  if (!isBeginnerMode()) {
    document.getElementById("beginner-coach")?.remove();
    return;
  }

  let bar = document.getElementById("beginner-coach");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "beginner-coach";
    bar.className = "beginner-coach";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "PRD 新手教練");
    const host = document.getElementById("flow-strip-host");
    const toolbar = document.querySelector(".toolbar");
    if (host) host.insertAdjacentElement("afterend", bar);
    else toolbar?.insertAdjacentElement("afterend", bar);
  }

  const activeId = store.get().activeSectionId;
  const track = EDITOR_BEGINNER_TRACK;
  const doneCount = track.filter((t) => sectionFilled(t.sectionId)).length;
  const next = track.find((t) => !sectionFilled(t.sectionId));

  bar.innerHTML = `
    <div class="beginner-coach-head">
      <strong>🌱 新手教練</strong>
      <span class="mono">${doneCount}/${track.length} 核心章節已有內容</span>
      <button type="button" class="btn btn-sm btn-ghost" id="btn-beginner-dismiss">結束教練</button>
    </div>
    <div class="beginner-coach-track">
      ${track
        .map((t) => {
          const done = sectionFilled(t.sectionId);
          const on = t.sectionId === activeId;
          return `<button type="button" class="beginner-step ${done ? "done" : ""} ${on ? "on" : ""}" data-sec="${escapeHtml(t.sectionId)}" title="${escapeHtml(t.hint)}">
            <span class="beginner-step-mark">${done ? "✓" : "·"}</span>
            <span>${escapeHtml(t.label)}</span>
          </button>`;
        })
        .join("")}
    </div>
    <p class="beginner-coach-hint">
      ${
        next
          ? `下一步：補齊「<strong>${escapeHtml(next.label)}</strong>」— ${escapeHtml(next.hint)}`
          : "核心骨架已齊，可補使用者故事／開放問題，通過結構 gate 後送審。"
      }
    </p>
  `;

  bar.querySelectorAll("[data-sec]").forEach((btn) => {
    (btn as HTMLButtonElement).onclick = async () => {
      const id = (btn as HTMLElement).dataset.sec!;
      const i = sections().findIndex((s) => s.id === id);
      if (i >= 0) {
        if (!(await goToSection(id))) return;
        idx = i;
        render();
      }
    };
  });
  document.getElementById("btn-beginner-dismiss")?.addEventListener("click", () => {
    setBeginnerMode(false);
    bar?.remove();
    toast("已關閉新手教練");
  });
}

function render() {
  // restore idx from active section
  const activeId = store.get().activeSectionId;
  const found = sections().findIndex((s) => s.id === activeId);
  if (found >= 0) idx = found;
  const sectionChanged = prevIdx >= 0 && prevIdx !== idx;
  syncProjectChrome();
  renderOutline();
  renderEditor();
  renderCoach();
  renderBeginnerCoach();
  syncUser();
  const host = document.getElementById("flow-strip-host");
  if (host) {
    const hasPlanSteps = Object.values(planModules).some((raw) => /^- \[[ xXvV]\]/m.test(raw));
    host.innerHTML = renderFlowStripHtml(deriveFlowLayers(store.get(), { hasPlanSteps, gateSpec: store.activeGateSpec() }));
  }

  // Phase A：章節切換視線錨定；送審就緒單次 pulse
  if (sectionChanged) {
    const head = document.querySelector(".adhd-sec-header") ?? document.getElementById("editor-body");
    flashFocus(head);
    flashFocus(document.querySelector(".adhd-coach-now"));
  }
  prevIdx = idx;

  const gate = evaluatePrdGates(store.get(), store.activeGateSpec());
  const submitBtn = document.getElementById("btn-submit");
  pulseSubmitWhenBecameReady(submitBtn, gate.canSubmit && editable());
  syncMotionPreferenceClass();
}

// 範本段落一律進最後一章「XX 自訂章節」，不進「當下開著的那一章」——
// 後者會讓同一份範本每次落在不同地方，事後沒人找得到。
const pending = store.consumePendingInsert();
if (pending && editable()) {
  // 這一節可能被刪掉了。範本段落沒有別的家，所以插入時把它放回來 ——
  // 退回「當下開著的那一章」等於讓同一份範本每次落在不同地方
  if (!sections().some((x) => x.id === CUSTOM_SECTION_ID)) store.restoreCustomSection();
  const s = sections().find((x) => x.id === CUSTOM_SECTION_ID) ?? sections()[idx] ?? sections()[0];
  if (s?.fields[0]) {
    const cur = valuesFor(s)[s.fields[0].key] ?? "";
    const next = cur ? `${cur}\n\n${pending}` : pending;
    store.setSectionDraft(s.id, s.fields[0].key, next);
    if (s.status === "empty") store.updateSection(s.id, { status: "warn" });
    switchSectionForced(s.id);
    toast(`已插入到「${s.n} ${s.title}」`);
  }
} else if (pending && !editable()) {
  toast("目前身分無法插入範本到內文");
}

document.getElementById("domain-select")?.addEventListener("change", async (e) => {
  const next = (e.target as HTMLSelectElement).value;
  const st = store.get();
  if (!editable() || !st.activeProjectId) return;
  const r = store.setProjectDomain(st.activeProjectId, next);
  if (!r.ok) {
    toast(r.reason ?? "換領域失敗");
    return;
  }
  // 章節集合換了，目前游標可能指到已經不存在的一節
  idx = 0;
  const first = sections()[0];
  // 換領域等於整組章節換掉，開著的檔案檢視必須讓位
  if (first) await goToSection(first.id);
  const orphans = store.orphanSectionIds().length;
  toast(orphans ? `已換領域 — ${orphans} 個章節的內容暫時收起，沒有刪除` : "已換領域");
  render();
});

document.getElementById("btn-prev")?.addEventListener("click", async () => {
  if (idx > 0) {
    if (!(await goToSection(sections()[idx - 1]!.id))) return;
    idx--;
    render();
  }
});

document.getElementById("btn-next")?.addEventListener("click", async () => {
  const list = sections();
  if (idx < list.length - 1) {
    if (!(await goToSection(list[idx + 1]!.id))) return;
    idx++;
    render();
  } else {
    toast("所有章節已走完 — 可送出審閱");
  }
});

document.getElementById("btn-submit")?.addEventListener("click", async () => {
  if (!editable()) {
    toast("目前身分無法送出編輯成果");
    return;
  }
  // 未儲存的變更一律先擋 —— 送審拍的是「已儲存的內容」的快照。
  // 讓一份「跟作者螢幕上看到的不一樣」的版本送出去，是最難察覺也最貴的錯誤：
  // 審閱者核准的東西跟作者以為送出的東西不同，而兩邊都不會發現。
  const dirty = store.dirtySectionIds().length;
  if (dirty) {
    if (!(await askConfirm({ title: `還有 ${dirty} 個章節未儲存。要先全部儲存再送審嗎？` }))) {
      toast("已取消送審 —— 未儲存的內容不會被包含進去");
      return;
    }
    store.saveSections();
    render();
  }

  const gate = evaluatePrdGates(store.get(), store.activeGateSpec());
  if (!gate.canSubmit) {
    toast(gateSummaryLine(gate) + " — 請先補齊 BLOCK 項");
    renderCoach();
    return;
  }

  // 送審 = commit：對整份 PRD 拍快照。審閱者看的是這一份，
  // 不是「送審之後又被改過的當下內容」。
  const commit = store.commitForReview("");
  if (!commit.ok) {
    toast(commit.reason ?? "無法送審");
    return;
  }

  // 把這一份 commit 綁進個案 —— 審閱者看的、核准合併的都必須是它
  store.submitForReview(undefined, commit.version!.id);
  const base = store.prdBaseline();
  const changed = base ? changedFieldCount(base.docs, commit.version!.docs) : null;
  toast(
    changed === null
      ? "已送出審閱 —— 這是第一個版本"
      : `已送出審閱 —— 這一版改了 ${changed} 個欄位`,
  );
  window.setTimeout(() => {
    location.href = "review.html";
  }, 800);
});

document.querySelectorAll<HTMLButtonElement>("[data-ed-mode]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.edMode;
    if (mode === "write" || mode === "preview" || mode === "split") {
      applyEditorMode(mode, true);
    }
  });
});

document.getElementById("btn-outline")?.addEventListener("click", () => {
  toast("大綱已在左側固定顯示");
});

document.getElementById("btn-export-md")?.addEventListener("click", () => {
  // toast 交給 export 的唯一出口（deliver）—— 它知道檔案真正去了哪，
  // 在這裡再喊「已下載」會蓋掉那句有路徑的
  exportMarkdownFile(store.get());
});

document.getElementById("btn-toggle-samples")?.addEventListener("click", () => {
  const next = !store.get().showSamples;
  store.setShowSamples(next);
  toast(next ? "已展示範例內文" : "已清空範例內文");
  render();
});

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    document.getElementById("btn-next")?.click();
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    // 以前這裡只是 toast 一句「已儲存」—— 因為當時本來就即時存檔，
    // 這顆快捷鍵是純安慰劑。現在它真的會存。
    saveCurrentSection();
  }
});

// Phase B：教練 / 章節指南 details 展開淡入（動態重建，用委派）
document.getElementById("coach-body")?.addEventListener(
  "toggle",
  (e) => {
    const t = e.target;
    if (!(t instanceof HTMLDetailsElement) || !t.open) return;
    expandEnter(t.querySelector(":scope > :not(summary)") ?? t);
  },
  true,
);
document.getElementById("editor-body")?.addEventListener(
  "toggle",
  (e) => {
    const t = e.target;
    if (!(t instanceof HTMLDetailsElement) || !t.open) return;
    expandEnter(t.querySelector(":scope > :not(summary)") ?? t);
  },
  true,
);

// ⌥F 快捷鍵與狀態還原；同步執行，不能靠 rAF（分頁在背景時 rAF 不觸發）
initFileTreeCollapse();
initFileTreeResize();
initCollapsible("btn-openspec-toggle", "openspec-list", "anchorline:openspec-collapsed", "OpenSpec 章節");
initFocusMode();
initHyperfocusGuard();
render();
// 綁定資料夾後檔案樹要立刻長出來；簽章比對讓打字時的 emit 不會觸發重繪
store.subscribe(renderFileTree);
} // end __authed
