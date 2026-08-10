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
  const grade = score >= 90 ? "S" : score >= 80 ? "A" : score >= 65 ? "B" : "C";

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
    const system = `You are a PRD quality reviewer. Language: ${langHint(settings)}. Style: ${personaHint(settings)}.
Reply ONLY with JSON:
{"score":0-100,"grade":"S|A|B|C","summary":"...","strengths":["..."],"warnings":["..."],"suggestions":["..."]}
No markdown fences. Be specific to the given content; never invent unrelated product demos.`;
    const user = `Section: ${section.n} ${section.title}\nGuide: ${section.guide}\n\nContent:\n${fields}`;
    const raw = await chatCompletion(withDomain(system), user);
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
    const gradeRaw = String(obj.grade || local.grade).toUpperCase();
    const grade = (["S", "A", "B", "C"].includes(gradeRaw) ? gradeRaw : local.grade) as AICritique["grade"];
    const asList = (v: unknown) =>
      Array.isArray(v) ? v.map(String).filter(Boolean) : [];
    return {
      score,
      grade,
      summary: `【AI · ${settings.model}】${String(obj.summary || "").trim() || local.summary}`,
      strengths: asList(obj.strengths).length ? asList(obj.strengths) : local.strengths,
      warnings: asList(obj.warnings).length ? asList(obj.warnings) : local.warnings,
      suggestions: asList(obj.suggestions).length ? asList(obj.suggestions) : local.suggestions,
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
export async function generateAIDraft(
  section: Section,
  currentValues: Record<string, string>,
  prompt?: string,
): Promise<Record<string, string>> {
  const ready = getAiReadiness();
  if (!ready.ok) throw new AiError(ready.reason, "not_configured");

  const settings = store.get().settings;
  const fieldSpec = section.fields
    .map((f) => `- ${f.key}（${f.label}）：${f.hint || f.type}`)
    .join("\n");
  const current = section.fields
    .map((f) => `### ${f.key}\n${(currentValues[f.key] || "").trim() || "（空）"}`)
    .join("\n\n");

  const system = `You are a PRD co-author for Anchorline / 產品規格。
Write in ${langHint(settings)}. Style: ${personaHint(settings)}.
Return ONLY a JSON object whose keys are exactly the field keys listed.
Values are markdown-friendly plain text for each field.
Do NOT invent unrelated SaaS/2FA demos unless the current content is about that.
Stay on-topic with the section title and existing draft.
JSON only, no markdown fences.${
    settings.aiWriting?.styleSample?.trim()
      ? `\n\nMatch the tone and structure of this sample the user provided:\n"""\n${settings.aiWriting.styleSample.trim().slice(0, 4000)}\n"""`
      : ""
  }`;

  const user = `Section ${section.n} ${section.title}
Guide: ${section.guide}
Tips: ${section.tips.join("；")}

Fields:
${fieldSpec}

Current draft:
${current}

${settings.aiWriting?.globalInstruction?.trim() ? `Workspace guidance (applies to every section):\n${settings.aiWriting.globalInstruction.trim()}\n\n` : ""}${prompt ? `User instruction:\n${prompt}\n` : "User instruction: improve and fill empty fields based on existing context.\n"}
Return JSON with keys: ${section.fields.map((f) => f.key).join(", ")}`;

  const raw = await chatCompletion(withDomain(system), user);
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
  mode: "concise" | "executive" | "technical" | "add_metrics",
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
        : mode === "technical"
          ? "Rewrite for engineers: interfaces, constraints, edge cases."
          : "Add measurable metrics where missing; keep original intent.";

  const system = `You polish PRD prose. Language: ${langHint(settings)}.
${modeHint}
Return ONLY the polished text, no preamble.`;
  return await chatCompletion(withDomain(system), text);
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
  const system = `You are agent 「${opts.agentName}」.
Role: ${opts.agentRole || "PRD collaborator"}
System prompt:
${opts.agentPrompt || "（未設定 prompt，請以專業 PM/工程審閱者身份回覆）"}

Language: ${langHint(settings)}.
Task type: ${opts.task}
Be concrete. Do not claim you modified files unless the user content shows changes.
If task is approve: give approve/reject recommendation with reasons; do not invent signatures.`;

  const user = `Project: ${opts.projectTitle}
Note: ${opts.note || "（無）"}

Context (excerpt):
${opts.contextSnippet.slice(0, 6000) || "（無內文）"}

Deliver a concise operational result for this agent job.`;

  return await chatCompletion(withDomain(system), user);
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

  for (let i = 0; i < targets.length; i++) {
    if (opts.signal?.aborted) break;
    const section = targets[i]!;
    const base = { index: i + 1, total: targets.length, section };

    const current = valuesOf(section);
    const overwrite = opts.overwriteFilled ?? store.get().settings.aiWriting?.overwriteFilled ?? false;
    if (!overwrite && sectionHasContent(current)) {
      skipped++;
      opts.onProgress?.({ ...base, phase: "skipped" });
      continue;
    }

    opts.onProgress?.({ ...base, phase: "start" });
    try {
      // 每節覆寫優先於本次的一次性指令；兩者都沒有就用內建 prompt
      const perSection = store.get().settings.aiWriting?.sectionPrompts?.[section.id]?.trim();
      const patch = await generateAIDraft(section, current, perSection || opts.instruction);
      if (opts.signal?.aborted) break;
      written++;
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
