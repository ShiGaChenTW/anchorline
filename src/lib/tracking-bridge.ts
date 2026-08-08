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

type ProjectLike = { id?: string; importSummary?: { rootPath: string } };

/**
 * 要掃描的 `plans/` 目錄。
 *
 * **限定在當前選取的專案**，不是全部專案。Task Tracking 讀出來的清單直接就是
 * 使用者眼前的工作範圍 —— 混進別的專案的 plan，等於要人在自己的清單裡先做一次
 * 過濾，而工作區側欄早就已經表達過「我現在在看哪個專案」了。
 *
 * 沒有 `activeProjectId`（或它指向一個不存在／沒綁資料夾的專案）時回傳空陣列，
 * **不退回「全部專案」**。空清單是誠實的「這個專案沒有東西可追蹤」；退回全部
 * 則是把 bug 重新包裝成功能，而且退回的那一刻使用者不會知道範圍變了。
 */
export function plansDirsOf(projects: ProjectLike[], activeProjectId?: string | null): string[] {
  const scoped = activeProjectId
    ? projects.filter((p) => p.id === activeProjectId)
    : [];
  const dirs = scoped
    .map((p) => (p.importSummary?.rootPath ?? "").replace(/\/+$/, ""))
    .filter(Boolean)
    .map((root) => `${root}/plans`);
  return [...new Set(dirs)];
}
