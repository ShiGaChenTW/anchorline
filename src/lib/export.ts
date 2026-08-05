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

export function emptySectionValues(sections: Section[]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const s of sections) {
    out[s.id] = {};
    for (const f of s.fields) out[s.id][f.key] = "";
  }
  return out;
}
