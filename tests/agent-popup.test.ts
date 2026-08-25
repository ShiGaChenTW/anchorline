/**
 * W2-B：Agent 結果 pop-up 與關卡列顯示。
 *
 * ## 這一支最重要的是最後一個 describe
 *
 * Wave 1 做完「agent 跑完不再靜默改文件、要人拍板才落地」之後，
 * `saveAgentResult` / `discardAgentResult` 在 `src/pages/` 是**零呼叫端** ——
 * 那個功能在 App 裡按不到，而 1651 個測試全綠。這就是 Wave 1 F0 的形狀：
 * 「新東西只有測試在用，生產端沒接」。
 *
 * 從 store API 出發的測試驗不到那件事（它自己就是呼叫端）。所以最後一段直接讀
 * `signoff.ts` 的原始碼，驗那幾行到底存不存在 —— 招式跟
 * `submit-assign.test.ts` 的「editor.ts 真的把指派交給了 store」同一套。
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  agentResultDialogHtml,
  OVERWRITE_WARNING,
  pendingGateHtml,
  pendingGateItems,
  resultConfirmLabel,
  resultDialogTitle,
  stageAnalysisRowHtml,
  verdictLabel,
} from "../src/lib/agent-result";
import type { AgentJob, CaseStage, Section } from "../src/data/types";

const NOW = Date.parse("2026-08-26T12:00:00.000Z");

const SECTIONS: Section[] = [
  {
    id: "open",
    n: "9",
    title: "開放問題",
    desc: "",
    status: "empty",
    guide: "",
    tips: [],
    example: "",
    fields: [{ key: "oq", label: "開放問題", type: "textarea", value: "" }],
    checks: [],
    score: 0,
  },
  {
    id: "risk",
    n: "8",
    title: "風險",
    desc: "",
    status: "empty",
    guide: "",
    tips: [],
    example: "",
    fields: [{ key: "mitigation", label: "緩解措施", type: "textarea", value: "" }],
    checks: [],
    score: 0,
  },
];

function job(patch: Partial<AgentJob> = {}): AgentJob {
  return {
    id: "job-1",
    agentId: "a1",
    agentName: "審閱 Agent",
    projectId: "p1",
    projectTitle: "測試專案",
    stageId: "st-1",
    task: "review",
    status: "done",
    note: "",
    result: "建議修改\n\n第二段內容。",
    createdAt: "2026-08-26T11:00:00.000Z",
    finishedAt: "2026-08-26T11:30:00.000Z",
    landed: "pending",
    ...patch,
  };
}

function stage(patch: Partial<CaseStage> = {}): CaseStage {
  return {
    id: "st-1",
    order: 1,
    name: "結構完整度",
    state: "pending",
    assigneeId: "a1",
    assigneeName: "審閱 Agent",
    kind: "review",
    ...patch,
  } as CaseStage;
}

// ── 標籤 ────────────────────────────────────────────────────

describe("按鈕與結論的字", () => {
  /**
   * 兩種關卡的後果差很多，按鈕上就必須看得出來：`edit` 會覆寫 PRD 內文、
   * `review` 只把分析釘在關卡上。兩顆都叫「存檔」的話，使用者要靠記憶分辨
   * 哪一次會動到文件 —— 而記錯的代價是手寫的一整段被換掉。
   */
  test("edit 說「存進文件」，review 說「存到這一關」", () => {
    expect(resultConfirmLabel("edit")).toBe("存進文件");
    expect(resultConfirmLabel("review")).toBe("存到這一關");
  });

  test("結論三態都講得出人話 —— 沒結論時不猜一個", () => {
    expect(verdictLabel("approve")).toBe("建議核准");
    expect(verdictLabel("fix")).toBe("建議修改");
    expect(verdictLabel(null)).toBe("無明確結論");
  });

  test("標題講得出是誰、哪一關", () => {
    expect(resultDialogTitle("審閱 Agent", "結構完整度")).toBe(
      "審閱 Agent 的分析 — 關卡「結構完整度」",
    );
  });
});

// ── pop-up 內容 ──────────────────────────────────────────────

describe("edit 關卡的 pop-up：現值 vs 新值（母規格硬條件 1）", () => {
  const editStage = stage({
    kind: "edit",
    name: "文件補完",
    editTarget: { sectionId: "risk", fieldKey: "mitigation" },
  });

  /**
   * 母規格明講 diff UI 這一輪不做，`edit` 的落地是**整段替換**欄位。
   * 那就表示按下「存進文件」的瞬間，使用者手寫的那一整段會消失。
   * 兩欄對照與那句紅字是這個階段唯一講得清楚又不會騙人的做法。
   */
  test("兩欄都在，而且左欄是現值、右欄是新值", () => {
    const html = agentResultDialogHtml({
      job: job({ result: "新的緩解措施內容" }),
      stage: editStage,
      sections: SECTIONS,
      currentValue: "使用者手寫的舊內容",
      now: NOW,
    });
    expect(html).toContain("agr-diff");
    expect(html).toContain("使用者手寫的舊內容");
    expect(html).toContain("新的緩解措施內容");
    // 左右順序是硬的：那句紅字講的是「左邊換成右邊」，反過來會指著錯的欄位
    expect(html.indexOf("使用者手寫的舊內容")).toBeLessThan(html.indexOf("新的緩解措施內容"));
  });

  test("那句話逐字出現，而且指名欄位的中文名", () => {
    const html = agentResultDialogHtml({
      job: job(),
      stage: editStage,
      sections: SECTIONS,
      currentValue: "舊的",
      now: NOW,
    });
    expect(html).toContain("存檔會把左邊整段換成右邊，不是合併。");
    expect(OVERWRITE_WARNING).toBe("存檔會把左邊整段換成右邊，不是合併。");
    // 欄位名要查 sections，不是顯示 id —— 使用者要知道哪一段會被換掉
    expect(html).toContain("緩解措施");
    expect(html).not.toContain("mitigation");
  });

  test("現值是空的時候明說，不留白", () => {
    // 一片空白讀起來像「載入失敗」，而不是「這欄本來就沒東西」
    const html = agentResultDialogHtml({
      job: job(),
      stage: editStage,
      sections: SECTIONS,
      currentValue: "   ",
      now: NOW,
    });
    expect(html).toContain("（目前是空的）");
  });

  test("editTarget 缺值時退回「開放問題」—— 跟 saveAgentResult 講同一個欄位", () => {
    // 三份分岔的症狀最惡劣：警語說會覆寫 A、左欄顯示 A 的現值、而存檔寫進 B
    const html = agentResultDialogHtml({
      job: job(),
      stage: stage({ kind: "edit", editTarget: undefined }),
      sections: SECTIONS,
      currentValue: "",
      now: NOW,
    });
    expect(html).toContain("開放問題");
  });
});

describe("review 關卡的 pop-up", () => {
  test("只有全文，沒有前後對照，也沒有那句覆寫警語", () => {
    const html = agentResultDialogHtml({
      job: job({ result: "建議核准\n細節在這裡" }),
      stage: stage(),
      sections: SECTIONS,
      currentValue: "",
      now: NOW,
    });
    expect(html).toContain("細節在這裡");
    expect(html).not.toContain("agr-diff");
    expect(html).not.toContain(OVERWRITE_WARNING);
    // 保留「這是建議不是簽章」那句 —— 存下分析不等於簽了它
    expect(html).toContain("不是簽章");
  });

  test("沒綁關卡的工作單當 review，不會誤走覆寫那條路", () => {
    const html = agentResultDialogHtml({
      job: job({ stageId: undefined }),
      stage: undefined,
      sections: SECTIONS,
      currentValue: "",
      now: NOW,
    });
    expect(html).not.toContain(OVERWRITE_WARNING);
  });

  /**
   * `bodyHtml` 不經過 `askCustom` 的 escape（那是這個 kind 存在的理由），
   * 所以這裡是唯一的責任點 —— 而 `job.result` 是模型產出的外部輸入。
   */
  test("全文有 escape —— agent 產出是外部輸入", () => {
    const html = agentResultDialogHtml({
      job: job({ result: "<script>alert(1)</script>", agentName: "<b>壞名字</b>" }),
      stage: stage(),
      sections: SECTIONS,
      currentValue: "",
      now: NOW,
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<b>壞名字</b>");
  });

  test("edit 的兩欄也 escape，左右都要", () => {
    const html = agentResultDialogHtml({
      job: job({ result: "<img src=x onerror=1>" }),
      stage: stage({ kind: "edit" }),
      sections: SECTIONS,
      currentValue: "<script>舊的</script>",
      now: NOW,
    });
    expect(html).not.toContain("<script>舊的</script>");
    expect(html).not.toContain("<img src=x");
  });
});

// ── 關卡列 ──────────────────────────────────────────────────

describe("關卡列的顯示隨 landed 改變", () => {
  /**
   * 改版前待拍板的分析在列上就攤開全文了。那讓一份**還沒有人同意**的分析
   * 看起來跟已經生效的內容一樣 —— 而它其實一個字都還沒進文件。
   */
  test("pending：待拍板徽章 + 查看結果鈕，不攤全文", () => {
    const html = stageAnalysisRowHtml({
      job: job({ result: "建議修改\n很長的全文內容在這裡" }),
      stage: stage(),
      sections: SECTIONS,
      landed: "pending",
      now: NOW,
    });
    expect(html).toContain("待拍板");
    expect(html).toContain("查看結果");
    expect(html).not.toContain("很長的全文內容在這裡");
  });

  test("pending 的查看鈕帶的是 jobId，不是 stageId", () => {
    // 同一關重跑過好幾次，待拍板的是**某一張工作單**，不是那一關
    const html = stageAnalysisRowHtml({
      job: job({ id: "job-99" }),
      stage: stage({ id: "st-1" }),
      sections: SECTIONS,
      landed: "pending",
      now: NOW,
    });
    expect(html).toContain('data-sg-view="job-99"');
  });

  test("saved + review：顯示釘在關卡上的那一份", () => {
    const html = stageAnalysisRowHtml({
      job: job(),
      stage: stage({ agentResult: "已經存下來的分析內容" }),
      sections: SECTIONS,
      landed: "saved",
      now: NOW,
    });
    expect(html).toContain("已經存下來的分析內容");
    expect(html).not.toContain("待拍板");
  });

  test("saved + edit：講「寫去哪了」，不再貼一份全文", () => {
    // 再貼一份會讓人以為關卡上這一份才是生效的那一份 —— 生效的在 PRD 裡
    const html = stageAnalysisRowHtml({
      job: job({ result: "被寫進文件的內容" }),
      stage: stage({ kind: "edit", editTarget: { sectionId: "risk", fieldKey: "mitigation" } }),
      sections: SECTIONS,
      landed: "saved",
      now: NOW,
    });
    expect(html).toContain("已寫入「緩解措施」");
    expect(html).not.toContain("被寫進文件的內容");
  });

  /**
   * **全文留著**是 `discardAgentResult` 的設計意圖：使用者要看得到
   * 「我叫它跑過、而且我決定不用」。在 UI 藏掉的話，那個決定在畫面上
   * 就跟「從來沒跑過」一模一樣。
   */
  test("discarded：一行灰字 + 全文仍可展開", () => {
    const html = stageAnalysisRowHtml({
      job: job({ result: "沒被採用的分析全文" }),
      stage: stage(),
      sections: SECTIONS,
      landed: "discarded",
      now: NOW,
    });
    expect(html).toContain("這份分析未採用");
    expect(html).toContain("沒被採用的分析全文");
  });

  test("跑到一半／失敗／取消各有各的話，而且都不出現拍板鈕", () => {
    const busy = stageAnalysisRowHtml({
      job: job({ status: "running" }),
      stage: stage(),
      sections: SECTIONS,
      landed: "pending",
      now: NOW,
    });
    expect(busy).toContain("分析中");
    expect(busy).not.toContain("data-sg-view");

    const failed = stageAnalysisRowHtml({
      job: job({ status: "failed", result: "進場失敗：逾時" }),
      stage: stage(),
      sections: SECTIONS,
      landed: "pending",
      now: NOW,
    });
    expect(failed).toContain("分析失敗");
    expect(failed).not.toContain("data-sg-view");

    const cancelled = stageAnalysisRowHtml({
      job: job({ status: "cancelled" }),
      stage: stage(),
      sections: SECTIONS,
      landed: "pending",
      now: NOW,
    });
    expect(cancelled).toContain("已取消");
    expect(cancelled).not.toContain("data-sg-view");
  });

  test("沒有工作單就什麼都不顯示", () => {
    expect(
      stageAnalysisRowHtml({ job: null, stage: stage(), sections: SECTIONS, landed: "pending", now: NOW }),
    ).toBe("");
  });
});

// ── S1 攔截對話框 ────────────────────────────────────────────

describe("結案攔截對話框的內容", () => {
  test("每一張列出 agent 名、關卡名、結論，各一顆查看鈕", () => {
    const items = pendingGateItems(
      [job({ id: "j1", agentName: "甲", result: "建議核准\n…" }), job({ id: "j2", stageId: "st-2", agentName: "乙", result: "建議修改\n…" })],
      [
        { id: "st-1", name: "結構完整度" },
        { id: "st-2", name: "風險與相依" },
      ],
    );
    expect(items).toEqual([
      { jobId: "j1", agentName: "甲", stageName: "結構完整度", verdict: "approve" },
      { jobId: "j2", agentName: "乙", stageName: "風險與相依", verdict: "fix" },
    ]);

    const html = pendingGateHtml(items);
    expect(html).toContain('data-gate-view="j1"');
    expect(html).toContain('data-gate-view="j2"');
    expect(html).toContain("結構完整度");
    expect(html).toContain("建議核准");
  });

  test("關卡被刪掉時講「已移除的關卡」，不印一個空字串", () => {
    const items = pendingGateItems([job({ stageId: "st-沒了" })], []);
    expect(items[0]!.stageName).toBe("（已移除的關卡）");
  });

  test("agent 名有 escape", () => {
    const html = pendingGateHtml(pendingGateItems([job({ agentName: "<b>x</b>" })], []));
    expect(html).not.toContain("<b>x</b>");
  });
});

// ── 生產端真的接上了嗎（F0 的形狀）────────────────────────────

describe("signoff.ts 真的把拍板交給了 store", () => {
  const SIGNOFF_SRC = readFileSync(new URL("../src/pages/signoff.ts", import.meta.url), "utf8");

  /**
   * **這一條驗的是那幾行程式碼，不是 store 的行為。**
   *
   * Wave 1 之後這兩支在 `src/pages/` 零呼叫端 —— 功能在 App 裡按不到，
   * 而所有從 store 出發的測試照樣全綠。那正是 F0 躲過 1563 個測試的縫。
   */
  test("saveAgentResult 與 discardAgentResult 都有生產呼叫端", () => {
    expect(SIGNOFF_SRC).toContain("store.saveAgentResult(");
    expect(SIGNOFF_SRC).toContain("store.discardAgentResult(");
  });

  test("三顆按鈕都接得到 —— 不採用走的是 extra，不是取消", () => {
    // 取消與不採用塌成同一個分支的話，「稍後再決定」會把工作單標成 discarded
    expect(SIGNOFF_SRC).toContain("extraLabel");
    expect(SIGNOFF_SRC).toContain('res.action === "cancel"');
    expect(SIGNOFF_SRC).toContain('res.action === "confirm"');
  });

  /**
   * 閘門回傳的 `pendingJobs` 必須真的被 UI 接住。
   * 只 toast 一句的話，使用者唯一能做的是再按一次簽核鈕、再被擋一次，然後放棄。
   */
  test("結案閘門的 pendingJobs 有被接住，而且開的是對話框不是 toast", () => {
    expect(SIGNOFF_SRC).toContain("r.pendingJobs");
    expect(SIGNOFF_SRC).toContain("handlePendingGate(");
    const gate = SIGNOFF_SRC.slice(SIGNOFF_SRC.indexOf("async function handlePendingGate"));
    expect(gate).toContain("askCustom(");
    expect(gate).toContain("store.pendingAgentJobs(");
  });

  test("待拍板清單問的是 store，UI 不自己篩一份", () => {
    // 兩份條件分岔的症狀是「對話框說沒有待辦，按下去卻還是被擋」
    expect(SIGNOFF_SRC).toContain("store.pendingAgentJobs(");
    expect(SIGNOFF_SRC).not.toContain('j.landed === "pending"');
  });

  test("顯示與 pop-up 用共用函式，不是頁面自己刻一份 HTML", () => {
    // `stageAnalysisRowHtml` 的呼叫端 2026-08-26 隨關卡列一起搬進
    // `lib/signoff-stages.ts`（送審前流程預覽）。要求沒變也沒放鬆：
    // 「關卡列上的分析用的是共用函式」—— 只是那一行現在住在別的檔案，
    // 而頁面必須真的呼叫得到它（下一條斷言）
    const STAGES_SRC = readFileSync(
      new URL("../src/lib/signoff-stages.ts", import.meta.url),
      "utf8",
    );
    expect(STAGES_SRC).toContain("stageAnalysisRowHtml(");
    expect(SIGNOFF_SRC).toContain("stageListHtmlOf({");
    expect(SIGNOFF_SRC).toContain("agentResultDialogHtml(");
    expect(SIGNOFF_SRC).toContain("pendingGateHtml(");
  });

  /**
   * 自動跳窗的兩個硬條件。
   * `isDialogOpen()` 少了會 throw「已有對話框開啟」，而它跑在 `render()` 裡，
   * 沒有人接得住；去重的集合少了，`render()` 每跑一次就把窗推回使用者臉上。
   */
  test("自動跳窗有 isDialogOpen 守門，而且同一張只自動開一次", () => {
    expect(SIGNOFF_SRC).toContain("isDialogOpen()");
    expect(SIGNOFF_SRC).toContain("autoShown");
    const auto = SIGNOFF_SRC.slice(SIGNOFF_SRC.indexOf("function maybeAutoShow"));
    const body = auto.slice(0, auto.indexOf("\n  }"));
    expect(body).toContain("isDialogOpen()");
    expect(body).toContain("autoShown.add(");
  });

  /**
   * `approveAndLock` 的另一個呼叫端（PRD 審閱頁）也會收到 S1 的拒絕。
   * 那裡對「失敗 + 我是 admin」的既有反應是問要不要代簽 —— 但代簽一樣過不去，
   * 使用者會白寫一段理由再被同一個閘門擋一次。
   */
  test("review.ts 不把 S1 的拒絕當成「沒有你可以簽的關卡」", () => {
    const REVIEW_SRC = readFileSync(new URL("../src/pages/review.ts", import.meta.url), "utf8");
    expect(REVIEW_SRC).toContain("!r.pendingJobs");
  });

  test("關卡列的查看鈕真的綁了 handler", () => {
    expect(SIGNOFF_SRC).toContain("[data-sg-view]");
    expect(SIGNOFF_SRC).toContain("showAgentResult(");
  });
});
