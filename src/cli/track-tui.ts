#!/usr/bin/env bun
/**
 * PM-SPEC+SCVB · 真·終端 TUI（計劃追蹤）
 *
 * 用法：
 *   bun run track              # 互動 TUI
 *   bun run track --once       # 單次印出後結束（適合 pipe / CI）
 *   bun run src/cli/track-tui.ts --dir ./plans
 *
 * 鍵位：j/k 切 plan · J/K 或 PgDn/PgUp 捲步驟 · r 重新整理 · ? 說明 · q 離開
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePlanMeta, planProgressPct, type PlanMeta } from "../lib/plan-parser";
import {
  c,
  enterAlt,
  hline,
  leaveAlt,
  moveHome,
  pad,
  pal,
  termSize,
} from "./ansi";

type PlanEntry = { path: string; name: string; meta: PlanMeta; mtime: number };

const CLI_DIR = dirname(fileURLToPath(import.meta.url));

function findPlansDir(cliDir?: string): string {
  if (cliDir) return resolve(cliDir);
  const cwd = process.cwd();
  const candidates = [
    join(cwd, "plans"),
    join(cwd, "PM-SPEC+SCVB", "plans"),
    resolve(CLI_DIR, "../../plans"),
  ];
  for (const p of candidates) {
    if (existsSync(p) && statSync(p).isDirectory()) return p;
  }
  return join(cwd, "plans");
}

function loadPlans(dir: string): PlanEntry[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const path = join(dir, f);
      const raw = readFileSync(path, "utf8");
      const meta = parsePlanMeta(raw, f);
      const mtime = statSync(path).mtimeMs;
      return { path, name: f, meta, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function bar(pct: number, width: number): string {
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * width);
  const empty = Math.max(0, width - filled);
  return `${pal.accent}${"█".repeat(filled)}${pal.muted}${"░".repeat(empty)}${c.reset}`;
}

function statusColor(status: string): string {
  if (status.includes("完成")) return pal.success;
  if (status.includes("阻塞")) return pal.danger;
  if (status.includes("暫停") || status.includes("放棄")) return pal.warn;
  return pal.accent;
}

type UiState = {
  plans: PlanEntry[];
  idx: number;
  stepScroll: number;
  showHelp: boolean;
  plansDir: string;
  message: string;
};

function render(state: UiState): string[] {
  const { cols, rows } = termSize();
  const W = Math.max(60, cols);
  const H = Math.max(16, rows);
  const lines: string[] = [];

  const push = (s: string) => lines.push(s.slice(0, 4000));

  // Header
  push(
    `${pal.border}${hline(W, "═")}${c.reset}`,
  );
  push(
    `${c.bold}${pal.title} PM-SPEC+SCVB · TRACK TUI ${c.reset}${pal.muted}  ${state.plansDir}${c.reset}`,
  );
  push(`${pal.border}${hline(W, "─")}${c.reset}`);

  if (state.showHelp) {
    push(`${c.bold}${pal.accent} 快捷鍵${c.reset}`);
    push(`  ${pal.text}j / k${pal.muted}     下一個 / 上一個 plan${c.reset}`);
    push(`  ${pal.text}J / K${pal.muted}     步驟清單下捲 / 上捲${c.reset}`);
    push(`  ${pal.text}r${pal.muted}         重新載入 plans/${c.reset}`);
    push(`  ${pal.text}?${pal.muted}         開關說明${c.reset}`);
    push(`  ${pal.text}q / Esc${pal.muted}   離開${c.reset}`);
    push(`  ${pal.text}1-9${pal.muted}       跳到第 N 個 plan${c.reset}`);
    push("");
    push(`${pal.muted}  來源：S.CodingFlow scvb tracking 概念 · 純終端、零 blessed 依賴${c.reset}`);
    while (lines.length < H - 2) push("");
    push(`${pal.border}${hline(W, "─")}${c.reset}`);
    push(`${pal.muted}  按 ? 或 Esc 返回${c.reset}`);
    return lines.slice(0, H);
  }

  if (!state.plans.length) {
    push(`${pal.warn}  plans/ 沒有 .md 計劃檔${c.reset}`);
    push(`${pal.muted}  目錄：${state.plansDir}${c.reset}`);
    push(`${pal.muted}  可在 SpecForge Web 或手動建立 plans/*.md（含 Plan Steps checkbox）${c.reset}`);
    while (lines.length < H - 2) push("");
    push(`${pal.border}${hline(W, "─")}${c.reset}`);
    push(`${pal.muted}  q 離開 · r 重新整理${c.reset}`);
    return lines.slice(0, H);
  }

  const cur = state.plans[state.idx]!;
  const pct = planProgressPct(cur.meta);
  const stc = statusColor(cur.meta.status);

  // Summary block
  push(
    ` ${c.bold}${pal.title}${pad(cur.meta.title, Math.min(W - 4, 70))}${c.reset}`,
  );
  push(
    ` ${stc}${cur.meta.status}${c.reset}${pal.muted}  ·  ${cur.meta.done_steps}/${cur.meta.total_steps} done  ·  ${pct}%  ·  ${cur.name}${c.reset}`,
  );
  push(` ${bar(pct, Math.min(40, W - 6))}`);
  push(
    ` ${pal.muted}下一步 ${c.reset}${pal.accent}${pad(cur.meta.next_step, Math.min(W - 12, 60))}${c.reset}`,
  );
  push(`${pal.border}${hline(W, "─")}${c.reset}`);

  // Two-column-ish: plan list (left width) + steps
  const leftW = Math.min(34, Math.floor(W * 0.34));
  const rightW = W - leftW - 1;
  const bodyRows = H - lines.length - 3; // footer

  const listLines: string[] = [];
  for (let i = 0; i < state.plans.length; i++) {
    const p = state.plans[i]!;
    const mark = i === state.idx ? `${pal.accent}▶${c.reset}` : " ";
    const pp = planProgressPct(p.meta);
    const label = `${mark} ${pad(p.meta.title, leftW - 10)} ${pal.muted}${String(pp).padStart(3)}%${c.reset}`;
    listLines.push(i === state.idx ? `${c.inverse}${pad(stripForInverse(label), leftW)}${c.reset}` : pad(label, leftW));
  }

  const stepLines: string[] = [];
  const steps = cur.meta.steps;
  const maxStepsVisible = Math.max(1, bodyRows);
  const maxScroll = Math.max(0, steps.length - maxStepsVisible);
  const scroll = Math.min(state.stepScroll, maxScroll);
  for (let i = scroll; i < steps.length && stepLines.length < maxStepsVisible; i++) {
    const s = steps[i]!;
    const icon =
      s.state === "done"
        ? `${pal.success}✔${c.reset}`
        : s.state === "skipped"
          ? `${pal.muted}—${c.reset}`
          : `${pal.accent}○${c.reset}`;
    const txt =
      s.state === "skipped"
        ? `${pal.muted}${s.text}${c.reset}`
        : s.state === "done"
          ? `${pal.muted}${s.text}${c.reset}`
          : `${pal.text}${s.text}${c.reset}`;
    stepLines.push(` ${icon} ${pad(txt, rightW - 4)}`);
  }
  if (!steps.length) {
    stepLines.push(` ${pal.muted}（此檔無 Plan Steps checkbox）${c.reset}`);
  }

  const metaExtra = [
    `${pal.muted}目標${c.reset}  ${pad(cur.meta.goal, rightW - 8)}`,
    `${pal.muted}決策${c.reset}  ${pad(cur.meta.last_decision, rightW - 8)}`,
    `${pal.muted}阻塞${c.reset}  ${cur.meta.blockers}  ·  建立 ${cur.meta.created}  ·  更新 ${cur.meta.updated}`,
  ];

  for (let row = 0; row < bodyRows; row++) {
    const left = listLines[row] ?? " ".repeat(leftW);
    let right = "";
    if (row < stepLines.length) right = stepLines[row]!;
    else if (row === stepLines.length + 1) right = `${pal.border}${hline(Math.max(0, rightW - 2), "·")}${c.reset}`;
    else if (row >= stepLines.length + 2) {
      const mi = row - (stepLines.length + 2);
      right = metaExtra[mi] ?? "";
    }
    const leftPad = pad(left, leftW);
    push(`${leftPad}${pal.border}│${c.reset}${right}`);
  }

  push(`${pal.border}${hline(W, "─")}${c.reset}`);
  const msg = state.message ? ` · ${state.message}` : "";
  push(
    `${pal.muted} j/k plan · J/K 捲動 · r 重整 · ? 說明 · q 離開 · ${state.idx + 1}/${state.plans.length}${msg}${c.reset}`,
  );

  return lines.slice(0, H);
}

function stripForInverse(s: string): string {
  // inverse + colored segments get messy; use plain for selected row base
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function draw(state: UiState) {
  const lines = render(state);
  const { rows } = termSize();
  moveHome();
  // pad to full screen to avoid ghost lines
  const out = [...lines];
  while (out.length < rows) out.push("");
  process.stdout.write(out.slice(0, rows).join("\n") + clearDownSeq());
}

function clearDownSeq() {
  return "\x1b[J";
}

function printOnce(plans: PlanEntry[], dir: string) {
  console.log(`${c.bold}PM-SPEC+SCVB · track${c.reset}  ${pal.muted}${dir}${c.reset}`);
  console.log(hline(Math.min(80, termSize().cols)));
  if (!plans.length) {
    console.log("（無 plan 檔）");
    return;
  }
  for (const p of plans) {
    const pct = planProgressPct(p.meta);
    console.log(
      `${statusColor(p.meta.status)}${pad(p.meta.status, 8)}${c.reset} ${bar(pct, 12)} ${String(pct).padStart(3)}%  ${c.bold}${p.meta.title}${c.reset}`,
    );
    console.log(
      `  ${pal.muted}${p.meta.done_steps}/${p.meta.total_steps}${c.reset}  next: ${pal.accent}${p.meta.next_step}${c.reset}`,
    );
    console.log(`  ${pal.muted}${p.name}${c.reset}`);
    console.log("");
  }
}

async function interactive(plansDir: string) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const plans = loadPlans(plansDir);
    printOnce(plans, plansDir);
    return;
  }

  const state: UiState = {
    plans: loadPlans(plansDir),
    idx: 0,
    stepScroll: 0,
    showHelp: false,
    plansDir,
    message: "",
  };

  const onResize = () => draw(state);
  process.stdout.on("resize", onResize);

  const cleanup = () => {
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
    process.stdout.off("resize", onResize);
    leaveAlt();
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  enterAlt();
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  draw(state);

  const onData = (key: string) => {
    // Ctrl-C
    if (key === "\x03") {
      cleanup();
      process.exit(0);
    }

    if (state.showHelp) {
      if (key === "?" || key === "\x1b" || key === "q") {
        state.showHelp = false;
        state.message = "";
        draw(state);
      }
      return;
    }

    if (key === "q" || key === "\x1b") {
      cleanup();
      process.exit(0);
    }
    if (key === "?") {
      state.showHelp = true;
      draw(state);
      return;
    }
    if (key === "r") {
      state.plans = loadPlans(plansDir);
      state.idx = Math.min(state.idx, Math.max(0, state.plans.length - 1));
      state.stepScroll = 0;
      state.message = `已重整 ${state.plans.length} 檔 · ${new Date().toLocaleTimeString("zh-TW")}`;
      draw(state);
      return;
    }
    if (key === "j" || key === "\x1b[B") {
      state.idx = Math.min(state.plans.length - 1, state.idx + 1);
      state.stepScroll = 0;
      state.message = "";
      draw(state);
      return;
    }
    if (key === "k" || key === "\x1b[A") {
      state.idx = Math.max(0, state.idx - 1);
      state.stepScroll = 0;
      state.message = "";
      draw(state);
      return;
    }
    if (key === "J" || key === "\x1b[6~") {
      state.stepScroll += 3;
      draw(state);
      return;
    }
    if (key === "K" || key === "\x1b[5~") {
      state.stepScroll = Math.max(0, state.stepScroll - 3);
      draw(state);
      return;
    }
    // number jump 1-9
    if (/^[1-9]$/.test(key)) {
      const n = Number(key) - 1;
      if (n < state.plans.length) {
        state.idx = n;
        state.stepScroll = 0;
        draw(state);
      }
    }
  };

  process.stdin.on("data", onData);
}

function main() {
  const args = process.argv.slice(2);
  const once = args.includes("--once") || args.includes("-1");
  const dirFlag = args.findIndex((a) => a === "--dir" || a === "-d");
  const dirArg = dirFlag >= 0 ? args[dirFlag + 1] : undefined;
  const plansDir = findPlansDir(dirArg);

  if (once || !process.stdout.isTTY) {
    printOnce(loadPlans(plansDir), plansDir);
    return;
  }

  void interactive(plansDir);
}

main();
