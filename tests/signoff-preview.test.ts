/**
 * 送審前的流程預覽 —— Scott 2026-08-26 實測回報的缺陷。
 *
 * ## 缺陷的形狀
 *
 * ```
 * A. 建專案後，簽核頁顯示：  工程 / 設計 / 資安 / 法務   ← 他看到的
 *    project.workflowStages: undefined
 * B. submitPlan 說送審會建立： AI 結構審查 / 我核准
 * C. 送審後簽核頁變成：       AI 結構審查 / 我核准
 * ```
 *
 * 工程／設計／資安／法務 是 `seed.ts` 的全域預設流程。`addProject` 建專案時就先
 * 開了一個個案（走 `caseForProject` → `workflowFor(p)` → 全域 `state.workflowStages`），
 * 而這個專案真正的骨架要到**第一次送審**才落地。
 *
 * **所以簽核頁在送審前顯示的，是一套送出那一刻就會被整批換掉的關卡。**
 *
 * ## 為什麼這一支要同時持有兩邊
 *
 * 這個缺陷是「畫面顯示的關卡 ≠ 送審會建立的關卡」—— 兩邊各自都是對的，
 * 錯的是它們**不是同一份**。只驗 store 的測試看不到畫面，只驗畫面的測試
 * 不知道送審會做什麼，兩種都會全綠。Wave 2 的 C-1／C-3 就是這樣漏的：
 * source-grep 型測試的解析度到「函式」為止，抓不到函式之間的分岔。
 *
 * 所以這裡每一條合約測試都**同時**握著 `store.submitPlan()` 與
 * `stageListHtml()` 產出的 HTML，逐字比對。
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

// 領域包目錄用 `import.meta.glob`（Vite 專屬），bun 跑不動 —— 換成通用領域。
mock.module("../src/data/domains", () => ({
  BUILTIN_PACKS: {},
  builtinSource: () => null,
  reloadUserPacks: () => {},
  domainPacks: () => ({}),
  isUserPack: () => false,
  listDomains: () => [],
  DEFAULT_DOMAIN: "generic",
}));

const mem = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
};

const { store } = await import("../src/data/store");
const { PREVIEW_DETAIL, signoffCta, signoffStageView, signoffSummary } = await import(
  "../src/lib/signoff"
);
const { PREVIEW_COPY, stageListHtml } = await import("../src/lib/signoff-stages");
import type { Project } from "../src/data/types";

// ── fixtures ────────────────────────────────────────────────
//
// id 帶檔名前綴：`bun test` 全部跑在同一個 process，`store` 是模組層單例，
// 通用 id 會跟別的測試檔撞號。

const SP_ADMIN = "sp-admin";

let seq = 0;
function freshProject(cat?: "lean" | "narrative" | "enterprise" | "agile" | "technical"): string {
  const id = `sp-${++seq}`;
  store.addProject({
    id,
    title: `送審前預覽 ${id}`,
    status: "draft",
    pct: 0,
    owner: "測試管理員",
    domain: "generic",
  } as never);
  store.setActiveProject(id);
  if (cat) store.applyFullTemplate(id, store.get().sections, {}, { cat });
  return id;
}

const proj = (id: string): Project => store.get().projects.find((p) => p.id === id)!;

function viewOf(id: string) {
  const st = store.get();
  return signoffStageView({
    projectId: id,
    plan: store.submitPlan(id),
    c: st.cases[id],
    employees: st.employees,
  });
}

/** 頁面 render 時餵給 `stageListHtml` 的那一組參數，逐項照抄 `pages/signoff.ts` */
function htmlOf(id: string): string {
  const st = store.get();
  return stageListHtml({
    project: proj(id),
    user: st.currentUser,
    c: st.cases[id],
    view: viewOf(id),
    jobs: st.agentJobs,
    sections: store.sectionsFor(id),
    employees: st.employees,
    pending: null,
    now: Date.UTC(2026, 7, 26),
  });
}

/**
 * 從產出的 HTML 裡把關卡名讀回來。
 *
 * 刻意不讀 store、也不讀傳進去的參數 —— 這一支要回答的是「**畫面上**寫了什麼」，
 * 從資料反推的話就退回成一條只驗 store 的測試了。
 */
function namesInHtml(html: string): string[] {
  return [...html.matchAll(/<span class="sg-stage-name">([\s\S]*?)<span class="sg-mode"/g)].map(
    (m) => m[1]!.trim(),
  );
}

function ensureEmployee(e: Record<string, unknown>) {
  if (!store.get().employees.some((x) => x.id === e.id)) store.addEmployee(e as never);
}

beforeEach(() => {
  ensureEmployee({
    id: SP_ADMIN,
    name: "測試管理員",
    kind: "human",
    accessRole: "admin",
    active: true,
    isCurrent: true,
  });
  store.setCurrentUser(SP_ADMIN);
});

// ── 缺陷本身 ────────────────────────────────────────────────

describe("缺陷重現：送審前那份個案關卡是假的", () => {
  /**
   * 這一條不驗修好的行為，驗的是**缺陷的前提還在**：`addProject` 開的那份個案
   * 跟送審真的會建立的那一份不一樣。前提哪天沒了（例如有人改掉建個案的時機），
   * 這條會紅 —— 那時整個預覽機制就該重新想，而不是靜靜地繼續畫預覽。
   */
  test("`addProject` 開的個案關卡 ≠ `submitPlan` 會建立的關卡", () => {
    const id = freshProject("technical");
    expect(proj(id).workflowStages).toBeUndefined();

    const existing = store.get().cases[id]!.stages.map((s) => s.name);
    const willBe = store.submitPlan(id).stages.map((s) => s.name);
    expect(store.submitPlan(id).landsNow).toBe(true);
    expect(existing).not.toEqual(willBe);
  });
});

// ── 合約：畫面 ⇔ submitPlan ─────────────────────────────────

describe("送審前，簽核頁畫的是送審時真的會建立的那一份", () => {
  test("HTML 裡的關卡名，逐字等於 `submitPlan().stages` 的關卡名", () => {
    const id = freshProject("technical");
    const plan = store.submitPlan(id);
    expect(namesInHtml(htmlOf(id))).toEqual(plan.stages.map((s) => s.name));
  });

  test("五類骨架各自不同，而畫面每一種都跟著 `submitPlan` 走", () => {
    for (const cat of ["lean", "narrative", "enterprise", "agile", "technical"] as const) {
      const id = freshProject(cat);
      expect(namesInHtml(htmlOf(id))).toEqual(store.submitPlan(id).stages.map((s) => s.name));
    }
  });

  /**
   * 逐字比對名字還不夠：關卡 id 對不上的話，送審之後畫面會整批換掉，
   * 使用者看到的仍然是「跟剛才不是同一份」。這裡要求**整個 CaseStage 逐欄相同** ——
   * 做得到是因為預覽與 `submitForReview` 現在跑的是同一支 `stagesFromWorkflow`。
   */
  test("送審之後真的長出來的關卡，跟送審前預覽的那一份逐欄相同", () => {
    const id = freshProject("enterprise");
    const previewed = viewOf(id).stages;

    store.submitForReview(id, "sp-commit-1");

    expect(store.get().cases[id]!.stages).toEqual(previewed);
    // 而且畫面上的名字也接得起來 —— 送審前後看到的是同一排字
    expect(namesInHtml(htmlOf(id))).toEqual(previewed.map((s) => s.name));
  });
});

// ── 預覽狀態下不得出現註定被擋下來的按鈕 ─────────────────────

describe("預覽狀態下沒有任何簽核動作", () => {
  /**
   * `approveAndLock` / `requestChanges` 對 `status === "draft"` 一律回
   * 「這個案子還沒送出審閱」。給四顆註定被擋下來的按鈕，比不給更糟。
   */
  test("HTML 不含核准／要求修改／保留意見／略過的 `data-sg-act`", () => {
    const id = freshProject("enterprise");
    const html = htmlOf(id);
    expect(viewOf(id).preview).toBe(true);
    expect(html).not.toContain("data-sg-act");
    expect(html).not.toContain("data-sg-confirm");
  });

  test("改派與執行分析也不得出現 —— 那些關卡 id 還不存在於 state.cases", () => {
    const id = freshProject("enterprise");
    const html = htmlOf(id);
    expect(html).not.toContain("data-sg-assign");
    expect(html).not.toContain("data-sg-analyze");
    // 畫面上那些 id 真的還沒有人認得
    const ids = viewOf(id).stages.map((s) => s.id);
    expect(store.get().cases[id]!.stages.some((s) => ids.includes(s.id))).toBe(false);
  });

  test("頭條的主要按鈕不是「核准某一關」，而是「去編輯台送審」", () => {
    const id = freshProject("enterprise");
    const st = store.get();
    const view = viewOf(id);
    const sum = signoffSummary(st.currentUser, proj(id), view.view, { preview: view.preview });
    // 管理員簽得動任何一關，所以 `mine` 是非空的 —— 缺陷正是從這裡長出來的
    expect(sum.mine.length).toBeGreaterThan(0);
    const cta = signoffCta(sum, { preview: view.preview });
    expect(cta).toEqual({ kind: "link", href: "editor.html", label: "去編輯台送審 →" });
  });

  test("`preview` 為真時 `signoffCta` 永遠不回 approve", () => {
    const id = freshProject("technical");
    const st = store.get();
    const view = viewOf(id);
    const sum = signoffSummary(st.currentUser, proj(id), view.view, { preview: true });
    expect(signoffCta(sum, { preview: true })?.kind).not.toBe("approve");
  });
});

// ── 文案：行為先成立，才准講那句話 ───────────────────────────

describe("頭條文案講的話，跟 submitPlan 真的會做的事對得上", () => {
  /**
   * 上一輪犯過兩次「文案與行為對不上」。這一條是**同時持有兩邊**的合約測試：
   * 先問 store 送審會建立幾關，再要求那句話裡的數字逐字等於它。
   */
  test("預覽那句話裡的關卡數，等於 `submitPlan().stages.length`", () => {
    const id = freshProject("technical");
    const view = viewOf(id);
    const sum = signoffSummary(store.get().currentUser, proj(id), view.view, {
      preview: view.preview,
    });
    const n = store.submitPlan(id).stages.length;
    expect(sum.detail).toBe(PREVIEW_DETAIL(n));
    expect(sum.total).toBe(n);
  });

  test("三件事一句都不能少：這是預覽、送審時才建立、屆時會問你派給誰", () => {
    const detail = PREVIEW_DETAIL(3);
    expect(detail).toContain("預覽");
    expect(detail).toContain("送出審閱時才會");
    expect(detail).toContain("派給誰");
    // 舊那句暗示「眼前這幾關就是要跑的那一份」，而它送出那一刻就會被換掉
    expect(detail).not.toContain("之後才會開始跑");
  });

  test("關卡列上也講得出這是預覽，而不是只有頭條講", () => {
    const html = htmlOf(freshProject("technical"));
    // 頭條在畫面最上面，關卡列可以被捲到單獨看見 —— 只有頭條講的話，
    // 捲下來之後畫面又變回原本那句不成立的話
    expect(html).toContain(PREVIEW_COPY.banner);
    expect(html).toContain(PREVIEW_COPY.note);
    expect(html).toContain(PREVIEW_COPY.kicker);
  });

  test("預覽的關卡不寫「待指派」—— 那聽起來像已經存在的關卡在等人", () => {
    const html = htmlOf(freshProject("technical"));
    expect(html).toContain(PREVIEW_COPY.unassigned);
    expect(html).not.toContain("待指派");
  });
});

// ── 回歸保護：landsNow === false 的案子維持原本行為 ──────────

describe("已經跑過的案子維持原本行為", () => {
  test("送審之後 `preview` 為 false，畫的就是個案自己那一份", () => {
    const id = freshProject("enterprise");
    store.submitForReview(id, "sp-commit-2");

    const view = viewOf(id);
    expect(store.submitPlan(id).landsNow).toBe(false);
    expect(view.preview).toBe(false);
    expect(view.stages).toBe(store.get().cases[id]!.stages);
    expect(view.view).toBe(store.get().cases[id]);
  });

  test("送審之後簽核鈕回來了 —— 預覽不得把功能一起關掉", () => {
    const id = freshProject("enterprise");
    store.submitForReview(id, "sp-commit-3");

    const html = htmlOf(id);
    expect(html).toContain('data-sg-act="approved"');
    expect(html).toContain('data-sg-act="changes_requested"');
    // 管理員的改派下拉也還在
    expect(html).toContain("data-sg-assign");
    expect(namesInHtml(html)).toEqual(store.get().cases[id]!.stages.map((s) => s.name));
  });

  test("送審之後頭條不再講預覽那句話", () => {
    const id = freshProject("technical");
    store.submitForReview(id, "sp-commit-4");

    const view = viewOf(id);
    const sum = signoffSummary(store.get().currentUser, proj(id), view.view, {
      preview: view.preview,
    });
    expect(sum.detail).not.toContain("預覽");
    expect(sum.state).not.toBe("draft");
  });

  /**
   * 抽單的案子 `submitPlanFor` 會判 `landsNow === true`（`live` 取不到抽單的個案），
   * 而重送審確實會把它整份重建。所以它也是預覽 —— 但頭條仍然必須先講「此案已抽單」，
   * 不能被預覽的敘事蓋掉，而且**不給任何 CTA**：抽單的案子沒有一步是現在走得通的。
   */
  test("抽單的案子：頭條照樣講「已抽單」，而且一顆 CTA 都沒有", () => {
    const id = freshProject("technical");
    store.submitForReview(id, "sp-commit-5");
    store.withdrawCase(id, "測試抽單");

    const view = viewOf(id);
    expect(view.preview).toBe(true);
    const sum = signoffSummary(store.get().currentUser, proj(id), view.view, {
      preview: view.preview,
    });
    expect(sum.state).toBe("withdrawn");
    expect(sum.headline).toBe("此案已抽單");
    expect(signoffCta(sum, { preview: view.preview })).toBeNull();
  });
});
