/**
 * Agent 分析結果的 pop-up 與關卡列顯示 —— 全部純函式，零 I/O。
 *
 * ## 為什麼這一份要獨立成檔
 *
 * 跟 `submit-assign.ts` 同一個理由：Wave 1 的 F0 是「新參數只有測試在傳，
 * 生產唯一呼叫端沒傳」，功能在 App 裡是零而測試全綠。這一批的同型風險更直接 ——
 * `saveAgentResult` / `discardAgentResult` 在 Wave 1 做完之後，`src/pages/` 裡
 * **零呼叫端**。也就是「人拍板才落地」這件事在 App 裡根本按不到。
 *
 * 把 HTML 與標籤抽成生產端與測試端共用的函式，測試才驗得到畫面上真的有那顆按鈕、
 * 而且它帶著 jobId。只呼叫 store 的測試驗不到這一層。
 *
 * ## 為什麼 `edit` 關卡一定要兩欄
 *
 * 母規格明講 diff UI 這一輪不做，`edit` 的落地是**整段替換**欄位。
 * 那就表示使用者按下「存進文件」的瞬間，他手寫的那一整段會消失。
 * 沒有前後對照的話，這顆按鈕是一個沒有預告的破壞性動作 —— 而且它長得跟
 * 「存到這一關」（review，不碰內文）一模一樣。兩欄 + 那句紅字是這個階段
 * 唯一講得清楚又不會騙人的做法。
 */
import type { AgentJob, CaseStage, Section, StageKind } from "../data/types";
// 退路（`editTarget` 省略 → 開放問題）由 `editTargetLabel` 內部走
// `resolveEditTarget`，這裡不再自己解析一次 —— 解析兩次就有兩份會分岔。
import { stageKind } from "../data/types";
import type { AnalysisVerdict } from "./signoff";
import { analysisVerdict } from "./signoff";
import { editTargetLabel } from "./submit-assign";
import { sinceLabel } from "./time-format";
import { escapeHtml } from "./ui";

/** pop-up 與關卡列都要講同一句話，所以標籤只有一份 */
export function verdictLabel(v: AnalysisVerdict): string {
  return v === "approve" ? "建議核准" : v === "fix" ? "建議修改" : "無明確結論";
}

/** 結論徽章。class 沿用簽核頁既有的 `sg-verdict--*`，不另立一套配色 */
export function verdictBadge(v: AnalysisVerdict): string {
  return `<span class="sg-verdict sg-verdict--${v ?? "none"}">${verdictLabel(v)}</span>`;
}

/**
 * 確認鈕的字。
 *
 * 兩種關卡的後果差很多，按鈕上就必須看得出來：`edit` 會覆寫 PRD 內文，
 * `review` 只把分析釘在關卡上。兩顆都叫「存檔」的話，使用者要靠記憶分辨
 * 哪一次會動到文件。
 */
export function resultConfirmLabel(kind: StageKind): string {
  return kind === "edit" ? "存進文件" : "存到這一關";
}

/** pop-up 標題。關卡名與 agent 名都是使用者打的字，呼叫端會再 escape 一次 */
export function resultDialogTitle(agentName: string, stageName: string): string {
  return `${agentName} 的分析 — 關卡「${stageName}」`;
}

/** 空現值不留白：一片空白讀起來像「載入失敗」，而不是「這欄本來就沒東西」 */
const EMPTY_CURRENT = "（目前是空的）";

/** 硬條件：`edit` 的落地是整段替換，這句話不得省略、不得軟化 */
export const OVERWRITE_WARNING = "存檔會把左邊整段換成右邊，不是合併。";

/**
 * pop-up 內容。**回傳的字串會原樣塞進 `askCustom` 的 `bodyHtml`**，
 * 所以這裡是 escape 的唯一責任點 —— 而 `job.result` 是模型產出的外部輸入，
 * 漏掉就是一個 XSS。
 */
export function agentResultDialogHtml(opts: {
  job: AgentJob;
  /** 沒有關卡的一般進場也走得到這裡（Agent 管理頁的工作單），一律當 review */
  stage: Pick<CaseStage, "kind" | "editTarget" | "name"> | undefined;
  sections: readonly Section[];
  /** `edit` 關卡左欄要顯示的現值。呼叫端從 `projectSectionValues` 讀 */
  currentValue: string;
  /** 時間從外面傳進來，這一支才留得住純函式的身分（headless 測得到） */
  now: number;
}): string {
  const { job, stage, sections, currentValue, now } = opts;
  const kind = stage ? stageKind(stage) : "review";
  const verdict = analysisVerdict(job.result);
  const head = `<p class="agr-head">${verdictBadge(verdict)}<span class="sub">${escapeHtml(
    job.agentName,
  )}${job.finishedAt ? ` · ${escapeHtml(sinceLabel(job.finishedAt, now))}` : ""}</span></p>`;

  if (kind === "edit") {
    const fieldName = editTargetLabel(stage?.editTarget, sections);
    const before = currentValue.trim() ? escapeHtml(currentValue) : EMPTY_CURRENT;
    // 左右兩欄的順序是硬的：左＝現在、右＝之後。跟那句紅字講的「左邊換成右邊」
    // 是同一個方向，反過來的話文案會指著錯的欄位。
    return `${head}
      <div class="agr-diff">
        <div class="agr-col">
          <p class="agr-col-head">現在的「${escapeHtml(fieldName)}」</p>
          <pre class="agr-col-body">${before}</pre>
        </div>
        <div class="agr-col">
          <p class="agr-col-head">存檔後的「${escapeHtml(fieldName)}」</p>
          <pre class="agr-col-body agr-col-body--new">${escapeHtml(job.result)}</pre>
        </div>
      </div>
      <p class="agr-warn">${OVERWRITE_WARNING}</p>`;
  }

  return `${head}
    <pre class="agr-full">${escapeHtml(job.result)}</pre>
    <p class="aiw-note">這是 Agent 的建議，不是簽章 —— 核准仍然要人按。</p>`;
}

/**
 * 關卡列上的分析顯示。
 *
 * 跟改版前最大的差別：**待拍板的不再在列上攤開全文。** 攤開的話，一份還沒有人
 * 同意的分析看起來就跟已經生效的內容一樣 —— 而它其實一個字都還沒進文件。
 * 全文改在 pop-up 裡看，列上只留「待拍板」與一顆「查看結果」。
 */
export function stageAnalysisRowHtml(opts: {
  job: AgentJob | null;
  stage: Pick<CaseStage, "kind" | "editTarget" | "agentResult">;
  sections: readonly Section[];
  landed: "pending" | "saved" | "discarded";
  now: number;
}): string {
  const { job, stage, sections, landed, now } = opts;
  if (!job) return "";
  const when = job.finishedAt ? escapeHtml(sinceLabel(job.finishedAt, now)) : "";
  const who = escapeHtml(job.agentName);

  if (job.status === "queued" || job.status === "running") {
    return `<p class="sg-analysis sg-analysis--busy">⏳ ${who} 分析中 —— 完成後結果會出現在這裡。</p>`;
  }
  if (job.status === "failed") {
    return `<p class="sg-analysis sg-analysis--failed">分析失敗：${escapeHtml(
      job.result || "沒有留下原因",
    )}　—— 可按「重新分析」再試。</p>`;
  }
  if (job.status === "cancelled") {
    return `<p class="sg-analysis sg-analysis--failed">這次分析已取消。</p>`;
  }

  if (landed === "pending") {
    // 「查看結果」帶的是 jobId 而不是 stageId：同一關重跑過好幾次，
    // 待拍板的是**某一張工作單**，不是那一關。
    return `<p class="sg-analysis sg-analysis--pending">
      <span class="sg-pill sg-pill--pending">待拍板</span>
      ${verdictBadge(analysisVerdict(job.result))}
      <span class="sub">${who}${when ? ` · ${when}` : ""}</span>
      <button type="button" class="btn btn-sm" data-sg-view="${escapeHtml(job.id)}">查看結果</button>
    </p>`;
  }

  if (landed === "saved") {
    if (stageKind(stage) === "edit") {
      // `edit` 存檔之後內容在 PRD 裡，不在關卡上 —— 這裡只講「寫去哪了」，
      // 再貼一份全文會讓人以為關卡上這一份才是生效的那一份。
      return `<p class="sg-analysis sg-analysis--saved">已寫入「${escapeHtml(
        editTargetLabel(stage.editTarget, sections),
      )}」　<span class="sub">${who}${when ? ` · ${when}` : ""}</span></p>`;
    }
    const body = stage.agentResult ?? job.result;
    return `<details class="sg-analysis sg-analysis--done">
      <summary>
        ${verdictBadge(analysisVerdict(body))}
        ${who}${when ? ` · ${when}` : ""}
        <span class="aiw-fold-meta">看全文</span>
      </summary>
      <pre class="sg-analysis-body">${escapeHtml(body)}</pre>
      <p class="aiw-note">這是 Agent 的建議，不是簽章 —— 核准仍然要人按。</p>
    </details>`;
  }

  // discarded。**全文留著**是 `discardAgentResult` 的設計意圖：使用者要看得到
  // 「我叫它跑過、而且我決定不用」。在 UI 把它藏掉的話，那個決定在畫面上
  // 就跟「從來沒跑過」一模一樣。
  return `<details class="sg-analysis sg-analysis--discarded">
    <summary>
      <span class="sg-discarded">這份分析未採用</span>
      <span class="sub">${who}${when ? ` · ${when}` : ""}</span>
      <span class="aiw-fold-meta">看全文</span>
    </summary>
    <pre class="sg-analysis-body">${escapeHtml(job.result)}</pre>
  </details>`;
}

/** 攔截對話框要列的一張工作單 */
export type PendingGateItem = {
  jobId: string;
  agentName: string;
  stageName: string;
  verdict: AnalysisVerdict;
};

/**
 * 從待拍板工作單算出攔截對話框要列的東西。
 *
 * 關卡名查不到就寫「（已移除的關卡）」—— 這跟 `signoffTimeline` 對消失的關卡
 * 用的是同一句話，不要在這裡自創第二種講法。
 */
export function pendingGateItems(
  jobs: readonly AgentJob[],
  stages: readonly Pick<CaseStage, "id" | "name">[],
): PendingGateItem[] {
  return jobs.map((j) => ({
    jobId: j.id,
    agentName: j.agentName,
    stageName: stages.find((s) => s.id === j.stageId)?.name ?? "（已移除的關卡）",
    verdict: analysisVerdict(j.result),
  }));
}

/**
 * S1 攔截對話框的內容。
 *
 * 為什麼不是一句 toast：toast 講完就消失，而使用者手上有 N 份分析要逐一處理 ——
 * 他需要知道是哪幾份、現在就點得進去。只 toast 一句的結果是他再按一次簽核鈕，
 * 再被擋一次，然後放棄。
 */
export function pendingGateHtml(items: readonly PendingGateItem[]): string {
  const rows = items
    .map(
      (it) => `<div class="agr-gate-row">
        ${verdictBadge(it.verdict)}
        <span class="agr-gate-name">${escapeHtml(it.agentName)}<span class="sub"> · 關卡「${escapeHtml(
          it.stageName,
        )}」</span></span>
        <button type="button" class="btn btn-sm" data-gate-view="${escapeHtml(it.jobId)}">查看</button>
      </div>`,
    )
    .join("");
  return `<p class="agr-gate-lead">結案會把案子鎖定，鎖定之後這幾份分析就再也存不進去了。先逐一決定要不要採用，再回來簽這一關。</p>
    <div class="agr-gate-list">${rows}</div>`;
}
