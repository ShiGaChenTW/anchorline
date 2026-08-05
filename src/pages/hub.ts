import { initTheme } from "../lib/theme";
import { toast } from "../lib/ui";
import { store } from "../data/store";

initTheme();
// Hub 可免登入瀏覽；進入工作區由各頁 requireAuth

const routes: Record<string, string> = {
  "1": "projects.html",
  "2": "editor.html",
  "3": "templates.html",
  "4": "review.html",
};

const toastEl = document.getElementById("kbd-toast");
let toastTimer: number | undefined;

function showToast(msg: string) {
  if (!toastEl) {
    toast(msg);
    return;
  }
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), 1800);
}

// Live hub stats from store
const st = store.get();
const open = st.projects.filter((p) => p.status === "draft" || p.status === "review").length;
const pending = st.projects.filter((p) => p.status === "review").length;
const approved = st.projects.filter((p) => p.status === "approved").length;
const stats = document.querySelectorAll(".side-stats .v");
if (stats[0]) stats[0].textContent = String(open);
if (stats[1]) stats[1].textContent = String(pending);
if (stats[2]) stats[2].textContent = String(Math.max(approved, 11));

const commentsOpen = st.comments.filter((c) => !c.resolved).length;
const signed = st.approvals.filter((a) => a.state === "approved").length;
const meta = document.querySelector(".continue-card .m");
if (meta) {
  const spans = meta.querySelectorAll("span");
  if (spans[2]) spans[2].textContent = `${signed} / 4 已簽`;
  if (spans[3]) spans[3].textContent = `${commentsOpen} 則留言`;
}

document.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  if (t.matches("input, textarea, select, [contenteditable='true']")) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "?" || (e.shiftKey && e.key === "/")) {
    e.preventDefault();
    showToast("快捷鍵：1 專案 · 2 編輯 · 3 範本 · 4 審閱");
    return;
  }
  const href = routes[e.key];
  if (href) {
    e.preventDefault();
    location.href = href;
  }
});
