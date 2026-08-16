/**
 * 「還沒測完的實測報告」—— dashboard 側的一個問題，兩個消費者。
 *
 * ## 為什麼抽出來而不是各自數一次
 *
 * 總覽的「待實測」區塊與側欄 badge 回答的是同一個問題（「有幾份報告在等我
 * 動手」），而那個問題的判定條件有三條：是實測方言、狀態進行中、至少有一題
 * 有錨點。在兩個地方各寫一次，第一次改判定條件就會出現「側欄說 2、點進去
 * 只有 1」—— 而那種不一致沒有任何錯誤訊息，只會讓人不再相信那個數字。
 *
 * ## 方言判定與 tracking 頁一字不差
 *
 * `f.kind !== "openspec" && (isUatText || 檔名 uat-*)` 這一串是從 `tracking.ts`
 * 抄過來的**同一條規則**：兩邊分岔的症狀是「總覽列出來的報告，點進去在
 * Task Tracking 裡不是實測分組」。
 *
 * 只有 `loadPendingUats` 碰橋，判定本身是純函式。
 */
import { canScanPlans, requestTrackingScan, type ScannedPlan } from "./tracking-bridge";
import { isUatText, parseUatReport, uatProgress, type UatVerdict } from "./uat-parser";

export type PendingUat = {
  /** 絕對路徑。著陸網址與去重都用它 */
  path: string;
  /** 檔名 */
  name: string;
  title: string;
  closed: number;
  total: number;
  /**
   * 每種結果各幾題。**合計列的分母從這裡算**（見 `rollupPendingUats`）——
   * `closed`／`total` 是給逐份進度條用的既有欄位，不動。
   *
   * 分開存是因為「哪些結果算未完成」是**還沒定案的政策**：`tracking.ts` 的
   * 「本輪收工」會把剩下的未測題批次標成 `later`，那些題現在既不算未測、
   * 又不是 `fail` 進不了待修 —— 整個 App 裡零追蹤。要把它們算回來時，改的是
   * `rollupPendingUats` 的 `openVerdicts`，不是重新解析一次報告。
   */
  verdicts: Partial<Record<UatVerdict, number>>;
  mtimeMs: number;
  /**
   * 這份報告屬於哪個專案。**比不到就留空**，不猜 —— 收件匣現在掃全部專案，
   * 一列來歷不明的標題還算誠實，掛錯專案名則會讓人以為那是別人的事。
   * 由 `attributePendingUats` 填，`pendingUatsFrom` 不碰（它看不到專案清單）。
   */
  projectId?: string;
  projectName?: string;
};

/**
 * 路徑比對前的正規化。
 *
 * 兩份路徑要能對上：CLI 寫進檔頭的路徑、Rust 掃描回來的路徑、store 裡的專案
 * 根目錄，可能一個走了 symlink 一個沒走（/tmp 與 /private/tmp 是最常見的一對，
 * consumePendingUat 已為同一原因設過保險絲），也可能正規化形式不同（NFC/NFD，
 * macOS 檔案系統慣用後者）。
 *
 * 提到模組層是因為現在有兩個消費者：supersede 過濾（W2-3）與跨專案歸屬（W2-1）。
 * 兩邊各寫一次的話，症狀是「重測對得上、專案名卻空著」這種只錯一半的怪事。
 */
export const canonUatPath = (p: string) =>
  p.normalize("NFC").replace(/^\/private(?=\/(?:tmp|var)\/)/, "");
const canon = canonUatPath;

/**
 * 歸屬比對需要的最小專案樣貌。
 *
 * 刻意不收整個 `Project`：顯示名怎麼算是 `projectDisplayName`（data/types）的
 * 責任，那條 fallback 鏈在這裡再寫一次只會多一個會分岔的地方。呼叫端把算好的
 * 名字傳進來，這一支就只管路徑比對。
 */
export type UatProjectRef = {
  id: string;
  name: string;
  rootPath?: string | null;
};

/**
 * 掃描結果 → 待實測清單。
 *
 * 「待實測」= 進行中 **且** 至少有一題有錨點。後半是必要的：沒有錨點的題
 * 勾不了（寫回時定位不到那一行），把一份全無錨點的遺留檔列進待辦，等於
 * 給使用者一個點進去也做不了事的項目 —— tracking 頁把那種檔歸進
 * 「沒有步驟的檔案」，這裡的判定要跟它一致。
 */
/**
 * 掃描結果 → 解析後的報告集＋「被重測取代」的舊報告路徑集。
 *
 * 待實測（W2-1/W2-3）與待修（W2-4）共用同一套：兩邊各算一次 supersede，
 * 症狀會是「報告從待實測消失了、它的失敗題卻還掛在待修」這種半套出清。
 */
function uatReportsOf(files: ScannedPlan[]): {
  reports: { f: ScannedPlan; r: ReturnType<typeof parseUatReport> }[];
  isSuperseded: (f: ScannedPlan) => boolean;
} {
  const reports = files
    .filter((f) => f.kind !== "openspec")
    .filter((f) => isUatText(f.text) || /^uat-/i.test(f.name))
    .map((f) => ({ f, r: parseUatReport(f.text, f.path) }));

  // 取代者自己測完與否無關——新一輪存在的那一刻，舊報告就退場。
  //
  // 但「退場」不能讓循環把報告集體蒸發（Grok C1）：自指（複製檔忘了改
  // 標記）、互指、三角循環，單向 Set 都會把環裡每一份一起踢掉——收件匣
  // 無聲清空、零錯誤訊息。規則升級成：**環內成員彼此不互踢**（人為錯誤
  // 製造的環視為並存，留給人看見並修理），環外的正常單向鏈照舊退場。
  const supersededBy = new Map<string, Set<string>>();
  const byPath = new Map<string, string | undefined>();
  for (const { f, r } of reports) {
    byPath.set(canon(f.path), r.supersedes ? canon(r.supersedes) : undefined);
    if (!r.supersedes) continue;
    const target = canon(r.supersedes);
    const source = canon(f.path);
    if (target === source) continue; // 自指不算取代
    (supersededBy.get(target) ?? supersededBy.set(target, new Set()).get(target)!).add(source);
  }
  // 沿 supersedes 指標走出去，走回起點＝環。報告數量小，O(n²) 無所謂。
  const cycleGroup = new Map<string, number>();
  let nextGroup = 0;
  for (const start of byPath.keys()) {
    if (cycleGroup.has(start)) continue;
    const walk: string[] = [];
    let at: string | undefined = start;
    const seen = new Set<string>();
    while (at !== undefined && byPath.has(at) && !seen.has(at)) {
      seen.add(at);
      walk.push(at);
      at = byPath.get(at);
    }
    if (at !== undefined && seen.has(at)) {
      const g = nextGroup++;
      for (const m of walk.slice(walk.indexOf(at))) cycleGroup.set(m, g);
    }
  }
  const isSuperseded = (f: ScannedPlan): boolean => {
    const me = canon(f.path);
    const killers = supersededBy.get(me);
    if (!killers) return false;
    const myGroup = cycleGroup.get(me);
    return [...killers].some(
      (src) => myGroup === undefined || cycleGroup.get(src) !== myGroup,
    );
  };
  return { reports, isSuperseded };
}

export function pendingUatsFrom(files: ScannedPlan[]): PendingUat[] {
  const { reports, isSuperseded } = uatReportsOf(files);

  const out: PendingUat[] = [];
  for (const { f, r } of reports) {
    if (r.status !== "進行中") continue;
    if (!r.items.some((x) => x.id)) continue;
    // 被新一輪取代的檔踢出待辦。兩輪並存都算待實測的話，badge 的分母只進不出。
    if (isSuperseded(f)) continue;
    const prog = uatProgress(r);
    const verdicts: Partial<Record<UatVerdict, number>> = {};
    for (const it of r.items) verdicts[it.verdict] = (verdicts[it.verdict] ?? 0) + 1;
    out.push({
      path: f.path,
      name: f.name,
      title: r.title,
      closed: prog.closed,
      total: prog.total,
      verdicts,
      mtimeMs: f.mtimeMs,
    });
  }
  // 最近動過的排前面。NaN（降級路徑沒有真實 mtime）沉底而不是把整個排序弄壞。
  return out.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
}

/**
 * 全部待實測報告的合計 —— 「所有專案加起來，我還有幾題沒勾」。
 *
 * **分母只從 `pendingUatsFrom` 的輸出來**：不另外掃磁碟、不自己判 supersede。
 * 理由同本檔 `uatReportsOf` 上的那條 —— 待實測與待修各算一次 supersede 曾造成
 * 「報告從待實測消失、失敗題還掛在待修」的半套出清。第三個計數器自己算分母，
 * 遲早跟前兩個分岔，而分岔的症狀是「上面說還有 12 題、下面逐列加起來只有 8 題」
 * 這種沒有錯誤訊息、只會讓人不再相信那個數字的不一致。
 *
 * `open` 數的是 **verdict 還是 pending 的題**，與「待修」（已判失敗）互斥：
 * 一題被判失敗的那一刻就離開 open、進入待修。兩個數字不會重複計算同一題。
 */
export type UatRollup = {
  /** 幾份報告 */
  reports: number;
  /** 還沒勾的題數（結果落在 `openVerdicts` 裡的） */
  open: number;
  /**
   * 被「本輪收工」批次標成「暫時跳過」的題數。
   *
   * **另列，不混進 `open`**：收工的語意是「這輪不做了」，不是「這些題不存在」。
   * 混進去會讓收工按鈕失去意義；不顯示則會讓那批題在全 App 零追蹤 —— 一個按
   * 一下就能清零的追蹤器比沒有追蹤器更糟，因為它會被信任。
   */
  later: number;
  closed: number;
  total: number;
  /** 已勾百分比，0–100 整數。total 為 0 時是 0（不是 NaN，也不是 100） */
  pct: number;
  /** 這次掃描撞到 300 檔上限。合計被截斷時**必須講**，見 `UAT_TRUNCATED_NOTE` */
  truncated: boolean;
};

/**
 * 「還沒勾」＝結果仍是 `pending`（畫面上的「未測」）。**定案語意**（2026-08-15）。
 *
 * 「本輪收工」把剩餘未測題批次標成 `later`（「暫時跳過」）。那批題**不併進
 * 這個分母** —— 收工的語意是「這輪不做了」，把它算成未測等於讓收工按鈕沒有
 * 作用。它們改走 `UatRollup.later`，在合計旁另列一行。
 *
 * 形狀保留成可參數化的（`rollupPendingUats` 的 `openVerdicts`），但**預設值就是
 * 這一份**：讓呼叫端各自傳參數的話，三個曝光面遲早分岔成三種分母。
 */
export const DEFAULT_OPEN_VERDICTS: readonly UatVerdict[] = ["pending"];

/** 「暫時跳過」的結果值。另列計數用，不進 `open` */
const LATER_VERDICT: UatVerdict = "later";

/** 截斷警語。總覽與儀表板共用一句 —— 兩邊各寫一次，改的時候只會改到一邊。 */
export const UAT_TRUNCATED_NOTE = "掃描達到 300 份上限，實際題數可能更多";

/**
 * 合計那一行的口徑說明。三個曝光面共用。
 *
 * ⚠️ 範圍（「全部專案」）**不能只寫在這裡** —— 側欄那個 badge 就是前車之鑑：
 * 它的值是全部專案的份數，卻掛在「這個專案可以做的事」群組裡，範圍只寫在
 * `title` 上，結果沒有人發現。範圍要在看得見的文字裡，title 只補充口徑。
 */
export const UAT_SUM_TITLE =
  "「沒勾」＝結果還是「未測」的題；「待修」＝已判失敗、等著修的題；「暫時跳過」＝在 UAT使用者測試 按「本輪收工」時被批次標記的題。三者互斥，同一題只會算進一邊。跳過的題另列而不併進「沒勾」——收工的意思是這輪不做了，不是那些題不存在。";

export function rollupPendingUats(
  list: PendingUat[],
  opts: { openVerdicts?: readonly UatVerdict[]; truncated?: boolean } = {},
): UatRollup {
  const openVerdicts = opts.openVerdicts ?? DEFAULT_OPEN_VERDICTS;
  let closed = 0;
  let total = 0;
  let open = 0;
  let later = 0;
  for (const u of list) {
    closed += u.closed;
    total += u.total;
    later += u.verdicts[LATER_VERDICT] ?? 0;
    for (const v of openVerdicts) open += u.verdicts[v] ?? 0;
  }
  return {
    reports: list.length,
    open,
    later,
    closed,
    total,
    pct: total ? Math.round((closed / total) * 100) : 0,
    truncated: opts.truncated === true,
  };
}

/**
 * 合計那一行的文案。**總覽與歡迎畫面共用同一支** —— 不是為了省行數，而是
 * 兩邊各寫一次的話，改文案時只會改到看得見的那一邊（歡迎畫面可以被使用者
 * 靜音一整天，改壞了不會有人發現）。
 *
 * 量詞與動詞刻意跟總覽既有的兩個計數器錯開：「待實測 N **份**」數的是報告，
 * 「待修 N **題**」是已判失敗等著修的題，這裡的「還有 N 題**沒勾**」是還沒
 * 判過的題。三個數字量的是三件事，同一題不會同時落在沒勾與待修。
 */
export function uatRollupText(t: UatRollup): {
  lead: string;
  detail: string;
  /** 「暫時跳過」另列。**零題時是空字串**，呼叫端整段不渲染 */
  skipped: string;
} {
  return {
    // 每題都判完、報告卻還沒收工 —— 說「還有 0 題沒勾」是對的但沒用，
    // 這時該講的下一步是去收工。
    lead: t.open ? `還有 ${t.open} 題沒勾` : "每題都勾完了",
    detail: `共 ${t.total} 題 · 已勾 ${t.pct}%`,
    skipped: t.later ? `另有 ${t.later} 題暫時跳過` : "",
  };
}

/**
 * 幫每份報告掛上它所屬的專案。
 *
 * 收件匣掃的是全部專案（`plansDirsOfAll`），所以每一列都得回答「這是誰家的」——
 * 少了這一步，使用者看到的是一排來歷不明的標題，而「不知道是哪個專案的事」
 * 恰好是最容易被跳過的那種待辦。
 *
 * 判定只用 rootPath 前綴，與 tracking 頁的 `alignProjectForUat` 同一條規則：
 * 兩邊分岔的症狀是「總覽說這是 A 專案的，點進去卻切到 B」。比的是
 * `root + "/"` 而不是 `root` —— 純字串前綴會讓 `/w/alpha` 吃掉
 * `/w/alpha-2` 的報告，而那種誤判在畫面上完全看不出來。
 *
 * 比不到就留空，不猜。純函式：不碰 store，也不改動傳進來的物件。
 *
 * ⚠️ 一個與 tracking.ts 的已知差異：這裡取**最長**的相符 root，`alignProjectForUat`
 * 取陣列裡第一個相符的。只有在「某專案根目錄是另一個專案根目錄的子目錄」時
 * 兩者才會不同（那種情況下第一個相符取決於陣列順序，等於隨機）。修那一邊要動
 * tracking.ts，不在這次範圍內。
 */
/**
 * 一個還欠著的修（W2-4）：某份報告裡一題「失敗」。
 *
 * **不是第二個工作項資料庫**——single source of truth 永遠是報告檔的
 * `**結果：** 失敗`。這裡是視圖：改判通過／不測、或整份被新一輪 supersede，
 * 下一次掃描它就自然消失，零狀態同步、零回寫協定。
 */
export type OpenFix = {
  /** 報告絕對路徑，deep-link 用 */
  path: string;
  name: string;
  reportTitle: string;
  itemId?: string;
  itemTitle: string;
  /** 失敗說明——必填規則保證它存在，但手寫檔可能繞過，空字串照收 */
  note: string;
  mtimeMs: number;
  projectId?: string;
  projectName?: string;
};

/**
 * 掃描結果 → 待修清單：所有**未被 supersede** 報告裡的失敗題。
 *
 * 報告狀態不設限：**已收工的報告裡的失敗題仍算欠修**——收工結束的是
 * 測試輪，不是債（main session 裁決 2026-08-15）。被 supersede 的整檔
 * 退場、以新一輪為準——畫面要在空狀態／tooltip 講出這條，免得使用者
 * 以為債被吃掉了。
 */
export function openFixesFrom(files: ScannedPlan[]): OpenFix[] {
  const { reports, isSuperseded } = uatReportsOf(files);
  const out: OpenFix[] = [];
  for (const { f, r } of reports) {
    if (isSuperseded(f)) continue;
    for (const it of r.items) {
      if (it.verdict !== "fail") continue;
      // 錨點守門與 pendingUatsFrom 同一條規矩（Cato-02）：沒有錨點的題
      // 改判不了（setVerdict 定位不到），出清條件只剩「整份被 supersede」
      // ——列進待修等於一個只會漲不會退的數字。債仍誠實地留在報告檔裡。
      if (!it.id) continue;
      out.push({
        path: f.path,
        name: f.name,
        reportTitle: r.title,
        itemId: it.id,
        itemTitle: it.title,
        note: it.note,
        mtimeMs: f.mtimeMs,
      });
    }
  }
  // 最近動過的報告排前面，同報告內維持題目原順序
  return out.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
}

/** 跟 loadPendingUats 同一條規矩：非桌面版／壞橋一律回空。 */
export async function loadOpenFixes(plansDirs: string[]): Promise<OpenFix[]> {
  return (await loadUatScan(plansDirs)).fixes;
}

export function attributePendingUats<T extends { path: string; projectId?: string; projectName?: string }>(
  list: T[],
  projects: UatProjectRef[],
): T[] {
  const roots = projects
    .map((p) => ({ p, root: canon((p.rootPath ?? "").replace(/\/+$/, "")) }))
    // 沒綁資料夾的專案不參加比對：空字串會前綴到所有路徑，等於它吃下全部報告。
    .filter((x) => x.root)
    .sort((a, b) => b.root.length - a.root.length);

  return list.map((u) => {
    const path = canon(u.path);
    const hit = roots.find((x) => path.startsWith(`${x.root}/`));
    // 沒中就原封不動回傳同一個物件 —— 不必為了「都走一次 spread」多配一份記憶體
    return hit ? { ...u, projectId: hit.p.id, projectName: hit.p.name } : u;
  });
}

/**
 * 一次掃描的兩個視圖 —— 待實測與待修**共用同一批檔案**。
 *
 * `uatReportsOf` 本來就是兩者共用的內部函式：同樣的目錄、同樣的檔案、同樣的
 * supersede 解法，差別只在一個取 `pending` 一個取 `fail`。分兩趟過橋是純浪費。
 */
export type UatScan = {
  pending: PendingUat[];
  fixes: OpenFix[];
  /** Rust 端撞到 300 檔上限。合計是「全部加起來」，被截斷卻不講就是安靜說謊 */
  truncated: boolean;
};

const EMPTY_SCAN: UatScan = { pending: [], fixes: [], truncated: false };

/**
 * 共用掃描快取。**key 是排序後的目錄字串**，值是那一次掃描的 Promise。
 *
 * 存 Promise 而不是結果，是因為要治的正是**並發**：一次頁面載入裡，側欄 badge、
 * 總覽待實測、總覽待修、儀表板那一列、歡迎畫面會在同一個 tick 前後各要一次，
 * 五個呼叫端拿到的是同一個飛行中的請求，而不是五趟讀同一批最多 300 個檔的全文
 * （CATO-05「總覽三趟掃描」那筆帳）。
 *
 * 生命週期只有一次 page load：這是多頁式 App，導頁 = 整個 module 重來，
 * 所以不需要（也不該有）過期時間。頁內的失效走 `invalidateUatScan`，
 * 由 `rail-nav.invalidateUatBadge` 在勾選／收工之後呼叫。
 *
 * **範圍算法要共用**（`tracking-bridge.uatScanDirs`）：兩個呼叫端各算一套目錄，
 * key 就不一樣，快取等於沒有 —— 而且不會有任何症狀，只是又變回兩趟。
 */
let scanKey = "";
let scanInFlight: Promise<UatScan> | null = null;

export function invalidateUatScan(): void {
  scanKey = "";
  scanInFlight = null;
}

export function loadUatScan(plansDirs: string[]): Promise<UatScan> {
  const key = [...plansDirs].sort().join("\n");
  if (scanInFlight && scanKey === key) return scanInFlight;
  scanKey = key;
  // **非桌面版一律回空** —— 瀏覽器沒有資料通道，回空是誠實的「這裡看不到」，
  // 不是「沒有待實測」。呼叫端要據此整區不渲染，不是顯示 0。
  if (!canScanPlans() || !plansDirs.length) {
    scanInFlight = Promise.resolve(EMPTY_SCAN);
    return scanInFlight;
  }
  const p: Promise<UatScan> = requestTrackingScan(plansDirs, [])
    .then((scan) => ({
      pending: pendingUatsFrom(scan.files),
      fixes: openFixesFrom(scan.files),
      truncated: scan.truncated,
    }))
    .catch(() => {
      // 失敗不留在快取裡：整個頁面生命週期都吃同一個空答案的話，失效重掃也救不回來。
      if (scanInFlight === p) invalidateUatScan();
      return EMPTY_SCAN;
    });
  scanInFlight = p;
  return p;
}

/**
 * 掃一次磁碟。**非桌面版一律回空陣列** —— 瀏覽器沒有資料通道，
 * 回空是誠實的「這裡看不到」，不是「沒有待實測」。
 *
 * 呼叫端自己算目錄（`uatScanDirs`）：這一支刻意不碰 store，才能在測試裡直接餵資料。
 * 橋壞了／逾時也回空陣列 —— 一個 badge 不值得讓整頁噴錯。
 */
export async function loadPendingUats(plansDirs: string[]): Promise<PendingUat[]> {
  return (await loadUatScan(plansDirs)).pending;
}
