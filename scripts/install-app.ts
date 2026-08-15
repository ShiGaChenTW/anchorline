#!/usr/bin/env bun
/**
 * install-app — 一鍵換裝 /Applications/Anchorline.app
 *
 * 存在理由：每輪功能驗證要手動跑 build → rm -rf → cp -R → sha256 比對 → open，
 * 漏掉任何一步就會對著舊版做驗證並產出假 bug 報告。這支腳本把整串綁成一個
 * 全有全無的交易：任何一步不對就中止、回滾、說清楚原因。
 *
 * 換裝是交易式的，不是「先刪再複製」：
 *   舊版 rename → 備份  →  ditto 新版就位  →  雙邊 sha256  →  才刪備份
 * 任一步失敗就把備份 rename 回原位。手動流程最貴的 failure mode 是
 * 「build 失敗但 rm 照跑 → 舊版被刪、新版沒進來、App 直接消失」，
 * 這支腳本不能自己重蹈。tauri updater 的 macOS 安裝路徑也是 rename-to-backup。
 * rename 走同一個檔案系統（備份就放在 /Applications 底下），是原子操作、不搬資料。
 *
 * 流程：
 *   1. build（bun run app｜app:test；beforeBuildCommand 會先跑 tsc --noEmit）
 *   2. 確認 bundle 產物存在，印指紋，比對 mtime 與最後一次 commit
 *   3. 若安裝版正在執行 → 先關閉（SIGTERM → 逾時 SIGKILL）
 *   4. 交易式換裝（備份 → 複製 → 雙邊 sha256 → 不符就回滾）
 *   5. open 並 poll pgrep 確認進程真的起得來
 *   6. 清除備份、印出 build 指紋
 *
 * 用法：
 *   bun run app:install
 *   bun run app:install --test          # 換 Anchorline Test.app（bun run app:test 的產物）
 *   bun run app:install --skip-build    # 已經 build 過，只換裝
 *   bun run app:install --no-open       # 換完不要開起來（同時跳過啟動驗證）
 *
 * 刻意不做的事——xattr：
 *   這支腳本從頭到尾不碰擴充屬性。本機 build 出來的產物只帶
 *   com.apple.provenance，沒有 com.apple.quarantine（quarantine 是下載來源才會
 *   蓋的，本機行程寫檔不會產生），所以沒有東西需要清。
 *   ⚠️ 不要「順手」加 `xattr -cr`：它會遞迴清掉所有擴充屬性，等哪天 app 真的
 *   被簽章／公證了，那一刀會把簽章相關的屬性一起帶走，而症狀會是啟動時
 *   一句沒頭沒尾的「已損毀」。
 *
 * 走 shell 一律用 execFileSync 的參數陣列，沒有任何字串插值——路徑帶空白
 * （"Anchorline Test.app"）或引號時，字串插值會靜默拼出另一條命令。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

// ─── 變體 ─────────────────────────────────────────────────────────────────

export type VariantId = "release" | "test";

export type Variant = {
  id: VariantId;
  productName: string;
  identifier: string;
  /** package.json 裡的 build script 名稱。 */
  buildScript: string;
  /** tauri build 的 macOS bundle 產物位置（相對 repo root）。 */
  bundleRelativePath: string;
  installPath: string;
  installedBinaryPath: string;
};

/**
 * bundle 目錄裡 Anchorline.app 與 Anchorline Test.app 兩份同時存在，
 * 路徑寫死遲早會裝錯一個——所以路徑全部從變體推導出來。
 */
export function variantFor(id: VariantId): Variant {
  const productName = id === "test" ? "Anchorline Test" : "Anchorline";
  const appName = `${productName}.app`;
  return {
    id,
    productName,
    identifier: id === "test" ? "dev.anchorline.app.test" : "dev.anchorline.app",
    buildScript: id === "test" ? "app:test" : "app",
    bundleRelativePath: `src-tauri/target/release/bundle/macos/${appName}`,
    installPath: `/Applications/${appName}`,
    // 兩個變體的 CFBundleExecutable 都是 anchorline（小寫），只有所在路徑不同。
    // 所以偵測程序一律比對完整路徑，不能用 `pgrep -x anchorline`——那會連帶
    // 關掉不該關的那一個。
    installedBinaryPath: `/Applications/${appName}/Contents/MacOS/anchorline`,
  };
}

const USAGE = "用法：bun run app:install [--test] [--skip-build] [--no-open]";

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

// ─── 純函式（tests/install-app.test.ts 釘住的部分）─────────────────────────

export type InstallFlags = {
  /** 跳過 build，直接拿現有 bundle 換裝。 */
  skipBuild: boolean;
  /** 換裝完成後不要 open（同時跳過啟動驗證）。 */
  noOpen: boolean;
  variant: VariantId;
};

/**
 * 解析旗標。不認得的旗標一律丟錯而不是忽略——打錯字被忽略的話，
 * `--skipbuild` 會靜默跑完整 build，等於這支腳本最想避免的那種驚喜。
 */
export function parseFlags(argv: readonly string[]): InstallFlags {
  const flags: InstallFlags = { skipBuild: false, noOpen: false, variant: "release" };
  for (const arg of argv) {
    if (arg === "--skip-build") flags.skipBuild = true;
    else if (arg === "--no-open") flags.noOpen = true;
    else if (arg === "--test") flags.variant = "test";
    else throw new Error(`不認得的參數：${arg}\n${USAGE}`);
  }
  return flags;
}

export function resolveBundlePath(repoRoot: string, variant: Variant): string {
  return join(repoRoot, variant.bundleRelativePath);
}

/**
 * 備份路徑。刻意放在 /Applications 底下（rename 必須同檔案系統才是原子操作，
 * 搬到 /tmp 會退化成跨卷複製），且刻意去掉 .app 副檔名並加上點前綴——
 * 留在 /Applications 的暫存若仍叫 *.app，LaunchServices 會把它當成一個可啟動的
 * App 收進去，Spotlight 就會冒出兩個 Anchorline。
 *
 * 名稱是決定性的而不是帶 PID：交易半途死掉時，Scott 要知道去哪裡找回舊版。
 */
export function backupPathFor(installPath: string): string {
  const stem = basename(installPath).replace(/\.app$/, "");
  return join(dirname(installPath), `.${stem}-install-backup`);
}

/**
 * pgrep -f 的樣式是 ERE。路徑裡的 "." 不跳脫會退化成萬用字元；
 * "Anchorline Test.app" 這種帶空白與點的路徑更需要精確比對。
 */
export function toPgrepPattern(path: string): string {
  return path.replace(/[.[\]{}()*+?^$|\\]/g, "\\$&");
}

export type EntryKind = "file" | "dir" | "symlink";

export type BundleEntry = {
  /** 相對 .app 根目錄的路徑，以 "/" 分隔。 */
  path: string;
  kind: EntryKind;
  /** file：內容 sha256；symlink：link target 字串的 sha256；dir："-"。 */
  digest: string;
  /** 權限位；只取 & 0o7777。執行位掉失是壞掉的 .app 的典型症狀，必須進雜湊。 */
  mode: number;
};

/**
 * 為什麼是「清單雜湊」而不是 `find ... -exec shasum`：
 *
 *   - find 的輸出順序取決於目錄項目在檔案系統上的排列，兩次執行可以不同順序，
 *     串起來雜湊就不可重現。這裡明確排序後才彙總。
 *   - shasum 對 symlink 會跟隨到目標檔（-L 行為差異）並在斷鏈時直接失敗；
 *     .app 內的 symlink 應該比對「指向哪裡」而不是「目標內容」。
 *   - find -type f 看不到空目錄，也看不到權限位。缺一個空目錄或掉了執行位的
 *     bundle 一樣是壞的，但檔案內容雜湊會告訴你「一致」。
 *
 * 所以：走訪 → 每項產生一行 `<kind> <mode> <digest> <path>` → 排序 → 合併 →
 * 對整份清單取 sha256。清單本身是可讀的，比對不符時可以直接 diff 出哪一項變了。
 */
export function buildManifest(entries: readonly BundleEntry[]): string {
  if (entries.length === 0) return "";
  return (
    [...entries]
      // 用碼位序而非 localeCompare：locale 排序會隨環境變數改變，不可重現。
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((e) => `${e.kind} ${(e.mode & 0o7777).toString(8).padStart(4, "0")} ${e.digest} ${e.path}`)
      .join("\n") + "\n"
  );
}

export function digestOfManifest(manifest: string): string {
  return createHash("sha256").update(manifest, "utf8").digest("hex");
}

export type VerifyResult = { ok: boolean; reason: string | null };

/**
 * 比對判定。空字串／非 64 位小寫 hex 一律當作失敗而不是「兩邊都空所以相等」——
 * 雜湊算失敗回傳空字串時，天真的相等比較會判定通過，那正是這支腳本要擋的事。
 */
export function verifyDigests(source: string, target: string): VerifyResult {
  if (!SHA256_HEX_RE.test(source))
    return { ok: false, reason: `來源雜湊格式不合法：${source || "(空)"}` };
  if (!SHA256_HEX_RE.test(target))
    return { ok: false, reason: `目標雜湊格式不合法：${target || "(空)"}` };
  if (source !== target) return { ok: false, reason: `雜湊不符：來源 ${source} ≠ 目標 ${target}` };
  return { ok: true, reason: null };
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  return `${Math.floor(totalSeconds / 60)}m${String(totalSeconds % 60).padStart(2, "0")}s`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatLocalMinute(at: Date): string {
  return (
    `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}` +
    ` ${pad2(at.getHours())}:${pad2(at.getMinutes())}`
  );
}

/**
 * build 產物比最後一次 commit 還舊 → 幾乎一定是忘了 build。
 * 便宜的第二道防線；拿不到 commit 時間就不猜（回 false）。
 */
export function isStaleBuild(bundleMtimeMs: number, lastCommitMs: number | null): boolean {
  if (lastCommitMs === null) return false;
  return bundleMtimeMs < lastCommitMs;
}

/** 一行看完「我裝的是哪一個 build」。 */
export function formatFingerprint(input: {
  digest: string;
  head: string | null;
  bundleMtimeMs: number;
}): string {
  return [
    `sha256 ${input.digest.slice(0, 12)}`,
    `commit ${input.head ?? "(不明)"}`,
    `build ${formatLocalMinute(new Date(input.bundleMtimeMs))}`,
  ].join(" · ");
}

// ─── 檔案系統 ─────────────────────────────────────────────────────────────

/** 走訪 .app，收集雜湊清單所需的每一項。 */
export function collectEntries(root: string): BundleEntry[] {
  const entries: BundleEntry[] = [];

  const walk = (absDir: string, relDir: string): void => {
    for (const dirent of readdirSync(absDir, { withFileTypes: true })) {
      const abs = join(absDir, dirent.name);
      const rel = relDir ? `${relDir}/${dirent.name}` : dirent.name;
      // lstat 而非 stat：symlink 要看它自己，不能跟隨。
      const stat = lstatSync(abs);
      if (stat.isSymbolicLink()) {
        entries.push({
          path: rel,
          kind: "symlink",
          digest: createHash("sha256").update(readlinkSync(abs), "utf8").digest("hex"),
          mode: stat.mode,
        });
      } else if (stat.isDirectory()) {
        entries.push({ path: rel, kind: "dir", digest: "-", mode: stat.mode });
        walk(abs, rel);
      } else {
        entries.push({
          path: rel,
          kind: "file",
          digest: createHash("sha256").update(readFileSync(abs)).digest("hex"),
          mode: stat.mode,
        });
      }
    }
  };

  walk(root, "");
  return entries;
}

export function hashBundle(root: string): { digest: string; entryCount: number } {
  const entries = collectEntries(root);
  return { digest: digestOfManifest(buildManifest(entries)), entryCount: entries.length };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ─── 交易式換裝 ───────────────────────────────────────────────────────────

export type InstallOutcome = {
  ok: boolean;
  sourceDigest: string;
  targetDigest: string;
  entryCount: number;
  reason: string | null;
  /** 失敗時是否已把舊版 rename 回原位。 */
  rolledBack: boolean;
  /** 成功時＝待清除的備份路徑；回滾失敗時＝舊版還躺在哪裡。null 代表沒有備份。 */
  backupKept: string | null;
};

export type InstallBundleOptions = {
  source: string;
  install: string;
  backup: string;
  log?: (message: string) => void;
  /**
   * 故障注入縫：在 ditto 之後、雜湊之前呼叫。正式流程不傳。
   * 存在的理由是回滾路徑必須能被真的觸發一次而不是靠推論——
   * 傳一個把目標弄壞的函式進來，rename／ditto／雜湊／回滾全部照跑真的。
   */
  onAfterCopy?: () => void;
};

/**
 * 換裝本體。成功時**不會**刪備份——由呼叫端決定何時刪（本腳本刻意等到
 * 啟動驗證也過了才刪，比「驗完雜湊就刪」更保守）。
 */
export function installBundle(options: InstallBundleOptions): InstallOutcome {
  const { source, install, backup, log = () => {}, onAfterCopy } = options;

  // 前一輪在交易中途死掉的殘骸：安裝路徑不見、備份還在 → 先救回原位。
  // 少了這段，下面的 rmSync(backup) 會把唯一一份舊版刪掉。
  if (!existsSync(install) && existsSync(backup)) {
    renameSync(backup, install);
    log(`偵測到前一輪的孤兒備份，已復原：${backup}`);
  }
  // 兩邊都在 → 備份是上一輪成功換裝後沒清掉的殘骸，可以丟。
  if (existsSync(backup)) rmSync(backup, { recursive: true, force: true });

  const hadPrevious = existsSync(install);
  let sourceDigest = "";
  let targetDigest = "";
  let entryCount = 0;

  const rollback = (why: string): InstallOutcome => {
    log(`失敗：${why}`);
    log("回滾中……");
    try {
      rmSync(install, { recursive: true, force: true });
      if (hadPrevious) renameSync(backup, install);
      log(hadPrevious ? "已把舊版 rename 回原位" : "原本就沒有安裝版，已清掉半成品");
      return {
        ok: false,
        sourceDigest,
        targetDigest,
        entryCount,
        reason: why,
        rolledBack: true,
        backupKept: null,
      };
    } catch (error) {
      return {
        ok: false,
        sourceDigest,
        targetDigest,
        entryCount,
        reason: `${why}；而且回滾也失敗：${errorMessage(error)}`,
        rolledBack: false,
        backupKept: hadPrevious ? backup : null,
      };
    }
  };

  if (hadPrevious) {
    // rename 而非 rm：同檔案系統的原子操作，不搬資料，失敗時原封不動搬得回來。
    renameSync(install, backup);
    log(`舊版已移到備份：${backup}`);
  } else {
    log("原本沒有安裝版，不需備份");
  }

  try {
    // ditto 而非 cp -R：ditto 是 macOS 對 bundle 的正規複製工具，
    // 會保留延伸屬性與權限位；cp -R 在部分 xattr 上會靜默丟失。
    execFileSync("ditto", [source, install], { stdio: "inherit" });
  } catch (error) {
    return rollback(`ditto 複製失敗：${errorMessage(error)}`);
  }
  if (!existsSync(install)) return rollback("複製後目標路徑不存在");
  log("新版已就位");

  onAfterCopy?.();

  try {
    const sourceHash = hashBundle(source);
    const targetHash = hashBundle(install);
    sourceDigest = sourceHash.digest;
    targetDigest = targetHash.digest;
    entryCount = targetHash.entryCount;
  } catch (error) {
    return rollback(`雜湊失敗：${errorMessage(error)}`);
  }
  log(`來源  ${sourceDigest}  (${entryCount} 項)`);
  log(`目標  ${targetDigest}  (${entryCount} 項)`);

  const verdict = verifyDigests(sourceDigest, targetDigest);
  if (!verdict.ok) return rollback(verdict.reason ?? "雜湊比對失敗");

  return {
    ok: true,
    sourceDigest,
    targetDigest,
    entryCount,
    reason: null,
    rolledBack: false,
    backupKept: hadPrevious ? backup : null,
  };
}

// ─── git ──────────────────────────────────────────────────────────────────

export function gitShortHead(repoRoot: string): string | null {
  try {
    const out = execFileSync("git", ["-C", repoRoot, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

export function gitLastCommitMs(repoRoot: string): number | null {
  try {
    const out = execFileSync("git", ["-C", repoRoot, "log", "-1", "--format=%ct"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const seconds = Number.parseInt(out.trim(), 10);
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  } catch {
    return null;
  }
}

// ─── 執行 ─────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 6;
let stepIndex = 0;

function step(label: string): void {
  stepIndex += 1;
  console.log(`\n▸ ${stepIndex}/${TOTAL_STEPS} ${label}`);
}

function ok(message: string): void {
  console.log(`  ✔ ${message}`);
}

function warn(message: string): void {
  console.log(`  ⚠ ${message}`);
}

function fail(message: string): never {
  console.error(`\n✖ 換裝中止：${message}`);
  process.exit(1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 回傳該變體安裝版的 PID；沒在跑就回空陣列。 */
function installedPids(variant: Variant): number[] {
  try {
    const out = execFileSync("pgrep", ["-f", toPgrepPattern(variant.installedBinaryPath)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out
      .split("\n")
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    // pgrep 找不到程序時退出碼 1，execFileSync 會丟錯——這是正常情況。
    return [];
  }
}

/**
 * 關閉安裝版。用訊號而不是 AppleScript：`osascript ... to quit` 會觸發 macOS
 * 的自動化授權對話框，一個需要人按確認的步驟會直接毀掉「一鍵」這個前提。
 */
async function quitInstalledApp(variant: Variant): Promise<void> {
  let pids = installedPids(variant);
  if (pids.length === 0) {
    ok("安裝版沒在執行，不需關閉");
    return;
  }

  ok(`偵測到執行中（PID ${pids.join(", ")}），送出 SIGTERM`);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // 程序剛好自己結束了，忽略。
    }
  }

  for (let i = 0; i < 40 && installedPids(variant).length > 0; i += 1) await sleep(250);
  pids = installedPids(variant);
  if (pids.length === 0) {
    ok("已關閉");
    return;
  }

  ok(`10 秒內未結束，送出 SIGKILL（PID ${pids.join(", ")}）`);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // 同上。
    }
  }

  for (let i = 0; i < 12 && installedPids(variant).length > 0; i += 1) await sleep(250);
  if (installedPids(variant).length > 0) {
    fail(`${variant.productName} 關不掉，換裝會拿到半舊半新的 bundle`);
  }
  ok("已強制關閉");
}

/** open 之後等進程真的出現。換裝成功 ≠ 能跑；crash-on-launch 不能留給下一輪發現。 */
async function waitForLaunch(variant: Variant, timeoutMs: number): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const pids = installedPids(variant);
    if (pids.length > 0) return pids;
    if (Date.now() >= deadline) return [];
    await sleep(250);
  }
}

async function main(): Promise<void> {
  let flags: InstallFlags;
  try {
    flags = parseFlags(process.argv.slice(2));
  } catch (error) {
    console.error(`\n✖ ${errorMessage(error)}`);
    process.exit(1);
  }

  const variant = variantFor(flags.variant);
  const repoRoot = join(import.meta.dir, "..");
  const source = resolveBundlePath(repoRoot, variant);
  const backup = backupPathFor(variant.installPath);
  const startedAt = Date.now();

  console.log(`Anchorline 一鍵換裝（${variant.productName}）`);
  console.log(`  repo   ${repoRoot}`);
  console.log(`  來源   ${source}`);
  console.log(`  目標   ${variant.installPath}`);
  console.log(`  備份   ${backup}`);

  // 1 — build
  step(flags.skipBuild ? "建置（--skip-build，略過）" : `建置 bun run ${variant.buildScript}`);
  if (flags.skipBuild) {
    ok("略過；換裝的是現有 bundle");
  } else {
    const buildStartedAt = Date.now();
    try {
      execFileSync("bun", ["run", variant.buildScript], { cwd: repoRoot, stdio: "inherit" });
    } catch {
      // 這裡中止而不繼續，是整支腳本存在的理由：舊版留在原地比裝到半殘好。
      fail(`build 失敗（bun run ${variant.buildScript} 非零退出）。修好再換裝。\n  /Applications 完全沒被碰過。`);
    }
    ok(`build 完成（${formatDuration(Date.now() - buildStartedAt)}）`);
  }

  // 2 — 產物 + 指紋 + 陳舊檢查
  step("確認 bundle 產物");
  if (!existsSync(source)) {
    fail(
      `找不到 bundle：${source}` +
        (flags.skipBuild ? `\n  （--skip-build 時要先自己跑過一次 bun run ${variant.buildScript}）` : ""),
    );
  }
  if (!lstatSync(source).isDirectory()) fail(`${source} 不是目錄，不像是一個 .app bundle`);
  const bundleMtimeMs = statSync(source).mtimeMs;
  const head = gitShortHead(repoRoot);
  const lastCommitMs = gitLastCommitMs(repoRoot);
  ok("產物存在");
  if (isStaleBuild(bundleMtimeMs, lastCommitMs)) {
    warn(
      `你在裝一個比最後一次 commit 還舊的 build` +
        `（產物 ${formatLocalMinute(new Date(bundleMtimeMs))}，` +
        `最後 commit ${formatLocalMinute(new Date(lastCommitMs ?? 0))}）——確定不用重 build？`,
    );
  }

  // 3 — 關閉執行中的舊版
  step("關閉執行中的安裝版");
  await quitInstalledApp(variant);

  // 4 — 交易式換裝
  step("交易式換裝（備份 → 複製 → 雙邊 sha256）");
  const outcome = installBundle({ source, install: variant.installPath, backup, log: ok });
  if (!outcome.ok) {
    if (outcome.rolledBack) {
      fail(`${outcome.reason}\n  已回滾，${variant.installPath} 仍是換裝前那一版。`);
    }
    fail(
      `${outcome.reason}\n  ⚠️ 回滾沒有成功。舊版還在：${outcome.backupKept}\n` +
        `  手動復原：mv "${outcome.backupKept}" "${variant.installPath}"`,
    );
  }
  ok("雙邊 sha256 一致");

  // 5 — 啟動驗證
  step(flags.noOpen ? "啟動驗證（--no-open，略過）" : `開啟並確認 ${variant.productName} 起得來`);
  if (flags.noOpen) {
    ok("略過");
  } else {
    try {
      // 帶完整路徑而不是 `open -a Anchorline`：後者交給 LaunchServices 挑，
      // 它可能挑到 target/ 底下那份剛 build 出來的，於是又驗到了不是安裝版的東西。
      execFileSync("open", ["-a", variant.installPath], { stdio: "inherit" });
    } catch (error) {
      fail(`open 失敗：${errorMessage(error)}\n  新版已就位但開不起來；備份還在 ${backup}`);
    }
    const pids = await waitForLaunch(variant, 20_000);
    if (pids.length === 0) {
      // 刻意不自動回滾：Scott 需要那份裝上去的 build 留在原地才能查 crash。
      // 但備份也刻意不刪，一行指令就能退回去。
      fail(
        `20 秒內沒看到 ${variant.installedBinaryPath} 的進程——換裝成功但起不來。\n` +
          `  新版留在 ${variant.installPath} 供你查 crash。\n` +
          `  要退回舊版：rm -rf "${variant.installPath}" && mv "${backup}" "${variant.installPath}"`,
      );
    }
    ok(`已啟動（PID ${pids.join(", ")}）`);
  }

  // 6 — 清備份 + 指紋
  // 刻意等到啟動驗證也過了才刪備份，而不是驗完雜湊就刪：多留幾秒的備份不花成本，
  // 但少了它，crash-on-launch 就沒有退路。
  step("清除備份");
  if (outcome.backupKept && existsSync(outcome.backupKept)) {
    rmSync(outcome.backupKept, { recursive: true, force: true });
    ok("備份已清除");
  } else {
    ok("沒有備份需要清除");
  }

  console.log(`\n✔ 換裝完成（${formatDuration(Date.now() - startedAt)}）`);
  console.log(`  ${formatFingerprint({ digest: outcome.targetDigest, head, bundleMtimeMs })}`);
  console.log(`  sha256 全碼  ${outcome.targetDigest}`);
}

// 只有被當成進入點執行時才跑；tests/install-app.test.ts 匯入本檔取純函式與 installBundle。
if (import.meta.main) {
  await main();
}
