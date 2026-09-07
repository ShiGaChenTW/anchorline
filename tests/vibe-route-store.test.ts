/**
 * vibe 路線的 **store 面** —— 三個真的會靜默壞掉的接點：
 *
 * 1. `setProjectRoute` 的持久化：舊寫法 `route === "lite" ? "lite" : undefined`
 *    會把 vibe 存成 undefined＝重載回退 full，與 lite 當年同型的坑
 * 2. gate 接線（決策 5）：vibe 專案掛了帶 gate 的領域包，結果必須與未掛時
 *    完全相同 —— 「忽略領域包」要用一個真的有規則的包來證明，空包證明不了
 * 3. `selfSignVibe`：一鍵自簽寫得進決策紀錄、帶 `anc:t=` 錨點、而且**不鎖案**
 *    （鎖了就升不了檔，試作檔的存在理由就沒了）
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

// 領域包目錄用 `import.meta.glob`（Vite 專屬），bun 跑不動 —— 換成一個
// **帶 gate 規則**的測試包：第 2 點要證明「vibe 忽略領域包」，用空包
// 只能證明「沒東西可忽略」。
mock.module("../src/data/domains", () => ({
  BUILTIN_PACKS: {},
  builtinSource: () => null,
  reloadUserPacks: () => {},
  domainPacks: () => ({
    "vrs-gate-pack": {
      name: "vrs-gate-pack",
      displayName: "vibe 路線測試包",
      gates: [
        {
          rules: [
            {
              id: "vrs-extra-block",
              level: "block",
              label: "測試包追加的 gate",
              detail: "永遠擋（minLength 9999）",
              section: "summary",
              require: { kind: "minLength", n: 9999 },
            },
          ],
        },
      ],
    },
  }),
  isUserPack: () => false,
  listDomains: () => ["vrs-gate-pack"],
  DEFAULT_DOMAIN: "generic",
}));

// store 在 import 時就會讀 localStorage —— 先塞一個最小的實作進去
const mem = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage ??= {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
};

const { migrateProject, store } = await import("../src/data/store");
const { BASE_GATE_SPEC, VIBE_GATE_SPEC } = await import("../src/lib/prd-gates");
const { VIBE_SECTIONS } = await import("../src/lib/prd-triage");
const STORE_SRC = readFileSync(new URL("../src/data/store.ts", import.meta.url), "utf8");

/**
 * 換路線與自簽都要權限：先建一個本檔專屬的 admin 並切成 currentUser。
 * 跑完切回去 —— store 是跨檔單例，留下我的使用者會污染後面的檔。
 */
const ADMIN = "vrs-admin";
const PREV_USER = store.get().currentUser.id;

beforeAll(() => {
  if (!store.get().employees.some((e) => e.id === ADMIN)) {
    store.addEmployee({
      id: ADMIN,
      name: "vibe 路線測試管理員",
      kind: "human",
      accessRole: "admin",
      active: true,
    } as never);
  }
  store.setCurrentUser(ADMIN);
});

afterAll(() => {
  store.setCurrentUser(PREV_USER);
});

/**
 * 讓這個專案通過 `VIBE_GATE_SPEC` 的兩道 block（摘要「做什麼」有填、
 * Non-Goals 至少 1 條）。
 *
 * 自簽現在會查結構 gate —— spec 明寫 vibe 的這兩條**仍為 block**，
 * 而 `freshProject` 建出來的是空白袋。沒有這一步，下面每一條自簽測試
 * 都會被 gate 擋在門口，而那正好是新增的守門在做它該做的事。
 */
function fillVibeGate(id: string) {
  const prev = store.get().activeProjectId;
  store.setActiveProject(id);
  store.setSectionValues("summary", { what: "把試作檔的治理鏈接起來" });
  store.setSectionValues("goals", { nongoals: "- 不做多人簽核" });
  if (prev && prev !== id) store.setActiveProject(prev);
}

/** id 一律帶檔名前綴 —— `bun test` 把所有檔跑在同一個 process 裡，store 是單例 */
function freshProject(id: string, extra: Record<string, unknown> = {}): string {
  if (!store.get().projects.some((p) => p.id === id)) {
    store.addProject({
      id,
      title: `vibe 路線測試 ${id}`,
      status: "draft",
      pct: 0,
      owner: "測試管理員",
      domain: "generic",
      ...extra,
    } as never);
  }
  return id;
}

// ── 3.2 持久化：設 vibe → 序列化 → 讀回仍是 vibe ────────────────

describe("setProjectRoute 持久化", () => {
  test("設 vibe 存得住，經 migrateProject 重載不回退 full", () => {
    const id = freshProject("vrs-persist");
    expect(store.setProjectRoute(id, "vibe").ok).toBe(true);
    const p = store.get().projects.find((x) => x.id === id)!;
    expect(p.route).toBe("vibe");
    // 模擬 localStorage 來回：序列化 → 逐欄位重建。舊三元式在這裡現形 ——
    // route 變 undefined、編輯台長回 15 節、沒有任何錯誤。
    const back = migrateProject(JSON.parse(JSON.stringify(p)), store.get().employees);
    expect(back.route).toBe("vibe");
  });

  test("lite 與 full 的既有語意不變：lite 存 lite、full 存 undefined", () => {
    const id = freshProject("vrs-persist-lite");
    store.setProjectRoute(id, "lite");
    expect(store.get().projects.find((x) => x.id === id)!.route).toBe("lite");
    store.setProjectRoute(id, "full");
    expect(store.get().projects.find((x) => x.id === id)!.route).toBeUndefined();
  });

  test("vibe 專案的章節骨架只剩三節（自訂章節除外）", () => {
    const id = freshProject("vrs-sections", { route: "vibe" });
    const ids = store
      .sectionsFor(id)
      .map((s) => s.id)
      .filter((x) => x !== "custom");
    expect(ids.sort()).toEqual([...VIBE_SECTIONS].sort());
  });
});

// ── 4.2 gate 接線：vibe 一律忽略領域包（決策 5）────────────────

describe("gateSpecFor 依 route 選 spec", () => {
  test("掛了帶 gate 的領域包，vibe 專案的 spec 與未掛時完全相同", () => {
    const bare = freshProject("vrs-gate-bare", { route: "vibe" });
    const packed = freshProject("vrs-gate-packed", { route: "vibe", domain: "vrs-gate-pack" });
    expect(store.gateSpecFor(packed)).toBe(VIBE_GATE_SPEC);
    expect(store.gateSpecFor(packed)).toBe(store.gateSpecFor(bare));
  });

  test("同一個領域包在 full 專案上真的有作用 —— 證明上一條不是因為包壞了", () => {
    const full = freshProject("vrs-gate-full", { domain: "vrs-gate-pack" });
    const spec = store.gateSpecFor(full);
    expect(spec.groups.length).toBe(BASE_GATE_SPEC.groups.length + 1);
    expect(spec.groups.flatMap((g) => g.rules).some((r) => r.id === "vrs-extra-block")).toBe(true);
  });

  test("activeGateSpec 跟 gateSpecFor 講同一種話", () => {
    const id = freshProject("vrs-gate-active", { route: "vibe", domain: "vrs-gate-pack" });
    const prev = store.get().activeProjectId;
    store.setActiveProject(id);
    expect(store.activeGateSpec()).toBe(VIBE_GATE_SPEC);
    if (prev) store.setActiveProject(prev);
  });
});

// ── 8.1 一鍵自簽 ────────────────────────────────────────────────

describe("selfSignVibe", () => {
  test("vibe 檔自簽：關卡全過、決策紀錄帶錨點、案子不鎖", () => {
    const id = freshProject("vrs-selfsign", { route: "vibe" });
    fillVibeGate(id);
    const r = store.selfSignVibe(id);
    expect(r.ok).toBe(true);
    // 錨點是 8 碼 Crockford —— 跟 plan/UAT 錨點同一套字元集
    expect(r.anchorId).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);

    const c = store.get().cases[id]!;
    expect(c.stages.length).toBeGreaterThan(0);
    for (const s of c.stages) expect(s.state, s.name).toBe("approved");
    // 每一關留一筆 approved 決策，意見裡帶同一個 join key —— replay 靠它
    // 把個案紀錄跟稽核軌跡接起來
    expect(c.log.length).toBe(c.stages.length);
    for (const d of c.log) {
      expect(d.kind).toBe("approved");
      expect(d.comment).toContain(`anc:t=${r.anchorId}`);
    }
    // **不鎖案** —— 鎖了 setProjectRoute 就拒絕換路線，試作檔升不了檔
    expect(c.locked).toBe(false);
  });

  test("結構 gate 沒過就自簽不了 —— vibe 的兩道 block 是 spec 明訂的「仍為 block」", () => {
    const id = freshProject("vrs-selfsign-gate", { route: "vibe" });
    const prev = store.get().activeProjectId;

    // 空白袋：兩道 block 都沒過。自簽是這一檔唯一的治理動作，
    // 不查 block 的話最小治理實質歸零。
    const blocked = store.selfSignVibe(id);
    expect(blocked.ok).toBe(false);
    // 斷言要咬住 **gate 報告**，不是咬住串在後面的固定字尾。舊寫法查的是
    // 「BLOCK」這四個字母，而那是呼叫端自己接上去的字面值 —— `gateSummaryLine`
    // 整支退化成空字串它也照樣綠。這裡改查 gate 真的數出來的東西。
    const blockRules = store
      .gateSpecFor(id)
      .groups.flatMap((g) => g.rules)
      .filter((r) => r.level === "block");
    expect(blocked.reason).toContain("必填章節");
    expect(blocked.reason).toContain(`${blockRules.length} 個必填章節`);
    // 「還沒開始」不得與「請先補齊 BLOCK 項」混講 —— 兩種敘事在同一句裡打架，
    // 而 `gateSummaryLine` 的分岔正是為了避免這件事
    expect(blocked.reason).not.toContain("BLOCK");
    // 擋下來就不准留痕跡 —— 半套自簽（有決策沒核准）比不自簽更難查
    expect(store.get().cases[id]?.log ?? []).toHaveLength(0);

    // 只補摘要還不夠：Non-Goals 是這一檔唯一擋 scope 膨脹的欄杆
    store.setActiveProject(id);
    store.setSectionValues("summary", { what: "只寫了做什麼，沒寫不做什麼" });
    expect(store.selfSignVibe(id).ok).toBe(false);

    store.setSectionValues("goals", { nongoals: "- 不做多人簽核" });
    expect(store.selfSignVibe(id).ok).toBe(true);

    if (prev) store.setActiveProject(prev);
  });

  test("升檔＝自簽核准不帶進正式流程：stages 回 pending，log 決策與錨點仍在", () => {
    const id = "vrs-selfsign"; // 沿用上一條已自簽的專案
    const logBefore = store.get().cases[id]!.log.length;
    expect(store.setProjectRoute(id, "lite").ok).toBe(true);
    const c = store.get().cases[id]!;
    // 「切 vibe → 自簽 → 切回」不得成為任何專案的通用核准繞道 ——
    // 離開 vibe 時自簽產生的核准整批重設，正式簽核要重新走
    for (const s of c.stages) expect(s.state, s.name).toBe("pending");
    // spec 要保存的是可 replay 的錨點紀錄：log 一筆不少、錨點原樣還在
    expect(c.log.length).toBe(logBefore);
    expect(c.log.every((d) => d.kind === "approved" && d.comment.includes("anc:t="))).toBe(true);
    store.setProjectRoute(id, "vibe"); // 還原給後續測試
  });

  /**
   * `setProjectRoute` 的重設從行內字串比對換成 `isSelfSignStage` 的回歸保護。
   *
   * 上一條只看 `state`；這一條看**被清掉的那四個欄位**（`comment` 與三個
   * `decidedBy*` 戳記）。少了它，把 `const { comment, decidedAt, ... } = s`
   * 的解構拿掉不會有任何測試變紅 —— 症狀是關卡顯示「待簽核」卻同時掛著
   * 「某某 · 已簽」的舊戳記，正是 `CaseStage.decidedAt` 那段註解記的那個坑。
   */
  test("升檔重設清掉自簽的決策戳記，案子解鎖，log 與錨點原樣保留", () => {
    const id = freshProject("vrs-reset-stamps", { route: "vibe" });
    fillVibeGate(id);
    const signed = store.selfSignVibe(id);
    expect(signed.ok).toBe(true);

    const before = store.get().cases[id]!;
    // 前提：自簽真的在每一關留了戳記與帶錨點的意見，否則下面驗的是空集合
    expect(before.stages.length).toBeGreaterThan(0);
    for (const s of before.stages) {
      expect(s.state, s.name).toBe("approved");
      expect(s.comment, s.name).toContain(`anc:t=${signed.anchorId}`);
      expect(s.decidedById, s.name).toBe(ADMIN);
    }

    expect(store.setProjectRoute(id, "full").ok).toBe(true);

    const after = store.get().cases[id]!;
    for (const s of after.stages) {
      expect(s.state, s.name).toBe("pending");
      // 四個戳記全部要不見 —— 留一個就是「待簽核卻顯示誰簽的」
      expect(s.comment, s.name).toBeUndefined();
      expect(s.decidedAt, s.name).toBeUndefined();
      expect(s.decidedById, s.name).toBeUndefined();
      expect(s.decidedByName, s.name).toBeUndefined();
    }
    // 鎖態不得被順手打開成 true；log 的錨點紀錄一筆不少（replay 的起點）
    expect(after.locked).toBe(false);
    expect(after.log.length).toBe(before.log.length);
    expect(after.log.every((d) => d.comment.includes(`anc:t=${signed.anchorId}`))).toBe(true);
  });

  test("重複自簽擋下來 —— log 裡已有帶錨點的自簽決策（不看 stages）", () => {
    // 上一條升檔已把 stages 重設回 pending —— 擋重複自簽的是 log，不是關卡狀態
    const r = store.selfSignVibe("vrs-selfsign");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("已經自簽過");
  });

  test("送進正式審閱之後按不動自簽 —— 一鍵核准全部 pending 等於單方面終結一輪多人審閱", () => {
    const id = freshProject("vrs-cr", { route: "vibe" });
    fillVibeGate(id);
    store.setActiveProject(id);
    store.submitForReview(id, "c-vrs-cr-1");
    const before = store.get().cases[id]!;
    const target = [...before.stages].sort((a, b) => a.order - b.order)[0]!;
    expect(store.requestChanges(target.id, "先修這裡").ok).toBe(true);

    const r = store.selfSignVibe(id);
    expect(r.ok).toBe(false);
    // 訊息要說得出下一步，不能只說「不行」
    expect(r.reason).toContain("審閱佇列");

    // 審閱者的負向決策原樣還在，其他關卡也沒有被順手核准
    const c = store.get().cases[id]!;
    expect(c.stages.find((s) => s.id === target.id)!.state).toBe("changes_requested");
    expect(c.stages.some((s) => s.state === "approved")).toBe(false);
  });

  /**
   * 送審 → 抽單 → 自簽，走 store 的真路徑。
   *
   * `signoff.test.ts` 原本有一條「抽單之後又可以自簽」，用
   * `canSelfSign(emp(), vibe({ status: "withdrawn" }), kase())` 組出
   * `project.status === "withdrawn"` 但 `case.withdrawn === false` 的狀態 ——
   * 而 `withdrawCase` **一定同時**寫兩個欄位，那個組合在產品裡不可達，
   * 綠燈給的保證是假的。這一條把它換成真的走得到的路徑。
   */
  test("送審 → 抽單 → 自簽：抽單之後仍然自簽不了，而訊息指的重新送審真的走得通", () => {
    const id = freshProject("vrs-withdraw", { route: "vibe" });
    fillVibeGate(id);
    store.setActiveProject(id);
    store.submitForReview(id, "c-vrs-withdraw-1");
    expect(store.get().projects.find((p) => p.id === id)!.status).toBe("review");

    // 送審中按自簽：訊息**不得**再拿抽單當解法 —— 照做的人會撞上下一條守門
    const inReview = store.selfSignVibe(id);
    expect(inReview.ok).toBe(false);
    expect(inReview.reason).toContain("審閱佇列");
    expect(inReview.reason).not.toContain("抽單");

    // 真的抽單。兩個欄位同時被寫 —— 這是產品裡唯一到得了的「已抽單」狀態
    expect(store.withdrawCase(id, "改個方向").ok).toBe(true);
    expect(store.get().projects.find((p) => p.id === id)!.status).toBe("withdrawn");
    expect(store.get().cases[id]!.withdrawn).toBe(true);

    // 進過正式流程就回不到自簽 —— 守門維持嚴格，改的是那句在說謊的文案
    const after = store.selfSignVibe(id);
    expect(after.ok).toBe(false);
    expect(after.reason).toContain("抽單");
    expect(after.reason).toContain("重新送出正式審閱");
    // 擋下來就不准留痕跡（同結構 gate 那一條）
    expect(store.get().cases[id]!.log).toHaveLength(0);

    // 訊息指的那條路要真的走得通，否則只是換一句新的謊
    store.submitForReview(id, "c-vrs-withdraw-2");
    expect(store.get().cases[id]!.withdrawn).toBe(false);
    expect(store.get().projects.find((p) => p.id === id)!.status).toBe("review");
  });

  test("無編輯權限的角色按不動自簽 —— 同 setProjectRoute 的守門", () => {
    const id = freshProject("vrs-perm", { route: "vibe" });
    if (!store.get().employees.some((e) => e.id === "vrs-approver")) {
      store.addEmployee({
        id: "vrs-approver",
        name: "vibe 只簽不寫",
        kind: "human",
        accessRole: "approver",
        active: true,
      } as never);
    }
    store.setCurrentUser("vrs-approver");
    const r = store.selfSignVibe(id);
    store.setCurrentUser(ADMIN);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("無編輯權限");
  });

  test("full 檔按不到自簽，理由指向正式簽核", () => {
    const id = freshProject("vrs-selfsign-full");
    const r = store.selfSignVibe(id);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("試作／探索");
  });

  test("找不到專案回 ok:false，不拋錯", () => {
    expect(store.selfSignVibe("vrs-ghost").ok).toBe(false);
  });
});

// ── 形狀防護：稽核事件真的接上了 ────────────────────────────────
//
// `audit()` 只在桌面版＋綁了資料夾時真的落地，bun test 裡走不到 —— 所以
// 「自簽會寫一筆帶錨點的 review.approve」用 source-grep 盯住呼叫的形狀
// （同 migration 接線的既有做法）。

describe("selfSignVibe 的稽核接線（形狀）", () => {
  const body = STORE_SRC.slice(
    STORE_SRC.indexOf("selfSignVibe(projectId: string)"),
    STORE_SRC.indexOf("setProjectDescription("),
  );

  test("以 selfSignSubject（anc:t= 前綴）當 subject 呼叫 audit，kind 是 review.approve", () => {
    expect(body).toContain('audit(state, projectId, "review.approve", subject');
    expect(body).toContain("selfSignSubject(anchorId)");
  });

  /**
   * `changes_requested` 不被自簽翻掉這一條，行為上已經構不到了 ——
   * 要有 `changes_requested` 就得先送審，而送審之後 `canSelfSign` 就擋在門口
   * （新增的 `status === "review"` 守門）。這條內層防線因此變成第二道保險：
   * 沒有任何測試情境走得到，刪掉它也不會有測試變紅。用形狀盯住它。
   */
  test("open() 只認 pending / empty —— 自簽不得把「要求修改」翻成核准", () => {
    expect(body).toContain('const open = (s: CaseStage) => s.state === "pending" || s.state === "empty"');
  });

  test("自簽前呼叫 evaluatePrdGates，並在 canSubmit 為 false 時擋下", () => {
    expect(body).toContain("evaluatePrdGates(");
    expect(body).toContain("if (!gate.canSubmit)");
  });
});
