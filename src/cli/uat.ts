#!/usr/bin/env bun
/** 用 node: 內建而不是 Bun.* —— tsconfig 會檢查這支 CLI，而 repo 沒有 bun 型別；
 *  為了產一份 UAT 報告去加型別依賴，不值得。 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { serializeUatReport, validateUatSpec, type UatSpec } from "../lib/uat-parser";

type CliOptions = {
  specSource: string;
  root: string;
  noOpen: boolean;
};

const USAGE =
  "用法：bun src/cli/uat.ts --spec <file.json|-> --root <projectRoot> [--no-open]";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatLocalMinute(at: Date): string {
  return [
    at.getFullYear(),
    pad2(at.getMonth() + 1),
    pad2(at.getDate()),
  ].join("-") +
    ` ${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
}

function formatMinuteSlug(at: Date): string {
  return `${at.getFullYear()}${pad2(at.getMonth() + 1)}${pad2(at.getDate())}-${pad2(at.getHours())}${pad2(at.getMinutes())}`;
}

const FILE_NAME_DANGER_RE = /[\u0000-\u001F\u007F/\\:*?"<>|]+/g;
const ASCII_UPPER_RE = /[A-Z]/g;
const WHITESPACE_RE = /\s+/gu;
const DUPLICATE_HYPHEN_RE = /-+/g;
// 句點不在一般危險字元清單裡，但頭尾句點會把報告變成隱藏檔，`.` / `..` 甚至不是合法 stem。
const EDGE_DOTS_AND_HYPHENS_RE = /^[.-]+|[.-]+$/g;
// APFS 的單一路徑元件上限是 255 個字元（不是位元組——120 個中文字／360 bytes 實測會過）。
// 扣掉 `uat-` 前綴與 `.md` 副檔名，再留一段給撞名時的 `-2`/`-3` 後綴。
// 這條上限在中文放行之前碰不到：舊行為把 CJK 一律刷成時間戳，永遠是 13 個字元。
// 不截斷的症狀是 writeFileSync 丟 ENAMETOOLONG、CLI 帶著原始 stack trace 中止——
// 而這支 CLI 其他每一條錯誤路徑都是走 fail() 的可讀訊息。
const MAX_SLUG_CHARS = 240;

function slugOfTitle(title: string): string {
  const cleaned = title
    .replace(FILE_NAME_DANGER_RE, "")
    .trim()
    .replace(ASCII_UPPER_RE, (char) => char.toLowerCase())
    .replace(WHITESPACE_RE, "-")
    .replace(DUPLICATE_HYPHEN_RE, "-")
    .replace(EDGE_DOTS_AND_HYPHENS_RE, "");

  // 用碼位切而不是 .slice()：.slice() 數的是 UTF-16 單元，會把代理對（emoji、
  // 罕用漢字）從中間劈開，留下半個字元的亂碼。
  return Array.from(cleaned)
    .slice(0, MAX_SLUG_CHARS)
    .join("")
    // 截斷可能剛好停在連字號或句點上，收尾要再修一次。
    .replace(EDGE_DOTS_AND_HYPHENS_RE, "")
    // NFC 必須放最後，才能讓 handoff 寫出的路徑與之後掃回來的路徑收斂成同一組位元組。
    .normalize("NFC");
}

function parseArgs(argv: string[]): CliOptions {
  let specSource: string | null = null;
  // 不預設 cwd：agent 常常站在 Anchorline repo 卻要替別的專案出題，
  // 忘了帶 --root 的症狀是「報告寫進錯的 repo、CLI 照樣宣告成功」——
  // 那句「App 會顯示這份報告」對一條永遠不會被掃到的路徑是假話。
  let root: string | null = null;
  let noOpen = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--spec") {
      if (specSource !== null) fail(`${USAGE}\n重複指定 --spec。`);
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) fail(`${USAGE}\n--spec 後面必須接檔案路徑或 -。`);
      specSource = value;
      i++;
      continue;
    }
    if (arg === "--root") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) fail(`${USAGE}\n--root 後面必須接專案根目錄。`);
      root = value;
      i++;
      continue;
    }
    if (arg === "--no-open") {
      noOpen = true;
      continue;
    }
    fail(`${USAGE}\n不支援的參數：${arg}`);
  }

  if (specSource === null) fail(`${USAGE}\n缺少必填參數 --spec。`);
  if (root === null) fail(`${USAGE}\n缺少必填參數 --root（被測專案的根目錄，報告會寫進它的 plans/）。`);
  return { specSource, root: resolve(root), noOpen };
}

function readSpecText(specSource: string): string {
  if (specSource === "-") return readFileSync(process.stdin.fd, "utf8");
  const path = resolve(specSource);
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`讀取 spec 失敗（${path}）：${message}`);
  }
}

function parseSpec(text: string, sourceLabel: string): UatSpec {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`spec JSON 解析失敗（${sourceLabel}）：${message}`);
  }

  const validated = validateUatSpec(raw);
  if (!validated.ok) {
    console.error(`UAT spec 驗證失敗（${sourceLabel}）：`);
    for (const issue of validated.errors) console.error(`- ${issue}`);
    process.exit(1);
  }
  return validated.spec;
}

function nextReportPath(root: string, title: string, now: Date): string {
  const plansDir = join(root, "plans");
  mkdirSync(plansDir, { recursive: true });
  const titleSlug = slugOfTitle(title);
  const base = titleSlug || formatMinuteSlug(now);
  const stem = `uat-${base}`;
  let candidate = join(plansDir, `${stem}.md`);
  for (let n = 2; existsSync(candidate); n++) {
    candidate = join(plansDir, `${stem}-${n}.md`);
  }
  return candidate;
}

function handoffDirFromEnv(): string {
  const raw = process.env.ANCHORLINE_HANDOFF_DIR;
  if (raw === undefined) return join(homedir(), ".anchorline");
  const trimmed = raw.trim();
  if (!trimmed) fail("ANCHORLINE_HANDOFF_DIR 不能是空字串。");
  return isAbsolute(trimmed) ? trimmed : resolve(trimmed);
}

function writeHandoff(reportPath: string, now: Date): string {
  // 佇列而不是單槽：App 還沒取件前連跑兩次 CLI，單槽會把第一份靜默蓋掉，
  // 兩端都不會有任何訊息。一件一檔，App 端依檔名排序、最舊先取。
  const dir = join(handoffDirFromEnv(), "uat-handoff");
  mkdirSync(dir, { recursive: true });
  let handoffPath = join(dir, `${now.getTime()}.json`);
  for (let n = 2; existsSync(handoffPath); n++) {
    handoffPath = join(dir, `${now.getTime()}-${n}.json`);
  }
  writeFileSync(
    handoffPath,
    JSON.stringify(
      { v: 1, reportPath, createdAt: now.toISOString() },
      null,
      2,
    ) + "\n",
  );
  return handoffPath;
}

function wakeApp(noOpen: boolean): void {
  if (noOpen || process.platform !== "darwin") return;
  const opened = spawnSync("open", ["-a", "Anchorline"], {
    stdio: "ignore",
    timeout: 5000,
  });
  if (opened.status === 0 && !opened.error) return;
  console.error("已寫出報告，但叫不起 Anchorline.app；請手動開啟 App 查看待處理報告。");
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const now = new Date();
  const specText = readSpecText(opts.specSource);
  const spec = parseSpec(specText, opts.specSource === "-" ? "stdin" : resolve(opts.specSource));
  const reportPath = nextReportPath(opts.root, spec.title, now);
  const report = serializeUatReport(spec, { now: formatLocalMinute(now) });
  writeFileSync(reportPath, report);
  writeHandoff(reportPath, now);
  wakeApp(opts.noOpen);

  console.log(`報告：${reportPath}`);
  console.log(`題數：${spec.items.length}`);
  console.log("Anchorline 會顯示這份待處理報告。");
}

main();
