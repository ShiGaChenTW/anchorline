/**
 * AI 提問引導撰寫：一次問一題，答完再產出全文。
 *
 * 為什麼要有這條路：`writeFullPrd` 直接對著空章節寫，模型只能靠章節標題猜，
 * 產出是「一份看起來像 PRD 的東西」而不是「這個專案的 PRD」。先問幾題把
 * 事實拿到手，再讓同一支 writeFullPrd 帶著這些事實寫，差別在這裡。
 *
 * **一次一題**，不是一張表單：表單會讓人先掃過十格再決定從哪格開始填
 * （C3 的分心點），而且後面的問題本來就該看得到前面的答案。
 */
import type { Section } from "../data/types";
import { promptSystem, promptTemperature } from "./prompt-registry";
import { AiError, chatCompletion, extractJsonObject, getAiReadiness } from "./ai-client";
import { store } from "../data/store";

export type InterviewTurn = { question: string; answer: string };

export type NextQuestion =
  /** 還要再問 */
  | { done: false; question: string; why: string }
  /** 夠了，可以開始寫 */
  | { done: true; question: null; why: string };

/** 問到這個數字就停 —— 再問下去的邊際資訊量低於使用者的耐性 */
export const MAX_INTERVIEW_TURNS = 8;

function transcriptText(turns: InterviewTurn[]): string {
  if (!turns.length) return "（尚未問答）";
  return turns.map((t, i) => `Q${i + 1}: ${t.question}\nA${i + 1}: ${t.answer}`).join("\n\n");
}

/**
 * 下一題。模型看得到章節清單與已問過的內容，自己決定還缺什麼。
 *
 * 失敗不丟給呼叫端自己猜：問不出來就當作「問夠了」，讓流程往產出走，
 * 而不是卡在一個沒有下一步的畫面。
 */
export async function nextInterviewQuestion(
  sections: Section[],
  turns: InterviewTurn[],
): Promise<NextQuestion> {
  const ready = getAiReadiness();
  if (!ready.ok) throw new AiError(ready.reason, "not_configured");

  if (turns.length >= MAX_INTERVIEW_TURNS) {
    return { done: true, question: null, why: `已問滿 ${MAX_INTERVIEW_TURNS} 題` };
  }

  const settings = store.get().settings;
  const outline = sections.map((s) => `${s.n} ${s.title} — ${s.desc || s.guide}`).join("\n");

  const system = promptSystem("interview", {
    lang: settings.language === "en-US" ? "English" : "Traditional Chinese (zh-TW)",
    maxTurns: String(MAX_INTERVIEW_TURNS),
  });

  const user = `PRD sections to be filled:
${outline}

Interview so far:
${transcriptText(turns)}

Asked ${turns.length} of at most ${MAX_INTERVIEW_TURNS} questions.`;

  let obj: Record<string, unknown> | null = null;
  try {
    obj = extractJsonObject(await chatCompletion(system, user, { temperature: promptTemperature("interview") }));
  } catch (e) {
    if (e instanceof AiError && e.code === "not_configured") throw e;
    return { done: true, question: null, why: e instanceof Error ? e.message : "提問失敗" };
  }
  if (!obj) return { done: true, question: null, why: "模型未回傳可用的 JSON" };

  const question = String(obj.question ?? "").trim();
  const why = String(obj.why ?? "").trim();
  if (obj.done === true || !question) return { done: true, question: null, why: why || "資訊已足夠" };
  return { done: false, question, why };
}

/**
 * 問答稿 → 給 writeFullPrd 的指令。
 *
 * 標成「事實」而不是「參考」：模型看到 reference 會覺得可以改寫，
 * 但這些是使用者親口說的東西，改寫等於捏造。
 */
export function interviewInstruction(turns: InterviewTurn[]): string {
  const answered = turns.filter((t) => t.answer.trim());
  if (!answered.length) return "";
  return `以下是使用者親口回答的事實，撰寫時必須採用，不得改寫或替換成通用範例：

${transcriptText(answered)}`;
}
