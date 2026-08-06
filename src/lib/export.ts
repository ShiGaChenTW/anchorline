import type { AppState, Project, Section } from "../data/types";

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "spec";
}

export function buildMarkdown(state: AppState, project?: Project | null): string {
  const p =
    project ??
    state.projects.find((x) => x.id === "p1") ??
    state.projects[0] ??
    null;
  const title = p?.title ?? "SpecForge PRD";
  const status = p?.status ?? "draft";
  const owner = p?.owner ?? state.currentUser.name;
  let md = `# ${title}\n\n`;
  md += `| 欄位 | 值 |\n|---|---|\n`;
  md += `| 狀態 | ${status} |\n`;
  md += `| 擁有者 | ${owner} |\n`;
  md += `| 匯出者 | ${state.currentUser.name}（${state.currentUser.accessRole}） |\n`;
  md += `| 匯出時間 | ${new Date().toLocaleString("zh-TW")} |\n\n`;

  if (state.locked) md += `> ⚠ 此規格已核准鎖定\n\n`;

  for (const s of state.sections) {
    const vals = state.sectionValues[s.id] || {};
    md += `## ${s.n} ${s.title}\n\n`;
    let any = false;
    for (const f of s.fields) {
      const val = (vals[f.key] ?? "").trim();
      if (!val) continue;
      any = true;
      md += `### ${f.label}\n\n${val}\n\n`;
    }
    if (!any) md += `_（本章尚無內容）_\n\n`;
  }

  const openComments = state.comments.filter((c) => !c.resolved);
  if (openComments.length) {
    md += `## 開放留言\n\n`;
    for (const c of openComments) {
      md += `- **${c.author}** ${c.anchor}：${c.body}\n`;
    }
    md += "\n";
  }

  md += `## 簽核狀態\n\n`;
  for (const a of state.approvals) {
    md += `- ${a.role}：${a.name}（${a.state}）\n`;
  }
  return md;
}

export function buildHtmlDocument(state: AppState, project?: Project | null): string {
  const md = buildMarkdown(state, project);
  // Minimal HTML: preserve newlines; no markdown parser dependency
  const body = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br/>");
  const title = project?.title ?? "SpecForge PRD";
  return `<!doctype html>
<html lang="zh-TW"><head><meta charset="utf-8"/>
<title>${title.replace(/</g, "")}</title>
<style>
  body{font-family:system-ui,-apple-system,"Noto Sans TC",sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.6;color:#111}
  h1,h2,h3{line-height:1.25} table{border-collapse:collapse;width:100%}
  td,th{border:1px solid #ddd;padding:6px 8px;text-align:left}
  @media print{body{margin:0}}
</style></head>
<body><p>${body}</p>
<script>window.onload=()=>setTimeout(()=>window.print(),300)</script>
</body></html>`;
}

export function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function exportMarkdownFile(state: AppState, project?: Project | null) {
  const p = project ?? state.projects[0];
  const name = safeName(p?.title ?? "prd");
  downloadText(`${name}-${stamp()}.md`, buildMarkdown(state, p), "text/markdown;charset=utf-8");
}

export function exportJsonFile(state: AppState) {
  const payload = {
    exportedAt: new Date().toISOString(),
    exporter: { id: state.currentUser.id, name: state.currentUser.name, role: state.currentUser.accessRole },
    state,
  };
  downloadText(`specforge-backup-${stamp()}.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
}

export function exportHtmlFile(state: AppState, project?: Project | null) {
  const p = project ?? state.projects[0];
  const name = safeName(p?.title ?? "prd");
  downloadText(`${name}-${stamp()}.html`, buildHtmlDocument(state, p), "text/html;charset=utf-8");
}

/**
 * OpenSpec 風格片段（S.CodingFlow 對齊）
 * 標題 ## Non-Goals / ## Desired Outcomes 一字不差，方便 gate／agent 讀取。
 */
export function buildOpenspecPrd(state: AppState, project?: Project | null): string {
  const p =
    project ??
    state.projects.find((x) => x.id === state.activeProjectId) ??
    state.projects[0] ??
    null;
  const title = p?.title ?? "SpecForge PRD";
  const changeId = (p?.tag || p?.id || "change").replace(/[^a-zA-Z0-9_-]/g, "-");
  const summary = state.sectionValues.summary ?? {};
  const goals = state.sectionValues.goals ?? {};
  const metrics = state.sectionValues.metrics ?? {};
  const problem = state.sectionValues.problem ?? {};
  const stories = state.sectionValues.stories ?? {};

  let md = `---
change_id: ${changeId}
status: ${p?.status === "approved" ? "done" : "active"}
profile: A
---

# PRD — ${title}

## Executive Summary
- **Problem Statement：** ${(problem.problem || summary.why || "（待補）").replace(/\n/g, " ").slice(0, 400)}
- **Proposed Solution：** ${(summary.what || "（待補）").replace(/\n/g, " ")}
- **Audience：** ${(summary.who || "（待補）").replace(/\n/g, " ")}
- **Tech Direction：** ${(summary.tech || "（待補技術線選型）").replace(/\n/g, " ").slice(0, 500)}

## Non-Goals
`;
  const nongoals = (goals.nongoals || "").trim();
  if (nongoals) {
    for (const line of nongoals.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      md += t.startsWith("-") || t.startsWith("•") || t.startsWith("*")
        ? `${t.replace(/^•/, "-")}\n`
        : `- ${t}\n`;
    }
  } else {
    md += `- （請至少寫 3 條刻意不做）\n`;
  }

  md += `\n## Desired Outcomes\n`;
  const m = (metrics.m1 || goals.goals || "").trim();
  if (m) {
    for (const line of m.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("|") || t.startsWith("---")) continue;
      md += t.startsWith("-") || t.startsWith("•") ? `${t.replace(/^•/, "-")}\n` : `- ${t}\n`;
    }
  } else {
    md += `- （請寫可量測成功判準，含數字／%）\n`;
  }

  md += `\n## User Experience & Functionality\n`;
  const st = (stories.stories || "").trim();
  if (st) {
    for (const line of st.split(/\r?\n/)) {
      const t = line.trim();
      if (t) md += (t.startsWith("-") ? t : `- ${t}`) + "\n";
    }
  } else {
    md += `- As a [角色], I want to [能力] so that [價值].\n`;
  }

  md += `\n## AI System Requirements\n`;
  md += `- Agent 編輯／核准角色見 SpecForge Agent 管理（family 隔離）\n`;
  md += `- 結構檢查：Non-Goals ≥ 3（PM-SPEC+SCVB gate）\n`;

  md += `\n## Technical Specifications\n`;
  for (const s of state.sections) {
    if (["summary", "goals", "metrics", "problem", "stories"].includes(s.id)) continue;
    const vals = state.sectionValues[s.id] || {};
    const body = Object.values(vals).join("\n").trim();
    if (!body) continue;
    md += `\n### ${s.n} ${s.title}\n${body}\n`;
  }

  md += `\n## Risks & Roadmap\n`;
  const oq = (state.sectionValues.open?.oq || "").trim();
  md += oq ? oq.split(/\n/).map((l) => (l.trim().startsWith("-") ? l : `- ${l.trim()}`)).join("\n") : `- （開放問題待補）\n`;

  md += `\n---\n_Exported from PM-SPEC+SCVB · ${new Date().toISOString()}_\n`;
  return md;
}

export function buildOpenspecTasks(state: AppState, project?: Project | null): string {
  const p =
    project ??
    state.projects.find((x) => x.id === state.activeProjectId) ??
    state.projects[0] ??
    null;
  const title = p?.title ?? "PRD";
  let md = `# Tasks — ${title}\n\n`;
  md += `> OpenSpec tasks skeleton（可由 Claude Code / Codex 勾選進度）\n\n`;
  md += `## Plan Steps\n\n`;

  for (const s of state.sections) {
    const vals = state.sectionValues[s.id] || {};
    const filled = Object.values(vals).join("").trim().length > 20;
    const mark = filled || s.status === "done" ? "x" : " ";
    md += `- [${mark}] ${s.n} ${s.title}\n`;
    for (const c of s.checks) {
      md += `  - [${c.pass ? "x" : " "}] ${c.label}\n`;
    }
  }

  md += `\n## 簽核\n\n`;
  for (const a of state.approvals) {
    const mark = a.state === "approved" ? "x" : " ";
    md += `- [${mark}] ${a.role}：${a.name}\n`;
  }

  md += `\n## 交付\n\n`;
  md += `- [ ] 匯出 OpenSpec bundle\n`;
  md += `- [ ] 提交審閱／archive\n`;
  return md;
}

export function buildOpenspecProposal(state: AppState, project?: Project | null): string {
  const p =
    project ??
    state.projects.find((x) => x.id === state.activeProjectId) ??
    state.projects[0] ??
    null;
  const title = p?.title ?? "change";
  const changeId = (p?.tag || p?.id || "change").replace(/[^a-zA-Z0-9_-]/g, "-");
  return `# Proposal — ${title}

## Why
${(state.sectionValues.summary?.why || state.sectionValues.problem?.problem || "（待補）").trim()}

## What Changes
${(state.sectionValues.summary?.what || "（待補）").trim()}

## Capabilities
- product: ${changeId}
- tag: ${p?.tag ?? "product"}

## Impact
- owner: ${p?.owner ?? state.currentUser.name}
- status: ${p?.status ?? "draft"}
`;
}

/** 連續下載 PRD.md / tasks.md / proposal.md */
export function exportOpenspecBundle(state: AppState, project?: Project | null) {
  const p =
    project ??
    state.projects.find((x) => x.id === state.activeProjectId) ??
    state.projects[0] ??
    null;
  const slug = safeName(p?.title ?? "change");
  const ts = stamp();
  const base = `openspec-${slug}-${ts}`;
  downloadText(`${base}-PRD.md`, buildOpenspecPrd(state, p), "text/markdown;charset=utf-8");
  window.setTimeout(() => {
    downloadText(`${base}-tasks.md`, buildOpenspecTasks(state, p), "text/markdown;charset=utf-8");
  }, 200);
  window.setTimeout(() => {
    downloadText(
      `${base}-proposal.md`,
      buildOpenspecProposal(state, p),
      "text/markdown;charset=utf-8",
    );
  }, 400);
}

export function emptySectionValues(sections: Section[]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const s of sections) {
    out[s.id] = {};
    for (const f of s.fields) out[s.id][f.key] = "";
  }
  return out;
}
