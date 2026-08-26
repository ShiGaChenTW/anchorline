import type { AppState, Project, Section } from "../data/types";
import { projectDisplayName } from "../data/types";
import { CUSTOM_SECTION_ID } from "../data/seed";
import { isNative, isUnavailable, native } from "./native";
import { toast } from "./ui";

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
  const title = p?.title ?? "Anchorline PRD";
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

  // 匯出的是「這一份 PRD」，別的專案的未解決留言不該混進來
  const openComments = state.comments.filter(
    (c) => c.projectId === state.activeProjectId && !c.resolved,
  );
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
  const title = project?.title ?? "Anchorline PRD";
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

/**
 * 把匯出檔真的送到使用者手上，並**講清楚它去了哪**。
 *
 * 桌面殼沒有掛 `on_download`，WKWebView 對 `<a download>` 是無聲失敗 ——
 * 按了匯出，沒有檔案、沒有錯誤、沒有訊息（Scott 2026-08-12 回報的正是這個）。
 * 所以桌面版改寫進 `<專案根>/.anchorline/exports/`，toast 完整路徑；
 * 瀏覽器版維持下載，toast 檔名。這裡是唯一出口，七個呼叫端不用各自處理。
 */
async function deliver(
  state: AppState,
  project: Project | null | undefined,
  filename: string,
  content: string,
  mime: string,
): Promise<void> {
  if (isNative()) {
    const p =
      project ?? state.projects.find((x) => x.id === state.activeProjectId) ?? state.projects[0] ?? null;
    const root = p?.importSummary?.rootPath;
    if (!root) {
      // 沒綁資料夾時瀏覽器下載那條路在桌面版根本不會動 —— 與其假裝成功，不如講原因
      toast("桌面版匯出需要先綁定專案資料夾（檔案會放進 專案/.anchorline/exports/）");
      return;
    }
    const r = await native.writeExport(root, filename, content);
    if (isUnavailable(r)) {
      toast(`匯出失敗：${r.message}`);
      return;
    }
    toast(`已匯出 → ${r.path}`);
    return;
  }
  downloadText(filename, content, mime);
  toast(`已下載 ${filename}（在瀏覽器的下載資料夾）`);
}

export function exportMarkdownFile(state: AppState, project?: Project | null) {
  const p = project ?? state.projects[0];
  const name = safeName(p?.title ?? "prd");
  void deliver(state, project, `${name}-${stamp()}.md`, buildMarkdown(state, p), "text/markdown;charset=utf-8");
}

/**
 * 匯出前把所有 API 金鑰換成空字串。
 *
 * 2026-08-26 之前 `exportJsonFile` 直接序列化整個 `state`，於是
 * `settings.apiKey` 一直都躺在備份檔裡；Agent 後端上線之後
 * `settings.backends[].apiKey` 也加入同一份 dump，**從一把變成 N 把**。
 * 備份檔會被丟進雲端硬碟、貼進 issue、寄給人看 —— 那是金鑰最容易外流的形狀。
 *
 * 遮蔽成 `""` 而不是刪掉欄位：刪欄位會讓匯入端分不出「這一代沒有這個欄位」
 * 與「這一份被遮蔽過」，而前者要落回預設值、後者要保留現有金鑰。
 *
 * 對稱的另一半在 `store.importState()` —— 匯入時空金鑰**不覆蓋**現有的金鑰。
 * 只做這一半的話，使用者還原一份備份就會把自己正在用的金鑰清空，
 * 而症狀是稍後某次 AI 呼叫 401，看不出跟還原有關。
 */
export function redactSecrets(state: AppState): AppState {
  return {
    ...state,
    settings: {
      ...state.settings,
      apiKey: "",
      backends: (state.settings.backends ?? []).map((b) =>
        b.kind === "api" ? { ...b, apiKey: "" } : b,
      ),
    },
  };
}

export function exportJsonFile(state: AppState) {
  const payload = {
    exportedAt: new Date().toISOString(),
    exporter: { id: state.currentUser.id, name: state.currentUser.name, role: state.currentUser.accessRole },
    // 讓匯入端與讀檔的人都知道這份為什麼沒有金鑰。少了這行，
    // 「金鑰欄位是空的」看起來就只像是使用者沒設定過。
    keysRedacted: true,
    keysRedactedNote:
      "API 金鑰已在匯出時移除。還原這份備份不會清掉你目前設定的金鑰；換一台機器還原則需要重新輸入。",
    state: redactSecrets(state),
  };
  void deliver(
    state,
    null,
    `anchorline-backup-${stamp()}.json`,
    JSON.stringify(payload, null, 2),
    "application/json;charset=utf-8",
  );
}

/**
 * 專案 profile —— 交接用的 metadata 快照，也是給「其他軟體」讀這個資料夾時
 * 認得出 Anchorline 專案身分的固定入口。
 *
 * 固定檔名（不加時間戳）：這份東西描述「現在」，交接對象與外部工具要找的
 * 是最新版，不是某次匯出當下的快照——`write_export` 允許覆寫正合這個用途。
 */
export type ProjectProfile = {
  schema: "anchorline.project-profile.v1";
  exportedAt: string;
  name: string;
  shortCode: string | null;
  status: Project["status"];
  versionPolicy: "loose" | "strict";
  domain: string;
  description: string | null;
  tags: string[];
  owner: string;
  anchorlineProjectId: string;
};

export function buildProjectProfile(project: Project): ProjectProfile {
  return {
    schema: "anchorline.project-profile.v1",
    exportedAt: new Date().toISOString(),
    name: projectDisplayName(project),
    shortCode: project.shortCode ?? null,
    status: project.status,
    versionPolicy: project.versionPolicy ?? "loose",
    domain: project.domain ?? "generic",
    description: project.description?.trim() || null,
    tags: project.tags ?? [],
    owner: project.owner,
    anchorlineProjectId: project.id,
  };
}

export function exportProjectProfile(state: AppState, project?: Project | null) {
  const p =
    project ?? state.projects.find((x) => x.id === state.activeProjectId) ?? state.projects[0] ?? null;
  if (!p) {
    toast("沒有可匯出的專案");
    return;
  }
  void deliver(state, p, "project.json", JSON.stringify(buildProjectProfile(p), null, 2), "application/json;charset=utf-8");
}

export function exportHtmlFile(state: AppState, project?: Project | null) {
  const p = project ?? state.projects[0];
  const name = safeName(p?.title ?? "prd");
  void deliver(state, project, `${name}-${stamp()}.html`, buildHtmlDocument(state, p), "text/html;charset=utf-8");
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
  const title = p?.title ?? "Anchorline PRD";
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
  md += `- Agent 編輯／核准角色見 Anchorline Agent 管理（family 隔離）\n`;
  md += `- 結構檢查：Non-Goals ≥ 3（Anchorline gate）\n`;

  md += `\n## Technical Specifications\n`;
  for (const s of state.sections) {
    // 自訂章節是自由區，內容從範本來、什麼都可能是 —— 掃進「技術規格」會讓
    // 讀 PRD 的人以為那是工程承諾。它自己在下面有一個 Appendix
    if (s.id === CUSTOM_SECTION_ID) continue;
    if (["summary", "goals", "metrics", "problem", "stories"].includes(s.id)) continue;
    const vals = state.sectionValues[s.id] || {};
    const body = Object.values(vals).join("\n").trim();
    if (!body) continue;
    md += `\n### ${s.n} ${s.title}\n${body}\n`;
  }

  md += `\n## Risks & Roadmap\n`;
  const oq = (state.sectionValues.open?.oq || "").trim();
  md += oq ? oq.split(/\n/).map((l) => (l.trim().startsWith("-") ? l : `- ${l.trim()}`)).join("\n") : `- （開放問題待補）\n`;

  const custom = state.sections.find((s) => s.id === CUSTOM_SECTION_ID);
  const customBody = custom
    ? Object.values(state.sectionValues[custom.id] || {}).join("\n").trim()
    : "";
  if (custom && customBody) md += `\n## Appendix — ${custom.n} ${custom.title}\n\n${customBody}\n`;

  md += `\n---\n_Exported from Anchorline · ${new Date().toISOString()}_\n`;
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
  md += `> OpenSpec tasks skeleton（可由 Claude Code / Codex 勾選進度）\n`;
  md += `> 勾完可用 Anchorline 專案頁「回讀 tasks.md」把檢查項狀態讀回來。\n`;
  md += `> 行尾的 \`<!-- sf:… -->\` 是回讀錨點，請勿刪除（markdown 渲染時不顯示）。\n\n`;
  md += `## Plan Steps\n\n`;

  for (const s of state.sections) {
    const vals = state.sectionValues[s.id] || {};
    const filled = Object.values(vals).join("").trim().length > 20;
    const mark = filled || s.status === "done" ? "x" : " ";
    md += `- [${mark}] ${s.n} ${s.title} <!-- sf:s=${s.id} -->\n`;
    for (const c of s.checks) {
      md += `  - [${c.pass ? "x" : " "}] ${c.label} <!-- sf:c=${s.id}/${c.id} -->\n`;
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
