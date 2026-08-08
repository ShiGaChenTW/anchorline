/**
 * 焦點卡 —— 首屏只顯示「現在正在動的那一個專案」，其餘摺疊。
 *
 * ## 為什麼不是跨專案總覽表
 *
 * 原本的設計是一張 5 專案 × 5 欄的表，= 25 個同時可見的資訊點。
 * 而 `focus-mode.ts` 開頭就寫著本專案自己的判準：
 *
 * > 工作記憶容量約 4 個開放迴圈，原介面同框約 30 個。
 *
 * 一張總覽表會把那個已經修好的問題原封不動搬到首屏。所以：預設只畫一張卡，
 * 其他收成一行。**欄位硬性封頂 4 個**，由 `FOCUS_FIELD_CAP` 與測試一起執法——
 * 沒有那條測試，第五個欄位遲早會被加進來，而且會很有道理。
 *
 * PR 雷達是第 5 個資訊，所以它**不在卡片裡**，在卡片下方獨立一行（見 `gh-status.ts`）。
 *
 * 純函式、零 I/O。
 */
import { sinceLabel } from "./time-format";

/** 焦點卡欄位上限。改這個數字之前先讀上面那段。 */
export const FOCUS_FIELD_CAP = 4;

export type FocusField = { label: string; value: string };

export type FocusCard = {
  projectId: string;
  name: string;
  /** 恆為 4 個，順序固定：下一步 / 進度 / 上次動 / 待推 */
  fields: FocusField[];
  /** 有幾個步驟接不上事件流。> 0 時卡片顯示警告 */
  unanchored: number;
  /** 這張卡是不是 `trackingTarget()` 指到的那一個 */
  isTracking: boolean;
};

export type FocusInput = {
  projectId: string;
  name: string;
  nextStep: string;
  /** `plans/*.md` checkbox 完成率。沒有 plan 檔就給 null */
  planPct: number | null;
  /** openspec artifact 完成率。沒有 openspec 就給 null */
  openspecPct: number | null;
  /** 最後活動時間（plan mtime 與 git 最後 commit 取較新者）。ISO 字串 */
  lastActiveIso: string | null;
  /** 領先 upstream 的 commit 數。-1 = 沒有 upstream */
  ahead: number;
  unanchored: number;
  isTracking: boolean;
};

/**
 * 進度 rollup —— **只在這裡算一次**。
 *
 * 兩個來源各半。缺一方時另一方佔滿，不是打對折——「沒有 openspec」不代表
 * 「openspec 進度是 0」，那會讓所有沒用 openspec 的專案永遠卡在 50%。
 * 兩者皆無回 `null`，呼叫端顯示「無進度來源」而不是 0%。0% 是在說謊：
 * 它宣稱量到了進度而且是零，實際上是根本沒量到。
 */
export function rollupPct(planPct: number | null, openspecPct: number | null): number | null {
  const p = clampPct(planPct);
  const o = clampPct(openspecPct);
  if (p === null && o === null) return null;
  if (p === null) return o;
  if (o === null) return p;
  return Math.round(p * 0.5 + o * 0.5);
}

function clampPct(v: number | null): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** 待推 commit 的一句話。-1 是「沒有 upstream」，不是 0——兩者意思差很多。 */
export function aheadLabel(ahead: number): string {
  if (ahead < 0) return "沒接遠端";
  if (ahead === 0) return "已同步";
  return `${ahead} 個待推`;
}

export function progressLabel(pct: number | null): string {
  return pct === null ? "無進度來源" : `${pct}%`;
}

/**
 * 組一張焦點卡。欄位永遠是 4 個、順序固定。
 *
 * 第三欄「上次動」用 `sinceLabel` 的相對天數而不是日期——時間盲對策。
 * 「2026-07-03」要人心算，「37 天前」不用。
 */
export function buildFocusCard(input: FocusInput, nowMs: number): FocusCard {
  const pct = rollupPct(input.planPct, input.openspecPct);
  return {
    projectId: input.projectId,
    name: input.name,
    fields: [
      { label: "下一步", value: input.nextStep || "—" },
      { label: "進度", value: progressLabel(pct) },
      { label: "上次動", value: sinceLabel(input.lastActiveIso, nowMs) },
      { label: "待推", value: aheadLabel(input.ahead) },
    ],
    unanchored: input.unanchored,
    isTracking: input.isTracking,
  };
}

/** 其他專案摺疊成的那一行。0 個就回空字串，不畫一個空殼。 */
export function othersLine(count: number): string {
  return count > 0 ? `其他 ${count} 個專案 ▸` : "";
}

/**
 * 從一組專案裡挑出焦點。
 *
 * 優先序：`trackingTarget()` 指到的 → 最近活動的 → 第一個。
 * **永遠回傳單一一個**（或 null）。回傳陣列的那一刻，UI 就會忍不住把它們全畫出來。
 */
export function pickFocus<T extends { projectId: string; isTracking: boolean; lastActiveIso: string | null }>(
  items: T[]
): T | null {
  if (!items.length) return null;
  const tracked = items.find((i) => i.isTracking);
  if (tracked) return tracked;
  const byRecency = [...items].sort(
    (a, b) => timeOf(b.lastActiveIso) - timeOf(a.lastActiveIso)
  );
  return byRecency[0] ?? null;
}

function timeOf(iso: string | null): number {
  if (!iso) return -1;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? -1 : t;
}
