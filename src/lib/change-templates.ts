/**
 * 迭代文件起手式。
 *
 * 這裡只負責把使用者輸入轉成可落地的 Markdown 檔案，不做 I/O。
 * App 目前刻意不任意建立專案檔案，所以頁面會把這些檔案逐一下載，
 * 使用者再放進 `openspec/changes/<id>/` 或 `plans/`。
 */

export type ChangeKind = "feature" | "bug" | "maintenance";

export type ChangeFile = {
  path: string;
  content: string;
};

export type ChangeInput = {
  title: string;
  slug: string;
  date: string;
};

export const CHANGE_KIND_LABEL: Record<ChangeKind, string> = {
  feature: "新功能",
  bug: "Bug 修復",
  maintenance: "維護／重構",
};

export const CHANGE_KIND_BLURB: Record<ChangeKind, string> = {
  feature: "建立 OpenSpec change：proposal、spec、design 與 tasks。",
  bug: "建立可重現、可驗收、可留下回歸測試的 Bug plan。",
  maintenance: "建立不改變產品行為的維護或重構 plan。",
};

/** 只允許穩定、可放進路徑的 slug；不讓標題直接變成檔案路徑。 */
export function normalizeChangeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "change";
}

function safeTitle(raw: string): string {
  return raw.replace(/[\r\n]+/g, " ").trim() || "未命名變更";
}

function safeDate(raw: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw.trim()) ? raw.trim() : "undated";
}

function featureFiles(input: ChangeInput): ChangeFile[] {
  const title = safeTitle(input.title);
  const slug = normalizeChangeSlug(input.slug || title);
  return [
    {
      path: `openspec/changes/${slug}/proposal.md`,
      content: `# Proposal: ${title}\n\n## Why\n\n[描述現在的痛點、受影響的人，以及為什麼現在要做。]\n\n## What Changes\n\n- [列出這次要新增或修改的行為]\n\n## Non-goals（不做什麼）\n\n- [明確列出這次刻意不處理的範圍]\n\n## Impact\n\n- [列出受影響的頁面、資料、測試或文件]\n`,
    },
    {
      path: `openspec/changes/${slug}/specs/${slug}/spec.md`,
      content: `## ADDED Requirements\n\n### Requirement: ${title}\n系統 SHALL [描述可觀察的行為]。\n\n#### Scenario: 正常路徑\n- **WHEN** [使用者或系統觸發動作]\n- **THEN** [可驗證的結果]\n\n#### Scenario: 例外路徑\n- **WHEN** [錯誤或邊界條件發生]\n- **THEN** [系統應如何回應]\n`,
    },
    {
      path: `openspec/changes/${slug}/design.md`,
      content: `# Design: ${title}\n\n## Context\n\n[補充 proposal 沒有容納的技術背景。]\n\n## Decision\n\n[描述採用的方案，以及重要的取捨。]\n\n## Alternatives considered\n\n- [方案 A：為什麼不採用]\n- [方案 B：為什麼不採用]\n\n## Verification\n\n- [列出 typecheck、單元測試、整合測試或人工驗證方式]\n`,
    },
    {
      path: `openspec/changes/${slug}/tasks.md`,
      content: `# Tasks: ${title}\n\n## 1. 規格與資料\n\n- [ ] 1.1 [完成一個可單獨驗證的規格或資料步驟]\n\n## 2. 實作\n\n- [ ] 2.1 [完成一個可單獨驗證的實作步驟]\n\n## 3. 驗證\n\n- [ ] 3.1 [執行測試並記錄結果]\n- [ ] 3.2 [完成必要的人工流程驗證]\n`,
    },
  ];
}

function planFile(input: ChangeInput, kind: ChangeKind): ChangeFile {
  const title = safeTitle(input.title);
  const slug = normalizeChangeSlug(input.slug || title);
  const label = CHANGE_KIND_LABEL[kind];
  return {
    path: `plans/${safeDate(input.date)}-${kind}-${slug}.md`,
    content: `# ${label}：${title}\n\n## 狀態\n\n進行中\n\n## 背景\n\n[為什麼要處理這件事。]\n\n## 問題／目標\n\n[清楚描述要修正或改善的內容。]\n\n## 實作方式\n\n[完成調查後補上根因、方案與取捨。]\n\n## 驗收條件\n\n- [ ] [可驗證的結果一]\n- [ ] [可驗證的結果二]\n- [ ] 補上或確認回歸測試\n\n## 驗證紀錄\n\n- 指令：待補\n- 結果：待補\n`,
  };
}

export function buildChangeFiles(kind: ChangeKind, input: ChangeInput): ChangeFile[] {
  if (kind === "feature") return featureFiles(input);
  return [planFile(input, kind)];
}
