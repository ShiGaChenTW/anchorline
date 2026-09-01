/**
 * 範本第 11 章的自檢清單。
 *
 * 最重要的一條在最後：**每個 auto 項目指的 gate id 必須真的存在於
 * `BASE_GATE_SPEC`**。指到一條不存在的規則，那一項會永遠顯示「通過」——
 * 一個永遠打勾的自檢項目比沒有這一項更糟，而且不會有任何錯誤訊息。
 */
import { describe, expect, test } from "bun:test";
import type { GateReport } from "../src/lib/gate-rules";
import { BASE_GATE_SPEC } from "../src/lib/prd-gates";
import { SELF_CHECK, leftoverExamples, resolveSelfCheck } from "../src/lib/prd-selfcheck";

/** 只組 resolveSelfCheck 讀得到的那一個欄位 */
function report(findings: GateReport["findings"]): GateReport {
  return { findings } as GateReport;
}

const items = SELF_CHECK.flatMap((g) => g.items);
const flat = (r: ReturnType<typeof resolveSelfCheck>) => r.groups.flatMap((g) => g.items);
const byId = (r: ReturnType<typeof resolveSelfCheck>, id: string) => flat(r).find((i) => i.id === id)!;

describe("resolveSelfCheck", () => {
  /** 章節有內容才輪得到 gate 判定 —— 空白是 pending，見最後一組 */
  const WRITTEN = { goals: { nongoals: "- 不做簡訊 OTP\n- 不做生物辨識\n- 不改 SSO" } };

  test("gate 沒發 finding = 該項通過", () => {
    const r = resolveSelfCheck(report([]), {}, WRITTEN);
    expect(byId(r, "sc-nongoals").pass).toBe(true);
    expect(byId(r, "sc-nongoals").auto).toBe(true);
  });

  test("gate 發了 warn/block = 該項不過，並帶出 gate 的 detail", () => {
    const r = resolveSelfCheck(
      report([{ id: "non-goals-min", level: "block", label: "x", detail: "至少 3 條" }]),
    );
    expect(byId(r, "sc-nongoals").pass).toBe(false);
    expect(byId(r, "sc-nongoals").detail).toBe("至少 3 條");
    expect(r.failing.map((i) => i.id)).toContain("sc-nongoals");
  });

  test("pass 級 finding 不算失敗", () => {
    const r = resolveSelfCheck(
      report([{ id: "non-goals-min", level: "pass", label: "x", detail: "" }]),
      {},
      WRITTEN,
    );
    expect(byId(r, "sc-nongoals").pass).toBe(true);
  });

  test("人工項目由 manual 決定，預設不過", () => {
    expect(byId(resolveSelfCheck(report([])), "sc-no-solution").pass).toBe(false);
    expect(byId(resolveSelfCheck(report([]), { "sc-no-solution": true }), "sc-no-solution").pass).toBe(true);
  });

  test("manual 勾不掉一個機器判定失敗的項目（自檢清單不能說謊）", () => {
    const r = resolveSelfCheck(
      report([{ id: "non-goals-min", level: "block", label: "x", detail: "d" }]),
      { "sc-nongoals": true },
    );
    expect(byId(r, "sc-nongoals").pass).toBe(false);
  });

  test("殘留的「例｜」示範內容會被抓到，並列出是哪幾章", () => {
    const r = resolveSelfCheck(report([]), {}, { spec: { numbers: "例｜驗證碼 6 位數" } });
    const it = byId(r, "sc-no-example");
    expect(it.pass).toBe(false);
    expect(it.detail).toContain("spec");
  });

  test("沒有殘留示範內容時該項通過", () => {
    expect(byId(resolveSelfCheck(report([]), {}, { spec: { numbers: "驗證碼 6 位數" } }), "sc-no-example").pass).toBe(true);
  });

  test("done / total 對得起來", () => {
    const r = resolveSelfCheck(report([]));
    expect(r.total).toBe(items.length);
    expect(r.done).toBe(flat(r).filter((i) => i.pass).length);
  });
});

describe("leftoverExamples", () => {
  test("回傳每一個還留著示範內容的章節 id", () => {
    expect(
      leftoverExamples({ a: { x: "例｜甲" }, b: { x: "乾淨" }, c: { y: "含 例｜ 在中間" } }).sort(),
    ).toEqual(["a", "c"]);
  });

  test("空輸入不拋錯", () => {
    expect(leftoverExamples({})).toEqual([]);
  });
});

describe("清單資料完整性", () => {
  test("項目 id 不重複", () => {
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("每個 auto 項目指的 gate id 都真的存在（指錯 = 永遠打勾）", () => {
    const known = new Set(BASE_GATE_SPEC.groups.flatMap((g) => g.rules.map((r) => r.id)));
    for (const it of items) {
      if (!it.gate) continue;
      expect(known.has(it.gate), `自檢項目 ${it.id} 指向不存在的 gate「${it.gate}」`).toBe(true);
    }
  });

  test("有 section 的項目都指向真的存在的章節", async () => {
    const { SEED_SECTIONS } = await import("../src/data/seed");
    const ids = new Set(SEED_SECTIONS.map((s) => s.id));
    for (const it of items) {
      if (!it.section) continue;
      expect(ids.has(it.section), `自檢項目 ${it.id} 指向不存在的章節「${it.section}」`).toBe(true);
    }
  });
});

// ── 三態：空白章節不能打勾 ────────────────────────────────────
//
// gate 規則多半 skipWhenEmpty，所以「沒有 finding」有兩個意思。把它們讀成
// 同一件事，會讓一份還沒寫的需求規格顯示「沒有模糊字眼 ✔」——這份清單
// 存在的唯一理由就是不說這種話。

describe("空白章節 → pending，不是 pass", () => {
  test("章節完全空白時該項是 pending，不算 done", () => {
    const r = resolveSelfCheck(report([]), {}, { spec: {} });
    const it = byId(r, "sc-vague");
    expect(it.state).toBe("pending");
    expect(it.pass).toBe(false);
    expect(it.detail).toBe("這一章還沒開始");
  });

  test("章節有內容且 gate 安靜 → pass", () => {
    const r = resolveSelfCheck(report([]), {}, { spec: { numbers: "驗證碼 6 位數，逾時 30 秒" } });
    expect(byId(r, "sc-vague").state).toBe("pass");
  });

  test("gate 發了 finding → fail，就算章節看起來空白也一樣", () => {
    const r = resolveSelfCheck(
      report([{ id: "spec-vague-wording", level: "warn", label: "x", detail: "有模糊字眼" }]),
      {},
      { spec: {} },
    );
    expect(byId(r, "sc-vague").state).toBe("fail");
  });

  test("pending 不進 failing —— 還沒開始不是做錯了", () => {
    const r = resolveSelfCheck(report([]), {}, {});
    expect(r.failing.every((i) => i.state === "fail")).toBe(true);
  });

  test("沒勾的人工項目也是 pending", () => {
    expect(byId(resolveSelfCheck(report([])), "sc-no-solution").state).toBe("pending");
    expect(byId(resolveSelfCheck(report([]), { "sc-no-solution": true }), "sc-no-solution").state).toBe("pass");
  });
});

describe("untouched 的 block 也是 pending", () => {
  test("gate 標了 untouched → pending，跟 gate 卡講同一種話", () => {
    const r = resolveSelfCheck(
      report([{ id: "non-goals-min", level: "block", label: "x", detail: "目前約 0 條", untouched: true }]),
      {},
      {},
    );
    expect(byId(r, "sc-nongoals").state).toBe("pending");
    expect(r.failing.map((i) => i.id)).not.toContain("sc-nongoals");
  });

  test("untouched 為 false 時仍是 fail", () => {
    const r = resolveSelfCheck(
      report([{ id: "non-goals-min", level: "block", label: "x", detail: "目前約 1 條", untouched: false }]),
      {},
      {},
    );
    expect(byId(r, "sc-nongoals").state).toBe("fail");
  });
});
