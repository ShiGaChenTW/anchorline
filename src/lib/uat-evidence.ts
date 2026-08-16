/**
 * UAT 證物（題目附件 + 報告末補充）的純函式。
 *
 * 圖檔本體由原生橋寫進 `plans/uat-assets/<報告 stem>/`。
 * 這裡只負責命名、相對路徑、以及 markdown 那一行的讀寫。
 *
 * 純函式、零 I/O。
 */

export type UatEvidence = {
  /** 檔名，例如 `T1-01.png` / `S2-03.jpg` */
  name: string;
  /** 相對報告檔的路徑，例如 `uat-assets/uat-checkout/T1-01.png` */
  rel: string;
  caption: string;
};

export type UatExtra = {
  /** 1-based 穩定編號。刪中間一則不重排 */
  n: number;
  text: string;
  evidence: UatEvidence[];
};

export const EXTRA_SECTION_TITLE = "補充說明";

const EXTRA_TITLES = new Set(["補充說明", "補充"]);

const EVIDENCE_LINE_RE =
  /^(?:[-*]\s*)?!\[([^\]]*)\]\(([^)]+)\)(?:\s+(.*))?$/;

const NAME_RE = /^[TS]\d{1,3}-\d{2}\.(?:png|jpg|jpeg|webp)$/i;
const PREFIX_RE = /^[TS]\d{1,3}$/i;
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp"]);

export function isExtraSectionTitle(title: string): boolean {
  return EXTRA_TITLES.has(title.trim());
}

export function isEvidenceName(name: string): boolean {
  return NAME_RE.test(name.trim());
}

export function isEvidencePrefix(prefix: string): boolean {
  return PREFIX_RE.test(prefix.trim());
}

export function extOfMime(mime: string): string | null {
  const t = mime.toLowerCase().split(";", 1)[0]!.trim();
  if (t === "image/png") return "png";
  if (t === "image/jpeg") return "jpg";
  if (t === "image/webp") return "webp";
  return null;
}

export function mimeOfName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "image/png";
}

/** 報告絕對路徑 → `uat-assets` 子目錄用的 stem（檔名去掉副檔名） */
export function reportAssetStem(reportPath: string): string {
  const base = reportPath.replace(/\\/g, "/").split("/").pop() ?? "";
  return base.replace(/\.(?:md|markdown)$/i, "") || "uat";
}

export function evidenceRel(reportPath: string, name: string): string {
  return `uat-assets/${reportAssetStem(reportPath)}/${name}`;
}

export function itemPrefix(title: string, fallbackIndex: number): string {
  const m = title.trim().match(/^(T\d{1,3})\b/i);
  if (m) return m[1]!.toUpperCase();
  const n = Math.max(1, fallbackIndex);
  return `T${n}`;
}

export function extraPrefix(n: number): string {
  return `S${Math.max(1, n)}`;
}

export function nextEvidenceName(
  prefix: string,
  existing: readonly { name: string }[],
  ext = "png",
): string {
  const head = prefix.trim().toUpperCase();
  const safeExt = IMAGE_EXTS.has(ext.toLowerCase()) ? ext.toLowerCase() : "png";
  let max = 0;
  const re = new RegExp(`^${head}-(\\d{2,})\\.`, "i");
  for (const e of existing) {
    const m = e.name.match(re);
    if (!m) continue;
    const n = Number(m[1]);
    if (n > max) max = n;
  }
  return `${head}-${String(max + 1).padStart(2, "0")}.${safeExt}`;
}

export function nextExtraNumber(extras: readonly { n: number }[]): number {
  let max = 0;
  for (const e of extras) if (e.n > max) max = e.n;
  return max + 1;
}

export function parseEvidenceLine(raw: string): UatEvidence | null {
  const m = raw.trim().match(EVIDENCE_LINE_RE);
  if (!m) return null;
  const rel = (m[2] ?? "").trim();
  if (!rel || rel.includes("://")) return null;
  const fromRel = rel.split("/").pop() ?? "";
  const alt = (m[1] ?? "").trim();
  const name = isEvidenceName(fromRel)
    ? fromRel
    : isEvidenceName(alt)
      ? alt
      : fromRel;
  if (!isEvidenceName(name)) return null;
  return { name, rel, caption: (m[3] ?? "").trim() };
}

export function formatEvidenceLine(e: UatEvidence): string {
  const alt = e.name.replace(/\.[^.]+$/, "");
  const cap = e.caption.trim();
  return cap ? `- ![${alt}](${e.rel}) ${cap}` : `- ![${alt}](${e.rel})`;
}

export function parseExtraBody(lines: readonly string[]): UatExtra[] {
  const extras: UatExtra[] = [];
  let cur: UatExtra | null = null;
  const textBuf: string[] = [];

  const flush = () => {
    if (!cur) return;
    cur.text = textBuf.join("\n").trim();
    extras.push(cur);
    cur = null;
    textBuf.length = 0;
  };

  for (const raw of lines) {
    const s = raw.trim();
    if (s === "（無）" && extras.length === 0 && !cur) continue;
    const start = s.match(/^(\d+)[.)]\s*(.*)$/);
    if (start) {
      flush();
      cur = { n: Number(start[1]), text: "", evidence: [] };
      if (start[2]?.trim()) textBuf.push(start[2].trim());
      continue;
    }
    if (!cur) continue;
    const ev = parseEvidenceLine(s);
    if (ev) {
      cur.evidence.push(ev);
      continue;
    }
    if (s) textBuf.push(s);
  }
  flush();
  return extras.filter((e) => e.text || e.evidence.length);
}

export function formatExtrasSection(extras: readonly UatExtra[]): string[] {
  const kept = extras.filter((e) => e.text.trim() || e.evidence.length);
  if (!kept.length) return [];
  const out = [`## ${EXTRA_SECTION_TITLE}`, ""];
  for (const e of kept) {
    const text = e.text.trim() || "（見附件）";
    const [first, ...rest] = text.split("\n");
    out.push(`${e.n}. ${first}`);
    for (const line of rest) out.push(`   ${line}`);
    for (const ev of e.evidence) out.push(`   ${formatEvidenceLine(ev)}`);
    out.push("");
  }
  return out;
}

/** 剪貼簿／檔案 bytes → base64。分塊避免大圖 spread 爆 stack。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  return bytesToBase64(buf);
}
