/**
 * 領域包 loader 測試。
 *
 * 刻意讀 `src/data/domains/` 底下的真檔而不是 inline 字串——這一層最可能壞的
 * 不是解析器，是某個 `.md` 的 YAML 縮排寫歪了。那種錯只有讀真檔才抓得到。
 * （`index.ts` 用 `import.meta.glob`，Vite 專屬，bun test 讀不到，所以繞過它。）
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  type DomainPack,
  DomainPackError,
  applySectionPatches,
  parseDomainPack,
  resolveDomain,
} from "../src/lib/domain-pack";
import { BASE_GATE_SPEC } from "../src/lib/prd-gates";
import { runGateSpec } from "../src/lib/gate-rules";
import { SEED_SECTIONS } from "../src/data/seed";
import { FINANCIAL_COMPLIANCE_STAGE_NAME, resolveWorkflow } from "../src/lib/workflow-resolve";

const DIR = join(import.meta.dir, "../src/data/domains");

function loadAll(): Record<string, DomainPack> {
  const out: Record<string, DomainPack> = {};
  for (const f of readdirSync(DIR).filter((f) => f.endsWith(".md"))) {
    const pack = parseDomainPack(readFileSync(join(DIR, f), "utf8"), f);
    out[pack.name] = pack;
  }
  return out;
}

const PACKS = loadAll();
const BASE = { sections: SEED_SECTIONS, gates: BASE_GATE_SPEC };

// ── 解析 ────────────────────────────────────────────────────

describe("parseDomainPack", () => {
  test("目錄下每一份 .md 都解析得動，且 name 不重複", () => {
    // 不寫死名單——新增領域包不該讓這條測試變紅。要守的是「每個檔都解析得動」
    // 與「name 不撞」，那兩件事才是加檔案時真的會壞的東西。
    const files = readdirSync(DIR).filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThan(0);
    expect(Object.keys(PACKS)).toHaveLength(files.length);
    expect(Object.keys(PACKS)).toContain("generic");
    expect(Object.keys(PACKS)).toContain("_base");
  });

  test("缺 frontmatter → DomainPackError", () => {
    expect(() => parseDomainPack("# 沒有 frontmatter")).toThrow(DomainPackError);
  });

  test("YAML 壞掉 → 錯誤訊息帶檔名", () => {
    expect(() => parseDomainPack("---\nname: [unclosed\n---\n", "bad.md")).toThrow(/bad\.md/);
  });

  test("缺 name / displayName → 擋下", () => {
    expect(() => parseDomainPack("---\ndisplayName: 有\n---\n")).toThrow(/name/);
    expect(() => parseDomainPack("---\nname: x\n---\n")).toThrow(/displayName/);
  });

  test("章節缺 id、規則缺 id 或 section → 擋下", () => {
    expect(() => parseDomainPack("---\nname: x\ndisplayName: X\nsections:\n  - title: 無 id\n---\n")).toThrow(/id/);
    expect(() =>
      parseDomainPack("---\nname: x\ndisplayName: X\ngates:\n  - rules:\n      - id: r1\n---\n"),
    ).toThrow(/section/);
  });
});

// ── 章節疊加 ────────────────────────────────────────────────

describe("applySectionPatches", () => {
  const base = SEED_SECTIONS.slice(0, 2);

  test("同 id 覆寫指定欄位，其餘保留", () => {
    const out = applySectionPatches(base, [{ id: "summary", title: "改過的標題" }]);
    expect(out[0].title).toBe("改過的標題");
    expect(out[0].fields).toBe(base[0].fields); // 沒給 fields 就不動
    expect(out).toHaveLength(2);
  });

  test("新 id 追加到尾端，缺的欄位補預設值", () => {
    const out = applySectionPatches(base, [{ id: "kyc_aml", title: "KYC" }]);
    expect(out).toHaveLength(3);
    expect(out[2]).toMatchObject({ id: "kyc_aml", title: "KYC", status: "empty", tips: [], fields: [] });
  });

  test("不改動傳入的 base 陣列", () => {
    const before = base[0].title;
    applySectionPatches(base, [{ id: "summary", title: "別動我" }]);
    expect(base[0].title).toBe(before);
  });
});

// ── 解析與繼承 ──────────────────────────────────────────────

describe("resolveDomain", () => {
  test("generic 不加章節、不加 gate — 就是原本的通用 7 章", () => {
    const d = resolveDomain("generic", PACKS, BASE);
    expect(d.sections.map((s) => s.id)).toEqual(SEED_SECTIONS.map((s) => s.id));
    expect(d.gateSpec.groups).toHaveLength(BASE_GATE_SPEC.groups.length);
  });

  test("prompt 疊加順序：呼叫端 → base → 領域", () => {
    const d = resolveDomain("digital_account", PACKS, { ...BASE, prompt: "呼叫端前綴" });
    const iBase = d.prompt.indexOf("資深產品經理");
    const iDomain = d.prompt.indexOf("第一／二／三類");
    expect(d.prompt.startsWith("呼叫端前綴")).toBe(true);
    expect(iBase).toBeGreaterThan(0);
    expect(iDomain).toBeGreaterThan(iBase);
  });

  test("產業身分只出現在領域包，不在共用基底", () => {
    // _base 混進 FinTech 身分的話，通用專案的 AI 助教會開始講金管會
    expect(resolveDomain("generic", PACKS, BASE).prompt).not.toMatch(/FinTech|銀行|金管會/);
    expect(resolveDomain("digital_account", PACKS, BASE).prompt).toMatch(/FinTech/);
  });

  test("digital_account 在通用 7 章之後加三章", () => {
    const d = resolveDomain("digital_account", PACKS, BASE);
    expect(d.sections).toHaveLength(SEED_SECTIONS.length + 3);
    expect(d.sections.slice(-3).map((s) => s.id)).toEqual(["kyc_aml", "privacy_security", "regulatory_filing"]);
  });

  test("base 的 hints 會被帶到每一個領域", () => {
    // 漏掉時 gate 全綠、測試全綠，只有教練欄默默少講幾句話——實機才看得出來
    const baseHintIds = (BASE_GATE_SPEC.hints ?? []).flatMap((g) => g.rules.map((r) => r.id));
    expect(baseHintIds.length).toBeGreaterThan(0);
    for (const name of Object.keys(PACKS).filter((n) => !n.startsWith("_"))) {
      const got = (resolveDomain(name, PACKS, BASE).gateSpec.hints ?? []).flatMap((g) =>
        g.rules.map((r) => r.id),
      );
      expect(got, `${name} 掉了 base hints`).toEqual(expect.arrayContaining(baseHintIds));
    }
  });

  test("找不到領域包 → 錯誤訊息含名稱", () => {
    expect(() => resolveDomain("nope", PACKS, BASE)).toThrow(/nope/);
  });

  test("繼承不存在的父包 → 擋下", () => {
    const bad = { ...PACKS, orphan: { name: "orphan", displayName: "孤兒", extends: "missing" } };
    expect(() => resolveDomain("orphan", bad, BASE)).toThrow(/missing/);
  });

  test("兩層繼承 → 擋下（只允許一層）", () => {
    const deep = {
      ...PACKS,
      mid: { name: "mid", displayName: "中間", extends: "_base" },
      leaf: { name: "leaf", displayName: "葉", extends: "mid" },
    };
    expect(() => resolveDomain("leaf", deep, BASE)).toThrow(/一層/);
  });
});

// ── 範本 ────────────────────────────────────────────────────

describe("_template.md", () => {
  test("存在，且不會出現在可選領域裡", () => {
    expect(PACKS._template).toBeDefined();
    expect(Object.keys(PACKS).filter((n) => !n.startsWith("_"))).not.toContain("_template");
  });

  test("自己就是一個有效的包 — 使用者是照抄它的", () => {
    const d = resolveDomain("_template", PACKS, BASE);
    expect(d.sections.length).toBe(SEED_SECTIONS.length + 1);
    const byId = new Map(d.sections.map((s) => [s.id, s]));
    for (const g of [...d.gateSpec.groups, ...(d.gateSpec.hints ?? [])]) {
      for (const r of g.rules) {
        const sec = byId.get(r.section);
        expect(sec, `${r.id} 指向不存在的章節`).toBeDefined();
        for (const k of r.fields ?? []) {
          expect(sec!.fields.some((f) => f.key === k), `${r.id} 指向不存在的欄位 ${k}`).toBe(true);
        }
        if (r.require.kind === "match") {
          expect(() => new RegExp(r.require.re, r.require.flags)).not.toThrow();
        }
      }
    }
  });

  test("四種 predicate 都示範到了 — 少一種使用者就不知道它存在", () => {
    const raw = readFileSync(join(DIR, "_template.md"), "utf8");
    for (const kind of ["present", "minLength", "match", "bullets"]) {
      expect(raw, `範本沒示範 ${kind}`).toContain(kind);
    }
  });
});

// ── 全領域掃描：加一份 .md 就自動被這一組守住 ─────────────────

describe("每一個領域包的健全性", () => {
  const names = Object.keys(PACKS).filter((n) => !n.startsWith("_"));

  test("有可選的領域", () => {
    expect(names.length).toBeGreaterThan(0);
  });

  for (const name of names) {
    describe(name, () => {
      const d = resolveDomain(name, PACKS, BASE);

      test("解析得出章節與 gate", () => {
        expect(d.sections.length).toBeGreaterThanOrEqual(SEED_SECTIONS.length);
        expect(d.gateSpec.groups.length).toBeGreaterThanOrEqual(BASE_GATE_SPEC.groups.length);
      });

      test("章節 id 不重複", () => {
        const ids = d.sections.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
      });

      test("章節編號不重複（重號會讓大綱看起來像壞了）", () => {
        const ns = d.sections.map((s) => s.n);
        expect(new Set(ns).size).toBe(ns.length);
      });

      test("每個欄位 key 在同一章節內唯一", () => {
        for (const s of d.sections) {
          const keys = s.fields.map((f) => f.key);
          expect(new Set(keys).size, `${s.id} 有重複欄位 key`).toBe(keys.length);
        }
      });

      test("每條 gate 指向存在的章節與欄位", () => {
        const byId = new Map(d.sections.map((s) => [s.id, s]));
        for (const g of d.gateSpec.groups) {
          for (const r of g.rules) {
            const sec = byId.get(r.section);
            expect(sec, `${r.id} 指向不存在的章節 ${r.section}`).toBeDefined();
            for (const key of r.fields ?? []) {
              expect(
                sec!.fields.some((f) => f.key === key),
                `${r.id} 指向 ${r.section} 不存在的欄位 ${key}`,
              ).toBe(true);
            }
          }
        }
      });

      test("gate 與 pass 的 id 全域不重複", () => {
        const ids = d.gateSpec.groups.flatMap((g) => [
          ...g.rules.map((r) => r.id),
          ...(g.pass ? [g.pass.id] : []),
        ]);
        expect(new Set(ids).size).toBe(ids.length);
      });

      test("match 規則的 regex 編譯得過", () => {
        for (const g of d.gateSpec.groups) {
          for (const r of g.rules) {
            if (r.require.kind !== "match") continue;
            expect(
              () => new RegExp(r.require.re, r.require.flags),
              `${r.id} 的 regex 無效`,
            ).not.toThrow();
          }
        }
      });

      test("章節全空時直譯得動，且不漏出佔位符", () => {
        const r = runGateSpec(
          { sectionValues: {}, sectionStatuses: d.sections.map(() => "empty") },
          d.gateSpec,
        );
        expect(r.blocks).toBeGreaterThan(0);
        for (const f of r.findings) {
          expect(f.detail, `${f.id} 有未替換的佔位符`).not.toMatch(/\{(missing|count)\}/);
        }
      });
    });
  }
});

// ── 端到端：領域包的 gate 真的會判 ───────────────────────────

describe("digital_account 端到端", () => {
  const d = resolveDomain("digital_account", PACKS, BASE);
  const statuses = d.sections.map(() => "done");

  test("三章全空時，兩條 block 都亮（KYC 風險等級 + 個資法 §27）", () => {
    const r = runGateSpec({ sectionValues: {}, sectionStatuses: statuses }, d.gateSpec);
    const ids = r.findings.filter((f) => f.level === "block").map((f) => f.id);
    expect(ids).toContain("kyc-risk-tiers");
    expect(ids).toContain("privacy-art27");
    expect(r.canApprove).toBe(false);
  });

  test("寫對了就放行，且 pass finding 出現", () => {
    const values = {
      kyc_aml: {
        identity_flow: "第二類帳戶非臨櫃開戶，轉出上限 5 萬/日；第三類需臨櫃驗證",
        monitoring: "單筆逾 50 萬或單日累計逾 3 筆即觸發人工複核",
        str: "- 命中制裁名單，法遵組長 T+1 通報\n- 短期多筆拆單，風控值班人員當日通報",
      },
      privacy_security: {
        pii_scope: "身分證影像保存 30 日",
        safeguards: "依個資法第 27 條建立安全維護計畫，加密落地並留存稽核軌跡",
      },
      regulatory_filing: { filings: "• 金管會：開辦前函報\n• 聯徵：新開戶 T+1\n• 洗防中心：STR 個案" },
    };
    const r = runGateSpec({ sectionValues: values, sectionStatuses: statuses }, d.gateSpec);
    const domainBlocks = r.findings.filter(
      (f) => f.level === "block" && ["kyc-risk-tiers", "privacy-art27"].includes(f.id),
    );
    expect(domainBlocks).toHaveLength(0);
    expect(r.findings.map((f) => f.id)).toContain("kyc-risk-tiers-ok");
    expect(r.findings.map((f) => f.id)).toContain("privacy-art27-ok");
  });

  test("監控寫「異常時處理」但沒有門檻 → warn", () => {
    const values = { kyc_aml: { identity_flow: "第二類帳戶", monitoring: "發現異常時由風控人員處理" } };
    const r = runGateSpec({ sectionValues: values, sectionStatuses: statuses }, d.gateSpec);
    expect(r.findings.find((f) => f.id === "kyc-monitoring-threshold")?.level).toBe("warn");
  });

  test("領域 gate 不影響 _base 判定 — 通用規則照樣跑", () => {
    const r = runGateSpec({ sectionValues: {}, sectionStatuses: statuses }, d.gateSpec);
    expect(r.findings.map((f) => f.id)).toContain("summary-incomplete");
    expect(r.findings.map((f) => f.id)).toContain("non-goals-min");
  });
});

// ── 簽核關卡（frontmatter → resolveWorkflow）─────────────────

describe("領域包的 stages", () => {
  const FINANCIAL = ["payment", "lending", "wealth", "digital_account"];

  test("金融四包各自宣告了「金融法遵與風險」，而且逐字相同", () => {
    // 逐字相同才去得掉重複 —— 去重鍵是名字，差一個空格會變成兩個一樣的關卡
    for (const name of FINANCIAL) {
      const stages = PACKS[name]?.stages ?? [];
      expect(stages.map((w) => w.name)).toEqual([FINANCIAL_COMPLIANCE_STAGE_NAME]);
      expect(stages[0]!.kind).toBe("review");
      expect(stages[0]!.defaultActor).toBe("agent");
      expect(stages[0]!.required).toBe(true);
    }
  });

  test("generic 與 _base 不追加關卡", () => {
    expect(PACKS.generic?.stages ?? []).toHaveLength(0);
    expect(PACKS._base?.stages ?? []).toHaveLength(0);
  });

  test("resolveDomain 把關卡沿繼承鏈帶出來 —— 繼承 _base 不該把它吃掉", () => {
    for (const name of FINANCIAL) {
      const r = resolveDomain(name, PACKS, BASE);
      expect(r.stages.map((w) => w.name)).toEqual([FINANCIAL_COMPLIANCE_STAGE_NAME]);
    }
    expect(resolveDomain("generic", PACKS, BASE).stages).toHaveLength(0);
  });

  test("端到端：金融領域 × lean 範本 = 三關，合規關插在我核准之前", () => {
    const stages = resolveDomain("payment", PACKS, BASE).stages;
    expect(resolveWorkflow("lean", stages).map((w) => w.name)).toEqual([
      "AI 結構審查",
      FINANCIAL_COMPLIANCE_STAGE_NAME,
      "我核准",
    ]);
  });
});
