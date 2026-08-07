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
  // 底部狀態列同步短暫訊息（與 toast 並行）
  import("./status-bar")
    .then((m) => m.setStatusMessage(msg, Math.max(ms, 2800)))
    .catch(() => {});
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

export type MobileNavPage =
  | "projects"
  | "editor"
  | "templates"
  | "review"
  | "tracking"
  | "admin"
  | "agents"
  | "settings" | "dashboard";

export function initMobileNav(active: MobileNavPage) {
  const app = document.querySelector(".app");
  if (!app || document.querySelector(".mobile-bar")) return;

  const bar = document.createElement("nav");
  bar.className = "mobile-bar";
  bar.setAttribute("aria-label", "行動導覽");
  // 窄屏 5 鍵：專案 / 編輯 / 審閱 / 追蹤 / 設定（其餘走側欄或專案頁）
  const items: { page: MobileNavPage; href: string; label: string }[] = [
    { page: "projects", href: "projects.html", label: "專案" },
    { page: "editor", href: "editor.html", label: "編輯" },
    { page: "review", href: "review.html", label: "審閱" },
    { page: "tracking", href: "tracking.html", label: "追蹤" },
    { page: "settings", href: "settings.html", label: "設定" },
  ];
  // admin / agents / templates 落在「設定」鄰近；若當前是這些頁，高亮設定或對應項
  const highlight =
    active === "admin" || active === "agents" || active === "templates"
      ? active === "templates"
        ? "editor"
        : "settings"
      : active;
  bar.innerHTML = items
    .map(
      (it) =>
        `<a href="${it.href}" data-nav="${it.page}"${
          it.page === highlight || it.page === active ? ' aria-current="page"' : ""
        }>${it.label}</a>`,
    )
    .join("");
  app.appendChild(bar);
}

export type RailUserInfo = {
  name: string;
  avatar: string;
  /** 職稱（非系統權限） */
  title?: string;
  /** 系統角色：admin | approver | editor */
  accessRole?: "admin" | "approver" | "editor";
  kind?: "human" | "agent";
  agentFamily?: string | null;
  /**
   * 相容舊呼叫：單行 `角色 · 職稱`。
   * 有 accessRole/title 時優先用結構化欄位。
   */
  role?: string;
  /** 預先算好的權限 chips；省略則依 accessRole 推導 */
  perms?: string[];
};

const ROLE_LABEL: Record<string, string> = {
  admin: "管理員",
  approver: "核准人員",
  editor: "編輯人員",
};

const ROLE_TONE: Record<string, string> = {
  admin: "role-tone-admin",
  approver: "role-tone-approver",
  editor: "role-tone-editor",
};

function defaultPerms(accessRole?: string): string[] {
  if (accessRole === "admin") return ["全部權限"];
  if (accessRole === "approver") return ["簽核", "匯出", "唯讀"];
  if (accessRole === "editor") return ["編輯", "刪除", "覆核", "匯出"];
  return [];
}

function kindLabel(kind?: string, family?: string | null): string {
  if (kind === "agent") {
    const fam = family && family !== "other" ? family : "agent";
    return `Agent · ${fam}`;
  }
  return "人員";
}

/**
 * 側欄底部：目前使用者身分 + 系統角色 + 權限摘要。
 * 會重建 `.rail-foot` 結構（保留並重新綁定登出鈕）。
 */
export function updateUserRailFooter(user: RailUserInfo) {
  const foot = document.querySelector(".rail-foot");
  if (!foot) return;

  const accessRole = user.accessRole;
  const roleLabel =
    (accessRole && ROLE_LABEL[accessRole]) ||
    (user.role ? user.role.split("·")[0]?.trim() : "") ||
    "—";
  const title =
    user.title ||
    (user.role && user.role.includes("·") ? user.role.split("·").slice(1).join("·").trim() : "") ||
    "";
  const perms = user.perms?.length ? user.perms : defaultPerms(accessRole);
  const tone = (accessRole && ROLE_TONE[accessRole]) || "role-tone-editor";
  const kind = kindLabel(user.kind, user.agentFamily);
  const avatarText = user.avatar || user.name.slice(0, 1) || "?";
  const permsTitle = perms.length ? `系統權限：${perms.join("、")}` : "系統權限";

  foot.classList.add("rail-foot--user");
  foot.setAttribute("aria-label", "目前使用者");
  foot.innerHTML = `
    <div class="rail-user">
      <div class="avatar" data-user-avatar aria-hidden="true">${escapeHtml(avatarText)}</div>
      <div class="rail-user-body">
        <div class="rail-user-top">
          <div class="rail-foot-meta" data-user-meta>
            <div class="rail-foot-name">${escapeHtml(user.name)}</div>
            ${title ? `<div class="rail-foot-title">${escapeHtml(title)}</div>` : ""}
          </div>
          <button type="button" class="btn btn-sm btn-ghost btn-logout" data-logout title="登出">登出</button>
        </div>
        <div class="rail-user-role-row">
          <span class="role-badge ${tone}" data-user-role-badge title="系統存取角色">${escapeHtml(roleLabel)}</span>
          <span class="rail-user-kind" data-user-kind>${escapeHtml(kind)}</span>
        </div>
        <div class="rail-user-perms" data-user-perms title="${escapeHtml(permsTitle)}" role="list" aria-label="權限摘要">
          ${perms.map((p) => `<span class="perm-chip" role="listitem">${escapeHtml(p)}</span>`).join("")}
        </div>
      </div>
    </div>
  `;
}
