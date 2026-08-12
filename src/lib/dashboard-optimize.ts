/**
 * 儀表板優化 —— 找 agent 幫忙檢查、調整、更新欄位內容。
 *
 * **範圍邊界（重要）**：只動「專案名稱」與「專案介紹」這兩個人寫的欄位。
 *
 * git 狀態、資料夾容量、技術線、worktree 全都是從磁碟量出來的事實，
 * 讓 agent「調整」那些等於捏造資料。所以它們只作為**判斷依據**進 prompt，
 * 不作為可修改的目標。
 *
 * 沒設 API Key 也要能用：先跑本機規則檢查，AI 就緒時再疊上去。
 * 一個要靠設定金鑰才會動的按鈕，對 ADHD 使用者等於不存在。
 */
import type { Project } from "../data/types";
import { projectDisplayName } from "../data/types";
import { chatCompletion, extractJsonObject, getAiReadiness } from "./ai-client";
import { promptSystem, promptTemperature } from "./prompt-registry";
import { formatBytes, frameworks, languageBreakdown, type ProjectStats } from "./project-stats";

export type SuggestField = "name" | "description";

export type Suggestion = {
  field: SuggestField;
  label: string;
  current: string;
  proposed: string;
  /** 為什麼建議這樣改 —— 沒有理由的建議不該被接受 */
  why: string;
  source: "本機規則" | "AI";
};

/** 看起來像資料夾名而不是專案名：底線、連字號堆疊、Project_ 前綴 */
function looksLikeFolderName(s: string): boolean {
  return /^project[_-]/i.test(s) || (/[_-]/.test(s) && !/\s/.test(s) && s.length > 8);
}

/**
 * 本機規則檢查。不呼叫任何 API，永遠可用。
 * 只挑「拿量到的事實就能判斷」的問題 —— 不做語意評價，那是 AI 的事。
 */
export function localSuggestions(p: Project, s: ProjectStats | null): Suggestion[] {
  const out: Suggestion[] = [];
  const name = projectDisplayName(p);
  const desc = (p.description ?? "").trim();

  if (looksLikeFolderName(name)) {
    out.push({
      field: "name",
      label: "專案名稱",
      current: name,
      proposed: name
        .replace(/^project[_-]/i, "")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase()),
      why: "目前用的是資料夾名稱。人在總覽掃視時讀的是這一行，可讀性優先於路徑一致性。",
      source: "本機規則",
    });
  }

  if (!desc) {
    const langs = s ? languageBreakdown(s) : [];
    const fws = s ? frameworks(s) : [];
    const bits: string[] = [];
    if (langs[0]) bits.push(`以 ${langs[0].lang} 為主`);
    if (fws.length) bits.push(fws.slice(0, 2).map((f) => f.label).join(" + "));
    out.push({
      field: "description",
      label: "專案介紹",
      current: "（空白）",
      proposed: bits.length
        ? `${bits.join("、")}的專案。（這句是從技術線推出來的骨架，請改成它實際在解決什麼問題）`
        : "（請寫一句話說明這個專案在解決什麼問題）",
      why: "介紹空白時，總覽與儀表板都只剩名稱可辨識。先放一句能改的骨架比留白容易起步。",
      source: "本機規則",
    });
  } else if (desc.length < 12) {
    out.push({
      field: "description",
      label: "專案介紹",
      current: desc,
      proposed: desc,
      why: "介紹只有幾個字，看不出這個專案在解決什麼問題。建議補上「給誰」與「為什麼做」。",
      source: "本機規則",
    });
  }

  // 介紹提到的技術與實際量到的對不上 —— 這是最容易過期的一種錯
  if (desc && s) {
    const langs = languageBreakdown(s).map((l) => l.lang.toLowerCase());
    const fws = frameworks(s).map((f) => f.label.toLowerCase());
    const known = ["react", "vue", "svelte", "next.js", "rust", "go", "python", "typescript"];
    const claimed = known.filter((k) => desc.toLowerCase().includes(k));
    const missing = claimed.filter(
      (k) => !langs.some((l) => l.includes(k)) && !fws.some((f) => f.includes(k)),
    );
    if (missing.length) {
      out.push({
        field: "description",
        label: "專案介紹",
        current: desc,
        proposed: desc,
        why: `介紹提到 ${missing.join("、")}，但技術線與 manifest 裡都沒偵測到。可能是資訊過期了。`,
        source: "本機規則",
      });
    }
  }

  return out;
}

/** 把量到的事實壓成一段給模型讀的摘要 */
function factsBlock(p: Project, s: ProjectStats | null): string {
  if (!s) return "（沒有磁碟量測資料）";
  const langs = languageBreakdown(s)
    .map((l) => `${l.lang} ${l.pct}%`)
    .join("、");
  const fws = frameworks(s).map((f) => f.label).join("、") || "無";
  const g = s.git;
  return [
    `資料夾：${s.folderPath}`,
    `容量：${formatBytes(s.totalBytes)}，${s.fileCount} 個檔案`,
    `語言佔比：${langs || "無"}`,
    `框架：${fws}`,
    `manifest：${s.manifests.join("、") || "無"}`,
    g ? `git：分支 ${g.branch}、${g.commitCount} 個 commit、最新訊息「${g.lastMessage}」` : "非 git 專案",
    `目前名稱：${projectDisplayName(p)}`,
    `目前介紹：${p.description || "（空白）"}`,
  ].join("\n");
}

// SYSTEM prompt 已搬進 prompt-registry（id: dashboard-suggest），使用者可覆寫

/** AI 建議。沒設定金鑰就丟錯，由呼叫端決定要不要只用本機規則。 */
export async function aiSuggestions(
  p: Project,
  s: ProjectStats | null,
  agentBrief: string,
): Promise<Suggestion[]> {
  const ready = getAiReadiness();
  if (!ready.ok) throw new Error(ready.reason);

  const raw = await chatCompletion(
    promptSystem("dashboard-suggest") +
      (agentBrief ? `\n\n這次由這位 agent 執行，請採用它的視角：${agentBrief}` : ""),
    factsBlock(p, s),
    { temperature: promptTemperature("dashboard-suggest"), jsonMode: true },
  );
  const obj = extractJsonObject(raw);
  const list = (obj?.suggestions ?? []) as { field?: string; proposed?: string; why?: string }[];

  const name = projectDisplayName(p);
  const desc = p.description ?? "";
  return list
    .filter((x) => x?.proposed && (x.field === "name" || x.field === "description"))
    .map((x) => ({
      field: x.field as SuggestField,
      label: x.field === "name" ? "專案名稱" : "專案介紹",
      current: x.field === "name" ? name : desc || "（空白）",
      proposed: String(x.proposed).trim(),
      why: String(x.why ?? "").trim() || "（模型未給理由）",
      source: "AI" as const,
    }))
    // 建議和現況一樣就不是建議
    .filter((x) => x.proposed !== (x.field === "name" ? name : desc));
}

// ponytail: 本機規則只做「拿事實就能判斷」的檢查（空白、像資料夾名、技術對不上）。
// 語意好壞交給 AI —— 用規則去評價文案寫得好不好只會產生一堆假陽性。
