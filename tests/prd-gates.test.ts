/**
 * `evaluatePrdGates()` 的 characterization test。
 *
 * 這一份鎖的是「現況行為」，不是「正確行為」。W-B 要把這 216 行改寫成
 * 宣告式規則直譯器（present / minLength / match / bullets 四個 predicate），
 * 而重構的定義就是「行為不變」——沒有這份測試，那句話沒有意義。
 *
 * 所以裡面刻意保留了幾條看起來像 bug 的斷言（見 `describe("現況怪癖")`）。
 * 它們是契約的一部分：W-B 要改可以，但必須是有意識地改，而不是重構時掉了。
 */
import { describe, expect, test } from "bun:test";
import type { AppState, Section } from "../src/data/types";
import type { GateReport } from "../src/lib/gate-rules";
import { type GateSpec, runSectionCoach } from "../src/lib/gate-rules";
import { BASE_GATE_SPEC, evaluatePrdGates, gateSummaryLine } from "../src/lib/prd-gates";

type Values = Record<string, Record<string, string>>;

/**
 * `evaluatePrdGates` 只讀 state 的兩個欄位（sections 只用到 status）。
 * 為這件事組一份完整 AppState 是把測試變成 seed.ts 的複本——那才是脆的。
 * ponytail: 窄轉型換來的是「新增 AppState 欄位不會弄壞這份測試」。
 */
function st(sectionValues: Values, sectionStatuses: Section["status"][] = []): AppState {
  const sections = sectionStatuses.map((status, i) => ({ id: `s${i}`, status })) as Section[];
  return { sections, sectionValues } as unknown as AppState;
}

/** 取某條 finding；找不到回 undefined，讓斷言訊息直接指出缺哪條 */
function find(state: AppState, id: string) {
  return evaluatePrdGates(state).findings.find((f) => f.id === id);
}

/** 一份所有規則都通過的 baseline，供單一規則的變異測試使用 */
const OK: Values = {
  summary: {
    vision:
      "登入只有密碼一道防線，企業客戶的資安審查一再卡在同一個地方。本專案在既有登入／SSO 流程上補齊第二因素，把安全性從銷售障礙變成賣點。\n\n主要功能：\n• TOTP 驗證（Authenticator App）\n• WebAuthn 安全金鑰\n• 工作區強制政策與一次性復原碼",
    what: "在登入流程加入 TOTP 與 WebAuthn 第二因素",
    who: "企業租戶管理員",
    why: "三筆待簽合約將 2FA 列為簽約前提，Q4 前必須關閉缺口",
    tech: "• 主路徑：TOTP + WebAuthn\n• 刻意不選：簡訊 OTP（SIM 交換風險）",
  },
  problem: {
    problem:
      "目前僅密碼守護工作區。對需符合 SOC 2 的企業租戶，這是控制面缺口而非觀感問題，近六次審查有三次列為阻擋項。",
  },
  goals: {
    goals: "- 企業租戶可強制啟用第二因素\n- 使用者可自助綁定與復原",
    nongoals: "- 不做簡訊 OTP\n- 不做生物辨識\n- 不做 SSO 改造",
  },
  metrics: {
    target: "啟用率 ≥ 60%",
    how: "以 90 天內完成綁定的租戶數 / 總租戶數量測，p95 綁定耗時 < 120 秒",
  },
  open: { oq: "復原碼輪替頻率由誰決定？— 需在 Q4 前定案" },
};

/** baseline 疊上一層覆寫（section 層級整包換掉，維持測試意圖直白） */
function withSection(base: Values, sectionId: string, vals: Record<string, string>): Values {
  return { ...base, [sectionId]: vals };
}

// ── baseline ────────────────────────────────────────────────

describe("baseline：全部達標", () => {
  test("無 block、可送審、可核准", () => {
    const r = evaluatePrdGates(st(OK));
    expect(r.blocks).toBe(0);
    expect(r.canSubmit).toBe(true);
    expect(r.canApprove).toBe(true);
  });

  test("五條 pass 全數命中", () => {
    const ids = evaluatePrdGates(st(OK))
      .findings.filter((f) => f.level === "pass")
      .map((f) => f.id)
      .sort();
    expect(ids).toEqual(["goals-ok", "metrics-ok", "non-goals-ok", "summary-ok", "summary-tech-ok"]);
  });
});

// ── 規則 1：三行摘要 ─────────────────────────────────────────

describe("summary — what / who / why", () => {
  test("缺一欄即 block，detail 列出缺哪些", () => {
    const f = find(st(withSection(OK, "summary", { ...OK.summary, who: "" })), "summary-incomplete");
    expect(f?.level).toBe("block");
    expect(f?.detail).toContain("who");
    expect(f?.untouched).toBe(false);
  });

  test("三欄全缺才標 untouched（「還沒開始」≠「做錯了」）", () => {
    const f = find(st(withSection(OK, "summary", { tech: OK.summary.tech })), "summary-incomplete");
    expect(f?.untouched).toBe(true);
    expect(f?.level).toBe("block");
  });

  test("只有空白字元視同未填", () => {
    const f = find(st(withSection(OK, "summary", { ...OK.summary, what: "   " })), "summary-incomplete");
    expect(f?.level).toBe("block");
  });
});

describe("summary — 技術線選型", () => {
  test("未填 → warn: summary-tech-missing", () => {
    expect(find(st(withSection(OK, "summary", { ...OK.summary, tech: "" })), "summary-tech-missing")?.level).toBe("warn");
  });

  test("少於 12 字也算未填（不是只看空字串）", () => {
    expect(find(st(withSection(OK, "summary", { ...OK.summary, tech: "用 TOTP" })), "summary-tech-missing")).toBeDefined();
  });

  test("有內容但沒有「刻意不選」→ warn: summary-tech-boundary", () => {
    const v = withSection(OK, "summary", { ...OK.summary, tech: "主路徑採用 TOTP 搭配 WebAuthn 與復原碼機制" });
    expect(find(st(v), "summary-tech-boundary")?.level).toBe("warn");
  });

  test("邊界關鍵詞可用「排除」「out of scope」等替代寫法", () => {
    for (const kw of ["不做", "暫不", "排除", "不採用", "out of scope", "non-goal"]) {
      const v = withSection(OK, "summary", { ...OK.summary, tech: `主路徑 TOTP + WebAuthn；${kw} 簡訊 OTP` });
      expect(find(st(v), "summary-tech-ok"), `關鍵詞「${kw}」應被接受`).toBeDefined();
    }
  });
});

describe("summary — 功能說明與願景（W3-3：warn 級，不擋送審）", () => {
  const vision = (v: string) => st(withSection(OK, "summary", { ...OK.summary, vision: v }));
  const visionFindings = (v: string) =>
    evaluatePrdGates(vision(v)).findings.filter((f) => f.id.startsWith("summary-vision"));

  test("沒填 → warn（且不擋送審）", () => {
    const fs = visionFindings("");
    expect(fs.map((f) => f.id)).toEqual(["summary-vision-thin"]);
    expect(fs[0].level).toBe("warn");
    expect(evaluatePrdGates(vision("")).canSubmit).toBe(true);
  });

  test("只寫一行口號 → 仍 warn（判定不是只看有沒有字）", () => {
    const fs = visionFindings("打造業界最好用、最值得信賴的登入體驗。");
    expect(fs).toHaveLength(1);
    expect(fs[0].level).toBe("warn");
    expect(evaluatePrdGates(vision("打造業界最好用、最值得信賴的登入體驗。")).canSubmit).toBe(true);
  });

  test("敘事＋條列齊全 → 不出 warn", () => {
    expect(visionFindings(OK.summary.vision)).toHaveLength(0);
  });

  test("敘事夠長但沒有條列 → summary-vision-outline（刻意如此：hint 要求兩者都有）", () => {
    // 純敘事分段也算「沒有條列」——`bullets` predicate 的退回切分會放它過，
    // 所以這條走行首符號的 match。這是有意識的取捨，不是漏判。
    const prose =
      "登入只有密碼一道防線，企業客戶的資安審查一再卡在同一個地方。\n\n本專案在既有登入流程上補齊第二因素，把安全性從銷售障礙變成賣點，讓合約不再卡在資安審查。";
    expect(visionFindings(prose).map((f) => f.id)).toEqual(["summary-vision-outline"]);
    expect(evaluatePrdGates(vision(prose)).canSubmit).toBe(true);
  });

  test("願景不影響 summary-incomplete（block 只看 what／who／why）", () => {
    const r = evaluatePrdGates(vision(""));
    expect(r.findings.some((f) => f.id === "summary-incomplete")).toBe(false);
    expect(r.blocks).toBe(0);
  });
});

// ── 規則 2：Non-Goals ───────────────────────────────────────

describe("non-goals（S.CodingFlow 契約：至少 3 條）", () => {
  test("2 條 → block", () => {
    const v = withSection(OK, "goals", { ...OK.goals, nongoals: "- 不做簡訊 OTP\n- 不做生物辨識" });
    const f = find(st(v), "non-goals-min");
    expect(f?.level).toBe("block");
    expect(f?.detail).toContain("2");
  });

  test("完全空白 → block 且 untouched", () => {
    expect(find(st(withSection(OK, "goals", { ...OK.goals, nongoals: "" })), "non-goals-min")?.untouched).toBe(true);
  });

  test("編號清單（1. / 1)）與 * • 同樣算數", () => {
    const v = withSection(OK, "goals", { ...OK.goals, nongoals: "1. 不做簡訊\n2) 不做生物辨識\n• 不做 SSO" });
    expect(find(st(v), "non-goals-ok")).toBeDefined();
  });

  test("沒有列點符號時退回用 ; ；換行 切分", () => {
    const v = withSection(OK, "goals", { ...OK.goals, nongoals: "不做簡訊 OTP；不做生物辨識；不做 SSO 改造" });
    expect(find(st(v), "non-goals-ok")).toBeDefined();
  });

  test("退回切分時，長度 ≤ 4 的碎片不計入", () => {
    const v = withSection(OK, "goals", { ...OK.goals, nongoals: "不做簡訊 OTP；短；不做生物辨識" });
    const f = find(st(v), "non-goals-min");
    expect(f?.level).toBe("block");
    expect(f?.detail).toContain("2");
  });
});

// ── 規則 3：目標 ────────────────────────────────────────────

describe("goals", () => {
  test("少於 20 字 → block", () => {
    const f = find(st(withSection(OK, "goals", { ...OK.goals, goals: "讓使用者更安全" })), "goals-thin");
    expect(f?.level).toBe("block");
    expect(f?.untouched).toBe(false);
  });

  test("空字串 → block 且 untouched", () => {
    expect(find(st(withSection(OK, "goals", { ...OK.goals, goals: "" })), "goals-thin")?.untouched).toBe(true);
  });
});

// ── 規則 4：成功指標 ────────────────────────────────────────

describe("metrics", () => {
  test("少於 30 字 → block: metrics-missing", () => {
    expect(find(st(withSection(OK, "metrics", { target: "要變好" })), "metrics-missing")?.level).toBe("block");
  });

  test("夠長但沒有量測訊號 → warn: metrics-vague", () => {
    const v = withSection(OK, "metrics", {
      target: "希望啟用率明顯提升，並讓使用者覺得綁定流程順暢好用不卡關，整體滿意度也要跟著往上走",
    });
    expect(find(st(v), "metrics-vague")?.level).toBe("warn");
  });

  test("百分比／p95／≥／覆蓋率 任一即通過", () => {
    for (const sig of ["60%", "p95", "≥ 60", "覆蓋率", "至少 3"]) {
      const v = withSection(OK, "metrics", {
        target: `以 90 天內完成綁定的租戶比例量測，門檻設定為 ${sig} 並每月回顧一次`,
      });
      expect(find(st(v), "metrics-ok"), `訊號「${sig}」應被接受`).toBeDefined();
    }
  });

  test("metrics 是整個章節所有欄位合併判定（不是單一欄位）", () => {
    // 兩個欄位各自都不到 30 字，合併（\n 相接）後才過門檻
    const v = withSection(OK, "metrics", {
      target: "啟用率門檻設定為 ≥ 60% 並每月回顧",
      how: "以完成綁定的租戶數除以總租戶數量測",
    });
    expect(find(st(v), "metrics-ok")).toBeDefined();
  });
});

// ── 規則 5–7：問題陳述 / 開放問題 / 空白章節 ──────────────────

describe("problem / open / 空白章節", () => {
  test("問題陳述少於 40 字 → warn（不擋送審）", () => {
    const r = evaluatePrdGates(st(withSection(OK, "problem", { problem: "使用者覺得不安全" })));
    expect(r.findings.find((f) => f.id === "problem-thin")?.level).toBe("warn");
    expect(r.canSubmit).toBe(true);
  });

  test("開放問題有內容但沒有期限 → warn", () => {
    const v = withSection(OK, "open", { oq: "復原碼輪替頻率由誰決定？" });
    expect(find(st(v), "open-no-deadline")?.level).toBe("warn");
  });

  test("≥ 3 個章節標記 empty → warn: many-empty", () => {
    const f = find(st(OK, ["empty", "empty", "empty", "done"]), "many-empty");
    expect(f?.level).toBe("warn");
    expect(f?.detail).toContain("3");
  });

  test("2 個 empty 不觸發", () => {
    expect(find(st(OK, ["empty", "empty", "done"]), "many-empty")).toBeUndefined();
  });
});

// ── 彙總與計分 ──────────────────────────────────────────────

describe("彙總", () => {
  test("有 block 就不可送審、不可核准", () => {
    const r = evaluatePrdGates(st(withSection(OK, "goals", { ...OK.goals, goals: "" })));
    expect(r.canSubmit).toBe(false);
    expect(r.canApprove).toBe(false);
  });

  test("score 夾在 0–100，全空時不會變負數", () => {
    const r = evaluatePrdGates(st({}, ["empty", "empty", "empty"]));
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.blocks).toBe(4); // summary / non-goals / goals / metrics
  });

  test("score 公式：passes/findings*100 − blocks*15 − warns*5", () => {
    const r = evaluatePrdGates(st(OK));
    const passes = r.findings.filter((f) => f.level === "pass").length;
    const expected = Math.max(
      0,
      Math.min(100, Math.round((passes / r.findings.length) * 100 - r.blocks * 15 - r.warns * 5)),
    );
    expect(r.score).toBe(expected);
  });

  test("gateSummaryLine：全部沒動過時不講「阻擋」", () => {
    // main 的改動（1f92c57）：全部 block 都是「還沒開始」時，講「N 項阻擋」
    // 是錯的敘事——那是還沒開始，不是做錯了。合併時我這邊的 characterization
    // test 鎖著舊文案而紅掉，那正是它該做的事：逼人看見文案被改了。
    const r = (o: Partial<GateReport>): GateReport =>
      ({ findings: [], blocks: 0, warns: 0, untouchedBlocks: 0, activeBlocks: 0,
         canSubmit: true, canApprove: true, score: 0, ...o }) as GateReport;

    expect(gateSummaryLine(r({ blocks: 4, untouchedBlocks: 4, activeBlocks: 0 }))).toBe(
      "PRD 還沒開始（4 個必填章節）",
    );
    expect(gateSummaryLine(r({ blocks: 3, untouchedBlocks: 1, activeBlocks: 2, warns: 1 }))).toBe(
      "結構檢查：2 項要改 · 1 項還沒開始 · 1 警告",
    );
    expect(gateSummaryLine(r({ blocks: 2, untouchedBlocks: 0, activeBlocks: 2, warns: 1 }))).toBe(
      "結構檢查：2 項要改 · 1 警告",
    );
    expect(gateSummaryLine(r({ warns: 3 }))).toBe("結構檢查通過（3 則建議）");
    expect(gateSummaryLine(r({}))).toBe("結構檢查全部通過");
  });

  test("untouchedBlocks / activeBlocks 由直譯器算出，且相加等於 blocks", () => {
    // main 的計數靠 GateFinding.untouched，而直譯器保證只有 block 級規則帶那個
    // 旗標——兩邊的假設剛好對得上，這條測試把那個巧合釘成契約
    const r = evaluatePrdGates(st({}, ["empty", "empty", "empty"]));
    expect(r.blocks).toBe(4);
    expect(r.untouchedBlocks).toBe(4); // 全空 = 全部還沒開始
    expect(r.activeBlocks).toBe(0);

    const partial = evaluatePrdGates(st(withSection(OK, "goals", { ...OK.goals, goals: "太短" })));
    expect(partial.blocks).toBe(1);
    expect(partial.untouchedBlocks).toBe(0); // 寫了但不合格
    expect(partial.activeBlocks).toBe(1);
    expect(partial.untouchedBlocks + partial.activeBlocks).toBe(partial.blocks);
  });
});

// ── 現況怪癖：W-B 要改可以，但必須是有意識地改 ────────────────

describe("現況怪癖（刻意鎖住，供 W-B 判斷是否修）", () => {
  test("問題陳述寫得好時沒有對應的 pass finding — 只有懲罰沒有獎勵", () => {
    const r = evaluatePrdGates(st(OK));
    expect(r.findings.some((f) => f.id.startsWith("problem-"))).toBe(false);
  });

  test("開放問題完全空白時「沒有 finding」— 未填反而比填了沒期限乾淨", () => {
    const r = evaluatePrdGates(st(withSection(OK, "open", { oq: "" })));
    expect(r.findings.some((f) => f.id.startsWith("open-"))).toBe(false);
  });

  test("章節整包不存在時，行為等同全部空白（不會拋錯）", () => {
    const r = evaluatePrdGates(st({}));
    expect(r.blocks).toBe(4);
    expect(r.findings.some((f) => f.id === "summary-incomplete" && f.untouched)).toBe(true);
  });

  test("METRIC_RE 認「天」不認「週」「月」", () => {
    const long = "以租戶完成綁定的比例量測，並在期限內回顧一次確認達標情形如下所述";
    expect(find(st(withSection(OK, "metrics", { a: `${long} 30 天` })), "metrics-ok")).toBeDefined();
    expect(find(st(withSection(OK, "metrics", { a: `${long} 4 週` })), "metrics-vague")).toBeDefined();
  });

  test("goals 少於 20 字的判定含空白與標點，不是實字數", () => {
    // 19 個字元（含空格）→ 仍 block
    const v = withSection(OK, "goals", { ...OK.goals, goals: "a".repeat(19) });
    expect(find(st(v), "goals-thin")?.level).toBe("block");
    expect(find(st(withSection(OK, "goals", { ...OK.goals, goals: "a".repeat(20) })), "goals-ok")).toBeDefined();
  });
});

// ── 領域包契約：加規則不加程式 ────────────────────────────────

describe("領域包契約", () => {
  /** 一個假的 FinTech 領域包：只有資料，沒有任何 TypeScript 判定邏輯 */
  const DIGITAL_ACCOUNT: GateSpec = {
    groups: [
      ...BASE_GATE_SPEC.groups,
      {
        rules: [
          {
            id: "kyc-risk-tiers",
            level: "block",
            label: "KYC 缺風險等級對應",
            detail: "需列出風險等級對應（KYC1/2/3）與差異化措施",
            section: "kyc_aml",
            fields: ["identity_flow"],
            require: { kind: "match", re: "風險等級|risk tier|KYC ?[123]", flags: "i" },
          },
        ],
        pass: { id: "kyc-risk-tiers-ok", label: "KYC 風險等級已列", detail: "偵測到風險等級對應" },
      },
      {
        rules: [
          {
            id: "aml-str-bullets",
            level: "warn",
            label: "STR 通報要點不足",
            detail: "目前 {count} 條，建議至少 2 條（門檻與負責人）",
            section: "kyc_aml",
            fields: ["str"],
            require: { kind: "bullets", min: 2 },
          },
        ],
      },
    ],
    emptySections: BASE_GATE_SPEC.emptySections,
  };

  test("領域規則生效，且不影響 _base 的判定", () => {
    const v = { ...OK, kyc_aml: { identity_flow: "採用雙證件與人臉比對", str: "- 單筆 50 萬以上" } };
    const r = evaluatePrdGates(st(v), DIGITAL_ACCOUNT);
    expect(r.findings.find((f) => f.id === "kyc-risk-tiers")?.level).toBe("block");
    expect(r.findings.find((f) => f.id === "aml-str-bullets")?.detail).toContain("1");
    expect(r.canApprove).toBe(false);
    // _base 那五條 pass 一條都沒少
    expect(r.findings.filter((f) => f.level === "pass").map((f) => f.id)).toContain("summary-ok");
  });

  test("領域規則滿足時放行", () => {
    const v = {
      ...OK,
      kyc_aml: {
        identity_flow: "依 KYC1／KYC2／KYC3 風險等級對應差異化驗證",
        str: "- 單筆 50 萬以上\n- 短期多筆拆單",
      },
    };
    const r = evaluatePrdGates(st(v), DIGITAL_ACCOUNT);
    expect(r.canApprove).toBe(true);
    expect(r.findings.find((f) => f.id === "kyc-risk-tiers-ok")).toBeDefined();
  });

  test("預設仍走 _base（未傳 spec 時領域規則不存在）", () => {
    const r = evaluatePrdGates(st(OK));
    expect(r.findings.some((f) => f.id.startsWith("kyc-"))).toBe(false);
  });
});

// ── 寫作教練：與 gate 共用規則，但 hints 不進 gate ──────────────

describe("runSectionCoach", () => {
  const input = (vals: Values) => ({ sectionValues: vals, sectionStatuses: [] });

  test("hints 完全不進 gate（不影響能不能送審）", () => {
    const r = evaluatePrdGates(st(OK));
    const ids = r.findings.map((f) => f.id);
    expect(ids).not.toContain("summary-why-thin");
    expect(ids).not.toContain("summary-what-ok");
    expect(ids).not.toContain("stories-ac");
  });

  test("教練同時看得到 gate 規則與 hints", () => {
    const ids = runSectionCoach(input(OK), BASE_GATE_SPEC, "summary").map((f) => f.id);
    expect(ids).toContain("summary-ok"); // gate 來的
    expect(ids).toContain("summary-what-ok"); // hint 來的
  });

  test("只回傳該章節的 finding", () => {
    const ids = runSectionCoach(input(OK), BASE_GATE_SPEC, "goals").map((f) => f.id);
    expect(ids).toEqual(["non-goals-ok", "goals-ok"]);
  });

  test("「為何現在」太短會被提醒（gate 不管這件事）", () => {
    const v = withSection(OK, "summary", { ...OK.summary, why: "要做" });
    expect(runSectionCoach(input(v), BASE_GATE_SPEC, "summary").map((f) => f.id)).toContain(
      "summary-why-thin",
    );
    expect(evaluatePrdGates(st(v)).canSubmit).toBe(true);
  });

  test("使用者故事三句式：缺「以便」就提醒", () => {
    const has = { stories: { s: "作為管理員，我想要強制 2FA，以便通過稽核" } };
    const lacks = { stories: { s: "作為管理員，我想要強制 2FA" } };
    expect(runSectionCoach(input(has), BASE_GATE_SPEC, "stories")).toHaveLength(0);
    expect(runSectionCoach(input(lacks), BASE_GATE_SPEC, "stories").map((f) => f.id)).toEqual([
      "stories-ac",
    ]);
  });

  test("領域章節自動有教練內容 — 不需要改任何程式", () => {
    const spec: GateSpec = {
      ...BASE_GATE_SPEC,
      groups: [
        ...BASE_GATE_SPEC.groups,
        {
          rules: [
            {
              id: "kyc-risk-tiers",
              level: "block",
              label: "KYC 缺風險等級",
              detail: "需列出風險等級對應",
              section: "kyc_aml",
              fields: ["identity_flow"],
              require: { kind: "match", re: "風險等級" },
            },
          ],
        },
      ],
    };
    const ids = runSectionCoach(input({ kyc_aml: { identity_flow: "雙證件" } }), spec, "kyc_aml");
    expect(ids.map((f) => f.id)).toEqual(["kyc-risk-tiers"]);
    expect(ids[0].label).toBe("KYC 缺風險等級");
  });

  test("不存在的章節回空陣列，不拋錯", () => {
    expect(runSectionCoach(input(OK), BASE_GATE_SPEC, "不存在")).toEqual([]);
  });
});

describe("直譯器不變式", () => {
  test("detail 不會漏出未替換的佔位符", () => {
    const all = [
      ...evaluatePrdGates(st(OK)).findings,
      ...evaluatePrdGates(st({}, ["empty", "empty", "empty"])).findings,
    ];
    for (const f of all) {
      expect(f.detail, `${f.id} 的 detail 有未替換的佔位符`).not.toMatch(/\{(missing|count)\}/);
    }
  });

  test("一組規則最多只發一條負面 finding（不對同一個空欄位責備兩次）", () => {
    // tech 全空：只該有 summary-tech-missing，不該同時出現 summary-tech-boundary
    const r = evaluatePrdGates(st(withSection(OK, "summary", { ...OK.summary, tech: "" })));
    const tech = r.findings.filter((f) => f.id.startsWith("summary-tech"));
    expect(tech.map((f) => f.id)).toEqual(["summary-tech-missing"]);
  });

  test("warn 級規則不帶 untouched（只有擋人時才需要區分還沒開始）", () => {
    const r = evaluatePrdGates(st({}, ["empty", "empty", "empty"]));
    for (const f of r.findings.filter((x) => x.level !== "block")) {
      expect(f.untouched, `${f.id} 不該有 untouched`).toBeUndefined();
    }
  });
});
