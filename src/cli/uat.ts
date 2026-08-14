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

function slugOfTitle(title: string): string {
  return title
    .replace(/[^\x00-\x7F]+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
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
