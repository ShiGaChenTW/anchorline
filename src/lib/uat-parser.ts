/**
 * UAT 實測報告方言 — 解析、寫回、序列化。
 *
 * ## 為什麼是第三種方言而不是塞進 plan
 *
 * plan 的 checkbox 只有兩態（勾／不勾），UAT 一題有五態（未測／通過／失敗／
 * 不測／暫時跳過）外加一格說明。硬塞 checkbox 等於把四種結果都寫成「勾了」，
 * 而「失敗」跟「通過」在治理鏈上是相反的事件。所以 UAT 用自己的區段結構：
 * 一題一個 `## ` 區段，帶 `anc:t=` 錨點當身分，狀態寫在 `**結果：**` 行。
 *
 * ## 檔內寫中文詞，程式用 en token
 *
 * 檔案是使用者會用 git diff 讀的東西，`**結果：** 通過` 比 `pass` 誠實好讀。
 * 解析時中文與 en token 都收（agent 手寫容易混用）；**未知詞一律退回「未測」**——
 * 把看不懂的結果當成「還沒測」會讓題目重新出現，把它猜成任何已測狀態
 * 則會讓一題安靜地消失。往安全的方向退。
 *
 * 寫回沿用 plan-writer 的哲學：只動目標題的 結果／說明 行，其餘一字不改，
 * 併發守衛交給呼叫端的 guardOf + safeApply。
 *
 * 純函式、零 I/O。
 */

import { ANCHOR_PREFIX, anchorOf, mintId, stripAnchor } from "./plan-parser";

export type UatVerdict = "pending" | "pass" | "fail" | "wont" | "later";

export const UAT_VERDICTS: readonly UatVerdict[] = [
  "pending",
  "pass",
  "fail",
  "wont",
  "later",
];

/** 檔內寫的詞。順序無意義，對照表才是真相。 */
export const VERDICT_LABELS: Record<UatVerdict, string> = {
  pending: "未測",
  pass: "通過",
  fail: "失敗",
  wont: "不測",
  later: "暫時跳過",
};

/**
 * 這些結果**必須附說明**。規則來自需求原文：除了「通過」和「暫時跳過」，
 * 其他選項都要寫原因 —— pending 是初始態不算選項，所以清單就是 fail、wont。
 */
export const VERDICT_NEEDS_NOTE: ReadonlySet<UatVerdict> = new Set([
  "fail",
  "wont",
]);

export type UatItem = {
  /** `anc:t=` 錨點。沒有的題不能勾（UI 要標出來），跟 plan 步驟同一條規矩 */
  id?: string;
  /** 區段標題（含 T1 之類的編號前綴，去掉錨點註解） */
  title: string;
  /** 流程步驟，已去掉行首編號 */
  steps: string[];
  /** 預期效果，可多行 */
  expected: string;
  verdict: UatVerdict;
  /** 說明。檔內的佔位「（無）」讀出來是空字串 */
  note: string;
};

export type UatReport = {
  title: string;
  created: string;
  updated: string;
  /** 沿用 plan 的狀態詞彙子集：全題已測 = 已完成，否則進行中 */
  status: "進行中" | "已完成";
  items: UatItem[];
  path?: string;
  /** 沒錨點的題數。> 0 時 UI 要警告 —— 這些題勾不了 */
  unanchored: number;
  /**
   * 檔頭脈絡：H1 與第一題之間、三行已知 meta 以外的**全部**內容（原樣，
   * 含 blockquote 記號）。目的/環境/已通過免測/測試編號這類欄位都住在這裡 ——
   * 它們是自由生長的（實測第一天就長出「測試次數」這種自創欄位），
   * 逐欄 schema 會永遠追著加，原樣保存＋原樣呈現才是穩定的合約。
   * setVerdict 只動題目區段與 狀態/最後更新 行，檔頭天然不會被寫回破壞。
   */
  preamble: string;
};

/** CLI／skill 端的出題規格。序列化前先過 validateUatSpec。 */
export type UatSpecItem = { title: string; steps: string[]; expected: string };
export type UatSpec = {
  title: string;
  items: UatSpecItem[];
  /** 檔頭脈絡自由文字（目的/環境/免測/編號…），序列化成 blockquote */
  context?: string;
};

const H1_RE = /^#\s+UAT[:：]\s*(.*)$/;
const SECTION_RE = /^##\s+/;
const LABEL_RE = /^\*\*(流程|預期|結果|說明)[：:]\*\*\s*(.*)$/;
const EMPTY_NOTE = "（無）";

/** 判斷一份 markdown 是不是 UAT 報告。tracking 頁靠它選 parser。 */
export function isUatText(text: string): boolean {
  for (const raw of text.split(/\r?\n/)) {
    const s = raw.trim();
    if (!s) continue;
    return H1_RE.test(s);
  }
  return false;
}

function parseVerdict(raw: string): UatVerdict {
  // 取第一個 token：容忍「通過（2026-08-14）」這類尾註
  const head = raw.trim().split(/[\s（(]/)[0] ?? "";
  for (const v of UAT_VERDICTS) {
    if (head === v || head === VERDICT_LABELS[v]) return v;
  }
  return "pending";
}

export function parseUatReport(text: string, path?: string): UatReport {
  const out: UatReport = {
    title: "(無標題)",
    created: "—",
    updated: "—",
    status: "進行中",
    items: [],
    path,
    unanchored: 0,
    preamble: "",
  };
  if (!text) return out;

  const lines = text.split(/\r?\n/);
  let cur: UatItem | null = null;
  /** 目前在哪個標籤區塊裡收內容 */
  let field: "steps" | "expected" | "note" | null = null;
  /** 圍欄程式碼中：`##` 與 `**結果：**` 是內容不是結構（Cato F5） */
  let inFence = false;
  /** 同一題裡每種標籤只認第一次 —— 說明裡貼了長得像標籤的行是內容（Cato F2） */
  let seenLabels = new Set<string>();
  const noteBuf: string[] = [];
  const expectedBuf: string[] = [];

  const flushItem = () => {
    if (!cur) return;
    cur.expected = expectedBuf.join("\n").trim();
    const note = noteBuf.join("\n").trim();
    cur.note = note === EMPTY_NOTE ? "" : note;
    out.items.push(cur);
    cur = null;
    noteBuf.length = 0;
    expectedBuf.length = 0;
  };

  const pushStep = (raw: string) => {
    const s = raw.trim();
    if (!s) return;
    cur?.steps.push(s.replace(/^\d+[.)]\s*/, "").replace(/^-\s+/, ""));
  };

  const preambleBuf: string[] = [];

  /** 把一行當「目前欄位的內容」收下。第一題出現前的內容屬於檔頭脈絡。 */
  const routeContent = (raw: string) => {
    if (!cur) preambleBuf.push(raw);
    else if (field === "steps") pushStep(raw);
    else if (field === "expected") expectedBuf.push(raw);
    else if (field === "note") noteBuf.push(raw);
  };

  for (const raw of lines) {
    const s = raw.trim();

    if (/^(```|~~~)/.test(s)) {
      inFence = !inFence;
      routeContent(raw);
      continue;
    }
    if (inFence) {
      routeContent(raw);
      continue;
    }

    const h1 = s.match(H1_RE);
    if (h1 && out.title === "(無標題)") {
      out.title = h1[1]!.trim() || out.title;
      continue;
    }
    if (s.startsWith("**建立時間：**") || s.startsWith("**建立時間:**")) {
      out.created = s.replace(/\*\*建立時間[：:]\*\*/, "").trim();
      continue;
    }
    if (s.startsWith("**最後更新：**") || s.startsWith("**最後更新:**")) {
      out.updated = s.replace(/\*\*最後更新[：:]\*\*/, "").trim();
      continue;
    }
    if (s.startsWith("**狀態：**") || s.startsWith("**狀態:**")) {
      continue;
    }

    if (SECTION_RE.test(s)) {
      flushItem();
      field = null;
      seenLabels = new Set();
      const id = anchorOf(raw);
      const title = stripAnchor(s.replace(SECTION_RE, "")).trim();
      cur = { title, steps: [], expected: "", verdict: "pending", note: "" };
      if (id) cur.id = id;
      continue;
    }
    if (!cur) {
      preambleBuf.push(raw);
      continue;
    }

    const label = s.match(LABEL_RE);
    if (label && !seenLabels.has(label[1]!)) {
      seenLabels.add(label[1]!);
      const kind = label[1]!;
      const inline = label[2] ?? "";
      if (kind === "結果") {
        cur.verdict = parseVerdict(inline);
        field = null;
      } else if (kind === "流程") {
        field = "steps";
        pushStep(inline);
      } else if (kind === "預期") {
        field = "expected";
        if (inline.trim()) expectedBuf.push(inline);
      } else {
        field = "note";
        if (inline.trim()) noteBuf.push(inline);
      }
      continue;
    }

    routeContent(raw);
  }
  flushItem();
  out.preamble = preambleBuf.join("\n").trim();

  out.unanchored = out.items.filter((x) => !x.id).length;
  // 手改出來的「失敗／不測但沒說明」不算已測 —— 必填規則在寫入端執法，
  // 但完成判定不能替繞過寫入端的檔案背書（Cato F3）
  const allTested =
    out.items.length > 0 &&
    out.items.every(
      (x) =>
        x.verdict !== "pending" &&
        !(VERDICT_NEEDS_NOTE.has(x.verdict) && !x.note),
    );
  out.status = allTested ? "已完成" : "進行中";
  return out;
}

/**
 * 進度的單一真相，跟 planProgress 同一條規矩：分子與百分比出自同一個地方。
 * 「已結」= 任何非未測的結果 —— 不測、暫時跳過都是「這一輪處理過了」。
 */
export function uatProgress(r: UatReport): {
  closed: number;
  total: number;
  pct: number;
} {
  const total = r.items.length;
  const closed = r.items.filter((x) => x.verdict !== "pending").length;
  return { closed, total, pct: total ? Math.round((closed / total) * 100) : 0 };
}

/**
 * 勾一題。**只動那一題的 結果／說明，其餘位元組不變**（狀態與最後更新兩行除外，
 * 那兩行本來就是這次動作的一部分）。
 *
 * 必填規則在這裡執法而不是只在 UI：UI 可以先擋給出比較好的體驗，
 * 但守門的是這個函式 —— 繞過 UI 的呼叫端（未來的 CLI 回填）也得遵守。
 */
export function setVerdict(
  text: string,
  id: string,
  verdict: UatVerdict,
  note: string,
  opts: { now?: string } = {},
): { ok: true; text: string } | { ok: false; reason: string } {
  if (VERDICT_NEEDS_NOTE.has(verdict) && !note.trim()) {
    return {
      ok: false,
      reason: `「${VERDICT_LABELS[verdict]}」必須在說明欄寫上原因`,
    };
  }

  const hadTrailingNewline = text.endsWith("\n");
  const lines = text.split("\n");
  // 區段邊界要跟 parser 同一套視角：圍欄裡的 `##` 是內容不是新題（Cato F5）
  let inFence = false;
  let si = -1;
  let ei = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (/^(```|~~~)/.test(t)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !SECTION_RE.test(t)) continue;
    if (si < 0) {
      if (anchorOf(lines[i]!) === id) si = i;
    } else {
      ei = i;
      break;
    }
  }
  if (si < 0) return { ok: false, reason: `找不到這一題（anc:t=${id}）` };

  // 每種標籤只認第一次出現 —— 說明裡長得像 `**結果：**` 的行是內容，
  // 認最後一次的話它會被當成結果行改寫掉（Cato F2）
  const firstAt = new Map<string, number>();
  inFence = false;
  for (let i = si + 1; i < ei; i++) {
    const t = lines[i]!.trim();
    if (/^(```|~~~)/.test(t)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = t.match(LABEL_RE);
    if (m && !firstAt.has(m[1]!)) firstAt.set(m[1]!, i);
  }
  // 結果行：有就替換，沒有（手寫檔漏了）就插在區段尾
  let resultAt = firstAt.get("結果") ?? -1;
  const noteLabelAt = firstAt.get("說明") ?? -1;
  const resultLine = `**結果：** ${VERDICT_LABELS[verdict]}`;
  if (resultAt >= 0) {
    lines[resultAt] = resultLine;
  } else {
    lines.splice(ei, 0, "", resultLine);
    ei += 2;
  }

  // 說明區塊：從標籤行到「下一個首次出現的標籤」或區段尾。整塊換掉 ——
  // 舊說明裡的假標籤行不在 firstAt 裡，所以會連同舊說明一起被換掉，
  // 不會殘留在新說明後面。尾端補一個空行當區段分隔。
  const noteLines = note.trim() ? note.trim().split("\n") : [EMPTY_NOTE];
  if (noteLabelAt >= 0) {
    let blockEnd = ei;
    for (const at of firstAt.values()) {
      if (at > noteLabelAt && at < blockEnd) blockEnd = at;
    }
    const tail = blockEnd < lines.length ? [""] : [];
    lines.splice(noteLabelAt + 1, blockEnd - (noteLabelAt + 1), ...noteLines, ...tail);
  } else {
    lines.splice(ei, 0, "", "**說明：**", ...noteLines);
  }

  let next = lines.join("\n");

  // 報告層級狀態：重讀一次算，不要在上面的迴圈裡邊改邊猜
  const parsed = parseUatReport(next);
  const statusWord = parsed.status;
  next = next.replace(
    /^\*\*狀態[：:]\*\*.*$/m,
    `**狀態：** ${statusWord}`,
  );
  if (opts.now) {
    next = next.replace(
      /^\*\*最後更新[：:]\*\*.*$/m,
      `**最後更新：** ${opts.now}`,
    );
  }
  if (hadTrailingNewline && !next.endsWith("\n")) next += "\n";
  return { ok: true, text: next };
}

/**
 * 出題規格 → 檔案內容。錨點在這裡鑄，一題一個，鑄完就不再變。
 * `mint` 可注入，測試才能給定值。
 */
export function serializeUatReport(
  spec: UatSpec,
  opts: { now?: string; mint?: () => string } = {},
): string {
  const now = opts.now ?? "";
  const used = new Set<string>();
  const nextId = () => {
    let id = (opts.mint ?? mintId)();
    while (used.has(id)) id = (opts.mint ?? mintId)();
    used.add(id);
    return id;
  };

  const out: string[] = [
    `# UAT: ${spec.title.trim()}`,
    "",
    `**建立時間：** ${now}`,
    `**最後更新：** ${now}`,
    `**狀態：** 進行中`,
    "",
  ];
  // 檔頭脈絡（目的/環境/免測/編號…）序列化成 blockquote。空行也要帶 `>`，
  // 不然 markdown 會把一段 quote 切成兩段。
  const ctx = spec.context?.trim();
  if (ctx) {
    out.push(...ctx.split("\n").map((l) => (l.trim() ? `> ${l}` : ">")), "");
  }
  out.push(
    `> 在 Anchorline 的 Task Tracking 開這一份逐題勾選。「失敗」與「不測」必須填說明。`,
    "",
  );

  spec.items.forEach((item, i) => {
    out.push(
      `## T${i + 1} ${item.title.trim()} <!-- ${ANCHOR_PREFIX}:t=${nextId()} -->`,
      "",
      "**流程：**",
      ...item.steps.map((s, j) => `${j + 1}. ${s.replace(/\s*\n\s*/g, " ").trim()}`),
      "",
      "**預期：**",
      item.expected.trim(),
      "",
      "**結果：** 未測",
      "",
      "**說明：**",
      EMPTY_NOTE,
      "",
    );
  });

  return out.join("\n");
}

/**
 * 出題規格驗證。**一次回報全部錯誤**，不是遇到第一個就停 ——
 * agent 拿到完整清單一輪就能改完，擠牙膏式報錯要來回好幾輪。
 */
export function validateUatSpec(
  v: unknown,
): { ok: true; spec: UatSpec } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const o = v as Partial<UatSpec> | null;
  if (!o || typeof o !== "object") {
    return { ok: false, errors: ["spec 必須是 JSON 物件"] };
  }
  if (typeof o.title !== "string" || !o.title.trim()) {
    errors.push("title：必填，一句話的報告標題");
  }
  if (o.context !== undefined && typeof o.context !== "string") {
    errors.push("context：選填，但給了就必須是字串（檔頭脈絡自由文字）");
  }
  if (!Array.isArray(o.items) || o.items.length === 0) {
    errors.push("items：至少要有一題");
  } else {
    o.items.forEach((it, i) => {
      const at = `items[${i}]`;
      if (!it || typeof it !== "object") {
        errors.push(`${at}：必須是物件`);
        return;
      }
      if (typeof it.title !== "string" || !it.title.trim()) {
        errors.push(`${at}.title：必填`);
      }
      if (
        !Array.isArray(it.steps) ||
        it.steps.length === 0 ||
        it.steps.some((s) => typeof s !== "string" || !s.trim())
      ) {
        errors.push(`${at}.steps：至少一步，且每一步都要有內容 —— 流程要詳細到照著做就能重現`);
      }
      if (typeof it.expected !== "string" || !it.expected.trim()) {
        errors.push(`${at}.expected：必填 —— 預期效果要具體到可以判定通過或失敗`);
      }
    });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, spec: o as UatSpec };
}
