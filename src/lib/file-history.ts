/**
 * 檔案修改的前後對比與快照。
 *
 * 三件事：
 * 1. **行級 diff** —— 存檔前把改過的行標出來（畫面上用橘色）。
 * 2. **前後對比** —— 每一行改動都留著「改之前長什麼樣」，滑過去就看得到。
 * 3. **快照** —— 每次存檔前先把磁碟上的舊內容存一份，之後可以還原。
 *
 * 純函式 + localStorage，零 I/O 依賴，方便直接測。
 *
 * 為什麼用行級而不是字元級：spec.md 是一行一句的結構化文字，改動幾乎都是
 * 整行替換。字元級 diff 會把「The system SHALL」跟「The system MUST」拆成
 * 一堆碎片，畫面上反而看不出改了什麼。
 */

export type LineChange = "same" | "added" | "modified" | "removed";

export type LineMark = {
  /**
   * 在「改之後」文字裡的行號，0-based。
   *
   * `removed` 沒有對應的「改之後」行 —— 它用**接在哪一行之前**來定位，
   * 也就是原本那一行被刪掉後，游標會落在的位置。所以同一個 index 可能
   * 同時有一個 removed 與一個 added／modified，呼叫端要能處理。
   */
  index: number;
  kind: LineChange;
  /** modified 是被取代掉的那一行；removed 是被刪掉的整行；added 為 null */
  before: string | null;
};

/** 最長共同子序列（以行為單位）。回傳成對的 (a索引, b索引)。 */
function lcsPairs(a: readonly string[], b: readonly string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  // n·m 的表格。spec.md 這種幾百行的檔案綽綽有餘；
  // ponytail: 沒有做 Myers diff，檔案大到會卡之前不需要。
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return out;
}

/**
 * 標出「改之後」的每一行是沒動、新增、還是取代了某一行。
 *
 * 只回傳有變動的行 —— 沒動的行佔絕大多數，全部回傳只是讓呼叫端再濾一次。
 */
export function markChangedLines(before: string, after: string): LineMark[] {
  if (before === after) return [];
  const a = before.split("\n");
  const b = after.split("\n");
  const pairs = lcsPairs(a, b);

  const matchedB = new Set(pairs.map(([, j]) => j));
  const out: LineMark[] = [];

  // 把兩邊「沒對上的行」依區段配對：同一區段內第 k 行對第 k 行算 modified，
  // 多出來的算 added。這樣「改了一行字」會顯示成取代而不是一刪一增。
  let pi = 0;
  let ai = 0;
  let bi = 0;
  const segments: [number, number, number, number][] = []; // aStart,aEnd,bStart,bEnd
  while (pi <= pairs.length) {
    const [pa, pb] = pi < pairs.length ? pairs[pi] : [a.length, b.length];
    if (pa > ai || pb > bi) segments.push([ai, pa, bi, pb]);
    ai = pa + 1;
    bi = pb + 1;
    pi++;
  }

  for (const [aS, aE, bS, bE] of segments) {
    const aCount = aE - aS;
    const bCount = bE - bS;
    for (let k = 0; k < bCount; k++) {
      const index = bS + k;
      if (matchedB.has(index)) continue;
      out.push(
        k < aCount
          ? { index, kind: "modified", before: a[aS + k] }
          : { index, kind: "added", before: null },
      );
    }
    // 「改之前」多出來的那幾行 = 被整行刪掉。
    //
    // 原本這裡什麼都不做，於是整行刪除產生零個 mark：對比欄看不到、
    // 狀態列的「N 行未儲存」不算它、紅字刪除線更無從畫起 —— 刪掉一整段
    // 在畫面上完全沒有痕跡。行內改字之所以看得到刪除，是因為那條路徑走的是
    // inlineDiff；整行刪除根本走不到那裡。
    for (let k = bCount; k < aCount; k++) {
      out.push({ index: bE, kind: "removed", before: a[aS + k] });
    }
  }

  // removed 沒有自己的「改之後」行，同一個 index 上要排在其他種類之前 ——
  // 讀起來才是「這裡原本有這幾行，被換成了下面這些」。
  const rank = (k: LineChange) => (k === "removed" ? 0 : 1);
  return out.sort((x, y) => x.index - y.index || rank(x.kind) - rank(y.kind));
}

/** 有幾行動過 —— 給狀態列顯示 */
export function changedLineCount(before: string, after: string): number {
  return markChangedLines(before, after).length;
}

// ── 快照 ────────────────────────────────────────────────────────

export type Snapshot = {
  /** ISO 時間 */
  at: string;
  /** 誰存的 */
  author: string;
  /** 存檔**之前**磁碟上的內容 —— 還原就是把它寫回去 */
  text: string;
  /** 這次存檔改了幾行 */
  changed: number;
};

const KEY_PREFIX = "anchorline:file-history:";
/** 每個檔最多留幾份。留太多沒人看，還會把 localStorage 撐爆。 */
export const MAX_SNAPSHOTS = 20;

function keyFor(path: string): string {
  return `${KEY_PREFIX}${path}`;
}

export function loadSnapshots(path: string): Snapshot[] {
  try {
    const raw = localStorage.getItem(keyFor(path));
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as Snapshot[]) : [];
  } catch {
    return [];
  }
}

/** 新的排前面，超過上限就丟最舊的 */
export function pushSnapshot(path: string, snap: Snapshot): Snapshot[] {
  const next = [snap, ...loadSnapshots(path)].slice(0, MAX_SNAPSHOTS);
  try {
    localStorage.setItem(keyFor(path), JSON.stringify(next));
  } catch {
    /* 容量滿了就算了 —— 快照掉了比存檔失敗好 */
  }
  return next;
}

export function clearSnapshots(path: string) {
  try {
    localStorage.removeItem(keyFor(path));
  } catch {
    /* private mode */
  }
}

/** 「3 分鐘前」這種相對時間，絕對時間留給 title */
export function relativeTime(iso: string, now = new Date()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const sec = Math.max(0, Math.round((now.getTime() - t) / 1000));
  if (sec < 60) return "剛剛";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} 分鐘前`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} 小時前`;
  return `${Math.round(hr / 24)} 天前`;
}

// ── 行內字級 diff ────────────────────────────────────────────────

export type SegKind = "same" | "add" | "del";
export type Seg = { text: string; kind: SegKind };

/**
 * 切成 diff 的單位：連續的英數視為一個字，CJK 與符號各自一個。
 * 純字元 diff 會把 "SHALL" → "MUST" 拆成一堆單字母碎片，看不出改了什麼詞。
 */
export function tokenize(s: string): string[] {
  return s.match(/[A-Za-z0-9_]+|\s+|[\s\S]/g) ?? [];
}

/**
 * 行內字級 diff。回傳依「改之後」順序排的片段，被刪掉的片段插在原本的位置。
 *
 * 呼叫端在編輯畫面只能畫 same + add —— 那兩者串起來剛好等於現在的文字，
 * 疊在 textarea 上才不會錯位。del 只能在唯讀的檢視模式或浮層裡顯示。
 */
export function inlineDiff(before: string, after: string): Seg[] {
  const a = tokenize(before);
  const b = tokenize(after);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: Seg[] = [];
  const push = (text: string, kind: SegKind) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ text, kind });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push(a[i], "same");
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push(a[i], "del");
      i++;
    } else {
      push(b[j], "add");
      j++;
    }
  }
  while (i < n) push(a[i++], "del");
  while (j < m) push(b[j++], "add");
  return out;
}

/** 編輯畫面用：只留 same + add，串起來等於現在的文字 */
export function visibleSegs(segs: readonly Seg[]): Seg[] {
  return segs.filter((s) => s.kind !== "del");
}
