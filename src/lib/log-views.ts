/**
 * 稽核軌跡的三層呈現。**預設停在第一層。**
 *
 * 一條無限捲動的事件流對 ADHD 使用者是注意力黑洞：進得去出不來，而且看完
 * 沒有產出。整理資料很爽，但那不是做事。所以：
 *
 *   ① 回到工作 —— 三行，打開就是這個
 *   ② 今天做了什麼 —— 點一下，依 kind 折疊成 ≤4 組
 *   ③ 完整時間軸 —— 再點一下，或匯出稽核報告時
 *
 * 順帶把兩個價值主張分開：對外是**稽核**（作品價值），對內是
 * **context recovery**（「我上次做到哪、為什麼停下來」）。第 ① 層服務後者，
 * 那才是每天會用到的那個。
 *
 * 純函式、零 I/O。`nowMs` 一律注入。
 */
import { byNewest, type LogEvent } from "./event-log";
import { sinceLabel } from "./time-format";

/** kind → 給人看的動詞。認不得的 kind 直接顯示原字串，不要吞掉。 */
const KIND_LABEL: Record<string, string> = {
  "prd.section.edit": "編輯章節",
  "gate.pass": "結構檢查通過",
  "gate.fail": "結構檢查未過",
  "review.submit": "送出審閱",
  "review.approve": "核准",
  "review.withdraw": "抽單",
  "task.done": "完成步驟",
  commit: "提交",
  "release.tag": "版本取號",
  "agent.job.start": "Agent 進場",
  "agent.job.done": "Agent 完成",
  "pr.open": "開 PR",
  "pr.review": "PR 審查",
  "pr.merge": "PR 合併",
  "pr.checks.fail": "CI 失敗",
  "decision.record": "記錄決策",
  "file.edit": "改檔案",
  "uat.verdict": "實測判定",
  "uat.report.done": "實測完成",
  "uat.report.submitted": "實測送出",
  "uat.round.closeout": "實測收工",
  "uat.report.closed": "標記完成",
  "uat.report.reopen": "撤回完成",
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

/** 折疊成幾組。4 是工作記憶上限，不是美觀選擇。 */
export const KIND_GROUP_CAP = 4;

export type ResumeCard = {
  /** 「上次動 2 小時前」 */
  lastActive: string;
  /** 「最後做完 P1-3 單專案焦點卡」 */
  lastDone: string;
  /** 「下一個未完成是 P1-7 PR 雷達」 */
  nextOpen: string;
  /** 「繼續」按鈕要跳去哪 —— 最後一筆事件的 subject */
  resumeSubject: string | null;
};

/**
 * 第 ① 層 —— 回到工作。
 *
 * 三行，不多不少。ADHD 最痛的是回到被中斷的工作，而回來時要的不是
 * 「這個月做了 312 件事」，是「我上次停在哪、下一步是什麼」。
 *
 * @param openTasks 還沒完成的步驟（id + 文字），由 plan-parser 提供
 */
export function buildResumeCard(
  events: LogEvent[],
  openTasks: { id?: string; text: string }[],
  nowMs: number
): ResumeCard {
  const sorted = byNewest(events);
  const latest = sorted[0] ?? null;
  const lastDone = sorted.find((e) => e.kind === "task.done") ?? null;
  const next = openTasks[0] ?? null;

  return {
    lastActive: latest ? sinceLabel(latest.ts, nowMs) : "從未",
    lastDone: lastDone
      ? `最後做完 ${String(lastDone.payload?.title ?? lastDone.subject)}`
      : "還沒有完成任何步驟",
    nextOpen: next ? `下一個未完成是 ${next.text}` : "沒有未完成的步驟",
    resumeSubject: next?.id ?? latest?.subject ?? null,
  };
}

export type KindGroup = { kind: string; label: string; count: number };

/**
 * 第 ② 層 —— 今天做了什麼。
 *
 * 依 kind 折疊，**最多 4 組**，其餘併成「其他」。不是為了好看：
 * 17 種 kind 各列一行，就跟直接看原始事件流沒有差別。
 */
export function todaySummary(events: LogEvent[], nowMs: number): KindGroup[] {
  const dayStart = startOfLocalDay(nowMs);
  const today = events.filter((e) => {
    const t = new Date(e.ts).getTime();
    return !Number.isNaN(t) && t >= dayStart;
  });

  const counts = new Map<string, number>();
  for (const e of today) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const head = ranked.slice(0, KIND_GROUP_CAP).map(([kind, count]) => ({
    kind,
    label: kindLabel(kind),
    count,
  }));
  const restCount = ranked.slice(KIND_GROUP_CAP).reduce((a, [, n]) => a + n, 0);
  if (restCount) head.push({ kind: "_other", label: "其他", count: restCount });
  return head;
}

function startOfLocalDay(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 第 ② 層那一句話。沒有事件時明講，不要顯示「0 件」。 */
export function todayLine(groups: KindGroup[]): string {
  if (!groups.length) return "今天還沒有動作";
  const total = groups.reduce((a, g) => a + g.count, 0);
  return `今天 ${total} 個動作 · ${groups.map((g) => `${g.label} ${g.count}`).join(" · ")}`;
}

// ── 稽核報告匯出（P2-14）────────────────────────────────────────

export type ExportRange = { fromIso?: string; toIso?: string; subject?: string };

export function filterForExport(events: LogEvent[], range: ExportRange): LogEvent[] {
  const from = range.fromIso ? new Date(range.fromIso).getTime() : -Infinity;
  const to = range.toIso ? new Date(range.toIso).getTime() : Infinity;
  return byNewest(
    events.filter((e) => {
      const t = new Date(e.ts).getTime();
      if (Number.isNaN(t) || t < from || t > to) return false;
      return range.subject ? e.subject === range.subject : true;
    })
  );
}

function actorLabel(e: LogEvent): string {
  const a = e.actor;
  if (!a) return "?";
  return a.kind === "human" ? `${a.name}（人員）` : `${a.name}（${a.kind} · ${a.family ?? "?"}）`;
}

/** 稽核報告 Markdown。給人讀、也能直接貼進 PR 或簽核附件。 */
export function exportMarkdown(events: LogEvent[], title = "稽核軌跡"): string {
  const rows = events.map(
    (e) =>
      `| ${e.ts} | ${actorLabel(e)} | ${kindLabel(e.kind)} | ${e.subject} | ${e.ref ?? ""} |`
  );
  return [
    `# ${title}`,
    "",
    `共 ${events.length} 筆事件。`,
    "",
    "| 時間 (UTC) | 執行者 | 動作 | 對象 | 連結 |",
    "|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

/** CSV。欄位順序固定，給試算表與稽核系統吃。 */
export function exportCsv(events: LogEvent[]): string {
  const head = ["ts", "actor_kind", "actor_family", "actor_name", "kind", "subject", "ref"];
  const rows = events.map((e) =>
    [
      e.ts,
      e.actor?.kind ?? "",
      e.actor?.family ?? "",
      e.actor?.name ?? "",
      e.kind,
      e.subject,
      e.ref ?? "",
    ]
      .map(csvCell)
      .join(",")
  );
  return [head.join(","), ...rows].join("\n");
}

/** 逗號、引號、換行都要處理。少一個就會有人的稽核報告在 Excel 裡錯位。 */
function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
