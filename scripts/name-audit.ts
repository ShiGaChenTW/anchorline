#!/usr/bin/env bun
/**
 * name-audit — 產品命名撞名體檢
 *
 * 判準先講死再跑（避免事後找理由）：
 *   npm      套件已存在且週下載 >= 1000        → BLOCK
 *   GitHub   同名 repo 最高 star >= 1000        → BLOCK
 *   App Store 命中同名（tw 或 us）              → BLOCK
 *   .app/.dev 兩個都被註冊                      → WARN（品牌可得性差）
 *   Homebrew formula 同名                       → WARN（CLI 名要換）
 *   以上皆無                                    → CLEAR
 *
 * TIPO 商標第 9/42 類無公開 API，輸出人工檢索清單。
 *
 * 用法：bun run scripts/name-audit.ts anchorline throughline plumbline kedge
 */

const NAMES = process.argv.slice(2);
if (!NAMES.length) {
  console.error("用法：bun run scripts/name-audit.ts <name> [name...]");
  process.exit(1);
}

const TLDS = ["app", "dev", "com"];

type Row = {
  name: string;
  npm: string;
  npmBlock: boolean;
  gh: string;
  ghBlock: boolean;
  appStore: string;
  appStoreBlock: boolean;
  domains: string;
  domainWarn: boolean;
  brew: string;
  brewWarn: boolean;
};

async function json(url: string, init?: RequestInit): Promise<any | null> {
  try {
    const r = await fetch(url, {
      ...init,
      headers: { "User-Agent": "name-audit", ...(init?.headers ?? {}) },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function checkNpm(name: string) {
  const pkg = await json(`https://registry.npmjs.org/${name}`);
  if (!pkg) return { text: "✅ 未占用", block: false };
  const dl = await json(`https://api.npmjs.org/downloads/point/last-week/${name}`);
  const weekly = dl?.downloads ?? 0;
  return {
    text: `⚠️ 已占用（週下載 ${weekly}）`,
    block: weekly >= 1000,
  };
}

async function checkGitHub(name: string) {
  // gh 已 auth，走 gh api 避開未認證的 10 req/min 上限
  const proc = Bun.spawnSync([
    "gh",
    "api",
    "-X",
    "GET",
    "search/repositories",
    "-f",
    `q=${name} in:name`,
    "-f",
    "sort=stars",
    "-f",
    "per_page=3",
  ]);
  if (proc.exitCode !== 0) return { text: "❓ 查詢失敗", block: false };
  const data = JSON.parse(proc.stdout.toString());
  const top = data.items?.[0];
  if (!top || data.total_count === 0) return { text: "✅ 無同名 repo", block: false };
  const stars = top.stargazers_count ?? 0;
  return {
    text: `${stars >= 1000 ? "⛔" : "⚠️"} ${data.total_count} 個・最高 ${top.full_name} (${stars}★)`,
    block: stars >= 1000,
  };
}

async function checkAppStore(name: string) {
  const hits: string[] = [];
  for (const country of ["tw", "us"]) {
    const r = await json(
      `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&country=${country}&entity=software&limit=5`,
    );
    for (const app of r?.results ?? []) {
      const t = String(app.trackName ?? "");
      if (t.toLowerCase().replace(/\s+/g, "") === name.toLowerCase()) {
        hits.push(`${t} (${country})`);
      }
    }
  }
  const uniq = [...new Set(hits)];
  return uniq.length
    ? { text: `⛔ ${uniq.join(", ")}`, block: true }
    : { text: "✅ 無同名 App", block: false };
}

async function checkDomains(name: string) {
  const results = await Promise.all(
    TLDS.map(async (tld) => {
      try {
        const r = await fetch(`https://rdap.org/domain/${name}.${tld}`, {
          headers: { "User-Agent": "name-audit" },
        });
        // 404 = 未註冊；200 = 已註冊；其他 = 無法判定
        if (r.status === 404) return { tld, state: "free" as const };
        if (r.ok) return { tld, state: "taken" as const };
        return { tld, state: "unknown" as const };
      } catch {
        return { tld, state: "unknown" as const };
      }
    }),
  );
  const mark = { free: "✅", taken: "⛔", unknown: "❓" };
  const brandTlds = results.filter((r) => r.tld !== "com");
  return {
    text: results.map((r) => `${mark[r.state]}.${r.tld}`).join(" "),
    warn: brandTlds.every((r) => r.state === "taken"),
  };
}

async function checkBrew(name: string) {
  const f = await json(`https://formulae.brew.sh/api/formula/${name}.json`);
  return f
    ? { text: `⚠️ ${name}（CLI 名要換）`, warn: true }
    : { text: "✅ 無同名", warn: false };
}

const rows: Row[] = [];
for (const name of NAMES) {
  const [npm, gh, appStore, domains, brew] = await Promise.all([
    checkNpm(name),
    checkGitHub(name),
    checkAppStore(name),
    checkDomains(name),
    checkBrew(name),
  ]);
  rows.push({
    name,
    npm: npm.text,
    npmBlock: npm.block,
    gh: gh.text,
    ghBlock: gh.block,
    appStore: appStore.text,
    appStoreBlock: appStore.block,
    domains: domains.text,
    domainWarn: domains.warn,
    brew: brew.text,
    brewWarn: brew.warn,
  });
}

const verdict = (r: Row) =>
  r.npmBlock || r.ghBlock || r.appStoreBlock
    ? "⛔ BLOCK"
    : r.domainWarn || r.brewWarn
      ? "⚠️ WARN"
      : "✅ CLEAR";

// ponytail: 本地時間，plans/ 的檔名慣例是本地日期，不是 UTC
const now = new Date();
const stamp = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  .toISOString()
  .slice(0, 16)
  .replace("T", " ");
const out = [
  `# 命名撞名體檢 — ${NAMES.join(" / ")}`,
  "",
  `> 執行時間：${stamp}（UTC）`,
  `> 判準：npm 週下載 ≥1000 ／ GitHub 同名 ≥1000★ ／ App Store 命中 → BLOCK；品牌 TLD 全被註冊 或 brew 同名 → WARN`,
  "",
  "| 名稱 | 判定 | npm | GitHub | App Store | .app .dev .com | Homebrew |",
  "|---|---|---|---|---|---|---|",
  ...rows.map(
    (r) =>
      `| **${r.name}** | ${verdict(r)} | ${r.npm} | ${r.gh} | ${r.appStore} | ${r.domains} | ${r.brew} |`,
  ),
  "",
  "## 人工待辦：TIPO 商標檢索（無公開 API）",
  "",
  "https://twtmsearch.tipo.gov.tw/ — 第 9 類（電腦軟體）與第 42 類（軟體設計服務）",
  "",
  ...NAMES.map((n) => `- [ ] ${n}`),
  "",
].join("\n");

console.log(out);
await Bun.write(`plans/${stamp.slice(0, 10)}_name-audit.md`, out);
console.error(`\n→ 已寫入 plans/${stamp.slice(0, 10)}_name-audit.md`);
