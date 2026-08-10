/**
 * 治理覆蓋率 —— 「開始治理之後，有多少事情繞過了治理鏈」。
 *
 * ## 為什麼是「開始治理之後」而不是全部歷史
 *
 * 既有專案有幾百個沒有錨點的 commit。全部算進去，卡片會顯示「未治理 487」，
 * 而那個數字**不可行動** —— 它講的是你導入這套系統之前的人生，你什麼都做不了，
 * 只會學會忽略這張卡片。一張沒人看的卡片比沒有卡片更糟，因為它佔著版面。
 *
 * 基準線取**第一筆帶錨點的事件**：那一刻是治理真正開始的時間，之前沒有東西
 * 可以被繞過。這個判準的另一個好處是它自己就在資料裡，不必額外存一個啟用日，
 * 也就沒有「啟用日檔案被刪掉」這種失效模式。
 *
 * ## 為什麼用前綴判定而不是字元集
 *
 * 錨點的 subject 長成 `anc:t=HNTPRY5R`（`sf:` 是舊前綴，仍讀）。
 * 曾考慮直接比對 Crockford 字元集，但 **七位全數字的 commit hash 也會通過** ——
 * 約 3.7% 的 commit 會被錯算成已治理。前綴是精確的，字元集是近似的。
 *
 * 純函式、零 I/O。
 */
import type { LogEvent } from "./event-log";

/** 帶前綴的錨點 subject。與 `plan-parser` 的錨點同一套字元集。 */
const ANCHORED_SUBJECT_RE = /^(?:anc|sf):t=[0-9A-HJKMNP-TV-Z]{4,32}$/;

/** 這筆事件串得回某個 plan 步驟嗎。 */
export function isGoverned(event: Pick<LogEvent, "subject">): boolean {
  return ANCHORED_SUBJECT_RE.test(event.subject ?? "");
}

export type GovernanceCoverage = {
  /**
   * 治理啟用時間（第一筆帶錨點事件的 ISO 時間）。
   * `null` = 這個專案還沒有任何帶錨點的事件 —— **尚未開始治理**，
   * 與「治理了但零未治理」是完全不同的兩件事，畫面不可以都顯示 0。
   */
  startedIso: string | null;
  /** 啟用後帶錨點的事件數 */
  governed: number;
  /** 啟用後不帶錨點的事件數 —— 卡片上那個數字 */
  ungoverned: number;
};

export const EMPTY_COVERAGE: GovernanceCoverage = {
  startedIso: null,
  governed: 0,
  ungoverned: 0,
};

/**
 * 事件流 → 覆蓋率。
 *
 * 事件不保證有序（三類 writer 併發追加、月分片合併），所以基準線用掃描求最小值，
 * 不能假設第一筆就是最早的。
 */
export function governanceCoverage(events: LogEvent[]): GovernanceCoverage {
  let startedIso: string | null = null;
  for (const e of events) {
    if (!isGoverned(e)) continue;
    if (startedIso === null || e.ts < startedIso) startedIso = e.ts;
  }
  if (startedIso === null) return EMPTY_COVERAGE;

  let governed = 0;
  let ungoverned = 0;
  for (const e of events) {
    // 基準線那一刻之前的事件不計 —— 那時還沒有治理可以被繞過。
    if (e.ts < startedIso) continue;
    if (isGoverned(e)) governed++;
    else ungoverned++;
  }
  return { startedIso, governed, ungoverned };
}

/** 跨專案彙總用的一列。 */
export type ProjectCoverage = GovernanceCoverage & {
  projectId: string;
  projectName: string;
};

/**
 * 跨專案總覽：總未治理數，以及各專案明細（未治理多的排前面）。
 *
 * 尚未開始治理的專案**不列入明細也不計入總數**。把它們算成 0 會讓「還沒導入」
 * 看起來像「導入得很乾淨」，那是最糟的一種誤讀 —— 它獎勵了什麼都沒做。
 */
export function rollupCoverage(rows: ProjectCoverage[]): {
  ungoverned: number;
  governed: number;
  /** 有治理資料的專案（已排序） */
  active: ProjectCoverage[];
  /** 尚未開始治理的專案數，畫面用一句話帶過 */
  notStarted: number;
} {
  const active = rows.filter((r) => r.startedIso !== null);
  const sorted = [...active].sort(
    (a, b) => b.ungoverned - a.ungoverned || a.projectName.localeCompare(b.projectName)
  );
  return {
    ungoverned: active.reduce((n, r) => n + r.ungoverned, 0),
    governed: active.reduce((n, r) => n + r.governed, 0),
    active: sorted,
    notStarted: rows.length - active.length,
  };
}

/** 卡片上那一句。數字自己不會說話，得講出它在問什麼。 */
export function coverageLine(c: GovernanceCoverage): string {
  if (c.startedIso === null) return "尚未開始治理";
  if (c.ungoverned === 0) return "全部都經過治理";
  const total = c.governed + c.ungoverned;
  const pct = Math.round((c.ungoverned / total) * 100);
  return `${c.ungoverned} 件未治理（占 ${pct}%）`;
}
