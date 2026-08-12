/**
 * 迭代文件起手式。
 *
 * 這裡只負責把使用者輸入轉成可落地的 Markdown 檔案，不做 I/O。
 * App 目前刻意不任意建立專案檔案，所以頁面會把這些檔案逐一下載，
 * 使用者再放進 `openspec/changes/<id>/` 或 `plans/`。
 *
 * ## 產出必須是「這個 App 自己讀得懂」的形狀
 *
 * plan 檔的合法形狀由 `plan-parser.ts` 定義，不是由這裡的美觀決定：
 * 單一 `## Plan Steps` 區段、`**狀態：**` 標籤、`<!-- anc:t=… -->` 錨點。
 * 少了任何一項，Task Tracking 會把檔案讀成 0 個步驟、狀態「未知」——
 * **而且不會報錯**。一個產生自家工具讀不懂的檔案的產生器，比沒有產生器更糟。
 * `tests/change-templates.test.ts` 用真的 parser 鎖住這件事，不用字串比對。
 */
import { WRITING_DISCIPLINE } from "./ai-tells";
import { mintMissingIds } from "./plan-parser";
import { fillTemplate } from "./template";

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
  return deriveChangeSlug(raw) ?? "change";
}

/**
 * 標題轉 slug，**推不出來就回 null**。
 *
 * 為什麼要跟 `normalizeChangeSlug` 分開：這個專案的標題幾乎都是中文，而
 * `[^a-z0-9]` 會把整個中文標題洗成空字串，於是每一份文件都拿到同一個
 * 保底值 `change` —— `openspec/changes/change/proposal.md` 會被第二個變更
 * 直接蓋掉，而使用者只會看到「怎麼上一份不見了」。
 *
 * 保底值本身沒有錯，錯在**把它當成推導成功**。呼叫端要區分這兩件事：
 * 推不出來時該擋下來請使用者自己填 change id，不是默默給一個會撞的名字。
 */
export function deriveChangeSlug(raw: string): string | null {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
  return slug || null;
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

/**
 * Bug 與維護走 `plans/`，不走 openspec change。
 *
 * 理由：這兩類多半沒有規格變更可寫，proposal + spec delta 對它們是空儀式；
 * 而 `plans/` 的步驟有錨點，接得上 Task Tracking 與治理覆蓋率。
 *
 * 步驟一律先鑄好錨點再交出去 —— 沒有錨點的 plan 檔，commit 訊息就沒有
 * `anc:t=` 可寫，那筆 commit 在治理覆蓋率上會被算成「未治理」。
 */
function planFile(input: ChangeInput, kind: ChangeKind, rand?: () => number): ChangeFile {
  const title = safeTitle(input.title);
  const slug = normalizeChangeSlug(input.slug || title);
  const label = CHANGE_KIND_LABEL[kind];
  const date = safeDate(input.date);
  const investigate =
    kind === "bug"
      ? [
          "## 現象",
          "",
          "[實際看到什麼。寫可觀察的事實，不要寫推測的原因。]",
          "",
          "## 重現步驟",
          "",
          "1. [第一步]",
          "2. [第二步]",
          "3. [看到的錯誤結果 vs 應該要有的結果]",
          "",
          "## 根因",
          "",
          "[重現之後才填。如果根因是「PRD 沒寫清楚」，這件事要升級成 PRD 迭代，不是修 bug。]",
        ]
      : [
          "## 背景",
          "",
          "[為什麼現在要處理這件事。]",
          "",
          "## 不改變什麼",
          "",
          "[維護與重構的驗收前提：對外行為不變。列出這次刻意不動的範圍。]",
        ];

  const body = [
    `# ${label}：${title}`,
    "",
    `**建立時間：** ${date}`,
    `**最後更新：** ${date}`,
    "**狀態：** 進行中",
    "",
    "## 目標",
    "",
    "[一句話講完這份 plan 要達成什麼，寫成可以判斷做完沒有的形式。]",
    "",
    ...investigate,
    "",
    "## Plan Steps",
    "",
    ...(kind === "bug"
      ? [
          "- [ ] Step 1 — 重現問題並記錄實際輸出",
          "- [ ] Step 2 — 定位根因（寫進上面的「根因」段）",
          "- [ ] Step 3 — 修正實作",
          "- [ ] Step 4 — 補上防迴歸測試",
          "- [ ] Step 5 — `bunx tsc --noEmit` 與 `bun test` 全綠",
        ]
      : [
          "- [ ] Step 1 — 盤點受影響範圍",
          "- [ ] Step 2 — 執行變更",
          "- [ ] Step 3 — 確認對外行為未變（測試或實際操作）",
          "- [ ] Step 4 — `bunx tsc --noEmit` 與 `bun test` 全綠",
        ]),
    "",
    "## 驗證紀錄",
    "",
    "- 指令：待補",
    "- 結果：待補",
    "",
  ].join("\n");

  return {
    path: `plans/${date}-${kind}-${slug}.md`,
    content: mintMissingIds(body, rand).text,
  };
}

export function buildChangeFiles(
  kind: ChangeKind,
  input: ChangeInput,
  rand?: () => number,
): ChangeFile[] {
  if (kind === "feature") return featureFiles(input);
  return [planFile(input, kind, rand)];
}

// ── AI 撰寫 ─────────────────────────────────────────────────────

/**
 * 讓模型把骨架填成初稿。
 *
 * **不讓模型決定 change id 或類型** —— 那是使用者的判斷，
 * 而且 id 一旦變了，已經寫在別處的引用就對不上。
 */
export type DraftInput = {
  kind: ChangeKind;
  title: string;
  slug: string;
  /** 這個專案的 PRD 內容（章節標題 → 內文），給模型當背景。可以是空的 */
  prdContext: string;
  files: readonly ChangeFile[];
};

/**
 * OpenSpec 初稿的共用模板。`{{kindRules}}` 由類型決定，`{{discipline}}` 是
 * 跟 PRD 撰寫同一套寫作紀律 —— AI 味的病灶在 change 文件裡一樣會發作。
 *
 * 抽成常數是為了讓 prompt-registry 能拿它當「可覆寫的預設值」；
 * `buildDraftSystem` 仍是純函式，測試不需要 store。
 */
export const DRAFT_SHARED_TEMPLATE = `你在替一個開發專案填寫變更文件。用繁體中文書寫。

規則：
- 你拿到的是骨架，方括號 \`[…]\` 是要被替換掉的提示，不是要保留的內容。
- 只寫你從輸入推得出來的事。推不出來的段落寫「待補」並說明缺什麼，
  不要編造需求、指標或技術細節。
- 不要宣稱效果（「提升效能」「修好了」）—— 這份文件是在動工之前寫的。
- 保持骨架原有的標題結構與層級，不要新增或刪除 \`##\` 段落。
{{kindRules}}

{{discipline}}

輸出格式：一個 JSON 物件，key 是檔名（例如 \`proposal.md\`、\`tasks.md\`），
value 是那一份檔案的完整內容字串。不要加任何說明文字或程式碼圍欄以外的東西。`;

/** 類型專屬的規則段。餵給 `{{kindRules}}` */
export function draftKindRules(kind: ChangeKind): string {
  if (kind === "feature") {
    return [
      "- `proposal.md` 的 Non-goals **一定要寫實質內容**：範圍沒有邊界的提案",
      "  會在實作途中一路長大。",
      "- `tasks.md` 每一步要能單獨驗證，而且**寫成單行**（追蹤工具只讀第一行）。",
      "  不要出現「實作 X」這種驗不了的步驟。",
    ].join("\n");
  }
  return [
    "- Plan Steps 每一步寫成單行、能單獨驗證。",
    "- 這一份走 `plans/`，不是 OpenSpec change，不要加 proposal／spec 的段落。",
  ].join("\n");
}

export function buildDraftSystem(kind: ChangeKind): string {
  return fillTemplate(DRAFT_SHARED_TEMPLATE, {
    kindRules: draftKindRules(kind),
    discipline: WRITING_DISCIPLINE,
  });
}

export function buildDraftUser(input: DraftInput): string {
  const parts = [
    `變更標題：${safeTitle(input.title)}`,
    `類型：${CHANGE_KIND_LABEL[input.kind]}`,
    `change id：${input.slug}`,
    "",
  ];
  if (input.prdContext.trim()) {
    parts.push("這個專案的 PRD 內容（背景，不要照抄）：", input.prdContext.trim().slice(0, 6000), "");
  } else {
    parts.push("（這個專案還沒有 PRD 內容可以參考，只能依標題判斷。）", "");
  }
  parts.push("要填寫的骨架：");
  for (const f of input.files) {
    const name = f.path.split("/").pop() ?? f.path;
    parts.push(`\n===== ${name} =====\n${f.content}`);
  }
  return parts.join("\n");
}

/**
 * 把模型輸出套回檔案。
 *
 * **少回一個檔就保留骨架**，不要整組失敗 —— 模型漏一份的時候，
 * 其餘三份的初稿仍然有用，而使用者看得出哪一份沒被填。
 * 比對只看檔名，因為模型不一定會照抄完整路徑。
 */
export function applyDraft(
  files: readonly ChangeFile[],
  draft: Record<string, unknown> | null,
): { files: ChangeFile[]; filled: number } {
  if (!draft) return { files: [...files], filled: 0 };
  let filled = 0;
  const out = files.map((f) => {
    const name = f.path.split("/").pop() ?? f.path;
    const hit =
      draft[f.path] ?? draft[name] ?? draft[name.replace(/\.md$/, "")] ?? undefined;
    if (typeof hit !== "string" || !hit.trim()) return f;
    filled++;
    return { ...f, content: hit.trim() + "\n" };
  });
  return { files: out, filled };
}
