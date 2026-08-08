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
  if (input.nextArtifact) parts.push(`下一個要寫的 artifact：${input.nextArtifact}`);
  return parts.join("。");
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
    input.isApproval && input.authorFamily && input.authorFamily === input.family
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
