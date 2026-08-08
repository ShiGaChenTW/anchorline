/**
 * 治理鏈 replay —— 一份 PRD 從撰寫到發布的完整可視化。
 *
 * ## 這是作品，不是功能
 *
 * 市場上沒有一家在做「PRD → gate → 簽核 → 實作 → PR → release」的治理鏈：
 * Vibe Kanban 退場、Conductor 只做編排、Nimbalyst 往通用編輯器走，它們全部從
 * 「怎麼讓 agent 跑得更多」出發，沒有一個從「怎麼證明這些 agent 做的事是被
 * 治理過的」出發。這個檔就是把那個論點變成可以看的東西。
 *
 * 而且它輸出 Markdown —— 因為作品要能貼出去，不是只能在 App 裡看。
 *
 * ## agent 族系職務分離
 *
 * `authorAgentFamily`（同族撰寫者不得核准）是這個專案獨有的機制，GitHub 原生
 * 只有 CODEOWNERS 與 branch protection，不認 AI 族系。replay 會把違規標出來 ——
 * 一條沒有標示違規的治理鏈才有說服力。
 *
 * 純函式、零 I/O。
 */
import { byNewest, type LogEvent } from "./event-log";
import { sinceLabel } from "./time-format";

/** 治理鏈的六段。順序固定 —— 這個順序本身就是論點。 */
export const CHAIN_STAGES = [
  { id: "author", label: "撰寫", kinds: ["prd.section.edit"] },
  { id: "gate", label: "結構檢查", kinds: ["gate.pass", "gate.fail"] },
  { id: "review", label: "簽核", kinds: ["review.submit", "review.approve", "review.withdraw"] },
  { id: "implement", label: "實作", kinds: ["task.done", "file.edit", "commit"] },
  { id: "pr", label: "PR 審查", kinds: ["pr.open", "pr.review", "pr.merge", "pr.checks.fail"] },
  { id: "release", label: "發布", kinds: ["release.tag"] },
] as const;

export type ChainStage = {
  id: string;
  label: string;
  count: number;
  firstAt: string | null;
  lastAt: string | null;
  actors: string[];
  /** 這一段完全沒有事件。空段落要顯示，不能跳過 —— 缺口本身是資訊 */
  empty: boolean;
};

export type SeparationViolation = {
  at: string;
  family: string;
  detail: string;
};

export type Replay = {
  subjectPrefix: string;
  stages: ChainStage[];
  total: number;
  spanLabel: string;
  violations: SeparationViolation[];
};

/**
 * 組一條治理鏈。
 *
 * @param events 已經過濾到單一 PRD 的事件（subject 前綴相符或直接相符）
 * @param authorFamily 這份 PRD 的撰寫者族系；null 代表人寫的
 */
export function buildReplay(
  events: LogEvent[],
  subjectPrefix: string,
  authorFamily: string | null,
  nowMs: number
): Replay {
  const sorted = byNewest(events).reverse(); // 舊到新，治理鏈是時間順的

  const stages: ChainStage[] = CHAIN_STAGES.map((def) => {
    const hits = sorted.filter((e) => (def.kinds as readonly string[]).includes(e.kind));
    return {
      id: def.id,
      label: def.label,
      count: hits.length,
      firstAt: hits[0]?.ts ?? null,
      lastAt: hits[hits.length - 1]?.ts ?? null,
      actors: [...new Set(hits.map((e) => e.actor?.name).filter(Boolean) as string[])],
      empty: hits.length === 0,
    };
  });

  return {
    subjectPrefix,
    stages,
    total: sorted.length,
    spanLabel: spanOf(sorted, nowMs),
    violations: findViolations(sorted, authorFamily),
  };
}

function spanOf(sorted: LogEvent[], nowMs: number): string {
  if (!sorted.length) return "還沒有事件";
  const first = sorted[0]!.ts;
  const last = sorted[sorted.length - 1]!.ts;
  return `從 ${sinceLabel(first, nowMs)}到 ${sinceLabel(last, nowMs)}`;
}

/**
 * 職務分離違規：**核准者與撰寫者同族系**。
 *
 * 只看 `review.approve`——其他動作同族沒關係，同族「核准自己寫的東西」才是問題。
 * 人類核准永遠合法（`family` 為 null），因為人不是被治理的對象，是治理者。
 */
export function findViolations(events: LogEvent[], authorFamily: string | null): SeparationViolation[] {
  if (!authorFamily) return [];
  return events
    .filter(
      (e) =>
        e.kind === "review.approve" &&
        e.actor?.kind === "agent" &&
        e.actor.family === authorFamily
    )
    .map((e) => ({
      at: e.ts,
      family: authorFamily,
      detail: `${e.actor.name} 與撰寫者同為 ${authorFamily} 族系`,
    }));
}

/** 治理鏈是否完整走完（每一段都有事件）。空段落不算失敗，只是還沒走到。 */
export function chainComplete(r: Replay): boolean {
  return r.stages.every((s) => !s.empty);
}

/**
 * 輸出成 Markdown —— **作品要能貼出去，不是只能在 App 裡看。**
 */
export function replayMarkdown(r: Replay, title: string): string {
  const rows = r.stages.map((s) =>
    s.empty
      ? `| ${s.label} | — | — | 尚未發生 |`
      : `| ${s.label} | ${s.count} | ${s.actors.join("、") || "—"} | ${s.firstAt?.slice(0, 10)} → ${s.lastAt?.slice(0, 10)} |`
  );

  const violationBlock = r.violations.length
    ? [
        "",
        "## ⚠️ 職務分離違規",
        "",
        "同族系的 agent 核准了自己族系撰寫的文件。GitHub 原生的 CODEOWNERS 與",
        "branch protection 只認人、不認 AI 族系，抓不到這一類。",
        "",
        ...r.violations.map((v) => `- ${v.at} — ${v.detail}`),
      ]
    : ["", "職務分離檢查：通過（沒有同族系自我核准）。"];

  return [
    `# ${title}`,
    "",
    `${r.total} 個事件，${r.spanLabel}。治理鏈${chainComplete(r) ? "完整走完" : "尚未走完"}。`,
    "",
    "| 階段 | 事件數 | 參與者 | 期間 |",
    "|---|---|---|---|",
    ...rows,
    ...violationBlock,
    "",
    `<sub>由 Anchorline 從 .anchorline/log 產生。subject 前綴：${r.subjectPrefix}</sub>`,
  ].join("\n");
}
