import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

/** file:// + WKWebView rejects assets requested with CORS (crossorigin attr). */
function stripCrossoriginForFileApp(): Plugin {
  return {
    name: "strip-crossorigin-for-file-app",
    enforce: "post",
    transformIndexHtml(html) {
      return html.replace(/\s+crossorigin(?:="[^"]*")?/gi, "");
    },
  };
}

const appVariant = process.env.VITE_APP_VARIANT === "test" ? "test" : "prod";

export default defineConfig({
  root: ".",
  // Relative base so macOS WKWebView (file://) can load CSS/JS from dist/
  base: "./",
  publicDir: "public",
  define: {
    "import.meta.env.VITE_APP_VARIANT": JSON.stringify(appVariant),
  },
  plugins: [stripCrossoriginForFileApp()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Avoid modulepreload polyfill that can break under file://
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        index: resolve(root, "index.html"),
        login: resolve(root, "login.html"),
        onboarding: resolve(root, "onboarding.html"),
        projects: resolve(root, "projects.html"),
        editor: resolve(root, "editor.html"),
        templates: resolve(root, "templates.html"),
        review: resolve(root, "review.html"),
        settings: resolve(root, "settings.html"),
        admin: resolve(root, "admin.html"),
        agents: resolve(root, "agents.html"),
        tracking: resolve(root, "tracking.html"),
      },
    },
  },
  server: {
    port: 5173,
    open: "/index.html",
  },
});
