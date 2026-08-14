/**
 * 治理覆蓋率的 I/O 端。判定全在 `governance.ts`（純函式），這裡只負責取資料。
 *
 * 與 `tracking-bridge` / `status-bridge` 同一個形狀：一個 `canX()` 給畫面決定
 * 要不要顯示，一個 `requestX()` 真的去要。
 */
import { dedupe, parseLog } from "./event-log";
import { governanceCoverage, EMPTY_COVERAGE, OPENSPEC_LIVE_PREFIX, type GovernanceCoverage } from "./governance";
import { isNative, native } from "./native";
import { parsePlanMeta } from "./plan-parser";
import { anchorsOf } from "./plan-writer";

export type CoverageResult = {
  coverage: GovernanceCoverage;
  /** 因為分片數或位元組上限少讀了。統計會偏低，畫面必須講出來。 */
  truncated: boolean;
  /** 壞掉而被跳過的行數。JSONL 壞一行只影響一行，這是它相對 SQLite 的優點。 */
  skipped: number;
  /** plan 檔裡真實存在的錨點數。0 代表沒有任何步驟鑄過錨點。 */
  knownAnchors: number;
};

export const EMPTY_RESULT: CoverageResult = {
  coverage: EMPTY_COVERAGE,
  truncated: false,
  skipped: 0,
  knownAnchors: 0,
};

/** 只有桌面版讀得到磁碟上的稽核軌跡。 */
export function canReadCoverage(): boolean {
  return isNative();
}

/**
 * 讀一個專案的治理覆蓋率。
 *
 * 讀不到就回空結果，不 throw —— 這張卡片是附加資訊，不該讓整頁儀表板掛掉。
 * 「沒開通治理」與「讀取失敗」在畫面上都是「尚未開始治理」，兩者都不是錯誤。
 */
export async function requestCoverage(projectRoot: string): Promise<CoverageResult> {
  if (!canReadCoverage() || !projectRoot) return EMPTY_RESULT;
  try {
    const [log, anchors] = await Promise.all([
      native.readLog(projectRoot),
      knownAnchorsOf(projectRoot),
    ]);
    const { events, skipped } = parseLog(log.text);
    return {
      coverage: governanceCoverage(dedupe(events), anchors),
      truncated: log.truncated,
      skipped,
      knownAnchors: anchors.size,
    };
  } catch {
    return EMPTY_RESULT;
  }
}

/**
 * 這個專案的 `plans/` 裡真的存在哪些錨點。
 *
 * 判定「已治理」的第二層。沒有它，`anc:t=XXXXXXXX` 這種寫在文件裡的佔位字串
 * 會被算成一個真任務 —— 實測 Anchorline 自己的歷史就有兩筆。
 *
 * 讀不到就回空集合，於是所有事件都算未治理。那個方向是對的：**不確定的時候
 * 要往「還沒治理」倒，不要往「已經治理」倒** —— 前者促使人去看，後者讓人安心
 * 而其實什麼都沒發生。
 */
async function knownAnchorsOf(projectRoot: string): Promise<ReadonlySet<string>> {
  try {
    const root = projectRoot.replace(/\/+$/, "");
    // 第二個參數帶專案根：Rust 端會往 openspec/changes 下掃（跳過 archive）。
    const scan = await native.trackingScan([`${root}/plans`], [root]);
    const ids = new Set<string>();
    for (const f of scan.files ?? []) {
      if (f.kind === "openspec") {
        // openspec 步驟的 join key 是 `openspec:<changeId>/<編號>`（W1-3）。
        // sentinel 標記「這個 change 活著」——isGoverned 靠它決定要嚴格驗
        // 步驟存在，還是（歸檔後）只驗形狀。
        const change = f.change ?? "";
        if (!change) continue;
        ids.add(`${OPENSPEC_LIVE_PREFIX}${change}`);
        const meta = parsePlanMeta(f.text ?? "", f.path, { dialect: "openspec", change });
        for (const step of meta.steps) if (step.id) ids.add(`openspec:${change}/${step.id}`);
        continue;
      }
      for (const id of anchorsOf(f.text ?? "")) ids.add(id);
    }
    return ids;
  } catch {
    return new Set();
  }
}
