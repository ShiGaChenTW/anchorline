/**
 * 計劃 markdown 解析 — 移植自 S.CodingFlow scvb plan-parser 概念
 * Checkbox： [ ] pending · [x]/[v] done · Plan Steps 內 ~~skip~~
 */

export type StepState = "done" | "skipped" | "pending";

export type PlanStep = {
  text: string;
  state: StepState;
  /**
   * 穩定身分。來自 `<!-- anc:t=XXXXXXXX -->` 錨點。
   *
   * **絕對不能從 text 推導。** 用行文字 hash 當 id 的話，改一個錯字就換一個
   * 任務，所有掛在它身上的事件（commit、簽核、PR）當場變孤兒。id 必須是
   * 不透明且鑄造一次就不再變的。
   */
  id?: string;
  /**
   * OpenSpec 方言專用：這一步屬於哪個 `## N. <群組>`。
   * plans/*.md 只有單一 `## Plan Steps`，沒有群組可言，所以留空。
   */
  group?: string;
};

export type PlanMeta = {
  title: string;
  status: string;
  created: string;
  updated: string;
  total_steps: number;
  done_steps: number;
  skipped_steps: number;
  pending_steps: number;
  last_decision: string;
  blockers: number;
  next_step: string;
  steps: PlanStep[];
  goal: string;
  path?: string;
  /** 沒有錨點的步驟數。> 0 時 UI 要顯示警告 —— 這些步驟接不上事件流。 */
  unanchored: number;
  /** 這份是用哪一種方言讀的。UI 要靠它決定顯不顯示「補鑄錨點」那類提示 */
  dialect: PlanDialect;
};

/**
 * 兩種方言。
 *
 * `plan` —— Anchorline 自己的 `plans/*.md`：單一 `## Plan Steps` 區段、
 * 不透明錨點 `<!-- anc:t=… -->`、`**狀態：**` 標籤。
 *
 * `openspec` —— OpenSpec 的 `openspec/changes/<id>/tasks.md`：多個
 * `## N. <群組>` 標題、`N.M` 編號當步驟身分、沒有 H1、沒有狀態標籤。
 * 這是上游工具管的檔案格式，**我們只讀不重寫結構**（勾選只翻那一個方框字元）。
 */
export type PlanDialect = "plan" | "openspec";

export type ParseOpts = {
  dialect?: PlanDialect;
  /** openspec 專用：變更代號（目錄名），沒有 H1 時拿它當標題 */
  change?: string;
};

/**
 * OpenSpec 步驟編號：`1.1`、`2.10`、`3.5.2`，以及**帶字母後綴的 `6.3a`**。
 *
 * 字母後綴是實測補上的：`Project_Border-loom_rust/openspec/changes/prompt-library`
 * 裡就有 `6.3a`，插在 6.3 與 6.4 之間。少了它那一步沒有身分 → 不能勾，
 * 而且文字會多帶一個「6.3a」前綴 —— 兩個症狀都不會報錯，只會看起來怪。
 */
export const OS_STEP_NO_RE = /^(\d+(?:\.\d+)+[a-z]?)\s+(.*)$/;
/** 縮排也要吃：上游常有子項目 */
export const OS_CHECKBOX_RE = /^\s*-\s*\[([ vVxX])\]\s*(.*)$/;

const CHECKBOX_RE = /^- \[([ vVxX])\]\s*(.*)$/;
const STRIKE_BULLET_RE = /^- ~~(.+?)~~/;

/** 新鑄錨點用的前綴。改名 SpecForge → Anchorline 後從 `sf` 換成 `anc`。 */
export const ANCHOR_PREFIX = "anc";

/**
 * 任務錨點。字元集是 Crockford base32（去掉 I / L / O / U，避免手抄時看錯）。
 * 長度放寬到 4–32，讓手寫的短 id 與機器鑄的 8 碼都能過。
 *
 * ponytail: 雙讀 `anc:` 與舊的 `sf:`（SpecForge 時代寫進 plans/*.md 的錨點）。
 * 錨點是 join key，讀不到等於既有事件全變孤兒，而且不會有錯誤訊息。
 * 下一個 minor 版本可以拔掉 `sf`，前提是先確認磁碟上沒有殘留：
 *   rg -c 'sf:t=' plans/*.md
 */
export const ANCHOR_RE = /<!--\s*(?:anc|sf):t=([0-9A-HJKMNP-TV-Z]{4,32})\s*-->/;

/**
 * 同一個錨點，但**不要求 HTML 註解外框**。給 commit 訊息、PR 內文這類
 * 「錨點是寫給人看的」場合用。
 *
 * plan 檔堅持註解形式是因為渲染後不該看到 join key；commit 訊息沒有渲染，
 * 硬要求 `<!-- -->` 只會讓所有人手寫的 `anc:t=XXXX` 全部讀不到 —— 而且
 * 讀不到不會報錯，只會安靜地退回用 commit hash 當 subject。
 */
export const LOOSE_ANCHOR_RE = /(?:^|[^\w-])(?:anc|sf):t=([0-9A-HJKMNP-TV-Z]{4,32})\b/;

/**
 * 從任意文字取出第一個錨點；先找嚴格形式再找寬鬆形式。
 * 兩種都沒有就回 undefined。
 */
export function anchorInText(text: string): string | undefined {
  return text.match(ANCHOR_RE)?.[1] ?? text.match(LOOSE_ANCHOR_RE)?.[1];
}

const ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ID_LEN = 8;

/** 從步驟文字裡取出錨點 id；沒有就回 undefined。 */
export function anchorOf(line: string): string | undefined {
  return line.match(ANCHOR_RE)?.[1];
}

/** 拿掉錨點註解，留下給人看的文字。 */
export function stripAnchor(line: string): string {
  return line.replace(ANCHOR_RE, "").replace(/\s+$/, "");
}

/**
 * 鑄一個新 id。可注入亂數來源，測試才能給定值。
 * ponytail: 8 碼 base32 = 32^8 ≈ 1.1e12，單人專案的碰撞機率可以忽略。
 */
export function mintId(rand: () => number = defaultRand): string {
  let out = "";
  for (let i = 0; i < ID_LEN; i++) {
    out += ID_ALPHABET[Math.floor(rand() * ID_ALPHABET.length)];
  }
  return out;
}

function defaultRand(): number {
  const g = globalThis.crypto;
  if (g?.getRandomValues) {
    const buf = new Uint32Array(1);
    g.getRandomValues(buf);
    return buf[0]! / 2 ** 32;
  }
  return Math.random();
}

/**
 * Lazy 鑄造 —— 給 Plan Steps 區段裡還沒有錨點的 checkbox 補上 id。
 *
 * 刻意**不做**一次性回填腳本：「先跑一個會改 9 個檔的腳本才能開始」是最容易
 * 讓人放棄的形狀。改成第一次讀到才補，代價只是舊 plan 的事件要等第一次開啟
 * 後才接得上。
 *
 * 純函式（除了亂數）：回傳新字串與鑄造筆數，**不寫檔**。要不要落地由呼叫端決定。
 */
export function mintMissingIds(
  text: string,
  rand: () => number = defaultRand
): { text: string; minted: number } {
  if (!text) return { text, minted: 0 };
  const used = new Set<string>();
  for (const m of text.matchAll(new RegExp(ANCHOR_RE.source, "g"))) used.add(m[1]!);

  let minted = 0;
  let inSteps = false;
  const out = text.split(/\r?\n/).map((raw) => {
    const s = raw.trim();
    if (/^##\s+Plan Steps/i.test(s)) {
      inSteps = true;
      return raw;
    }
    if (s.startsWith("## ")) {
      inSteps = false;
      return raw;
    }
    if (!inSteps || !CHECKBOX_RE.test(s) || anchorOf(raw)) return raw;

    let id = mintId(rand);
    while (used.has(id)) id = mintId(rand);
    used.add(id);
    minted++;
    return `${raw.replace(/\s+$/, "")} <!-- ${ANCHOR_PREFIX}:t=${id} -->`;
  });

  return { text: out.join("\n"), minted };
}

/**
 * 狀態詞彙的封閉列舉。呈現端必須「完全比對」這五個詞，不可用子字串——
 * `includes("完成")` 會把「尚未完成」判成完成，圖示跟文字說反話。
 * 對不上就顯示未知：猜錯比說「我不知道」更糟。
 */
export const STATUS_WORDS = ["進行中", "已完成", "已暫停", "已放棄", "阻塞"] as const;
export type StatusWord = (typeof STATUS_WORDS)[number];

export function asStatusWord(s: string): StatusWord | null {
  return (STATUS_WORDS as readonly string[]).includes(s) ? (s as StatusWord) : null;
}

/**
 * OpenSpec 的 `tasks.md`。
 *
 * 跟 `plans/*.md` 三個地方不一樣，所以走自己的一條路而不是塞進同一個迴圈：
 *
 * 1. **沒有 `## Plan Steps` 閘門。** 整份檔就是任務清單，`## N. <群組>` 是分組
 *    標題不是分隔線。硬套原本的閘門會讓每一份都變成 0 步驟 —— 那正是這個功能
 *    原本壞掉的樣子。
 * 2. **身分是 `N.M` 編號，不是鑄出來的錨點。** 這是上游工具管的檔案，往裡面寫
 *    `<!-- anc:t=… -->` 等於我們開始改別人的格式。編號本來就穩定又看得懂。
 * 3. **狀態是算出來的。** 沒有 `**狀態：**` 標籤可讀，全勾完就是已完成。
 *
 * 沒有編號的 checkbox 照樣收，只是沒有 id（不能勾選，UI 會標出來）。
 */
function parseOpenspecTasks(text: string, path: string | undefined, change: string): PlanMeta {
  const out: PlanMeta = {
    title: change || "(未命名變更)",
    status: "進行中",
    created: "—",
    updated: "—",
    total_steps: 0,
    done_steps: 0,
    skipped_steps: 0,
    pending_steps: 0,
    last_decision: "—",
    blockers: 0,
    next_step: "—",
    steps: [],
    goal: "—",
    path,
    unanchored: 0,
    dialect: "openspec",
  };
  if (!text) return out;

  let group = "";
  const groups: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const s = raw.trim();

    if (s.startsWith("# ") && !s.startsWith("## ")) {
      out.title = s.slice(2).trim() || out.title;
      continue;
    }
    if (s.startsWith("## ")) {
      // `## 1. Line separation` → 群組名保留編號，使用者在 tasks.md 裡看到的就是它
      group = s.slice(3).trim();
      if (group) groups.push(group);
      continue;
    }

    const m = s.match(OS_CHECKBOX_RE);
    if (!m) continue;
    const done = /[xXvV]/.test(m[1]!);
    const body = m[2]!.trim();
    const numbered = body.match(OS_STEP_NO_RE);
    const step: PlanStep = {
      text: numbered ? numbered[2]!.trim() : body,
      state: done ? "done" : "pending",
    };
    if (numbered) step.id = numbered[1]!;
    if (group) step.group = group;
    out.steps.push(step);
  }

  out.total_steps = out.steps.length;
  out.done_steps = out.steps.filter((x) => x.state === "done").length;
  out.pending_steps = out.steps.filter((x) => x.state === "pending").length;
  out.unanchored = out.steps.filter((x) => !x.id).length;
  const next = out.steps.find((x) => x.state === "pending");
  out.next_step = next?.text ?? "—";
  // 狀態沒有地方可讀，只能從勾選推。全空也算「進行中」——「未開始」不是
  // OpenSpec 的狀態詞，而且對還沒動的變更說「已暫停」是在說謊。
  if (out.total_steps > 0 && out.pending_steps === 0) out.status = "已完成";
  if (groups.length) out.goal = groups.join("、").slice(0, 280);

  return out;
}

export function parsePlanMeta(text: string, path?: string, opts: ParseOpts = {}): PlanMeta {
  if (opts.dialect === "openspec") return parseOpenspecTasks(text, path, opts.change ?? "");
  const out: PlanMeta = {
    title: "(無標題)",
    status: "未知",
    created: "—",
    updated: "—",
    total_steps: 0,
    done_steps: 0,
    skipped_steps: 0,
    pending_steps: 0,
    last_decision: "—",
    blockers: 0,
    next_step: "—",
    steps: [],
    goal: "—",
    path,
    unanchored: 0,
    dialect: "plan",
  };
  if (!text) return out;

  const lines = text.split(/\r?\n/);
  let inSteps = false;
  let inGoal = false;
  let inBlockers = false;
  let inDecisions = false;
  const goalParts: string[] = [];

  for (const raw of lines) {
    const s = raw.trim();

    if (s.startsWith("# ") && out.title === "(無標題)") {
      out.title = s.slice(2).trim();
      continue;
    }
    if (s.startsWith("**建立時間：**") || s.startsWith("**建立時間:**")) {
      out.created = s.replace(/\*\*建立時間：?\*\*/, "").trim();
      continue;
    }
    if (s.startsWith("**最後更新：**") || s.startsWith("**最後更新:**")) {
      out.updated = s.replace(/\*\*最後更新：?\*\*/, "").trim();
      continue;
    }
    if (s.startsWith("**狀態：**") || s.startsWith("**狀態:**")) {
      const st = s.replace(/\*\*狀態：?\*\*/, "").trim();
      const hit = STATUS_WORDS.find((w) => st.startsWith(w));
      out.status = hit ?? (st.split(/[（(]/)[0]?.trim() || st);
      continue;
    }

    if (/^##\s+Plan Steps/i.test(s) || s === "## Plan Steps") {
      inSteps = true;
      inGoal = false;
      inBlockers = false;
      inDecisions = false;
      continue;
    }
    if (/^##\s+目標/.test(s)) {
      inGoal = true;
      inSteps = false;
      inBlockers = false;
      inDecisions = false;
      continue;
    }
    if (/^##\s+阻塞/.test(s)) {
      inBlockers = true;
      inSteps = false;
      inGoal = false;
      inDecisions = false;
      continue;
    }
    if (/^##\s+決策/.test(s)) {
      inDecisions = true;
      inSteps = false;
      inGoal = false;
      inBlockers = false;
      continue;
    }
    if (s.startsWith("## ")) {
      inSteps = false;
      inGoal = false;
      inBlockers = false;
      inDecisions = false;
      continue;
    }

    if (inSteps) {
      const m = s.match(CHECKBOX_RE);
      if (m) {
        const mark = m[1]!;
        const rawStep = m[2]!;
        const id = anchorOf(rawStep);
        const textStep = stripAnchor(rawStep).trim();
        const done = mark === "x" || mark === "X" || mark === "v" || mark === "V";
        const state: StepState = done ? "done" : "pending";
        out.steps.push(id ? { text: textStep, state, id } : { text: textStep, state });
        continue;
      }
      const sk = s.match(STRIKE_BULLET_RE);
      if (sk) {
        // 放棄的步驟不算 unanchored —— 它不會再產生任何事件，補 id 沒有意義
        out.steps.push({ text: stripAnchor(sk[1]!).trim(), state: "skipped" });
        continue;
      }
      if (s.startsWith("- ~~")) {
        out.steps.push({
          text: stripAnchor(s.replace(/^- ~~/, "").replace(/~~$/, "")).trim(),
          state: "skipped",
        });
      }
      continue;
    }

    if (inGoal && s && !s.startsWith("<!--")) {
      goalParts.push(s);
    }
    if (inBlockers) {
      if (s.startsWith("- ") && !/^-\s*無\s*$/.test(s)) out.blockers += 1;
    }
    if (inDecisions && s.startsWith("- ")) {
      out.last_decision = s.replace(/^- /, "").trim();
    }
  }

  if (goalParts.length) out.goal = goalParts.join(" ").slice(0, 280);

  out.total_steps = out.steps.length;
  out.done_steps = out.steps.filter((x) => x.state === "done").length;
  out.skipped_steps = out.steps.filter((x) => x.state === "skipped").length;
  out.pending_steps = out.steps.filter((x) => x.state === "pending").length;
  // 只算還活著的步驟：skipped 不會再產生事件，沒有 id 也無所謂
  out.unanchored = out.steps.filter((x) => x.state !== "skipped" && !x.id).length;
  const next = out.steps.find((x) => x.state === "pending");
  out.next_step = next?.text ?? "—";

  return out;
}

/**
 * 進度的單一真相：百分比與它的分子必須出自同一個地方。
 *
 * 分子是「已結」= done + skipped，不是 done——skipped 不會再產生事件，跟 done
 * 一樣是關掉的。但呈現端過去只印 done/total，於是出現 `100% … 21/28`：
 * 圖示跟數字說反話。回傳 closed 就是為了讓呈現端沒有第二種寫法可選。
 */
export function planProgress(meta: PlanMeta): { closed: number; total: number; pct: number } {
  const total = meta.total_steps;
  const closed = meta.done_steps + meta.skipped_steps;
  return { closed, total, pct: total ? Math.round((closed / total) * 100) : 0 };
}

export function planProgressPct(meta: PlanMeta): number {
  return planProgress(meta).pct;
}

/** 瀏覽器：從 Vite 無法直接讀 disk plans/；改由頁面 fetch 或預嵌列表 */
export const FLOW_LAYERS = [
  { id: "l1", code: "L1", name: "意圖" },
  { id: "l2", code: "L2", name: "規格" },
  { id: "l3", code: "L3", name: "計劃" },
  { id: "l4", code: "L4", name: "實作" },
  { id: "l5", code: "L5", name: "驗證" },
  { id: "l6", code: "L6", name: "交付" },
] as const;
