import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { parseUatReport } from "../src/lib/uat-parser";

const REPO_ROOT = resolve(import.meta.dir, "..");

type CliRun = {
  rootDir: string;
  handoffDir: string;
  stdout: string;
  stderr: string;
  exitCode: number;
};

type UatSpec = {
  title: string;
  context?: string;
  items: Array<{
    title: string;
    steps: string[];
    expected: string;
  }>;
};

async function withSandbox<T>(
  run: (box: { rootDir: string; handoffDir: string }) => Promise<T> | T,
): Promise<T> {
  const rootDir = mkdtempSync(join(tmpdir(), "uat-cli-root-"));
  const handoffDir = mkdtempSync(join(tmpdir(), "uat-cli-handoff-"));
  try {
    return await run({ rootDir, handoffDir });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
    rmSync(handoffDir, { recursive: true, force: true });
  }
}

async function runCli(
  spec: UatSpec | string,
  opts: {
    rootDir?: string;
    handoffDir?: string;
    viaStdin?: boolean;
  } = {},
): Promise<CliRun> {
  const rootDir = opts.rootDir ?? mkdtempSync(join(tmpdir(), "uat-cli-root-"));
  const handoffDir = opts.handoffDir ?? mkdtempSync(join(tmpdir(), "uat-cli-handoff-"));
  const specText = typeof spec === "string" ? spec : JSON.stringify(spec, null, 2);
  const specPath = join(rootDir, "spec.json");
  const args = ["bun", "src/cli/uat.ts", "--spec", opts.viaStdin ? "-" : specPath, "--root", rootDir, "--no-open"];

  if (!opts.viaStdin) writeFileSync(specPath, specText);

  const proc = Bun.spawn({
    cmd: args,
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ANCHORLINE_HANDOFF_DIR: handoffDir,
    },
    stdin: opts.viaStdin ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  if (opts.viaStdin) {
    proc.stdin.write(specText);
    proc.stdin.end();
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { rootDir, handoffDir, stdout, stderr, exitCode };
}

function sampleSpec(title = "Checkout redesign"): UatSpec {
  return {
    title,
    items: [
      {
        title: "登入成功後進首頁",
        steps: ["開啟登入頁", "輸入正確帳密", "按下登入"],
        expected: "成功進入首頁並看到歡迎訊息",
      },
      {
        title: "送出前先看確認視窗",
        steps: ["修改收件資訊", "按下送出"],
        expected: "畫面先跳出確認視窗，未直接送出",
      },
    ],
  };
}

function reportPathFrom(stdout: string): string {
  const line = stdout.split(/\r?\n/).find((x) => x.startsWith("報告："));
  expect(line).toBeTruthy();
  return line!.replace("報告：", "").trim();
}

function listPlanFiles(rootDir: string): string[] {
  const plansDir = join(rootDir, "plans");
  if (!existsSync(plansDir)) return [];
  return readdirSync(plansDir).filter((name) => name.endsWith(".md")).sort();
}

function stableShape(text: string) {
  const parsed = parseUatReport(text);
  return {
    title: parsed.title,
    items: parsed.items.map((item) => ({
      title: item.title,
      steps: item.steps,
      expected: item.expected,
      verdict: item.verdict,
      note: item.note,
    })),
  };
}

describe("UAT CLI：真的走 subprocess 時也要守住輸出契約", () => {
  test("happy path：產出報告、stdout 回報路徑與題數，內容能被 parser 完整讀回", async () => {
    await withSandbox(async ({ rootDir, handoffDir }) => {
      const run = await runCli(sampleSpec(), { rootDir, handoffDir });
      expect(run.exitCode).toBe(0);
      expect(run.stderr).toBe("");
      expect(run.stdout).toContain("報告：");
      expect(run.stdout).toContain("題數：2");

      const reportPath = reportPathFrom(run.stdout);
      expect(isAbsolute(reportPath)).toBe(true);
      expect(existsSync(reportPath)).toBe(true);

      const parsed = parseUatReport(readFileSync(reportPath, "utf8"), reportPath);
      expect(parsed.title).toBe("Checkout redesign");
      expect(parsed.items).toHaveLength(2);
      expect(parsed.items[0]).toMatchObject({
        title: "T1 登入成功後進首頁",
        steps: ["開啟登入頁", "輸入正確帳密", "按下登入"],
        expected: "成功進入首頁並看到歡迎訊息",
        verdict: "pending",
      });
      expect(parsed.items[1]).toMatchObject({
        title: "T2 送出前先看確認視窗",
        steps: ["修改收件資訊", "按下送出"],
        expected: "畫面先跳出確認視窗，未直接送出",
        verdict: "pending",
      });
      expect(parsed.items.every((item) => item.verdict === "pending")).toBe(true);
    });
  });

  test("handoff JSON：寫到指定目錄，內容帶絕對 reportPath 與有效 ISO 時間", async () => {
    await withSandbox(async ({ rootDir, handoffDir }) => {
      const run = await runCli(sampleSpec(), { rootDir, handoffDir });
      expect(run.exitCode).toBe(0);

      const reportPath = reportPathFrom(run.stdout);
      // 佇列目錄，一件一檔 —— 單槽會讓連跑兩次 CLI 靜默蓋掉第一份
      const queueDir = join(handoffDir, "uat-handoff");
      const queued = readdirSync(queueDir).filter((f) => f.endsWith(".json"));
      expect(queued).toHaveLength(1);
      const handoffPath = join(queueDir, queued[0]!);

      const handoff = JSON.parse(readFileSync(handoffPath, "utf8")) as {
        v: number;
        reportPath: string;
        createdAt: string;
      };
      expect(handoff.v).toBe(1);
      expect(isAbsolute(handoff.reportPath)).toBe(true);
      expect(handoff.reportPath).toBe(reportPath);
      expect(existsSync(handoff.reportPath)).toBe(true);
      expect(Number.isNaN(Date.parse(handoff.createdAt))).toBe(false);
    });
  });

  test("驗證失敗：一次吐出全部錯誤，而且不留下報告或 handoff", async () => {
    await withSandbox(async ({ rootDir, handoffDir }) => {
      const badSpec = {
        title: "驗證失敗",
        items: [
          {
            title: "缺欄位",
            steps: [""],
          },
        ],
      };

      const run = await runCli(badSpec as unknown as UatSpec, { rootDir, handoffDir });
      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain("UAT spec 驗證失敗");
      expect(run.stderr).toContain("items[0].steps：至少一步");
      expect(run.stderr).toContain("items[0].expected：必填");
      expect(listPlanFiles(rootDir)).toHaveLength(0);
      expect(existsSync(join(handoffDir, "uat-handoff"))).toBe(false);
    });
  });

  test("Malformed JSON：exit 1，訊息可讀，沒有原始 stack trace", async () => {
    await withSandbox(async ({ rootDir, handoffDir }) => {
      const run = await runCli("{ bad json", { rootDir, handoffDir });
      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain("spec JSON 解析失敗");
      expect(run.stderr).not.toContain("\n    at ");
      expect(listPlanFiles(rootDir)).toHaveLength(0);
      expect(existsSync(join(handoffDir, "uat-handoff"))).toBe(false);
    });
  });

  test("同一份 spec 跑兩次：不覆寫，第二份自動補 -2，第一份位元組保持不變", async () => {
    await withSandbox(async ({ rootDir, handoffDir }) => {
      const first = await runCli(sampleSpec(), { rootDir, handoffDir });
      const firstPath = reportPathFrom(first.stdout);
      const firstBytes = readFileSync(firstPath, "utf8");

      const second = await runCli(sampleSpec(), { rootDir, handoffDir });
      const secondPath = reportPathFrom(second.stdout);
      expect(firstPath).not.toBe(secondPath);
      expect(basename(secondPath)).toBe("uat-checkout-redesign-2.md");
      expect(readFileSync(firstPath, "utf8")).toBe(firstBytes);
      // 兩次交件都要在佇列裡 —— App 取件前連跑兩次，第一份不能被蓋掉
      const queued = readdirSync(join(handoffDir, "uat-handoff")).filter((f) =>
        f.endsWith(".json"),
      );
      expect(queued).toHaveLength(2);
    });
  });

  test("stdin：`--spec -` 也能產出等價報告", async () => {
    await withSandbox(async ({ rootDir, handoffDir }) => {
      const fileRun = await runCli(sampleSpec("From stdin"), { rootDir, handoffDir });
      const fileReport = readFileSync(reportPathFrom(fileRun.stdout), "utf8");

      const stdinRoot = mkdtempSync(join(tmpdir(), "uat-cli-root-"));
      const stdinHandoff = mkdtempSync(join(tmpdir(), "uat-cli-handoff-"));
      try {
        const stdinRun = await runCli(sampleSpec("From stdin"), {
          rootDir: stdinRoot,
          handoffDir: stdinHandoff,
          viaStdin: true,
        });
        const stdinReport = readFileSync(reportPathFrom(stdinRun.stdout), "utf8");
        expect(stdinRun.exitCode).toBe(0);
        expect(stableShape(stdinReport)).toEqual(stableShape(fileReport));
      } finally {
        rmSync(stdinRoot, { recursive: true, force: true });
        rmSync(stdinHandoff, { recursive: true, force: true });
      }
    });
  });

  test("plans/ 不存在也會自動建立", async () => {
    await withSandbox(async ({ rootDir, handoffDir }) => {
      expect(existsSync(join(rootDir, "plans"))).toBe(false);
      const run = await runCli(sampleSpec(), { rootDir, handoffDir });
      expect(run.exitCode).toBe(0);
      expect(existsSync(join(rootDir, "plans"))).toBe(true);
      expect(listPlanFiles(rootDir)).toHaveLength(1);
    });
  });

  test("純中文標題：檔名直接保留中文，且絕不能出現 uat-uat-", async () => {
    await withSandbox(async ({ rootDir, handoffDir }) => {
      const run = await runCli(sampleSpec("登入流程驗證"), { rootDir, handoffDir });
      expect(run.exitCode).toBe(0);
      const reportPath = reportPathFrom(run.stdout);
      const filename = basename(reportPath).normalize("NFC");
      expect(filename).toBe("uat-登入流程驗證.md");
      expect(filename.includes("uat-uat-")).toBe(false);
    });
  });

  test("混合中英標題：英文只小寫 ASCII、中文保留原樣，連續空白會收斂成單一連字號", async () => {
    await withSandbox(async ({ rootDir, handoffDir }) => {
      const run = await runCli(sampleSpec("  登入   Login   Flow  "), { rootDir, handoffDir });
      expect(run.exitCode).toBe(0);
      const filename = basename(reportPathFrom(run.stdout)).normalize("NFC");
      expect(filename).toBe("uat-登入-login-flow.md");
    });
  });

  test("危險字元：會從檔名移除，且 `/` 不會把報告寫出 plans/ 之外", async () => {
    await withSandbox(async ({ rootDir, handoffDir }) => {
      const run = await runCli(sampleSpec('登入 / Login: "Happy Path"'), { rootDir, handoffDir });
      expect(run.exitCode).toBe(0);
      const reportPath = reportPathFrom(run.stdout);
      const filename = basename(reportPath).normalize("NFC");
      expect(filename).toBe("uat-登入-login-happy-path.md");
      expect(filename.includes("/")).toBe(false);
      expect(filename.includes(":")).toBe(false);
      expect(filename.includes('"')).toBe(false);
      expect(dirname(reportPath)).toBe(join(rootDir, "plans"));
    });
  });

  test("控制字元：會直接移除，不留下額外連字號", async () => {
    await withSandbox(async ({ rootDir, handoffDir }) => {
      const title = `登入${String.fromCharCode(0)}流程${String.fromCharCode(31)}驗證${String.fromCharCode(127)}`;
      const run = await runCli(sampleSpec(title), { rootDir, handoffDir });
      expect(run.exitCode).toBe(0);
      const filename = basename(reportPathFrom(run.stdout)).normalize("NFC");
      expect(filename).toBe("uat-登入流程驗證.md");
    });
  });

  test("NFD 輸入：CLI 輸出的檔名位元組要收斂成 NFC", async () => {
    await withSandbox(async ({ rootDir, handoffDir }) => {
      const run = await runCli(sampleSpec("Cafe\u0301"), { rootDir, handoffDir });
      expect(run.exitCode).toBe(0);
      const filename = basename(reportPathFrom(run.stdout));
      const stem = filename.replace(/^uat-/, "").replace(/\.md$/, "");
      expect(Array.from(stem, (char) => char.codePointAt(0)!)).toEqual([0x63, 0x61, 0x66, 0xe9]);
      expect(stem).toBe(stem.normalize("NFC"));
      expect(stem).not.toBe(stem.normalize("NFD"));
    });
  });

  test("全危險字元標題：slug 會變空字串，檔名退回時間戳格式", async () => {
    await withSandbox(async ({ rootDir, handoffDir }) => {
      const run = await runCli(sampleSpec("//::**"), { rootDir, handoffDir });
      expect(run.exitCode).toBe(0);
      const filename = basename(reportPathFrom(run.stdout)).normalize("NFC");
      expect(filename).toMatch(/^uat-\d{8}-\d{4}(-\d+)?\.md$/);
      expect(filename.includes("uat-uat-")).toBe(false);
    });
  });

  test("ASCII 標題：檔名要轉成 kebab-case", async () => {
    await withSandbox(async ({ rootDir, handoffDir }) => {
      const run = await runCli(sampleSpec("Checkout redesign"), { rootDir, handoffDir });
      expect(basename(reportPathFrom(run.stdout))).toBe("uat-checkout-redesign.md");
    });
  });

  test("頭尾句點：會被修掉，但中間句點保留", async () => {
    await withSandbox(async ({ rootDir, handoffDir }) => {
      const run = await runCli(sampleSpec("..版本 v1.0.."), { rootDir, handoffDir });
      expect(run.exitCode).toBe(0);
      const filename = basename(reportPathFrom(run.stdout)).normalize("NFC");
      expect(filename).toBe("uat-版本-v1.0.md");
    });
  });

  test("超長中文標題：檔名截斷到檔案系統上限內，不會拋 ENAMETOOLONG", async () => {
    await withSandbox(async ({ rootDir, handoffDir }) => {
      // 300 個中文字。中文放行之前這條路徑碰不到（CJK 一律退時間戳），
      // 拿掉截斷的症狀是 writeFileSync 直接炸、exitCode 非 0。
      const run = await runCli(sampleSpec("登入流程驗證".repeat(50)), { rootDir, handoffDir });
      expect(run.exitCode).toBe(0);
      expect(run.stderr).toBe("");

      const reportPath = reportPathFrom(run.stdout);
      const filename = basename(reportPath).normalize("NFC");
      expect(Array.from(filename).length).toBeLessThanOrEqual(255);
      expect(existsSync(reportPath)).toBe(true);
      // 截斷過但仍要保有辨識度，而且尾巴不能停在連字號或句點上
      expect(filename.startsWith("uat-登入流程驗證")).toBe(true);
      const stem = filename.replace(/^uat-/, "").replace(/\.md$/, "");
      expect(stem.endsWith("-")).toBe(false);
      expect(stem.endsWith(".")).toBe(false);
    });
  });

  test("CLI 真的寫出帶 context 的檔頭，而且 parser 讀回的 preamble 不能是空的", async () => {
    await withSandbox(async ({ rootDir, handoffDir }) => {
      const spec: UatSpec = {
        title: "Context from CLI",
        context: "目的：CLI 驗證\n\n**環境：** sandbox\n保留 `code`",
        items: [
          {
            title: "唯一一題",
            steps: ["從 CLI 產檔"],
            expected: "檔頭帶入 context blockquote",
          },
        ],
      };

      const run = await runCli(spec, { rootDir, handoffDir });
      expect(run.exitCode).toBe(0);
      expect(run.stderr).toBe("");

      const reportPath = reportPathFrom(run.stdout);
      const text = readFileSync(reportPath, "utf8");
      const lines = text.split("\n");
      const statusAt = lines.findIndex((line) => line.startsWith("**狀態：**"));
      const firstSection = lines.findIndex((line) => line.startsWith("## "));
      expect(statusAt).toBeGreaterThanOrEqual(0);
      expect(firstSection).toBeGreaterThan(statusAt);
      expect(lines.slice(statusAt + 2, firstSection)).toEqual([
        "> 目的：CLI 驗證",
        ">",
        "> **環境：** sandbox",
        "> 保留 `code`",
        "",
        "> 在 Anchorline 的 Task Tracking 開這一份逐題勾選。「失敗」與「不測」必須填說明。",
        "",
      ]);

      const parsed = parseUatReport(text, reportPath);
      expect(parsed.preamble).toBe(
        [
          "> 目的：CLI 驗證",
          ">",
          "> **環境：** sandbox",
          "> 保留 `code`",
          "",
          "> 在 Anchorline 的 Task Tracking 開這一份逐題勾選。「失敗」與「不測」必須填說明。",
        ].join("\n"),
      );
    });
  });
});
