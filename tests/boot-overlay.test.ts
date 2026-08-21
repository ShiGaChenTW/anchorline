import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bootErrorText } from "../src/lib/loading-overlay";

/**
 * 開場遮罩（boot overlay）的契約。
 *
 * 起因：`openspec-workspace.html` 在實機上出現過「殼畫好了、標題寫著
 * 載入中…、內容欄整片空白」的一幕。那看起來不像在載入，看起來像壞掉。
 *
 * 修法不是「讓它變快」（快慢視資料量而定，治不完），而是**那段時間不要
 * 給使用者看**：把半透明黑底遮罩寫死在 HTML 裡，第一次 paint 就蓋住，
 * 等第一次 render 完成才收掉。
 *
 * 這一份跟 `openspec-workspace-wiring.test.ts` 同一個路數：對**原始碼字串**
 * 斷言，不 import 頁面模組。理由一樣 —— 側欄的相依鏈會拉到 `import.meta.glob`
 * （Vite 專屬），在 `bun test` 裡直接 throw。而且這裡要守的東西正好是
 * 「HTML 靜態標記」與「腳本有沒有呼叫收掉」，本來就是字串層面的事。
 *
 * 為什麼值得用脆的字串測試守：這四種失敗**全部沒有錯誤訊息**。
 * 漏了靜態標記 → 回到原本那一幕；漏了 `endBootOverlay` → 整頁被自己的
 * 遮罩鎖死。兩種都要有人肉眼看到才會發現。
 */

const ROOT = join(import.meta.dir, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** 進入前需要跑一段 bootstrap 才有內容可看的頁面 —— 遮罩蓋的就是這段 */
const BOOT_PAGES = [
  "dashboard",
  "editor",
  "history",
  "openspec-workspace",
  "overview",
  "projects",
  "releases",
  "review",
  "signoff",
  "tracking",
  "write",
] as const;

describe("bootErrorText", () => {
  test("Error 取 message", () => {
    expect(bootErrorText(new Error("炸了"))).toBe("炸了");
  });

  test("沒有 message 的 Error 退回字串化，不會變成空白", () => {
    expect(bootErrorText(new Error(""))).not.toBe("");
  });

  test("字串原樣通過", () => {
    expect(bootErrorText("壞掉了")).toBe("壞掉了");
  });

  test("物件走 JSON", () => {
    expect(bootErrorText({ code: 42 })).toBe('{"code":42}');
  });

  test("循環參考不會再丟一次例外", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => bootErrorText(cyclic)).not.toThrow();
    expect(bootErrorText(cyclic).length).toBeGreaterThan(0);
  });

  test("null / undefined 有可讀的字，不是空字串", () => {
    expect(bootErrorText(null).length).toBeGreaterThan(0);
    expect(bootErrorText(undefined).length).toBeGreaterThan(0);
  });
});

describe("靜態遮罩標記", () => {
  /**
   * 一定要**寫死在 HTML** 裡。用 JS 建的最快也要等 module 下載、解析、
   * 執行完才出現 —— 而使用者抱怨的正是那段時間。
   */
  test.each(BOOT_PAGES)("%s.html 有 #app-loading-overlay", (page) => {
    const html = read(`${page}.html`);
    expect(html).toContain('id="app-loading-overlay"');
    expect(html).toContain('class="load-back"');
    expect(html).toContain('class="load-box"');
  });

  test.each(BOOT_PAGES)("%s.html 的遮罩排在 app 外殼之前", (page) => {
    const html = read(`${page}.html`);
    const overlay = html.indexOf('id="app-loading-overlay"');
    const shell = html.indexOf('<div class="app"');
    expect(overlay).toBeGreaterThan(-1);
    expect(shell).toBeGreaterThan(-1);
    // 位置對 position:fixed 不影響堆疊，但要在第一個解析區塊裡才蓋得到第一次 paint
    expect(overlay).toBeLessThan(shell);
  });

  test.each(BOOT_PAGES)("%s.html 的 body 一開始就是 aria-busy", (page) => {
    expect(read(`${page}.html`)).toContain('<body aria-busy="true">');
  });

  /**
   * 純 CSS 的逾時說明。JS 那條的硬上限（`autoHideAfter`）只救得了
   * 「module 跑起來但卡住」；救不了「module 根本沒載進來」—— 那種情況
   * 沒有任何 JS 會執行，遮罩會永遠蓋著而且不解釋為什麼。
   *
   * 刻意不用第二段 inline script 來救：這個 repo 已經被「同一段 bootstrap
   * 複製 14 份」燙過一次（見 CLAUDE.md 的主題註冊四層），不再加第二種。
   */
  test.each(BOOT_PAGES)("%s.html 有純 CSS 的逾時說明", (page) => {
    expect(read(`${page}.html`)).toContain('class="load-stall"');
  });

  test("shared.css 有 .load-stall 的樣式與延遲揭露", () => {
    const css = read("shared.css");
    expect(css).toContain(".load-stall");
    expect(css).toContain("load-stall-in");
  });
});

describe("舊的假標題已經清掉", () => {
  /**
   * 遮罩蓋著的時候看不到這些字，但**競態下會閃**：遮罩收掉與第一次
   * render 之間只要有一幀落差，使用者就會看到「載入中…」再跳成真標題。
   * 既然已經有遮罩了，底下就該擺不會誤導的靜態預設值。
   */
  test.each(BOOT_PAGES)("%s.html 的頁首不再寫死載入中", (page) => {
    const html = read(`${page}.html`);
    for (const m of html.matchAll(/<[^>]*data-od-id="(page-title|page-sub|doc-title)"[^>]*>([^<]*)</g)) {
      expect(m[2]).not.toContain("載入中");
    }
  });

  test("review.html 的簽核進度摘要不再寫死載入中", () => {
    const html = read("review.html");
    const m = html.match(/id="approvals-summary"[^>]*>([^<]*)</);
    expect(m).not.toBeNull();
    expect(m?.[1] ?? "").not.toContain("載入中");
  });
});

describe("每一頁都要收掉自己的遮罩", () => {
  /**
   * 漏掉的症狀是所有失敗裡最糟的一種：整頁被自己的遮罩鎖死，
   * 而且畫面上寫著「載入中」—— 看起來像永遠載不完，不像壞掉。
   */
  test.each(BOOT_PAGES)("%s.ts 有接管遮罩", (page) => {
    const src = read(`src/pages/${page}.ts`);
    expect(src).toContain("beginBootOverlay(");
  });

  test.each(BOOT_PAGES)("%s.ts 有把遮罩收掉的路徑", (page) => {
    const src = read(`src/pages/${page}.ts`);
    // overview 由自己的 showLoading/hideLoading 接手，其餘走 endBootOverlay
    expect(/endBootOverlay\(\)|hideLoading\(\)/.test(src)).toBe(true);
  });

  test.each(BOOT_PAGES)("%s.ts 有失敗時的可見錯誤畫面", (page) => {
    expect(read(`src/pages/${page}.ts`)).toContain("failBootOverlay(");
  });

  /**
   * 收掉那一步一定要在 `finally`（或等價的無條件路徑）。放在 try 尾巴
   * 的話，第一次 render 一 throw 就再也不會執行到。
   */
  // overview 用自己的 showLoading/hideLoading；tracking／history 的第一次
  // render 卡在一個 async boot 函式的 await 之後，收掉走的是那個 promise 的
  // `.finally()`，不是字面上的 `finally { }` 區塊 —— 三者都不符合這條正規
  // 表示式，刻意排除。
  const SYNC_FINALLY_PAGES = BOOT_PAGES.filter(
    (p) => p !== "overview" && p !== "tracking" && p !== "history",
  );
  test.each(SYNC_FINALLY_PAGES)("%s.ts 的收掉走 finally", (page) => {
    expect(read(`src/pages/${page}.ts`)).toMatch(/finally\s*\{[^}]*endBootOverlay\(\)/);
  });
});

describe("刻意不轉的地方", () => {
  /**
   * `#uf-state` 是設定頁裡**單一張卡片**的狀態提示（查 UAT 報告格式檔）。
   * 那張卡片在查的時候，設定頁其他每一項都能正常操作 —— 用整頁黑底遮罩
   * 蓋住一個還能用的頁面，是拿使用者的可用性去換一致性。
   *
   * 這一條是刻意寫下來的**決定**，不是漏網之魚。日後想改要先推翻理由。
   */
  test("settings.html 的 #uf-state 維持原地文字提示", () => {
    const html = read("settings.html");
    expect(html).toContain('id="uf-state"');
    expect(html).not.toContain('id="app-loading-overlay"');
  });
});

describe("不叫 <page>.ts 的頁面", () => {
  /**
   * `index.html` 載入的是 `hub.ts`（不是 `index.ts`），所以進不了
   * 依檔名配對的 BOOT_PAGES 迴圈，另外單獨守。
   */
  test("index.html 有靜態遮罩，hub.ts 有接管與收掉", () => {
    const html = read("index.html");
    expect(html).toContain('id="app-loading-overlay"');
    expect(html).toContain('class="load-stall"');
    const src = read("src/pages/hub.ts");
    expect(src).toContain("beginBootOverlay(");
    expect(src).toContain("failBootOverlay(");
    expect(src).toMatch(/finally\s*\{[^}]*endBootOverlay\(\)/);
  });

  /**
   * `uat.html` 載入的是 `uat.ts`，但那個檔案只有 `import "./tracking"` ——
   * 遮罩的接管／收掉邏輯全部借 tracking.ts 的（同一個模組、同一份頂層程式碼、
   * 同一個 `#app-loading-overlay` id，跑在哪個頁面都認得出來）。這裡守的是
   * 「借用關係還在」，不是重複守 tracking.ts 自己的邏輯。
   */
  test("uat.html 有靜態遮罩，uat.ts 借 tracking.ts 的接管邏輯", () => {
    const html = read("uat.html");
    expect(html).toContain('id="app-loading-overlay"');
    const src = read("src/pages/uat.ts");
    expect(src).toContain('import "./tracking"');
  });
});
