/**
 * 專案統計 —— 向原生橋要 git / 技術線 / 容量，並把原始數字翻成人看得懂的一句話。
 *
 * 這三件事在 WebView 裡一件都算不出來：看不到磁碟、跑不了 git。
 * 所以瀏覽器版只能顯示「需要桌面版」，不做假資料。
 */

export type GitStats = {
  head: string;
  branch: string;
  lastMessage: string;
  lastAt: string;
  author: string;
  dirtyCount: number;
  remote: string;
  /** -1 代表沒有 upstream（未追蹤遠端），不是 0 */
  ahead: number;
  behind: number;
  tag: string;
  commitCount: number;
  /** 最近 40 筆；refs 來自 %D，含 "HEAD -> main" 與 "tag: v1.2.0" */
  commits?: { hash: string; subject: string; at: string; author: string; refs: string }[];
  /** 依建立時間新到舊 */
  tags?: { name: string; hash: string; at: string; subject?: string }[];
  /** git worktree list --porcelain；第一筆是主工作區 */
  worktrees?: { path: string; head?: string; branch?: string }[];
  /** 本地分支，依最後提交時間新到舊；current="1" 是目前所在 */
  branches?: { name: string; at: string; current: string }[];
};

export type ProjectStats = {
  folderPath: string;
  totalBytes: number;
  fileCount: number;
  extBytes: Record<string, number>;
  extCount: Record<string, number>;
  manifests: string[];
  manifestBodies: { name: string; text: string }[];
  git?: GitStats;
  /** 前端補上，用來顯示「幾分鐘前算的」 */
  measuredAt?: string;
};

/** 副檔名 → 語言。只列會出現在專案裡的，不做全世界的對照表。 */
const EXT_LANG: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript", mts: "TypeScript", cts: "TypeScript",
  js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  swift: "Swift", rs: "Rust", go: "Go", py: "Python", rb: "Ruby",
  java: "Java", kt: "Kotlin", cs: "C#", php: "PHP", dart: "Dart",
  c: "C", h: "C", cpp: "C++", cc: "C++", hpp: "C++", m: "Objective-C", mm: "Objective-C",
  css: "CSS", scss: "CSS", less: "CSS", html: "HTML", vue: "Vue", svelte: "Svelte",
  sh: "Shell", bash: "Shell", zsh: "Shell", sql: "SQL",
  md: "Markdown", markdown: "Markdown", json: "JSON", yaml: "YAML", yml: "YAML", toml: "TOML",
};

/** manifest 內容 → 框架。字串比對即可，不解析 JSON（Cargo.toml 之類根本不是 JSON）。 */
const FRAMEWORK_HINTS: { needle: RegExp; label: string; from: string }[] = [
  { needle: /"react"\s*:/, label: "React", from: "package.json" },
  { needle: /"vue"\s*:/, label: "Vue", from: "package.json" },
  { needle: /"svelte"\s*:/, label: "Svelte", from: "package.json" },
  { needle: /"next"\s*:/, label: "Next.js", from: "package.json" },
  { needle: /"vite"\s*:/, label: "Vite", from: "package.json" },
  { needle: /"astro"\s*:/, label: "Astro", from: "package.json" },
  { needle: /"express"\s*:/, label: "Express", from: "package.json" },
  { needle: /"tailwindcss"\s*:/, label: "Tailwind", from: "package.json" },
  { needle: /"typescript"\s*:/, label: "TypeScript", from: "package.json" },
  { needle: /\btauri\b/i, label: "Tauri", from: "Cargo.toml" },
  { needle: /\baxum\b|\bactix\b|\brocket\b/i, label: "Rust web", from: "Cargo.toml" },
  { needle: /\bdjango\b/i, label: "Django", from: "requirements" },
  { needle: /\bflask\b/i, label: "Flask", from: "requirements" },
  { needle: /\bfastapi\b/i, label: "FastAPI", from: "requirements" },
  { needle: /\brails\b/i, label: "Rails", from: "Gemfile" },
  { needle: /\bspring-boot\b/i, label: "Spring Boot", from: "pom/gradle" },
  { needle: /\bflutter\b/i, label: "Flutter", from: "pubspec.yaml" },
];

export type LanguageSlice = { lang: string; bytes: number; pct: number };

/**
 * 語言佔比按 **位元組** 不按檔案數：一個 6000 行的 CSS 和一個 3 行的 config
 * 都算「一檔」會嚴重失真。
 * 排除 Markdown/JSON/YAML/TOML —— 它們是設定與文件，不是「技術線」。
 */
export function languageBreakdown(stats: ProjectStats): LanguageSlice[] {
  const DOC_LIKE = new Set(["Markdown", "JSON", "YAML", "TOML"]);
  const byLang: Record<string, number> = {};
  for (const [ext, bytes] of Object.entries(stats.extBytes ?? {})) {
    const lang = EXT_LANG[ext];
    if (!lang || DOC_LIKE.has(lang)) continue;
    byLang[lang] = (byLang[lang] ?? 0) + bytes;
  }
  const total = Object.values(byLang).reduce((a, b) => a + b, 0);
  if (!total) return [];
  const all = Object.entries(byLang)
    .map(([lang, bytes]) => ({ lang, bytes, pct: Math.round((bytes / total) * 1000) / 10 }))
    .sort((a, b) => b.bytes - a.bytes);

  // 最多 6 類，尾巴摺成「其他」。超過就開始有相鄰色在 CVD 下分不開，
  // 而且 0% 的段落本身不帶資訊。
  if (all.length <= 6) return all;
  const head = all.slice(0, 5);
  const tailBytes = all.slice(5).reduce((a, x) => a + x.bytes, 0);
  head.push({
    lang: `其他 ${all.length - 5} 種`,
    bytes: tailBytes,
    pct: Math.round((tailBytes / total) * 1000) / 10,
  });
  return head;
}

export function frameworks(stats: ProjectStats): { label: string; from: string }[] {
  const out: { label: string; from: string }[] = [];
  for (const m of stats.manifestBodies ?? []) {
    for (const h of FRAMEWORK_HINTS) {
      if (h.needle.test(m.text) && !out.some((x) => x.label === h.label)) {
        out.push({ label: h.label, from: m.name });
      }
    }
  }
  return out;
}

export function formatBytes(n: number): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / Math.pow(1024, i);
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

/**
 * git 狀態的一句話。ADHD：儀表板的第一行必須是「你現在該做什麼」，
 * 不是一排等待被解讀的數字。
 */
export function gitHeadline(g: GitStats | undefined): { text: string; tone: "ok" | "warn" | "info" } {
  if (!g) return { text: "這個資料夾不是 git 專案", tone: "info" };
  if (g.dirtyCount > 0) {
    return { text: `${g.dirtyCount} 個檔案還沒提交`, tone: "warn" };
  }
  if (g.ahead < 0) {
    return { text: "已提交，但這個分支沒有追蹤遠端", tone: "info" };
  }
  if (g.ahead > 0) {
    return { text: `已提交但還沒推上去（領先 origin ${g.ahead} 個 commit）`, tone: "warn" };
  }
  if (g.behind > 0) {
    return { text: `落後 origin ${g.behind} 個 commit，該拉一下`, tone: "warn" };
  }
  return { text: "乾淨，且和 origin 同步", tone: "ok" };
}

/** 桌面版才有磁碟與 git */
export function isDesktop(): boolean {
  const w = window as Window & {
    __SPECFORGE_NATIVE__?: boolean;
    webkit?: { messageHandlers?: { specforge?: { postMessage: (m: unknown) => void } } };
  };
  return Boolean(w.__SPECFORGE_NATIVE__ || w.webkit?.messageHandlers?.specforge);
}

/** 向原生橋要一次統計。逾時就 reject，不要讓畫面永遠轉圈。 */
export function requestProjectStats(folderPath: string, timeoutMs = 15000): Promise<ProjectStats> {
  return new Promise((resolve, reject) => {
    const w = window as Window & {
      webkit?: { messageHandlers?: { specforge?: { postMessage: (m: unknown) => void } } };
    };
    if (!isDesktop() || !w.webkit?.messageHandlers?.specforge) {
      reject(new Error("需要桌面版 App：瀏覽器看不到磁碟，也跑不了 git"));
      return;
    }

    const timer = window.setTimeout(() => {
      window.removeEventListener("specforge-native", onNative);
      reject(new Error("統計逾時。資料夾很大時可能超過 15 秒"));
    }, timeoutMs);

    function onNative(e: Event) {
      const p = (e as CustomEvent<Record<string, unknown>>).detail;
      if (p?.type === "projectStatsError") {
        cleanupAll();
        reject(new Error(String(p.message ?? "統計失敗")));
        return;
      }
      if (p?.type !== "projectStats") return;
      cleanupAll();
      resolve({ ...(p as unknown as ProjectStats), measuredAt: new Date().toISOString() });
    }
    function cleanupAll() {
      window.clearTimeout(timer);
      window.removeEventListener("specforge-native", onNative);
    }

    window.addEventListener("specforge-native", onNative);
    w.webkit.messageHandlers.specforge.postMessage({ action: "projectStats", folderPath });
  });
}

// ponytail: 框架判定用 regex 掃 manifest 純文字，不解析 JSON/TOML。
// 要的只是「有沒有出現這個依賴」，parse 一份 package.json 為了問一個布林值是浪費。
