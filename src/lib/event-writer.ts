/**
 * 稽核軌跡的三類 writer。
 *
 * | Writer | 誰觸發 | 怎麼寫 |
 * |---|---|---|
 * | A · App 內動作 | 送審／核准／抽單／取號／gate 通過 | 本檔 `logEvent()` → bridge appendFile |
 * | B · Claude Code hook | agent 每次編輯 | 一行 shell，App 只負責**偵測有沒有裝**與提供指令 |
 * | C · git 回填 | 首次啟用 | 讀 `GitStats.commits` 轉成事件，靠 event_id 冪等 |
 *
 * Writer B 刻意不由 App 安裝。改使用者的 `~/.claude/settings.json` 是動他的全域設定，
 * 而且前一代寫入端（`launch_tui.ts`）正是因為「順便多做一件事」把系統搞垮的。
 * App 只給一行可複製的指令，按不按在他。
 */
import {
  EVENT_SCHEMA_VERSION,
  serializeEvent,
  shardPath,
  type EventActor,
  type EventKind,
  type LogEvent,
} from "./event-log";
import { isNative, native } from "./native";

export function canWriteLog(): boolean {
  return isNative();
}

/** 不透明 id。與 plan 錨點同一套字元集，理由相同：不從內容推導。 */
export function newEventId(rand: () => number = defaultRand): string {
  const A = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let s = "";
  for (let i = 0; i < 14; i++) s += A[Math.floor(rand() * A.length)];
  return s;
}

function defaultRand(): number {
  const g = globalThis.crypto;
  if (g?.getRandomValues) {
    const b = new Uint32Array(1);
    g.getRandomValues(b);
    return b[0]! / 2 ** 32;
  }
  return Math.random();
}

export type NewEvent = {
  project: string;
  actor: EventActor;
  kind: EventKind;
  subject: string;
  ref?: string;
  payload?: Record<string, unknown>;
  /** 覆寫時間戳。git 回填要用 commit 的時間，不是現在 */
  ts?: string;
  runId?: string;
};

export function buildEvent(e: NewEvent, id = newEventId()): LogEvent {
  return {
    v: EVENT_SCHEMA_VERSION,
    event_id: id,
    ts: e.ts ?? new Date().toISOString(),
    project: e.project,
    actor: e.actor,
    ...(e.runId ? { run_id: e.runId } : {}),
    kind: e.kind,
    subject: e.subject,
    ...(e.ref ? { ref: e.ref } : {}),
    ...(e.payload ? { payload: e.payload } : {}),
  };
}

/**
 * Writer A —— 寫一筆事件。
 *
 * **失敗不擋使用者的動作。** 核准就是核准，log 寫不進去是 log 的問題；
 * 讓稽核軌跡去否決業務動作，會讓人第一次遇到就把整個功能關掉。
 * 回傳 boolean 讓呼叫端有機會提示，但不要 throw。
 */
export function logEvent(projectRoot: string, e: NewEvent): boolean {
  if (!canWriteLog() || !projectRoot) return false;
  const ev = buildEvent(e);
  const path = `${projectRoot.replace(/\/+$/, "")}/${shardPath(ev.ts)}`;
  // 失敗不擋業務動作，也不等它完成 —— 稽核寫入不該讓核准變慢
  void native.appendFile(path, serializeEvent(ev).trimEnd()).catch(() => {});
  return true;
}

// ── Writer C：git 回填 ──────────────────────────────────────────

type GitCommit = { hash: string; subject: string; at: string; author: string; refs: string };

/**
 * commit → 事件。**`event_id` 直接用 commit hash**，所以重跑幾次都只會有一筆。
 *
 * 這一步順帶解掉 `GitStats.commits` 的 40 筆上限：那個上限是「每次量測抓多少」，
 * 回填之後歷史留在 log 裡，不再受單次查詢的視窗限制。
 */
export function commitsToEvents(
  commits: GitCommit[],
  project: string,
  remoteUrl?: string
): LogEvent[] {
  return commits.map((c) =>
    buildEvent(
      {
        project,
        // git 的 author 是字串，分不出人或 agent。誠實記成 human，不要猜族系——
        // 猜錯的族系會讓職務分離規則誤判，那比沒有資訊更糟。
        actor: { kind: "human", family: null, name: c.author || "unknown" },
        kind: "commit",
        subject: c.hash,
        ts: c.at,
        ...(remoteUrl ? { ref: commitUrl(remoteUrl, c.hash) } : {}),
        payload: { title: c.subject },
      },
      c.hash
    )
  );
}

/** git remote → 網頁 commit 連結。認不得的 remote 就不給連結，不要瞎拼。 */
export function commitUrl(remote: string, hash: string): string | undefined {
  const m = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
  return m ? `https://github.com/${m[1]}/commit/${hash}` : undefined;
}

// ── PR 事件（§十一 L2）──────────────────────────────────────────

type PrLike = {
  repo: string;
  number: number;
  title: string;
  updatedAt: string;
  isDraft?: boolean;
  reviewDecision?: string;
  checks?: { name: string; conclusion: string }[];
};

/**
 * PR 狀態 → 事件。
 *
 * `event_id` 用 `pr-<repo>-<number>-<kind>`：**同一個 PR 的同一種狀態只留一筆**。
 * PR 會被輪詢很多次，用時間戳當 id 會讓一個開了 38 天的 PR 產生上萬筆 `pr.open`。
 * 代價是「第二次審查」會被吃掉，這在單人專案可接受；真的需要逐次紀錄時再把
 * reviewDecision 併進 id。
 */
export function prsToEvents(prs: PrLike[], project: string): LogEvent[] {
  const out: LogEvent[] = [];
  for (const pr of prs) {
    const ref = `https://github.com/${pr.repo}/pull/${pr.number}`;
    const subject = `pr:${pr.repo}#${pr.number}`;
    const base = { project, actor: { kind: "ci" as const, family: null, name: "GitHub" }, subject, ref };

    out.push(
      buildEvent(
        { ...base, kind: "pr.open", ts: pr.updatedAt, payload: { title: pr.title } },
        `pr-${pr.repo}-${pr.number}-open`
      )
    );
    if (pr.reviewDecision) {
      out.push(
        buildEvent(
          { ...base, kind: "pr.review", ts: pr.updatedAt, payload: { reviewDecision: pr.reviewDecision } },
          `pr-${pr.repo}-${pr.number}-review`
        )
      );
    }
    const failing = (pr.checks ?? []).filter((c) => c.conclusion && c.conclusion !== "SUCCESS");
    if (failing.length) {
      out.push(
        buildEvent(
          { ...base, kind: "pr.checks.fail", ts: pr.updatedAt, payload: { count: failing.length } },
          `pr-${pr.repo}-${pr.number}-checks`
        )
      );
    }
  }
  return out;
}

// ── Writer B：hook 偵測與安裝指令 ────────────────────────────────

/** hook 寫入端要落在哪。與 `event-log.ts` 的 LOG_DIR 對齊。 */
export const HOOK_MARKER = ".specforge/log";

/**
 * 給使用者複製的一行。**App 不會自己寫進 settings.json。**
 *
 * 這行只做兩件事：append 一筆 file.edit 事件、順便點亮 live tracking 的訊號檔。
 * 不開視窗、不起長駐進程——前一代寫入端就是死在這一點上。
 */
export function hookInstallSnippet(): string {
  return [
    '{',
    '  "hooks": {',
    '    "PostToolUse": [{',
    '      "matcher": "Edit|Write",',
    '      "hooks": [{',
    '        "type": "command",',
    '        "command": "r=\\"${CLAUDE_PROJECT_DIR:-$PWD}\\"; d=\\"$r/.specforge/log\\"; mkdir -p \\"$d\\"; f=\\"${CLAUDE_TOOL_FILE#$r/}\\"; printf \'{\\"v\\":1,\\"event_id\\":\\"%s\\",\\"ts\\":\\"%s\\",\\"actor\\":{\\"kind\\":\\"hook\\",\\"family\\":\\"claude\\",\\"name\\":\\"Claude Code\\"},\\"kind\\":\\"file.edit\\",\\"subject\\":\\"%s\\"}\\\\n\' \\"$(uuidgen | tr -d - | head -c 14)\\" \\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\\" \\"$f\\" >> \\"$d/$(date -u +%Y-%m).jsonl\\""',
    '      }]',
    '    }]',
    '  }',
    '}',
  ].join("\n");
}

/**
 * hook 有沒有在寫。
 *
 * 判準是「最近有沒有 actor.kind = hook 的事件」而不是去讀 settings.json ——
 * 讀設定檔只知道「設定寫了」，看事件才知道「真的在跑」。前一代寫入端就是
 * 設定還在、東西早就不動了。
 */
export function hookIsLive(events: { actor?: { kind?: string }; ts: string }[], nowMs: number): boolean {
  const cutoff = nowMs - 7 * 86400000;
  return events.some((e) => e.actor?.kind === "hook" && new Date(e.ts).getTime() >= cutoff);
}
