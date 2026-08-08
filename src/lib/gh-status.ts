/**
 * GitHub 狀態 —— 只讀，永遠只讀。
 *
 * **範圍邊界（重要）**：這裡解析 `gh` 的 `--json` 輸出並產生顯示字串，
 * **不執行任何 GitHub 寫入**。`gh pr review --approve`、`gh pr merge`、`gh pr comment`
 * 跟 `git push` 是同一類——不可逆的對外動作。`git-doctor.ts` 已經替 git 立過這條界線
 * （「只產生建議指令，不執行任何 git 寫入」），同一套邏輯必須套用，否則專案內兩套標準。
 *
 * 要把簽核結果送上 PR，走 `reviewHandoffMarkdown()`：產生一段 markdown 讓人自己貼。
 * 零風險、九成價值。
 *
 * 純函式、零 I/O。CLI 呼叫在原生橋，這裡只吃字串。
 * 形狀實測自 gh v2.96.0（2026-08-09）。
 */
import { daysSince, sinceLabel } from "./time-format";

/** `gh search prs --author=@me --state=open --json repository,number,title,updatedAt` 的一列 */
export type OpenPr = {
  repo: string;
  number: number;
  title: string;
  updatedAt: string;
};

/** `gh pr list --json …` 的一列（L2 單專案檢視用，欄位較多） */
export type PrDetail = OpenPr & {
  isDraft: boolean;
  /** APPROVED / CHANGES_REQUESTED / REVIEW_REQUIRED；**空字串代表沒人審過** */
  reviewDecision: string;
  /** MERGEABLE / CONFLICTING / UNKNOWN */
  mergeable: string;
  /** CI 燈。空陣列代表這個 repo 沒有 CI，不是「檢查失敗」 */
  checks: { name: string; conclusion: string }[];
};

export type GhUnavailable = { available: false; reason: string };
export type GhReport = {
  available: true;
  prs: OpenPr[];
  /** 這批資料是什麼時候取的。網路呼叫不進 1 秒迴圈，所以畫面上一定要標新鮮度 */
  fetchedAt: string;
};
export type GhResult = GhReport | GhUnavailable;

/** GitHub 狀態的刷新週期。`gh search` 走 Search API（30 req/min），60 秒安全。 */
export const GH_REFRESH_MS = 60_000;
/** 超過這個秒數就標記為「舊資料」，不假裝是即時的。 */
export const GH_STALE_MS = 5 * 60_000;

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 解析 `gh search prs`。認不得就回空陣列，不丟例外。 */
export function parsePrSearch(raw: string): OpenPr[] {
  const d = safeParse(raw);
  if (!Array.isArray(d)) return [];
  return d
    .map((x) => x as Record<string, any>)
    .filter((x) => typeof x?.number === "number")
    .map((x) => ({
      repo: String(x.repository?.nameWithOwner ?? x.repository?.name ?? "?"),
      number: x.number as number,
      title: String(x.title ?? ""),
      updatedAt: String(x.updatedAt ?? ""),
    }));
}

/** 解析 `gh pr list`（L2）。 */
export function parsePrList(raw: string, repo = ""): PrDetail[] {
  const d = safeParse(raw);
  if (!Array.isArray(d)) return [];
  return d
    .map((x) => x as Record<string, any>)
    .filter((x) => typeof x?.number === "number")
    .map((x) => ({
      repo: String(x.repository?.nameWithOwner ?? repo),
      number: x.number as number,
      title: String(x.title ?? ""),
      updatedAt: String(x.updatedAt ?? ""),
      isDraft: x.isDraft === true,
      reviewDecision: String(x.reviewDecision ?? ""),
      mergeable: String(x.mergeable ?? "UNKNOWN"),
      checks: Array.isArray(x.statusCheckRollup)
        ? x.statusCheckRollup.map((c: Record<string, any>) => ({
            name: String(c?.name ?? c?.context ?? ""),
            conclusion: String(c?.conclusion ?? c?.state ?? ""),
          }))
        : [],
    }));
}

/** 依「最久沒動」排序。雷達要指的是欠最久的那一筆，不是最新的。 */
export function byStalest(prs: OpenPr[], nowMs: number): OpenPr[] {
  return [...prs].sort((a, b) => daysSince(b.updatedAt, nowMs) - daysSince(a.updatedAt, nowMs));
}

/**
 * 雷達那一行。
 *
 * 刻意講「最久的 38 天」而不是日期——時間盲對策，見 `focus-mode.ts`。
 * 也刻意不擠進焦點卡：卡片欄位封頂 4 個，這是第 5 個資訊，放卡片下方獨立一行。
 */
export function prRadarLine(result: GhResult, nowMs: number): string {
  if (!result.available) return result.reason;
  if (!result.prs.length) return "沒有開著的 PR";
  const [stalest] = byStalest(result.prs, nowMs);
  return `你有 ${result.prs.length} 個 PR 開著，最久的 ${sinceLabel(stalest!.updatedAt, nowMs)}`;
}

/** 資料新鮮度標示。網路資料一定要標，否則使用者會以為是即時的。 */
export function fetchStaleLabel(result: GhResult, nowMs: number): string {
  if (!result.available) return "";
  const age = nowMs - new Date(result.fetchedAt).getTime();
  if (Number.isNaN(age)) return "";
  return age > GH_STALE_MS
    ? `⚠ PR 狀態於 ${sinceLabel(result.fetchedAt, nowMs)}取得（可能已過時）`
    : `PR 狀態於 ${sinceLabel(result.fetchedAt, nowMs)}取得`;
}

/** L2：把一個 PR 的狀態翻成一句人話。 */
export function prStatusLine(pr: PrDetail): string {
  if (pr.isDraft) return "草稿，還在做";
  const failing = pr.checks.filter((c) => c.conclusion && c.conclusion !== "SUCCESS");
  if (failing.length) return `CI 有 ${failing.length} 項沒過`;
  if (pr.mergeable === "CONFLICTING") return "跟主線衝突，要先解";
  if (pr.reviewDecision === "CHANGES_REQUESTED") return "有人要求修改";
  if (pr.reviewDecision === "APPROVED") return "已核准，可以併了";
  // 空字串是「沒人審過」，不是「審查通過」—— 這個區分是整個雷達存在的理由
  return pr.mergeable === "MERGEABLE" ? "沒人審，但可以併" : "等人審";
}

/**
 * L3 的折衷：不呼叫 `gh pr review`，產生一段給人複製的 markdown。
 *
 * 帶上 agent 族系是刻意的——`authorAgentFamily` 的職務分離規則（同族撰寫者不得核准）
 * 是這個專案獨有的治理，GitHub 原生只認人不認 AI 族系。把它寫進 comment，
 * 那條規則才在 GitHub 上留得下痕跡。
 */
export function reviewHandoffMarkdown(input: {
  prRepo: string;
  prNumber: number;
  decision: "approved" | "changes_requested";
  reviewerName: string;
  reviewerKind: "human" | "agent";
  reviewerFamily?: string | null;
  authorFamily?: string | null;
  note?: string;
}): string {
  const verdict = input.decision === "approved" ? "✅ 核准" : "🔁 要求修改";
  const who =
    input.reviewerKind === "agent"
      ? `${input.reviewerName}（agent · ${input.reviewerFamily ?? "unknown"}）`
      : `${input.reviewerName}（人員）`;
  const sep =
    input.reviewerKind === "agent" && input.authorFamily && input.reviewerFamily === input.authorFamily
      ? "\n> ⚠️ 撰寫者與審查者同族系，依職務分離規則此核准無效。"
      : "";
  return [
    `**SpecForge 簽核結果** — ${verdict}`,
    "",
    `- 審查者：${who}`,
    `- 撰寫者族系：${input.authorFamily ?? "human"}`,
    ...(input.note ? [`- 附註：${input.note}`] : []),
    sep,
    "",
    `<sub>由 SpecForge 產生，貼上者自負責任。本工具不代為執行 \`gh pr review\`。</sub>`,
  ]
    .filter((l) => l !== "")
    .join("\n");
}
