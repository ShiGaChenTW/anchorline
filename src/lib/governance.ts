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
 * ## 判定分兩層，兩層都必要
 *
 * 第一層是前綴（`anc:t=` / `sf:t=`）。曾考慮只比對 Crockford 字元集，但
 * **七位全數字的 commit hash 也會通過** —— 約 3.7% 的 commit 會被錯算成已治理。
 *
 * 第二層是**去 plan 檔確認那個 id 真的存在**。前綴擋不住佔位字串：實測
 * Anchorline 自己的歷史，`anc:t=XXXXXXXX`（寫文件時舉的例子）完全合法，
 * 而 `X` 在字元集裡。只有第一層的話，那張卡會顯示兩筆根本不存在的「已治理」。
 *
 * 純函式、零 I/O。
 */
import type { LogEvent } from "./event-log";

/** 帶前綴的錨點 subject。與 `plan-parser` 的錨點同一套字元集。 */
const ANCHORED_SUBJECT_RE = /^(?:anc|sf):t=([0-9A-HJKMNP-TV-Z]{4,32})$/;

/**
 * 第二種已治理形狀（W1-3）：`openspec:<changeId>/<N.M>`。
 *
 * 沒有這一條，每完成一個 openspec 步驟，覆蓋率就掉一格——核心指標對
 * 自家最推薦的工作流**系統性反向計分**。不給 openspec 檔案塞 anchor
 * （守 D10a）；openspec 的步驟身分就是變更代號＋編號，直接認它。
 */
const OPENSPEC_SUBJECT_RE = /^openspec:(.+)\/(\d+(?:\.\d+)*)$/;



/**
 * 這筆事件串得回某個**真的存在**的 plan 步驟嗎。
 *
 * ## 為什麼光看形狀不夠
 *
 * 實測 Anchorline 自己的 175 個 commit，兩筆被判成「已治理」，而它們是
 * `anc:t=XXXXXXXX` 與 `anc:t=XXXX` —— **寫文件時舉的例子**。`X` 在 Crockford
 * 字元集裡，所以佔位字串完全通過形狀檢查。
 *
 * 那正是這整個模組要防的失效模式：事件掛在一個不存在的任務上，而畫面顯示
 * 它已治理。形狀擋得住 `abc`，擋不住 `XXXXXXXX`。
 *
 * 唯一能分辨「真 id」與「長得像 id 的字串」的方法，是去問 plan 檔它在不在。
 *
 * ## 代價，說在前面
 *
 * plan 檔被刪掉之後，掛在它身上的舊事件會從「已治理」變成「未治理」。歷史
 * 因此不是不可變的。接受這個代價是因為這張卡片回答的問題是「**現在**有多少
 * 事情連得回一個活著的計劃步驟」—— 那是可行動的；「歷史上曾經有過」不是。
 */
export function isGoverned(
  event: Pick<LogEvent, "subject">,
  knownAnchors: ReadonlySet<string>
): boolean {
  const subject = event.subject ?? "";
  const id = ANCHORED_SUBJECT_RE.exec(subject)?.[1];
  if (id !== undefined) return knownAnchors.has(id);

  // openspec 形狀只驗形狀，**不驗存在**——與錨點刻意不同。理由有兩層：
  //
  // 1. 歸檔是 openspec 變更的正常生命週期終點。堅持「必須在掃描裡」，
  //    每歸檔一個 change，它整段歷史就從已治理翻回未治理——覆蓋率隨
  //    歸檔衰減，重蹈本項要修的「對正確工作流反向計分」。
  // 2. `N.M` 是**位置編號**不是鑄造 id（Grok C7）：tasks.md 中間插一條
  //    任務，底下全部重編，「去檔案裡確認」會讓活著的 change 每次編輯
  //    都把歷史事件打回未治理。錨點驗存在成立的前提（id 鑄了不變）
  //    在 openspec 不存在。
  //
  // 代價：文件裡的佔位字串（`openspec:XXXX/1.1`）會被放行。
  // 選系統性正確，不選軼事級純度。
  return OPENSPEC_SUBJECT_RE.test(subject);
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
 * 事件流 + 該專案 plan 檔裡真實存在的錨點 → 覆蓋率。
 *
 * 事件不保證有序（四類 writer 併發追加、月分片合併），所以基準線用掃描求最小值，
 * 不能假設第一筆就是最早的。
 *
 * `knownAnchors` 是必要參數而不是選填。給它一個「沒有就退回只看形狀」的預設值，
 * 等於把佔位字串冒充錨點的那個 bug 留一條隨時會被走到的後路 —— 而那條路上
 * 不會有任何錯誤訊息，只有一個看起來很漂亮的數字。
 */
export function governanceCoverage(
  events: LogEvent[],
  knownAnchors: ReadonlySet<string>
): GovernanceCoverage {
  let startedIso: string | null = null;
  let startedAt = Infinity;
  for (const e of events) {
    if (!isGoverned(e, knownAnchors)) continue;
    const at = timeOf(e.ts);
    if (at < startedAt) {
      startedAt = at;
      startedIso = e.ts;
    }
  }
  if (startedIso === null) return EMPTY_COVERAGE;

  let governed = 0;
  let ungoverned = 0;
  for (const e of events) {
    // 基準線那一刻之前的事件不計 —— 那時還沒有治理可以被繞過。
    if (timeOf(e.ts) < startedAt) continue;
    if (isGoverned(e, knownAnchors)) governed++;
    else ungoverned++;
  }
  return { startedIso, governed, ungoverned };
}

/**
 * 時間一律**解析後**再比，不比字串。
 *
 * 磁碟上的 log 混著兩種寫法：`2026-08-10T20:16:56+08:00`（git 回填，帶時區）
 * 與 `2026-08-10T15:22:33.599Z`（UTC）。這兩個字串的字典序跟時間順序**相反** ——
 * `"15:…Z" < "19:…+08:00"` 為真，但 15:22Z 其實是 23:22+08:00，比較晚。
 *
 * 字串比較在單一 writer 的年代一直是對的，多一個 writer 的那天才會錯，
 * 而且錯法是「基準線抓到錯的那一筆」，不會有任何錯誤訊息。
 *
 * 讀不出來的時間戳排到最後：壞資料不該把基準線往前拉，把整段歷史算進統計。
 */
function timeOf(ts: string): number {
  const t = Date.parse(ts);
  return Number.isNaN(t) ? Infinity : t;
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
