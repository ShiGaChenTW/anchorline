/**
 * Agent 跑完**不會**自己改文件。
 *
 * 以前 `invokeAgent` 完成時直接寫 state：`edit`/`coach` 把摘要追加進「開放問題」
 * 欄位，`review`/`approve` 自動貼一則留言。使用者沒機會看完整內容再決定 ——
 * 文件被改了，而且沒有任何地方問過他。
 *
 * 這支測的核心是那個「不做事」的行為，而不做事沒有任何畫面症狀：
 * 副作用如果偷偷回來，UI 一切正常，只有文件會多出使用者沒打的字。所以這裡
 * 對 `sectionValues` 與 `comments` 做**逐字**比對，不是比幾筆。
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

// 領域包目錄用 `import.meta.glob`（Vite 專屬），bun 跑不動 —— 換成通用領域。
mock.module("../src/data/domains", () => ({
  BUILTIN_PACKS: {},
  builtinSource: () => null,
  reloadUserPacks: () => {},
  domainPacks: () => ({}),
  isUserPack: () => false,
  listDomains: () => [],
  DEFAULT_DOMAIN: "generic",
}));

/**
 * 真的打模型會讓這支測試變成網路測試。固定回傳一段可辨識的字串 ——
 * 「有沒有落地」要靠內容認得出來，不能只看長度。
 */
const AGENT_OUTPUT = "建議修改\n\n這段文字是 Agent 產出的，沒有按存檔就不該出現在任何地方。";
mock.module("../src/lib/ai-coach", () => ({
  isAiConfigured: () => true,
  runAgentTask: async () => AGENT_OUTPUT,
}));

// store 在 import 時就會讀 localStorage —— 先塞一個最小的實作進去
const mem = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
};

const { store } = await import("../src/data/store");

/**
 * id 一律帶檔名前綴。
 *
 * `bun test` 把所有檔跑在同一個 process 裡，而 `store` 是模組層的單例 ——
 * 跨檔共用同一份 employees / projects。用 `u-admin` 這種通用 id 的話，另一個
 * 檔先建了同名帳號，這裡的前置就會抓到別人的東西。
 */
const PID = "arl-project";
const ADMIN = "arl-admin";
const AGENT_EDIT = "arl-agent-edit";
const AGENT_REVIEW = "arl-agent-review";

/**
 * store 是模組單例，同一個檔案的測試共用它。要驗「流程落地」就必須用**新專案**：
 * 落地過的專案照 D2 不再重解析，第二次套範本不會換掉關卡。
 */
function freshProject(id: string) {
  if (!store.get().projects.some((p) => p.id === id)) {
    store.addProject({
      id,
      title: `落地測試 ${id}`,
      status: "draft",
      pct: 0,
      owner: "測試管理員",
      domain: "generic",
    } as never);
  }
  store.setActiveProject(id);
  return id;
}

/**
 * 每個帳號**各自**檢查存不存在。
 *
 * 原本是「有 admin 就假設我的 fixture 都建好了」—— 那個推論在單例被跨檔共用的
 * 當下就不成立：別的檔先建了 admin，這裡的兩隻 agent 就永遠不會被建出來，
 * 而 `invokeAgent` 只會回一句「找不到 Agent」。症狀是十個測試同時紅，
 * 但單獨跑這個檔全綠。
 */
function ensureEmployee(e: Record<string, unknown>) {
  if (!store.get().employees.some((x) => x.id === e.id)) store.addEmployee(e as never);
}

function bootstrap() {
  ensureEmployee({
    id: ADMIN,
    name: "測試管理員",
    kind: "human",
    accessRole: "admin",
    active: true,
    isCurrent: true,
  });
  // 兩隻 agent：edit 與 review 走的是兩條不同的落地路徑
  ensureEmployee({
    id: AGENT_EDIT,
    name: "編輯 Agent",
    kind: "agent",
    accessRole: "editor",
    agentFamily: "claude",
    active: true,
    agentEnabled: true,
  });
  ensureEmployee({
    id: AGENT_REVIEW,
    name: "審閱 Agent",
    kind: "agent",
    accessRole: "approver",
    agentFamily: "codex",
    active: true,
    agentEnabled: true,
  });
  store.setCurrentUser(ADMIN);
  if (!store.get().projects.some((p) => p.id === PID)) {
    store.addProject({
      id: PID,
      title: "落地測試專案",
      status: "draft",
      pct: 0,
      owner: "測試管理員",
      domain: "generic",
    } as never);
  }
  store.setActiveProject(PID);
}

/** 等到工作單跑完。`invokeAgent` 的模型呼叫是 fire-and-forget 的 async IIFE */
async function waitForJob(jobId: string, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const j = store.get().agentJobs.find((x) => x.id === jobId);
    if (j && (j.status === "done" || j.status === "failed")) return j;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`工作單 ${jobId} 沒有在時限內跑完`);
}

/** 逐字快照。比對的是內容本身，不是筆數 —— 筆數一樣但內容被改過是最壞的情況 */
function snapshot() {
  const s = store.get();
  return {
    sectionValues: JSON.stringify(s.sectionValues),
    projectSectionValues: JSON.stringify(s.projectSectionValues),
    comments: JSON.stringify(s.comments),
  };
}

beforeEach(() => {
  bootstrap();
});

describe("invokeAgent 跑完不落地", () => {
  test("edit 工作單完成後，sectionValues 與 comments 逐字不變", async () => {
    const before = snapshot();
    const r = store.invokeAgent({ agentId: AGENT_EDIT, projectId: PID, task: "edit", note: "補完文件" });
    expect(r.ok).toBe(true);

    const job = await waitForJob(r.jobId!);
    expect(job.status).toBe("done");
    expect(job.result).toBe(AGENT_OUTPUT);

    const after = snapshot();
    expect(after.sectionValues).toBe(before.sectionValues);
    expect(after.projectSectionValues).toBe(before.projectSectionValues);
    expect(after.comments).toBe(before.comments);
    // 全文不該出現在文件的任何角落 —— 這一條抓的是「換個欄位偷偷寫進去」
    expect(after.sectionValues).not.toContain("Agent 產出");
    expect(after.projectSectionValues).not.toContain("Agent 產出");
    expect(after.comments).not.toContain("Agent 產出");
  });

  test("review 工作單完成後不會自動貼留言", async () => {
    const before = snapshot();
    const r = store.invokeAgent({ agentId: AGENT_REVIEW, projectId: PID, task: "review" });
    expect(r.ok).toBe(true);
    await waitForJob(r.jobId!);

    const after = snapshot();
    expect(after.comments).toBe(before.comments);
    expect(after.sectionValues).toBe(before.sectionValues);
  });

  test("coach 工作單完成後不會追加進「開放問題」", async () => {
    const openBefore = JSON.stringify(store.get().sectionValues.open ?? {});
    const r = store.invokeAgent({ agentId: AGENT_EDIT, projectId: PID, task: "coach" });
    expect(r.ok).toBe(true);
    await waitForJob(r.jobId!);
    expect(JSON.stringify(store.get().sectionValues.open ?? {})).toBe(openBefore);
  });

  test("跑完停在 landed: pending —— 而且那個狀態存在工作單上，重整不會遺失", async () => {
    const r = store.invokeAgent({ agentId: AGENT_REVIEW, projectId: PID, task: "review" });
    const job = await waitForJob(r.jobId!);
    expect(job.landed).toBe("pending");
    // 存在 state 而不是記憶體：序列化得出來才活得過重整
    const persisted = JSON.parse(JSON.stringify(store.get().agentJobs)).find(
      (j: { id: string }) => j.id === r.jobId,
    );
    expect(persisted.landed).toBe("pending");
  });
});

describe("saveAgentResult / discardAgentResult", () => {
  test("按了存檔，沒綁關卡的一般進場才貼出留言", async () => {
    const r = store.invokeAgent({ agentId: AGENT_REVIEW, projectId: PID, task: "review" });
    await waitForJob(r.jobId!);
    const before = store.get().comments.length;

    expect(store.saveAgentResult(r.jobId!)).toEqual({ ok: true });

    const comments = store.get().comments;
    expect(comments.length).toBe(before + 1);
    expect(comments[0]!.body).toContain("Agent 產出");
    expect(comments[0]!.projectId).toBe(PID);
    expect(store.get().agentJobs.find((j) => j.id === r.jobId)!.landed).toBe("saved");
  });

  test("存過的不能再存一次 —— 重複按會把同一份意見貼兩遍", async () => {
    const r = store.invokeAgent({ agentId: AGENT_REVIEW, projectId: PID, task: "review" });
    await waitForJob(r.jobId!);
    store.saveAgentResult(r.jobId!);
    const count = store.get().comments.length;

    const second = store.saveAgentResult(r.jobId!);
    expect(second.ok).toBe(false);
    expect(second.reason).toContain("已經存過");
    expect(store.get().comments.length).toBe(count);
  });

  test("不採用：全文留著，只標成 discarded —— 那個決定要看得見", async () => {
    const r = store.invokeAgent({ agentId: AGENT_EDIT, projectId: PID, task: "edit" });
    await waitForJob(r.jobId!);
    const before = snapshot();

    expect(store.discardAgentResult(r.jobId!)).toEqual({ ok: true });

    const job = store.get().agentJobs.find((j) => j.id === r.jobId)!;
    expect(job.landed).toBe("discarded");
    // 全文還在：刪掉的話「我叫它跑過但不採用」在紀錄上等於「從來沒跑過」
    expect(job.result).toBe(AGENT_OUTPUT);
    expect(snapshot().sectionValues).toBe(before.sectionValues);
    expect(snapshot().comments).toBe(before.comments);
  });

  test("已經存進文件的不能改成不採用", async () => {
    const r = store.invokeAgent({ agentId: AGENT_REVIEW, projectId: PID, task: "review" });
    await waitForJob(r.jobId!);
    store.saveAgentResult(r.jobId!);
    const d = store.discardAgentResult(r.jobId!);
    expect(d.ok).toBe(false);
    expect(d.reason).toContain("已經存進文件");
  });

  test("找不到工作單 / 還沒跑完，都要講得出原因", () => {
    expect(store.saveAgentResult("job-不存在").reason).toContain("找不到");
    expect(store.discardAgentResult("job-不存在").reason).toContain("找不到");
  });
});

describe("關卡落地：review 釘在關卡上、edit 寫進指定欄位", () => {
  test("edit 關卡存檔寫進 editTarget 指的欄位，不是隨便挑一個", async () => {
    // 走 enterprise 骨架：那是唯一帶 edit 關卡的一類
    const pid = freshProject("arl-edit-stage");
    store.applyFullTemplate(pid, store.get().sections, {}, { cat: "enterprise" });
    store.submitForReview(pid, "commit-1");

    const c = store.get().cases[pid]!;
    const editStage = c.stages.find((s) => s.kind === "edit");
    expect(editStage).toBeDefined();
    expect(editStage!.editTarget).toEqual({ sectionId: "open", fieldKey: "oq" });

    const r = store.invokeAgent({
      agentId: AGENT_EDIT,
      projectId: pid,
      task: "edit",
      stageId: editStage!.id,
    });
    await waitForJob(r.jobId!);

    // 存檔前：欄位不變
    expect(JSON.stringify(store.get().sectionValues.open ?? {})).not.toContain("Agent 產出");
    const commentsBefore = store.get().comments.length;

    expect(store.saveAgentResult(r.jobId!)).toEqual({ ok: true });
    expect(store.get().sectionValues.open!.oq).toBe(AGENT_OUTPUT);
    expect(store.get().projectSectionValues[pid]!.open!.oq).toBe(AGENT_OUTPUT);
    // edit 關卡落地不該順便貼留言 —— 那會讓同一件事在兩個地方各講一遍
    expect(store.get().comments.length).toBe(commentsBefore);
  });

  test("review 關卡存檔把意見釘在關卡上，不動 PRD 內文", async () => {
    const pid = freshProject("arl-review-stage");
    store.applyFullTemplate(pid, store.get().sections, {}, { cat: "lean" });
    store.submitForReview(pid, "commit-r1");
    const stage = store.get().cases[pid]!.stages.find((s) => s.name === "AI 結構審查")!;
    const beforeDocs = JSON.stringify(store.get().sectionValues);

    const r = store.invokeAgent({
      agentId: AGENT_REVIEW,
      projectId: pid,
      task: "review",
      stageId: stage.id,
    });
    await waitForJob(r.jobId!);
    expect(store.saveAgentResult(r.jobId!)).toEqual({ ok: true });

    const after = store.get().cases[pid]!.stages.find((s) => s.id === stage.id)!;
    // 釘在 `agentResult`，不是 `comment`。後者是**簽核意見**（`sign()` /
    // `requestChanges` / `skipStage` 都寫它）—— 共用一個欄位會互相覆寫，
    // 而簽核紀錄會把 agent 的分析全文當成簽核者留的話掛在人名下
    expect(after.agentResult).toBe(AGENT_OUTPUT);
    expect(after.comment).toBeUndefined();
    // 存下分析 ≠ 簽了它
    expect(after.state).not.toBe("approved");
    expect(JSON.stringify(store.get().sectionValues)).toBe(beforeDocs);
  });
});
