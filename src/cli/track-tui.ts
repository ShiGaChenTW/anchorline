#!/usr/bin/env bun
/**
 * Anchorline · 真·終端 TUI（計劃追蹤）
 *
 * 用法：
 *   bun run track              # 互動 TUI
 *   bun run track --once       # 單次印出後結束（適合 pipe / CI）
 *   bun run src/cli/track-tui.ts --dir ./plans
 *
 * 鍵位：j/k 切 plan · J/K 或 PgDn/PgUp 捲步驟 · r 重新整理 · ? 說明 · q 離開
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  asStatusWord,
  mintMissingIds,
  parsePlanMeta,
  planProgress,
  planProgressPct,
  type PlanMeta,
  type StatusWord,
  type StepState,
} from "../lib/plan-parser";
import { sortByRecency, trackingTarget, type TrackingSignal } from "../lib/tracking";
import { sinceLabel } from "../lib/time-format";
import {
  c,
  dw,
  enterAlt,
  ESC,
  hline,
  leaveAlt,
  pad,
  pal,
  syncFrame,
  termSize,
} from "./ansi";

type PlanEntry = { path: string; name: string; meta: PlanMeta; mtimeMs: number };

const CLI_DIR = dirname(fileURLToPath(import.meta.url));

/** spec §4 的跨進程介面。目前沒有寫入端，讀不到就是段 2 全責。 */
const SIGNAL_PATH = join(
  process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
  "anchorline",
  "active",
);

function readSignal(): TrackingSignal | null {
  try {
    return {
      raw: readFileSync(SIGNAL_PATH, "utf8"),
      mtimeMs: statSync(SIGNAL_PATH).mtimeMs,
    };
  } catch {
    return null; // 檔不存在／權限／讀壞 —— 全部不是錯誤，是「退回段 2」
  }
}

function findPlansDir(cliDir?: string): string {
  if (cliDir) return resolve(cliDir);
  const cwd = process.cwd();
  const candidates = [
    join(cwd, "plans"),
    join(cwd, "anchorline", "plans"),
    join(cwd, "PM-SPEC+SCVB", "plans"), // 過渡：改名前的資料夾名，之後可拔
    resolve(CLI_DIR, "../../plans"),
  ];
  for (const p of candidates) {
    if (existsSync(p) && statSync(p).isDirectory()) return p;
  }
  return join(cwd, "plans");
}

function loadPlans(dir: string): PlanEntry[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const path = join(dir, f);
      try {
        const raw = readFileSync(path, "utf8");
        return { path, name: f, meta: parsePlanMeta(raw, f), mtimeMs: statSync(path).mtimeMs };
      } catch {
        // readdir 與 read 之間被刪掉。NaN 讓 sortByRecency 濾掉它，不影響其他檔。
        return { path, name: f, meta: parsePlanMeta("", f), mtimeMs: NaN };
      }
    });
  return sortByRecency(entries);
}

/**
 * 進度條刻意用 ASCII `=` / `.`，不用 █ ░。
 * 某些等寬字型會把相鄰的 block glyph 反鋸齒黏成一整條實色，刻度就看不出來了；
 * `=` 之間永遠有間隙。ASCII 也讓輸出貼進 issue 或 CI log 時不依賴字型。
 */
export function bar(pct: number, width: number): string {
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * width);
  const empty = Math.max(0, width - filled);
  return `${pal.accent}${"=".repeat(filled)}${pal.muted}${".".repeat(empty)}${c.reset}`;
}

/**
 * 更新時間顯示成「多久以前」。plan 檔寫的是絕對時間戳，但「看一眼」要問的是
 * 「這份還熱嗎」——絕對時間得自己心算。解析不了就原樣吐回，不假裝知道。
 */
export function relTime(raw: string, nowMs: number): string {
  if (!raw || raw === "—") return "—";
  const rel = sinceLabel(raw.replace(" ", "T"), nowMs);
  return rel === "從未" ? raw : rel;
}

/** braille spinner：只在有 agent 在寫時轉。不轉 = 沒東西在動，那本身就是資訊。 */
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * 狀態 → 圖示 + 顏色。Record<StatusWord,…> 讓新增狀態詞時這裡編不過，
 * 而不是靜默套用預設值畫錯。§2.2：一個意思一個字形。
 */
const STATUS_UI: Record<StatusWord, { icon: string; color: string }> = {
  進行中: { icon: "◐", color: pal.accent },
  已完成: { icon: "✔", color: pal.success },
  已暫停: { icon: "⏸", color: pal.warn },
  已放棄: { icon: "✗", color: pal.muted },
  阻塞: { icon: "⚠", color: pal.danger },
};
const STATUS_UNKNOWN = { icon: "?", color: pal.muted };

/** 完全比對，不做子字串。對不上回未知——不猜。 */
function statusUi(status: string) {
  const w = asStatusWord(status);
  return w ? STATUS_UI[w] : STATUS_UNKNOWN;
}

/** 步驟圖示同樣收成 Record——加 StepState 忘了處理的那一側編不過。 */
const STEP_UI: Record<StepState, { icon: string; color: string; textColor: string }> = {
  done: { icon: "✔", color: pal.success, textColor: pal.muted },
  skipped: { icon: "✗", color: pal.muted, textColor: pal.muted },
  pending: { icon: "○", color: pal.accent, textColor: pal.text },
};

type UiState = {
  plans: PlanEntry[];
  /** 使用者選的（按鍵才變）。與 tracking 是兩個獨立的「當前」，見 spec §2 */
  idx: number;
  /** 系統判定的（隨檔案活動變）。永遠不寫進 idx —— 那會把使用者的畫面搶走 */
  tracking: string | null;
  stepScroll: number;
  showHelp: boolean;
  plansDir: string;
  message: string;
  /** spinner 相位。只在有追蹤目標時前進，所以靜止畫面會被整幀去重擋掉。 */
  tick: number;
};

/** 每次重繪重算，不快取。純函式 + 幾個 stat，比一次終端重繪便宜得多。 */
function refresh(state: UiState) {
  state.plans = loadPlans(state.plansDir);
  state.tracking = trackingTarget({ files: state.plans, signal: readSignal() }, Date.now());
  state.idx = Math.min(state.idx, Math.max(0, state.plans.length - 1));
}

/** 完整雙欄的下限。低於這個就砍側欄，不是把版面壓扁。 */
const FULL_COLS = 100;
const FULL_ROWS = 28;
/** 版面引擎本身的下限。低於這個連單欄都排不出來。 */
const MIN_COLS = 50;
const MIN_ROWS = 12;

/**
 * 太小就不畫，只印一行字。
 *
 * 舊寫法是 `Math.max(60, cols)`：40 欄的終端照樣按 60 欄排版，內容比終端寬，
 * 每一列都被終端自動換行推歪。夾住數字不會讓版面變得排得下——版面引擎正是在
 * 這個尺寸失效的東西，所以正解是不啟動它。
 */
export function tooSmall(cols: number, rows: number): string[] | null {
  if (cols >= MIN_COLS && rows >= MIN_ROWS) return null;
  const msg = `終端太小 ${cols}×${rows}`;
  const need = `需要至少 ${MIN_COLS}×${MIN_ROWS}`;
  const out: string[] = [];
  for (let i = 0; i < Math.max(0, Math.floor(rows / 2) - 1); i++) out.push("");
  for (const s of [msg, need]) {
    const indent = Math.max(0, Math.floor((cols - dw(s)) / 2));
    out.push(" ".repeat(indent) + s);
  }
  return out.slice(0, Math.max(1, rows));
}

function render(state: UiState): string[] {
  const { cols, rows } = termSize();
  const small = tooSmall(cols, rows);
  if (small) return small;

  // 真實尺寸，不夾。側欄在窄視窗直接不畫——壓扁的側欄比沒有側欄更難讀。
  const W = cols;
  const H = rows;
  const compact = cols < FULL_COLS || rows < FULL_ROWS;
  const lines: string[] = [];

  const push = (s: string) => lines.push(s.slice(0, 4000));

  // Header
  push(
    `${pal.border}${hline(W, "═")}${c.reset}`,
  );
  push(
    `${c.bold}${pal.title} Anchorline · TRACK TUI ${c.reset}${pal.muted}  ${state.plansDir}${c.reset}`,
  );
  push(`${pal.border}${hline(W, "─")}${c.reset}`);

  if (state.showHelp) {
    push(`${c.bold}${pal.accent} 快捷鍵${c.reset}`);
    push(`  ${pal.text}j / k${pal.muted}     下一個 / 上一個 plan${c.reset}`);
    push(`  ${pal.text}J / K${pal.muted}     步驟清單下捲 / 上捲${c.reset}`);
    push(`  ${pal.text}r${pal.muted}         重新載入 plans/${c.reset}`);
    push(`  ${pal.text}t${pal.muted}         跳到追蹤中（•）的那一份${c.reset}`);
    push(`  ${pal.text}i${pal.muted}         替沒有錨點的步驟鑄造 id（會改檔）${c.reset}`);
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
    push(`${pal.muted}  可在 Anchorline Web 或手動建立 plans/*.md（含 Plan Steps checkbox）${c.reset}`);
    while (lines.length < H - 2) push("");
    push(`${pal.border}${hline(W, "─")}${c.reset}`);
    push(`${pal.muted}  q 離開 · r 重新整理${c.reset}`);
    return lines.slice(0, H);
  }

  const cur = state.plans[state.idx]!;
  const prog = planProgress(cur.meta);
  const pct = prog.pct;
  const st = statusUi(cur.meta.status);
  const now = Date.now();

  // Summary block
  push(
    ` ${c.bold}${pal.title}${pad(cur.meta.title, Math.min(W - 4, 70))}${c.reset}`,
  );
  // 分子走 planProgress().closed，與 pct 同源。印 done_steps 就是 `100% … 21/28` 的來源。
  const skipNote = cur.meta.skipped_steps ? `（含略過 ${cur.meta.skipped_steps}）` : "";
  push(
    ` ${st.color}${st.icon} ${cur.meta.status}${c.reset}${pal.muted}  ·  ${prog.closed}/${prog.total} 已結${skipNote}  ·  ${pct}%  ·  ${cur.name}${c.reset}`,
  );
  push(` ${bar(pct, Math.min(40, W - 6))}`);
  push(
    ` ${pal.muted}下一步 ${c.reset}${pal.accent}${pad(cur.meta.next_step, Math.min(W - 12, 60))}${c.reset}`,
  );
  // 錨點遺失警告。agent 重寫整份 plan 會把錨點抹掉，這些步驟接不上事件流。
  // 只警告不自動修 —— 無聲重鑄會一路產生對不上舊事件的孤兒 id。
  if (cur.meta.unanchored) {
    push(
      ` ${pal.warn}⚠ ${cur.meta.unanchored} 個步驟沒有錨點，接不上事件流${c.reset}${pal.muted} —— 按 i 鑄造${c.reset}`,
    );
  }
  push(`${pal.border}${hline(W, "─")}${c.reset}`);

  // 雙欄：plan 清單 + 步驟。compact 砍掉側欄，步驟吃滿整寬。
  const leftW = compact ? 0 : Math.min(34, Math.floor(W * 0.34));
  const rightW = compact ? W : W - leftW - 1;
  const bodyRows = H - lines.length - 3; // footer

  const listLines: string[] = [];
  for (let i = 0; !compact && i < state.plans.length; i++) {
    const p = state.plans[i]!;
    const mark = i === state.idx ? `${pal.accent}▶${c.reset}` : " ";
    // 追蹤圓點與選取箭頭刻意分屬兩欄 —— 同一列可以同時是「我在看的」和「agent 在寫的」
    const dot = p.path === state.tracking ? `${pal.muted}•${c.reset}` : " ";
    const pp = planProgressPct(p.meta);
    const label = `${mark} ${pad(p.meta.title, leftW - 12)} ${pal.muted}${String(pp).padStart(3)}%${c.reset} ${dot}`;
    listLines.push(i === state.idx ? `${c.inverse}${pad(stripForInverse(label), leftW)}${c.reset}` : pad(label, leftW));
  }

  const stepLines: string[] = [];
  const steps = cur.meta.steps;
  const maxStepsVisible = Math.max(1, bodyRows);
  const maxScroll = Math.max(0, steps.length - maxStepsVisible);
  const scroll = Math.min(state.stepScroll, maxScroll);
  for (let i = scroll; i < steps.length && stepLines.length < maxStepsVisible; i++) {
    const s = steps[i]!;
    const ui = STEP_UI[s.state];
    const icon = `${ui.color}${ui.icon}${c.reset}`;
    const txt = `${ui.textColor}${s.text}${c.reset}`;
    // 錨點 id 佔固定 9 欄。沒有 id 的步驟留 · —— 一眼看得出哪些接不上事件流
    const tag = s.id
      ? `${pal.muted}${s.id}${c.reset}`
      : s.state === "skipped"
        ? `${pal.muted}········${c.reset}`
        : `${pal.warn}無錨點  ${c.reset}`;
    stepLines.push(` ${icon} ${tag} ${pad(txt, rightW - 13)}`);
  }
  if (!steps.length) {
    stepLines.push(` ${pal.muted}（此檔無 Plan Steps checkbox）${c.reset}`);
  }

  const metaExtra = [
    `${pal.muted}目標${c.reset}  ${pad(cur.meta.goal, rightW - 8)}`,
    `${pal.muted}決策${c.reset}  ${pad(cur.meta.last_decision, rightW - 8)}`,
    `${pal.muted}阻塞${c.reset}  ${cur.meta.blockers}  ·  建立 ${relTime(cur.meta.created, now)}  ·  更新 ${relTime(cur.meta.updated, now)}`,
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
    // 兩側都無條件過 pad()——它保證 dw() 等於欄寬。不信任上游算對了寬度，
    // 因為算錯的症狀是邊框歪掉而不是例外，沒有封口就沒人會發現。
    push(
      compact
        ? pad(right, rightW)
        : `${pad(left, leftW)}${pal.border}│${c.reset}${pad(right, rightW)}`,
    );
  }

  push(`${pal.border}${hline(W, "─")}${c.reset}`);
  const msg = state.message ? ` · ${state.message}` : "";
  const tracked = state.plans.find((p) => p.path === state.tracking);
  // 空狀態不暴露判定細節（訊號過期？退回段 2？）—— 內部機制對使用者無意義
  const live = tracked
    ? `${pal.accent}${SPIN[state.tick % SPIN.length]}${c.reset} ${pal.muted}追蹤中 ${c.reset}${pal.text}${tracked.name}${c.reset}`
    : `${pal.muted}等待 agent 開始執行…${c.reset}`;
  // compact 下鍵位提示會擠掉 live，而 live 才是「看一眼」要看的東西
  const hint = compact
    ? `${state.idx + 1}/${state.plans.length}${msg}`
    : ` j/k plan · J/K 捲動 · ? 說明 · q 離開 · ${state.idx + 1}/${state.plans.length}${msg}`;
  push(`${pal.muted}${hint}${c.reset}  ${live}`);

  return lines.slice(0, H);
}

function stripForInverse(s: string): string {
  // inverse + colored segments get messy; use plain for selected row base
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * 畫面去重是必要的：週期刷新每秒觸發，無變化時重畫會讓終端閃爍且吃 CPU。
 * 比對上一幀輸出字串，相同就跳過。
 */
let lastFrame = "";

function draw(state: UiState) {
  const lines = render(state);
  const { rows } = termSize();
  // pad to full screen to avoid ghost lines
  const out = [...lines];
  while (out.length < rows) out.push("");
  const frame = out.slice(0, rows).join("\n");
  if (frame === lastFrame) return;
  lastFrame = frame;
  // 清行序列必須跟在內容之後、包在同步輸出之內；moveHome 也要一起包進去，
  // 否則游標移動與內容分屬兩幀，同步輸出就白做了。
  process.stdout.write(syncFrame(`${ESC}[H${frame}${ESC}[J`));
}

function printOnce(plans: PlanEntry[], dir: string, tracking: string | null) {
  console.log(`${c.bold}Anchorline · track${c.reset}  ${pal.muted}${dir}${c.reset}`);
  console.log(hline(Math.min(80, termSize().cols)));
  if (!plans.length) {
    console.log("（無 plan 檔）");
    return;
  }
  for (const p of plans) {
    const prog = planProgress(p.meta);
    const ui = statusUi(p.meta.status);
    const dot = p.path === tracking ? ` ${pal.accent}•${c.reset}` : "";
    console.log(
      `${ui.color}${ui.icon} ${pad(p.meta.status, 8)}${c.reset} ${bar(prog.pct, 12)} ${String(prog.pct).padStart(3)}%  ${c.bold}${p.meta.title}${c.reset}${dot}`,
    );
    console.log(
      `  ${pal.muted}${prog.closed}/${prog.total} 已結${c.reset}  next: ${pal.accent}${p.meta.next_step}${c.reset}`,
    );
    console.log(`  ${pal.muted}${p.name}${c.reset}`);
    console.log("");
  }
}

async function interactive(plansDir: string) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    once(plansDir);
    return;
  }

  const state: UiState = {
    plans: [],
    idx: 0,
    tracking: null,
    stepScroll: 0,
    showHelp: false,
    plansDir,
    message: "",
    tick: 0,
  };
  refresh(state);

  const onResize = () => draw(state);
  process.stdout.on("resize", onResize);

  // ponytail: 只做週期輪詢，不掛 fs watcher。mtime 重比較本來就得每秒做一次，
  // 加 watch() 只省下 ≤1s 的延遲，卻多一組 debounce 與清理路徑要顧。
  // 125ms 讓 spinner 轉得像在動，但資料每 8 拍才重讀一次 —— 還是 1 秒，
  // 沒有多做檔案 I/O。tick 只在有追蹤目標時前進，所以沒 agent 在寫的時候
  // 整幀完全不變，去重直接擋掉重畫，閒置成本仍然是零。
  let beat = 0;
  const timer = setInterval(() => {
    if (state.showHelp) return;
    if (beat % 8 === 0) refresh(state);
    beat++;
    if (state.tracking) state.tick++;
    draw(state);
  }, 125);

  const cleanup = () => {
    clearInterval(timer);
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
      refresh(state);
      state.stepScroll = 0;
      state.message = `已重整 ${state.plans.length} 檔 · ${new Date().toLocaleTimeString("zh-TW")}`;
      draw(state);
      return;
    }
    // 手動鑄造缺少的錨點。刻意不自動做 —— 無聲改使用者的檔案是最糟的行為，
    // 而且 agent 重寫 plan 時錨點會整批消失，自動重鑄只會一路產生孤兒 id。
    if (key === "i") {
      const cur = state.plans[state.idx];
      if (!cur) return;
      if (!cur.meta.unanchored) {
        state.message = "這份計劃的步驟都已經有錨點了";
        draw(state);
        return;
      }
      try {
        const src = readFileSync(cur.path, "utf8");
        const { text, minted } = mintMissingIds(src);
        if (minted) writeFileSync(cur.path, text, "utf8");
        refresh(state);
        state.message = `已鑄造 ${minted} 個錨點 · ${cur.meta.title}`;
      } catch (e) {
        state.message = `鑄造失敗：${(e as Error).message}`;
      }
      draw(state);
      return;
    }
    // 跳到追蹤目標。判定是自動的，呈現仍然是手動的 —— 畫面不自己跳走
    if (key === "t") {
      const i = state.plans.findIndex((p) => p.path === state.tracking);
      if (i >= 0) {
        state.idx = i;
        state.stepScroll = 0;
        state.message = "";
      } else {
        state.message = "等待 agent 開始執行…";
      }
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

function once(plansDir: string) {
  const plans = loadPlans(plansDir);
  const tracking = trackingTarget({ files: plans, signal: readSignal() }, Date.now());
  printOnce(plans, plansDir, tracking);
}

/**
 * 印出一張完整的互動畫面然後結束。
 *
 * `--once` 是給 pipe 用的摘要清單，看不到步驟與錨點 id；互動模式看得到但需要
 * TTY。截圖、貼進 issue、CI 比對都卡在這中間 —— `--frame` 就是那個中間。
 */
function frame(plansDir: string) {
  const state: UiState = {
    plans: [],
    idx: 0,
    tracking: null,
    stepScroll: 0,
    showHelp: false,
    plansDir,
    message: "",
    tick: 0,
  };
  refresh(state);
  // 追蹤中的那一份就是要看的那一份 —— 截圖不該還要人先按 t
  const t = state.plans.findIndex((p) => p.path === state.tracking);
  if (t >= 0) state.idx = t;
  process.stdout.write(render(state).join("\n") + "\n");
}

function main() {
  const args = process.argv.slice(2);
  const oneShot = args.includes("--once") || args.includes("-1");
  if (args.includes("--frame")) {
    const df = args.findIndex((a) => a === "--dir" || a === "-d");
    frame(findPlansDir(df >= 0 ? args[df + 1] : undefined));
    return;
  }
  const dirFlag = args.findIndex((a) => a === "--dir" || a === "-d");
  const dirArg = dirFlag >= 0 ? args[dirFlag + 1] : undefined;
  const plansDir = findPlansDir(dirArg);

  if (oneShot || !process.stdout.isTTY) {
    once(plansDir);
    return;
  }

  void interactive(plansDir);
}

// 只有被當成程式跑才啟動。測試 import 這個檔是為了拿 bar/relTime/tooSmall，
// 不該順便畫一張畫面出來。
if (import.meta.main) main();
