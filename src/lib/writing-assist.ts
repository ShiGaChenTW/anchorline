/**
 * ADHD 寫作輔助三件事：
 *
 * 1. 起手式 — 任務啟動失敗的解法不是「說明怎麼寫」，是「把空白頁變成填空題」。
 *    把本章 tips 轉成未填的骨架清單塞進第一個長文欄位。
 *    刻意不插入 `s.example` 原文：範例被誤當成自己的規格是更貴的錯。
 *
 * 2. Hyperfocus 守門 — 連續寫作計時，每 25 分鐘提醒一次。
 *    可 snooze、可本次 session 永久關閉；ADHD 對重複打斷特別敏感，
 *    一個關不掉的提醒會比沒有提醒更糟。
 *
 * 3. 中斷復原 — 記住「上次游標停在哪個欄位第幾個字」，回來時直接放回去。
 *    ADHD 被打斷後的重新定位成本很高，省掉這一步等於省掉一次放棄。
 */
import type { Section } from "../data/types";
import { toast } from "./ui";

const RESUME_KEY = "anchorline:resume:v1";
/** 超過這個天數就不還原游標了，比較可能是新的一段工作 */
const RESUME_MAX_AGE_DAYS = 7;
/** 連續寫作提醒間隔（分鐘） */
const NUDGE_EVERY_MIN = 25;
/** 停筆超過這麼久就當作新的一段連續寫作 */
const IDLE_RESET_MIN = 5;

// ── 1. 起手式 ────────────────────────────────────────────────

/**
 * 把 tips 變成填空骨架。tips 是「先寫失敗模式，再寫頻率／代價」這種句子，
 * 拆掉引導詞後當成待填欄位標題。
 */
export function starterScaffold(s: Section): string {
  const lines = s.tips.map((t) => {
    const cleaned = t
      .replace(/^(先|再|建議|記得|請)/, "")
      .replace(/[。．.]$/, "")
      .trim();
    return `- ${cleaned}：`;
  });
  return lines.length ? lines.join("\n") : `- ${s.title}：`;
}

/** 目前這一節是不是空的（空才需要起手式） */
export function isSectionBlank(values: Record<string, string>): boolean {
  return Object.values(values).join("").trim().length < 10;
}

/**
 * 掛「放入起手骨架」按鈕。只在本節幾乎全空時出現——
 * 已經開始寫的人不需要鷹架，看到只會覺得吵。
 */
export function ensureStarter(
  s: Section,
  values: Record<string, string>,
  onInsert: (key: string, value: string) => void,
) {
  const body = document.getElementById("editor-body");
  document.getElementById("wa-starter")?.remove();
  if (!body || !isSectionBlank(values)) return;

  const firstLong = s.fields.find((f) => f.type === "textarea");
  if (!firstLong) return;

  const strip = document.createElement("div");
  strip.id = "wa-starter";
  strip.className = "wa-starter";
  strip.innerHTML = `
    <span class="wa-starter-text">空白頁不用硬想。先放一份填空骨架，再一格一格補。</span>
    <button type="button" class="btn btn-sm btn-primary" id="wa-starter-btn">放入起手骨架</button>
  `;

  const anchor = body.querySelector(".adhd-guide") ?? body.querySelector("header");
  anchor?.insertAdjacentElement("afterend", strip);

  document.getElementById("wa-starter-btn")?.addEventListener("click", () => {
    onInsert(firstLong.key, starterScaffold(s));
    toast("已放入骨架 — 每行冒號後面補一句就好");
  });
}

// ── 2. Hyperfocus 守門 ───────────────────────────────────────

let sessionStart = 0;
let lastKeystroke = 0;
let nextNudgeAt = 0;
let nudgesOff = false;
let timerId: ReturnType<typeof setInterval> | null = null;

/** 每次打字呼叫；負責重置 idle 與起算連續寫作 */
export function markActivity() {
  const now = Date.now();
  if (!sessionStart || now - lastKeystroke > IDLE_RESET_MIN * 60_000) {
    sessionStart = now;
    nextNudgeAt = now + NUDGE_EVERY_MIN * 60_000;
  }
  lastKeystroke = now;
}

/** 連續寫作時間標籤；沒在寫就回空字串（不佔版面） */
export function elapsedLabel(): string {
  if (!sessionStart) return "";
  const mins = Math.floor((Date.now() - sessionStart) / 60_000);
  return mins >= 1 ? ` · 已寫 ${mins} 分` : "";
}

export function initHyperfocusGuard() {
  if (timerId) return;
  timerId = setInterval(() => {
    if (nudgesOff || !sessionStart || !nextNudgeAt) return;
    if (Date.now() < nextNudgeAt) return;
    // 停筆中就不打斷，等他回來再算
    if (Date.now() - lastKeystroke > IDLE_RESET_MIN * 60_000) return;

    const mins = Math.round((Date.now() - sessionStart) / 60_000);
    nextNudgeAt = Date.now() + NUDGE_EVERY_MIN * 60_000;
    showNudge(mins);
  }, 30_000);
}

function showNudge(mins: number) {
  document.getElementById("wa-nudge")?.remove();
  const el = document.createElement("div");
  el.id = "wa-nudge";
  el.className = "wa-nudge";
  el.setAttribute("role", "status");
  el.innerHTML = `
    <span>已連續寫 ${mins} 分鐘。站起來走一下？</span>
    <button type="button" class="btn btn-sm" data-wa="snooze">再 10 分鐘</button>
    <button type="button" class="btn btn-sm btn-ghost" data-wa="off">今天別再提醒</button>
  `;
  document.body.appendChild(el);

  el.querySelector('[data-wa="snooze"]')?.addEventListener("click", () => {
    nextNudgeAt = Date.now() + 10 * 60_000;
    el.remove();
  });
  el.querySelector('[data-wa="off"]')?.addEventListener("click", () => {
    nudgesOff = true;
    el.remove();
    toast("本次不再提醒休息");
  });

  setTimeout(() => el.remove(), 20_000);
}

// ── 3. 中斷復原 ──────────────────────────────────────────────

type ResumeMark = { sectionId: string; key: string; caret: number; at: number };

export function saveResumeMark(sectionId: string, key: string, caret: number) {
  try {
    localStorage.setItem(
      RESUME_KEY,
      JSON.stringify({ sectionId, key, caret, at: Date.now() } satisfies ResumeMark),
    );
  } catch {
    /* private mode */
  }
}

function readResumeMark(): ResumeMark | null {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as ResumeMark;
    if (!m?.sectionId || typeof m.caret !== "number") return null;
    if (Date.now() - m.at > RESUME_MAX_AGE_DAYS * 86_400_000) return null;
    return m;
  } catch {
    return null;
  }
}

/** 只還原一次：同一次載入內切章節不該一直把游標搶回去 */
let resumeApplied = false;

/**
 * 本節若就是上次停筆的地方，把游標放回去並閃一下。
 * 找不到就安靜跳過——復原失敗不該變成一則錯誤訊息。
 */
export function restoreCaret(sectionId: string) {
  if (resumeApplied) return;
  const m = readResumeMark();
  if (!m || m.sectionId !== sectionId) return;
  resumeApplied = true;

  const ta = document.querySelector<HTMLTextAreaElement>(
    `#editor-body [data-mdv-key="${CSS.escape(m.key)}"] textarea`,
  );
  if (!ta) return;

  const pos = Math.min(m.caret, ta.value.length);
  ta.focus();
  ta.setSelectionRange(pos, pos);
  ta.scrollTop = ta.scrollHeight * (pos / Math.max(1, ta.value.length)) - ta.clientHeight / 2;

  import("./attention-motion")
    .then((mod) => mod.flashFocus(ta))
    .catch(() => {});
  toast("接回上次停筆的位置");
}

/** 綁 textarea 的游標記錄（每次 renderEditor 後呼叫，重複綁用 dataset 擋掉） */
export function bindResumeTracking(sectionId: string) {
  document
    .querySelectorAll<HTMLTextAreaElement>("#editor-body textarea")
    .forEach((ta) => {
      if (ta.dataset.waResume === "1") return;
      ta.dataset.waResume = "1";
      const key =
        ta.closest<HTMLElement>("[data-mdv-key]")?.dataset.mdvKey ?? "";
      const save = () => saveResumeMark(sectionId, key, ta.selectionStart ?? 0);
      ta.addEventListener("blur", save);
      ta.addEventListener("keyup", save);
    });
}

// ponytail: nudge 用 setInterval 30s 輪詢而不是精準 setTimeout — 誤差 30 秒對
// 「該休息了」完全無所謂，換來不用管分頁休眠後的排程漂移。
