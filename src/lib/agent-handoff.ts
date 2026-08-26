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

import type { AgentFamily } from "../data/types";
import { ANCHOR_PREFIX } from "./plan-parser";

export type HandoffInput = {
  /** 專案根目錄絕對路徑 */
  projectRoot: string;
  /** 要交代的事 */
  task: string;
  /**
   * 交給哪個族系。**型別是完整的 `AgentFamily`（十個），不是 runner 表的子集。**
   *
   * 2026-08-26 之前這裡是一個只有四個成員的 `AgentFamilyId`，而
   * `tracking.ts` 用 `as` 把十個成員的 `AgentFamily` 硬轉進來 ——
   * 於是 `grok`/`pi`/`hermes`/`agy`/`gpt`/`local` 六個族系會讓
   * `RUNNER[family]` 拿到 undefined，按下交接當場 TypeError。
   * 收窄的那個型別沒有擋住任何東西，只是把錯誤從編譯期挪到執行期。
   */
  family: AgentFamily;
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

/**
 * 一個族系怎麼跑。
 *
 * `cwd` 是「這串東西是不是一行可執行的指令」—— 是的話前面要接
 * `cd <專案根>`；不是的話它只是一段給人自己貼進 agent 的文字，接 `cd` 只會
 * 讓人以為那是可執行的。
 */
type FamilyRunner = {
  run: (prompt: string) => string;
  cwd: boolean;
};

/**
 * 沒有已知 CLI 的族系走這條：把 prompt 原樣交出去，由人自己貼。
 *
 * 這是**回退，不是失敗**。要緊的是它一定給得出東西 —— 這顆按鈕唯一不可接受的
 * 行為是丟 TypeError，因為那會讓使用者以為是 App 壞了而不是「這個族系沒有 CLI」。
 */
const PASTE: FamilyRunner = {
  run: (p) => `# 貼給你的 agent：\n${p}`,
  cwd: false,
};

/**
 * 族系 → 指令。**十個成員一個都不能少**：型別寫成完整的
 * `Record<AgentFamily, …>` 是刻意的，將來 `AgentFamily` 加一個成員時
 * `tsc` 會在這裡紅燈，而不是等使用者按下交接才炸。
 *
 * ⚠️ **這份清單跟 `exec.rs` 的 CLI 執行白名單是兩件事，不要對齊。**
 * 這裡產生的是給人貼進終端的字串，App 從頭到尾不執行它（見檔頭）；
 * 那份白名單管的是原生 spawn，`agent-backend.ts` 的 `CLI_TOOLS` 才要跟它逐字相同。
 * 所以這裡留著 `gemini`（這台機器沒裝）沒有安全問題 —— 頂多是貼過去指令失敗，
 * 而那是使用者看得見、講得出原因的失敗。
 *
 * 旗標全部是實跑 `--help` 看來的，不是憑印象：`pi --print, -p`、
 * `agy -p / --print`、`grok` 的 prompt 是位置參數（`grok [OPTIONS] [PROMPT]`）。
 * 這些是**要幹活的**呼叫，所以刻意不帶 `exec.rs` 那套停用工具的旗標 ——
 * 那套是給 App 自己 spawn 用的，交接出去的 agent 本來就該有工具。
 */
const RUNNER: Record<AgentFamily, FamilyRunner> = {
  claude: { run: (p) => `claude -p ${shellQuote(p)}`, cwd: true },
  codex: { run: (p) => `codex exec ${shellQuote(p)}`, cwd: true },
  gemini: { run: (p) => `gemini -p ${shellQuote(p)}`, cwd: true },
  grok: { run: (p) => `grok ${shellQuote(p)}`, cwd: true },
  pi: { run: (p) => `pi -p ${shellQuote(p)}`, cwd: true },
  agy: { run: (p) => `agy -p ${shellQuote(p)}`, cwd: true },
  // 以下四個沒有「一行就能派工」的 CLI 呼叫。`hermes` 有 CLI，但它的
  // 非互動旗標沒有實測過，寧可交出 prompt 讓人自己跑，也不要給一行猜的指令。
  hermes: PASTE,
  gpt: PASTE,
  local: PASTE,
  other: PASTE,
};

/**
 * 總函式：**任何**字串都給得出 runner。
 *
 * 型別上 `RUNNER` 已經蓋滿聯集，但 `project.authorAgentFamily` 的來源是
 * localStorage 與匯入的備份，兩者都可以被手改成聯集外的值，而型別擋不到
 * 執行期的資料。所以這裡再擋一次 —— 型別的完整性防的是未來改 code 的人，
 * 這個 `??` 防的是已經存在磁碟上的髒資料。
 */
export function runnerFor(family: string | null | undefined): FamilyRunner {
  // 用 hasOwnProperty 而不是 `RUNNER[family] ?? PASTE`：後者對 `"toString"`
  // 這類 `Object.prototype` 上的名字會拿到**繼承來的函式**（不是 undefined），
  // `??` 於是不會觸發，接著 `runner.cwd` 是 undefined、`runner.run` 不存在 ——
  // 也就是把原本要修掉的那個 TypeError 換一個入口再開一次。
  if (!family || !Object.prototype.hasOwnProperty.call(RUNNER, family)) return PASTE;
  return RUNNER[family as AgentFamily];
}

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
  const runner = runnerFor(input.family);
  const run = runner.run(prompt);
  // 判準從「族系是不是 other」換成「這串是不是可執行的指令」。前者只是後者的
  // 一個特例，而每多一個沒有 CLI 的族系，前者就會多錯一次。
  const command = runner.cwd ? `cd ${shellQuote(input.projectRoot)} && ${run}` : run;

  return { command, blocked };
}

/** 給 UI 的說明文案。指令會做什麼、不會做什麼，講在按鈕旁邊而不是文件裡。 */
export const HANDOFF_NOTE =
  "這個工具只產生指令，不會替你執行。貼進終端之前請先看一眼——執行之後 agent 會直接改你的專案。";
