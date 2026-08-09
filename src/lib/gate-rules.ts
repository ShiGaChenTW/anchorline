/**
 * 宣告式 gate 規則直譯器。
 *
 * 為什麼規則要變成資料：領域包（`_base` / `digital_account` / …）的契約是
 * 「加一個資料檔＝加一個領域，零程式碼改動」。規則只要還寫在 TypeScript 裡，
 * 新增一個產業就得改這個檔——那契約當場破功。
 *
 * 為什麼只有四個 predicate：`present` / `minLength` / `match` / `bullets`
 * 已經表達得出 `_base` 現有的八條規則（逐條對照過）。表達力更強的東西
 * （條件式、欄位間關係、跨章節推論）刻意不做——那條路的終點是自製 DSL，
 * 而真正需要判斷力的規則有更好的去處：交給 LLM 出 `warn`。
 *
 * 為什麼 block 一律走這裡而不是 LLM：Anchorline 的治理鏈賣點是可重播
 * （見 `replay.ts`）。LLM 判定的 block 重播不出來，那條鏈就不能拿給人看。
 */

export type GateLevel = "pass" | "warn" | "block";

export type GateFinding = {
  id: string;
  level: GateLevel;
  label: string;
  detail: string;
  /**
   * 來源欄位完全空白 = 「還沒開始」，不是「做錯了」。
   * 判定等級不變（仍擋送審），只讓 UI 用中性符號呈現。
   * ADHD／RSD：未嘗試就先看到紅叉會觸發迴避。
   *
   * 只有 block 級規則會帶這個旗標——擋人的時候才需要區分這兩件事，
   * warn 不擋任何流程，多一個中性符號只是噪音。
   */
  untouched?: boolean;
};

export type GateReport = {
  findings: GateFinding[];
  blocks: number;
  warns: number;
  /**
   * block 中「還沒開始」的數量（來源欄位全空）。
   * `blocks` 不減 —— 送審門檻不變；但跨專案彙總時必須分開講：
   * 把「還沒寫」跟「寫了但不合格」加成同一個數字，會讓總覽首屏
   * 出現一個誇大的阻擋總數，正是那一頁想消除的那種焦慮。
   *
   * 這兩個欄位靠 `GateFinding.untouched`，而直譯器保證只有 block 級規則會帶
   * 那個旗標（見 runGroups）——合併時這一點剛好對得上，不需要額外的判定。
   */
  untouchedBlocks: number;
  /** block 中真的「動過但沒過」的數量 = blocks - untouchedBlocks */
  activeBlocks: number;
  /** 可送審：無 block */
  canSubmit: boolean;
  /** 可核准：無 block（可另加更嚴規則） */
  canApprove: boolean;
  score: number;
};

/** 四個 predicate。regex 存成字串而非 RegExp，才能直接來自 frontmatter。 */
export type GatePredicate =
  | { kind: "present" }
  | { kind: "minLength"; n: number }
  | { kind: "match"; re: string; flags?: string }
  | { kind: "bullets"; min: number };

export type GateRule = {
  id: string;
  level: "block" | "warn";
  label: string;
  /** 支援 `{missing}`（未填欄位標籤）與 `{count}`（實際計數）兩個佔位符 */
  detail: string;
  section: string;
  /** 省略 = 該章節所有欄位以 `\n` 合併判定 */
  fields?: string[];
  /** `present` 專用：產生 detail 的 `{missing}` 時要顯示的欄位名稱 */
  require: GatePredicate;
};

/**
 * 一組依序判定的規則。第一條失敗就停手，後面不再判。
 *
 * 這個「短路」是必要的，不是最佳化：對一個空欄位同時喊「太短」跟「缺量測訊號」
 * 是兩次責備同一件還沒發生的事。ADHD／RSD 對這個特別敏感。
 */
export type GateGroup = {
  rules: GateRule[];
  /** 全部通過時發出的正面 finding；省略則通過時不發任何 finding */
  pass?: { id: string; label: string; detail: string };
  /** 來源欄位全空時整組跳過（未填的開放問題不該被念「缺期限」） */
  skipWhenEmpty?: boolean;
};

export type GateSpec = {
  groups: GateGroup[];
  /**
   * 只給寫作教練看的軟提示，**完全不進 gate**。
   *
   * 為什麼要分開：治理鏈上的 block/warn 決定能不能送審，那是不能隨手加的；
   * 但「『為何現在』寫得有點薄」這種提醒加十條也不該影響任何人的簽核。
   * 兩者共用同一套規則語言（同樣四個 predicate），只是消費端不同——
   * 這樣就不會為了教練再長出第三套規則系統。
   */
  hints?: GateGroup[];
  /** 多少個 `status === "empty"` 的章節開始 warn；省略則不檢查 */
  emptySections?: { warnAt: number; id: string; label: string; detail: string };
};

/** 直譯器需要的最小輸入。刻意不吃 AppState——領域包測試不該被迫組一份完整 state。 */
export type GateInput = {
  sectionValues: Record<string, Record<string, string>>;
  sectionStatuses: string[];
};

// ── predicate 實作 ──────────────────────────────────────────

/** 把列點文字拆成條目；沒有列點符號時退回用 `; ； 換行` 切 */
function countBullets(text: string): number {
  const marked = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[-*•]/.test(l) || /^\d+[\.\)]/.test(l))
    .map((l) => l.replace(/^[-*•]\s*/, "").replace(/^\d+[\.\)]\s*/, "").trim())
    .filter(Boolean);
  if (marked.length) return marked.length;
  // 退回切分時濾掉碎片：「短」不是一條非目標
  return text ? text.split(/[;；\n]/).filter((x) => x.trim().length > 4).length : 0;
}

function fieldText(input: GateInput, rule: GateRule): string {
  const vals = input.sectionValues[rule.section] ?? {};
  if (!rule.fields) return Object.values(vals).join("\n");
  return rule.fields.map((k) => vals[k] ?? "").join("\n");
}

/** 未填的欄位鍵（僅 `present` 用得上） */
function missingFields(input: GateInput, rule: GateRule): string[] {
  const vals = input.sectionValues[rule.section] ?? {};
  return (rule.fields ?? Object.keys(vals)).filter((k) => !(vals[k] ?? "").trim());
}

type Outcome = { ok: boolean; count: number; missing: string[] };

function evaluateRule(input: GateInput, rule: GateRule): Outcome {
  const text = fieldText(input, rule).trim();
  const p = rule.require;
  switch (p.kind) {
    case "present": {
      const missing = missingFields(input, rule);
      return { ok: missing.length === 0, count: missing.length, missing };
    }
    case "minLength":
      return { ok: text.length >= p.n, count: text.length, missing: [] };
    case "match":
      return { ok: new RegExp(p.re, p.flags).test(text), count: 0, missing: [] };
    case "bullets": {
      const n = countBullets(text);
      return { ok: n >= p.min, count: n, missing: [] };
    }
  }
}

function interpolate(tpl: string, o: Outcome): string {
  return tpl.replace("{missing}", o.missing.join(", ")).replace("{count}", String(o.count));
}

// ── 直譯 ────────────────────────────────────────────────────

/** 跑一組 group，回傳 findings。gate 與教練共用這一段。 */
function runGroups(input: GateInput, groups: GateGroup[]): GateFinding[] {
  const findings: GateFinding[] = [];

  for (const group of groups) {
    if (group.skipWhenEmpty) {
      const blank = group.rules.every((r) => !fieldText(input, r).trim());
      if (blank) continue;
    }

    let failed = false;
    for (const rule of group.rules) {
      const o = evaluateRule(input, rule);
      if (o.ok) continue;
      findings.push({
        id: rule.id,
        level: rule.level,
        label: rule.label,
        detail: interpolate(rule.detail, o),
        // 擋人的時候才需要區分「還沒開始」與「做錯了」
        ...(rule.level === "block" ? { untouched: !fieldText(input, rule).trim() } : {}),
      });
      failed = true;
      break; // 短路：不對同一個空欄位責備兩次
    }

    if (!failed && group.pass) {
      // pass 的 detail 也可能要 {count}（「已有 3 條非目標」），用最後一條規則的結果
      const last = group.rules[group.rules.length - 1];
      const o = last ? evaluateRule(input, last) : { ok: true, count: 0, missing: [] };
      findings.push({ ...group.pass, level: "pass", detail: interpolate(group.pass.detail, o) });
    }
  }

  return findings;
}

/**
 * 單一章節的寫作教練檢查：該章節的 gate 規則 + 只給教練看的 hints。
 *
 * 教練與 gate 讀同一份領域包——所以新增一個領域包的章節，本機教練
 * 自動就有東西可講，不必再去改 `ai-coach.ts` 的 if/else。
 */
export function runSectionCoach(input: GateInput, spec: GateSpec, sectionId: string): GateFinding[] {
  const mine = (g: GateGroup) => g.rules.some((r) => r.section === sectionId);
  return runGroups(input, [...spec.groups.filter(mine), ...(spec.hints ?? []).filter(mine)]);
}

export function runGateSpec(input: GateInput, spec: GateSpec): GateReport {
  // hints 不進 gate——那是教練的東西，不該影響能不能送審
  const findings = runGroups(input, spec.groups);

  const es = spec.emptySections;
  if (es) {
    const n = input.sectionStatuses.filter((s) => s === "empty").length;
    if (n >= es.warnAt) {
      findings.push({
        id: es.id,
        level: "warn",
        label: es.label,
        detail: es.detail.replace("{count}", String(n)),
      });
    }
  }

  const blockFindings = findings.filter((f) => f.level === "block");
  const blocks = blockFindings.length;
  const untouchedBlocks = blockFindings.filter((f) => f.untouched).length;
  const warns = findings.filter((f) => f.level === "warn").length;
  const passes = findings.filter((f) => f.level === "pass").length;
  const score = Math.max(
    0,
    Math.min(100, Math.round((passes / Math.max(1, findings.length)) * 100 - blocks * 15 - warns * 5)),
  );

  return {
    findings,
    blocks,
    warns,
    untouchedBlocks,
    activeBlocks: blocks - untouchedBlocks,
    canSubmit: blocks === 0,
    canApprove: blocks === 0,
    score,
  };
}
