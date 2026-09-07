/**
 * 第 11 章「送出前自檢」——檢核工具，不是章節。
 *
 * ## 為什麼它不該是一個可編輯章節
 *
 * 自檢清單是**對整份 PRD 的判定**，它的內容全部來自別的章節。做成第 16 章，
 * 使用者就得手抄一份自己剛寫過的東西，然後那份抄本會在正文改動之後立刻過期——
 * 而且沒有人會發現，因為它看起來仍然是全部打勾的。
 *
 * 這裡的作法：能用規則判的接到 gate（`auto`），判不了的才留給人勾（`manual`）。
 * 兩者長在同一份清單上，因為送審前要看的是「這 16 項過了沒」，不是「機器管的
 * 那幾項過了沒」。
 *
 * ## auto 項目怎麼判定
 *
 * 每個 auto 項目記的是**失敗規則的 id**。gate 只在失敗時發 finding，所以
 * 「那個 id 不在 findings 裡」就是通過。這比記 pass 的 id 穩：pass 是選配的
 * （很多組刻意不發 pass），而失敗 finding 一定會發。
 *
 * 純函式，零 I/O、零 DOM。
 */
import type { GateReport } from "./gate-rules";

export type SelfCheckItem = {
  id: string;
  label: string;
  /**
   * 對應的 gate 規則 id。有值 = 自動判定（該 id 沒出現在 findings 就算過）；
   * 省略 = 人工勾。
   */
  gate?: string;
  /** 這一項在講哪一章，UI 可以直接跳過去 */
  section?: string;
};

export type SelfCheckGroup = {
  /** 範本的分組標題，原字保留 */
  title: string;
  items: SelfCheckItem[];
};

/**
 * 範本第 11 節原文，逐條落地。分組與順序不動——使用者寫完一節會回來勾
 * 對應那一組，重排會讓那個習慣失效。
 */
export const SELF_CHECK: SelfCheckGroup[] = [
  {
    title: "背景與目標（02–06）",
    items: [
      { id: "sc-why-first", label: "開頭講的是「為什麼」，不是規則細節", section: "problem" },
      { id: "sc-no-solution", label: "問題段落沒有預設解法", section: "problem" },
      {
        id: "sc-evidence",
        label: "佐證可追溯（審查紀錄／工單／具名引言）",
        gate: "problem-no-evidence",
        section: "problem",
      },
      {
        id: "sc-nongoals",
        label: "非目標至少三條，且與目標不矛盾",
        gate: "non-goals-min",
        section: "goals",
      },
      {
        id: "sc-metric-measurable",
        label: "每個指標都有目標值與可實作的量測方式",
        gate: "metrics-vague",
        section: "metrics",
      },
      {
        id: "sc-metric-leading",
        label: "至少一個領先指標",
        gate: "metrics-no-leading",
        section: "metrics",
      },
      {
        id: "sc-sources",
        label: "每筆需求來源都有釐清結論",
        gate: "sources-no-conclusion",
        section: "sources",
      },
    ],
  },
  {
    title: "架構與規格（10–11）",
    items: [
      {
        id: "sc-crud",
        label: "Function Map 已用 CRUD 檢查過，沒有漏掉的資料運算",
        gate: "arch-no-crud",
        section: "arch",
      },
      {
        id: "sc-vague",
        label: "沒有「適度」「盡量」「合理」這類模糊字眼，數值都寫死",
        gate: "spec-vague-wording",
        section: "spec",
      },
      {
        id: "sc-exception",
        label: "每個流程的例外都寫了（timeout、輸入錯誤、載入異常、資訊不足）",
        gate: "spec-no-exception",
        section: "spec",
      },
      {
        id: "sc-not-just-design",
        label: "沒有只寫「照設計稿做」就交差——觸發條件、輸入、輸出格式都補齊",
        section: "spec",
      },
    ],
  },
  {
    title: "設計與驗收（12–13）",
    items: [
      {
        id: "sc-design-parity",
        label: "PRD 與設計稿的規則已逐條比對；若不一致，已註明以哪份為準",
        gate: "proto-no-crosscheck",
        section: "proto",
      },
      {
        id: "sc-ac-coverage",
        label: "每個功能都有驗收標準，QA 能據以展開測試",
        gate: "accept-thin",
        section: "accept",
      },
      {
        id: "sc-ac-negative",
        label: "驗收標準正向與反向都涵蓋",
        gate: "accept-no-negative",
        section: "accept",
      },
    ],
  },
  {
    title: "排程、指標、開放問題（09、14、15）",
    items: [
      {
        id: "sc-milestones",
        label: "里程碑每段可單獨上線，且標了依賴或風險",
        gate: "scope-no-risk",
        section: "scope",
      },
      {
        id: "sc-gsm",
        label: "每個新功能都有對應的 Goal → Signal → Metric 與埋點事件",
        gate: "kpi-no-gsm",
        section: "kpi",
      },
      {
        id: "sc-open-deadline",
        label: "開放問題每題有負責人與期限",
        gate: "open-no-deadline",
        section: "open",
      },
      { id: "sc-open-count", label: "開放問題總數少於 8 題", gate: "open-too-many", section: "open" },
    ],
  },
  {
    title: "文件本身（01）",
    items: [
      {
        id: "sc-revisions",
        label: "每次變更都有日期與備註，且已通知開發",
        gate: "docinfo-no-revision",
        section: "docinfo",
      },
      {
        // 這一項沒有 gate 規則，因為它要掃**每一章**的每一格。為了它在 15 章
        // 各長一條規則，是拿 15 條規則換一個檢查——`leftoverExamples()` 一支
        // 純函式就夠了，判定結果一樣進得了這份清單。
        id: "sc-no-example",
        label: "所有「例｜」示範內容都已刪除或覆蓋",
      },
    ],
  },
];

/** 範本示範內容的標記。改這個字串等於改範本，兩邊要一起改。 */
export const EXAMPLE_MARKER = "例｜";

/** 還留著範本示範內容的章節 id。空陣列 = 乾淨。 */
export function leftoverExamples(values: Record<string, Record<string, string>>): string[] {
  return Object.entries(values ?? {})
    .filter(([, fields]) => Object.values(fields ?? {}).some((v) => String(v ?? "").includes(EXAMPLE_MARKER)))
    .map(([sectionId]) => sectionId);
}

export type ResolvedItem = SelfCheckItem & {
  /** 由 gate 或掃描判定 = true；要人自己勾 = false */
  auto: boolean;
  /**
   * 三態，不是兩態。
   *
   * gate 規則多半是 `skipWhenEmpty`：章節空白時它不發 finding，而「沒有 finding」
   * 在兩態世界裡會被讀成通過 —— 於是一份還沒寫的需求規格會顯示「沒有模糊字眼 ✔」。
   * 那正是這份清單唯一不能做的事。空白章節一律 `pending`，不打勾也不算錯。
   */
  state: "pass" | "fail" | "pending";
  /** `state === "pass"`。留著是因為呼叫端多半只問「過了沒」 */
  pass: boolean;
  /** 沒過時的說明：gate 的 detail，或「這一章還沒開始」 */
  detail: string;
};

export type SelfCheckReport = {
  groups: { title: string; items: ResolvedItem[] }[];
  /** 已通過的項目數（自動 + 人工勾的） */
  done: number;
  total: number;
  /** 還沒過的自動項目——這些改正文就能解決，不是勾一勾的事 */
  failing: ResolvedItem[];
};

/**
 * gate 報告 + 人工勾選 → 一份可以直接畫出來的自檢清單。
 *
 * `manual` 只影響沒有 `gate` 的項目。讓人手動勾掉一個機器判定失敗的項目，
 * 等於允許自檢清單說謊，而這份清單存在的唯一理由就是送審前不說謊。
 */
export function resolveSelfCheck(
  report: GateReport,
  manual: Record<string, boolean> = {},
  values: Record<string, Record<string, string>> = {},
): SelfCheckReport {
  const bad = new Map(report.findings.filter((f) => f.level !== "pass").map((f) => [f.id, f]));
  const failed = new Set(bad.keys());
  const detailOf = (id: string) => bad.get(id)?.detail ?? "";
  const leftovers = leftoverExamples(values);
  const blank = (sectionId?: string) =>
    Boolean(sectionId) && !Object.values(values[sectionId!] ?? {}).some((v) => String(v ?? "").trim());

  const mk = (it: SelfCheckItem, state: ResolvedItem["state"], detail: string): ResolvedItem => ({
    ...it,
    auto: true,
    state,
    pass: state === "pass",
    detail,
  });

  const groups = SELF_CHECK.map((g) => ({
    title: g.title,
    items: g.items.map((it): ResolvedItem => {
      if (it.id === "sc-no-example") {
        return mk(
          it,
          leftovers.length ? "fail" : "pass",
          leftovers.length ? `以下章節仍留有「${EXAMPLE_MARKER}」示範內容：${leftovers.join("、")}` : "",
        );
      }
      if (!it.gate) {
        const on = Boolean(manual[it.id]);
        return { ...it, auto: false, state: on ? "pass" : "pending", pass: on, detail: "" };
      }
      if (failed.has(it.gate)) {
        // `block` 級規則不 skipWhenEmpty，所以空白章節也會發 finding —— 但 gate
        // 自己已經用 `untouched` 說了那是「還沒開始」。兩張卡要講同一種話。
        return bad.get(it.gate)!.untouched
          ? mk(it, "pending", "這一章還沒開始")
          : mk(it, "fail", detailOf(it.gate));
      }
      // gate 安靜有兩種原因：真的過了，或這一章根本還沒開始。分開講。
      return blank(it.section) ? mk(it, "pending", "這一章還沒開始") : mk(it, "pass", "");
    }),
  }));

  const items = groups.flatMap((g) => g.items);
  return {
    groups,
    done: items.filter((i) => i.pass).length,
    total: items.length,
    failing: items.filter((i) => i.state === "fail"),
  };
}
