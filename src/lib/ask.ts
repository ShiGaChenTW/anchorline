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

// escapeHtml 的單一擁有者是 ui.ts（早於本檔存在）。規格原本要求在這裡再寫一份，
// 那會讓 repo 裡的複本從四份變五份 —— 已改為直接沿用。
import { escapeHtml } from "./ui";

type AskKind = "confirm" | "text" | "alert";
type AskOutcome = "confirm" | "cancel";

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
): boolean | string | null | void {
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

function openDialog(
  kind: AskKind,
  opts: AskTextOptions,
): Promise<boolean | string | null | void> {
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

  // alert 只有一顆關閉鈕；confirm / text 才有取消＋確認。
  const footer =
    kind === "alert"
      ? `<button type="button" class="${confirmClass}" data-dlg="ok">${escapeHtml(labels.confirmLabel)}</button>`
      : `<button type="button" class="btn" data-dlg="cancel">${escapeHtml(labels.cancelLabel)}</button>` +
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
      document.removeEventListener("keydown", onKeyDown);
      back.remove();
      releaseDialogLock();
      resolve(mapOutcome(kind, outcome, input?.value));
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish("cancel");
        return;
      }
      // danger 時 Enter 不得觸發確認（預設焦點在取消，避免誤刪）。
      if (e.key === "Enter" && !danger) {
        e.preventDefault();
        finish("confirm");
        return;
      }
      if (e.key === "Tab") trapFocus(e, back);
    };

    document.addEventListener("keydown", onKeyDown);
    back.querySelector('[data-dlg="ok"]')?.addEventListener("click", () => finish("confirm"));
    back.querySelectorAll('[data-dlg="cancel"]').forEach((el) => {
      el.addEventListener("click", () => finish("cancel"));
    });

    const focusTarget = danger
      ? back.querySelector<HTMLElement>('footer [data-dlg="cancel"]') ??
        back.querySelector<HTMLElement>('[data-dlg="cancel"]')
      : back.querySelector<HTMLElement>('[data-dlg="ok"]');
    focusTarget?.focus();
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
