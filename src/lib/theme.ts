import type { ThemeId } from "../data/types";

const KEY = "specforge:theme";

const THEMES: Record<ThemeId, { label: string; scheme: "dark" | "light"; bg: string }> = {
  warp: { label: "Warp · 終端", scheme: "dark", bg: "#0c0b0a" },
  kami: { label: "kami · 紙", scheme: "light", bg: "#f5f4ed" },
  github: { label: "GitHub · Dark", scheme: "dark", bg: "#0d1117" },
  claude: { label: "Claude · 陶土", scheme: "light", bg: "#f5f4ed" },
};

function normalize(theme: string | null | undefined): ThemeId {
  return theme && theme in THEMES ? (theme as ThemeId) : "warp";
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
    if (s && s in THEMES) return s as ThemeId;
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
