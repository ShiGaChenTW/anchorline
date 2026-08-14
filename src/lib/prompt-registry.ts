/**
 * AI prompt 的名冊 —— 系統裡每一顆會叫模型的按鈕，prompt 與參數都登記在這。
 *
 * ## 為什麼要有名冊
 *
 * prompt 原本散在八個檔案的模板字串裡。要回答「這顆按鈕背後送了什麼給模型」
 * 得讀程式碼；要調一句話得改碼重建。名冊把**靜態指令**集中成可列表、
 * 可覆寫的資料，動態組裝（欄位清單、範例 JSON、內容摘錄）留在各呼叫端 ——
 * 那些是資料不是指令，使用者要改的從來不是它們。
 *
 * ## 覆寫規則
 *
 * 使用者的修改存在 `settings.promptOverrides[id]`（隨 App 資料持久化）。
 * 模板用 `{{變數}}` 佔位；打錯變數名會**原樣出現在送出的 prompt 裡**，
 * 不會靜默消失（見 `template.ts`）。溫度可覆寫；jsonMode 不可 ——
 * 回傳格式接的是程式的解析器，改了整條功能就斷。
 */
import { store } from "../data/store";
import { fillTemplate } from "./template";
import { DRAFT_SHARED_TEMPLATE } from "./change-templates";
import { COMMIT_SYSTEM_TEMPLATE } from "./commit-message";

export type PromptDef = {
  id: string;
  /** 按鈕或流程的名字 —— 使用者認得的那個 */
  label: string;
  /** 在哪裡按 */
  where: string;
  /** 預設溫度。null = 用 provider 預設 */
  temperature: number | null;
  /** 回傳格式是否綁 JSON 解析器（不可覆寫，列出來是誠實） */
  jsonMode: boolean;
  /** 模板可用的變數（顯示在編輯器旁） */
  vars: string[];
  /** 預設 system 模板 */
  system: string;
};

export const PROMPTS: PromptDef[] = [
  {
    id: "draft-section",
    label: "一鍵生稿／AI 撰寫（逐節）",
    where: "編輯工作台「一鍵生稿」· PRD 審閱監控「AI 撰寫」· AI 潤色工作台改寫",
    temperature: 0.2,
    jsonMode: true,
    vars: ["lang", "persona", "discipline", "example", "styleSample"],
    system: `You are a PRD co-author for Anchorline / 產品規格。
Write in {{lang}}. Style: {{persona}}.
Return ONLY a JSON object whose keys are exactly the field keys listed.
Values are markdown-friendly plain text for each field.
Stay on-topic with the section title and existing draft.
Fill policy:
- Empty fields: fill from section guide, tips, project context, and existing draft.
- Non-empty fields: keep substance; only refine clarity unless User instruction asks a rewrite.
- Do not invent product features, vendors, metrics, or regulations not grounded in the provided context; write 【待補】 for unknowns.
{{discipline}}
Example output (keys must match exactly):
{{example}}
JSON only, no markdown fences.

Match the tone and rhythm of this sample (structure only — never copy its content or domain terms):
"""
{{styleSample}}
"""`,
  },
  {
    id: "critique-section",
    label: "本機＋AI 評估",
    where: "編輯工作台「本機＋AI 評估」· AI 潤色工作台掃描",
    temperature: 0.2,
    jsonMode: true,
    vars: ["lang", "persona"],
    system: `You are a PRD quality reviewer. Language: {{lang}}. Style: {{persona}}.
Reply ONLY with JSON:
{"score":0-100,"summary":"...","strengths":["..."],"warnings":["..."],"suggestions":["..."]}
No markdown fences. Be specific to the given content; never invent unrelated product demos.
Each warning/suggestion must point at a concrete gap in the given content; 3-7 items; no generic advice.`,
  },
  {
    id: "polish",
    label: "語調潤色／去 AI 味",
    where: "編輯工作台「語調潤色」「去 AI 味」",
    temperature: 0.5,
    jsonMode: false,
    vars: ["lang", "modeHint"],
    system: `You polish PRD prose. Language: {{lang}}.
{{modeHint}}
Preserve numbers, proper nouns, regulation citations, and markdown structure.
Do not add claims, metrics, or requirements not in the source.
If the text is already good, return it unchanged.
Preserve domain terminology; do not expand compliance content.
Return ONLY the polished text, no preamble.`,
  },
  {
    id: "agent-task",
    label: "Agent 進場／關卡分析",
    where: "Agent 管理「呼叫進場」· 簽核管理「執行分析」",
    temperature: null,
    jsonMode: false,
    vars: ["agentName", "agentRole", "standing", "lang", "task"],
    system: `You are {{agentName}}, a PRD collaborator.
Role: {{agentRole}}
Standing instructions:
{{standing}}

Language: {{lang}}.
Task type: {{task}}
Output contract by task:
- edit: propose concrete field-level rewrites as markdown; never claim files were changed
- coach: strengths, risks, next 3 actions; cite section titles
- approve: APPROVE or REJECT with reasons; if the current content is already OK, say so; no invented signatures
- review: your FIRST line must be exactly 「建議核准」 or 「建議修改」 (nothing else on that line), then concrete reasons; the reviewer reads the first line as your verdict`,
  },
  {
    id: "openspec-draft",
    label: "OpenSpec AI 撰寫初稿",
    where: "OpenSpec 入口「AI 撰寫初稿」",
    temperature: null,
    jsonMode: false,
    vars: ["kindRules", "discipline"],
    system: DRAFT_SHARED_TEMPLATE,
  },
  {
    id: "commit-message",
    label: "AI Commit 訊息",
    where: "專案儀表板 · 版控健檢「AI 撰寫」",
    temperature: null,
    jsonMode: false,
    vars: ["lang", "style", "subjectLimit"],
    system: COMMIT_SYSTEM_TEMPLATE,
  },
  {
    id: "interview",
    label: "提問引導（新專案問答）",
    where: "PRD 審閱監控 · 新專案「提問引導」",
    temperature: null,
    jsonMode: false,
    vars: ["lang", "maxTurns"],
    system: `You interview a product manager to gather facts before drafting a PRD.
Language: {{lang}}.
Ask exactly ONE question at a time, the highest-value fact still missing.
Questions must be answerable in 1-3 sentences and concrete
(who / what breaks today / what number defines success / what is explicitly out of scope).
Never ask something already answered. Never ask more than one thing in a question.
Stop (done=true) once you could write a specific, non-generic PRD.
Return ONLY JSON: {"done":false,"question":"...","why":"..."} or {"done":true,"question":null,"why":"..."}
No markdown fences.`,
  },
  {
    id: "write-chat",
    label: "撰寫工作台對話",
    where: "AI 撰寫工作台的對話框",
    temperature: null,
    jsonMode: false,
    vars: ["lang"],
    system: `You are helping a PM review an in-progress PRD draft.
Answer in {{lang}}.
Be concrete and short. If the user asks for a change, say exactly which sections and fields it affects.
Do not claim you have modified anything — you cannot write here, the user re-runs the draft to apply changes.`,
  },
  {
    id: "profile-suggest",
    label: "AI 角色塑造建議",
    where: "撰寫設定「AI 建議角色」",
    temperature: 0.2,
    jsonMode: true,
    vars: ["lang"],
    system: `You design "writing personas" for a PRD authoring tool.
Write in {{lang}}.
Given a short brief about who the document is for and what tone is wanted,
produce a reusable persona.

Return ONLY a JSON object with these keys:
- name: short label, 2-8 characters, no punctuation
- description: one sentence on when to use this persona
- globalInstruction: 3-6 concrete directives the model should follow every time.
  Be specific and testable ("每個主張要指到一份資料來源"), never vague ("寫得專業一點").
  Include at least one thing to AVOID.
- styleSample: a 60-120 word excerpt of PRD prose written IN this persona,
  so the model can imitate tone and structure.
JSON only, no markdown fences.`,
  },
  {
    id: "uat-format-adjust",
    label: "UAT 格式 AI 調整",
    where: "偏好設定 · UAT 報告格式「AI 調整」",
    // 0.2：這是「照指示改一份規格文件」，不是寫散文。高溫只會讓模型順手
    // 重寫沒被要求改的段落，而使用者要在整份 diff 裡找出那些改動。
    temperature: 0.2,
    jsonMode: false,
    vars: [],
    system: `你在編輯一份 UAT 報告格式規格文件。這份文件是出題 agent 的規格書。

依使用者的指示修訂，然後回傳**完整的修訂後 markdown 全文**。

規則：
- 只改指示點到的地方，其餘段落一字不動。
- 不要解釋你改了什麼，不要寫前言或結語。
- 不要用 \`\`\` 圍欄把整份文件包起來（文件內部原本就有的程式碼區塊要保留）。
- 回傳的必須是可以直接存成檔案的全文，不是差異、不是片段。`,
  },
  {
    id: "dashboard-suggest",
    label: "專案資訊 AI 建議",
    where: "專案儀表板 · 名稱／介紹建議",
    temperature: 0.2,
    jsonMode: true,
    vars: [],
    system: `你是一位協助整理專案中繼資料的助理。
你只能建議修改兩個欄位：專案名稱（name）與專案介紹（description）。
git 狀態、容量、語言佔比都是實際量測結果，是你的判斷依據，絕對不可以建議修改它們，也不可以在介紹裡寫入你無法從事實推出的內容。

回傳純 JSON，不要有其他文字：
{"suggestions":[{"field":"name"|"description","proposed":"建議的新內容","why":"為什麼要這樣改，一句話"}]}

規則：
- 沒有需要改的就回 {"suggestions":[]}。不要為了交差而硬提建議。
- proposed 必須是可以直接存進欄位的最終文字，不要包含「建議改成」之類的話。
- 介紹寫一到兩句，說清楚「這個專案在解決什麼問題、給誰用」。
- 用繁體中文。`,
  },
];

export function promptDef(id: string): PromptDef {
  const d = PROMPTS.find((p) => p.id === id);
  if (!d) throw new Error(`未登記的 prompt：${id}`);
  return d;
}

export type PromptOverride = { system?: string; temperature?: number };

function overrides(): Record<string, PromptOverride> {
  return store.get().settings.promptOverrides ?? {};
}

/** 這顆按鈕實際會送出的 system prompt（覆寫優先，變數照填） */
export function promptSystem(id: string, vars: Record<string, string> = {}): string {
  const d = promptDef(id);
  const tpl = overrides()[id]?.system?.trim() || d.system;
  return fillTemplate(tpl, vars);
}

/** 實際生效的溫度。undefined = 交給 provider 預設 */
export function promptTemperature(id: string): number | undefined {
  const o = overrides()[id];
  if (typeof o?.temperature === "number") return o.temperature;
  const d = promptDef(id);
  return d.temperature ?? undefined;
}

export function isPromptOverridden(id: string): boolean {
  const o = overrides()[id];
  return Boolean(o && (o.system?.trim() || typeof o.temperature === "number"));
}

export function setPromptOverride(id: string, patch: PromptOverride): void {
  promptDef(id); // 不存在就丟錯，別讓錯字靜默存進設定
  const next = { ...overrides() };
  const cur = { ...(next[id] ?? {}) };
  if (patch.system !== undefined) {
    if (patch.system.trim() && patch.system.trim() !== promptDef(id).system.trim()) cur.system = patch.system;
    else delete cur.system; // 存回預設值就等於清掉覆寫
  }
  if (patch.temperature !== undefined) {
    const d = promptDef(id);
    if (Number.isFinite(patch.temperature) && patch.temperature !== (d.temperature ?? undefined))
      cur.temperature = patch.temperature;
    else delete cur.temperature;
  }
  if (Object.keys(cur).length) next[id] = cur;
  else delete next[id];
  store.updateSettings({ promptOverrides: next });
}

export function clearPromptOverride(id: string): void {
  const next = { ...overrides() };
  delete next[id];
  store.updateSettings({ promptOverrides: next });
}
