/**
 * ADHD 兩個核心缺損的對策，一個檔案兩件事：
 *
 * 1. 專注模式 — 工作記憶容量約 4 個開放迴圈，原介面同框約 30 個。
 *    收掉大綱欄、預覽欄、教練欄除首卡外全部，只留「一句話該做什麼 + 打字的地方」。
 *
 * 2. 進度膠囊 — 時間盲是 ADHD 的核心缺損，原介面零時間資訊。
 *    「第 X/Y 節 · 還差 N 字 · 約 M 分」+ 一條會動的進度條。
 *    ADHD 對「看得到在動的東西」的反應遠強於對數字目標。
 */

import { elapsedLabel } from "./writing-assist";

const KEY = "specforge:focus";
/** 中文草稿速度，字/分。保守估，寧可高估剩餘時間也不要讓人覺得被騙。 */
const CHARS_PER_MIN = 40;
/** hint 沒寫字數時的預設目標 */
const DEFAULT_TARGET = 200;

export function isFocusMode(): boolean {
  return document.documentElement.classList.contains("focus-mode");
}

export function setFocusMode(on: boolean) {
  document.documentElement.classList.toggle("focus-mode", on);
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* private mode */
  }

  const btn = document.getElementById("btn-focus");
  if (btn) {
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = on ? "專注中 ●" : "專注模式";
  }

  // 專注模式下 markdown 欄位切「寫作」單欄：直接點既有按鈕，重用既有切換邏輯
  if (on) {
    document
      .querySelectorAll<HTMLButtonElement>('[data-mdv-mode="write"]')
      .forEach((b) => {
        if (!b.classList.contains("on")) b.click();
      });
  }
}

/** 從 hint（如「150–250 字」）取目標字數上限；取不到回傳預設值 */
function targetFromHint(hint: string | null | undefined): number {
  if (!hint) return 0;
  const nums = hint.match(/\d+/g);
  if (!nums) return 0;
  return Math.max(...nums.map(Number));
}

/**
 * 掃描目前編輯區所有欄位，算出本節目標字數與已寫字數。
 * 讀 DOM 而非 store：進度條要跟著游標動，DOM 是最新的那一份。
 */
function measure(): { written: number; target: number } {
  const body = document.getElementById("editor-body");
  if (!body) return { written: 0, target: 0 };

  let written = 0;
  let target = 0;

  body.querySelectorAll<HTMLTextAreaElement>("textarea").forEach((ta) => {
    written += ta.value.trim().length;
    const field = ta.closest(".mdv-field");
    const hintEl = field?.querySelector("label span");
    target += targetFromHint(hintEl?.textContent) || DEFAULT_TARGET;
  });
  body.querySelectorAll<HTMLInputElement>("input[data-key]").forEach((el) => {
    written += el.value.trim().length;
  });

  return { written, target };
}

/**
 * 掛「專注模式」按鈕到編輯欄標題列（上一節／下一節旁邊）。
 * 刻意不放主工具列：adhd-ui.ts 的 collapseToolbar 會把次要按鈕掃進「更多」，
 * 而且工具列重組發生在 rAF 裡——分頁在背景時 rAF 不觸發，按鈕就掛不上去。
 * 這裡是使用者眼睛本來就在的地方，也沒有時序依賴。
 */
function ensureFocusButton(head: Element) {
  if (document.getElementById("btn-focus")) return;
  const btnHost = head.querySelector("div") ?? head;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "btn-focus";
  btn.className = "btn btn-sm";
  btn.title = "只留「該做什麼」和「打字的地方」（⌥F）";
  btn.setAttribute("aria-pressed", isFocusMode() ? "true" : "false");
  btn.textContent = isFocusMode() ? "專注中 ●" : "專注模式";
  btn.addEventListener("click", () => setFocusMode(!isFocusMode()));
  btnHost.prepend(btn);
}

/** 更新（必要時建立）編輯欄標題列的進度膠囊 */
export function renderProgress(sectionIdx: number, sectionCount: number) {
  const head = document.querySelector(".editor-pane .wb-head");
  if (!head) return;
  ensureFocusButton(head);

  let cap = document.getElementById("focus-progress");
  if (!cap) {
    cap = document.createElement("div");
    cap.id = "focus-progress";
    cap.className = "focus-progress";
    cap.setAttribute("role", "status");
    cap.setAttribute("aria-label", "本節寫作進度");
    cap.innerHTML = `<div class="focus-progress-text"></div>
      <div class="focus-progress-track"><div class="focus-progress-fill"></div></div>`;
    head.insertAdjacentElement("afterend", cap);
  }

  const { written, target } = measure();
  const remaining = Math.max(0, target - written);
  const pct = target ? Math.min(100, Math.round((written / target) * 100)) : 0;
  const mins = Math.max(1, Math.ceil(remaining / CHARS_PER_MIN));

  const tail = remaining
    ? `還差 ${remaining} 字 · 約 ${mins} 分`
    : "本節字數已達標 ✓";

  (cap.querySelector(".focus-progress-text") as HTMLElement).textContent =
    `第 ${sectionIdx + 1} / ${sectionCount} 節 · ${tail}${elapsedLabel()}`;
  (cap.querySelector(".focus-progress-fill") as HTMLElement).style.transform = `scaleX(${pct / 100})`;
  cap.classList.toggle("is-done", remaining === 0 && written > 0);

  // 欄位每次重繪都是新的 DOM，專注模式的「寫作單欄」要重新套用。
  // `.on` 檢查讓這步冪等，重複呼叫不會亂點。
  if (isFocusMode()) setFocusMode(true);
}

/** 綁 ⌥F 快捷鍵 + 還原上次狀態。按鈕由 renderProgress 掛上。 */
export function initFocusMode() {
  // ⌥F：Alt 修飾鍵，不會和在 textarea 裡打字衝突
  document.addEventListener("keydown", (e) => {
    if (e.altKey && (e.key === "f" || e.key === "F" || e.code === "KeyF")) {
      e.preventDefault();
      setFocusMode(!isFocusMode());
    }
  });

  let saved = "0";
  try {
    saved = localStorage.getItem(KEY) ?? "0";
  } catch {
    /* private mode */
  }
  setFocusMode(saved === "1");
}

// ponytail: 進度條讀 DOM 而非 store，所以 renderEditor 重繪後必須再呼叫一次 renderProgress。
// 沒有 MutationObserver — 呼叫點只有兩個（renderEditor 尾巴、input handler），手動接比較好追。
