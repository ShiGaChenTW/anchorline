/**
 * 「未儲存的變更」摘要 —— 全 app 共用的一份實作。
 *
 * 色彩語彙跟檔案編輯器一致：橘底代表這一塊有未儲存的東西、藍字是新增、
 * 紅字加刪除線是刪掉的，整行被刪掉的另外標紅底左緣。
 *
 * 為什麼是「摘要」而不是像檔案編輯器那樣疊背板：背板要跟 textarea 的字體
 * 度量逐字對齊才不會錯位，只有在「一整片等寬字 textarea」上才划算。App 裡
 * 其他編輯區是長短不一的 input、雙欄 Markdown、設定表單，各自對齊的成本高
 * 又脆弱。摘要貼在欄位底下，顏色語彙一樣，不必去別的地方對照。
 *
 * 另一個刻意的取捨：**被刪掉的內容不畫回編輯層**。那些字不在 textarea 裡，
 * 畫進去會讓畫面字數多於實際內容，游標位置就跟畫面對不上 —— 你點某個位置，
 * 游標會跑到別的地方。刪除只出現在摘要裡。
 */
import { inlineDiff, markChangedLines, type LineMark } from "./file-history";
import { escapeHtml } from "./ui";

const BOX_CLASS = "field-diff";

/** 把一段 before → after 的差異畫成 HTML 列。沒有差異就回空字串。 */
export function diffRowsHtml(before: string, after: string): string {
  if (before === after) return "";
  const marks = markChangedLines(before, after);
  if (!marks.length) return "";

  // removed 沒有對應的「改之後」行，用 index 當插入點掛在那一行之前。
  // 同一個 index 可能有好幾行被刪，所以值是陣列。
  const removedAt = new Map<number, string[]>();
  const byIndex = new Map<number, LineMark>();
  for (const m of marks) {
    if (m.kind === "removed") {
      const list = removedAt.get(m.index) ?? [];
      list.push(m.before ?? "");
      removedAt.set(m.index, list);
    } else {
      byIndex.set(m.index, m);
    }
  }

  const rows: string[] = [];
  const pushRemoved = (at: number) => {
    for (const gone of removedAt.get(at) ?? []) {
      rows.push(
        `<span class="fv-line fv-changed fv-line-removed"><span class="fv-del">${
          escapeHtml(gone) || "&nbsp;"
        }</span></span>`,
      );
    }
  };

  const afterLines = after.split("\n");
  afterLines.forEach((ln, i) => {
    pushRemoved(i);
    const m = byIndex.get(i);
    if (!m) return; // 沒動的行不列 —— 摘要只講改了什麼
    rows.push(
      `<span class="fv-line fv-changed">${
        m.kind === "modified"
          ? inlineDiff(m.before ?? "", ln)
              .map((sg) => `<span class="fv-${sg.kind}">${escapeHtml(sg.text)}</span>`)
              .join("")
          : `<span class="fv-add">${escapeHtml(ln) || "&nbsp;"}</span>`
      }</span>`,
    );
  });
  pushRemoved(afterLines.length);

  return rows.join("\n");
}

/**
 * 在 `host` 裡渲染（或移除）差異摘要。
 * 同一個 host 重複呼叫是安全的 —— 舊的會先被清掉。
 */
export function renderDiffSummary(
  host: HTMLElement,
  before: string,
  after: string,
  opts: { after?: Element | null } = {},
): void {
  host.querySelectorAll(`:scope > .${BOX_CLASS}`).forEach((el) => el.remove());
  const rows = diffRowsHtml(before, after);
  if (!rows) return;

  const box = document.createElement("div");
  box.className = BOX_CLASS;
  box.innerHTML = `
    <p class="field-diff-head">未儲存的變更 ·
      <span class="fv-add">新增</span> / <span class="fv-del">刪除</span>
    </p>
    <div class="field-diff-body">${rows}</div>
  `;

  // 預設掛在欄位最後面；給了 opts.after 就插在那個節點之後。
  //
  // 這個參數的存在理由：雙欄 Markdown 編輯器單一欄位就超過 600px 高，
  // 摘要掛在它「底下」時，打字當下整塊在畫面外 —— 紅藍字做了等於沒做。
  // 呼叫端可以把它插在欄位標題之後，讓它落在編輯器上方。
  if (opts.after && opts.after.parentElement === host) {
    opts.after.insertAdjacentElement("afterend", box);
  } else {
    host.appendChild(box);
  }
}

/**
 * 綁定一個輸入元素：每次輸入就重畫它底下的差異摘要。
 *
 * @param el      要監看的 input / textarea
 * @param getSaved 取得「已儲存的值」—— 差異的基準。用函式而不是字串，
 *                 因為儲存之後基準會變，呼叫端不必記得重新綁定。
 * @param host    摘要掛在哪裡。預設是 el 最近的 .field/.form-group 容器。
 * @returns       解除綁定的函式
 */
export function attachDiffSummary(
  el: HTMLInputElement | HTMLTextAreaElement,
  getSaved: () => string,
  host?: HTMLElement,
): () => void {
  const mount =
    host ?? (el.closest(".field, .form-group, .mdv-field") as HTMLElement | null) ?? el.parentElement;
  if (!mount) return () => {};

  const paint = () => renderDiffSummary(mount, getSaved(), el.value);
  el.addEventListener("input", paint);
  paint();

  return () => {
    el.removeEventListener("input", paint);
    mount.querySelectorAll(`:scope > .${BOX_CLASS}`).forEach((n) => n.remove());
  };
}
