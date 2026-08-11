import { store } from "../data/store";
import { templateKind } from "../data/types";
import type { Template, TemplateCat, TemplateKind } from "../data/types";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import { canEditContent } from "../lib/permissions";
import { initTheme } from "../lib/theme";
import { bindModalDismiss, closeModal, escapeHtml, initMobileNav, openModal, toast, updateUserRailFooter } from "../lib/ui";
import {
  blankPackSource,
  listManagedPacks,
  packErrors,
  packSource,
  projectsUsing,
  removePack,
  savePack,
  storageNote,
  summarize,
  type ManagedPack,
} from "../lib/domain-pack-manage";
import PACK_TEMPLATE_MD from "../data/domains/_template.md?raw";

const __authed = requireAuth();
if (__authed) {
initTheme();
initMobileNav("templates");
bindModalDismiss("modal");
bindModalDismiss("dp-modal");
bindLogout();
{
  const u = store.get().currentUser;
  updateUserRailFooter(toRailUser(u));
}

const CAT_LABEL: Record<TemplateCat, string> = {
  // 章節範本
  core: "核心",
  security: "資安",
  growth: "成長",
  platform: "平台",
  openspec: "OpenSpec",
  delivery: "交付",
  research: "研究",
  // 整份 PRD 範本
  lean: "精簡型",
  narrative: "敘事型",
  enterprise: "完整型",
  agile: "敏捷型",
  technical: "技術型",
};

/** 分類的歸屬是資料，不是 UI 的猜測 —— 換 kind 就換一組分頁 */
const KIND_CATS: Record<TemplateKind, TemplateCat[]> = {
  full: ["lean", "narrative", "enterprise", "agile", "technical"],
  section: ["core", "security", "growth", "platform", "openspec", "delivery", "research"],
};

/**
 * 第三個分頁「領域包」不是範本 —— 它是**產生**章節骨架的東西。
 * 放在同一頁是因為使用者要問的是同一個問題：「這份 PRD 該長什麼樣？」
 */
type Tab = TemplateKind | "domain";

const KIND_TAB_LABEL: Record<Tab, string> = {
  full: "整份 PRD 範本",
  section: "章節範本",
  domain: "領域包",
};

const KIND_HINT: Record<Tab, string> = {
  full: "整份 PRD 的章節結構 — 插入後會落在最後一章「自訂章節」，再依序搬進各章",
  section: "單一章節的段落骨架 — 插入後會落在最後一章「自訂章節」",
  domain: "領域包決定 PRD 有哪些章節、哪些結構檢查會擋簽核 — 改這裡等於改整份 PRD 的骨架",
};

let kind: Tab = "full";
let cat: "all" | TemplateCat = "all";
let q = "";
let current: Template | null = null;

function getTemplates(): Template[] {
  return store.get().templates || [];
}

/** 整份範本的卡片要講「這份有幾章」——那是選範本時真正在比的東西 */
function outlineOf(t: Template): string[] {
  return t.body
    .split("\n")
    .filter((l) => /^#{1,3} /.test(l))
    .map((l) => l.replace(/^#{1,3} /, "").trim())
    .filter(Boolean);
}

function renderCatTabs() {
  const host = document.getElementById("cat-tabs");
  if (!host) return;
  // 領域包沒有分類軸 —— 它只有「內建 / 自訂」，那是卡片上的標籤不是篩選器
  const cats = kind === "domain" ? [] : KIND_CATS[kind];
  host.hidden = kind === "domain";
  host.innerHTML = kind === "domain" ? "" : [
    `<button type="button" class="tab${cat === "all" ? " on" : ""}" data-cat="all">全部</button>`,
    ...cats.map(
      (c) => `<button type="button" class="tab${cat === c ? " on" : ""}" data-cat="${c}">${CAT_LABEL[c]}</button>`,
    ),
  ].join("");
  host.querySelectorAll(".tab").forEach((tab) => {
    (tab as HTMLButtonElement).onclick = () => {
      cat = ((tab as HTMLElement).dataset.cat as typeof cat) || "all";
      render();
    };
  });

  document.querySelectorAll("#kind-tabs .tab").forEach((tab) => {
    const k = (tab as HTMLElement).dataset.kind as Tab;
    tab.classList.toggle("on", k === kind);
  });
  const hint = document.getElementById("kind-hint");
  if (hint) hint.textContent = KIND_HINT[kind];
  const add = document.getElementById("btn-custom");
  if (add) add.textContent = kind === "domain" ? "＋ 新增領域包" : "＋ 自訂範本";
}

const ORIGIN_LABEL: Record<ManagedPack["origin"], string> = {
  builtin: "內建",
  custom: "自訂",
  override: "自訂（覆寫內建）",
};

function renderDomainPacks() {
  const packs = listManagedPacks().filter((p) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return p.name.toLowerCase().includes(s) || p.displayName.includes(q) || (p.industry ?? "").includes(q);
  });

  const count = document.getElementById("count");
  if (count) count.textContent = `${packs.length} 個領域包 · ${storageNote()}`;

  const grid = document.getElementById("grid");
  if (!grid) return;

  // 解析失敗的檔案要看得見。默默少一個領域包＝那個領域的專案靜靜退回通用章節
  const errs = packErrors()
    .map(
      (e) =>
        `<div class="t-card" style="border-color:var(--warn,#d9534f)">
           <span class="tag">解析失敗</span>
           <h3 style="margin-top:8px">${escapeHtml(e.file)}</h3>
           <p>${escapeHtml(e.message)}</p>
         </div>`,
    )
    .join("");

  grid.innerHTML =
    errs +
    packs
      .map((p) => {
        const used = projectsUsing(p.name);
        return `
    <div class="t-card" data-od-id="pack-${p.name}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span class="tag">${ORIGIN_LABEL[p.origin]}</span>
        ${p.internal ? `<span class="mono" style="color:var(--muted);font-size:var(--fs-2)">內部</span>` : ""}
      </div>
      <h3 style="margin-top:8px">${escapeHtml(p.displayName)}</h3>
      <p class="mono" style="color:var(--muted);font-size:var(--fs-2);margin:0">${escapeHtml(p.name)}${p.industry ? ` · ${escapeHtml(p.industry)}` : ""}</p>
      <p style="margin:8px 0 0">新增 ${p.sections} 個章節 · ${p.gates} 條結構檢查${used ? ` · ${used} 個專案在用` : ""}</p>
      <div class="meta" style="margin-top:auto;padding-top:10px;gap:8px">
        <span></span>
        <button type="button" class="btn btn-sm btn-ghost btn-edit-pack" data-pack="${p.name}" style="color:var(--accent);font-weight:600">
          ${p.origin === "builtin" ? "以此為底稿編輯" : "編輯"}
        </button>
      </div>
    </div>`;
      })
      .join("");

  grid.querySelectorAll(".btn-edit-pack").forEach((btn) => {
    (btn as HTMLButtonElement).onclick = () => openPackEditor((btn as HTMLElement).dataset.pack!);
  });
}

function render() {
  renderCatTabs();
  if (kind === "domain") {
    renderDomainPacks();
    return;
  }
  const templates = getTemplates();
  const list = templates.filter((t) => {
    if (templateKind(t) !== kind) return false;
    if (cat !== "all" && t.cat !== cat) return false;
    if (q) {
      const s = q.toLowerCase();
      return t.title.toLowerCase().includes(s) || t.blurb.includes(q);
    }
    return true;
  });

  const count = document.getElementById("count");
  if (count) count.textContent = `${list.length} 個${KIND_TAB_LABEL[kind]}`;

  const grid = document.getElementById("grid");
  if (!grid) return;

  if (list.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--muted)">沒有符合的範本</div>`;
    return;
  }

  grid.innerHTML = list
    .map((t) => {
      const outline = outlineOf(t);
      const struct =
        templateKind(t) === "full"
          ? `<p class="mono" style="color:var(--muted);font-size:var(--fs-2);margin:6px 0 0">${outline.length} 個段落 · ${escapeHtml(outline.slice(0, 3).join(" / "))}${outline.length > 3 ? " …" : ""}</p>`
          : "";
      const src = t.source
        ? `<p style="color:var(--muted);font-size:var(--fs-2);margin:6px 0 0">出處：${escapeHtml(t.source)}</p>`
        : "";
      return `
    <div class="t-card" data-id="${t.id}" data-od-id="tpl-${t.id}" style="position:relative">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="tag">${CAT_LABEL[t.cat]}</span>
        <button type="button" class="btn btn-sm btn-ghost btn-del-tpl" data-del-id="${t.id}" title="一鍵移除範本" style="color:var(--muted);padding:2px 6px">
          ✕ 移除
        </button>
      </div>
      <h3 style="margin-top:8px">${escapeHtml(t.title)}</h3>
      <p>${escapeHtml(t.blurb)}</p>
      ${struct}
      ${src}
      <div class="meta" style="margin-top:auto;padding-top:10px">
        <span>使用 ${t.uses} 次</span>
        <button type="button" class="btn btn-sm btn-ghost btn-open-tpl" data-open-id="${t.id}" style="color:var(--accent);font-weight:600">預覽與套用</button>
      </div>
    </div>
  `;
    })
    .join("");

  grid.querySelectorAll(".btn-open-tpl").forEach((btn) => {
    (btn as HTMLButtonElement).onclick = (e) => {
      e.stopPropagation();
      openTpl((btn as HTMLElement).dataset.openId!);
    };
  });

  grid.querySelectorAll(".btn-del-tpl").forEach((btn) => {
    (btn as HTMLButtonElement).onclick = (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.delId!;
      const tpl = templates.find((t) => t.id === id);
      if (tpl && confirm(`確定要移除範本「${tpl.title}」嗎？`)) {
        store.deleteTemplate(id);
        toast(`已移除範本「${tpl.title}」`);
      }
    };
  });
}

function openTpl(id: string) {
  current = getTemplates().find((t) => t.id === id) ?? null;
  if (!current) return;
  const title = document.getElementById("m-title");
  const desc = document.getElementById("m-desc");
  const body = document.getElementById("m-body");
  const src = document.getElementById("m-source");
  if (title) title.textContent = current.title;
  if (desc) desc.textContent = current.blurb;
  if (body) body.textContent = current.body;
  if (src) {
    // 抄範本的人有權知道自己抄的是誰的方法論
    src.hidden = !current.source;
    src.textContent = current.source ? `出處：${current.source}${current.sourceUrl ? ` · ${current.sourceUrl}` : ""}` : "";
  }
  openModal("modal");
}

// ── 領域包編輯器 ────────────────────────────────────────────
//
// 新增與編輯共用一個 modal：兩者的產物都是一份完整的 .md，差別只有底稿從哪來。

/** 正在編哪一個包；null＝新增。內建包會被記成「以此為底稿」，存下去就是覆寫版。 */
let editingPack: { name: string; origin: ManagedPack["origin"] } | null = null;

function dpEl<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function dpStatus(msg: string, tone: "" | "err" | "ok" = "") {
  const el = dpEl("dp-status");
  if (!el) return;
  el.textContent = msg;
  el.style.color = tone === "err" ? "var(--warn,#d9534f)" : tone === "ok" ? "var(--accent)" : "var(--muted)";
}

function openPackEditor(name: string) {
  const pack = listManagedPacks().find((p) => p.name === name);
  const raw = packSource(name);
  if (!pack || !raw) {
    toast(`讀不到領域包「${name}」的原始碼`);
    return;
  }
  editingPack = { name, origin: pack.origin };
  const ta = dpEl<HTMLTextAreaElement>("dp-raw");
  if (ta) ta.value = raw;
  const title = dpEl("dp-title");
  if (title) title.textContent = `${pack.origin === "builtin" ? "以內建包為底稿" : "編輯"}：${pack.displayName}`;
  const desc = dpEl("dp-desc");
  if (desc) {
    const used = projectsUsing(name);
    desc.textContent =
      pack.origin === "builtin"
        ? "內建包不會被改動。存檔後會產生一份同名的自訂包覆寫它，隨時可以移除還原。"
        : `改動會即時套用到使用這個領域的專案（目前 ${used} 個）。`;
  }
  const del = dpEl<HTMLButtonElement>("dp-delete");
  if (del) del.hidden = pack.origin === "builtin";
  dpStatus("");
  openModal("dp-modal");
}

function openPackCreator() {
  const name = prompt("新領域包的識別碼（英數與底線，例：insurance）：", "my_domain");
  if (!name) return;
  editingPack = null;
  const ta = dpEl<HTMLTextAreaElement>("dp-raw");
  if (ta) ta.value = blankPackSource(PACK_TEMPLATE_MD, name);
  const title = dpEl("dp-title");
  if (title) title.textContent = "新增領域包";
  const desc = dpEl("dp-desc");
  if (desc) desc.textContent = "底稿是內建範本，註解都可以刪。存檔前會先驗格式，驗不過不會存。";
  const del = dpEl<HTMLButtonElement>("dp-delete");
  if (del) del.hidden = true;
  dpStatus("");
  openModal("dp-modal");
}

dpEl("dp-close")?.addEventListener("click", () => closeModal("dp-modal"));

dpEl("dp-check")?.addEventListener("click", () => {
  const raw = dpEl<HTMLTextAreaElement>("dp-raw")?.value ?? "";
  const s = summarize(raw);
  if (!s.ok) {
    dpStatus("格式不合法 — 按「儲存」會看到確切原因（存不進去）", "err");
    return;
  }
  dpStatus(`格式讀得動：${s.sections} 個章節、${s.gates} 條結構檢查。存檔時還會再驗一次規則指向。`, "ok");
});

dpEl("dp-save")?.addEventListener("click", async () => {
  const raw = dpEl<HTMLTextAreaElement>("dp-raw")?.value ?? "";
  dpStatus("儲存中…");
  const r = await savePack(raw);
  if (!r.ok) {
    dpStatus(`存不進去：${r.reason}`, "err");
    return;
  }
  closeModal("dp-modal");
  toast(
    `已儲存領域包「${r.name}」${r.overrides ? "（覆寫同名內建包）" : ""}${r.persisted === "cache" ? " — 存在本機，尚未落地成 .md" : ""}`,
  );
  render();
});

dpEl("dp-delete")?.addEventListener("click", () => {
  if (!editingPack) return;
  const used = projectsUsing(editingPack.name);
  const warn = used ? `\n\n目前有 ${used} 個專案在用這個領域，移除後會退回通用章節（內容不會消失）。` : "";
  if (!confirm(`確定要移除領域包「${editingPack.name}」嗎？${warn}`)) return;
  const r = removePack(editingPack.name);
  if (!r.ok) {
    dpStatus(r.reason, "err");
    return;
  }
  closeModal("dp-modal");
  toast(
    `已移除「${r.name}」${r.revealsBuiltin ? " — 同名內建包重新生效" : ""}${r.stillOnDisk ? " · 資料夾裡的 .md 還在，重新讀取會再出現" : ""}`,
  );
  render();
});

document.querySelectorAll("#kind-tabs .tab").forEach((tab) => {
  (tab as HTMLButtonElement).onclick = () => {
    kind = ((tab as HTMLElement).dataset.kind as Tab) || "full";
    cat = "all"; // 分類集合換了一組，舊的選擇在新集合裡不存在
    render();
  };
});

document.getElementById("q")?.addEventListener("input", (e) => {
  q = (e.target as HTMLInputElement).value.trim();
  render();
});

document.getElementById("m-close")?.addEventListener("click", () => closeModal("modal"));

document.getElementById("m-delete")?.addEventListener("click", () => {
  if (!current) return;
  if (confirm(`確定要移除範本「${current.title}」嗎？`)) {
    store.deleteTemplate(current.id);
    closeModal("modal");
    toast(`已一鍵移除「${current.title}」`);
  }
});

document.getElementById("m-copy")?.addEventListener("click", async () => {
  if (!current) return;
  try {
    await navigator.clipboard.writeText(current.body);
    toast("已複製 Markdown");
  } catch {
    toast("無法寫入剪貼簿");
  }
});

document.getElementById("m-insert")?.addEventListener("click", (e) => {
  if (!canEditContent(store.get().currentUser)) {
    e.preventDefault();
    toast("核准人員無法插入範本到編輯內文");
    return;
  }
  e.preventDefault();
  if (!current) return;
  store.setPendingInsert(current.body);
  store.bumpTemplateUse(current.id);
  toast("已排入插入 — 開啟編輯器");
  location.href = "editor.html";
});

document.getElementById("btn-custom")?.addEventListener("click", () => {
  if (kind === "domain") {
    openPackCreator();
    return;
  }
  // 建在哪一種、哪一類，跟著當下看的分頁走 —— 使用者在「整份」分頁按新增，
  // 結果東西掉進「章節」分頁看不見，是最容易發生的困惑
  const isFull = kind === "full";
  const title = prompt("請輸入自訂範本標題：", isFull ? "新的整份 PRD 骨架" : "新自訂章節骨架");
  if (!title) return;
  const blurb = prompt("請輸入範本簡介：", isFull ? "自訂的整份 PRD 章節結構" : "用於加速撰寫自訂區塊內容");
  const body = prompt(
    "請輸入 Markdown 內容草稿：",
    isFull ? "# [文件標題]\n\n## 1. 問題\n…\n\n## 2. 提案\n…\n\n## 3. 成功指標\n…" : "## 自訂段落\n- **項目 1：** ...\n- **項目 2：** ...",
  );
  if (title && body) {
    const fallbackCat = KIND_CATS[kind][0];
    const tpl: Template = {
      id: `t_${Date.now()}`,
      kind,
      cat: cat === "all" ? fallbackCat : cat,
      title,
      blurb: blurb || title,
      uses: 1,
      body,
    };
    store.addTemplate(tpl);
    toast(`已成功新增自訂${KIND_TAB_LABEL[kind]}「${title}」`);
  }
});

document.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  if (t.matches("input, textarea, select")) return;
  if (e.key === "/" && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    (document.getElementById("q") as HTMLInputElement | null)?.focus();
  }
});

render();
store.subscribe(render);
} // end __authed

