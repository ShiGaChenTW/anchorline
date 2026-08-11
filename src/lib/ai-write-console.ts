/**
 * AI 撰寫工作台 —— 一個逐字播放的執行視窗。
 *
 * ## 為什麼要有它
 *
 * 原本的 AI 撰寫是一條進度列加一個滾動的 `<pre>`：你知道它在跑，但不知道
 * 它憑什麼那樣寫。要判斷產出好不好，得看得到三件事 —— **用了什麼**（領域包、
 * 撰寫角色、模型）、**過程做了什麼**（逐節開始／完成／略過／失敗）、
 * **模型實際吐了什麼**。這個視窗把三者攤在同一條時間軸上。
 *
 * ## 誠實邊界（重要）
 *
 * 這裡**不偽造「思考過程」**。目前接的三家 API 都只回最終文字，沒有獨立的
 * reasoning 串流。所以時間軸上標成「模型輸出」的就是模型真的送出來的位元組，
 * 逐字播放只是播放速度，不是編出來的內心戲。哪天接上會回 reasoning 的供應商，
 * 那一段自然會多出來 —— 在那之前，寫「思考中…」然後放一段假推理，是最容易做
 * 也最該避免的謊。
 *
 * ## 關不掉是刻意的
 *
 * 沒有 Esc、沒有點背景關閉、沒有右上角的 ×。這個視窗底下正在改的是使用者的
 * 草稿，隨手關掉會留下「寫到一半、不知道存了什麼」的狀態。要離開只有三條路，
 * 而且每一條都寫明它對草稿做了什麼：存檔／暫存／取消。
 */
import { escapeHtml } from "./ui";

const ID = "ai-write-console";

export type ConsoleKind = "skill" | "plan" | "step" | "ok" | "skip" | "fail" | "stream" | "me" | "ai" | "note";

export type WriteConsoleOpts = {
  title: string;
  subtitle: string;
  /** 這次執行真的用到的東西。空陣列就不畫那一列 */
  skills: string[];
  /** 使用者送出對話。回傳的字串會被逐字播出來 */
  onChat: (message: string) => Promise<string>;
  /** 停止進行中的執行 */
  onStop: () => void;
  /** 三個出口。回 false 代表不要關（例如存檔失敗） */
  onSave: () => boolean | Promise<boolean>;
  onStash: () => boolean | Promise<boolean>;
  onCancel: () => boolean | Promise<boolean>;
};

export type WriteConsole = {
  /** 加一行敘事，逐字播 */
  line(kind: ConsoleKind, text: string): void;
  /** 模型逐字輸出。同一段會累積在同一個泡泡裡 */
  delta(chunk: string): void;
  /** 這一段模型輸出結束，下次 delta 開新泡泡 */
  endStream(): void;
  /** 執行結束，footer 換成三個出口 */
  finish(): void;
  /** 還開著嗎 —— 呼叫端在 await 之後要確認畫面還在 */
  alive(): boolean;
};

/**
 * 逐字播放速度。**會隨積壓自動加速。**
 *
 * 固定速度在這裡是錯的：一節的模型輸出就有三四百字，七節排隊時固定
 * 2 字/tick 會讓畫面落後真實進度十幾秒 —— 使用者看到的是「完成」還沒打完，
 * 底下卻已經在寫下一節了。積壓越多打越快，短句子仍然維持看得清的節奏。
 */
const MS_PER_TICK = 16;
/** 目標播放速度（字/秒）。積壓時會自動超過它 */
const CHARS_PER_SEC = 190;
/** 積壓要在大約這麼久之內清完 */
const DRAIN_MS = 600;
/** 超過這個長度就直接倒完，不再演 */
const FLUSH_OVER = 1200;

const KIND_LABEL: Record<ConsoleKind, string> = {
  skill: "能力",
  plan: "準備",
  step: "進行",
  ok: "完成",
  skip: "略過",
  fail: "失敗",
  stream: "模型輸出",
  me: "你",
  ai: "AI",
  note: "說明",
};

export function openWriteConsole(opts: WriteConsoleOpts): WriteConsole {
  document.getElementById(ID)?.remove();

  const back = document.createElement("div");
  back.className = "modal-back awc-back open";
  back.id = ID;
  back.innerHTML = `<div class="modal awc" role="dialog" aria-modal="true" aria-labelledby="awc-title">
    <header>
      <div>
        <h3 id="awc-title">${escapeHtml(opts.title)}</h3>
        <p class="sub" id="awc-sub">${escapeHtml(opts.subtitle)}</p>
      </div>
      <span class="awc-live" id="awc-live" aria-hidden="true"><i></i><i></i><i></i></span>
    </header>
    ${
      opts.skills.length
        ? `<div class="awc-skills" aria-label="這次用到的能力">${opts.skills
            .map((s) => `<span class="awc-skill">${escapeHtml(s)}</span>`)
            .join("")}</div>`
        : ""
    }
    <div class="body awc-body" id="awc-body" role="log" aria-live="polite"></div>
    <div class="awc-chat">
      <input type="text" id="awc-input" placeholder="想改什麼就直接說 —— 例如「口氣正式一點」" aria-label="對話" />
      <button type="button" class="btn btn-sm" id="awc-send">送出</button>
    </div>
    <footer class="awc-foot" id="awc-foot"></footer>
  </div>`;
  document.body.appendChild(back);

  const body = back.querySelector("#awc-body") as HTMLElement;
  const foot = back.querySelector("#awc-foot") as HTMLElement;
  const input = back.querySelector("#awc-input") as HTMLInputElement;

  let closed = false;
  let running = true;
  let chatBusy = false;

  // ── 逐字播放 ────────────────────────────────────────────────
  //
  // 一條佇列，每個項目知道自己要寫進哪個節點。分開兩條（敘事一條、串流一條）
  // 會讓兩者的先後順序在畫面上錯亂 —— 而順序正是這條時間軸唯一的價值。
  type Job = { el: HTMLElement; text: string; i: number };
  const queue: Job[] = [];
  let timer: number | undefined;

  function atBottom(): boolean {
    return body.scrollHeight - body.scrollTop - body.clientHeight < 40;
  }

  /** 上一次 pump 的時間。預算按**真實經過的時間**算，不是按 tick 數。 */
  let lastTick = 0;

  function pump() {
    if (closed) return;
    const now = performance.now();
    // 分頁在背景時瀏覽器會把 setInterval 節流到約 1 秒一次。按 tick 給預算的話
    // 播放速度就跟著掉到 1/60，回到前景會看到字還在慢慢跑而底下早就寫完了。
    // 用「距離上次過了多久」算，被節流時自然會一次補上該播的量。
    const elapsed = lastTick ? Math.min(2000, now - lastTick) : MS_PER_TICK;
    lastTick = now;

    const stick = atBottom();
    const total = queue.reduce((a, j) => a + (j.text.length - j.i), 0);
    // 落後太多就一次倒完：播放速度是體驗，正確的內容才是重點
    const paced = Math.ceil((CHARS_PER_SEC * elapsed) / 1000);
    let budget =
      total > FLUSH_OVER ? total : Math.max(paced, Math.ceil((total * elapsed) / DRAIN_MS));

    while (budget > 0 && queue.length) {
      const j = queue[0]!;
      const take = Math.min(budget, j.text.length - j.i);
      j.el.textContent = (j.el.textContent ?? "") + j.text.slice(j.i, j.i + take);
      j.i += take;
      budget -= take;
      if (j.i >= j.text.length) queue.shift();
    }
    if (stick) body.scrollTop = body.scrollHeight;
    if (!queue.length) {
      window.clearInterval(timer);
      timer = undefined;
      lastTick = 0;
    }
  }

  function ensurePump() {
    if (timer === undefined) {
      lastTick = 0;
      timer = window.setInterval(pump, MS_PER_TICK);
    }
  }

  // 回到前景立刻補上被節流期間欠的量，不要讓人盯著字慢慢爬
  const onVisible = () => {
    if (!closed && document.visibilityState === "visible") pump();
  };
  document.addEventListener("visibilitychange", onVisible);

  function rowFor(kind: ConsoleKind): HTMLElement {
    const row = document.createElement("div");
    row.className = `awc-row awc-${kind}`;
    row.innerHTML = `<span class="awc-tag">${escapeHtml(KIND_LABEL[kind])}</span><span class="awc-text"></span>`;
    body.appendChild(row);
    return row.querySelector(".awc-text") as HTMLElement;
  }

  function push(kind: ConsoleKind, text: string) {
    if (closed) return;
    queue.push({ el: rowFor(kind), text, i: 0 });
    ensurePump();
  }

  /** 目前這一段模型輸出的容器。null = 下一次 delta 要開新的 */
  let streamEl: HTMLElement | null = null;

  // ── 出口 ────────────────────────────────────────────────────

  function close() {
    closed = true;
    window.clearInterval(timer);
    document.removeEventListener("keydown", swallowEsc, true);
    document.removeEventListener("visibilitychange", onVisible);
    back.remove();
  }

  async function exitVia(fn: () => boolean | Promise<boolean>) {
    const ok = await fn();
    if (ok) close();
  }

  function renderFoot() {
    foot.innerHTML = running
      ? `<span class="awc-foot-note">執行中 —— 停止之後已寫好的章節會留在草稿裡。</span>
         <button type="button" class="btn btn-ghost" data-awc="cancel">取消</button>
         <button type="button" class="btn" data-awc="stop">停止</button>`
      : `<span class="awc-foot-note">存檔＝寫進正文；暫存＝留在草稿；取消＝丟掉這次產出。</span>
         <button type="button" class="btn btn-ghost" data-awc="cancel">取消</button>
         <button type="button" class="btn" data-awc="stash">暫存</button>
         <button type="button" class="btn btn-primary" data-awc="save">存檔</button>`;
    foot.querySelectorAll<HTMLButtonElement>("[data-awc]").forEach((b) => {
      b.addEventListener("click", () => {
        const act = b.dataset.awc;
        if (act === "stop") return opts.onStop();
        if (act === "cancel") return void exitVia(opts.onCancel);
        if (act === "stash") return void exitVia(opts.onStash);
        if (act === "save") return void exitVia(opts.onSave);
      });
    });
  }
  renderFoot();

  // 這個視窗**只能**從那三顆按鈕離開。
  // 背景點擊不關；Esc 也不關 —— capture 階段就吃掉，免得別的地方的
  // 全域 Esc 處理器（help overlay、其他 modal）先把它關掉。
  back.addEventListener("click", (e) => e.stopPropagation());
  const swallowEsc = (e: KeyboardEvent) => {
    if (closed) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      push("note", "這個視窗要用下面的「存檔／暫存／取消」離開 —— 底下正在改的是你的草稿。");
    }
  };
  document.addEventListener("keydown", swallowEsc, true);

  // ── 對話 ────────────────────────────────────────────────────

  async function send() {
    const msg = input.value.trim();
    if (!msg || chatBusy) return;
    input.value = "";
    chatBusy = true;
    push("me", msg);
    try {
      const reply = await opts.onChat(msg);
      if (!closed) push("ai", reply);
    } catch (e) {
      if (!closed) push("fail", e instanceof Error ? e.message : String(e));
    } finally {
      chatBusy = false;
    }
  }
  back.querySelector("#awc-send")?.addEventListener("click", () => void send());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void send();
    }
    // 輸入框裡的 Esc 也不該關視窗
    if (e.key === "Escape") e.stopPropagation();
  });

  return {
    line: (kind, text) => push(kind, text),
    delta(chunk) {
      if (closed || !chunk) return;
      if (!streamEl) streamEl = rowFor("stream");
      queue.push({ el: streamEl, text: chunk, i: 0 });
      ensurePump();
    },
    endStream() {
      streamEl = null;
    },
    finish() {
      running = false;
      streamEl = null;
      back.querySelector("#awc-live")?.setAttribute("hidden", "");
      renderFoot();
    },
    alive: () => !closed,
  };
}
