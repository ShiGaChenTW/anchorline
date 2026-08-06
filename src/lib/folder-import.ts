/**
 * 專案資料夾匯入：掃描 → 對應軟體所需文件 → 內容評分與進度。
 * 輸入來自 <input webkitdirectory> 的 FileList。
 */

export type DocSlot =
  | "prd"
  | "problem"
  | "goals"
  | "metrics"
  | "stories"
  | "tasks"
  | "proposal"
  | "plan"
  | "readme"
  | "other";

export type ScannedFile = {
  path: string;
  name: string;
  size: number;
  text: string;
};

export type SlotMatch = {
  slot: DocSlot;
  file: ScannedFile;
  confidence: number;
  contentScore: number;
  notes: string[];
};

export type SlotStatus = "ok" | "warn" | "missing";

export type SlotRow = {
  slot: DocSlot;
  required: boolean;
  label: string;
  status: SlotStatus;
  match: SlotMatch | null;
};

export type ProjectCandidate = {
  /** 暫存 id（確認匯入前） */
  tempId: string;
  name: string;
  rootPath: string;
  files: ScannedFile[];
  matches: SlotMatch[];
  unmapped: ScannedFile[];
  slots: SlotRow[];
  coveragePct: number;
  overallScore: number;
  /** 0–100，與 overallScore 對齊，供進度條 */
  progressPct: number;
  selected: boolean;
};

export type FolderScanResult = {
  folderName: string;
  fileCount: number;
  candidates: ProjectCandidate[];
  scannedAt: string;
};

export const SLOT_META: Record<
  DocSlot,
  { label: string; required: boolean; sectionHint: string }
> = {
  prd: { label: "PRD／規格主檔", required: true, sectionHint: "summary + 全文" },
  problem: { label: "問題陳述", required: true, sectionHint: "problem" },
  goals: { label: "目標／Non-Goals", required: true, sectionHint: "goals" },
  metrics: { label: "成功指標", required: true, sectionHint: "metrics" },
  stories: { label: "使用者故事", required: false, sectionHint: "stories" },
  tasks: { label: "任務／Tasks", required: false, sectionHint: "plan steps" },
  proposal: { label: "Proposal", required: false, sectionHint: "OpenSpec" },
  plan: { label: "計劃追蹤", required: false, sectionHint: "plans/*.md" },
  readme: { label: "README", required: false, sectionHint: "專案說明" },
  other: { label: "其他文件", required: false, sectionHint: "—" },
};

const REQUIRED_SLOTS: DocSlot[] = ["prd", "problem", "goals", "metrics"];
const TRACKED_SLOTS: DocSlot[] = [
  "prd",
  "problem",
  "goals",
  "metrics",
  "stories",
  "tasks",
  "proposal",
  "plan",
  "readme",
];

const TEXT_EXT = /\.(md|markdown|txt|mdx|rst)$/i;
const SKIP_DIR = /(^|\/)(node_modules|\.git|dist|build|\.next|coverage|vendor)(\/|$)/i;

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

function basename(p: string): string {
  const n = normalizePath(p);
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(i + 1) : n;
}

/** 路徑／檔名啟發式 → slot + confidence */
export function classifyPath(path: string): { slot: DocSlot; confidence: number } {
  const p = normalizePath(path).toLowerCase();
  const name = basename(p);
  const noExt = name.replace(/\.[^.]+$/, "");

  if (/(^|\/)plans?\/.+\.md$/.test(p) || /plan|roadmap|tracking/.test(noExt)) {
    return { slot: "plan", confidence: 88 };
  }
  if (noExt === "tasks" || noExt === "todo" || noExt === "checklist") {
    return { slot: "tasks", confidence: 90 };
  }
  if (noExt === "proposal" || noExt.includes("proposal")) {
    return { slot: "proposal", confidence: 90 };
  }
  if (noExt === "readme" || noExt.startsWith("readme")) {
    return { slot: "readme", confidence: 85 };
  }
  if (
    noExt === "prd" ||
    noExt === "spec" ||
    noExt === "specification" ||
    noExt.includes("prd") ||
    noExt.includes("product-spec") ||
    noExt.includes("product_spec") ||
    /(^|\/)(docs?\/)?(prd|spec)s?\//.test(p) ||
    noExt === "openspec" ||
    p.includes("openspec") && name.endsWith(".md")
  ) {
    return { slot: "prd", confidence: 92 };
  }
  if (/problem|pain|problem-statement|問題/.test(noExt) || /problem/.test(p)) {
    return { slot: "problem", confidence: 86 };
  }
  if (/non-?goal|nongoal|goals?|目標|邊界/.test(noExt)) {
    return { slot: "goals", confidence: 86 };
  }
  if (/metric|success|kpi|outcome|指標/.test(noExt)) {
    return { slot: "metrics", confidence: 86 };
  }
  if (/user-?stor|stories|acceptance|故事/.test(noExt)) {
    return { slot: "stories", confidence: 84 };
  }
  // OpenSpec 慣例檔名
  if (name === "prd.md") return { slot: "prd", confidence: 95 };
  if (name === "tasks.md") return { slot: "tasks", confidence: 95 };
  if (name === "proposal.md") return { slot: "proposal", confidence: 95 };

  return { slot: "other", confidence: 20 };
}

/** 從正文補強 slot 與內容分 */
export function scoreContent(slot: DocSlot, text: string): { score: number; notes: string[] } {
  const t = text.trim();
  const notes: string[] = [];
  if (!t) return { score: 0, notes: ["空白檔案"] };

  let score = 20;
  const len = t.length;
  if (len >= 80) score += 15;
  if (len >= 300) score += 15;
  if (len >= 800) score += 10;
  if (len > 20000) {
    score -= 5;
    notes.push("檔案很長，建議拆章");
  }

  const hasH1 = /^#\s+\S+/m.test(t);
  const hasH2 = /^##\s+\S+/m.test(t);
  if (hasH1) score += 8;
  if (hasH2) score += 8;
  const bullets = (t.match(/^[-*•]\s+\S+/gm) || []).length;
  if (bullets >= 3) score += 8;

  // slot-specific
  if (slot === "goals" || slot === "prd") {
    const ng =
      /non-?\s*goals?|非目標|不做|out of scope/i.test(t) ||
      (t.match(/^[-*•]\s+/gm) || []).length >= 3;
    if (ng) {
      score += 12;
      notes.push("偵測到 Non-Goals／邊界條列");
    } else {
      notes.push("建議補至少 3 條 Non-Goals");
      score -= 8;
    }
  }
  if (slot === "metrics" || slot === "prd") {
    if (/\d+\s*%|≥|>=|<=|p95|覆蓋率|完成率/.test(t)) {
      score += 12;
      notes.push("含可量測數字");
    } else {
      notes.push("缺少明確數字指標");
      score -= 6;
    }
  }
  if (slot === "problem" || slot === "prd") {
    if (t.length >= 120) {
      score += 8;
      notes.push("問題描述有一定長度");
    }
  }
  if (slot === "plan" || slot === "tasks") {
    const checks = (t.match(/^- \[[ xXvV]\]/gm) || []).length;
    if (checks >= 1) {
      score += 15;
      notes.push(`${checks} 個 checkbox 步驟`);
    }
  }
  if (slot === "stories") {
    if (/as a |身為|我希望|so that/i.test(t)) {
      score += 10;
      notes.push("使用者故事句式");
    }
  }

  score = Math.max(0, Math.min(100, score));
  if (score >= 75) notes.unshift("內容充實");
  else if (score >= 45) notes.unshift("可用草稿");
  else notes.unshift("內容偏薄");
  return { score, notes };
}

/**
 * 從 FileList 讀取文字檔（略過二進位與過大檔）。
 */
export async function readFileList(files: FileList | File[]): Promise<ScannedFile[]> {
  const list = Array.from(files as File[]);
  const out: ScannedFile[] = [];
  const MAX = 512 * 1024; // 512KB per file
  for (const f of list) {
    const path = normalizePath((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name);
    if (SKIP_DIR.test(path)) continue;
    if (!TEXT_EXT.test(f.name) && !TEXT_EXT.test(path)) continue;
    if (f.size > MAX) continue;
    try {
      const text = await f.text();
      // skip binary-ish
      if (text.includes("\0")) continue;
      out.push({ path, name: basename(path), size: f.size, text });
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}

/**
 * 使用者選中的資料夾 = 一個專案。
 * 底下所有子目錄（docs / plans / design…）的檔案都歸同一專案，不拆成多筆。
 */
function groupCandidates(
  files: ScannedFile[],
  folderName: string,
): { name: string; rootPath: string; files: ScannedFile[] }[] {
  const name =
    (folderName && folderName.trim()) ||
    (files[0]?.path.split("/").filter(Boolean)[0] ?? "") ||
    "匯入專案";
  return [
    {
      name,
      rootPath: "",
      files,
    },
  ];
}

function pickBestMatch(slot: DocSlot, files: ScannedFile[]): SlotMatch | null {
  let best: SlotMatch | null = null;
  for (const file of files) {
    const { slot: guessed, confidence } = classifyPath(file.path);
    let conf = confidence;
    let effective: DocSlot = guessed;

    // 正文補強：PRD 主檔可吸納未分到的長文
    if (guessed === "other" && slot === "prd" && file.text.length > 200 && /^#\s+/m.test(file.text)) {
      effective = "prd";
      conf = 55;
    }
    if (effective !== slot && !(slot === "prd" && effective === "readme" && files.length === 1)) {
      // content keyword boost toward this slot
      const lower = file.text.slice(0, 2000).toLowerCase();
      if (slot === "problem" && /problem|痛點|現況/.test(lower)) {
        effective = "problem";
        conf = Math.max(conf, 50);
      } else if (slot === "goals" && /non-?goal|目標|非目標/.test(lower)) {
        effective = "goals";
        conf = Math.max(conf, 50);
      } else if (slot === "metrics" && /metric|kpi|成功指標|覆蓋率/.test(lower)) {
        effective = "metrics";
        conf = Math.max(conf, 50);
      } else if (effective !== slot) {
        continue;
      }
    }
    if (effective !== slot) continue;

    const { score, notes } = scoreContent(slot, file.text);
    const match: SlotMatch = {
      slot,
      file,
      confidence: conf,
      contentScore: score,
      notes,
    };
    if (!best || conf * 0.4 + score * 0.6 > best.confidence * 0.4 + best.contentScore * 0.6) {
      best = match;
    }
  }
  return best;
}

function buildCandidate(
  name: string,
  rootPath: string,
  files: ScannedFile[],
  tempId: string,
): ProjectCandidate {
  const used = new Set<string>();
  const matches: SlotMatch[] = [];
  const slots: SlotRow[] = [];

  for (const slot of TRACKED_SLOTS) {
    const match = pickBestMatch(
      slot,
      files.filter((f) => !used.has(f.path)),
    );
    if (match) {
      used.add(match.file.path);
      matches.push(match);
    }
    const required = REQUIRED_SLOTS.includes(slot);
    let status: SlotStatus = "missing";
    if (match) {
      status = match.contentScore >= 55 && match.confidence >= 50 ? "ok" : "warn";
    }
    slots.push({
      slot,
      required,
      label: SLOT_META[slot].label,
      status,
      match,
    });
  }

  const unmapped = files.filter((f) => !used.has(f.path));
  const requiredRows = slots.filter((s) => s.required);
  const filledReq = requiredRows.filter((s) => s.status !== "missing").length;
  const coveragePct = Math.round((filledReq / Math.max(1, requiredRows.length)) * 100);

  const scored = matches.map((m) => m.contentScore);
  const avgContent = scored.length
    ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length)
    : 0;
  // 總分：覆蓋率 55% + 內容均分 45%
  const overallScore = Math.round(coveragePct * 0.55 + avgContent * 0.45);
  const optionalFilled = slots.filter((s) => !s.required && s.status !== "missing").length;
  const optionalTotal = slots.filter((s) => !s.required).length;
  const progressPct = Math.round(
    (filledReq / Math.max(1, requiredRows.length)) * 70 +
      (optionalFilled / Math.max(1, optionalTotal)) * 30,
  );

  return {
    tempId,
    name,
    rootPath,
    files,
    matches,
    unmapped,
    slots,
    coveragePct,
    overallScore,
    progressPct,
    selected: true,
  };
}

/** 已讀入的文字檔陣列 → 掃描結果（原生 NSOpenPanel / web 共用） */
export function scanFromScannedFiles(
  scanned: ScannedFile[],
  folderNameHint?: string,
): FolderScanResult {
  const folderName =
    folderNameHint ||
    (scanned[0]?.path.split("/")[0] ?? "") ||
    "匯入資料夾";

  const groups = groupCandidates(scanned, folderName);
  const candidates = groups.map((g, i) =>
    buildCandidate(g.name || folderName, g.rootPath, g.files, `imp-${Date.now()}-${i}`),
  );

  return {
    folderName,
    fileCount: scanned.length,
    candidates,
    scannedAt: new Date().toISOString(),
  };
}

/** 主入口：FileList → 掃描結果（瀏覽器 webkitdirectory） */
export async function scanFolderFromFileList(
  files: FileList | File[],
  folderNameHint?: string,
): Promise<FolderScanResult> {
  const scanned = await readFileList(files);
  return scanFromScannedFiles(scanned, folderNameHint);
}

/** 原生 bridge 回傳的檔案列 */
export type NativeFolderFile = {
  path: string;
  name: string;
  size: number;
  text: string;
};

export function scanFromNativeFolder(
  folderName: string,
  files: NativeFolderFile[],
): FolderScanResult {
  const scanned: ScannedFile[] = files.map((f) => ({
    path: normalizePath(f.path),
    name: f.name || basename(f.path),
    size: f.size ?? f.text.length,
    text: f.text ?? "",
  }));
  return scanFromScannedFiles(scanned, folderName);
}

/**
 * 將候選專案對應進 sectionValues（軟體章節欄位）。
 * 單一長 PRD 會拆進多欄；獨立檔優先。
 */
export function mapCandidateToSectionValues(
  candidate: ProjectCandidate,
): Record<string, Record<string, string>> {
  const values: Record<string, Record<string, string>> = {
    summary: { what: "", who: "", why: "", tech: "" },
    problem: { problem: "", quote: "" },
    goals: { goals: "", nongoals: "" },
    metrics: { m1: "" },
    stories: { stories: "" },
    open: { oq: "" },
  };

  const bySlot = Object.fromEntries(
    candidate.matches.map((m) => [m.slot, m]),
  ) as Partial<Record<DocSlot, SlotMatch>>;

  const prdText = bySlot.prd?.file.text ?? bySlot.readme?.file.text ?? "";
  const titleFromH1 = prdText.match(/^#\s+(.+)$/m)?.[1]?.trim();

  // summary.what
  if (titleFromH1) values.summary.what = titleFromH1;
  else if (candidate.name) values.summary.what = candidate.name;

  // summary.tech — 從 PRD／README 擷取技術／stack 段落
  if (prdText) {
    const tech = extractSection(
      prdText,
      /技術線|技術選型|技術棧|tech(?:nology)?\s*stack|architecture|架構選型|stack/i,
    );
    if (tech) values.summary.tech = tech.slice(0, 3000);
  }

  if (bySlot.problem) {
    values.problem.problem = bySlot.problem.file.text.trim().slice(0, 4000);
  } else if (prdText) {
    const prob = extractSection(prdText, /問題|problem|pain/i);
    if (prob) values.problem.problem = prob.slice(0, 4000);
  }

  if (bySlot.goals) {
    const g = bySlot.goals.file.text.trim();
    const { goals, nongoals } = splitGoals(g);
    values.goals.goals = goals;
    values.goals.nongoals = nongoals;
  } else if (prdText) {
    const g = extractSection(prdText, /目標|goals?|non-?\s*goals?/i);
    if (g) {
      const split = splitGoals(g);
      values.goals.goals = split.goals;
      values.goals.nongoals = split.nongoals;
    }
  }

  if (bySlot.metrics) {
    values.metrics.m1 = bySlot.metrics.file.text.trim().slice(0, 4000);
  } else if (prdText) {
    const m = extractSection(prdText, /成功指標|metrics?|outcomes?|kpi/i);
    if (m) values.metrics.m1 = m.slice(0, 4000);
  }

  if (bySlot.stories) {
    values.stories.stories = bySlot.stories.file.text.trim().slice(0, 4000);
  } else if (prdText) {
    const s = extractSection(prdText, /使用者故事|user stor|stories/i);
    if (s) values.stories.stories = s.slice(0, 4000);
  }

  // 摘要 who/why 從 prd 粗抽
  if (prdText) {
    const who = extractSection(prdText, /給誰|who|audience|受益/i);
    const why = extractSection(prdText, /為何現在|why now|時機/i);
    if (who) values.summary.who = who.split(/\n/)[0].slice(0, 200);
    if (why) values.summary.why = why.slice(0, 500);
  }

  // 若摘要仍空，用 prd 前段
  if (!values.summary.what && prdText) {
    values.summary.what = prdText.replace(/^#\s+.+$/m, "").trim().slice(0, 200);
  }
  if (!values.problem.problem && prdText) {
    values.problem.problem = prdText.replace(/^#\s+.+$/m, "").trim().slice(0, 1500);
  }

  // plan / tasks 塞進 open questions 備註
  const extras: string[] = [];
  if (bySlot.plan) extras.push(`## 計劃（${bySlot.plan.file.name}）\n${bySlot.plan.file.text.trim().slice(0, 2000)}`);
  if (bySlot.tasks) extras.push(`## Tasks（${bySlot.tasks.file.name}）\n${bySlot.tasks.file.text.trim().slice(0, 2000)}`);
  if (bySlot.proposal) extras.push(`## Proposal\n${bySlot.proposal.file.text.trim().slice(0, 1500)}`);
  if (extras.length) values.open.oq = extras.join("\n\n");

  return values;
}

function extractSection(md: string, titleRe: RegExp): string {
  const lines = md.split(/\r?\n/);
  let capturing = false;
  let buf: string[] = [];
  let level = 0;
  for (const line of lines) {
    const hm = line.match(/^(#{1,3})\s+(.+)$/);
    if (hm) {
      const lv = hm[1].length;
      const title = hm[2].trim();
      if (titleRe.test(title)) {
        capturing = true;
        level = lv;
        buf = [];
        continue;
      }
      if (capturing && lv <= level) break;
    }
    if (capturing) buf.push(line);
  }
  return buf.join("\n").trim();
}

function splitGoals(text: string): { goals: string; nongoals: string } {
  const ngMatch = text.split(/(?:^|\n)#{1,3}\s*(?:非目標|Non-?\s*Goals?|不做).*$/im);
  if (ngMatch.length >= 2) {
    const goalsPart = text.slice(0, text.search(/(?:^|\n)#{1,3}\s*(?:非目標|Non-?\s*Goals?|不做)/im));
    const ngPart = ngMatch[ngMatch.length - 1] ?? "";
    return { goals: goalsPart.trim(), nongoals: ngPart.trim() };
  }
  // bullet split: lines after 「非目標」plain label
  const lines = text.split(/\r?\n/);
  const goals: string[] = [];
  const nongoals: string[] = [];
  let mode: "g" | "n" = "g";
  for (const line of lines) {
    if (/非目標|non-?\s*goals?|不做/i.test(line) && !/^[-*•]/.test(line.trim())) {
      mode = "n";
      continue;
    }
    if (mode === "g") goals.push(line);
    else nongoals.push(line);
  }
  return { goals: goals.join("\n").trim(), nongoals: nongoals.join("\n").trim() };
}

/** 供 UI 顯示的進度色階 */
export function scoreTone(score: number): "good" | "mid" | "low" {
  if (score >= 70) return "good";
  if (score >= 40) return "mid";
  return "low";
}
