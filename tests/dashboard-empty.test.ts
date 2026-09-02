import { expect, test } from "bun:test";
import {
  noFolderHtml,
  noProjectHtml,
  notDesktopHtml,
} from "../src/lib/dashboard-empty";

const ghostChainHtml = '<ol class="gov-chain gc-ghost"><li>未建立</li></ol>';
const identHtml = '<section class="d-hero d-ident">身分編輯器</section>';
const policyHtml = '<div class="d-policy">版號政策</div>';
const uatRowHtml = '<a class="d-uat-row" id="d-uat-row">全部專案實測</a>';

function noFolder() {
  return noFolderHtml({
    projectName: "Anchorline",
    ghostChainHtml,
    uatRowHtml,
    identHtml,
    policyHtml,
    bindButtonId: "dash-bind",
  });
}

test("no-folder 不含任何呈現磁碟量測結果的元件", () => {
  const html = noFolder();
  expect(html).not.toContain("d-card");
  expect(html).not.toContain("d-grid");
  expect(html).not.toContain("d-figure");
  expect(html).not.toContain("量測");
});

test("no-folder 仍保留身分與版號政策的次要入口（D-5）", () => {
  const html = noFolder();
  expect(html).toContain('<details class="esl-links"><summary>編輯專案身分</summary>');
  expect(html).toContain(identHtml);
  expect(html).toContain('<details class="esl-links"><summary>版號政策</summary>');
  expect(html).toContain(policyHtml);
});

test("not-desktop 不含 UAT rollup 任何字樣（假全清防線）", () => {
  const html = notDesktopHtml({
    ghostChainHtml,
    path: "/projects/anchorline",
    identHtml,
    policyHtml,
  });
  expect(html).not.toContain(uatRowHtml);
  expect(html).not.toContain("d-uat");
});

test("no-project 保留跨專案實測列並提供回總覽入口", () => {
  const html = noProjectHtml({ uatRowHtml });
  expect(html).toContain(uatRowHtml);
  expect(html).toContain('href="overview.html"');
  expect(html).toContain("還沒有選擇專案");
});

test("no-folder 使用兩欄空狀態版面並保留綁定入口", () => {
  const html = noFolder();
  expect(html).toContain('<div class="empty-state-layout">');
  expect(html).toContain('<div class="esl-main">');
  expect(html).toContain('<div class="esl-side">');
  expect(html).toContain('id="dash-bind"');
  expect(html).toContain("指定專案資料夾");
  expect(html).toContain(ghostChainHtml);
});

test("not-desktop 使用灰階鏈、路徑與兩個收合入口", () => {
  const html = notDesktopHtml({
    ghostChainHtml,
    path: "/projects/anchorline",
    identHtml,
    policyHtml,
  });
  expect(html).toContain('<div class="empty-state-layout">');
  expect(html).toContain(ghostChainHtml);
  expect(html).toContain("/projects/anchorline");
  expect(html).toContain("編輯專案身分");
  expect(html).toContain("版號政策");
});

test("三種空狀態都不把內部層級代號帶進 UI", () => {
  const outputs = [
    noProjectHtml({ uatRowHtml }),
    noFolder(),
    notDesktopHtml({ ghostChainHtml, path: "/projects/anchorline", identHtml, policyHtml }),
  ];
  for (const html of outputs) expect(html).not.toMatch(/L[0-4]/);
});

test("no-folder 將已組好的 HTML 原樣放入對應欄位", () => {
  const html = noFolder();
  expect(html.indexOf(ghostChainHtml)).toBeGreaterThan(-1);
  expect(html.indexOf(uatRowHtml)).toBeGreaterThan(-1);
  expect(html.indexOf(identHtml)).toBeGreaterThan(-1);
  expect(html.indexOf(policyHtml)).toBeGreaterThan(-1);
});
