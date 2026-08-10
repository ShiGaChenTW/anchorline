#!/usr/bin/env bun
/**
 * Writer C 的觸發點 —— 把既有 git 歷史回填成稽核軌跡。
 *
 * 用法：
 *   bun run backfill              # 回填當前 repo
 *   bun run backfill -- --dir X   # 回填別的 repo
 *   bun run backfill -- --report  # 順便印出稽核報告 Markdown
 *
 * 冪等：`event_id` 就是 commit hash，重跑幾次都只會有一筆。所以可以放心
 * 在既有 log 上再跑一次，不會產生重複。
 *
 * 這支存在的理由：`commitsToEvents()` 早就寫好了，但沒有東西呼叫它。一個
 * 沒有觸發點的函式等於不存在 —— 而 git 回填正好順帶解掉 GitStats.commits
 * 的 40 筆上限（那是「單次查詢抓多少」，回填之後歷史留在 log 裡）。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { dedupe, parseLog, serializeEvent, shardFor, LOG_DIR } from "../lib/event-log";
import { commitsToEvents } from "../lib/event-writer";
import { exportMarkdown } from "../lib/log-views";

const args = process.argv.slice(2);
const dirArg = args.indexOf("--dir");
const root = resolve(dirArg >= 0 ? (args[dirArg + 1] ?? ".") : ".");
const wantReport = args.includes("--report");

/** 用 node:child_process 而不是 Bun.spawnSync —— tsconfig 沒有 bun 型別，
 *  而為了一支 CLI 加一個型別依賴不划算。 */
function git(a: string[]): string {
  try {
    // stderr 走 pipe 而不是繼承：`remote get-url origin` 在沒有 remote 的 repo
    // 上一定失敗，那是預期內的缺席（回空字串就好），不該把 git 的紅字印在
    // 使用者的回填報告中間。
    return execFileSync("git", ["-C", root, ...a], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

if (!git(["rev-parse", "--git-dir"])) {
  console.error(`不是 git 專案：${root}`);
  process.exit(1);
}

// %x1f 是欄位分隔、%x1e 是紀錄分隔 —— commit 訊息本身可能含 | 或 tab。
// %b（內文）擺最後：它是唯一可能含換行的欄位，放尾端就不必額外跳脫。
// 沒有它就讀不到寫在內文的錨點，而那是 join key。
const RAW = git(["log", "--pretty=format:%h%x1f%s%x1f%cI%x1f%an%x1f%D%x1f%b%x1e"]);
const commits = RAW.split("\x1e")
  .map((r) => r.replace(/^\n/, "").split("\x1f"))
  .filter((f) => f.length >= 4 && f[0])
  .map(([hash, subject, at, author, refs, body]) => ({
    hash: hash!,
    subject: subject!,
    // `%cI` 給的是本地時間帶時區（`…+08:00`），但 DATA.md 的規定是
    // 「ISO-8601 UTC，不存時區」。同一份 log 混兩種寫法時，字串比較會給出
    // 跟時間順序相反的答案 —— 而讀取端本來就是字串比較。正規化在寫入端做，
    // 因為那是唯一能讓磁碟上只有一種形狀的地方。
    at: new Date(at!).toISOString(),
    author: author!,
    refs: refs ?? "",
    body: body ?? "",
  }));

const project = basename(root);
const remote = git(["remote", "get-url", "origin"]) || undefined;
const fresh = commitsToEvents(commits, project, remote);

// 依月份分片寫入。既有內容先讀進來一起去重 —— 這是冪等的來源。
const logDir = join(root, LOG_DIR);
mkdirSync(logDir, { recursive: true });

const attrs = join(root, ".anchorline", ".gitattributes");
if (!existsSync(attrs)) writeFileSync(attrs, "*.jsonl merge=union\n");

const byShard = new Map<string, typeof fresh>();
for (const e of fresh) {
  const k = shardFor(e.ts);
  (byShard.get(k) ?? byShard.set(k, []).get(k)!).push(e);
}

let written = 0;
for (const [shard, events] of byShard) {
  const path = join(logDir, shard);
  const existing = existsSync(path) ? parseLog(readFileSync(path, "utf8")).events : [];
  const merged = dedupe([...existing, ...events]).sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
  );
  writeFileSync(path, merged.map(serializeEvent).join(""));
  written += merged.length - existing.length;
  console.log(`${shard}  ${merged.length} 筆（新增 ${merged.length - existing.length}）`);
}

console.log(`\n回填完成：${commits.length} 個 commit → 新增 ${written} 筆事件`);
console.log(`位置：${logDir}`);

if (wantReport) {
  const all = [...byShard.values()].flat();
  console.log("\n" + exportMarkdown(dedupe(all), `稽核軌跡 · ${project}`));
}
