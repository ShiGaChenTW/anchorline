import { defineConfig, type Plugin } from "vite";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

const UNKNOWN = "unknown";

/**
 * 建置期跑一次 git，取回 stdout。
 *
 * 三件事是刻意的：
 * 1. **參數陣列**，不做字串插值 —— 不經過 shell，沒有引號與跳脫的問題。
 * 2. **`timeout` + `stdio` 把 stdin/stderr 關掉** —— git 若因為任何理由想問問題
 *    （認證、pager），沒有 stdin 它會直接失敗而不是把整個 build 掛在那裡等。
 * 3. **失敗一律降級**。沒裝 git、從 tarball 解出來沒有 `.git`、空 repo 還沒有
 *    HEAD —— 這些都不該讓 build 失敗。少一個雜湊比不能出版本嚴重得多。
 */
function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: root,
      timeout: 5_000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** package.json 的版號。讀檔而不是寫死，才不會跟 `bun run build` 出來的東西對不起來。 */
function packageVersion(): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return UNKNOWN;
    const version = (parsed as { version?: unknown }).version;
    return typeof version === "string" && version.trim() !== "" ? version.trim() : UNKNOWN;
  } catch {
    return UNKNOWN;
  }
}

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

export default defineConfig(({ command }) => ({
  root: ".",
  // Relative base so macOS WKWebView (file://) can load CSS/JS from dist/
  base: "./",
  publicDir: "public",
  define: {
    "import.meta.env.VITE_APP_VARIANT": JSON.stringify(appVariant),
    // 這一組讓狀態列答得出「我現在跑的是哪一份 build」（src/lib/build-info.ts）。
    // `define` 在 `vite dev` 與 `vite build` 兩條路徑都會生效，所以 `tauri dev`
    // 與 `tauri build` 都拿得到值 —— 不需要為兩條路徑各寫一套。
    //
    // dev 帶 `-dev` 後綴：dev server 跟裝好的 bundle 版號一樣時，看到 `1.1.0`
    // 沒辦法分辨自己是在對哪一個東西驗證，而那正是這個功能要解決的問題本身。
    "import.meta.env.VITE_BUILD_VERSION": JSON.stringify(
      command === "serve" ? `${packageVersion()}-dev` : packageVersion(),
    ),
    "import.meta.env.VITE_BUILD_COMMIT": JSON.stringify(git(["rev-parse", "--short", "HEAD"]) ?? UNKNOWN),
    // 有未 commit 的變更就標記。git 讀不到時當乾淨 —— 那個情況 commit 欄位
    // 已經是 `unknown`，再標一個髒只是把同一件事說兩次
    "import.meta.env.VITE_BUILD_DIRTY": JSON.stringify(String(!!git(["status", "--porcelain"]))),
    // 注入 ISO 原始值，顯示格式交給執行期的純函式 —— 那一半才測得動
    "import.meta.env.VITE_BUILD_TIME": JSON.stringify(new Date().toISOString()),
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
        openspec: resolve(root, "openspec.html"),
        review: resolve(root, "review.html"),
        settings: resolve(root, "settings.html"),
        admin: resolve(root, "admin.html"),
        agents: resolve(root, "agents.html"),
        tracking: resolve(root, "tracking.html"),
        history: resolve(root, "history.html"),
        uat: resolve(root, "uat.html"),
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
}));
