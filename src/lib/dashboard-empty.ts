export type EmptyStateKind = "no-project" | "no-folder" | "not-desktop";

/** 未選專案：實測列仍在頁面內，但只是次要行。 */
export function noProjectHtml(opts: { uatRowHtml: string }): string {
  return `${opts.uatRowHtml}
    <div class="dash-empty"><p>還沒有選擇專案。</p><a class="btn btn-primary" href="overview.html">回總覽</a></div>`;
}

/** 未綁資料夾：只呈現灰階治理鏈與可展開的次要入口，不畫量測卡片。 */
export function noFolderHtml(opts: {
  projectName: string;
  ghostChainHtml: string;
  uatRowHtml: string;
  identHtml: string;
  policyHtml: string;
  bindButtonId: string;
}): string {
  return `<div class="empty-state-layout">
    <div class="esl-main">
      ${opts.ghostChainHtml}
      <p>「${opts.projectName}」還沒有對應磁碟上的資料夾，所以量不到 git、技術線與容量。</p>
      <button type="button" class="btn btn-primary" id="${opts.bindButtonId}">指定專案資料夾</button>
      <p class="dash-note">綁定只記錄對應關係，不會動到你已經寫好的章節內容。</p>
    </div>
    <div class="esl-side">
      ${opts.uatRowHtml}
      <details class="esl-links"><summary>編輯專案身分</summary>${opts.identHtml}</details>
      <details class="esl-links"><summary>版號政策</summary>${opts.policyHtml}</details>
    </div>
  </div>`;
}

/** 瀏覽器版：沒有量測通道，因此不放 UAT rollup 或假完成訊號。 */
export function notDesktopHtml(opts: {
  ghostChainHtml: string;
  path: string;
  identHtml: string;
  policyHtml: string;
}): string {
  return `<div class="empty-state-layout">
    <div class="esl-main">
      ${opts.ghostChainHtml}
      <p>這一頁需要桌面版 App。瀏覽器看不到磁碟，也跑不了 git。</p>
      <p class="dash-note mono">${opts.path}</p>
    </div>
    <div class="esl-side">
      <details class="esl-links"><summary>編輯專案身分</summary>${opts.identHtml}</details>
      <details class="esl-links"><summary>版號政策</summary>${opts.policyHtml}</details>
    </div>
  </div>`;
}
