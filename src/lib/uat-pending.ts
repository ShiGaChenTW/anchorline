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
import { isUatText, parseUatReport, uatProgress } from "./uat-parser";

export type PendingUat = {
  /** 絕對路徑。著陸網址與去重都用它 */
  path: string;
  /** 檔名 */
  name: string;
  title: string;
  closed: number;
  total: number;
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
  isSuperseded: (f: ScannedPlan, sup: string | undefined) => boolean;
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
  const isSuperseded = (f: ScannedPlan, _sup: string | undefined): boolean => {
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
    if (isSuperseded(f, r.supersedes)) continue;
    const prog = uatProgress(r);
    out.push({
      path: f.path,
      name: f.name,
      title: r.title,
      closed: prog.closed,
      total: prog.total,
      mtimeMs: f.mtimeMs,
    });
  }
  // 最近動過的排前面。NaN（降級路徑沒有真實 mtime）沉底而不是把整個排序弄壞。
  return out.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
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
    if (isSuperseded(f, r.supersedes)) continue;
    for (const it of r.items) {
      if (it.verdict !== "fail") continue;
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
  if (!canScanPlans() || !plansDirs.length) return [];
  try {
    const scan = await requestTrackingScan(plansDirs, []);
    return openFixesFrom(scan.files);
  } catch {
    return [];
  }
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
 * 掃一次磁碟。**非桌面版一律回空陣列** —— 瀏覽器沒有資料通道，
 * 回空是誠實的「這裡看不到」，不是「沒有待實測」。
 *
 * 呼叫端自己算 `plansDirsOf`：這一支刻意不碰 store，才能在測試裡直接餵資料。
 * 橋壞了／逾時也回空陣列 —— 一個 badge 不值得讓整頁噴錯。
 */
export async function loadPendingUats(plansDirs: string[]): Promise<PendingUat[]> {
  if (!canScanPlans() || !plansDirs.length) return [];
  try {
    const scan = await requestTrackingScan(plansDirs, []);
    return pendingUatsFrom(scan.files);
  } catch {
    return [];
  }
}
