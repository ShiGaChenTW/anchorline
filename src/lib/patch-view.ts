/**
 * 把 unified diff 收成可畫的列 —— History 頁的唯一解析器。
 *
 * 不引 highlight.js：顏色只服務「加／刪／上下文」三態。
 * 關鍵字上色是錦上添花，沒有它仍能讀 diff。
 *
 * 純函式、零 DOM、零 I/O。
 */

export type DiffOp = "ctx" | "add" | "del" | "meta" | "hunk";

export type DiffLine = {
  op: DiffOp;
  text: string;
  oldNo: number | null;
  newNo: number | null;
};

export type SplitRow = {
  left: { op: "ctx" | "del" | "empty"; text: string; no: number | null };
  right: { op: "ctx" | "add" | "empty"; text: string; no: number | null };
};

export type ParsedPatch = {
  header: string[];
  lines: DiffLine[];
};

/** 一個 commit 裡的檔（來自 numstat） */
export type CommitFile = {
  path: string;
  added: number | null;
  deleted: number | null;
};

export function parseNumstat(raw: string): CommitFile[] {
  const out: CommitFile[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const tab = line.indexOf("\t");
    const tab2 = line.indexOf("\t", tab + 1);
    if (tab < 0 || tab2 < 0) continue;
    const a = line.slice(0, tab);
    const d = line.slice(tab + 1, tab2);
    const path = line.slice(tab2 + 1);
    if (!path) continue;
    out.push({
      path,
      added: a === "-" ? null : Number.parseInt(a, 10) || 0,
      deleted: d === "-" ? null : Number.parseInt(d, 10) || 0,
    });
  }
  return out;
}

/**
 * 從一份可能含多個檔的 unified patch 抽出指定檔的片段。
 * 找不到就回整份（呼叫端仍畫得出東西）。
 */
export function extractFilePatch(patch: string, path: string): string {
  if (!path) return patch;
  const lines = patch.split(/\r?\n/);
  const start = lines.findIndex(
    (l) => l.startsWith("diff --git ") && (l.includes(` a/${path} `) || l.endsWith(` b/${path}`) || l.includes(`/${path}`)),
  );
  if (start < 0) return patch;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i]!.startsWith("diff --git ")) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

export function parseUnifiedPatch(raw: string): ParsedPatch {
  const header: string[] = [];
  const lines: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;

  for (const line of raw.split(/\r?\n/)) {
    if (!inHunk && (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("new file") || line.startsWith("deleted file") || line.startsWith("similarity ") || line.startsWith("rename "))) {
      header.push(line);
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      inHunk = true;
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      lines.push({ op: "hunk", text: line, oldNo: null, newNo: null });
      continue;
    }
    if (!inHunk) {
      if (line.length) header.push(line);
      continue;
    }
    if (line.startsWith("+")) {
      lines.push({ op: "add", text: line.slice(1), oldNo: null, newNo: newNo++ });
    } else if (line.startsWith("-")) {
      lines.push({ op: "del", text: line.slice(1), oldNo: oldNo++, newNo: null });
    } else if (line.startsWith("\\")) {
      lines.push({ op: "meta", text: line, oldNo: null, newNo: null });
    } else {
      const text = line.startsWith(" ") ? line.slice(1) : line;
      lines.push({ op: "ctx", text, oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return { header, lines };
}

/** unified 列排成 split：刪在左、增在右，上下文左右對齊。 */
export function toSplitRows(lines: readonly DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.op === "hunk" || line.op === "meta") {
      rows.push({
        left: { op: "empty", text: line.text, no: null },
        right: { op: "empty", text: "", no: null },
      });
      i++;
      continue;
    }
    if (line.op === "ctx") {
      rows.push({
        left: { op: "ctx", text: line.text, no: line.oldNo },
        right: { op: "ctx", text: line.text, no: line.newNo },
      });
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i]!.op === "del") dels.push(lines[i++]!);
    while (i < lines.length && lines[i]!.op === "add") adds.push(lines[i++]!);
    const n = Math.max(dels.length, adds.length);
    for (let k = 0; k < n; k++) {
      const d = dels[k];
      const a = adds[k];
      rows.push({
        left: d
          ? { op: "del", text: d.text, no: d.oldNo }
          : { op: "empty", text: "", no: null },
        right: a
          ? { op: "add", text: a.text, no: a.newNo }
          : { op: "empty", text: "", no: null },
      });
    }
  }
  return rows;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tint(text: string): string {
  // 極淺的關鍵字著色，失敗也只是純文字
  return esc(text).replace(
    /\b(function|const|let|var|return|import|export|class|type|interface|if|else|async|await|pub|fn|struct|impl|use|from|def)\b/g,
    "<span class=\"hv-kw\">$1</span>",
  );
}

export function renderUnifiedHtml(parsed: ParsedPatch): string {
  const head = parsed.header.length
    ? `<div class="hv-meta">${parsed.header.map((l) => esc(l)).join("\n")}</div>`
    : "";
  const body = parsed.lines
    .map((l) => {
      const cls = `hv-ln hv-ln--${l.op}`;
      const oldN = l.oldNo == null ? "" : String(l.oldNo);
      const newN = l.newNo == null ? "" : String(l.newNo);
      const mark = l.op === "add" ? "+" : l.op === "del" ? "−" : l.op === "hunk" ? "@" : " ";
      const text = l.op === "hunk" || l.op === "meta" ? esc(l.text) : tint(l.text);
      return `<div class="${cls}"><span class="hv-no">${oldN}</span><span class="hv-no">${newN}</span><span class="hv-mk">${mark}</span><span class="hv-tx">${text || " "}</span></div>`;
    })
    .join("");
  return `${head}<div class="hv-body">${body}</div>`;
}

export function renderSplitHtml(parsed: ParsedPatch): string {
  const rows = toSplitRows(parsed.lines);
  const head = parsed.header.length
    ? `<div class="hv-meta">${parsed.header.map((l) => esc(l)).join("\n")}</div>`
    : "";
  const body = rows
    .map((r) => {
      const L = `<div class="hv-cell hv-cell--${r.left.op}"><span class="hv-no">${r.left.no ?? ""}</span><span class="hv-tx">${r.left.text ? tint(r.left.text) : " "}</span></div>`;
      const R = `<div class="hv-cell hv-cell--${r.right.op}"><span class="hv-no">${r.right.no ?? ""}</span><span class="hv-tx">${r.right.text ? tint(r.right.text) : " "}</span></div>`;
      return `<div class="hv-split">${L}${R}</div>`;
    })
    .join("");
  return `${head}<div class="hv-body hv-body--split">${body}</div>`;
}

export function renderPatch(raw: string, mode: "unified" | "split"): string {
  const parsed = parseUnifiedPatch(raw);
  if (!parsed.lines.length && !parsed.header.length) {
    return `<p class="hv-empty">這份沒有可顯示的文字 diff（可能是二進位或空提交）。</p>`;
  }
  return mode === "split" ? renderSplitHtml(parsed) : renderUnifiedHtml(parsed);
}

const NOTE_PREFIX = "anchorline:commit-note:";

export function noteKey(projectId: string, hash: string): string {
  return `${NOTE_PREFIX}${projectId}:${hash}`;
}

export function loadNote(projectId: string, hash: string): string {
  try {
    return localStorage.getItem(noteKey(projectId, hash)) ?? "";
  } catch {
    return "";
  }
}

export function saveNote(projectId: string, hash: string, text: string): void {
  try {
    const k = noteKey(projectId, hash);
    if (text.trim()) localStorage.setItem(k, text);
    else localStorage.removeItem(k);
  } catch {
    /* private mode */
  }
}
