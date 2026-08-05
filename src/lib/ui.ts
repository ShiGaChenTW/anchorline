export function toast(msg: string, ms = 2200) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  const prev = (el as HTMLElement & { _t?: number })._t;
  if (prev) window.clearTimeout(prev);
  (el as HTMLElement & { _t?: number })._t = window.setTimeout(() => {
    el?.classList.remove("show");
  }, ms);
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function openModal(id: string) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.add("open");
  const focusable = m.querySelector<HTMLElement>("input, textarea, select, button");
  focusable?.focus();
}

export function closeModal(id: string) {
  document.getElementById(id)?.classList.remove("open");
}

export function bindModalDismiss(id: string) {
  const m = document.getElementById(id);
  if (!m) return;
  m.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).id === id) closeModal(id);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && m.classList.contains("open")) closeModal(id);
  });
}

export function initMobileNav(
  active: "projects" | "editor" | "templates" | "review" | "settings" | "admin",
) {
  const app = document.querySelector(".app");
  if (!app || document.querySelector(".mobile-bar")) return;

  const bar = document.createElement("nav");
  bar.className = "mobile-bar";
  bar.setAttribute("aria-label", "行動導覽");
  bar.innerHTML = `
    <a href="projects.html" data-nav="projects"${active === "projects" ? ' aria-current="page"' : ""}>專案</a>
    <a href="editor.html" data-nav="editor"${active === "editor" ? ' aria-current="page"' : ""}>編輯</a>
    <a href="review.html" data-nav="review"${active === "review" ? ' aria-current="page"' : ""}>審閱</a>
    <a href="admin.html" data-nav="admin"${active === "admin" ? ' aria-current="page"' : ""}>管理</a>
    <a href="settings.html" data-nav="settings"${active === "settings" ? ' aria-current="page"' : ""}>設定</a>
  `;
  app.appendChild(bar);
}

export function updateUserRailFooter(user: { name: string; role: string; avatar: string }) {
  const avatarEl = document.querySelector(".rail-foot .avatar");
  const textContainer = document.querySelector(".rail-foot > div:last-child");
  if (avatarEl) avatarEl.textContent = user.avatar || user.name.slice(0, 1);
  if (textContainer) {
    textContainer.innerHTML = `<div style="font-weight:600;color:var(--fg);font-size:12.5px">${escapeHtml(user.name)}</div><div>${escapeHtml(user.role)}</div>`;
  }
}
