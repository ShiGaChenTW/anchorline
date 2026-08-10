/**
 * Agent 交接指令產生器 —— **只產生，不執行。**
 *
 * ## 為什麼不直接派工
 *
 * 要從 App 派一個 agent，就得讓原生端執行前端傳來的任意 prompt 字串。
 * 而 `src-tauri/src/exec.rs` 全檔的安全模型建立在相反的前提上：
 * 參數一律在 Rust 寫死，前端只能說「對哪個專案做這件已列舉的事」。
 * 開這個口等於把 WebView 變成任意程式碼執行的入口，而這個 App 讀得到
 * 使用者所有專案資料夾。
 *
 * 所以走 `git-doctor.ts` 已經立過兩次的那條界線：**工具產生指令，人自己執行。**
 * 成本是多一次貼上，換來的是攻擊面為零。
 *
 * 純函式、零 I/O。
 */

import { ANCHOR_PREFIX } from "./plan-parser";

export type AgentFamilyId = "claude" | "codex" | "gemini" | "other";

export type HandoffInput = {
  /** 專案根目錄絕對路徑 */
  projectRoot: string;
  /** 要交代的事 */
  task: string;
  family: AgentFamilyId;
  /** openspec change 名稱（有的話會寫進 prompt） */
  change?: string;
  /** 下一個 ready 的 artifact，例如 `design.md` */
  nextArtifact?: string;
  /** 這份文件的撰寫者族系。用來擋同族系自我核准 */
  authorFamily?: string | null;
  /** 這次交接是不是要對方做「核准」 */
  isApproval?: boolean;
  /**
   * 這件工作對應的錨點 id（**裸 id，不帶 `anc:t=` 前綴**）。
   *
   * 交出去的 prompt 會要求 agent 把它寫進 commit 訊息。沒有它，agent 做的事
   * 回填成事件時就只能用 commit hash 當 subject —— 串不回 plan 步驟，
   * 而整條治理鏈的價值就在那個串接上。
   */
  anchor?: string | null;
};

/** 交接內容，與傳輸方式無關。貼指令／HTTP／URL scheme 都從這裡序列化。 */
export type HandoffPayload = {
  projectRoot: string;
  /** 給執行端當 task 名稱用的短標題 */
  taskName: string;
  prompt: string;
  /** 裸 id；沒有合法錨點時為 null */
  anchor: string | null;
  /** 撰寫者族系，供執行端記錄 actor 與職務分離判定 */
  authorFamily: string | null;
};

export type Handoff = {
  /** 可直接貼進終端的一行 */
  command: string;
  /** 擋下的原因。非 null 時 UI 不該給複製按鈕 */
  blocked: string | null;
};

/** shell 單引號跳脫：`'` → `'\''`。prompt 裡有中文引號和 markdown，一定要跳。 */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

const RUNNER: Record<AgentFamilyId, (prompt: string) => string> = {
  claude: (p) => `claude -p ${shellQuote(p)}`,
  codex: (p) => `codex exec ${shellQuote(p)}`,
  gemini: (p) => `gemini -p ${shellQuote(p)}`,
  other: (p) => `# 貼給你的 agent：\n${p}`,
};

/**
 * 組出 prompt。刻意帶上 openspec 脈絡 —— agent 拿到「寫 design.md」比
 * 拿到「繼續」有用得多，而 App 剛好知道下一個 ready 是哪個 artifact。
 */
export function buildPrompt(input: HandoffInput): string {
  const parts = [input.task.trim()];
  if (input.change) parts.push(`openspec change：${input.change}`);
  if (input.nextArtifact)
    parts.push(`下一個要寫的 artifact：${input.nextArtifact}`);
  const line = parts.join("。");

  // 錨點放在最後而且自成一句。埋在句子中間的話，agent 很容易把它當成敘述的一
  // 部分改寫掉；而錨點被改一個字元就等於沒有錨點，且不會有任何錯誤。
  const anchor = validAnchor(input.anchor);
  if (!anchor) return line;
  return (
    `${line}\n\n完成後 commit 時，請在訊息內文獨立一行寫上 ${ANCHOR_PREFIX}:t=${anchor}` +
    `（原樣照抄，不要改動）。\n\n` +
    // 漂移最便宜的偵測器：讓做事的人自己說。實測兩輪派工，兩個 agent 都在
    // 沒有被要求的情況下主動舉報了「我做的跟步驟描述不一樣」——既然它本來
    // 就會講，就把它寫進 prompt，讓它講在會被記錄的地方。
    `如果你實際做的事跟上面的描述不同（範圍變了、發現真正該做的是別的），` +
    `在 commit 訊息裡用一行說明差在哪。不必徵求同意，把它說出來就好。`
  );
}

/**
 * 只接受合法錨點。
 *
 * Crockford base32 刻意排除 `I / L / O / U`（手抄時容易看錯），而手寫的錨點很
 * 容易誤用它們 —— L0 探針全程用的 `L0PROBE1` 就同時踩到 L 和 O，從頭到尾不是
 * 合法錨點，`ANCHOR_RE` 讀不到它，而且沒有任何錯誤訊息。
 *
 * 寧可不帶錨點（退回 commit hash 當 subject），也不要帶一個永遠對不上的。
 */
export function validAnchor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const bare = raw.replace(/^(?:anc|sf):t=/, "").trim();
  return /^[0-9A-HJKMNP-TV-Z]{4,32}$/.test(bare) ? bare : null;
}

/**
 * 交接內容 → 傳輸無關的 payload。
 *
 * 抽出來的理由：貼指令、remote HTTP、URL scheme 三種傳輸方式對「要交出什麼」
 * 的答案完全一樣，只是包裝不同。把它綁在 shell 指令的字串裡，換傳輸方式時就
 * 得把同一份邏輯再抄一次 —— 而抄第二份的那一刻，錨點就會開始分岔。
 */
export function buildPayload(input: HandoffInput): HandoffPayload {
  const task = input.task.trim();
  return {
    projectRoot: input.projectRoot,
    // 執行端要一個短標題當 task 名。取第一行並封頂，不要把整段 prompt 當名字。
    taskName: task.split("\n")[0]!.slice(0, 60) || "未命名任務",
    prompt: buildPrompt(input),
    anchor: validAnchor(input.anchor),
    authorFamily: input.authorFamily ?? null,
  };
}

/**
 * 產生交接指令。
 *
 * **同族系不得核准自己族系撰寫的文件** —— 這條規則在這裡也要生效，
 * 否則使用者可以繞過 App 的簽核界線：叫一個同族 agent 去核准。
 * GitHub 的 CODEOWNERS 只認人不認 AI 族系，抓不到這一類。
 */
export function buildHandoff(input: HandoffInput): Handoff {
  const blocked =
    input.isApproval &&
    input.authorFamily &&
    input.authorFamily === input.family
      ? `撰寫者與審查者同為 ${input.family} 族系，依職務分離規則不能由它核准。換一個族系的 agent，或由人核准。`
      : null;

  const prompt = buildPrompt(input);
  const run = RUNNER[input.family](prompt);
  const command =
    input.family === "other"
      ? run
      : `cd ${shellQuote(input.projectRoot)} && ${run}`;

  return { command, blocked };
}

/** 給 UI 的說明文案。指令會做什麼、不會做什麼，講在按鈕旁邊而不是文件裡。 */
export const HANDOFF_NOTE =
  "這個工具只產生指令，不會替你執行。貼進終端之前請先看一眼——執行之後 agent 會直接改你的專案。";
