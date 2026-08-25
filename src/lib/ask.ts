/**
 * App 內確認／輸入／提示對話框。
 *
 * 為什麼不用 window.confirm / prompt / alert：
 * tauri-plugin-dialog 把 window.confirm 蓋成 async 函式，回傳 Promise、恆為
 * truthy，於是 `if (!confirm(...)) return` 全部失效。原生對話框也會卡住 WebView。
 *
 * 為什麼要拆純函式（escapeHtml / resolveLabels / mapOutcome / lock）：
 * bun test 沒有 DOM，且這個 repo 不為單一檔案引入 happy-dom。把「不碰 document」
 * 的邏輯獨立匯出，headless 測試才能覆蓋併發與回傳語意。
 *
 * DOM 結構抄 project-folder.ts 的 askForProjectFolder()。
 * id 前綴用 dlg-，不用 ask-（那個命名空間是 onboarding wizard 的）。
 * 不要用 .modal-ask——那是 wizard 外殼，不是通用確認框。
 */

export interface AskOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface AskTextOptions extends AskOptions {
  value?: string;
  placeholder?: string;
}

/**
 * 自訂內容的對話框。
 *
 * 為什麼不讓呼叫端自己刻一個 modal：dialog lock、focus trap、Escape、
 * 以及「對話框開著時頁面熱鍵不外流」這四件事正是 2026-08-16 那批修掉的東西
 * （`tauri-plugin-dialog` 把 `window.confirm` 蓋成 async 恆真函式造成的全 App
 * 守門失效）。手刻第二個 modal 等於把那四件事重新犯一遍，而且症狀一樣安靜。
 *
 * 所以這裡走的是 `openDialog` 的同一條路，只多一個 `"custom"` kind。
 */
export interface AskCustomOptions extends AskOptions {
  /** 對話框內容 HTML。呼叫端自己負責 escape */
  bodyHtml: string;
  /** 第三顆按鈕（例如「不採用」）。按下時 action = "extra" */
  extraLabel?: string;
  extraDanger?: boolean;
  /** 對話框掛上 DOM 之後呼叫一次，用來綁事件／設預設值 */
  onMount?: (root: HTMLElement) => void;
  /** 按下確認時從 DOM 讀出結果。只有 action === "confirm" 會呼叫 */
  read?: (root: HTMLElement) => unknown;
}

export interface AskCustomResult {
  action: "confirm" | "cancel" | "extra";
  value?: unknown;
}

// escapeHtml 的單一擁有者是 ui.ts（早於本檔存在）。規格原本要求在這裡再寫一份，
// 那會讓 repo 裡的複本從四份變五份 —— 已改為直接沿用。
import { escapeHtml } from "./ui";

type AskKind = "confirm" | "text" | "alert" | "custom";
type AskOutcome = "confirm" | "cancel" | "extra";

/** openDialog 內部收的聯集。custom 專屬欄位對其他 kind 一律是 undefined。 */
type AnyAskOptions = AskOptions & Partial<AskTextOptions> & Partial<AskCustomOptions>;

let dialogOpen = false;
let dialogSeq = 0;

export function resolveLabels(
  opts: AskOptions,
  kind: AskKind,
): { confirmLabel: string; cancelLabel: string } {
  return {
    confirmLabel: opts.confirmLabel ?? (kind === "alert" ? "確定" : "確認"),
    cancelLabel: opts.cancelLabel ?? "取消",
  };
}

/**
 * 把「使用者按了哪顆」對成三個 API 的回傳值。
 * askText 的空字串是合法確認，必須跟取消的 null 分開——這是整份 helper 存在的理由之一。
 */
export function mapOutcome(
  kind: AskKind,
  outcome: AskOutcome,
  raw?: string,
  customValue?: unknown,
): boolean | string | null | void | AskCustomResult {
  // custom 三態都要講得出來 —— 「取消」與「不採用」在 W2-B 是兩個不同的決定
  // （前者工作單留在 pending，後者寫進 discarded），塌成同一個 falsy 就分不開了。
  if (kind === "custom") {
    return outcome === "confirm"
      ? { action: "confirm", value: customValue }
      : { action: outcome };
  }
  if (kind === "confirm") return outcome === "confirm";
  if (kind === "text") return outcome === "confirm" ? (raw ?? "") : null;
}

export function acquireDialogLock(): boolean {
  if (dialogOpen) return false;
  dialogOpen = true;
  return true;
}

export function releaseDialogLock(): void {
  dialogOpen = false;
}

export function isDialogOpen(): boolean {
  return dialogOpen;
}

function rejectIfBusy(): void {
  // 併發檢查必須在任何 document 存取之前，否則 headless 測試無法測 reject。
  if (!acquireDialogLock()) {
    throw new Error("已有對話框開啟");
  }
}

export async function askConfirm(opts: AskOptions): Promise<boolean> {
  rejectIfBusy();
  try {
    return (await openDialog("confirm", opts)) as boolean;
  } catch (err) {
    releaseDialogLock();
    throw err;
  }
}

export async function askText(opts: AskTextOptions): Promise<string | null> {
  rejectIfBusy();
  try {
    return (await openDialog("text", opts)) as string | null;
  } catch (err) {
    releaseDialogLock();
    throw err;
  }
}

export async function showAlert(opts: AskOptions): Promise<void> {
  rejectIfBusy();
  try {
    await openDialog("alert", opts);
  } catch (err) {
    releaseDialogLock();
    throw err;
  }
}

export async function askCustom(opts: AskCustomOptions): Promise<AskCustomResult> {
  rejectIfBusy();
  try {
    return (await openDialog("custom", opts)) as AskCustomResult;
  } catch (err) {
    releaseDialogLock();
    throw err;
  }
}

function openDialog(
  kind: AskKind,
  opts: AnyAskOptions,
): Promise<boolean | string | null | void | AskCustomResult> {
  const labels = resolveLabels(opts, kind);
  const danger = !!opts.danger;
  const uid = ++dialogSeq;
  const backId = `dlg-${uid}`;
  const titleId = `dlg-title-${uid}`;
  const confirmClass = danger ? "btn btn-warn-confirm" : "btn btn-primary";

  // body 是選填的：沒給就不要吐一個空的 <p class="sub">，那會留下一段沒有內容的行高。
  const bodyBits: string[] = [];
  if (opts.body) bodyBits.push(`<p class="sub">${escapeHtml(opts.body)}</p>`);
  if (kind === "text") {
    bodyBits.push(
      `<input type="text" value="${escapeHtml(opts.value ?? "")}" placeholder="${escapeHtml(opts.placeholder ?? "")}">`,
    );
  }
  // custom 的內容不 escape —— 那是這個 kind 存在的理由。**呼叫端負責 escape**，
  // 而 W2-B 要塞的 agent 全文是外部輸入，那一端漏掉就是一個 XSS。
  if (kind === "custom") bodyBits.push(opts.bodyHtml ?? "");

  // 第三顆按鈕只有 custom 給得出來。沒給 extraLabel 就維持兩顆，不留空殼。
  const extraBtn =
    kind === "custom" && opts.extraLabel
      ? `<button type="button" class="${opts.extraDanger ? "btn btn-warn-confirm" : "btn"}" data-dlg="extra">${escapeHtml(opts.extraLabel)}</button>`
      : "";

  // alert 只有一顆關閉鈕；confirm / text / custom 才有取消＋確認。
  const footer =
    kind === "alert"
      ? `<button type="button" class="${confirmClass}" data-dlg="ok">${escapeHtml(labels.confirmLabel)}</button>`
      : `<button type="button" class="btn" data-dlg="cancel">${escapeHtml(labels.cancelLabel)}</button>` +
        extraBtn +
        `<button type="button" class="${confirmClass}" data-dlg="ok">${escapeHtml(labels.confirmLabel)}</button>`;

  const back = document.createElement("div");
  back.className = "modal-back open";
  back.id = backId;
  back.innerHTML = `
    <div class="modal" role="dialog" aria-labelledby="${titleId}" aria-modal="true">
      <header>
        <h3 id="${titleId}">${escapeHtml(opts.title)}</h3>
        <button type="button" class="btn btn-ghost btn-sm" data-dlg="cancel">關閉</button>
      </header>
      <div class="body">${bodyBits.join("")}</div>
      <footer>${footer}</footer>
    </div>
  `;
  document.body.appendChild(back);

  return new Promise((resolve) => {
    let closed = false;
    const input = back.querySelector<HTMLInputElement>('input[type="text"]');

    const finish = (outcome: AskOutcome) => {
      if (closed) return;
      closed = true;
      // read 必須跑在 back.remove() 之前：呼叫端可能從 document 而不是 root 出發
      // 找節點（例如 getElementById），拔掉之後那條路就找不到東西了。
      const customValue =
        kind === "custom" && outcome === "confirm" ? opts.read?.(back) : undefined;
      document.removeEventListener("keydown", onKeyDown);
      back.remove();
      releaseDialogLock();
      resolve(mapOutcome(kind, outcome, input?.value, customValue));
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        finish("cancel");
        return;
      }
      // danger 時 Enter 不得觸發確認（預設焦點在取消，避免誤刪）。
      // custom 一律不讓 Enter 確認：裡面有 <select>，Enter 是選單自己的按鍵，
      // 不該同時把整個對話框送出去。
      if (e.key === "Enter" && !danger && kind !== "custom") {
        e.preventDefault();
        e.stopImmediatePropagation();
        finish("confirm");
        return;
      }
      if (e.key === "Tab") {
        trapFocus(e, back);
        return;
      }
      // 其餘按鍵一律不外流：對話框是 modal，頁面熱鍵不該在它開著時作用。
      e.stopImmediatePropagation();
    };

    // 捕獲階段 + stopImmediatePropagation：原生 confirm()/prompt() 會阻塞事件迴圈、
    // 把鍵盤事件整個吞掉，頁面層級的監聽器根本收不到。頁內對話框沒有這個副作用，
    // 所以不擋的話，開著對話框時 Escape 會同時被 bindModalDismiss（ui.ts:49 的
    // document 層級監聽）收到而關掉背後的面板，頁面熱鍵（review.ts 的 r、
    // templates.ts 的 /）也會把焦點搶到對話框後面去。preventDefault() 擋不住
    // 同一個 target 上的兄弟監聽器，只有 stopImmediatePropagation 可以。
    document.addEventListener("keydown", onKeyDown, true);
    back.querySelector('[data-dlg="ok"]')?.addEventListener("click", () => finish("confirm"));
    back.querySelector('[data-dlg="extra"]')?.addEventListener("click", () => finish("extra"));
    back.querySelectorAll('[data-dlg="cancel"]').forEach((el) => {
      el.addEventListener("click", () => finish("cancel"));
    });

    // 文字輸入一律把焦點放進輸入框並選取既有內容 —— 對齊原生 prompt() 的行為。
    // 少了這一條，帶預設值的 askText 會把焦點停在「確認」上：使用者看不到游標，
    // 一個 Enter 就把預設值送出去。抽單理由那種地方，那等於沒問就執行。
    // custom 的焦點先給內容區第一個可操作元素 —— 那才是使用者要做的事
    // （逐關選人）。停在「確認」上的話，一份沒動過的預設指派看起來像已經填完了。
    const customFirst =
      kind === "custom"
        ? back.querySelector<HTMLElement>(
            '.body select:not([disabled]), .body textarea:not([disabled]), .body input:not([disabled])',
          )
        : null;
    const focusTarget = input
      ? input
      : customFirst
        ? customFirst
        : danger
          ? back.querySelector<HTMLElement>('footer [data-dlg="cancel"]') ??
            back.querySelector<HTMLElement>('[data-dlg="cancel"]')
          : back.querySelector<HTMLElement>('[data-dlg="ok"]');
    focusTarget?.focus();
    if (input) input.select();

    // onMount 最後跑，而且在預設焦點之後 —— 呼叫端要改焦點時它的決定要贏。
    if (kind === "custom") opts.onMount?.(back);
  });
}

function trapFocus(e: KeyboardEvent, root: HTMLElement) {
  const nodes = Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  );
  if (nodes.length === 0) return;
  const first = nodes[0]!;
  const last = nodes[nodes.length - 1]!;
  const active = document.activeElement;
  if (e.shiftKey) {
    if (active === first || !root.contains(active)) {
      e.preventDefault();
      last.focus();
    }
    return;
  }
  if (active === last) {
    e.preventDefault();
    first.focus();
  }
}
