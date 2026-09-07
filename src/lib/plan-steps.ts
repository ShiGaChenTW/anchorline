/**
 * 「專案根目錄底下有沒有帶勾選框的計劃檔」—— dashboard 治理鏈 L3（計劃）的資料通道。
 *
 * ## 為什麼不照抄 editor.ts / projects.ts / review.ts 的 `import.meta.glob`
 *
 * 那三支抓的是 Anchorline 這個 repo 自己的 `plans/*.md`，而且是 DEV-only：
 * 拿本 repo 的計劃去點亮「使用者的專案」是在說謊，正式 build 沒有那些檔案時
 * 更會靜默退回永遠 false。
 *
 * 真正的資料源是 `tracking-bridge` 的 `requestTrackingScan`（掃的是每個使用者專案
 * 的 `<root>/plans/`），dashboard 那一趟 `loadUatScan` 已經在跑、五個曝光面共用
 * 快取。這一支只是從那趟掃描的 `files` 算出路徑，零額外 I/O。
 *
 * ## 為什麼算「root 目錄清單」而不是直接算布林
 *
 * `loadUatScan` 掃的是**全部**專案的 `plans/`（`uatScanDirs`）。dashboard 的治理
 * 鏈是「目前焦點專案」的視圖，而「哪個專案」在掃描當下還不確定 —— 所以這裡
 * 把每份計劃檔**屬於哪個 root** 算好，消費者再拿手邊的專案 root 去比。
 *
 * 全程純函式：零 I/O、零 store、零 DOM。測試直接餵 plain data。
 */
import type { ScannedPlan } from "./tracking-bridge";

/** `/plans/` 是 root 之下的固定目錄名（Rust 端掃的就是 `${root}/plans`） */
const PLANS_DIR = "/plans/";

/**
 * Markdown 勾選框的判定。四種寫法都要吃，含前導空白縮排：
 * `- [ ]`、`- [x]`、`- [X]`（與 editor.ts:1437 的 v/V 變體），以及 `* [ ]` 系列。
 *
 * 刻意寫成「一整行」而不是裸搜 `[ ]`：前者只會命中真正的 list item，
 * 後者會把「說明：[ ]」這種 prose 誤判成步驟。
 */
const HAS_CHECKBOX = /^[ \t]*(?:[-*]) \[[ xXvV]\]/m;

/**
 * 「這份 markdown 帶不帶計劃步驟」＝內容含 markdown checkbox。
 * 純函式。呼叫端若已知道內容，不需要經由檔案清單。
 */
export function hasPlanSteps(text: string): boolean {
  return HAS_CHECKBOX.test(text);
}

/**
 * 從掃到的檔案清單算出「哪些專案根目錄底下有帶勾選框的計劃檔」。
 *
 * 過濾採**排除 openspec**，不是白名單 `kind === "plan"`：`ScannedPlan.kind` 是
 * optional，舊資料／缺欄位時沒有 `kind`。白名單會把那些檔整批丟掉；排除法才
 * 涵蓋得到「沒帶 kind 的計劃檔」。openspec 的 `tasks.md` 是另一種方言，進這個
 * 清單會把沒有計劃的專案誤點亮，所以唯獨它要擋。
 *
 * 輸出為**專案根目錄**（去掉檔名與 `/plans/` 段），並去重、排序，
 * 讓結果與輸入順序無關。
 */
export function planStepDirsFrom(files: ScannedPlan[]): string[] {
  const dirs = new Set<string>();
  for (const f of files) {
    if (f.kind === "openspec") continue;
    if (!hasPlanSteps(f.text)) continue;
    const at = f.path.indexOf(PLANS_DIR);
    if (at < 0) continue;
    dirs.add(f.path.slice(0, at));
  }
  return [...dirs].sort();
}

/**
 * 「這個專案底下有沒有帶勾選框的計劃檔」。
 *
 * 比的是 `root + "/"` 前綴而不是裸 `root` —— 純字串前綴會讓 `/a/proj` 吃掉
 * `/a/proj2` 的計劃（與 `uat-pending.ts` 的 `attributePendingUats`、tracking 頁的
 * `alignProjectForUat` 同一條規則）。掃描路徑都是絕對路徑，所以 `root` 也以
 * 絕對路徑為準。
 *
 * `rootPath` 為 `undefined` 時回 false —— 沒綁資料夾的專案沒有計劃可量，
 * 回 false 是誠實的「不知道」，不是「沒有」。
 */
export function hasPlanStepsFor(rootPath: string | undefined, planStepDirs: string[]): boolean {
  if (!rootPath) return false;
  const root = rootPath.replace(/\/+$/, "");
  if (!root) return false;
  return planStepDirs.some((dir) => dir === root || dir.startsWith(`${root}/`));
}
