import { store } from "../data/store";
import type { Template, TemplateCat } from "../data/types";
import { bindLogout, requireAuth, toRailUser } from "../lib/auth";
import { canEditContent } from "../lib/permissions";
import { initTheme } from "../lib/theme";
import { bindModalDismiss, closeModal, escapeHtml, initMobileNav, openModal, toast, updateUserRailFooter } from "../lib/ui";

const __authed = requireAuth();
if (__authed) {
initTheme();
initMobileNav("templates");
bindModalDismiss("modal");
bindLogout();
{
  const u = store.get().currentUser;
  updateUserRailFooter(toRailUser(u));
}

const CAT_LABEL: Record<TemplateCat, string> = {
  core: "核心",
  security: "資安",
  growth: "成長",
  platform: "平台",
};

let cat: "all" | TemplateCat = "all";
let q = "";
let current: Template | null = null;

function getTemplates(): Template[] {
  return store.get().templates || [];
}

function render() {
  const templates = getTemplates();
  const list = templates.filter((t) => {
    if (cat !== "all" && t.cat !== cat) return false;
    if (q) {
      const s = q.toLowerCase();
      return t.title.toLowerCase().includes(s) || t.blurb.includes(q);
    }
    return true;
  });

  const count = document.getElementById("count");
  if (count) count.textContent = `${list.length} 個範本`;

  const grid = document.getElementById("grid");
  if (!grid) return;

  if (list.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--muted)">沒有符合的範本</div>`;
    return;
  }

  grid.innerHTML = list
    .map(
      (t) => `
    <div class="t-card" data-id="${t.id}" data-od-id="tpl-${t.id}" style="position:relative">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="tag">${CAT_LABEL[t.cat]}</span>
        <button type="button" class="btn btn-sm btn-ghost btn-del-tpl" data-del-id="${t.id}" title="一鍵移除範本" style="color:var(--muted);padding:2px 6px">
          ✕ 移除
        </button>
      </div>
      <h3 style="margin-top:8px">${escapeHtml(t.title)}</h3>
      <p>${escapeHtml(t.blurb)}</p>
      <div class="meta" style="margin-top:auto;padding-top:10px">
        <span>使用 ${t.uses} 次</span>
        <button type="button" class="btn btn-sm btn-ghost btn-open-tpl" data-open-id="${t.id}" style="color:var(--accent);font-weight:600">預覽與套用</button>
      </div>
    </div>
  `,
    )
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
  if (title) title.textContent = current.title;
  if (desc) desc.textContent = current.blurb;
  if (body) body.textContent = current.body;
  openModal("modal");
}

document.querySelectorAll(".tab").forEach((tab) => {
  (tab as HTMLButtonElement).onclick = () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("on"));
    tab.classList.add("on");
    cat = ((tab as HTMLElement).dataset.cat as typeof cat) || "all";
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
  toast("已排入插入 — 開啟編輯器");
  location.href = "editor.html";
});

document.getElementById("btn-custom")?.addEventListener("click", () => {
  const title = prompt("請輸入自訂範本標題：", "新自訂章節骨架");
  if (!title) return;
  const blurb = prompt("請輸入範本簡介：", "用於加速撰寫自訂區塊內容");
  const body = prompt("請輸入 Markdown 內容草稿：", "## 自訂段落\n- **項目 1：** ...\n- **項目 2：** ...");
  if (title && body) {
    const tpl: Template = {
      id: `t_${Date.now()}`,
      cat: "core",
      title,
      blurb: blurb || title,
      uses: 1,
      body,
    };
    store.addTemplate(tpl);
    toast(`已成功新增自訂範本「${title}」`);
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

