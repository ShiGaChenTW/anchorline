import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * 新增一頁要改的四個註冊點，每一個漏掉都是「沒有錯誤訊息」的失敗。
 *
 * 這一份守的是 OpenSpec 工作區拆分（2026-08-21）踩過／差點踩到的坑。它刻意
 * 對**原始碼字串**斷言而不是 import 模組 —— `rail-nav.ts` 的相依鏈會拉到
 * `src/data/domains/index.ts` 的 `import.meta.glob`，那是 Vite 專屬 API，
 * 在 `bun test` 裡直接 throw（實測過）。所以全站沒有任何測試 import 得動側欄。
 *
 * 字串斷言確實比較脆，但這裡守的東西值得：這四種失敗的共同症狀都是
 * 「看起來好像沒事」，沒有任何一個會噴錯。
 */

const ROOT = join(import.meta.dir, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("每一頁都要進 vite 的 rollup input", () => {
  /**
   * 漏掉的症狀：`vite dev` 一切正常（dev server 直接吃檔案系統），
   * 但 `bun run build` 不會產出那一頁 —— 正式版點進去是 404。
   * 開發期間完全看不到，只有裝好的 App 才會壞。
   */
  test("有 page 腳本的 HTML 全部登記在 vite.config.ts", () => {
    const vite = read("vite.config.ts");
    const pages = readdirSync(ROOT)
      .filter((f) => f.endsWith(".html"))
      .filter((f) => /<script type="module" src="\/src\/pages\//.test(read(f)));

    expect(pages.length).toBeGreaterThan(10);
    const missing = pages.filter((f) => !vite.includes(`resolve(root, "${f}")`));
    expect(missing).toEqual([]);
  });

  test("openspec-workspace.html 本身有登記", () => {
    expect(read("vite.config.ts")).toContain(`resolve(root, "openspec-workspace.html")`);
  });
});

describe("detectRailPage 的比對順序", () => {
  /**
   * `detectRailPage()` 用 `path.includes(href)` 比對，並且**先依 href 長度由長到短
   * 排序**才掃。少了那個排序，`openspec-workspace.html` 這種「短名是長名前綴」的
   * 情況就會被短的先攔走。
   *
   * 這裡重跑一次同樣的規則（不是 import —— 見檔頭），確認新頁面兩個方向都不誤判。
   * 漏了註冊的症狀：`detectRailPage()` 回 null → `auth.ts` 的
   * `if (page && …) initRailNav(page)` 整段跳過 → 側欄不重建，停在 HTML 裡那份
   * 過期的靜態導覽，而且不報錯。
   */
  const hrefs = [...read("src/lib/rail-nav.ts").matchAll(/href: "([^"]+\.html)"/g)]
    .map((m) => m[1]!)
    // 同一支檔案裡 RAIL_ITEMS 以外的地方也可能出現 href，去重就好
    .filter((h, i, a) => a.indexOf(h) === i);

  /** `detectRailPage()` 的比對規則，逐字重現 */
  function detect(pathname: string): string | null {
    const path = pathname.replace(/\\/g, "/");
    const ordered = [...hrefs].sort((a, b) => b.length - a.length);
    for (const href of ordered) {
      if (path.includes("/" + href) || path.endsWith(href) || path.includes(href)) return href;
    }
    return null;
  }

  test("openspec-workspace.html 有登記在 RAIL_ITEMS", () => {
    expect(hrefs).toContain("openspec-workspace.html");
  });

  test("工作區不會被 OpenSpec 入口攔截", () => {
    expect(detect("/openspec-workspace.html")).toBe("openspec-workspace.html");
    expect(detect("/Users/x/dist/openspec-workspace.html")).toBe("openspec-workspace.html");
  });

  test("OpenSpec 入口也不會被工作區攔截", () => {
    expect(detect("/openspec.html")).toBe("openspec.html");
  });

  test("每一個登記的頁面都認得出自己 —— 沒有互相遮蔽", () => {
    const shadowed = hrefs.filter((h) => detect("/" + h) !== h);
    expect(shadowed).toEqual([]);
  });
});

describe("側欄與狀態列的註冊點", () => {
  test("RailPage union 有 openspec-workspace", () => {
    expect(read("src/lib/rail-nav.ts")).toContain(`| "openspec-workspace"`);
  });

  test("狀態列有對應的頁面名稱（少一個 key 會讓 tsc 擋下來，這裡是說明用）", () => {
    expect(read("src/lib/status-bar.ts")).toContain(`"openspec-workspace": "OpenSpec 工作區"`);
  });

  test("入口掛在專案卡片底下，不是固定側欄項目", () => {
    const railNav = read("src/lib/rail-nav.ts");
    const entry = railNav
      .split("\n")
      .find((l) => l.includes(`href: "openspec-workspace.html"`));
    expect(entry).toBeDefined();
    // editor / tracking 同一類：對某個專案做的事 → hidden，入口在 projActionsHtml
    expect(entry).toContain("hidden: true");
    expect(read("src/lib/rail-projects.ts")).toContain(`href: "openspec-workspace.html"`);
  });
});

describe("防閃爍主題 bootstrap", () => {
  /**
   * CLAUDE.md 的「新增主題必須改四層」：每一份 HTML 的 `<head>` 自帶一份主題
   * 白名單，不在名單就**強制回退且不報錯**。新頁面漏抄或抄錯，症狀是
   * 「切了主題沒反應」而不是任何錯誤訊息。
   *
   * 這裡不比對「有沒有這段字」，而是比對**跟既有頁面逐字相同** —— 抄錯一個
   * 主題名（例如少了 terminal）才抓得到。
   */
  const bootstrapOf = (html: string) =>
    html.match(/<script>\(function\(\)\{try\{var t=localStorage[\s\S]*?<\/script>/)?.[0];

  test("openspec-workspace.html 的 bootstrap 與 editor.html 逐字相同", () => {
    const mine = bootstrapOf(read("openspec-workspace.html"));
    const editor = bootstrapOf(read("editor.html"));
    expect(mine).toBeDefined();
    expect(mine).toBe(editor);
  });

  test("三個主題都在白名單裡", () => {
    const boot = bootstrapOf(read("openspec-workspace.html"))!;
    for (const t of ["kami", "github", "terminal"]) expect(boot).toContain(`${t}:[`);
  });

  test("bootstrap 在 <head> 裡，不在 <body>", () => {
    const html = read("openspec-workspace.html");
    const boot = bootstrapOf(html)!;
    expect(html.indexOf(boot)).toBeLessThan(html.indexOf("</head>"));
  });
});

describe("editor.html 瘦身成 PRD-only", () => {
  const editor = () => read("editor.html");

  test("OpenSpec 檔案清單已經搬走", () => {
    expect(editor()).not.toContain(`id="openspec-list"`);
    expect(editor()).not.toContain(`id="os-files"`);
  });

  test("Function wish list 已經搬走（Scott 拍板：歸 OpenSpec）", () => {
    expect(editor()).not.toContain(`id="os-wish"`);
  });

  test("PRD 那四塊留著：章節大綱、領域選單、孤兒面板、專案檔案樹", () => {
    const h = editor();
    for (const id of ["outline", "domain-select", "orphan-panel", "file-tree"]) {
      expect(h).toContain(`id="${id}"`);
    }
  });

  test("教練欄不動", () => {
    expect(editor()).toContain(`id="coach-body"`);
  });
});

describe("openspec-workspace.html 的三欄", () => {
  const html = () => read("openspec-workspace.html");

  test("左欄四塊都在", () => {
    const h = html();
    for (const id of ["osw-changes", "os-files", "os-wish", "file-tree"]) {
      expect(h).toContain(`id="${id}"`);
    }
  });

  test("中欄是原始檔案檢視的落點", () => {
    expect(html()).toContain(`id="editor-body"`);
  });

  test("右欄用 coach class —— resize-panels 靠它認出第三欄", () => {
    const h = html();
    // 認不出來時 initWorkbenchResize 只寫三軌的 grid-template-columns，
    // 第四個 grid item 會被擠到第二列，版面塌掉而且不報錯
    expect(h).toContain(`class="wb-col coach"`);
    expect(h).toContain(`data-od-id="coach-col"`);
  });

  test("載入自己的 page 腳本", () => {
    expect(html()).toContain(`src="/src/pages/openspec-workspace.ts"`);
  });
});

describe("檔案樹的 data-ft-path", () => {
  /**
   * OpenSpec 工作區靠這個屬性把「點檔案樹的檔」接到中欄開檔。
   * 之前只有 `title`，那是給滑鼠看的，不是 API。
   */
  test("renderFileTreeHtml 會輸出 data-ft-path", () => {
    expect(read("src/lib/file-tree.ts")).toContain("data-ft-path=");
  });
});

describe("store 的兩個新欄位", () => {
  const store = () => read("src/data/store.ts");

  test("seed 有預設值", () => {
    expect(store()).toContain(`activeOpenSpecChange: ""`);
    expect(store()).toContain(`activeOpenSpecFile: ""`);
  });

  test("load() 對舊存檔做正規化", () => {
    // 舊 localStorage 沒有這兩個 key。沒有這一步，undefined 會流進畫面
    expect(store()).toContain(`typeof parsed.activeOpenSpecChange === "string"`);
    expect(store()).toContain(`typeof parsed.activeOpenSpecFile === "string"`);
  });

  test("setter 在值相同時不 emit —— 否則 render 會自我觸發", () => {
    const s = store();
    expect(s).toContain("if (state.activeOpenSpecChange === id) return;");
    expect(s).toContain("if (state.activeOpenSpecFile === path) return;");
  });
});
