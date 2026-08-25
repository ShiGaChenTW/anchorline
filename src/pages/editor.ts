import {
  AiError,
  critiqueSectionWithAI,
  generateAIDraft,
  getAiReadiness,
  isAiConfigured,
  polishTextWithAI,
} from "../lib/ai-coach";
import { askConfirm, askCustom, askText } from "../lib/ask";
import {
  assignDialogHtml,
  buildAssignments,
  FULL_CAT_LABEL,
  readAssignments,
  type Assignments,
} from "../lib/submit-assign";
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
import { canEditContent } from "../lib/permissions";
import { labelForOrphan, type OrphanRef } from "../lib/orphan-content";
import { deriveFlowLayers, renderFlowStripHtml } from "../lib/flow-layers";
import { SECTION_TO_OPENSPEC, sourceFileForSection } from "../lib/file-tree";
// OpenSpec 檔案清單、Function wish list、原始檔案檢視／編輯（含 diff 背板與
// 版本快照）已整批搬到 `openspec-workspace.ts`。這一頁只剩 PRD：
// 章節表單、教練、gate、送審。
import { initHelpOverlay } from "../lib/help-overlay";
import { beginBootOverlay, endBootOverlay, failBootOverlay } from "../lib/loading-overlay";
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

// 第一行：攔截要先裝好才擋得住後面任何一行的 throw（見 loading-overlay.ts）。
// 8 秒硬上限是最後一道保險——正常路徑由檔尾的 finally 收掉，這裡防的是
// 「沒 throw 但也不回來」。
beginBootOverlay({ autoHideAfter: 8000 });

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
    mode: "工作台-PRD",
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
    (btn as HTMLButtonElement).onclick = () => {
      const i = Number((btn as HTMLElement).dataset.i);
      const s = sections()[i];
      if (s) store.setActiveSection(s.id);
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

  renderOrphans();
}

/**
 * 孤兒面板的展開狀態。
 *
 * 預設收起：這是「有東西掉在結構外面」的提示，不是主線工作區，預設攤開會
 * 把章節清單推到摺線下。狀態放模組層而不是掛在節點上 —— 每次 render() 都
 * 重建 innerHTML，記在 DOM 上的展開狀態會在下一次重繪時無聲消失。
 */
let orphanOpen = false;

/**
 * 章節列表下方的孤兒正文面板。
 *
 * 這是 `applyFullTemplate()` / `setProjectDomain()` 換掉骨架之後，那些「有字
 * 但沒有畫面」的內容唯一的出口。上方 `#domain-orphans` 那則提示只說得出
 * 「有 N 節不屬於目前領域」，說完就沒有下文；這裡才是能動手的地方。
 *
 * **不做自動配對。** 下拉沒有預選值，落點一律由使用者指。猜「三行摘要」該
 * 進「問題」猜錯的代價，是他得先把我們搬錯的東西搬回去 —— 比不猜還貴。
 */
function renderOrphans() {
  const host = document.getElementById("orphan-panel");
  if (!host) return;

  const pid = store.get().activeProjectId;
  // 用 orphansOf(pid) 而不是 orphanSectionIds()：後者是 active-only 且以「節」
  // 為單位，這裡要的是逐「欄位」的可處理清單
  const list = pid ? store.orphansOf(pid) : [];

  // 沒有孤兒就整塊不存在。常駐一個「0 段」的欄位是純噪音，而且會讓使用者
  // 以為這個專案有需要處理的東西
  if (!pid || !list.length) {
    host.hidden = true;
    host.innerHTML = "";
    return;
  }
  host.hidden = false;

  const known = sections();
  const canEdit = editable();
  // 查標題用更大的池子：orphan 的定義就是「不在 known 裡」，用 known 去查
  // 自己一定查不到，只會永遠退回原始 id。orphanLabelPool() 是攤平所有已知
  // 領域包的字典，換領域包造成的孤兒才有機會查到原本的章節編號與標題；
  // 套一次性範本（applyFullTemplate）造成的孤兒本來就不屬於任何領域包，
  // 查不到是誠實的結果，不是 bug。
  const labelPool = store.orphanLabelPool();

  // 落點池 = 目前骨架的所有「章節 × 欄位」。候選只能從這裡來 —— 搬到不在
  // 骨架裡的地方，只是換一個位置繼續當孤兒
  const targets: { ref: OrphanRef; label: string }[] = [];
  for (const s of known) {
    for (const f of s.fields) {
      targets.push({
        ref: { sectionId: s.id, fieldKey: f.key },
        label: `${s.n} ${s.title} · ${f.label}`,
      });
    }
  }

  const itemsHtml = list
    .map((e, i) => {
      // 用 labelPool（所有領域包攤平），不是 known（目前骨架）——orphan 的
      // 定義就是不在 known 裡，用 known 查一定落空，永遠只看得到原始 id
      const lb = labelForOrphan(e, labelPool);
      const acts = canEdit
        ? `<div class="orphan-acts">
             <select class="orphan-to" data-i="${i}" aria-label="把這一段搬到哪一節">
               <option value="" selected>搬到…（選章節與欄位）</option>
               ${targets.map((t, ti) => `<option value="${ti}">${escapeHtml(t.label)}</option>`).join("")}
             </select>
             <button type="button" class="btn btn-sm" data-orphan-move="${i}" disabled>搬移</button>
             <button type="button" class="btn btn-sm orphan-del" data-orphan-del="${i}">刪除</button>
           </div>`
        : `<p class="orphan-readonly">目前身分無法編輯內文，只能檢視。</p>`;
      return `<li class="orphan-item">
        <div class="orphan-item-head">
          <span class="orphan-src mono">${escapeHtml(lb.section)}</span>
          <span class="orphan-fld">${escapeHtml(lb.field)}</span>
        </div>
        <pre class="orphan-text">${escapeHtml(e.text)}</pre>
        ${acts}
      </li>`;
    })
    .join("");

  host.innerHTML = `<button type="button" class="orphan-head" id="orphan-toggle"
          aria-expanded="${orphanOpen}" aria-controls="orphan-body">
      <span class="orphan-caret" aria-hidden="true">${orphanOpen ? "▾" : "▸"}</span>
      <span class="orphan-head-t">有 ${list.length} 段內容不屬於目前結構</span>
    </button>
    ${
      orphanOpen
        ? `<div class="orphan-body" id="orphan-body">
             <p class="orphan-note">換過章節骨架留下的。內容沒有掉，只是目前的結構裡沒有它的位置。</p>
             <ul class="orphan-list">${itemsHtml}</ul>
           </div>`
        : ""
    }`;

  const toggle = host.querySelector<HTMLButtonElement>("#orphan-toggle");
  // 只重畫這一塊：展開收合不改任何內容，走 render() 會順手把游標從
  // 使用者正在打字的 textarea 上踢掉
  if (toggle) toggle.onclick = () => { orphanOpen = !orphanOpen; renderOrphans(); };

  // 「搬移」在選到落點之前一律停用。沒有預選值代表預設狀態就是「還沒選」，
  // 按鈕必須跟著那個狀態走，否則按下去只會得到一句「落點不在結構裡」
  host.querySelectorAll<HTMLSelectElement>(".orphan-to").forEach((sel) => {
    sel.onchange = () => {
      const btn = host.querySelector<HTMLButtonElement>(`[data-orphan-move="${sel.dataset.i}"]`);
      if (btn) btn.disabled = sel.value === "";
    };
  });

  host.querySelectorAll<HTMLButtonElement>("[data-orphan-move]").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.orphanMove);
      const entry = list[i];
      const sel = host.querySelector<HTMLSelectElement>(`.orphan-to[data-i="${i}"]`);
      const t = sel && sel.value !== "" ? targets[Number(sel.value)] : undefined;
      if (!entry || !t) return;
      const r = store.moveOrphan(pid, { sectionId: entry.sectionId, fieldKey: entry.fieldKey }, t.ref);
      // 落點寫進草稿不是正文 —— 訊息要說出「還沒存」，否則使用者會以為搬完就定案了
      toast(r.ok ? `已搬到「${t.label}」—— 尚未儲存` : (r.reason ?? "搬不動"));
      if (r.ok) render();
    };
  });

  host.querySelectorAll<HTMLButtonElement>("[data-orphan-del]").forEach((btn) => {
    btn.onclick = async () => {
      const entry = list[Number(btn.dataset.orphanDel)];
      if (!entry) return;
      const lb = labelForOrphan(entry, labelPool);
      // 沒有垃圾桶、沒有 undo，擋在前面的只有這一句話，所以它必須把話講死
      if (
        !(await askConfirm({
          title: `永久刪除「${lb.section} · ${lb.field}」這一段內容？刪掉就沒有了 —— 沒有垃圾桶，也無法復原。`,
          danger: true,
        }))
      ) {
        return;
      }
      const r = store.dropOrphan(pid, { sectionId: entry.sectionId, fieldKey: entry.fieldKey });
      toast(r.ok ? "已永久刪除" : (r.reason ?? "刪不掉"));
      if (r.ok) render();
    };
  });
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

/**
 * 中欄只畫 PRD 章節表單。
 *
 * 以前這裡第一行是 `if (renderFileView()) return;` —— 中欄在「章節表單」與
 * 「原始檔案內容」之間切換，由 `openFile` 是不是 null 決定。那條分支連同
 * 整個檔案檢視已經搬到 `openspec-workspace.ts`，這裡不再有第二種狀態。
 */
function renderEditor() {
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
    (btn as HTMLButtonElement).onclick = () => {
      const id = (btn as HTMLElement).dataset.sec!;
      const i = sections().findIndex((s) => s.id === id);
      if (i >= 0) {
        store.setActiveSection(id);
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
    store.setActiveSection(s.id);
    toast(`已插入到「${s.n} ${s.title}」`);
  }
} else if (pending && !editable()) {
  toast("目前身分無法插入範本到內文");
}

document.getElementById("domain-select")?.addEventListener("change", (e) => {
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
  if (first) store.setActiveSection(first.id);
  const orphans = store.orphanSectionIds().length;
  toast(orphans ? `已換領域 — ${orphans} 個章節的內容暫時收起，沒有刪除` : "已換領域");
  render();
});

document.getElementById("btn-prev")?.addEventListener("click", () => {
  if (idx > 0) {
    store.setActiveSection(sections()[idx - 1]!.id);
    idx--;
    render();
  }
});

document.getElementById("btn-next")?.addEventListener("click", () => {
  const list = sections();
  if (idx < list.length - 1) {
    store.setActiveSection(list[idx + 1]!.id);
    idx++;
    render();
  } else {
    toast("所有章節已走完 — 可送出審閱");
  }
});

/** 使用者按了取消。`undefined` 是「不必問」，兩者在送審路徑上是相反的決定 */
const CANCELLED = Symbol("submit-cancelled");

/**
 * 送審前逐關指派。
 *
 * 只在**第一次落地流程**時問（S2）—— 已落地的案子重送審直接送，改人走簽核頁的
 * `reassignCaseStage`，那條路徑會留下紀錄。「這次會不會落地」的判斷不在這裡重寫，
 * 一律問 `store.submitPlan()`：UI 自己算一份的話兩份會分岔，而症狀是
 * 「對話框問了指派，送審卻沒套用」—— 沒有錯誤訊息，看起來像使用者自己沒選。
 */
async function askStageAssignments(): Promise<Assignments | undefined | typeof CANCELLED> {
  const plan = store.submitPlan();
  if (!plan.landsNow || plan.stages.length === 0) return undefined;

  const st = store.get();
  const project = activeProject();
  const sections = project ? store.sectionsFor(project.id) : st.sections;
  const cat = project?.templateCat;
  const defaults = buildAssignments(plan.stages, st.employees, st.currentUser);

  const res = await askCustom({
    title: "送出審閱前，先決定每一關派給誰",
    body: `這份流程是照「${cat ? FULL_CAT_LABEL[cat] : "精簡型"}」骨架加上領域包算出來的，送出後就跟著這個案子走。之後要改人請到簽核頁改派。`,
    confirmLabel: "送出審閱",
    cancelLabel: "取消",
    bodyHtml: assignDialogHtml(plan.stages, st.employees, st.currentUser, sections, defaults),
    read: readAssignments,
  });
  if (res.action !== "confirm") return CANCELLED;
  return res.value as Assignments;
}

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

  // 指派對話框放在 gate 之後、commit 之前。放在 commit 之後的話，
  // 使用者一按取消就留下一個沒人要的版本快照 —— 而版本清單上看不出它是廢的。
  const assignments = await askStageAssignments();
  if (assignments === CANCELLED) {
    toast("已取消送審");
    return;
  }

  // 送審 = commit：對整份 PRD 拍快照。審閱者看的是這一份，
  // 不是「送審之後又被改過的當下內容」。
  const commit = store.commitForReview("");
  if (!commit.ok) {
    toast(commit.reason ?? "無法送審");
    return;
  }

  // 把這一份 commit 綁進個案 —— 審閱者看的、核准合併的都必須是它。
  // 第三個參數是逐關指派：**只有這一行把對話框的結果交出去**，漏了它
  // 整個對話框就變成一個問完就丟的問卷（Wave 1 F0 的形狀）。
  store.submitForReview(undefined, commit.version!.id, assignments);
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

try {
  // ⌥F 快捷鍵與狀態還原；同步執行，不能靠 rAF（分頁在背景時 rAF 不觸發）
  initFocusMode();
  initHyperfocusGuard();
  render();
} catch (err) {
  failBootOverlay(err);
} finally {
  endBootOverlay();
}
} // end __authed
