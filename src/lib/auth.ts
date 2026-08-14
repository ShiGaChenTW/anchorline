import { store } from "../data/store";
import type { Employee } from "../data/types";
import { summarizePermissions } from "./permissions";
import { initAdhdUi } from "./adhd-ui";
import { detectRailPage, initRailNav, refreshNavCounts } from "./rail-nav";
import { bindRailProjects, renderRailProjects } from "./rail-projects";
import { initResizablePanels } from "./resize-panels";
import { initStatusBar } from "./status-bar";
import { updateUserRailFooter, type RailUserInfo } from "./ui";

let railProjectsBound = false;
let resizeBound = false;
let adhdBound = false;
let statusBarBound = false;
let welcomeBound = false;
let uatHandoffBound = false;

const SESSION_KEY = "anchorline:session:v1";

export function isLoginPage(): boolean {
  const path = location.pathname.replace(/\\/g, "/");
  return path.endsWith("login.html") || path.endsWith("/login");
}

/** 把 Employee 轉成側欄使用者面板資料 */
export function toRailUser(user: Employee): RailUserInfo {
  return {
    name: user.name,
    avatar: user.avatar,
    title: user.title,
    accessRole: user.accessRole,
    kind: user.kind,
    agentFamily: user.agentFamily,
    perms: summarizePermissions(user),
  };
}

export function requireAuth(): boolean {
  if (isLoginPage()) return true;
  // 正式版首次使用：導向引導（onboarding 頁自身會放行）
  const path = location.pathname.replace(/\\/g, "/");
  const onOnboarding = path.endsWith("onboarding.html") || path.endsWith("/onboarding");
  if (store.needsOnboarding() && !onOnboarding) {
    location.href = "onboarding.html";
    return false;
  }
  if (onOnboarding) return true;

  const session = store.get().session;
  if (session?.userId) {
    const user = store.get().employees.find((e) => e.id === session.userId);
    if (user && user.active !== false && user.id !== "__setup__") {
      if (store.get().currentUser.id !== user.id) {
        store.setCurrentUser(user.id);
      }
      updateUserRailFooter(toRailUser(user));
      if (document.querySelector(".rail-nav") || document.querySelector(".wb")) {
        queueMicrotask(() => {
          // 每頁 load 都重建一次側欄（icon 完整、無重複節點）
          const page = detectRailPage();
          if (page && document.querySelector(".rail-nav")) initRailNav(page);
          if (document.querySelector(".rail-nav")) {
            if (!railProjectsBound) {
              railProjectsBound = true;
              bindRailProjects();
            } else {
              renderRailProjects();
            }
            refreshNavCounts();
          }
          if (!resizeBound) {
            resizeBound = true;
            initResizablePanels();
          } else if (document.querySelector(".wb") && !document.querySelector(".resize-handle--outline")) {
            initResizablePanels();
          }
          if (!adhdBound) {
            adhdBound = true;
            // rail 已建完再套 ADHD 層
            requestAnimationFrame(() => initAdhdUi());
          }
          if (!welcomeBound) {
            welcomeBound = true;
            // 「開啟時」的歡迎畫面：接在共用 bootstrap 而不是某一頁，
            // 因為 agent 交接會直接落在編輯台，接在 projects 就永遠不會跳。
            // 首次導覽優先；其餘由 welcome 自己判斷（今日靜音、是否桌面版）。
            window.setTimeout(() => {
              if (document.getElementById("tour-root")) return;
              // UAT 著陸中不彈歡迎 modal。被 CLI 叫醒的那一刻，這個畫面唯一的
              // 目的就是那份報告 —— 冷啟動的 sessionStorage 是新的，歡迎畫面
              // 必彈，等於在最常見的喚醒路徑上多一道要先解除的門。
              if (new URLSearchParams(location.search).has("uat")) return;
              import("./welcome")
                .then((m) => m.initWelcome())
                .catch(() => {});
            }, 700);
          }
          if (!uatHandoffBound) {
            uatHandoffBound = true;
            // UAT 喚醒鏈。接在共用 bootstrap 而不是 tracking 頁：被 `open -a`
            // 叫起來的那一刻，使用者停在哪一頁是未知的 —— 只掛在 tracking
            // 頁的話，App 停在編輯台時整條鏈不會發生，而且不會有任何錯誤。
            import("./uat-handoff")
              .then((m) => m.initUatHandoff())
              .catch(() => {});
          }
          if (!statusBarBound) {
            statusBarBound = true;
            requestAnimationFrame(() => initStatusBar());
          } else {
            requestAnimationFrame(() => initStatusBar());
          }
        });
      }
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

function doLogout() {
  store.logout();
  location.href = "login.html";
}

let logoutDelegationBound = false;

/**
 * 以 document 事件委派綁定登出，側欄 rebuild 後仍有效、不重複掛載。
 */
export function bindLogout(btnId = "btn-logout") {
  if (logoutDelegationBound) return;
  logoutDelegationBound = true;
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    if (t.closest(`#${btnId}, [data-logout], .btn-logout`)) {
      e.preventDefault();
      doLogout();
    }
  });
}
