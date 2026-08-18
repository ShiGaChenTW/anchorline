// 這個 import 有副作用：一次性把 anchorline:* 的 key 搬到 anchorline:*。
// 放在 theme.ts 是因為 14 個 page 全都匯入它 —— 這是唯一的共同入口。
import "./storage-migrate";

import type { ThemeId } from "../data/types";

const KEY = "anchorline:theme";

const THEMES: Record<ThemeId, { label: string; scheme: "dark" | "light"; bg: string }> = {
  kami: { label: "LIGHT", scheme: "light", bg: "#f5f4ed" },
  github: { label: "DARK", scheme: "dark", bg: "#0d1117" },
  terminal: { label: "TERMINAL", scheme: "dark", bg: "#0d0b08" },
};

/** 舊主題遷移：warp→terminal（warp 本來就是終端機，現在有真的了）、claude→kami */
function migrateLegacy(theme: string | null | undefined): ThemeId | null {
  if (!theme) return null;
  if (theme in THEMES) return theme as ThemeId;
  if (theme === "warp") return "terminal";
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

/**
 * 介面字級倍率。
 *
 * 跟主題一樣走自己的 localStorage key，不進 settings 物件：
 * 它必須在**任何**頁面第一次繪製前就套上，而 initTheme 是 14 個頁面唯一的共同入口。
 * 放進 settings 會多一條「等 store 水合完再套」的路徑，那一瞬間的字級跳動看得出來。
 */
const FS_KEY = "anchorline:font-scale";

export const FONT_SCALES = [
  { id: "compact", label: "緊湊", value: 0.92 },
  { id: "standard", label: "標準", value: 1 },
  { id: "comfy", label: "舒適", value: 1.09 },
  { id: "large", label: "大", value: 1.18 },
] as const;

export type FontScaleId = (typeof FONT_SCALES)[number]["id"];

export function currentFontScale(): FontScaleId {
  const raw = localStorage.getItem(FS_KEY);
  return FONT_SCALES.some((s) => s.id === raw) ? (raw as FontScaleId) : "standard";
}

export function applyFontScale(id: string | null | undefined) {
  const hit = FONT_SCALES.find((s) => s.id === id) ?? FONT_SCALES[1];
  document.documentElement.style.setProperty("--fs-scale", String(hit.value));
  localStorage.setItem(FS_KEY, hit.id);
}

export function initTheme() {
  applyTheme(currentTheme());
  applyFontScale(currentFontScale());
  void import("./context-menu").then((m) => m.installContextMenu());
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement | null;
    const btn = t?.closest?.("[data-theme-value]") as HTMLElement | null;
    if (!btn || !btn.closest("[data-theme-switch]")) return;
    e.preventDefault();
    applyTheme(btn.getAttribute("data-theme-value"));
  });
}

export { THEMES };
