/**
 * 從實際改動產生 commit 訊息 —— 解析、組 prompt、正規化、組指令。
 *
 * ## 為什麼要讀 diff 而不是讀 dirtyCount
 *
 * `GitStats` 只有一個數字。用數字寫得出來的訊息上限就是
 * 「更新 12 個檔案」—— 那句話從 `git status` 也看得到，寫進 commit 訊息
 * 等於什麼都沒說。要講得出「這次到底改了什麼」，只能讀 porcelain 與 diff。
 *
 * ## 邊界
 *
 * 這裡只到「產生一段文字與一行可貼的指令」為止。執行 commit 是
 * `git-doctor.ts` 已經立過兩次的那條線的另一邊：從 WebView 按一下就改動
 * repo，出錯時使用者連發生了什麼都不知道。
 *
 * 純函式、零 I/O、零 DOM。
 */
import { fillTemplate } from "./template";

/** porcelain 的狀態碼收斂成人看得懂的四類 */
export type FileChangeKind = "added" | "modified" | "deleted" | "renamed" | "untracked";

export type FileChange = {
  path: string;
  kind: FileChangeKind;
  /** 改名才有：原本的路徑 */
  from?: string;
};

export type Changeset = {
  /** `git status --porcelain` 原文 */
  status: string;
  /** `git diff HEAD --stat` 原文 */
  stat: string;
  /** `git diff HEAD` 原文，可能已截斷 */
  patch: string;
  /** patch 是否因為超過上限被截斷 */
  truncated: boolean;
};

/**
 * 送給模型的 patch 上限。
 *
 * 上限存在的理由有兩個，第二個比較重要：大 diff 會吃掉整個 context window，
 * 而且**會把整份改動內容送到外部服務**。超過上限時退回只送檔案清單與 stat，
 * 訊息會比較粗，但那是使用者看得到的降級，不是靜靜把 20 萬字寄出去。
 */
export const PATCH_LIMIT = 24_000;

/** 主旨長度上限。git 的慣例是 50，這裡放寬到 72 —— 中文一個字佔的資訊量比較大。 */
export const SUBJECT_LIMIT = 72;

const KIND_LABEL: Record<FileChangeKind, string> = {
  added: "新增",
  modified: "修改",
  deleted: "刪除",
  renamed: "改名",
  untracked: "未追蹤",
};

export function kindLabel(k: FileChangeKind): string {
  return KIND_LABEL[k];
}

/**
 * 解析 `git status --porcelain`（v1 格式）。
 *
 * 前兩個字元是 index 與 worktree 的狀態碼，第三個是空白，其餘是路徑。
 * 改名長成 `R  old -> new`。
 *
 * 認不得的狀態碼一律當 modified —— 少認一種狀態只是標籤不精確，
 * 整行丟掉才會讓那個檔案從清單裡消失，而使用者不會知道少了什麼。
 */
export function parsePorcelain(raw: string): FileChange[] {
  const out: FileChange[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.length < 4) continue;
    const x = line[0]!;
    const y = line[1]!;
    const rest = line.slice(3);
    if (!rest) continue;

    if (x === "?" && y === "?") {
      out.push({ path: rest, kind: "untracked" });
      continue;
    }
    const code = x === " " ? y : x;
    if (code === "R") {
      const [from, to] = rest.split(" -> ");
      out.push({ path: (to ?? rest).trim(), kind: "renamed", from: from?.trim() });
      continue;
    }
    const kind: FileChangeKind = code === "A" ? "added" : code === "D" ? "deleted" : "modified";
    out.push({ path: rest, kind });
  }
  return out;
}

/** 檔案清單摘要，給 prompt 與畫面共用，免得兩邊各數一次數出不同的值 */
export function summarizeChanges(files: readonly FileChange[]): string {
  const by = new Map<FileChangeKind, number>();
  for (const f of files) by.set(f.kind, (by.get(f.kind) ?? 0) + 1);
  return [...by.entries()].map(([k, n]) => `${KIND_LABEL[k]} ${n}`).join(" · ");
}

// ── Prompt ──────────────────────────────────────────────────────

export type PromptInput = {
  changeset: Changeset;
  files: readonly FileChange[];
  /** 這個 repo 的既有 commit 主旨（最近幾筆），用來讓模型學它的寫法 */
  recentSubjects: readonly string[];
  /** 依既有歷史判定要不要用 conventional commits 前綴 */
  conventional: boolean;
  /** 介面語言 */
  language: "zh-TW" | "en-US";
};

/**
 * System prompt。
 *
 * 兩件事是刻意寫死的：
 *
 * 1. **禁止從檔案數量造句。**「更新多個檔案」這種訊息正是這個功能要取代的
 *    東西，不擋掉的話模型在 diff 難讀時會退回去寫它。
 * 2. **不確定就說不確定。** 模型看不到執行結果，寫「修正了登入失敗」是在
 *    宣稱一件它沒驗證過的事。要它描述改動本身，不要描述效果。
 */
/** 可覆寫的模板本體（prompt-registry 拿它當預設值）。builder 仍是純函式。 */
export const COMMIT_SYSTEM_TEMPLATE = `你在替一個 git repo 寫 commit 訊息。用{{lang}}書寫。
{{style}}

規則：
- 主旨一行，{{subjectLimit}} 字以內，講「這次改了什麼」。
- 內文說明為什麼要改、以及重要的取捨。沒有值得說的就不要寫內文。
- 只描述 diff 裡看得到的改動。你沒有執行過這份程式碼，
  所以不要宣稱「修好了」「效能提升」這類你驗證不了的結果。
- 不要用檔案數量造句。「更新多個檔案」「調整若干設定」這類訊息一律不接受，
  它們從 git status 就看得到，寫進訊息等於沒寫。
- 改動橫跨多個不相關的主題時，主旨挑最主要的那一個，其餘寫進內文。

輸出格式：第一行是主旨，空一行之後是內文。不要加引號、不要加程式碼圍欄、
不要寫任何說明你在做什麼的句子。`;

/** 餵給 `{{lang}}`／`{{style}}`／`{{subjectLimit}}` 的值，讓呼叫端與 registry 共用 */
export function commitSystemVars(input: Pick<PromptInput, "language" | "conventional">): Record<string, string> {
  return {
    lang: input.language === "en-US" ? "English" : "繁體中文",
    style: input.conventional
      ? "這個 repo 使用 conventional commits，主旨要以 feat/fix/docs/refactor/test/chore 等前綴開頭。"
      : "這個 repo 不使用 conventional commits 前綴，主旨直接描述改動。",
    subjectLimit: String(SUBJECT_LIMIT),
  };
}

export function buildCommitSystem(input: PromptInput): string {
  return fillTemplate(COMMIT_SYSTEM_TEMPLATE, commitSystemVars(input));
}

/** User prompt：檔案清單 + stat + patch（可能已截斷） */
export function buildCommitUser(input: PromptInput): string {
  const { changeset, files, recentSubjects } = input;
  const parts: string[] = [];

  if (recentSubjects.length) {
    parts.push("這個 repo 最近的 commit 主旨（模仿它的語氣與粒度）：");
    parts.push(recentSubjects.slice(0, 8).map((s) => `- ${s}`).join("\n"));
    parts.push("");
  }

  parts.push(`改動的檔案（${summarizeChanges(files)}）：`);
  parts.push(
    files
      .slice(0, 60)
      .map((f) => `- [${KIND_LABEL[f.kind]}] ${f.from ? `${f.from} -> ${f.path}` : f.path}`)
      .join("\n"),
  );
  if (files.length > 60) parts.push(`…另有 ${files.length - 60} 個檔案`);
  parts.push("");

  if (changeset.stat.trim()) {
    parts.push("差異統計：");
    parts.push(changeset.stat.trim());
    parts.push("");
  }

  if (changeset.patch.trim()) {
    parts.push(changeset.truncated ? "差異內容（已截斷，只有前半部）：" : "差異內容：");
    parts.push(changeset.patch.trim());
  } else {
    // 說清楚模型手上少了什麼，它才不會假裝讀過 diff
    parts.push("（這次沒有附上差異內容，只能依檔案清單與統計判斷。）");
  }

  return parts.join("\n");
}

// ── 輸出正規化 ──────────────────────────────────────────────────

export type CommitDraft = { subject: string; body: string };

/**
 * 把模型輸出洗成 `{ subject, body }`。
 *
 * 要擋的三件事都是實際會發生的：程式碼圍欄、整段被引號包起來、
 * 以及「以下是建議的 commit 訊息：」這種開場白。
 */
export function parseCommitDraft(raw: string): CommitDraft {
  let text = raw.trim();

  const fenced = text.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) text = fenced[1].trim();

  // 整段被同一種引號包住才拆，句中的引號不能動
  const quoted = text.match(/^(["'「『])([\s\S]+)(["'」』])$/);
  if (quoted?.[2]) text = quoted[2].trim();

  const lines = text.split(/\r?\n/);
  // 開場白：第一行以冒號結尾且沒有實質內容
  if (lines.length > 1 && /^[^\n]{0,30}[:：]\s*$/.test(lines[0] ?? "")) lines.shift();

  const subjectRaw = (lines.shift() ?? "").trim();
  const subject = subjectRaw.length > SUBJECT_LIMIT
    ? `${subjectRaw.slice(0, SUBJECT_LIMIT - 1)}…`
    : subjectRaw;
  const body = lines.join("\n").replace(/^\s*\n+/, "").trimEnd();
  return { subject, body };
}

/** 產不出主旨就是失敗，不要拿空字串去組指令 */
export function isUsableDraft(d: CommitDraft): boolean {
  return d.subject.trim().length > 0;
}

/**
 * 組出可以直接貼進終端機的指令。
 *
 * 用單引號包並把內部的 `'` 換成 `'\''` —— 這是 POSIX shell 唯一安全的作法。
 * commit 訊息裡有反引號與 `$` 是常態（我們自己的訊息就有），
 * 雙引號會讓 shell 把它們當成命令替換執行。
 */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function commitCommand(d: CommitDraft): string {
  const parts = [`git commit -m ${shellQuote(d.subject)}`];
  if (d.body.trim()) parts.push(`-m ${shellQuote(d.body.trim())}`);
  return parts.join(" ");
}

/** patch 超過上限就截斷，並回報有沒有截到 */
export function clampPatch(patch: string, limit = PATCH_LIMIT): { patch: string; truncated: boolean } {
  if (patch.length <= limit) return { patch, truncated: false };
  return { patch: patch.slice(0, limit), truncated: true };
}
