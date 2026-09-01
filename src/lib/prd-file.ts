/**
 * PRD 檔案落地 —— 主檔與版本快照。純函式在上半，沒有 I/O。
 *
 * ## App 裡已經有版本了，為什麼還要寫檔
 *
 * `AppState.prdVersions` 是一條完整的版本線（送審＝commit、核准＝merge，
 * 各自帶著整份 PRD 的深拷貝）。它的問題不是不完整，是**只活在 localStorage
 * 裡**：`capVersions` 會把舊 commit 丟掉，清一次瀏覽器資料整條線就消失，
 * 而且 App 之外沒有任何人讀得到它 —— 工程師 clone 下來看不到 PRD。
 *
 * 落成檔案之後它進 git、進備份、被 grep 得到、被 diff 得出來。
 *
 * ## 為什麼是兩份
 *
 * `docs/PRD.md` 是**主檔**：只有一份、永遠是最新的、會被 git 追蹤。逐次歷史
 * 交給 git（`history.html` 已經看得到 diff），這裡不重造一套。
 *
 * `.anchorline/prd/PRD-<時間>-<commit|merge>.md` 是**快照**，不覆寫。它回答
 * git 答不了的那個問題 ——「上一次**核准**的版本跟現在差在哪」。git 只知道
 * 每一次 commit，不知道哪一次 commit 是核准。
 */
import type { Project, PrdVersion, Section } from "../data/types";
import { projectDisplayName } from "../data/types";

/** 快照目錄，相對專案根 */
export const PRD_VERSION_DIR = ".anchorline/prd";

/** 主檔路徑，相對專案根。Rust 端寫死同一個位置，這裡是給畫面講話用的。 */
export const PRD_MAIN_PATH = "docs/PRD.md";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * `PRD-YYYYMMDD-HHmm-<commit|merge>.md`。
 *
 * 版本種類放進檔名而不是只放檔案內容裡：使用者在 Finder 或 `ls` 看到的是
 * 檔名，而「哪一份是核准版」是這個目錄唯一會被問的問題。要開檔才知道的話，
 * 這個目錄就只是一堆時間戳。
 */
export function prdVersionFileName(version: Pick<PrdVersion, "kind">, at: Date): string {
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `PRD-${stamp}-${version.kind}.md`;
}

/** 從檔名把時間與種類讀回來。認不得就回 null —— 使用者自己丟進來的檔不該讓畫面壞掉。 */
export function parsePrdVersionName(
  fileName: string,
): { at: Date; kind: PrdVersion["kind"] } | null {
  const m = /^PRD-(\d{8})-(\d{4})-(commit|merge)\.md$/.exec(fileName);
  if (!m) return null;
  const d = m[1]!;
  const t = m[2]!;
  const at = new Date(
    `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:00`,
  );
  if (Number.isNaN(at.getTime())) return null;
  return { at, kind: m[3] as PrdVersion["kind"] };
}

export type PrdVersionFile = { name: string; mtimeMs: number; bytes: number };

export type PrdFileVersion = {
  name: string;
  at: Date;
  kind: PrdVersion["kind"] | null;
  bytes: number;
};

/**
 * 版本清單，新到舊。**時間優先讀檔名**，讀不到才退回 mtime ——
 * 檔案被複製或搬動時 mtime 會變，而檔名裡的時間是那一版真正產生的時刻。
 */
export function sortPrdFileVersions(files: readonly PrdVersionFile[]): PrdFileVersion[] {
  return files
    .map((f) => {
      const parsed = parsePrdVersionName(f.name);
      return {
        name: f.name,
        at: parsed?.at ?? new Date(f.mtimeMs),
        kind: parsed?.kind ?? null,
        bytes: f.bytes,
      };
    })
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

/**
 * 最近一次核准的那一份檔案。沒有就 null ——「跟上次核准差在哪」問不出來時
 * 要說得出「因為還沒核准過」，而不是靜靜拿最新的那份充數。
 */
export function lastApprovedFile(versions: readonly PrdFileVersion[]): PrdFileVersion | null {
  return versions.find((v) => v.kind === "merge") ?? null;
}

// ── markdown 渲染 ──────────────────────────────────────────────

export type RenderInput = {
  project: Project;
  /** 這個專案目前的骨架。**已經套過路線過濾** —— Lite 藏起來的章節不寫進檔案 */
  sections: Section[];
  /** 那一版的整份正文：sectionId → fieldKey → 內容 */
  docs: Record<string, Record<string, string>>;
  version: PrdVersion;
};

const KIND_LABEL: Record<PrdVersion["kind"], string> = {
  commit: "送審",
  merge: "核准",
};

/**
 * 一版 PRD 的 markdown。
 *
 * 為什麼不重用 `export.buildMarkdown`：那一支讀的是 `state.sections` /
 * `state.sectionValues`（active 專案的**現況**），還會夾帶 active 專案的
 * 留言與簽核狀態。用它產「核准那一刻的版本」會混進核准之後才打的字，
 * 而且看起來完全正常。這裡只吃傳進來的 `docs`，不碰任何全域狀態。
 *
 * 空章節照樣寫一行 `_（本章尚無內容）_`：整節消失的話，讀檔的人分不出
 * 「這一節沒寫」與「這一節不在這份 PRD 的範圍裡」—— 而 Lite 路線讓後者
 * 真的會發生。
 */
export function renderPrdMarkdown({ project, sections, docs, version }: RenderInput): string {
  const at = new Date(version.at);
  const lines: string[] = [
    `<!-- Anchorline PRD ${version.kind} ${version.id} — 由 Anchorline 產生，手改不會回寫到 App -->`,
    ``,
    `# ${projectDisplayName(project)}`,
    ``,
    `| 欄位 | 值 |`,
    `|---|---|`,
    `| 版本 | \`${version.id}\`（${KIND_LABEL[version.kind]}） |`,
    `| 時間 | ${at.toLocaleString("zh-TW")} |`,
    `| 提交者 | ${version.byName} |`,
    `| 專案狀態 | ${project.status} |`,
    `| 路線 | ${project.route === "lite" ? `Lite（${sections.length} 節）` : `Full（${sections.length} 節）`} |`,
    ``,
  ];
  if (version.message) lines.push(`> ${version.message}`, ``);

  for (const s of sections) {
    lines.push(`## ${s.n} ${s.title}`, ``);
    let any = false;
    for (const f of s.fields) {
      const val = (docs[s.id]?.[f.key] ?? "").trim();
      if (!val) continue;
      any = true;
      lines.push(`### ${f.label}`, ``, val, ``);
    }
    if (!any) lines.push(`_（本章尚無內容）_`, ``);
  }
  return lines.join("\n");
}
