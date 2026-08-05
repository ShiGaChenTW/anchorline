import { store } from "../data/store";
import { updateUserRailFooter } from "./ui";

const SESSION_KEY = "specforge:session:v1";

export function isLoginPage(): boolean {
  const path = location.pathname.replace(/\\/g, "/");
  return path.endsWith("login.html") || path.endsWith("/login");
}

export function requireAuth(): boolean {
  if (isLoginPage()) return true;
  const session = store.get().session;
  if (session?.userId) {
    const user = store.get().employees.find((e) => e.id === session.userId);
    if (user && user.active !== false) {
      if (store.get().currentUser.id !== user.id) {
        store.setCurrentUser(user.id);
      }
      updateUserRailFooter({
        name: user.name,
        role: `${roleBadge(user.accessRole)} · ${user.title}`,
        avatar: user.avatar,
      });
      return true;
    }
  }
  // restore session from dedicated key if store was wiped partially
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const s = JSON.parse(raw) as { userId: string };
      if (s.userId && store.login(s.userId, undefined, true)) {
        return requireAuth();
      }
    }
  } catch {
    /* ignore */
  }
  location.href = "login.html";
  return false;
}

export function persistSession(userId: string | null) {
  try {
    if (!userId) localStorage.removeItem(SESSION_KEY);
    else localStorage.setItem(SESSION_KEY, JSON.stringify({ userId, at: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function roleBadge(role: string): string {
  if (role === "admin") return "管理員";
  if (role === "approver") return "核准";
  if (role === "editor") return "編輯";
  return role;
}

export function bindLogout(btnId = "btn-logout") {
  const handler = () => {
    store.logout();
    location.href = "login.html";
  };
  // 支援多顆登出鈕；避免重複 id 時只綁到第一顆
  document.querySelectorAll(`#${btnId}, [data-logout], .btn-logout`).forEach((el) => {
    el.addEventListener("click", handler);
  });
}
