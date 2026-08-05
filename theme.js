(function () {
  var KEY = "specforge:theme";
  var THEMES = {
    kami: { label: "kami · 紙", scheme: "light", bg: "#f5f4ed" },
    github: { label: "GitHub · Dark", scheme: "dark", bg: "#0d1117" }
  };
  var root = document.documentElement;

  function migrate(theme) {
    if (theme === "kami" || theme === "github") return theme;
    if (theme === "warp") return "github";
    if (theme === "claude") return "kami";
    return null;
  }

  function normalize(theme) {
    return migrate(theme) || "github";
  }

  function apply(theme) {
    theme = normalize(theme);
    var meta = THEMES[theme];
    root.setAttribute("data-theme", theme);
    root.style.colorScheme = meta.scheme;
    root.style.background = meta.bg;
    if (document.body) {
      document.body.setAttribute("data-theme", theme);
      document.body.style.background = "";
      document.body.style.color = "";
    }
    try { localStorage.setItem(KEY, theme); } catch (_) {}
    document.querySelectorAll("[data-theme-switch]").forEach(function (el) {
      el.querySelectorAll("button[data-theme-value]").forEach(function (btn) {
        var on = btn.getAttribute("data-theme-value") === theme;
        btn.setAttribute("aria-pressed", on ? "true" : "false");
      });
    });
    document.querySelectorAll("[data-theme-label]").forEach(function (n) {
      n.textContent = meta.label;
    });
  }

  function current() {
    try {
      var s = localStorage.getItem(KEY);
      var m = migrate(s);
      if (m) return m;
    } catch (_) {}
    return normalize(root.getAttribute("data-theme"));
  }

  apply(current());
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { apply(current()); });
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-theme-value]");
    if (!btn || !btn.closest("[data-theme-switch]")) return;
    e.preventDefault();
    apply(btn.getAttribute("data-theme-value"));
  });

  window.SpecForgeTheme = { apply: apply, current: current, themes: THEMES };
})();
