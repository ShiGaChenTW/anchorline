/**
 * Live tracking 的資料通道（桌面版）。
 *
 * 瀏覽器看不到磁碟，而整個判定只靠 mtime —— 所以 web 端的 tracking 能不能成立，
 * 完全取決於這條橋。形狀照抄 `project-stats.ts` 的 requestProjectStats。
 */
import { isDesktopApp } from "./project-folder";
import type { TrackingSignal } from "./tracking";

export type ScannedPlan = {
  /** 絕對路徑 */
  path: string;
  name: string;
  mtimeMs: number;
  text: string;
};

export type TrackingScan = {
  files: ScannedPlan[];
  signal: TrackingSignal | null;
};

type Bridge = {
  webkit?: { messageHandlers?: { specforge?: { postMessage: (m: unknown) => void } } };
};

export function canScanPlans(): boolean {
  const w = window as Window & Bridge;
  return isDesktopApp() && Boolean(w.webkit?.messageHandlers?.specforge);
}

/** 向原生橋要一次掃描。逾時就 reject —— 別讓每秒一次的輪詢堆滿未完成的 promise。 */
export function requestTrackingScan(plansDirs: string[], timeoutMs = 10000): Promise<TrackingScan> {
  return new Promise((resolve, reject) => {
    const w = window as Window & Bridge;
    if (!canScanPlans()) {
      reject(new Error("需要桌面版 App：瀏覽器拿不到檔案 mtime"));
      return;
    }

    const timer = window.setTimeout(() => {
      window.removeEventListener("specforge-native", onNative);
      reject(new Error("掃描逾時"));
    }, timeoutMs);

    function onNative(e: Event) {
      const p = (e as CustomEvent<Record<string, unknown>>).detail;
      if (p?.type !== "trackingScan") return;
      window.clearTimeout(timer);
      window.removeEventListener("specforge-native", onNative);
      resolve({
        files: (p.files as ScannedPlan[]) ?? [],
        signal: (p.signal as TrackingSignal | undefined) ?? null,
      });
    }

    window.addEventListener("specforge-native", onNative);
    w.webkit!.messageHandlers!.specforge!.postMessage({ action: "trackingScan", plansDirs });
  });
}

/** 各專案綁定資料夾底下的 `plans/`。沒綁資料夾的專案自然不在裡面。 */
export function plansDirsOf(projects: { importSummary?: { rootPath: string } }[]): string[] {
  const dirs = projects
    .map((p) => (p.importSummary?.rootPath ?? "").replace(/\/+$/, ""))
    .filter(Boolean)
    .map((root) => `${root}/plans`);
  return [...new Set(dirs)];
}
