/**
 * 開發稽核軌跡 —— append-only 事件流。
 *
 * ## 為什麼是磁碟上的 JSONL，不是 localStorage、也不是 SQLite
 *
 * localStorage 有 5–10MB 硬上限，而 agent 是主要開發者：掛上 hook 後每專案每日
 * 300–1000 筆、約 200B/筆，一年 20–70MB。放不下，而且不可 diff、不可稽核、重灌即消失。
 *
 * SQLite 則是解錯題。單人專案的量級（< 10 萬筆）換不到查詢優勢，卻換來
 * 「二進位進 git」和「agent 寫不進去」兩個真痛。**SQLite 的正確位置是可拋棄的
 * 衍生索引**：由 JSONL 重建、進 gitignore、可隨時刪。那樣它是加法不是遷移。
 *
 * ## 兩個致命細節
 *
 * 1. **月分片**。git 每次 commit 存整顆 blob，一個持續長大的單檔每天 commit 一次
 *    會讓 repo 爆炸。`log/YYYY-MM.jsonl` 同時解決 git 膨脹、掃描邊界、保存期限。
 * 2. **機密**。log 若進 git，agent 的 tool call 參數裡會有 API key 與 token，而
 *    append-only 意味著洩漏後連刪都刪不掉，只能 rewrite history。所以 payload 走
 *    **欄位白名單**（不是黑名單，黑名單永遠漏），命令只留 hash 與前綴，路徑一律相對。
 *
 * 純函式、零 I/O。實際寫檔走原生橋的 appendFile。
 */

export const EVENT_SCHEMA_VERSION = 1;

/** 單行上限。超過就截斷 —— 保住 O_APPEND 的原子性（PIPE_BUF 級別的保證）。 */
export const MAX_LINE_BYTES = 4096;

export type ActorKind = "human" | "agent" | "hook" | "ci";

export type EventActor = {
  kind: ActorKind;
  /** 沿用 AgentFamily。人類為 null —— 職務分離規則靠這一欄 */
  family: string | null;
  name: string;
};

export type EventKind =
  | "prd.section.edit"
  | "gate.pass"
  | "gate.fail"
  | "review.submit"
  | "review.approve"
  | "review.withdraw"
  | "task.done"
  | "commit"
  | "release.tag"
  | "agent.job.start"
  | "agent.job.done"
  | "pr.open"
  | "pr.review"
  | "pr.merge"
  | "pr.checks.fail"
  | "decision.record"
  | "file.edit"
  // 實測結果不併進 `task.done`：一題判「失敗」在治理鏈上與「完成」是相反的
  // 事件，共用同一個 kind 會讓任何依 kind 聚合的統計把兩者算成同一件事。
  | "uat.verdict"
  | "uat.report.done"
  // 「把這份報告的結果交給 agent 去修」。與 `uat.report.done`（測完了）分開：
  // 一份報告可以測完卻從來沒被送修，也可以測到一半就先送出前幾題的失敗 ——
  // 兩者共用同一個 kind 會讓「修復迴圈開過幾次」這個問題永遠答不出來。
  | "uat.report.submitted";

export type LogEvent = {
  /** schema_version —— append-only 格式的唯一逃生口 */
  v: number;
  /** 去重鍵。hook 會重複觸發 */
  event_id: string;
  /** ISO-8601 UTC，不存時區 */
  ts: string;
  project: string;
  actor: EventActor;
  /** 一次 agent session */
  run_id?: string;
  parent_run_id?: string | null;
  kind: EventKind;
  /** join key：task id（sf:t=…）／section id／commit hash。整條軌跡靠它串起來 */
  subject: string;
  ref?: string;
  payload?: Record<string, unknown>;
};

/**
 * payload 允許的欄位 —— **白名單，不是黑名單**。
 *
 * 黑名單（「過濾掉叫 token 的欄位」）永遠漏：`authorization`、`x-api-key`、
 * `secret_2`、拼錯的 `tokn`。白名單的失敗模式是「少記了一個欄位」，
 * 黑名單的失敗模式是「不可撤銷地洩漏一把金鑰」。兩者不對等。
 *
 * 要加欄位就改這裡，並在 code review 時當成安全變更看待。
 */
export const PAYLOAD_ALLOW = new Set([
  "title",
  "section",
  "sectionId",
  "from",
  "to",
  "count",
  "pct",
  "stage",
  "reason",
  "decision",
  "version",
  "branch",
  "files",
  "additions",
  "deletions",
  "cmd_hash",
  "cmd_prefix",
  "checks",
  "reviewDecision",
  "durationMs",
  // 實測結果詞（通過／失敗／不測／暫時跳過／未測）。是五選一的固定字彙，
  // 不是使用者輸入 —— **說明欄刻意不進 payload**，那是自由文字，
  // 而稽核軌跡是 append-only：寫進去就刪不掉了。
  "verdict",
  // 交接給哪一種 agent（claude／codex／gemini／other）。四選一的固定字彙，
  // 不是使用者輸入 —— **指令原文與 prompt 刻意不進 payload**：那裡面有
  // 專案絕對路徑與失敗題的自由文字說明，而稽核軌跡是 append-only。
  "family",
]);

/** 命令原文只留前 16 字元 —— 足以認出是哪一類指令，不足以外洩參數。 */
export const CMD_PREFIX_LEN = 16;

/** 非密碼學用途：只是給命令一個穩定代號，用來看「同一個指令跑了幾次」。 */
export function cmdHash(cmd: string): string {
  let h = 2166136261;
  for (let i = 0; i < cmd.length; i++) {
    h ^= cmd.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).padStart(7, "0");
}

/** 命令 → 可安全記錄的兩個欄位。永遠不要把 cmd 原文放進 payload。 */
export function redactCommand(cmd: string): { cmd_hash: string; cmd_prefix: string } {
  return { cmd_hash: cmdHash(cmd), cmd_prefix: cmd.slice(0, CMD_PREFIX_LEN) };
}

/** 絕對路徑 → 相對於專案根。落在根目錄外的一律記成 `<outside>`，不外洩家目錄結構。 */
export function relativizePath(path: string, projectRoot: string): string {
  const root = projectRoot.replace(/\/+$/, "");
  if (!root) return path;
  if (path === root) return ".";
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : "<outside>";
}

/** 套白名單。非白名單欄位直接丟掉，不記錄「有欄位被丟掉」——那本身也是資訊洩漏。 */
export function sanitizePayload(payload: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!payload) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (PAYLOAD_ALLOW.has(k) && v !== undefined) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** 分片檔名。以事件自己的時間分，不是寫入當下——回填舊 commit 才會落到正確的月份。 */
export function shardFor(iso: string): string {
  const d = new Date(iso);
  const t = Number.isNaN(d.getTime()) ? new Date() : d;
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}.jsonl`;
}

/** 事件流在專案內的位置。 */
export const LOG_DIR = ".anchorline/log";
export function shardPath(iso: string): string {
  return `${LOG_DIR}/${shardFor(iso)}`;
}

/**
 * 序列化成一行。**保證單行、保證結尾換行、保證不超過上限。**
 *
 * 超長時砍掉 payload 而不是攔截整筆事件——事件本身（誰在什麼時候做了什麼）
 * 比它的細節重要，為了細節丟掉整筆是本末倒置。
 */
export function serializeEvent(ev: LogEvent): string {
  const clean: LogEvent = { ...ev, payload: sanitizePayload(ev.payload) };
  let line = JSON.stringify(clean);
  if (byteLength(line) + 1 > MAX_LINE_BYTES) {
    line = JSON.stringify({ ...clean, payload: { count: -1 } });
  }
  return `${line}\n`;
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * 解析整份 JSONL。**壞行一律跳過，絕不丟例外。**
 *
 * 最糟的失敗模式是「整份 log 因為一行壞掉而讀不出來」。crash 會留下半行、
 * 併發寫（若哪天 O_APPEND 失守）會交錯，這些都必須是「少一筆」而不是「全毀」。
 * 回傳 `skipped` 讓 UI 有機會說「有 N 行讀不出來」。
 */
export function parseLog(text: string): { events: LogEvent[]; skipped: number } {
  const events: LogEvent[] = [];
  let skipped = 0;
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      const o = JSON.parse(s) as LogEvent;
      if (o && typeof o.ts === "string" && typeof o.kind === "string" && typeof o.event_id === "string") {
        events.push(o);
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }
  }
  return { events, skipped };
}

/** 以 `event_id` 去重。hook 會重複觸發，git 回填也會與既有事件重疊。 */
export function dedupe(events: LogEvent[]): LogEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => (seen.has(e.event_id) ? false : (seen.add(e.event_id), true)));
}

/** 新到舊。時間軸與「今天做了什麼」共用同一個排序，避免兩處各排一次而漂移。 */
export function byNewest(events: LogEvent[]): LogEvent[] {
  return [...events].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
}

/** 掛在同一個 join key 上的所有事件 —— 任務詳情的「證據區」。 */
export function eventsFor(events: LogEvent[], subject: string): LogEvent[] {
  return byNewest(events.filter((e) => e.subject === subject));
}
