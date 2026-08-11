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
        write: resolve(root, "write.html"),
        signoff: resolve(root, "signoff.html"),
        dashboard: resolve(root, "dashboard.html"),
        overview: resolve(root, "overview.html"),
        templates: resolve(root, "templates.html"),
        review: resolve(root, "review.html"),
        settings: resolve(root, "settings.html"),
        admin: resolve(root, "admin.html"),
        agents: resolve(root, "agents.html"),
        tracking: resolve(root, "tracking.html"),
        releases: resolve(root, "releases.html"),
      },
    },
  },
  server: {
    port: 5173,
    open: "/overview.html",
    watch: {
      // `tauri dev` 在 src-tauri/target 底下重建時會產生成千上萬個檔案，
      // 其中 tauri-codegen 的產物是 .html —— vite 認得，於是每建一次就整批
      // page reload，多跑幾輪 dev server 會被自己洗死。
      // 這裡沒有任何原始碼，監看它沒有任何好處。
      ignored: ["**/src-tauri/target/**", "**/dist/**"],
    },
  },
});
