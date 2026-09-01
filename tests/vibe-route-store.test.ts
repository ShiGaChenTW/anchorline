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

  test("重複自簽擋下來 —— log 裡已有帶錨點的自簽決策（不看 stages）", () => {
    // 上一條升檔已把 stages 重設回 pending —— 擋重複自簽的是 log，不是關卡狀態
    const r = store.selfSignVibe("vrs-selfsign");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("已經自簽過");
  });

  test("自簽不翻「要求修改」—— 審閱者的負向決策不是一顆自簽鈕能撤銷的", () => {
    const id = freshProject("vrs-cr", { route: "vibe" });
    store.setActiveProject(id);
    store.submitForReview(id, "c-vrs-cr-1");
    const before = store.get().cases[id]!;
    const target = [...before.stages].sort((a, b) => a.order - b.order)[0]!;
    expect(store.requestChanges(target.id, "先修這裡").ok).toBe(true);
    const r = store.selfSignVibe(id);
    expect(r.ok).toBe(true);
    const c = store.get().cases[id]!;
    expect(c.stages.find((s) => s.id === target.id)!.state).toBe("changes_requested");
    for (const s of c.stages) {
      if (s.id !== target.id) expect(s.state, s.name).toBe("approved");
    }
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
});
