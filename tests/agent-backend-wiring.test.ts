/**
 * W3 接線：**agent 進場走哪條通路，由它綁的後端決定，其餘行為一個都沒變。**
 *
 * 這支盯的是三件在畫面上看不出來的事。
 *
 * **1. 生產呼叫端真的有傳 backend。** 上一批的 F0 是「加了參數，只有測試在傳」——
 * 功能在 App 裡是零，測試卻全綠。所以這裡不驗 `runAgentTask` 收不收得下參數
 * （那是型別的事），而是攔住 `runAgentTask` 去看 **`store.invokeAgent` 到底傳了什麼**。
 *
 * **2. CLI 通路的兩種「不能跑」是不同的事。** 瀏覽器沒有 CLI 是**環境**，跑之前
 * 就知道答案，所以 `invokeAgent` 直接回 `ok:false`、連工作單都不開；CLI 沒裝是
 * **狀態**（BRIDGE.md §2 的 `unavailable`），要開工作單、標 failed、把安裝提示帶進訊息。
 * 兩者混在一起的代價是使用者拿到一句對不上處境的錯誤。
 *
 * **3. 落地契約沒有被接回去。** 換通路不等於換落地規則：CLI 跑完一樣停在
 * `landed: "pending"`，一樣不碰 `sectionValues` 與 `comments`。這條沒有畫面症狀 ——
 * 副作用如果偷偷回來，UI 一切正常，只有文件會多出使用者沒打的字。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

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
 * 原生橋：**整份透傳，只換兩個鉤子**。
 *
 * `mock.module` 在 bun 是全域的，最後註冊的那份對所有測試檔生效。給一個只有
 * `isNative` / `agentCliRun` 的部分物件，別的檔一呼叫 `native.writeExport`
 * 就會炸在 undefined —— 而那種失敗只在整批跑時出現、單檔跑全綠。
 * 所以這裡先把真的那份快照起來再展開，兩個鉤子的預設值也刻意等同真實環境
 * （bun 裡沒有 `window`，`isNative()` 本來就是 false）。
 */
import * as nativeModule from "../src/lib/native";
const REAL_NATIVE = { ...nativeModule };

type CliOk = { tool: string; text: string; truncated: boolean };
type CliResult = CliOk | { unavailable: true; message: string };

let nativeOn = false;
let cliImpl: (tool: string, prompt: string) => Promise<CliResult> = async () => ({
  unavailable: true,
  message: "測試沒有設定 cliImpl",
});
const cliCalls: { tool: string; prompt: string }[] = [];

mock.module("../src/lib/native", () => ({
  ...REAL_NATIVE,
  isNative: () => nativeOn,
  native: {
    ...REAL_NATIVE.native,
    agentCliRun: async (tool: string, prompt: string) => {
      cliCalls.push({ tool, prompt });
      return await cliImpl(tool, prompt);
    },
  },
}));

/**
 * `ai-coach` 的 mock **必須與 `agent-result-landing` / `pending-gate` /
 * `workflow-skeletons` 那三份逐字回同一個字串**，理由見 `pending-gate.test.ts`
 * 檔頭：登錄表是全域的，回不同的東西會讓誰先跑決定另一邊會不會紅。
 *
 * 這份是那三份的**超集**：行為完全相同，只是額外把 `invokeAgent` 傳進來的
 * `backend` 攔下來，並補一個 CLI 通路才會用到的 `agentTaskPrompt`。
 */
const AGENT_OUTPUT = "建議修改\n\n這段文字是 Agent 產出的，沒有按存檔就不該出現在任何地方。";
const captured: { backend?: unknown; promptInput?: unknown } = {};

mock.module("../src/lib/ai-coach", () => ({
  isAiConfigured: () => true,
  runAgentTask: async (opts: { backend?: unknown }) => {
    captured.backend = opts.backend;
    return AGENT_OUTPUT;
  },
  agentTaskPrompt: (opts: { agentName: string; task: string; contextSnippet: string }) => {
    captured.promptInput = opts;
    return { system: `SYSTEM<${opts.agentName}>`, user: `USER<${opts.task}>` };
  },
}));

// store 在 import 時就會讀 localStorage —— 先塞一個最小的實作進去
const mem = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage ??= {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
};

const { store } = await import("../src/data/store");
const { AiError, chatCompletion, chatCompletionStream, getAiReadiness, isAiConfigured } =
  await import("../src/lib/ai-client");
const { backendLabel } = await import("../src/lib/agent-backend");
import type { AgentBackend } from "../src/data/types";

// id 一律帶檔名前綴 —— `bun test` 把所有檔跑在同一個 process 裡，store 是單例
const PID = "abw3-project";
const PID_CODEX = "abw3-project-codex";
const ADMIN = "abw3-admin";
const A_DEFAULT = "abw3-agent-default";
const A_API = "abw3-agent-api";
const A_CLI = "abw3-agent-cli";
const A_CLI_REVIEW = "abw3-agent-cli-review";
const B_API = "abw3-backend-api";
const B_CLI = "abw3-backend-cli";

// 這支會動到全域 AI 設定（default 後端是它的投影）。跑完還原，
// 不然共用同一個 store 的其他測試檔會拿到被我改過的金鑰。
const ORIGINAL_SETTINGS = structuredClone(store.get().settings);
const ORIGINAL_FETCH = globalThis.fetch;

function ensureEmployee(e: Record<string, unknown>) {
  if (!store.get().employees.some((x) => x.id === e.id)) store.addEmployee(e as never);
}

function ensureProject(id: string, extra: Record<string, unknown> = {}) {
  if (!store.get().projects.some((p) => p.id === id)) {
    store.addProject({
      id,
      title: `後端接線測試 ${id}`,
      status: "draft",
      pct: 0,
      owner: "測試管理員",
      domain: "generic",
      ...extra,
    } as never);
  }
}

/** 等到工作單跑完。`invokeAgent` 的通路呼叫是 fire-and-forget 的 async IIFE */
async function waitForJob(jobId: string, tries = 80) {
  for (let i = 0; i < tries; i++) {
    const j = store.get().agentJobs.find((x) => x.id === jobId);
    if (j && (j.status === "done" || j.status === "failed")) return j;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`工作單 ${jobId} 沒有在時限內跑完`);
}

/** 逐字快照。比對內容本身而不是筆數 —— 筆數一樣但內容被改過是最壞的情況 */
function snapshot() {
  const s = store.get();
  return {
    sectionValues: JSON.stringify(s.sectionValues),
    projectSectionValues: JSON.stringify(s.projectSectionValues),
    comments: JSON.stringify(s.comments),
  };
}

function backendById(id: string): AgentBackend {
  const b = store.listBackends().find((x) => x.id === id);
  if (!b) throw new Error(`前置沒建起來：後端 ${id}`);
  return b;
}

beforeAll(() => {
  store.updateSettings({ apiKey: "sk-abw3-global", model: "gpt-5.1", provider: "openai" });

  ensureEmployee({
    id: ADMIN,
    name: "測試管理員",
    kind: "human",
    accessRole: "admin",
    active: true,
    isCurrent: true,
  });
  for (const [id, name, family] of [
    [A_DEFAULT, "沒綁後端的 Agent", "claude"],
    [A_API, "綁 API 後端的 Agent", "claude"],
    [A_CLI, "綁 CLI 後端的 Agent", "grok"],
  ] as const) {
    ensureEmployee({
      id,
      name,
      kind: "agent",
      accessRole: "editor",
      agentFamily: family,
      active: true,
      agentEnabled: true,
    });
  }
  // 審查用：族系刻意與 PID_CODEX 的作者族系相同，用來確認隔離閘門沒鬆動
  ensureEmployee({
    id: A_CLI_REVIEW,
    name: "綁 CLI 後端的審查 Agent",
    kind: "agent",
    accessRole: "approver",
    agentFamily: "codex",
    active: true,
    agentEnabled: true,
  });
  store.setCurrentUser(ADMIN);

  ensureProject(PID);
  ensureProject(PID_CODEX, { authorAgentFamily: "codex" });
  store.setActiveProject(PID);

  // 這一筆刻意**不填金鑰**：用來證明 readiness 問的是這個後端，不是全域那份
  if (!store.listBackends().some((b) => b.id === B_API)) {
    const r = store.addBackend({
      id: B_API,
      label: "沒有金鑰的 OpenAI",
      kind: "api",
      provider: "openai",
      model: "gpt-4o-mini",
      endpoint: "",
      apiKey: "",
    });
    expect(r.ok).toBe(true);
  }
  if (!store.listBackends().some((b) => b.id === B_CLI)) {
    const r = store.addBackend({ id: B_CLI, label: "本機 grok", kind: "cli", tool: "grok" });
    expect(r.ok).toBe(true);
  }
  expect(store.setAgentBackend(A_API, B_API).ok).toBe(true);
  expect(store.setAgentBackend(A_CLI, B_CLI).ok).toBe(true);
  expect(store.setAgentBackend(A_CLI_REVIEW, B_CLI).ok).toBe(true);
});

beforeEach(() => {
  nativeOn = false;
  cliCalls.length = 0;
  captured.backend = undefined;
  captured.promptInput = undefined;
  store.setCurrentUser(ADMIN);
  store.setActiveProject(PID);
});

afterAll(() => {
  nativeOn = false;
  globalThis.fetch = ORIGINAL_FETCH;
  store.updateSettings(ORIGINAL_SETTINGS);
});

// ── ai-client：後端參數 ────────────────────────────────────────────

describe("ai-client 的 optional backend 參數", () => {
  test("不給 backend＝沿用全域設定（既有六個呼叫端走的就是這條）", () => {
    // 全域此刻是「有金鑰的 openai」，所以 readiness 必須是 ok
    expect(getAiReadiness().ok).toBe(true);
    expect(isAiConfigured()).toBe(true);
  });

  test("給了 API 後端就換那一份 —— 全域有金鑰也不能讓沒金鑰的後端過關", () => {
    const b = backendById(B_API);
    expect(getAiReadiness().ok).toBe(true); // 全域仍然是好的
    const r = getAiReadiness(b);
    expect(r.ok).toBe(false);
    expect(isAiConfigured(b)).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toContain("API Key");
  });

  test("default 後端與不給 backend 的結果一致 —— 它是投影，不是另一份設定", () => {
    const d = backendById("default");
    expect(getAiReadiness(d)).toEqual(getAiReadiness());
  });

  /**
   * CLI 後端在 HTTP 層一律**明確拒絕**，不是靜默回退。
   *
   * 回退看起來最和善，實際上最貴：使用者綁本機 CLI 的理由通常就是 API 額度用完，
   * 而回退會安靜地把帳單記回去 —— 這種錯誤沒有畫面症狀，只會在月底出現。
   */
  test("CLI 後端在 ai-client 一律 not ok，理由講得出「CLI」與「桌面版」", () => {
    const r = getAiReadiness(backendById(B_CLI));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toContain("CLI");
    expect(r.reason).toContain("桌面版");
    expect(isAiConfigured(backendById(B_CLI))).toBe(false);
  });
});

/**
 * 「拒絕」要拒在**發出請求之前**。
 *
 * 只驗 throw 不夠：若它先打了一次 HTTP 再失敗，額度已經燒掉了，而錯誤訊息
 * 長得一模一樣。所以這一組把 `fetch` 換掉並數次數，期望值是 0。
 */
describe("CLI 後端不會走到 HTTP", () => {
  let fetchCalls = 0;

  beforeEach(() => {
    fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls++;
      throw new Error("測試不該打到網路");
    }) as unknown as typeof fetch;
  });

  test("chatCompletion 帶 CLI 後端：throw not_configured，且一次 fetch 都沒發", async () => {
    const cli = backendById(B_CLI);
    await expect(chatCompletion("sys", "user", { backend: cli })).rejects.toThrow(AiError);
    expect(fetchCalls).toBe(0);
  });

  test("jsonMode 加上 CLI 後端也是拒絕，不會靜默當成成功", async () => {
    const cli = backendById(B_CLI);
    let err: unknown = null;
    try {
      await chatCompletion("sys", "user", { backend: cli, jsonMode: true });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe("not_configured");
    expect(fetchCalls).toBe(0);
  });

  /**
   * 串流特別要擋：`agent_cli_run` 跑完一次回整包，沒有 delta。假裝串流
   * （等它跑完再一次 `onDelta` 全文）騙得過畫面卻騙不過使用者的判斷——
   * 串流存在的理由是「證明系統在動、方向不對可以提早喊停」，一次吐完兩者都沒有。
   */
  test("chatCompletionStream 帶 CLI 後端：throw，且 onDelta 一次都沒被呼叫", async () => {
    const cli = backendById(B_CLI);
    let deltas = 0;
    await expect(
      chatCompletionStream("sys", "user", () => void deltas++, undefined, { backend: cli }),
    ).rejects.toThrow(AiError);
    expect(deltas).toBe(0);
    expect(fetchCalls).toBe(0);
  });
});

// ── store.invokeAgent：API 通路 ──────────────────────────────────

/**
 * 這一組是 F0 的防線：**驗的是生產呼叫端到底傳了什麼**，不是參數收不收得下。
 * 「加了參數但沒人傳」在型別上完全合法，測試若只呼叫 `runAgentTask` 自己
 * 傳一次，就會在功能是零的情況下全綠。
 */
describe("invokeAgent 把解析到的後端傳給 runAgentTask", () => {
  test("沒設 backendId 的 agent 拿到 default —— 而且真的有傳，不是 undefined", async () => {
    const r = store.invokeAgent({ agentId: A_DEFAULT, projectId: PID, task: "edit" });
    expect(r.ok).toBe(true);
    const job = await waitForJob(r.jobId!);
    expect(job.status).toBe("done");

    expect(captured.backend).toBeDefined();
    const b = captured.backend as AgentBackend;
    expect(b.id).toBe("default");
    expect(b.kind).toBe("api");
    // 投影自全域設定，不是存下來的副本
    expect(b.kind === "api" && b.apiKey).toBe("sk-abw3-global");
  });

  test("綁了自訂 API 後端的 agent 拿到那一筆，不是全域那份", async () => {
    const r = store.invokeAgent({ agentId: A_API, projectId: PID, task: "edit" });
    expect(r.ok).toBe(true);
    await waitForJob(r.jobId!);

    const b = captured.backend as AgentBackend;
    expect(b.id).toBe(B_API);
    expect(b.kind === "api" && b.apiKey).toBe("");
  });

  test("API 通路的落地契約沒變：done + landed pending + 文件逐字不動", async () => {
    const before = snapshot();
    const r = store.invokeAgent({ agentId: A_DEFAULT, projectId: PID, task: "edit" });
    const job = await waitForJob(r.jobId!);

    expect(job.status).toBe("done");
    expect(job.result).toBe(AGENT_OUTPUT);
    expect(job.landed).toBe("pending");

    const after = snapshot();
    expect(after.sectionValues).toBe(before.sectionValues);
    expect(after.projectSectionValues).toBe(before.projectSectionValues);
    expect(after.comments).toBe(before.comments);
  });
});

// ── store.invokeAgent：CLI 通路 ──────────────────────────────────

describe("CLI 後端在瀏覽器：是環境問題，不是工作單", () => {
  test("回 ok:false 並講得出原因與下一步", () => {
    nativeOn = false;
    const r = store.invokeAgent({ agentId: A_CLI, projectId: PID, task: "edit" });
    expect(r.ok).toBe(false);
    expect(r.jobId).toBeUndefined();
    expect(r.reason).toContain("桌面版");
    expect(r.reason).toContain(backendLabel(backendById(B_CLI)));
  });

  /**
   * 跑之前就知道答案的事，不該留下一筆假的嘗試紀錄 —— 歷史裡多一張注定失敗的
   * 工作單，之後查「這個 agent 為什麼一直失敗」會查到環境以外的地方去。
   */
  test("連工作單都不開", () => {
    nativeOn = false;
    const before = store.get().agentJobs.length;
    store.invokeAgent({ agentId: A_CLI, projectId: PID, task: "edit" });
    expect(store.get().agentJobs.length).toBe(before);
  });

  test("完全不碰原生橋", () => {
    nativeOn = false;
    store.invokeAgent({ agentId: A_CLI, projectId: PID, task: "edit" });
    expect(cliCalls.length).toBe(0);
  });
});

describe("CLI 後端在桌面版", () => {
  test("成功：done、結果是 CLI 的輸出、landed 仍然是 pending、文件逐字不動", async () => {
    nativeOn = true;
    cliImpl = async (tool) => ({ tool, text: "  這是 grok CLI 吐出來的分析  ", truncated: false });

    const before = snapshot();
    const r = store.invokeAgent({ agentId: A_CLI, projectId: PID, task: "edit" });
    expect(r.ok).toBe(true);
    const job = await waitForJob(r.jobId!);

    expect(job.status).toBe("done");
    expect(job.result).toBe("這是 grok CLI 吐出來的分析");
    expect(job.landed).toBe("pending");

    const after = snapshot();
    expect(after.sectionValues).toBe(before.sectionValues);
    expect(after.projectSectionValues).toBe(before.projectSectionValues);
    expect(after.comments).toBe(before.comments);
  });

  test("走的是白名單裡的 tool，prompt 走參數且兩段提示都在裡面", async () => {
    nativeOn = true;
    cliImpl = async (tool) => ({ tool, text: "ok", truncated: false });

    const r = store.invokeAgent({ agentId: A_CLI, projectId: PID, task: "edit" });
    await waitForJob(r.jobId!);

    expect(cliCalls.length).toBe(1);
    expect(cliCalls[0]!.tool).toBe("grok");
    // 兩條通路共用 `agentTaskPrompt`：CLI 只有一條 stdin，所以 system 與 user
    // 併成一段送過去。少了任一段就是兩邊的 prompt 開始分岔。
    expect(cliCalls[0]!.prompt).toContain("SYSTEM<");
    expect(cliCalls[0]!.prompt).toContain("USER<edit>");
  });

  /**
   * **「工具沒裝」是狀態，不是例外**（BRIDGE.md §2）。`agentCliRun` 走 `callMaybe`，
   * 沒裝時回 `{ unavailable, message }` 而不是 throw。
   *
   * 這裡驗的是它沒有被當成例外炸掉：工作單要開、要標 failed、而且訊息要帶得出
   * **裝什麼**。被 catch 接住的話文案會退化成通用的「進場失敗：<訊息>」，
   * 使用者看得到失敗卻看不到下一步。
   */
  test("CLI 沒裝：failed（不是 throw），訊息帶工具名與安裝提示", async () => {
    nativeOn = true;
    cliImpl = async () => ({ unavailable: true, message: "找不到可執行檔 grok" });

    const r = store.invokeAgent({ agentId: A_CLI, projectId: PID, task: "edit" });
    expect(r.ok).toBe(true); // 工作單開得起來 —— 這不是環境問題
    const job = await waitForJob(r.jobId!);

    expect(job.status).toBe("failed");
    expect(job.result).toContain("grok");
    expect(job.result).toContain("安裝");
    expect(job.result).toContain("PATH");
    // 原生端給的真實原因要透出來，不能被換成通用文案
    expect(job.result).toContain("找不到可執行檔 grok");
    // 失敗的工作單不進待落地狀態 —— 沒有結果可以存
    expect(job.landed).toBeUndefined();
  });

  test("輸出被截斷時當場講，不讓下游把它當成模型變笨", async () => {
    nativeOn = true;
    cliImpl = async (tool) => ({ tool, text: "前半段", truncated: true });

    const r = store.invokeAgent({ agentId: A_CLI, projectId: PID, task: "edit" });
    const job = await waitForJob(r.jobId!);

    expect(job.status).toBe("done");
    expect(job.result).toContain("前半段");
    expect(job.result).toContain("截斷");
  });

  test("CLI 跑完但沒有輸出：failed，不要留一張沒東西可存的待落地工作單", async () => {
    nativeOn = true;
    cliImpl = async (tool) => ({ tool, text: "   \n  ", truncated: false });

    const r = store.invokeAgent({ agentId: A_CLI, projectId: PID, task: "edit" });
    const job = await waitForJob(r.jobId!);

    expect(job.status).toBe("failed");
    expect(job.landed).toBeUndefined();
  });

  /**
   * CLI 通路完全不經過 `runAgentTask` —— 若它還是被叫到了，代表分派寫錯，
   * 而症狀會是「綁了 CLI 卻還是在燒 API 額度」，畫面上一樣是 done。
   */
  test("不會順手也打一次 HTTP", async () => {
    nativeOn = true;
    cliImpl = async (tool) => ({ tool, text: "ok", truncated: false });

    const r = store.invokeAgent({ agentId: A_CLI, projectId: PID, task: "edit" });
    await waitForJob(r.jobId!);
    expect(captured.backend).toBeUndefined();
  });
});

/**
 * 族系隔離是安全規則，不是設定 —— **換通路不改變誰能審查誰。**
 *
 * 這條特別容易在重構時鬆掉：新的守門（瀏覽器沒有 CLI）如果插在族系檢查之前，
 * 同族 agent 在桌面版就會一路穿過去。所以這裡兩種環境各驗一次，而且比對的是
 * **理由本身**，不只是 `ok === false`。
 */
describe("族系隔離閘門沒有鬆動", () => {
  test("同族審查仍然被擋，理由是族系而不是通路（瀏覽器）", () => {
    nativeOn = false;
    const r = store.invokeAgent({ agentId: A_CLI_REVIEW, projectId: PID_CODEX, task: "review" });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("不可再擔任審查");
    expect(r.reason).not.toContain("桌面版");
  });

  test("同族審查在桌面版一樣被擋 —— CLI 通路不是繞過它的路", () => {
    nativeOn = true;
    cliImpl = async (tool) => ({ tool, text: "不該跑到這裡", truncated: false });
    const r = store.invokeAgent({ agentId: A_CLI_REVIEW, projectId: PID_CODEX, task: "review" });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("不可再擔任審查");
    expect(cliCalls.length).toBe(0);
  });
});
