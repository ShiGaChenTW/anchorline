/**
 * 送審預檢 —— Scott 2026-08-26 實測回報的缺陷。
 *
 * ## 他撞到什麼
 *
 * 按「送出審閱」→ 逐關選完人 →**按下送出，才**跳出「跟主線沒有差異，
 * 沒有東西可以送審」。訊息本身是對的（內容跟已核准的主線一字不差），
 * 錯的是**時機**：檢查跑在指派對話框之後，整段選人是白做的。
 *
 * ## 這一支釘住三件事
 *
 * - **Part A（重點）**：預檢與 `commitForReview` 對**同一個 state** 給出一致的
 *   答案。這是整個修法的重點 —— 修法是「把判斷提前」，而提前的做法一旦變成
 *   「在 UI 重寫一份規則」，症狀就是「預檢說可以、真的送出卻被擋」或反過來。
 *   兩種都很難查，因為畫面上兩邊各自都是對的。這個 repo 已經為了同一件事
 *   把 `submitPlan` 抽出來過一次。
 * - **Part B**：順序。沒東西可送時，指派對話框**一次都不能被開啟**。
 *   這條 source-grep 驗不到 —— 缺陷在兩個「各自都正確」的函式**之間**，
 *   兩邊的字串都在、測試全綠、缺陷還在（Wave 2 的 C-1／C-3 就是這個形狀）。
 *   所以這裡用替身跑真的呼叫順序，跟 `wave2-review-fixes.test.ts` 同一招。
 * - **Part C**：文案與行為對齊。訊息說「改一點內容再送一次就會通過」，
 *   那就**先跑 store 證明真的會通過**，才允許斷言文案講那句話。
 *   這一輪已經因為文案說謊修過三次。
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CANCELLED, runSubmitFlow } from "../src/lib/submit-flow";
import { canCommit } from "../src/lib/prd-versions";

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
(globalThis as Record<string, unknown>).localStorage ??= {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
};

const { store } = await import("../src/data/store");

/* ══ 樣板 ═══════════════════════════════════════════════════ */

const SP_ADMIN = "sp-admin";
let seq = 0;

/** id 帶檔名前綴：`bun test` 全部跑在同一個 process，store 是模組層單例 */
function freshProject(): string {
  const id = `sp-${++seq}`;
  store.addProject({
    id,
    title: `預檢 ${id}`,
    status: "draft",
    pct: 0,
    owner: "測試管理員",
    domain: "generic",
  } as never);
  store.setActiveProject(id);
  return id;
}

/** 第一個章節的第一個欄位 —— 拿來製造「內容有差異」 */
function firstField(): { sectionId: string; key: string } {
  const s = store.get().sections[0]!;
  return { sectionId: s.id, key: s.fields[0]!.key };
}

function write(text: string): void {
  const { sectionId, key } = firstField();
  store.setSectionDraft(sectionId, key, text);
}

/** 寫入並儲存 —— 走完「使用者打完字按儲存」那一段 */
function writeAndSave(text: string): void {
  write(text);
  store.saveSections();
}

/**
 * 把專案推到「有主線」的狀態：送審一次，再合併回主線。
 * 之後 working copy 跟主線一字不差 —— 就是 Scott 撞到的那個狀態。
 */
function withMergedBaseline(text = "第一版內容"): string {
  const id = freshProject();
  writeAndSave(text);
  const c = store.commitForReview("第一版");
  expect(c.ok).toBe(true);
  store.submitForReview(undefined, c.version!.id, undefined);
  const m = store.mergeApproved("核准合併");
  expect(m.ok).toBe(true);
  expect(store.prdBaseline(id)).not.toBeNull();
  return id;
}

beforeEach(() => {
  if (!store.get().employees.some((x) => x.id === SP_ADMIN)) {
    store.addEmployee({
      id: SP_ADMIN,
      name: "測試管理員",
      kind: "human",
      accessRole: "admin",
      active: true,
      isCurrent: true,
    } as never);
  }
  store.setCurrentUser(SP_ADMIN);
});

/* ══ Part A：預檢 ⇔ commitForReview 對同一個 state 一致 ═════ */

/**
 * **同時持有兩邊。**
 *
 * 對當下的 state 先問預檢（唯讀），再真的呼叫 `commitForReview`，
 * 斷言兩者的 `ok` 與 `reason` 逐字相同。分開測「預檢會擋」與
 * 「commitForReview 會擋」各自都會綠，但驗不到兩者是否是同一套判斷。
 */
function bothSidesAgree(): { ok: boolean; reason?: string } {
  const pre = store.commitPrecheck();
  const commit = store.commitForReview("(一致性探針)");
  expect(commit.ok).toBe(pre.ok);
  // 擋下來的時候，兩邊講的話也必須是同一句 —— 使用者看到的就是這一句
  if (!pre.ok) expect(commit.reason).toBe(pre.reason);
  return { ok: pre.ok, reason: pre.reason };
}

describe("Part A — 預檢與 commitForReview 是同一套判斷", () => {
  test("還沒有主線（第一版）→ 兩邊都說可以送", () => {
    freshProject();
    writeAndSave("全新的一版");
    expect(bothSidesAgree().ok).toBe(true);
  });

  test("有主線、內容一字不差 → 兩邊都擋，而且講同一句話", () => {
    withMergedBaseline();
    const r = bothSidesAgree();
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("跟主線沒有差異");
  });

  test("有主線、改過內容 → 兩邊都放行", () => {
    withMergedBaseline();
    writeAndSave("改過的內容，跟主線不一樣了");
    expect(bothSidesAgree().ok).toBe(true);
  });

  test("有未儲存草稿 → 兩邊都擋在「未儲存」那一條", () => {
    withMergedBaseline();
    write("只打字不儲存");
    expect(store.hasUnsaved()).toBe(true);
    const r = bothSidesAgree();
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("未儲存");
  });

  /**
   * `code` 存在的理由：UI 要分辨「未儲存」（存一下就好，是正常路徑）與
   * 「沒差異」（真的沒東西可送）。少了它，UI 只能比對中文字串，文案一改
   * 就靜默失效。
   */
  test("擋下來時給得出 code，而且跟 reason 是同一個原因", () => {
    withMergedBaseline();
    const noDiff = store.commitPrecheck();
    expect(noDiff.code).toBe("no-diff");
    expect(noDiff.reason).toContain("跟主線沒有差異");

    write("只打字不儲存");
    const unsaved = store.commitPrecheck();
    expect(unsaved.code).toBe("unsaved");
    expect(unsaved.reason).toContain("未儲存");
  });

  test("預檢是純讀 —— 問幾次都不會產生版本、不會動到 state", () => {
    const id = withMergedBaseline();
    const versionsBefore = store.prdVersionsOf(id).length;
    const statusBefore = store.get().projects.find((p) => p.id === id)!.status;
    store.commitPrecheck();
    store.commitPrecheck();
    store.commitPrecheck();
    expect(store.prdVersionsOf(id).length).toBe(versionsBefore);
    expect(store.get().projects.find((p) => p.id === id)!.status).toBe(statusBefore);
  });

  /** 規則本身沒有被改動 —— 兩條判斷還是原來那兩條 */
  test("`canCommit` 的兩條規則沒有變", () => {
    expect(canCommit({ hasUnsaved: true, changedFields: 3 }).ok).toBe(false);
    expect(canCommit({ hasUnsaved: false, changedFields: 0 }).ok).toBe(false);
    expect(canCommit({ hasUnsaved: false, changedFields: 2 }).ok).toBe(true);
  });
});

/* ══ Part B：順序 —— 沒東西可送就不准開對話框 ════════════════ */

/**
 * `ask.ts` 的極薄替身，跟 `wave2-review-fixes.test.ts` 同一招：
 * 記錄呼叫順序，而且**鎖是同步拿的**（`askCustom` 的 `rejectIfBusy()`
 * 跑在第一個 await 之前）。這裡真正在意的是「有沒有被呼叫到」。
 */
function fakeAsk(result: unknown) {
  const calls: string[] = [];
  return {
    calls,
    askCustom: async (): Promise<unknown> => {
      calls.push("askCustom");
      await Promise.resolve();
      return result;
    },
  };
}

type Probe = {
  calls: string[];
  deps: Parameters<typeof runSubmitFlow<Record<string, string | null>>>[0];
};

/**
 * 把 `editor.ts` 的接線原樣搭一份替身。`ask` 這一支刻意透過假的 `askCustom`——
 * 真的那條路徑是 `askStageAssignments()` → `askCustom()`，所以「對話框有沒有
 * 被開啟」問的就是 `askCustom` 有沒有被呼叫到。
 */
function probe(opts: {
  precheck: { ok: boolean; reason?: string };
  askResult?: unknown;
  commitOk?: boolean;
}): Probe {
  const calls: string[] = [];
  // `askResult: undefined` 是有意義的回答（「這次不必問」），不能被 `??` 吃掉
  const ask = fakeAsk("askResult" in opts ? opts.askResult : { "s-1": "u-1" });
  return {
    calls,
    deps: {
      precheck: () => {
        calls.push("precheck");
        return opts.precheck;
      },
      ask: async () => {
        const r = await ask.askCustom();
        calls.push(...ask.calls);
        ask.calls.length = 0;
        return r as Record<string, string | null> | undefined | typeof CANCELLED;
      },
      commit: () => {
        calls.push("commit");
        return opts.commitOk === false
          ? { ok: false, reason: "commit 自己擋下" }
          : { ok: true, versionId: "v-1", docs: {} };
      },
      submit: (versionId, assignments) => {
        calls.push(`submit:${versionId}:${JSON.stringify(assignments ?? null)}`);
      },
      changedFields: () => 3,
    },
  };
}

describe("Part B — 沒東西可送時，指派對話框不得被開啟", () => {
  /** **這是這一輪修的那條缺陷。** 修復前的順序是 ask → commit ← 才擋下。 */
  test("預檢擋下 → askCustom 一次都沒被呼叫，commit 也沒被呼叫", async () => {
    const p = probe({
      precheck: { ok: false, reason: "跟主線沒有差異，沒有東西可以送審 —— …" },
    });
    const out = await runSubmitFlow(p.deps);

    expect(out.status).toBe("blocked");
    expect(p.calls).toEqual(["precheck"]);
    expect(p.calls).not.toContain("askCustom");
    expect(p.calls).not.toContain("commit");
  });

  test("擋下來時把預檢的理由原樣交出去 —— 不另外編一句", async () => {
    const reason = "跟主線沒有差異，沒有東西可以送審 —— 改一點內容再送一次就會通過。";
    const out = await runSubmitFlow(probe({ precheck: { ok: false, reason } }).deps);
    expect(out.status).toBe("blocked");
    expect(out.message).toBe(reason);
  });

  /** 回歸保護：別把功能一起關掉 */
  test("有東西可送 → 對話框照常開，順序是 預檢 → 對話框 → commit → 送審", async () => {
    const p = probe({ precheck: { ok: true }, askResult: { "s-1": "u-9" } });
    const out = await runSubmitFlow(p.deps);

    expect(out.status).toBe("submitted");
    expect(p.calls).toEqual([
      "precheck",
      "askCustom",
      "commit",
      `submit:v-1:${JSON.stringify({ "s-1": "u-9" })}`,
    ]);
  });

  /**
   * W2-A 釘住的位置沒有被動到：對話框仍然在 commit **之前**。
   * 放在 commit 之後的話，按取消就留下一個沒人要的版本快照。
   */
  test("在對話框按取消 → commit 一次都沒被呼叫（不留廢快照）", async () => {
    const p = probe({ precheck: { ok: true }, askResult: CANCELLED });
    const out = await runSubmitFlow(p.deps);

    expect(out.status).toBe("cancelled");
    expect(p.calls).toEqual(["precheck", "askCustom"]);
    expect(p.calls).not.toContain("commit");
  });

  /** `undefined` 是「這次不必問指派」，跟取消是相反的決定 */
  test("回 undefined（不必問）→ 照常送出，指派交出去的是 undefined", async () => {
    const p = probe({ precheck: { ok: true }, askResult: undefined });
    const out = await runSubmitFlow(p.deps);
    expect(out.status).toBe("submitted");
    expect(p.calls).toContain("submit:v-1:null");
  });

  /** `commitForReview` 自己那道閘門要留著 —— 它是最後一道防線，不是只有 UI 在擋 */
  test("預檢放行但 commit 自己擋下 → 仍然擋得住，而且不送審", async () => {
    const p = probe({ precheck: { ok: true }, commitOk: false });
    const out = await runSubmitFlow(p.deps);
    expect(out.status).toBe("blocked");
    expect(out.message).toBe("commit 自己擋下");
    expect(p.calls.some((c) => c.startsWith("submit:"))).toBe(false);
  });
});

/* ══ Part C：文案講的下一步，真的走得通 ═════════════════════ */

describe("Part C — 文案與行為對齊", () => {
  /**
   * 順序刻意是「先證明行為，才斷言文案」。反過來寫（先斷言字串、再假設行為）
   * 就是這一輪犯過三次的那個形狀。
   */
  test("「改一點內容再送一次就會通過」—— 先跑一次證明真的會通過", () => {
    withMergedBaseline("原始內容");

    // ① 現在被擋著
    const blocked = store.commitPrecheck();
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe("no-diff");

    // ② 照文案講的做：改一點內容
    writeAndSave("原始內容，再加一句。");

    // ③ 真的通過了 —— 預檢與 commitForReview 都放行
    expect(store.commitPrecheck().ok).toBe(true);
    expect(store.commitForReview("第二版").ok).toBe(true);

    // ④ 行為成立了，才允許斷言文案講這句話
    expect(blocked.reason).toContain("改一點內容再送一次就會通過");
  });

  test("訊息同時講得出「為什麼」與「下一步」", () => {
    const r = canCommit({ hasUnsaved: false, changedFields: 0 });
    expect(r.reason).toContain("跟主線沒有差異"); // 為什麼
    expect(r.reason).toContain("改一點內容"); // 下一步
  });
});

/* ══ 接線：editor.ts 真的把預檢接上去了 ═════════════════════ */

/**
 * Wave 1 的 F0：新參數只有測試在傳，生產唯一呼叫端沒傳，1563 個測試全綠而
 * App 裡是零。`commitPrecheck` 是一模一樣的形狀 —— 上面的替身測試全部
 * 驗的是 `runSubmitFlow`，驗不到 `editor.ts` 有沒有把它接上去。
 */
describe("接線", () => {
  const EDITOR_SRC = readFileSync(new URL("../src/pages/editor.ts", import.meta.url), "utf8");

  test("editor 的送審路徑接的是 store.commitPrecheck()，不自己算一份", () => {
    expect(EDITOR_SRC).toContain("store.commitPrecheck()");
    // UI 重寫一份規則 = 兩份會分岔，症狀是「預檢說可以、送出卻被擋」
    expect(EDITOR_SRC).not.toContain("canCommit(");
  });

  test("送審鈕的脈動也看預檢 —— 沒東西可送就不邀請使用者按", () => {
    expect(EDITOR_SRC).toContain("nothingToSubmit()");
    const call = EDITOR_SRC.match(/pulseSubmitWhenBecameReady\([^)]*\)/)![0];
    expect(call).toContain("canSubmitNow");
    // 只認 code，不比對中文字串 —— 文案一改，字串比對會靜默失效
    expect(EDITOR_SRC).toContain('.code === "no-diff"');
  });

  /** 鈕不 disable，但要說得出原因（W2-C 的教訓：純粹變灰而不說原因） */
  test("鈕沒有被 disable，而且原因寫在畫面上", () => {
    expect(EDITOR_SRC).not.toContain("submitBtn.disabled");
    expect(EDITOR_SRC).toContain("adhd-gate-nodiff");
    expect(EDITOR_SRC).toContain("改一點內容才有東西可送審");
  });
});
