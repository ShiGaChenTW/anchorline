/**
 * 章節骨架／使用者標記分離的測試。
 *
 * 這是 W-D 唯一真正危險的地方：既有使用者的 localStorage 要在不掉東西的
 * 前提下走到新結構。掉一個勾選是小事，掉一段正文是不可原諒的。
 */
import { describe, expect, test } from "bun:test";
import type { Section, SectionMeta } from "../src/data/types";
import { applyMeta, metaFromSections, orphanSectionIds, pickDomain } from "../src/lib/section-meta";

function sec(id: string, over: Partial<Section> = {}): Section {
  return {
    id,
    n: "01",
    title: id,
    desc: "",
    status: "empty",
    guide: "",
    tips: [],
    example: "",
    fields: [],
    checks: [],
    score: 0,
    ...over,
  };
}

describe("metaFromSections", () => {
  test("只取 status / score / checks，不帶骨架", () => {
    const meta = metaFromSections([
      sec("summary", { status: "done", score: 92, checks: [{ id: "c1", label: "L", pass: true }], guide: "骨架" }),
    ]);
    expect(meta.summary).toEqual({ status: "done", score: 92, checks: [{ id: "c1", label: "L", pass: true }] });
    expect(Object.keys(meta.summary)).not.toContain("guide");
  });

  test("checks 是複本，之後改動原 section 不會污染 bag", () => {
    const s = sec("a", { checks: [{ id: "c1", label: "L", pass: false }] });
    const meta = metaFromSections([s]);
    s.checks[0].pass = true;
    expect(meta.a.checks[0].pass).toBe(false);
  });
});

describe("applyMeta", () => {
  const skeleton = [
    sec("summary", { guide: "新版指引", checks: [{ id: "c1", label: "舊檢查", pass: false }] }),
    sec("kyc_aml", { guide: "領域包新增", checks: [{ id: "k1", label: "新檢查", pass: false }] }),
  ];

  test("疊回 status / score / 勾選，但骨架欄位以新版為準", () => {
    const meta: Record<string, SectionMeta> = {
      summary: { status: "done", score: 88, checks: [{ id: "c1", label: "舊標籤", pass: true }] },
    };
    const out = applyMeta(skeleton, meta);
    expect(out[0].status).toBe("done");
    expect(out[0].score).toBe(88);
    expect(out[0].checks[0].pass).toBe(true);
    // 標籤與指引來自骨架，不是 bag —— 領域包改了文案要看得到
    expect(out[0].checks[0].label).toBe("舊檢查");
    expect(out[0].guide).toBe("新版指引");
  });

  test("骨架新增的檢查項會出現，預設未勾", () => {
    const out = applyMeta(skeleton, { kyc_aml: { status: "warn", score: 10, checks: [] } });
    expect(out[1].checks.map((c) => c.id)).toEqual(["k1"]);
    expect(out[1].checks[0].pass).toBe(false);
    expect(out[1].status).toBe("warn");
  });

  test("bag 有、骨架沒有的章節被丟掉（換領域後的孤兒標記）", () => {
    const out = applyMeta(skeleton, {
      summary: { status: "done", score: 1, checks: [] },
      已刪除的章節: { status: "done", score: 99, checks: [] },
    });
    expect(out.map((s) => s.id)).toEqual(["summary", "kyc_aml"]);
  });

  test("沒有 bag 就原樣回傳骨架", () => {
    expect(applyMeta(skeleton, undefined)).toBe(skeleton);
  });

  test("不改動傳入的骨架", () => {
    applyMeta(skeleton, { summary: { status: "done", score: 88, checks: [] } });
    expect(skeleton[0].status).toBe("empty");
  });
});

describe("pickDomain", () => {
  test("空值 / 未知領域一律退回預設 — 領域包被刪掉不該讓 App 開不起來", () => {
    expect(pickDomain(undefined, ["generic"], "generic")).toBe("generic");
    expect(pickDomain("  ", ["generic"], "generic")).toBe("generic");
    expect(pickDomain("已移除的領域", ["generic"], "generic")).toBe("generic");
  });

  test("已註冊的領域照用", () => {
    expect(pickDomain("digital_account", ["generic", "digital_account"], "generic")).toBe("digital_account");
  });
});

describe("orphanSectionIds — 換領域不掉正文", () => {
  const live = [sec("summary"), sec("goals")];

  test("有正文但不在目前領域的章節會被指認出來", () => {
    const vals = {
      summary: { what: "有寫" },
      kyc_aml: { identity_flow: "換領域前寫的 KYC 內容" },
    };
    expect(orphanSectionIds(live, vals)).toEqual(["kyc_aml"]);
  });

  test("空白的孤兒不算 — 沒寫過的東西不需要提示", () => {
    const vals = { kyc_aml: { identity_flow: "   ", str: "" } };
    expect(orphanSectionIds(live, vals)).toEqual([]);
  });

  test("目前領域的章節不算孤兒", () => {
    expect(orphanSectionIds(live, { summary: { what: "有寫" }, goals: { goals: "有寫" } })).toEqual([]);
  });
});
