/**
 * 專案檔案樹 —— 回答三個「我在哪」的問題：
 *
 *   這個資料夾裡有什麼？        → 樹狀結構
 *   哪些是 PRD 的來源？          → `來源` 徽章 + 對應章節編號
 *   哪些是 Anchorline 產出的？    → `產出` 徽章
 *
 * ADHD 的定位成本很高：看不到「檔案 ↔ 章節」的對應，就等於每次都要重新想
 * 「我現在到底在改什麼」。這個樹把那條線畫出來。
 */
import type { Project, Section } from "../data/types";

/** 檔案在這個系統裡扮演什麼角色 */
export type FileRole = "source" | "artifact" | "plain";

export type TreeFile = {
  kind: "file";
  name: string;
  path: string;
  role: FileRole;
  /** role=source 時，對應到哪個 PRD 章節（顯示用編號與 id） */
  sectionN?: string;
  sectionId?: string;
};

export type TreeDir = {
  kind: "dir";
  name: string;
  path: string;
  children: TreeNode[];
};

export type TreeNode = TreeFile | TreeDir;

/** import slot → PRD 章節 id。slot 名稱來自 folder-import.ts 的 DocSlot */
const SLOT_TO_SECTION: Record<string, string> = {
  problem: "problem",
  goals: "goals",
  metrics: "metrics",
  stories: "stories",
  prd: "summary",
};

/** Anchorline 匯出的 OpenSpec 產出物 */
const ARTIFACT_RE = /(^|\/)(PRD|tasks|proposal)\.md$|openspec-.*\.(md)$/i;

function roleFor(
  path: string,
  slotByPath: Map<string, string>,
): { role: FileRole; sectionId?: string } {
  if (ARTIFACT_RE.test(path)) return { role: "artifact" };
  const slot = slotByPath.get(path);
  if (slot) {
    const sectionId = SLOT_TO_SECTION[slot];
    // 有對到 slot 但沒對到章節（readme / plan / tasks）仍算來源，只是沒有章節編號
    return { role: "source", sectionId };
  }
  return { role: "plain" };
}

/**
 * 從相對路徑清單建樹。資料夾排在檔案前，同層依名稱排序 ——
 * 順序固定，換頁回來位置不會跳，這對「回到原處」很重要。
 */
export function buildFileTree(project: Project, sections: Section[]): TreeDir | null {
  const summary = project.importSummary;
  const paths = summary?.allPaths?.length
    ? summary.allPaths
    : summary?.matchedFiles.map((m) => m.path);
  if (!paths?.length) return null;

  const slotByPath = new Map<string, string>();
  for (const m of summary?.matchedFiles ?? []) slotByPath.set(m.path, m.slot);
  const sectionById = new Map(sections.map((s) => [s.id, s]));

  const root: TreeDir = {
    kind: "dir",
    name: summary?.folderName || project.sourceFolder || "專案",
    path: "",
    children: [],
  };

  for (const raw of paths) {
    const parts = raw.split("/").filter(Boolean);
    if (!parts.length) continue;
    // 匯入路徑通常含資料夾名本身，去掉避免樹裡多一層同名節點
    const rel = parts[0] === root.name ? parts.slice(1) : parts;
    if (!rel.length) continue;

    let cursor = root;
    for (let i = 0; i < rel.length - 1; i++) {
      const name = rel[i];
      const path = rel.slice(0, i + 1).join("/");
      let next = cursor.children.find(
        (c): c is TreeDir => c.kind === "dir" && c.name === name,
      );
      if (!next) {
        next = { kind: "dir", name, path, children: [] };
        cursor.children.push(next);
      }
      cursor = next;
    }

    const name = rel[rel.length - 1];
    if (cursor.children.some((c) => c.kind === "file" && c.name === name)) continue;

    const { role, sectionId } = roleFor(raw, slotByPath);
    const section = sectionId ? sectionById.get(sectionId) : undefined;
    cursor.children.push({
      kind: "file",
      name,
      path: raw,
      role,
      sectionId: section?.id,
      sectionN: section?.n,
    });
  }

  sortTree(root);
  return root;
}

function sortTree(dir: TreeDir) {
  dir.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const c of dir.children) if (c.kind === "dir") sortTree(c);
}

/** 目前章節對應的來源檔（給編輯區的定位列用） */
export function sourceFileForSection(
  project: Project | null,
  sectionId: string,
): string | null {
  if (!project?.importSummary) return null;
  const wanted = Object.entries(SLOT_TO_SECTION)
    .filter(([, sid]) => sid === sectionId)
    .map(([slot]) => slot);
  const hit = project.importSummary.matchedFiles.find((m) => wanted.includes(m.slot));
  return hit?.path ?? null;
}

/** 這一節匯出後會落在 OpenSpec 的哪個標題底下（給定位列用） */
export const SECTION_TO_OPENSPEC: Record<string, string> = {
  summary: "PRD.md › ## Executive Summary",
  problem: "PRD.md › ## Executive Summary（Problem Statement）",
  goals: "PRD.md › ## Non-Goals",
  metrics: "PRD.md › ## Desired Outcomes",
  stories: "PRD.md › ## User Experience & Functionality",
  scope: "PRD.md › ## Technical Specifications",
  open: "PRD.md › ## Risks & Roadmap",
  custom: "PRD.md › ## Appendix",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CHEVRON = `<svg class="ft-chevron" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M6 3.5 10.5 8 6 12.5V3.5z"/></svg>`;

function renderNode(node: TreeNode, depth: number, activeSectionId: string): string {
  const pad = `padding-left:${8 + depth * 12}px`;

  if (node.kind === "dir") {
    return `<div class="ft-group">
      <button type="button" class="ft-row ft-dir" style="${pad}" data-ft-dir="${escapeHtml(node.path)}" aria-expanded="true">
        ${CHEVRON}<span class="ft-name">${escapeHtml(node.name)}</span>
      </button>
      <div class="ft-children">${node.children.map((c) => renderNode(c, depth + 1, activeSectionId)).join("")}</div>
    </div>`;
  }

  const badge =
    node.role === "artifact"
      ? `<span class="ft-badge ft-badge-artifact">產出</span>`
      : node.role === "source"
        ? `<span class="ft-badge ft-badge-source">來源${node.sectionN ? ` · ${escapeHtml(node.sectionN)}` : ""}</span>`
        : "";

  const active = node.sectionId && node.sectionId === activeSectionId;
  const tag = node.sectionId ? "button" : "div";
  const attrs = node.sectionId
    ? ` type="button" data-ft-section="${escapeHtml(node.sectionId)}"`
    : "";

  return `<${tag} class="ft-row ft-file ft-role-${node.role}${active ? " is-active" : ""}"${attrs} style="${pad}" title="${escapeHtml(node.path)}">
    <span class="ft-name">${escapeHtml(node.name)}</span>${badge}
  </${tag}>`;
}

export function renderFileTreeHtml(
  root: TreeDir | null,
  activeSectionId: string,
): string {
  if (!root) {
    return `<div class="ft-empty">
      <p>這份 PRD 還沒有對應的資料夾，所以沒有檔案結構可顯示。</p>
      <button type="button" class="btn btn-sm btn-primary" id="ft-bind-folder">指定專案資料夾</button>
    </div>`;
  }
  return `<div class="ft-tree" role="tree">${root.children
    .map((c) => renderNode(c, 0, activeSectionId))
    .join("")}</div>`;
}
