/**
 * 全站右鍵選單。
 *
 * Tauri / WKWebView 不提供系統右鍵（複製／貼上都沒有）。
 * 這層自己畫一份，並在 mousedown 時 preventDefault，免得點選單把
 * input 的選取清掉。
 */
import { store } from "../data/store";
import { itemsFromProbe, type CtxProbe, type MenuItem } from "./context-menu-items";
import { toast } from "./ui";

export type { CtxProbe, MenuItem } from "./context-menu-items";
export { itemsFromProbe } from "./context-menu-items";

const MENU_ID = "al-ctx-menu";

export function isEditableField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    if (el.readOnly || el.disabled) return false;
    const t = (el.type || "text").toLowerCase();
    return t !== "button" && t !== "submit" && t !== "checkbox" && t !== "radio" && t !== "file" && t !== "hidden";
  }
  return false;
}

export function probeFromElement(el: Element | null, selection: string): CtxProbe {
  const editable = isEditableField(el);
  const link = el?.closest("a[href]") as HTMLAnchorElement | null;
  const card = el?.closest<HTMLElement>("[data-project-id]");
  const commit = el?.closest<HTMLElement>("[data-hash]");
  const pathEl = el?.closest<HTMLElement>("[data-path], .ft-file, [data-ft-section]");
  const sec = el?.closest<HTMLElement>(".sec");
  let filePath: string | null = pathEl?.dataset.path || pathEl?.getAttribute("title") || null;
  if (pathEl?.classList.contains("ft-file") && !pathEl.dataset.path) {
    filePath = pathEl.getAttribute("title");
  }
  let sectionTitle: string | null = null;
  if (sec) {
    const t = sec.querySelector(".t, .adhd-sec-hint");
    sectionTitle = (t?.textContent || sec.getAttribute("title") || "").trim() || null;
  }
  return {
    editable,
    hasSelection: selection.length > 0,
    href: link?.getAttribute("href") || null,
    projectId: card?.dataset.projectId || null,
    commitHash: commit?.dataset.hash || null,
    filePath,
    sectionTitle,
  };
}

function fieldSelection(el: HTMLInputElement | HTMLTextAreaElement): string {
  const a = el.selectionStart ?? 0;
  const b = el.selectionEnd ?? 0;
  return a === b ? "" : el.value.slice(Math.min(a, b), Math.max(a, b));
}

function snapshotSelection(el: Element | null): string {
  if (isEditableField(el)) return fieldSelection(el);
  return window.getSelection()?.toString() ?? "";
}

async function writeClip(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  }
}

async function readClip(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return "";
  }
}

function insertAtCaret(el: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  const next = el.value.slice(0, start) + text + el.value.slice(end);
  el.value = next;
  const pos = start + text.length;
  el.setSelectionRange(pos, pos);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function closeMenu(): void {
  document.getElementById(MENU_ID)?.remove();
}

function placeMenu(menu: HTMLElement, x: number, y: number): void {
  const pad = 8;
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const left = Math.max(pad, Math.min(x, window.innerWidth - w - pad));
  const top = Math.max(pad, Math.min(y, window.innerHeight - h - pad));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

async function runAction(id: string, el: Element | null, probe: CtxProbe): Promise<void> {
  const field = isEditableField(el) ? el : null;
  if (id === "cut" && field) {
    const text = fieldSelection(field);
    if (!text) return;
    if (await writeClip(text)) {
      insertAtCaret(field, "");
      toast("已剪下");
    }
    return;
  }
  if (id === "copy") {
    const text = field ? fieldSelection(field) : (window.getSelection()?.toString() || "");
    if (!text) return;
    if (await writeClip(text)) toast("已複製");
    return;
  }
  if (id === "paste" && field) {
    const text = await readClip();
    if (!text) {
      toast("剪貼簿是空的，或這個環境不允許讀取");
      return;
    }
    insertAtCaret(field, text);
    return;
  }
  if (id === "select-all" && field) {
    field.focus();
    field.select();
    return;
  }
  if (id === "link-open" && probe.href) {
    location.href = probe.href;
    return;
  }
  if (id === "link-copy" && probe.href) {
    const abs = new URL(probe.href, location.href).href;
    if (await writeClip(abs)) toast("已複製連結");
    return;
  }
  if (id === "copy-hash" && probe.commitHash) {
    if (await writeClip(probe.commitHash)) toast("已複製 commit");
    return;
  }
  if (id === "copy-path" && probe.filePath) {
    if (await writeClip(probe.filePath)) toast("已複製路徑");
    return;
  }
  if (id === "copy-section" && probe.sectionTitle) {
    if (await writeClip(probe.sectionTitle)) toast("已複製章節名");
    return;
  }
  if (probe.projectId && id.startsWith("proj-")) {
    store.setActiveProject(probe.projectId);
    if (id === "proj-dash") location.href = "dashboard.html";
    else if (id === "proj-edit") location.href = "editor.html";
    else if (id === "proj-track") location.href = "tracking.html";
    else if (id === "proj-hist") location.href = "history.html";
    else if (id === "proj-uat") location.href = "uat.html";
    else if (id === "proj-rename") {
      const btn = document.querySelector<HTMLButtonElement>(
        `[data-rename-id="${CSS.escape(probe.projectId)}"]`,
      );
      btn?.click();
    }
  }
}

function renderMenu(items: MenuItem[], x: number, y: number, el: Element, probe: CtxProbe): void {
  closeMenu();
  if (!items.length) return;
  const menu = document.createElement("div");
  menu.id = MENU_ID;
  menu.className = "al-ctx";
  menu.setAttribute("role", "menu");
  menu.innerHTML = items
    .map((it) => {
      if (it.kind === "sep") return `<div class="al-ctx-sep" role="separator"></div>`;
      return `<button type="button" class="al-ctx-item" role="menuitem" data-ctx="${it.id}"${
        it.enabled === false ? " disabled" : ""
      }>${it.label}</button>`;
    })
    .join("");
  document.body.appendChild(menu);
  placeMenu(menu, x, y);

  menu.addEventListener("mousedown", (e) => e.preventDefault());
  menu.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-ctx]");
    if (!btn || btn.disabled) return;
    const id = btn.dataset.ctx;
    if (!id) return;
    closeMenu();
    void runAction(id, el, probe);
  });

  const onDoc = (e: Event) => {
    if (menu.contains(e.target as Node)) return;
    closeMenu();
    document.removeEventListener("mousedown", onDoc, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onDoc);
    window.removeEventListener("scroll", onDoc, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onDoc(e);
    }
  };
  document.addEventListener("mousedown", onDoc, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", onDoc);
  window.addEventListener("scroll", onDoc, true);
}

let installed = false;

/** 全站掛一次。重複呼叫無害。 */
export function installContextMenu(): void {
  if (installed) return;
  installed = true;
  document.addEventListener("contextmenu", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest(`#${MENU_ID}`)) {
      e.preventDefault();
      return;
    }
    const el = t.closest("input, textarea, a, [data-project-id], [data-hash], [data-path], .ft-file, .sec, button, [contenteditable]") ?? t;
    const selection = snapshotSelection(el);
    const probe = probeFromElement(el, selection);
    const items = itemsFromProbe(probe);
    if (!items.length) {
      // 仍擋系統選單：WKWebView 的右鍵要嘛空白、要嘛只有 Inspect
      e.preventDefault();
      return;
    }
    e.preventDefault();
    renderMenu(items, e.clientX, e.clientY, el, probe);
  });
}
