/**
 * OpenSpec 工作區 —— 從編輯工作台拆出來的獨立頁面（方案 B）。
 *
 * ## 為什麼要拆
 *
 * 編輯工作台原本一欄塞六件事（PRD 章節大綱、領域選單、孤兒內容、OpenSpec 檔案
 * 清單、Function wish list、專案檔案樹），中欄還要在「PRD 章節表單」與「原始
 * 檔案內容」之間切換 —— 靠一個 module 變數 `openFile` 是不是 null 決定畫哪一種。
 * 右欄的寫作教練是 PRD 專用，看 OpenSpec 檔案時完全不相關。
 *
 * 拆開之後兩邊各自只回答一個問題：編輯台管 PRD，這一頁管 spec。
 *
 * ## 這一頁的三欄
 *
 * - 左：change 選單（active／archived）→ 該 change 的檔案 → Function wish list
 *   → 專案檔案樹
 * - 中：原始檔案檢視／編輯（唯一真正從 editor.ts 搬過來的邏輯）
 * - 右：任務進度（`plan-parser` 讀 tasks.md）、`openspec status` 的判讀、健康狀態
 *
 * ## 刻意重用而不重寫的東西
 *
 * 分群（`groupOpenspecFiles`）、checklist 掃描（`requestTrackingScan` +
 * `parsePlanMeta` + `planProgress`）、CLI JSON 判讀（`openspec-status.ts`）
 * 全部是既有的純函式，這裡只負責畫出來與接點擊。在這一頁自己數一次進度，
 * 是「兩個地方說反話」最經典的來源。
 */
import { askConfirm } from "../lib/ask";
import { store } from "../data/store";
import type { Project } from "../data/types";
import { projectDisplayName } from "../data/types";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import { syncRailContext } from "../lib/rail-projects";
import { canEditContent } from "../lib/permissions";
import { buildFileTree, renderFileTreeHtml } from "../lib/file-tree";
import {
  absolutePathFor,
  groupOpenspecFiles,
  openspecFiles,
  type OsGroup,
} from "../lib/openspec-tree";
import { canEditFiles, readFile, shortPath, writeFile } from "../lib/file-editor";
import {
  addWish,
  emptyWishlist,
  parseWishKind,
  parseWishlist,
  removeWish,
  serializeWishlist,
  takeWishId,
  updateWish,
  writeWishHandoff,
  wishlistLsKey,
  wishlistPath,
  WISH_KIND_LABEL,
  WISH_KINDS,
  type WishKind,
  type WishlistDoc,
  type WishlistItem,
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
import { renderMarkdown } from "../lib/markamd/markdown";
import { initHelpOverlay } from "../lib/help-overlay";
import { askForProjectFolder } from "../lib/project-folder";
import { parsePlanMeta, planProgress, type PlanMeta } from "../lib/plan-parser";
import { openspecRootsOf, requestTrackingScan } from "../lib/tracking-bridge";
import {
  nextArtifact,
  parseOpenspecList,
  parseOpenspecStatus,
  type OpenspecChange,
  type OpenspecListEntry,
} from "../lib/openspec-status";
import { initTheme } from "../lib/theme";
import { escapeHtml, initMobileNav, toast, updateUserRailFooter } from "../lib/ui";

const __authed = requireAuth();
if (__authed) {
initTheme();
initMobileNav("openspec-workspace");
bindLogout();
initHelpOverlay();

// ── 專案 ──────────────────────────────────────────────────────────────

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

function syncProjectChrome() {
  const p = activeProject();
  const name = p ? projectDisplayName(p) : "未選擇專案";
  const meta =
    (p?.sourceFolder && p.sourceFolder.trim()) || (p?.tag && p.tag.trim()) || (p?.id ?? "—");

  syncRailContext({
    mode: "OpenSpec 工作區",
    projectName: name,
    statusLabel: currentChangeId() || "無 change",
    statusTone: "review",
    meta: p ? meta : undefined,
  });

  const h1 = document.querySelector<HTMLElement>('[data-od-id="page-title"], .toolbar h1');
  if (h1) h1.textContent = name;

  const sub = document.querySelector<HTMLElement>('[data-od-id="page-sub"], .toolbar .sub');
  if (sub) {
    const id = currentChangeId();
    sub.textContent = !p
      ? "回總覽選一個專案"
      : id
        ? `${meta} · ${id}`
        : `${meta} · 這個專案還沒有 openspec/ 內容`;
  }

  document.title = `${name} · OpenSpec · Anchorline`;
}

function syncUser() {
  const u = store.get().currentUser;
  updateUserRailFooter(toRailUser(u));
  const banner = document.getElementById("perm-banner");
  if (!banner) return;
  if (!canEditFiles()) {
    banner.hidden = false;
    banner.textContent =
      "瀏覽器版看得到清單，但改不了檔案 —— 讀寫使用者專案裡的真實檔案需要桌面版 App。";
  } else if (!canEditContent(u)) {
    banner.hidden = false;
    banner.textContent = "目前身分為核准人員：可檢視，不可編輯內文。";
  } else {
    banner.hidden = true;
  }
}

// ── change 清單 ───────────────────────────────────────────────────────

/**
 * 一個 change 就是左欄選單上的一列。
 *
 * `groupOpenspecFiles` 已經以 change 為單位分好群（`archive/` 前綴代表已封存），
 * 這裡只是把它的輸出轉成畫面要的形狀 —— 不重新解析路徑。再寫一次 `parts[1]`
 * 那段就是製造第二份會跟本體分岔的實作。
 */
type ChangeEntry = {
  id: string;
  label: string;
  archived: boolean;
  group: OsGroup;
};

function osGroups(): OsGroup[] {
  const p = activeProject();
  const all = p?.importSummary?.allPaths ?? [];
  return groupOpenspecFiles(openspecFiles(all));
}

function changeEntries(groups: OsGroup[]): ChangeEntry[] {
  return groups
    .filter((g) => g.kind === "change")
    .map((g) => {
      const archived = g.label.startsWith("archive/");
      return {
        id: archived ? g.label.slice("archive/".length) : g.label,
        label: g.label,
        archived,
        group: g,
      };
    });
}

/** root（`openspec/` 直屬）與 `specs/*` —— 不屬於任何 change，但也不能消失 */
function otherGroups(groups: OsGroup[]): OsGroup[] {
  return groups.filter((g) => g.kind !== "change");
}

/**
 * 目前選的 change。
 *
 * store 記的那個可能已經不存在（改了名、封存了、換了專案），所以每次都要
 * 對現有清單驗一次再用 —— 直接信任 store 會讓左欄選不中任何一列，
 * 而中欄與右欄都靠它取資料，症狀是「整頁空白但沒有錯誤」。
 */
function currentChangeId(): string {
  const entries = changeEntries(osGroups());
  if (!entries.length) return "";
  const want = store.get().activeOpenSpecChange;
  if (want && entries.some((e) => e.id === want)) return want;
  return (entries.find((e) => !e.archived) ?? entries[0]!).id;
}

function currentEntry(): ChangeEntry | null {
  const id = currentChangeId();
  return changeEntries(osGroups()).find((e) => e.id === id) ?? null;
}

/**
 * 換 change 前要先把中欄開著的檔收掉。
 *
 * 中欄的 `openFile` 綁的是「某個 change 底下的某個檔」。只換 change 不動
 * `openFile`，編輯器會留在舊 change 的檔案上帶著未存的變更 —— 使用者看到的
 * 是新 change，改的卻是舊檔。`openFileInEditor` 已經有這道守門，這裡漏掉
 * 就等於留了一條繞過去的路：左欄點一下就跳過提示。
 */
async function selectChange(id: string) {
  if (id === store.get().activeOpenSpecChange) return;
  // 選「不放棄」就整個不換 —— 半換（換了 change 卻留著舊檔）比不換更糟
  if (openFile && !(await closeFileView())) return;
  store.setActiveOpenSpecChange(id);
  // 換 change 等於換一整組檔案，右欄的資料要跟著重取
  void refreshSideData();
  render();
}

function renderChanges() {
  const host = document.getElementById("osw-changes");
  if (!host) return;
  const p = activeProject();
  const entries = changeEntries(osGroups());
  const cur = currentChangeId();

  const countEl = document.getElementById("osw-change-count");
  if (countEl) countEl.textContent = entries.length ? `${entries.length}` : "—";

  if (!p) {
    host.innerHTML = `<p class="os-empty">還沒有選擇專案。</p>`;
    return;
  }
  if (!p.importSummary?.allPaths?.length) {
    host.innerHTML = `<p class="os-empty">這份 PRD 還沒有對應的資料夾，掃不到 <code>openspec/</code>。</p>`;
    return;
  }
  if (!entries.length) {
    host.innerHTML = `<p class="os-empty">還沒有任何 change。用右上角「開新 change」建一個。</p>`;
    return;
  }

  const active = entries.filter((e) => !e.archived);
  const archived = entries.filter((e) => e.archived);

  const rowsFor = (list: ChangeEntry[]) =>
    list
      .map(
        (e) => `<button type="button" class="osw-change${e.id === cur ? " on" : ""}"
            role="option" aria-selected="${e.id === cur}"
            data-osw-change="${escapeHtml(e.id)}" title="${escapeHtml(e.label)}">
          <span class="osw-change-name">${escapeHtml(e.id)}</span>
          <span class="osw-change-n">${e.group.rows.length}</span>
        </button>`,
      )
      .join("");

  host.innerHTML = `
    ${active.length ? `<p class="os-group os-group--change">Active<span>${active.length}</span></p>${rowsFor(active)}` : ""}
    ${archived.length ? `<p class="os-group">Archived<span>${archived.length}</span></p>${rowsFor(archived)}` : ""}
  `;

  host.querySelectorAll<HTMLButtonElement>("[data-osw-change]").forEach((btn) => {
    btn.onclick = () => void selectChange(btn.dataset.oswChange ?? "");
  });
}

/**
 * 選中 change 的檔案清單。
 *
 * 分群與排序沿用 `groupOpenspecFiles`（proposal 先於 tasks 是有意義的順序，
 * 不是字母序），這裡只挑出屬於這個 change 的那一群。
 */
function renderChangeFiles() {
  const el = document.getElementById("os-files");
  if (!el) return;
  const p = activeProject();
  const root = p?.importSummary?.rootPath ?? "";
  const entry = currentEntry();
  const openPath = openFile?.path ?? "";

  const countEl = document.getElementById("os-count");
  if (countEl) countEl.textContent = entry ? `${entry.group.rows.length} 檔` : "無";

  if (!entry) {
    el.innerHTML = `<p class="os-empty">選一個 change，它的 proposal／tasks／design／specs 會列在這裡。</p>`;
    return;
  }

  el.innerHTML = entry.group.rows
    .map((r) => {
      const abs = absolutePathFor(root, r.rel);
      return `<button type="button" class="os-row os-file-row${abs === openPath ? " is-open" : ""}"
          data-os-path="${escapeHtml(abs)}"
          title="開啟 ${escapeHtml(r.rel)}">
        <span class="os-dot done"></span>
        <span class="os-body">
          <span class="os-head">${escapeHtml(r.name)}</span>
          <span class="os-file">${escapeHtml(r.sub || entry.label)}</span>
        </span>
      </button>`;
    })
    .join("");

  el.querySelectorAll<HTMLButtonElement>("[data-os-path]").forEach((btn) => {
    btn.onclick = () => {
      void openFileInEditor(btn.dataset.osPath ?? "");
    };
  });
}

/** `openspec/` 直屬與 `specs/*`：不屬於任何 change，但仍然要開得到 */
function renderOtherGroups() {
  const el = document.getElementById("osw-other-groups");
  if (!el) return;
  const p = activeProject();
  const root = p?.importSummary?.rootPath ?? "";
  const groups = otherGroups(osGroups());
  if (!groups.length) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = groups
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

// ── 專案檔案樹 ────────────────────────────────────────────────────────

/**
 * 用簽章擋掉不必要的重繪：store 每次 emit 都會叫到這裡，無條件重建會清掉
 * 使用者的展開與捲動狀態。
 */
let lastTreeSig = "__init__";

function renderFileTree() {
  const host = document.getElementById("file-tree");
  if (!host) return;
  const p = activeProject();
  // 簽章要含路徑本身，不能只算數量 —— 同數量的重新掃描（換了一個檔）
  // 用 length 比不出差異，樹會停在舊的清單上，點下去的檔案早就不是那個了。
  const sig = `${p?.id ?? ""}|${p?.sourceFolder ?? ""}|${
    p?.importSummary?.allPaths?.join(",") ?? ""
  }|${openFile?.path ?? ""}`;
  if (sig === lastTreeSig) return;
  lastTreeSig = sig;
  const tree = p ? buildFileTree(p, store.get().sections) : null;
  host.innerHTML = renderFileTreeHtml(tree, "");

  // 空狀態的出口：手動新建的 PRD 也能在這裡補綁資料夾
  const bindBtn = document.getElementById("ft-bind-folder");
  if (bindBtn && p) {
    bindBtn.addEventListener("click", () => askForProjectFolder(p.id, projectDisplayName(p)));
  }

  // 在這一頁，點檔案樹的檔案是「在中欄打開它」——不是跳到某個 PRD 章節
  // （那是編輯台的語意，這一頁沒有章節可跳）。
  const root = p?.importSummary?.rootPath ?? "";
  host.querySelectorAll<HTMLElement>("[data-ft-path]").forEach((node) => {
    node.addEventListener("click", () => {
      void openFileInEditor(absolutePathFor(root, node.dataset.ftPath ?? ""));
    });
  });

  host.querySelectorAll<HTMLButtonElement>("[data-ft-dir]").forEach((btn) => {
    btn.onclick = () => {
      const open = btn.getAttribute("aria-expanded") !== "false";
      btn.setAttribute("aria-expanded", open ? "false" : "true");
      btn.parentElement?.classList.toggle("is-collapsed", open);
    };
  });
}

/** 可收合區塊。狀態各自記在 localStorage —— 每次進來都要重收一次是懲罰。 */
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

function initFileTreeResize() {
  const col = document.querySelector('[data-od-id="osw-left-col"]') as HTMLElement | null;
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
  const max = () => Math.max(MIN, col.clientHeight - 180);

  const onMove = (e: PointerEvent) => {
    apply(Math.min(max(), Math.max(MIN, startH - (e.clientY - startY))));
  };
  const onUp = () => {
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
      /* 沒有 capture 也能拖 */
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}

function initFileTreeCollapse() {
  const col = document.querySelector('[data-od-id="osw-left-col"]') as HTMLElement | null;
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

// ── Function wish list ────────────────────────────────────────────────
//
// 從 editor.ts 整塊搬過來。歸屬 OpenSpec 而不是 PRD 是 Scott 拍板的：
// 它是「接下來要寫成 spec 的東西」，落點在這一頁的 change，不在 PRD 章節。
//
// I/O 在這裡，判定在 `function-wishlist.ts`。不跟檔案列表共用 innerHTML：
// `render()` 會重畫檔案清單，願望的輸入框若被一起清掉，打到一半的字就沒了。

let wishDoc: WishlistDoc = emptyWishlist();
let wishChecked = new Set<string>();
let wishComposing = false;
/** 點新增時取到的號。取消或存檔後退還／入檔。 */
let wishDraftId: string | null = null;
let wishSettingCode = false;
let wishEditingId: string | null = null;
let lastWishProjectId = "";
let wishBooted = false;
let wishBusy = false;

async function loadAndRenderWishlist() {
  wishDoc = await loadWishlist();
  wishChecked = new Set();
  wishComposing = false;
  wishDraftId = null;
  wishSettingCode = false;
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
  // 收合鍵管的是同一個節點的 hidden。這裡無條件設 false 會讓「收合」按一下
  // 就被下一次 render 打開 —— 收合狀態交給 initCollapsible，這裡不碰。
  const collapsed = host.hidden && document.getElementById("btn-wish-toggle")?.getAttribute("aria-expanded") === "false";
  if (!collapsed) host.hidden = false;

  const active = wishDoc.active;
  const archived = wishDoc.archive;
  const count = active.length + archived.length;

  const compose =
    wishComposing && wishDraftId
      ? `<div class="os-wish-compose">
        <p class="os-wish-taken">編號 <span class="os-wish-id">${escapeHtml(wishDraftId)}</span>（取消則退號）</p>
        ${wishKindSelectHtml("os-wish-kind", undefined, true)}
        <textarea id="os-wish-text" rows="4" placeholder="期望的功能說明。寫完按存檔。"></textarea>
        <div class="os-wish-compose-actions">
          <button type="button" class="btn btn-sm btn-primary" id="os-wish-save">存檔</button>
          <button type="button" class="btn btn-sm btn-ghost" id="os-wish-cancel">取消</button>
        </div>
      </div>`
      : "";

  const codeForm = wishSettingCode
    ? `<div class="os-wish-compose">
        <p class="os-wish-taken">這個專案還沒有簡寫。設 1–5 個英文字母後才取號。</p>
        <input id="os-wish-code" type="text" maxlength="5" spellcheck="false" autocapitalize="characters"
               placeholder="例如 AL" aria-label="專案簡寫" />
        <div class="os-wish-compose-actions">
          <button type="button" class="btn btn-sm btn-primary" id="os-wish-code-save">設定並新增</button>
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

  const codeLabel = p?.shortCode
    ? `<span class="os-wish-code" title="專案簡寫">${escapeHtml(p.shortCode)}</span>`
    : "";
  host.innerHTML = `
    <div class="os-wish-head">
      <h3 id="os-wish-title">Function wish list</h3>
      ${codeLabel}
      <span class="os-wish-count">${count || "—"}</span>
    </div>
    <p class="os-wish-lead">點新增取號並選類型。下拉選「撰寫 Spec」會帶進 OpenSpec 入口。</p>
    ${codeForm}
    ${compose}
    <div class="os-wish-toolbar">
      <button type="button" class="btn btn-sm" id="os-wish-add"${p && !wishComposing && !wishSettingCode ? "" : " disabled"}>新增</button>
      <button type="button" class="btn btn-sm btn-primary" id="os-wish-send"${active.some((it) => wishChecked.has(it.id)) ? "" : " disabled"}>送出</button>
    </div>
    <p class="os-wish-group">Active<span>${active.length}</span></p>
    <div id="os-wish-active">${activeRows}</div>
    <div id="os-wish-archive">${archiveBlock}</div>
  `;

  bindWishlist();
  const ta = document.getElementById("os-wish-text") as HTMLTextAreaElement | null;
  const code = document.getElementById("os-wish-code") as HTMLInputElement | null;
  (ta ?? code)?.focus();
}

function wishKindSelectHtml(id: string, selected: WishKind | undefined, required: boolean): string {
  const opts = WISH_KINDS.map(
    (k) =>
      `<option value="${k}"${selected === k ? " selected" : ""}>${escapeHtml(WISH_KIND_LABEL[k])}</option>`,
  ).join("");
  return `<label class="os-wish-kind-field">類型
    <select id="${escapeHtml(id)}" ${required ? "required" : ""} aria-label="變更類型">
      <option value="">請選擇</option>
      ${opts}
    </select>
  </label>`;
}

function wishRowHtml(it: WishlistItem, archived: boolean): string {
  if (wishEditingId === it.id) {
    return `<div class="os-wish-item is-editing" data-wish-id="${escapeHtml(it.id)}">
      <p class="os-wish-taken">編號 <span class="os-wish-id">${escapeHtml(it.id)}</span></p>
      ${wishKindSelectHtml("os-wish-edit-kind", it.kind, true)}
      <textarea data-wish-edit-text rows="3">${escapeHtml(it.text)}</textarea>
      <div class="os-wish-compose-actions">
        <button type="button" class="btn btn-sm btn-primary" data-wish-save-edit>儲存</button>
        <button type="button" class="btn btn-sm btn-ghost" data-wish-cancel-edit>取消</button>
      </div>
    </div>`;
  }
  const check = archived
    ? ""
    : `<input type="checkbox" data-wish-check="${escapeHtml(it.id)}"${wishChecked.has(it.id) ? " checked" : ""} aria-label="選取 ${escapeHtml(it.id)}" />`;
  const badge = archived
    ? `<span class="os-wish-badge">${escapeHtml(it.status ?? "已寫 spec")}</span>`
    : "";
  const kindChip = it.kind
    ? `<span class="os-wish-kind-chip">${escapeHtml(WISH_KIND_LABEL[it.kind])}</span>`
    : "";
  const writeOpt = archived ? "" : `<option value="write-spec">撰寫 Spec</option>`;
  return `<div class="os-wish-item" data-wish-id="${escapeHtml(it.id)}">
    ${check}
    <div class="os-wish-item-body">
      <span class="os-wish-id">${escapeHtml(it.id)}</span>
      ${kindChip}
      <span class="os-wish-item-text">${escapeHtml(it.text)}</span>
      ${badge}
    </div>
    <div class="os-wish-item-actions">
      <select class="os-wish-menu" data-wish-menu="${escapeHtml(it.id)}" aria-label="${escapeHtml(it.id)} 的動作">
        <option value="" selected>動作</option>
        <option value="edit">編輯</option>
        ${writeOpt}
        <option value="remove">移除</option>
      </select>
    </div>
  </div>`;
}

function bindWishlist() {
  const host = document.getElementById("os-wish");
  if (!host) return;

  host.querySelector<HTMLButtonElement>("#os-wish-add")?.addEventListener("click", () => {
    beginNewWish();
  });
  host.querySelector<HTMLButtonElement>("#os-wish-code-save")?.addEventListener("click", () => {
    const input = host.querySelector<HTMLInputElement>("#os-wish-code");
    void saveShortCodeAndAdd(input?.value ?? "");
  });
  host.querySelector<HTMLInputElement>("#os-wish-code")?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void saveShortCodeAndAdd((ev.target as HTMLInputElement).value);
    }
  });
  host.querySelector<HTMLButtonElement>("#os-wish-cancel")?.addEventListener("click", () => {
    wishComposing = false;
    wishDraftId = null;
    wishSettingCode = false;
    renderWishlist();
  });
  host.querySelector<HTMLButtonElement>("#os-wish-save")?.addEventListener("click", () => {
    const ta = host.querySelector<HTMLTextAreaElement>("#os-wish-text");
    const kindEl = host.querySelector<HTMLSelectElement>("#os-wish-kind");
    void commitNewWish(ta?.value ?? "", parseWishKind(kindEl?.value ?? ""));
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
  host.querySelectorAll<HTMLButtonElement>("[data-wish-cancel-edit]").forEach((b) => {
    b.addEventListener("click", () => {
      wishEditingId = null;
      renderWishlist();
    });
  });
  host.querySelectorAll<HTMLButtonElement>("[data-wish-save-edit]").forEach((b) => {
    b.addEventListener("click", () => {
      const wrap = b.closest("[data-wish-id]");
      const id = wrap instanceof HTMLElement ? (wrap.dataset.wishId ?? "") : "";
      const ta = wrap?.querySelector("textarea");
      const kindEl = wrap?.querySelector<HTMLSelectElement>("#os-wish-edit-kind");
      void commitEditWish(id, ta?.value ?? "", parseWishKind(kindEl?.value ?? ""));
    });
  });
  host.querySelectorAll<HTMLSelectElement>("[data-wish-menu]").forEach((sel) => {
    sel.addEventListener("change", () => {
      const id = sel.dataset.wishMenu ?? "";
      const act = sel.value;
      sel.value = "";
      if (act === "edit") {
        wishEditingId = id;
        wishComposing = false;
        renderWishlist();
      } else if (act === "write-spec") {
        void sendWishes([id]);
      } else if (act === "remove") {
        void commitRemoveWish(id);
      }
    });
  });
}

function beginNewWish() {
  const p = activeProject();
  if (!p) {
    toast("先選一個專案");
    return;
  }
  wishEditingId = null;
  if (!p.shortCode) {
    wishSettingCode = true;
    wishComposing = false;
    wishDraftId = null;
    renderWishlist();
    document.getElementById("os-wish-code")?.focus();
    return;
  }
  const id = takeWishId(wishDoc, p.shortCode, wishDraftId ? [wishDraftId] : []);
  if (!id) {
    toast("簡寫不合法，請到側欄專案卡片改簡寫");
    return;
  }
  wishDraftId = id;
  wishComposing = true;
  wishSettingCode = false;
  renderWishlist();
}

async function saveShortCodeAndAdd(raw: string) {
  const p = activeProject();
  if (!p) return;
  const r = store.setProjectShortCode(p.id, raw);
  if (!r.ok) {
    toast(r.reason ?? "簡寫不合法");
    return;
  }
  wishSettingCode = false;
  beginNewWish();
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

async function commitNewWish(text: string, kind: WishKind | null) {
  await withWishLock(async () => {
    const id = wishDraftId;
    if (!id) {
      toast("先按新增取號");
      return;
    }
    if (!kind) {
      toast("先選這則是新功能、Bug 修復還是維護／重構");
      return;
    }
    const next = addWish(wishDoc, text, id, new Date(), kind);
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
    wishDraftId = null;
    renderWishlist();
    toast(`已存檔 ${id}`);
  });
}

async function commitEditWish(id: string, text: string, kind: WishKind | null) {
  await withWishLock(async () => {
    if (!kind) {
      toast("先選這則是新功能、Bug 修復還是維護／重構");
      return;
    }
    const next = updateWish(wishDoc, id, text, kind);
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

async function commitRemoveWish(id: string) {
  if (!id) return;
  if (!(await askConfirm({ title: `移除 ${id}？這個編號之後可以再取。`, danger: true }))) return;
  await withWishLock(async () => {
    const next = removeWish(wishDoc, id);
    if (!next) return;
    try {
      await persistWishlist(next);
    } catch (e) {
      toast(e instanceof Error ? e.message : "移除失敗");
      return;
    }
    wishDoc = next;
    wishChecked.delete(id);
    if (wishEditingId === id) wishEditingId = null;
    renderWishlist();
    toast(`已移除 ${id}，編號可再用`);
  });
}

async function sendWishes(ids?: string[]) {
  const p = activeProject();
  const want = ids?.length ? new Set(ids) : wishChecked;
  const picked = wishDoc.active.filter((it) => want.has(it.id));
  if (!p || !picked.length) {
    toast("先勾選要寫成 spec 的願望");
    return;
  }
  const kind = picked[0]?.kind ?? "feature";
  writeWishHandoff({
    projectId: p.id,
    kind,
    items: picked.map((it) => ({ id: it.id, text: it.text, kind: it.kind })),
  });
  // 開新 change 的三步驟精靈仍然是 openspec.html —— 這一頁讀寫既有的 change，
  // 建立新的是那一頁的事。精靈跑完會把新 change 寫進 openspec/changes/，
  // 回到這一頁時左欄就會列出來。
  window.location.href = "openspec.html";
}

// ── 中欄：原始檔案檢視／編輯 ──────────────────────────────────────────
//
// 從 editor.ts 整支搬過來（`openFileInEditor` → `renderFileView` →
// diff 背板 → 版本快照）。這是這次拆分唯一真正的邏輯搬遷。
//
// 不自動存檔 —— 這是使用者專案裡的真實檔案，不是 App 自己的資料。

let openFile: { path: string; original: string } | null = null;

/**
 * 閱讀模式：把 Markdown 原始碼換成排版後的內容。
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
  store.setActiveOpenSpecFile("");
  render();
  return true;
}

// 每次「開檔」意圖（手動點擊或進場還原）遞增一次，讀檔完成時比對還是不是
// 最新那一次 —— 晚回來的讀檔結果不該蓋掉使用者在等待期間做的新選擇。
let openGeneration = 0;

async function openFileInEditor(path: string) {
  if (!path) return;
  if (!canEditFiles()) {
    toast("在編輯欄開檔需要桌面版 App");
    return;
  }
  if (!(await confirmLeaveFile())) return;
  const myGeneration = ++openGeneration;
  const label = document.getElementById("sec-label");
  if (label) label.textContent = "讀取中…";
  try {
    const text = await readFile(path);
    if (myGeneration !== openGeneration) return;
    openFile = { path, original: text };
    // 記住開的是哪個檔，下次進來直接落回同一個位置
    store.setActiveOpenSpecFile(path);
    // 換檔要重建，不能被「同一個檔就跳過」擋掉
    document.getElementById("fv-text")?.remove();
    render();
    (document.getElementById("fv-text") as HTMLTextAreaElement | null)?.focus();
  } catch (e) {
    if (myGeneration !== openGeneration) return;
    toast(e instanceof Error ? e.message : "讀取失敗");
    // 讀不到就別把它留在 store 裡，否則每次進頁都會再失敗一次
    store.setActiveOpenSpecFile("");
    render();
  }
}

/**
 * 存檔前把改過的行標成橘色。
 *
 * textarea 沒辦法把部分文字上色，所以用「背板」：一個和 textarea 完全對齊、
 * 字體度量一致的 div 疊在底下畫色塊，textarea 自己的文字保持不透明蓋在上面。
 */
function renderHighlightBackdrop() {
  if (!openFile) return;
  const ta = document.getElementById("fv-text") as HTMLTextAreaElement | null;
  const back = document.getElementById("fv-backdrop");
  if (!ta || !back) return;

  const marks = markChangedLines(openFile.original, ta.value);
  // 編輯層只認 added / modified —— removed 的內容不在 textarea 裡，
  // 畫進來字數就會多於實際文字，游標位置跟畫面對不上。
  const byIndex = new Map(marks.filter((m) => m.kind !== "removed").map((m) => [m.index, m]));
  const lines = ta.value.split("\n");

  back.innerHTML = lines
    .map((ln, i) => {
      const m = byIndex.get(i);
      if (!m) return `<span class="fv-line">${escapeHtml(ln) || "&nbsp;"}</span>`;
      const segs =
        m.kind === "modified"
          ? visibleSegs(inlineDiff(m.before ?? "", ln))
          : [{ text: ln, kind: "add" as const }];
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
  return segs.map((sg) => `<span class="fv-${sg.kind}">${escapeHtml(sg.text)}</span>`).join("");
}

/**
 * 對比欄：完整的字級 diff，含被刪掉的字（紅字 + 刪除線）。
 *
 * 為什麼獨立一欄而不是畫在編輯層上：被刪掉的字**不在 textarea 裡**，
 * 畫進編輯層會讓畫面字數多於實際內容，游標位置就跟畫面對不上。
 */
function renderDiffPane() {
  if (!openFile) return;
  const host = document.getElementById("fv-review");
  const ta = document.getElementById("fv-text") as HTMLTextAreaElement | null;
  const wrap = document.getElementById("fv-diff-wrap");
  if (!host || !ta || !wrap) return;

  const marks = markChangedLines(openFile.original, ta.value);
  const hidden = wrap.dataset.forceHidden === "1";
  // 對比欄是給編輯用的。閱讀模式下它會從排版內容底下冒出來一整片等寬字。
  const reading = document.getElementById("fv-read-pane")?.hidden === false;
  wrap.hidden = hidden || reading || marks.length === 0;
  if (wrap.hidden) return;

  // removed 沒有對應的「改之後」行，用 index 當插入點掛在那一行之前。
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

  // 背板疊在 textarea 上面，改過的行會吃掉點擊。點下去要能把游標放進那一行，
  // 不然橘色行等於變成不能編輯。
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
    ta.setSelectionRange(start + lines[i]!.length, start + lines[i]!.length);
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

/** 沒開檔時的中欄。空殼加一句「從左邊挑一個」比一片白好，但只說一次。 */
function renderFileEmpty() {
  const label = document.getElementById("sec-label");
  if (label) label.textContent = "選一個檔案";
  const body = document.getElementById("editor-body");
  if (!body) return;
  const entry = currentEntry();
  body.innerHTML = `<div class="fv-empty os-empty" style="padding:24px">
    ${
      !activeProject()
        ? "還沒有選擇專案。"
        : !entry
          ? "這個專案還沒有 openspec/ 內容。用右上角「開新 change」建一個，或先在左下的 Function wish list 累積想做的事。"
          : `從左邊挑一個檔案打開。<code>${escapeHtml(entry.id)}</code> 底下有 ${entry.group.rows.length} 個檔。`
    }
  </div>`;
}

function renderFileView(): boolean {
  if (!openFile) {
    renderFileEmpty();
    return false;
  }
  const label = document.getElementById("sec-label");
  if (label) label.textContent = shortPath(openFile.path);

  const body = document.getElementById("editor-body");
  if (!body) return true;

  // 已經開著同一個檔就什麼都不做。
  // render() 會被 store 的每一次 emit 觸發，無條件重建 textarea 等於每次都把
  // 使用者正在打的字換回磁碟原文 —— 打一個字就消失，看起來就是「不能編輯」。
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
        <button type="button" class="btn btn-sm btn-ghost" id="fv-close">關閉</button>
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
        if (
          !(await askConfirm({
            title: `要把編輯區還原成 ${relativeTime(sn.at)} 的內容嗎？（還原後仍需按儲存才會寫回磁碟）`,
            danger: true,
          }))
        )
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
      // 存完 tasks.md 之後右欄的進度就過期了。**一定要 force** ——
      // `refreshSideData()` 的快取 key 只有專案，存檔沒換專案，不帶 force
      // 會在第一行就 early return，進度條於是停在存檔前的數字直到重新載入。
      // 這是「沒有錯誤訊息」的那一種錯：畫面看起來正常，只是數字是舊的。
      void refreshSideData(true);
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
  // 渲染的是 `ta.value` 而不是 `openFile.original`：還沒存的修改也要看得到。
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

// ── 右欄：任務進度 / openspec status / 健康狀態 ───────────────────────
//
// 三份資料都不是同步取得的（一份走 tracking_scan，一份走 openspec CLI），
// 所以快取在模組層，由 `refreshSideData()` 統一刷新，`render()` 只負責畫。
// 每次 render 都重新掃磁碟的話，打一個字就會觸發一輪 CLI。

/** change id → tasks.md 的解析結果。掃不到的 change 不會有 key。 */
let taskMetaByChange = new Map<string, PlanMeta>();
/** `openspec status --change <id> --json` 的判讀結果 */
let healthByChange = new Map<string, OpenspecChange>();
/** `openspec list --json` 的一列（帶 lastModified 與 CLI 自己算的 tasks 計數） */
let listedByChange = new Map<string, OpenspecListEntry>();
/** CLI 不在／不是 openspec 專案時的說明。不是錯誤，是狀態。 */
let healthReason = "";
let sideLoading = false;
let lastSideKey = "";

/**
 * 重取右欄的資料。
 *
 * 兩條路徑各自 fail-soft：`tracking_scan` 掛掉不影響 CLI 的結果，反之亦然。
 * 一邊沒有資料就只是那一張卡片顯示「取不到」，不是整欄空白。
 */
async function refreshSideData(force = false) {
  const st = store.get();
  const p = activeProject();
  const key = `${p?.id ?? ""}|${p?.importSummary?.rootPath ?? ""}`;
  if (!force && key === lastSideKey) {
    // 同一個專案已經取過（或正在取）了。change 換了不必重掃 —— 兩支 API
    // 都是一次拿全部，不是逐 change 查。
    //
    // 這裡不再看 `sideLoading`：把它加進條件會讓「掃描進行中的重複呼叫」
    // 變成**不** early return，也就是再開一輪並行掃描 —— 跟想擋的事情相反。
    // 飛行中的那一輪本來就會蓋上正確結果。
    return;
  }
  lastSideKey = key;
  const root = p?.importSummary?.rootPath ?? "";
  if (!root) {
    taskMetaByChange = new Map();
    healthByChange = new Map();
    listedByChange = new Map();
    healthReason = "這個專案還沒有綁定資料夾。";
    renderSide();
    return;
  }

  sideLoading = true;
  renderSide();

  // ① tasks.md 的 checklist —— 直接用 Task Tracking 那條掃描當函式庫，
  //    不自己讀檔也不自己數方框。在這裡數第二次是進度條說反話的經典來源。
  const scanTasks = async () => {
    try {
      const scan = await requestTrackingScan([], openspecRootsOf(st.projects, st.activeProjectId));
      const next = new Map<string, PlanMeta>();
      for (const f of scan.files) {
        if (f.kind !== "openspec" || !f.change) continue;
        next.set(f.change, parsePlanMeta(f.text, f.name, { dialect: "openspec", change: f.change }));
      }
      taskMetaByChange = next;
    } catch {
      // 橋壞了／不是桌面版。空 Map 會讓畫面誠實說「讀不到」。
      taskMetaByChange = new Map();
    }
  };

  // ② openspec CLI 的狀態。判讀全部在 `openspec-status.ts`，這裡只餵原始字串。
  const scanHealth = async () => {
    try {
      const r = await native.openspecStatus(root);
      if (!r || isUnavailable(r)) {
        healthByChange = new Map();
        listedByChange = new Map();
        healthReason = isUnavailable(r)
          ? r.message
          : "桌面版才跑得動 openspec CLI。";
        return;
      }
      listedByChange = new Map(parseOpenspecList(r.list).map((e) => [e.name, e]));
      const next = new Map<string, OpenspecChange>();
      for (const raw of r.statuses) {
        const c = parseOpenspecStatus(raw);
        if (c) next.set(c.name, c);
      }
      healthByChange = next;
      healthReason = "";
    } catch (e) {
      healthByChange = new Map();
      listedByChange = new Map();
      healthReason = e instanceof Error ? e.message : "openspec 狀態取不到。";
    }
  };

  await Promise.all([scanTasks(), scanHealth()]);
  // 等待期間可能又換了專案／資料夾 —— `lastSideKey` 這時已經是新的鑰匙。
  // 舊的這一輪寫回去等於讓右欄倒退回上一個專案，寧可安靜丟掉。
  if (lastSideKey !== key) return;
  sideLoading = false;
  renderSide();
}

function progressCardHtml(id: string): string {
  const meta = taskMetaByChange.get(id);
  const listed = listedByChange.get(id);

  if (!meta && listed && listed.totalTasks > 0) {
    // 掃不到檔但 CLI 數得出來（例如已封存的 change 不在掃描範圍）。
    // 用 CLI 的數字，並且講清楚來源 —— 兩個分母不一致時使用者要看得出為什麼。
    const pct = Math.round((listed.completedTasks / listed.totalTasks) * 100);
    return `<div class="osw-card">
      <h3>任務進度</h3>
      <div class="osw-bar"><i style="width:${pct}%"></i></div>
      <span class="osw-num">${listed.completedTasks}/${listed.totalTasks} · ${pct}%</span>
      <p class="osw-note">數字來自 <code>openspec list</code>。這個 change 的 <code>tasks.md</code> 不在掃描範圍（封存的 change 不掃）。</p>
    </div>`;
  }

  if (!meta) {
    return `<div class="osw-card">
      <h3>任務進度</h3>
      <p class="osw-note">${
        sideLoading
          ? "讀取中…"
          : canEditFiles()
            ? "掃不到這個 change 的 <code>tasks.md</code>。"
            : "瀏覽器版讀不到磁碟，任務進度要在桌面版 App 才算得出來。"
      }</p>
    </div>`;
  }

  const prog = planProgress(meta);
  const pct = prog.pct;
  const unanchored = meta.unanchored;
  return `<div class="osw-card">
    <h3>任務進度</h3>
    <div class="osw-bar"><i style="width:${pct}%"></i></div>
    <span class="osw-num">${prog.closed}/${prog.total} · ${pct}%</span>
    ${
      meta.next_step
        ? `<p class="osw-note">下一步：${escapeHtml(meta.next_step)}</p>`
        : `<p class="osw-note">沒有待辦的步驟了。</p>`
    }
    ${
      unanchored > 0
        ? `<p class="osw-note">${unanchored} 個步驟沒有錨點 —— 這些步驟接不上事件流。</p>`
        : ""
    }
    <p class="osw-note">來源：<code>tasks.md</code>（勾選請到 Task Tracking 或直接編輯左邊的檔案）。</p>
  </div>`;
}

/**
 * 健康狀態 —— 用的是 `openspec status --change <id> --json`，不是 `openspec validate`。
 *
 * ⚠️ 這是與 handoff 的一處刻意偏離。原生橋對 `openspec` 的白名單只有
 * `list --json` 與 `status --change <name> --json`（`docs/BRIDGE.md` §4.7），
 * 要跑 `validate` 得動 Rust 的 exec 白名單、commands、契約測試與那份文件 ——
 * 為了一個佈局拆分去放寬 CLI 執行面不划算。而 `status` 已經回答了同一組問題：
 * artifact 齊不齊、有沒有 blocked、apply 前還缺什麼。
 */
function healthCardHtml(id: string): string {
  const c = healthByChange.get(id);
  const listed = listedByChange.get(id);

  if (!c) {
    return `<div class="osw-card">
      <h3>健康狀態</h3>
      <p class="osw-note">${
        sideLoading ? "讀取中…" : escapeHtml(healthReason || "這個 change 沒有 openspec status 可讀。")
      }</p>
    </div>`;
  }

  const next = nextArtifact(c);
  const arts = c.artifacts
    .map(
      (a) => `<div class="osw-art">
        <span class="osw-dot ${a.status}"></span>
        <span class="osw-art-name">${escapeHtml(a.id)}</span>
        <span class="osw-tag">${escapeHtml(a.status)}</span>
      </div>`,
    )
    .join("");

  const blocked = c.artifacts.filter((a) => a.status === "blocked");
  const missing = [...new Set(blocked.flatMap((a) => a.missingDeps ?? []))];

  return `<div class="osw-card">
    <h3>健康狀態</h3>
    ${arts || `<p class="osw-note">這個 change 沒有列出任何 artifact。</p>`}
    ${
      next
        ? `<p class="osw-note">下一步：寫 <code>${escapeHtml(next.outputPath)}</code>。</p>`
        : c.isComplete
          ? `<p class="osw-note">artifact 都齊了。</p>`
          : `<p class="osw-note">沒有可以直接動手的 artifact。</p>`
    }
    ${missing.length ? `<p class="osw-note">被擋住：缺 ${escapeHtml(missing.join("、"))}。</p>` : ""}
    ${
      c.applyRequires.length
        ? `<p class="osw-note">apply 前還要：${escapeHtml(c.applyRequires.join("、"))}。</p>`
        : ""
    }
    ${
      listed?.lastModified
        ? `<p class="osw-note">最後異動：${escapeHtml(listed.lastModified.slice(0, 16).replace("T", " "))}</p>`
        : ""
    }
    <p class="osw-note">來源：<code>openspec status --change ${escapeHtml(id)}</code>。</p>
  </div>`;
}

function renderSide() {
  const host = document.getElementById("osw-side-body");
  if (!host) return;
  const id = currentChangeId();
  const pill = document.getElementById("osw-health-pill");

  if (!id) {
    if (pill) pill.textContent = "—";
    host.innerHTML = `<div class="osw-card">
      <h3>這個 Change</h3>
      <p class="osw-note">左邊還沒有可選的 change。</p>
    </div>`;
    return;
  }

  const c = healthByChange.get(id);
  const meta = taskMetaByChange.get(id);
  if (pill) {
    pill.textContent = sideLoading
      ? "讀取中"
      : c?.isComplete
        ? "完成"
        : meta
          ? `${planProgress(meta).pct}%`
          : "—";
  }

  host.innerHTML = `
    <div class="osw-card">
      <h3>Change</h3>
      <p class="osw-num">${escapeHtml(id)}</p>
      ${currentEntry()?.archived ? `<p class="osw-note">已封存。</p>` : ""}
    </div>
    ${progressCardHtml(id)}
    ${healthCardHtml(id)}
  `;
}

// ── 進場：URL 參數與記住的位置 ────────────────────────────────────────

/**
 * 從別的頁跳過來時要落在對的地方。
 *
 * 兩條入口：`?change=<id>&file=<絕對路徑>`（Task Tracking 的 tasks.md 連結），
 * 以及 store 記住的上一次位置。URL 優先 —— 明講的意圖蓋過記憶。
 */
function applyEntryIntent() {
  const q = new URLSearchParams(location.search);
  const change = q.get("change");
  const file = q.get("file");
  if (change) store.setActiveOpenSpecChange(change);
  if (file) store.setActiveOpenSpecFile(file);
}

/**
 * `path` 是不是真的在 `root` 底下，不只是字串前綴相同。
 *
 * 純 `startsWith(root)` 會誤放行 root 的手足目錄（`/foo` 通過 `/foo-evil/secret`
 * 的前綴檢查）跟字面上的 `..` 片段（`/foo/../../etc/passwd` 一樣通過前綴、卻
 * 逃出 root）。`path` 可能來自 URL 參數（`applyEntryIntent`），這裡放行放錯
 * 就代表能讀寫到專案範圍外的檔案。
 */
function isWithinRoot(path: string, root: string): boolean {
  if (path.split("/").includes("..")) return false;
  const boundary = root.endsWith("/") ? root : `${root}/`;
  return path === root || path.startsWith(boundary);
}

/** 上次開著的檔案。開不起來（被刪了、換了專案）就安靜放棄，不要跳錯誤。 */
async function restoreOpenFile() {
  const path = store.get().activeOpenSpecFile;
  if (!path || !canEditFiles()) return;
  const root = activeProject()?.importSummary?.rootPath ?? "";
  // 記的是絕對路徑，但專案換過資料夾時它可能已經不在這個 root 底下了。
  // 沒有 root（專案還沒綁資料夾）也要拒絕，不能因為驗不了就放行 ——
  // 放行的話「切到一個沒綁資料夾的專案」會重新打開上一個專案的檔案。
  if (!root || !isWithinRoot(path, root)) {
    store.setActiveOpenSpecFile("");
    return;
  }
  const myGeneration = ++openGeneration;
  try {
    const text = await readFile(path);
    // 這段讀檔在跑的時候，使用者可能已經自己手動開了別的檔（或再切了一次
    // 專案）—— 那個意圖比「上次記得的檔」新，這裡回來得晚就不該蓋過去。
    if (myGeneration !== openGeneration) return;
    openFile = { path, original: text };
    render();
  } catch {
    if (myGeneration !== openGeneration) return;
    store.setActiveOpenSpecFile("");
  }
}

// ── render ────────────────────────────────────────────────────────────

function render() {
  syncProjectChrome();
  renderChanges();
  renderChangeFiles();
  renderOtherGroups();
  renderFileTree();
  renderFileView();
  renderSide();
  syncUser();

  const p = activeProject();
  const pid = p?.id ?? "";
  if (!wishBooted || pid !== lastWishProjectId) {
    wishBooted = true;
    lastWishProjectId = pid;
    void loadAndRenderWishlist();
  }
}

document.getElementById("btn-osw-refresh")?.addEventListener("click", () => {
  // 檔案清單來自 store 的 importSummary（重掃資料夾是專案頁的事），
  // 這顆按鈕重取的是右欄那兩份會過期的資料。
  lastTreeSig = "__init__";
  void refreshSideData(true);
  void loadAndRenderWishlist();
  toast("已重新整理");
});

document.addEventListener("keydown", (e) => {
  // ⌘S 在沒開檔時不該吞掉 —— 這一頁沒有「整頁儲存」的概念
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && !openFile) {
    e.preventDefault();
    toast("先從左邊開一個檔案再儲存");
  }
});

initFileTreeCollapse();
initFileTreeResize();
initCollapsible("btn-openspec-toggle", "openspec-list", "anchorline:osw-files-collapsed", "檔案清單");
initCollapsible("btn-wish-toggle", "os-wish", "anchorline:osw-wish-collapsed", "願望清單");

applyEntryIntent();
render();
void refreshSideData();
void restoreOpenFile();

// 綁定資料夾後檔案樹與清單要立刻長出來。平常只做這三格局部重繪，但
// rootPath 或 activeProjectId 變了代表整頁的前提都變了 —— 頁首、右側
// 任務／健康卡片、Wish List 全部還停在舊狀態，非做一次完整 render()
// 不可，否則要重整頁面才會跟上。兩個都要追蹤：只看 root 會漏掉「兩個
// 專案剛好共用同一個 root」；只看 projectId 會漏掉「同專案換綁資料夾」。
let lastBoundRoot = activeProject()?.importSummary?.rootPath ?? "";
let lastProjectId = activeProject()?.id ?? "";
store.subscribe(() => {
  const p = activeProject();
  const root = p?.importSummary?.rootPath ?? "";
  const pid = p?.id ?? "";
  const switchedProject = pid !== lastProjectId;
  if (switchedProject || root !== lastBoundRoot) {
    lastProjectId = pid;
    lastBoundRoot = root;
    // 專案是在別處（例如上方的專案切換器）被換掉的，這裡攔不住那次切換。
    // 留著舊專案開著的檔案比丟掉使用者還沒存的修改更危險 —— 中欄會用新
    // 專案的畫面繼續寫舊專案的檔案。強制關閉，用 toast 講清楚發生了什麼。
    if (switchedProject && openFile) {
      openFile = null;
      store.setActiveOpenSpecFile("");
      toast("已切換專案，原本開著的檔案已關閉");
    }
    render();
    void refreshSideData();
    return;
  }
  renderChanges();
  renderChangeFiles();
  renderFileTree();
});
} // end __authed
