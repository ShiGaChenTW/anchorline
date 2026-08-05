import type { ThemeId } from "../data/types";

const KEY = "specforge:theme";

const THEMES: Record<ThemeId, { label: string; scheme: "dark" | "light"; bg: string }> = {
  kami: { label: "kami · 紙", scheme: "light", bg: "#f5f4ed" },
  github: { label: "GitHub · Dark", scheme: "dark", bg: "#0d1117" },
};

/** 舊主題遷移：warp→github、claude→kami */
function migrateLegacy(theme: string | null | undefined): ThemeId | null {
  if (!theme) return null;
  if (theme === "kami" || theme === "github") return theme;
  if (theme === "warp") return "github";
  if (theme === "claude") return "kami";
  return null;
}

function normalize(theme: string | null | undefined): ThemeId {
  return migrateLegacy(theme) ?? "github";
}

export function applyTheme(theme: string | null | undefined) {
  const id = normalize(theme);
  const meta = THEMES[id];
  const root = document.documentElement;
  root.setAttribute("data-theme", id);
  root.style.colorScheme = meta.scheme;
  root.style.background = meta.bg;
  if (document.body) {
    document.body.setAttribute("data-theme", id);
    document.body.style.background = "";
    document.body.style.color = "";
  }
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
  document.querySelectorAll("[data-theme-switch]").forEach((el) => {
    el.querySelectorAll("button[data-theme-value]").forEach((btn) => {
      const on = btn.getAttribute("data-theme-value") === id;
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  });
  document.querySelectorAll("[data-theme-label]").forEach((n) => {
    n.textContent = meta.label;
  });
}

export function currentTheme(): ThemeId {
  try {
    const s = localStorage.getItem(KEY);
    const m = migrateLegacy(s);
    if (m) return m;
  } catch {
    /* ignore */
  }
  return normalize(document.documentElement.getAttribute("data-theme"));
}

export function initTheme() {
  applyTheme(currentTheme());
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement | null;
    const btn = t?.closest?.("[data-theme-value]") as HTMLElement | null;
    if (!btn || !btn.closest("[data-theme-switch]")) return;
    e.preventDefault();
    applyTheme(btn.getAttribute("data-theme-value"));
  });
}

export { THEMES };
