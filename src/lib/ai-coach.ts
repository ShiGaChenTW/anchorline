/**
 * AI 助教：真實模型呼叫 + 本機規則檢查（誠實標示）
 * 禁止再回傳假 2FA demo 文案。
 */
import { store } from "../data/store";
import type { AISettings, Section } from "../data/types";
import { type GateSpec, runSectionCoach } from "./gate-rules";
import { BASE_GATE_SPEC } from "./prd-gates";
import {
  AiError,
  chatCompletion,
  extractJsonObject,
  getAiReadiness,
  isAiConfigured,
  chatCompletionStream,
} from "./ai-client";

export type AICritique = {
  score: number;
  grade: "S" | "A" | "B" | "C";
  summary: string;
  strengths: string[];
  warnings: string[];
  suggestions: string[];
  /** true = 僅本機規則，未呼叫 LLM */
  localOnly: boolean;
  suggestedPatch?: Record<string, string>;
};

/**
 * 偏好設定的 linter 開關對應到哪些規則 id。
 *
 * 只影響教練，**不影響 gate**——能不能送審是治理鏈的事，
 * 不該讓使用者在偏好設定裡關掉。
 */
const LINTER_RULES: Record<string, string[]> = {
  requireNonGoals: ["non-goals-min", "non-goals-ok"],
  requireMetrics: ["metrics-missing", "metrics-vague", "metrics-ok"],
  requireStoriesAC: ["stories-ac"],
};

function suppressed(findingId: string, settings: AISettings): boolean {
  for (const [toggle, ids] of Object.entries(LINTER_RULES)) {
    if (settings.enableLinters[toggle as keyof AISettings["enableLinters"]]) continue;
    if (ids.includes(findingId)) return true;
  }
  return false;
}

const VAGUE_TERMS = ["優化", "儘快", "盡快", "大幅", "適當", "良好", "提升體驗", "更好", "儘可能"];

// 分級門檻的唯一出處在 ai-shared.ts（純函式才測得到）；本機與 AI 兩軌都用它
import { gradeFromScore } from "./ai-shared";
export { gradeFromScore };
import { aiTellFindings, DEFAULT_STYLE_SAMPLE, WRITING_DISCIPLINE } from "./ai-tells";
import { promptSystem, promptTemperature } from "./prompt-registry";

function langHint(settings: AISettings): string {
  return settings.language === "en-US" ? "English" : "Traditional Chinese (zh-TW)";
}

function personaHint(settings: AISettings): string {
  switch (settings.persona) {
    case "executive":
      return "executive-ready, business risk and outcomes first";
    case "technical":
      return "technical architect, APIs and boundaries first";
    case "concise":
      return "concise bullets, minimal filler";
    default:
      return "detailed specification with examples";
  }
}

/**
 * 領域包的法遵知識疊在每一段 system prompt 最前面。
 *
 * 這是 prd-agent 真正的價值所在（它自己的 §1.2 就這麼寫）——KYC 分類、AML STR、
 * 個資法 §27、金管會函令、聯徵通報。不接這一段，領域包就只是多了幾個空欄位。
 *
 * 疊在「最前面」而不是附在後面：模型對 system prompt 開頭的服從度較高，而
 * 領域法遵是不可讓步的那一類要求。
 */
function withDomain(system: string): string {
  const d = store.get().projects.find((p) => p.id === store.get().activeProjectId)?.domain;
  if (!d) return system;
  const prompt = store.activeDomainPrompt().trim();
  return prompt ? `${prompt}\n\n---\n\n${system}` : system;
}

/** 本機規則檢查（不需 API Key；誠實標示 localOnly） */
export function critiqueSectionLocal(
  section: Section,
  values: Record<string, string>,
  settings: AISettings,
  spec: GateSpec = BASE_GATE_SPEC,
): AICritique {
  const text = Object.values(values).join("\n");
  const warnings: string[] = [];
  const strengths: string[] = [];
  const suggestions: string[] = [];

  if (settings.enableLinters.warnVagueTerms) {
    const foundVague = VAGUE_TERMS.filter((w) => text.includes(w));
    if (foundVague.length > 0) {
      warnings.push(
        `檢測到模糊描述詞：${foundVague.map((w) => `「${w}」`).join("、")}。建議替換為量化數據或可驗收標準。`,
      );
    }
    // AI 味檢查掛在同一個開關下：同屬「文字品質」，不值得多一個設定。
    // 主要抓結構（長句／不分段／超長條列）—— HelmDeck 樣本的病灶是節奏不是空話
    for (const f of aiTellFindings(text)) warnings.push(f.message);
  }

  // 章節規則全部來自領域包（gate + hints），教練不再認得任何章節 id。
  // 新增一個領域包的章節，這裡自動就有東西可講。
  const findings = runSectionCoach(
    { sectionValues: { [section.id]: values }, sectionStatuses: [] },
    spec,
    section.id,
  ).filter((f) => !suppressed(f.id, settings));

  for (const f of findings) {
    if (f.level === "pass") {
      strengths.push(`${f.label}。`);
      continue;
    }
    warnings.push(`${f.label}。`);
    if (f.detail) suggestions.push(f.detail);
  }

  const filled = Object.values(values).join("").trim().length;
  let baseScore = filled > 200 ? 78 : filled > 80 ? 65 : 48;
  if (warnings.length > 0) baseScore -= warnings.length * 7;
  if (strengths.length > 0) baseScore += strengths.length * 5;
  const score = Math.max(25, Math.min(96, baseScore));
  const grade = gradeFromScore(score);

  return {
    score,
    grade,
    summary: `【本機規則檢查】${
      score >= 85
        ? "本章骨架達標。"
        : score >= 70
          ? "結構尚可，建議補強警告項。"
          : "關鍵內容不足，請先補齊再送審。"
    }（未呼叫雲端模型）`,
    strengths: strengths.length ? strengths : ["已可讀"],
    warnings: warnings.length ? warnings : ["本機規則未發現明顯問題"],
    suggestions: suggestions.length ? suggestions : ["可進下一節或使用已設定 API 的 AI 助教深化"],
    localOnly: true,
  };
}

export async function critiqueSectionWithAI(
  section: Section,
  values: Record<string, string>,
  settings: AISettings,
  spec: GateSpec = BASE_GATE_SPEC,
): Promise<AICritique> {
  const local = critiqueSectionLocal(section, values, settings, spec);
  if (!isAiConfigured()) return local;

  try {
    const fields = section.fields
      .map((f) => `### ${f.label} (${f.key})\n${(values[f.key] || "").trim() || "（空）"}`)
      .join("\n\n");
    const system = promptSystem("critique-section", {
      lang: langHint(settings),
      persona: personaHint(settings),
    });
    // 本機結果為空時會塞佔位句（「本機規則未發現明顯問題」），那不是 finding，
    // 不進 AI 的參考清單、也不進聯集——否則每份 AI 結果都拖著一句空話。
    const isPlaceholder = (x: string) =>
      ["本機規則未發現明顯問題", "已可讀", "可進下一節或使用已設定 API 的 AI 助教深化"].includes(x);
    const localWarnings = local.warnings.filter((w) => !isPlaceholder(w));
    const localStrengths = local.strengths.filter((s) => !isPlaceholder(s));
    const localSuggestions = local.suggestions.filter((s) => !isPlaceholder(s));
    const findings =
      [
        ...localWarnings.map((w) => `- warn: ${w}`),
        ...localStrengths.map((s) => `- pass: ${s}`),
      ].join("\n") || "（本機規則未發現問題）";
    const user = `Section: ${section.n} ${section.title}\nGuide: ${section.guide}\n\nContent:\n${fields}

Local rule findings (expand or refine; do not contradict without stating why):
${findings}`;
    const raw = await chatCompletion(withDomain(system), user, {
      temperature: promptTemperature("critique-section"),
      jsonMode: true,
    });
    const obj = extractJsonObject(raw);
    if (!obj) {
      return {
        ...local,
        summary: `【AI】${raw.slice(0, 280)}`,
        localOnly: false,
        warnings: [...local.warnings, "模型未回傳標準 JSON，以上含本機規則結果"],
      };
    }
    const score = Math.max(0, Math.min(100, Number(obj.score) || local.score));
    const asList = (v: unknown) =>
      Array.isArray(v) ? v.map(String).filter(Boolean) : [];
    // 聯集去重：本機規則的 warn 是決定性檢查的結果，AI 說什麼都不能讓它消失。
    const union = (base: string[], extra: string[]) => {
      const seen = new Set(base.map((x) => x.trim()));
      return [...base, ...extra.filter((x) => !seen.has(x.trim()))];
    };
    return {
      score,
      // grade 一律由程式用與本機同一套門檻計算，模型不再回答這一欄
      grade: gradeFromScore(score),
      summary: `【AI · ${settings.model}】${String(obj.summary || "").trim() || local.summary}`,
      strengths: asList(obj.strengths).length ? asList(obj.strengths) : local.strengths,
      warnings: union(localWarnings, asList(obj.warnings)),
      suggestions: union(localSuggestions, asList(obj.suggestions)),
      localOnly: false,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ...local,
      summary: `【本機規則】AI 深度評估失敗：${msg}`,
      warnings: [...local.warnings, `雲端評估未完成：${msg}`],
      localOnly: true,
    };
  }
}

/**
 * 依章節欄位生成／改寫內容。
 * 必須有 API Key；禁止硬編碼 demo 文案。
 */
export type DraftStreamOpts = {
  /** 逐字回吐。給了就走串流；沒給就走原本的一次性請求。 */
  onDelta?: (chunk: string, full: string) => void;
  signal?: AbortSignal;
};

export async function generateAIDraft(
  section: Section,
  currentValues: Record<string, string>,
  prompt?: string,
  stream?: DraftStreamOpts,
  /** 已寫章節的摘錄（writeFullPrd 逐節累積傳入），讓後面的章節呼應前面 */
  projectContext?: string,
): Promise<Record<string, string>> {
  const ready = getAiReadiness();
  if (!ready.ok) throw new AiError(ready.reason, "not_configured");

  const settings = store.get().settings;
  // 依目前專案的領域包解析：領域自訂優先，沒設定就沿用通用
  const writing = store.activeWriting();
  const fieldSpec = section.fields
    .map((f) => `- ${f.key}（${f.label}）：${f.hint || f.type}`)
    .join("\n");
  const current = section.fields
    .map((f) => `### ${f.key}\n${(currentValues[f.key] || "").trim() || "（空）"}`)
    .join("\n\n");

  // 用該章實際的前兩個欄位 key 組出 mini example——few-shot 用真 key，
  // 模型照抄結構時就不會發明自己的 key 名。
  const exKeys = section.fields.slice(0, 2).map((f) => f.key);
  const example =
    exKeys.length >= 2
      ? `{"${exKeys[0]}":"...","${exKeys[1]}":"- ...\\n- ..."}`
      : `{"${exKeys[0] ?? "field"}":"..."}`;

  const system = promptSystem("draft-section", {
    lang: langHint(settings),
    persona: personaHint(settings),
    discipline: WRITING_DISCIPLINE,
    example,
    styleSample: (writing.styleSample.trim() || DEFAULT_STYLE_SAMPLE).slice(0, 1500),
  });

  const user = `Section ${section.n} ${section.title}
Guide: ${section.guide}
Tips: ${section.tips.join("；")}

Fields:
${fieldSpec}

${
    projectContext?.trim()
      ? `Project context (already written sections, excerpts — keep new content consistent with these):
${projectContext.trim()}

`
      : ""
  }Current draft:
${current}

${writing.globalInstruction.trim() ? `Workspace guidance (applies to every section):\n${writing.globalInstruction.trim()}\n\n` : ""}${prompt ? `User instruction:\n${prompt}\n` : "User instruction: improve and fill empty fields based on existing context.\n"}
Return JSON with keys: ${section.fields.map((f) => f.key).join(", ")}`;

  // 串流只影響「怎麼拿到文字」，不影響之後的解析 —— 模型輸出是一份 JSON，
  // 逐字時還不是合法 JSON，所以邊收邊顯示、收完才 parse。
  const draftOpts = { temperature: promptTemperature("draft-section"), jsonMode: true };
  const raw = stream?.onDelta
    ? await chatCompletionStream(withDomain(system), user, stream.onDelta, stream.signal, draftOpts)
    : await chatCompletion(withDomain(system), user, draftOpts);
  const obj = extractJsonObject(raw);
  if (!obj) {
    // 若模型只回一段文字且只有單一主欄位，塞進第一個 textarea
    const first = section.fields.find((f) => f.type === "textarea") ?? section.fields[0];
    if (first && raw.trim()) return { [first.key]: raw.trim() };
    throw new AiError("模型未回傳可用的欄位 JSON，請重試或簡化指令", "parse");
  }

  const patch: Record<string, string> = {};
  for (const f of section.fields) {
    const v = obj[f.key];
    if (v != null && String(v).trim()) patch[f.key] = String(v).trim();
  }
  if (!Object.keys(patch).length) {
    throw new AiError("模型回傳的 JSON 沒有任何對應章節欄位", "empty");
  }
  return patch;
}

export async function polishTextWithAI(
  text: string,
  mode: "concise" | "executive" | "technical" | "deflate",
  /** 章節標題與欄位 label——沒有上下文的逐欄潤色會讓術語漂移 */
  ctx?: { sectionTitle?: string; fieldLabel?: string },
): Promise<string> {
  const ready = getAiReadiness();
  if (!ready.ok) throw new AiError(ready.reason, "not_configured");
  if (!text.trim()) return text;

  const settings = store.get().settings;
  const modeHint =
    mode === "concise"
      ? "Make concise: shorter, denser, keep facts."
      : mode === "executive"
        ? "Rewrite for executives: outcomes, risk, decision clarity."
        : mode === "deflate"
          ? // 去 AI 味：只動結構與空話，一個事實都不准加。
            // 「更短或等長」是可驗的出口條件 —— 變長就代表它在加內容
            `Remove AI-flavored writing, add NOTHING:
- Split any sentence over ${80} chars into short ones. Unnest 「——」 and parenthetical asides.
- Break walls of text into paragraphs (blank line every 2-3 sentences).
- Bullets: one-line conclusion first; move detail to sub-bullets or drop it.
- Delete filler and boilerplate phrases outright.
- Every fact, number, path, and name in the source must survive. The result must be SHORTER or equal in length.`
          : "Rewrite for engineers: interfaces, constraints, edge cases.";

  // 潤色刻意不疊 withDomain()：整包法遵知識疊上來，欄位會越潤越像合規說明書。
  // 只留一句守住領域術語的底線。
  const system = promptSystem("polish", { lang: langHint(settings), modeHint });
  const user =
    ctx?.sectionTitle || ctx?.fieldLabel
      ? `Section: ${ctx.sectionTitle || "（未知）"} / Field: ${ctx.fieldLabel || "（未知）"}\n\n${text}`
      : text;
  return await chatCompletion(system, user, { temperature: promptTemperature("polish") });
}

/** Agent 進場：依 role/prompt 產出結果文字（真實模型） */
export async function runAgentTask(opts: {
  agentName: string;
  agentRole: string;
  agentPrompt: string;
  task: string;
  projectTitle: string;
  note: string;
  contextSnippet: string;
}): Promise<string> {
  const ready = getAiReadiness();
  if (!ready.ok) throw new AiError(ready.reason, "not_configured");
  const settings = store.get().settings;
  // 「System prompt:」嵌套會讓模型把 agent 指令當成被引用的資料而非指令；
  // 層級化的 Standing instructions ＋按 task type 的輸出契約，模板在 prompt-registry
  const system = promptSystem("agent-task", {
    agentName: opts.agentName,
    agentRole: opts.agentRole || "PRD collaborator",
    standing: opts.agentPrompt || "（未設定 prompt，請以專業 PM/工程審閱者身份回覆）",
    lang: langHint(settings),
    task: opts.task,
  });

  const user = `Project: ${opts.projectTitle}
Note: ${opts.note || "（無）"}

Context (truncated excerpts; do not treat missing text as absent content):
${opts.contextSnippet.slice(0, 6000) || "（無內文）"}

Deliver the output your task type's contract asks for.`;

  return await chatCompletion(withDomain(system), user, {
    temperature: promptTemperature("agent-task"),
  });
}

export { getAiReadiness, isAiConfigured, AiError };

// ── AI 撰寫初版 PRD ────────────────────────────────────────────

export type WriteProgress = {
  /** 目前處理到第幾節（1-based） */
  index: number;
  total: number;
  section: Section;
  phase: "start" | "done" | "failed" | "skipped";
  /** done 時帶回這一節寫出來的欄位 */
  patch?: Record<string, string>;
  error?: string;
};

export type WriteFullOptions = {
  /** 只寫這幾節；不給就全部 */
  sectionIds?: string[];
  /**
   * 已經有內容的章節要不要重寫。
   * 預設 false —— 覆蓋使用者已經寫好的東西是最不該預設發生的事。
   */
  overwriteFilled?: boolean;
  /** 額外指令，會併進每一節的 prompt */
  instruction?: string;
  onProgress?: (p: WriteProgress) => void;
  /** 逐字回吐目前這一節的原始輸出（尚未解析的 JSON 文字） */
  onDelta?: (chunk: string, full: string, section: Section) => void;
  signal?: AbortSignal;
};

/** 這一節算不算「已經有內容」 */
function sectionHasContent(values: Record<string, string>): boolean {
  return Object.values(values).join("").trim().length >= 20;
}

/**
 * 逐節撰寫初版 PRD。
 *
 * **刻意序列而非並行。** 三個理由：
 * 1. 後面的章節要看得到前面寫了什麼（目標要呼應問題陳述），並行就各寫各的。
 * 2. 使用者要看得到「正在寫哪一節」—— 並行只會得到一個轉圈圈。
 * 3. 免費／低階 API 金鑰幾乎都有併發限制，並行第一個撞上的就是 429。
 *
 * 每寫完一節就立刻回報並落地，中途取消會保留已完成的部分 —— 寫了五節被
 * 取消卻整批丟掉，比不做這個功能還糟。
 */
export async function writeFullPrd(
  sections: Section[],
  valuesOf: (s: Section) => Record<string, string>,
  opts: WriteFullOptions = {},
): Promise<{ written: number; failed: number; skipped: number }> {
  const ready = getAiReadiness();
  if (!ready.ok) throw new AiError(ready.reason, "not_configured");

  const targets = opts.sectionIds?.length
    ? sections.filter((s) => opts.sectionIds!.includes(s.id))
    : sections;

  let written = 0;
  let failed = 0;
  let skipped = 0;

  // 跨章上下文：每寫完（或跳過但已有內容的）一節，留一段摘錄給後面的章節，
  // 讓「目標要呼應問題陳述」真的發生。每節截 300 字、總預算 3000 字，
  // 超過就丟最舊的——最近的章節對下一節最有參考價值。
  const ctxParts: string[] = [];
  const pushContext = (section: Section, values: Record<string, string>) => {
    const excerpt = Object.values(values)
      .map((v) => (v || "").trim())
      .filter(Boolean)
      .join("\n")
      .slice(0, 300);
    if (!excerpt) return;
    ctxParts.push(`## ${section.n} ${section.title}\n${excerpt}`);
    while (ctxParts.join("\n\n").length > 3000 && ctxParts.length > 1) ctxParts.shift();
  };

  for (let i = 0; i < targets.length; i++) {
    if (opts.signal?.aborted) break;
    const section = targets[i]!;
    const base = { index: i + 1, total: targets.length, section };

    const current = valuesOf(section);
    const overwrite = opts.overwriteFilled ?? store.get().settings.aiWriting?.overwriteFilled ?? false;
    if (!overwrite && sectionHasContent(current)) {
      skipped++;
      pushContext(section, current);
      opts.onProgress?.({ ...base, phase: "skipped" });
      continue;
    }

    opts.onProgress?.({ ...base, phase: "start" });
    try {
      // 每節覆寫優先於本次的一次性指令；兩者都沒有就用內建 prompt
      const perSection = store.activeWriting().sectionPrompts[section.id]?.trim();
      const patch = await generateAIDraft(
        section,
        current,
        perSection || opts.instruction,
        {
          onDelta: opts.onDelta ? (c, f) => opts.onDelta!(c, f, section) : undefined,
          signal: opts.signal,
        },
        ctxParts.join("\n\n") || undefined,
      );
      if (opts.signal?.aborted) break;
      written++;
      pushContext(section, { ...current, ...patch });
      opts.onProgress?.({ ...base, phase: "done", patch });
    } catch (e) {
      // 單節失敗不中斷整批 —— 一個章節寫壞不該讓另外六節也沒得寫
      failed++;
      opts.onProgress?.({
        ...base,
        phase: "failed",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { written, failed, skipped };
}

// ── AI 角色塑造建議 ────────────────────────────────────────────

export type SuggestedProfile = {
  name: string;
  description: string;
  globalInstruction: string;
  styleSample: string;
};

/**
 * 讓 AI 幫忙塑造一個撰寫角色。
 *
 * 為什麼值得做：「全域指令要寫什麼」是空白頁問題 —— 使用者知道自己想要
 * 什麼調性，但要把它寫成一段對模型有效的指令是另一回事。給一句話（「寫給
 * 法遵看的」），讓模型把它展開成可用的指令與範例，再由使用者修改，比
 * 從零開始寫容易得多。
 *
 * 產出**一定要讓使用者能改** —— 這是建議不是決定，所以呼叫端會把結果填進
 * 表單而不是直接套用。
 */
export async function suggestWriteProfile(brief: string): Promise<SuggestedProfile> {
  const ready = getAiReadiness();
  if (!ready.ok) throw new AiError(ready.reason, "not_configured");
  const settings = store.get().settings;

  const system = promptSystem("profile-suggest", { lang: langHint(settings) });

  const user = `Brief: ${brief.trim()}`;
  const raw = await chatCompletion(system, user, {
    temperature: promptTemperature("profile-suggest"),
    jsonMode: true,
  });
  const obj = extractJsonObject(raw);
  if (!obj) throw new AiError("模型沒有回傳可用的角色 JSON，請換個說法再試", "parse");

  const pick = (k: string) => String(obj[k] ?? "").trim();
  const name = pick("name") || "新角色";
  const globalInstruction = pick("globalInstruction");
  if (!globalInstruction) throw new AiError("模型回傳的角色缺少指令內容", "empty");

  return {
    name: name.slice(0, 24),
    description: pick("description").slice(0, 120),
    globalInstruction,
    styleSample: pick("styleSample"),
  };
}
