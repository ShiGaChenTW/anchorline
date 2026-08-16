/**
 * UAT 修復交接文字 —— **只整理任務，不碰執行。**
 *
 * `agent-handoff.ts` 已經把「包成哪一條 shell 指令」的責任收斂好了，這裡只回答
 * 另一個問題：一份 UAT 報告交給 agent 時，任務本文到底要寫什麼。把 shell 包裝、
 * 路徑推導、修復工單內容混在一起，日後只要其中一條規則改了，三者就會各自漂移。
 *
 * 純函式、零 I/O、同步。
 */

import { validAnchor } from "./agent-handoff";
import { ANCHOR_PREFIX } from "./plan-parser";
import type { UatEvidence } from "./uat-evidence";
import { uatProgress, type UatItem, type UatReport } from "./uat-parser";

type AnchoredItem = { item: UatItem; anchor: string | null };

const PLANS_SEGMENT = "plans";

function stripTrailingSlashes(raw: string): string {
  return raw.replace(/\/+$/g, "");
}

function anchored(item: UatItem): AnchoredItem {
  return { item, anchor: validAnchor(item.id) };
}

function tildeFence(text: string): string {
  let longest = 0;
  let run = 0;
  for (const ch of text) {
    if (ch === "~") {
      run++;
      if (run > longest) longest = run;
      continue;
    }
    run = 0;
  }
  return "~".repeat(Math.max(4, longest + 1));
}

function noteBlock(text: string): string {
  const fence = tildeFence(text);
  return `${fence}text\n${text}\n${fence}`;
}

function reportLabel(r: UatReport): string {
  const path = r.path?.trim();
  return path ? `\`${path}\`` : `標題「${r.title}」`;
}

function pushItemHeading(
  lines: string[],
  kind: "失敗題" | "不測題" | "暫時跳過題",
  index: number,
): void {
  lines.push(`## ${kind} ${index}`);
}

function pushAnchor(lines: string[], anchor: string | null): void {
  lines.push(`- 錨點：${anchor ? `${ANCHOR_PREFIX}:t=${anchor}` : "無可用錨點"}`);
}

function pushTitle(lines: string[], title: string): void {
  lines.push(`- 標題：${title}`);
}

function pushNote(lines: string[], label: "說明原文" | "原因原文", note: string): void {
  lines.push(`- ${label}：`);
  lines.push(noteBlock(note));
}

function evidenceAbs(reportPath: string | undefined, rel: string): string {
  const root = reportPath ? uatProjectRoot(reportPath) : null;
  if (!root) return rel;
  return `${root}/plans/${rel.replace(/^\/+/, "")}`;
}

function pushEvidence(
  lines: string[],
  reportPath: string | undefined,
  evidence: readonly UatEvidence[] | undefined,
): void {
  if (!evidence?.length) return;
  lines.push("- 證物：先 Read 下列檔案再重現");
  for (const ev of evidence) {
    const loc = evidenceAbs(reportPath, ev.rel);
    const cap = ev.caption.trim();
    lines.push(cap ? `  - ${loc}（${cap}）` : `  - ${loc}`);
  }
}

function pushPendingLine(lines: string[], pending: number): void {
  if (pending > 0) lines.push(`- 使用者尚未測完 ${pending} 題。`);
}

function pushWontItems(lines: string[], items: readonly AnchoredItem[]): void {
  for (const [index, entry] of items.entries()) {
    if (lines[lines.length - 1] !== "") lines.push("");
    pushItemHeading(lines, "不測題", index + 1);
    pushAnchor(lines, entry.anchor);
    pushTitle(lines, entry.item.title);
    pushNote(lines, "原因原文", entry.item.note);
    lines.push("- 定位：FYI only，不用修。");
  }
}

function pushLaterItems(lines: string[], items: readonly AnchoredItem[]): void {
  // `later` 不是 bug，也不是永久不用測；它只是這一輪暫停。完全不提的話，
  // 接手 agent 很容易誤會成「範圍已全數收斂」，所以保留成 FYI，但不升格成修復工單。
  for (const [index, entry] of items.entries()) {
    if (lines[lines.length - 1] !== "") lines.push("");
    pushItemHeading(lines, "暫時跳過題", index + 1);
    pushAnchor(lines, entry.anchor);
    pushTitle(lines, entry.item.title);
    lines.push("- 定位：FYI only，這一輪先不處理，也不要把它當成已修。");
  }
}

/**
 * UAT 報告路徑 → 專案根目錄。
 *
 * 只認真正的 `/plans/` 路徑段。若用子字串比對，`/a/myplans/uat.md` 這類路徑也會
 * 被誤判成 UAT 報告，最後 handoff 會把 agent 帶去使用者根本沒選過的目錄。
 *
 * 多個 `plans` 段時刻意取**最後一個**：離報告最近的那層才是最小且最不意外的
 * 專案邊界；往前多吃一層只會把 agent 帶進更大的樹，錯改面積更大。
 *
 * root-level `/plans/xxx.md` 會回 `null` 而不是空字串，因為空 root 進到 handoff
 * 會安靜地長成 `cd ''` —— 看起來合法，實際上沒有任何人想去那裡工作。
 */
export function uatProjectRoot(reportPath: string): string | null {
  const trimmed = reportPath.trim();
  if (!trimmed) return null;

  const normalized = stripTrailingSlashes(trimmed);
  if (!normalized) return null;

  const segments = normalized.split("/");
  let plansIndex = -1;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i] === PLANS_SEGMENT) plansIndex = i;
  }
  if (plansIndex <= 0) return null;

  const root = segments.slice(0, plansIndex).join("/");
  return root || null;
}

/**
 * UAT 報告 → 修復工單本文。
 *
 * 「失敗題的說明就是修復工單的起點」不是修辭，是防止 handoff 失真：一旦在這裡
 * 先替使用者改寫過，接手 agent 修的是我們的摘要，不是實測者留下的真症狀。
 */
export function uatFixTask(r: UatReport): string {
  const progress = uatProgress(r);
  const failed = r.items.filter((item) => item.verdict === "fail").map(anchored);
  const wont = r.items.filter((item) => item.verdict === "wont").map(anchored);
  const later = r.items.filter((item) => item.verdict === "later").map(anchored);
  const pending = r.items.filter((item) => item.verdict === "pending").length;

  const lines = [
    "- 任務：依這份 UAT 報告接手後續處理；失敗題的說明原文就是修復工單起點。",
    `- 報告：${reportLabel(r)}`,
    `- 標題：${r.title}`,
    `- 進度：已結 ${progress.closed}/${progress.total} 題（${progress.pct}%）`,
  ];
  pushPendingLine(lines, pending);

  if (failed.length === 0) {
    const extras = r.extras ?? [];
    if (extras.length) {
      lines.push("- 結論：沒有失敗題。報告末有補充說明，先讀再判斷要不要另開工作。");
    } else {
      lines.push("- 結論：全數通過/跳過，無需修復。");
      lines.push(
        `- 建議收尾：回覆使用者這份 UAT 目前沒有 fix 工單；若之後要再開一輪，請以 ${reportLabel(r)} 為基準重出新報告。`,
      );
    }
    if (wont.length > 0) pushWontItems(lines, wont);
    if (later.length > 0) pushLaterItems(lines, later);
    pushExtras(lines, r);
    return lines.join("\n");
  }

  lines.push("");
  lines.push("## 修復原則");
  lines.push("- 逐失敗題先重現再修；不要跳過重現直接照猜測改。");
  lines.push(
    "- 每個有合法治理錨點的失敗題，各自獨立 commit；該題下面列出的治理錨點要在 commit 訊息內文獨立一行原樣照抄。那一行是治理鏈的 join key，漏字或改字都會讓事件串不到原題。",
  );
  lines.push(
    '- 全部修完後，用 Skill("Uat") 只針對這次真的修過的題目重出一份標題含「重測」的報告。',
  );
  lines.push(
    "- 重測 spec 的 steps 要一個陣列元素只放一個原子動作，不要用 `→` 把多步驟串成一格；expected 要寫成可明確判定 pass/fail 的結果。",
  );
  lines.push(
    "- UAT CLI 會寫新報告並自動喚醒 Anchorline App；不要另外再手動通知使用者去開 App。",
  );

  for (const [index, entry] of failed.entries()) {
    lines.push("");
    pushItemHeading(lines, "失敗題", index + 1);
    pushAnchor(lines, entry.anchor);
    pushTitle(lines, entry.item.title);
    pushNote(lines, "說明原文", entry.item.note);
    pushEvidence(lines, r.path, entry.item.evidence);
    if (entry.anchor) {
      lines.push(`- 這題修好後，commit 訊息內文獨立一行寫：${ANCHOR_PREFIX}:t=${entry.anchor}`);
    } else {
      // 沒合法錨點時最危險的動作是假造一個看似像樣的治理鍵；那會讓事件「成功」
      // 掛到不存在的任務，表面上沒報錯，實際上整條治理鏈已經斷掉。
      lines.push(
        "- 這題先照說明重現與修復，但不要自己補治理錨點；修完後要明講這題缺合法錨點，請原出題端補一份帶錨點的報告，否則事件串不回治理鏈。",
      );
    }
  }

  if (wont.length > 0) {
    lines.push("");
    lines.push("## FYI：不測題");
    lines.push("- 下面這些題是使用者明確標成不測；保留給你辨識範圍，不是修復目標。");
    pushWontItems(lines, wont);
  }
  if (later.length > 0) {
    lines.push("");
    lines.push("## FYI：暫時跳過題");
    lines.push("- 下面這些題代表這輪測試範圍尚未收齊；先知道有它們，但不要把它們當成要修的 bug。");
    pushLaterItems(lines, later);
  }

  pushExtras(lines, r);
  return lines.join("\n");
}

function pushExtras(lines: string[], r: UatReport): void {
  const extras = r.extras ?? [];
  if (!extras.length) return;
  if (lines[lines.length - 1] !== "") lines.push("");
  lines.push("## 補充說明（題目以外）");
  lines.push(
    "- 定位：使用者在本輪實測另外記下的問題或建議，不是某一題的失敗。先讀、再判斷要不要進修復範圍。不要當成帶錨點的失敗題去 commit。",
  );
  for (const extra of extras) {
    lines.push("");
    lines.push(`### 補充 ${extra.n}`);
    pushNote(lines, "說明原文", extra.text || "（見附件）");
    pushEvidence(lines, r.path, extra.evidence);
  }
}
