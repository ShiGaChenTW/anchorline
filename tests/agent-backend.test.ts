/**
 * Agent 後端清單的純函式層。
 *
 * 這支刻意**不 import store** —— `agent-backend.ts` 如果哪天偷偷相依 store，
 * 這個檔會在 import 階段就炸（store 一載入就讀 localStorage）。所以「這一層是
 * 純的」不是註解裡的宣稱，是這支測試檔存在的理由。
 *
 * 最重要的一條是 migration：既有使用者的 localStorage 裡只有一份全域
 * `model/provider/apiKey/endpoint`，沒有 `backends`。那些人的 agent 身上也
 * 沒有 `backendId`。**這兩件事同時成立時 agent 必須照舊能跑**，否則升級當下
 * 所有既有 agent 全壞，而症狀是「按了沒反應」不是錯誤訊息。
 */
import { describe, expect, test } from "bun:test";
import {
  CLI_TOOLS,
  DEFAULT_BACKEND_ID,
  backendIdError,
  backendLabel,
  backendUsers,
  defaultBackendOf,
  findBackend,
  isCliTool,
  listBackends,
  migrateBackends,
  resolveBackend,
  withMigratedBackends,
} from "../src/lib/agent-backend";
import type { AgentBackend, BackendSettings } from "../src/lib/agent-backend";
import { AGENT_FAMILY_LABEL } from "../src/data/types";
import type { Employee } from "../src/data/types";

/** 升級前的設定長這樣：一份全域 API 設定，沒有 backends 這個欄位 */
const legacy = (): BackendSettings => ({
  model: "gemini-2.5-flash",
  provider: "auto",
  apiKey: "sk-legacy",
  endpoint: "https://generativelanguage.googleapis.com/v1beta",
  localModelName: "llama3.2",
  temperature: 0.7,
});

const agent = (id: string, backendId?: string): Employee =>
  ({
    id,
    name: id,
    title: "",
    avatar: "",
    email: "",
    accessRole: "editor",
    kind: "agent",
    agentFamily: "claude",
    password: "",
    ...(backendId === undefined ? {} : { backendId }),
  }) as Employee;

const cli = (id: string, tool: (typeof CLI_TOOLS)[number] = "grok"): AgentBackend => ({
  id,
  label: "",
  kind: "cli",
  tool,
});

describe("migration —— 舊設定升級後既有 agent 不能壞", () => {
  test("沒有 backends 的舊設定，清單第一筆就是 default，內容照抄全域設定", () => {
    const list = listBackends(legacy());
    expect(list.length).toBe(1);
    const first = list[0]!;
    expect(first.id).toBe(DEFAULT_BACKEND_ID);
    expect(first.kind).toBe("api");
    if (first.kind !== "api") throw new Error("unreachable");
    expect(first.model).toBe("gemini-2.5-flash");
    expect(first.apiKey).toBe("sk-legacy");
    expect(first.endpoint).toBe("https://generativelanguage.googleapis.com/v1beta");
    expect(first.provider).toBe("auto");
    expect(first.localModelName).toBe("llama3.2");
    expect(first.temperature).toBe(0.7);
  });

  test("default 的 label 是人看得懂的名字，不是 id", () => {
    const l = backendLabel(defaultBackendOf(legacy()));
    expect(l).not.toBe(DEFAULT_BACKEND_ID);
    expect(l).toContain("gemini-2.5-flash");
    expect(l.trim().length).toBeGreaterThan(0);
  });

  test("沒有 backendId 的既有 agent 解析到 default", () => {
    const b = resolveBackend("a1", [agent("a1")], legacy());
    expect(b.id).toBe(DEFAULT_BACKEND_ID);
  });

  test("backendId 指到一個不存在的 id —— 回退到 default，不是丟錯也不是 undefined", () => {
    const b = resolveBackend("a1", [agent("a1", "ghost")], legacy());
    expect(b.id).toBe(DEFAULT_BACKEND_ID);
  });

  test("agent 根本不存在時也回 default（呼叫端拿得到可用的後端，不必自己防 null）", () => {
    expect(resolveBackend("nobody", [], legacy()).id).toBe(DEFAULT_BACKEND_ID);
  });

  test("default 永遠從全域設定重新推導 —— 改了金鑰不會留下一份過期副本", () => {
    // 這條是「不把 default 存進 backends」的理由：存了就會有兩份真相，
    // 而使用者在設定頁改金鑰時只會改到其中一份，症狀是改完仍然 401。
    const s = { ...legacy(), apiKey: "sk-new" };
    const first = listBackends(s)[0]!;
    if (first.kind !== "api") throw new Error("unreachable");
    expect(first.apiKey).toBe("sk-new");
  });

  test("存檔裡混進一筆 id 為 default 的資料 —— 丟掉，改用推導出來的那筆", () => {
    const s: BackendSettings = {
      ...legacy(),
      backends: [
        { id: "default", label: "冒牌貨", kind: "api", provider: "openai", model: "gpt-x", endpoint: "", apiKey: "stale" },
      ],
    };
    const list = listBackends(s);
    expect(list.length).toBe(1);
    const first = list[0]!;
    if (first.kind !== "api") throw new Error("unreachable");
    expect(first.apiKey).toBe("sk-legacy");
  });

  test("withMigratedBackends 吃舊 settings 回新 settings，backends 一定是陣列", () => {
    const out = withMigratedBackends(legacy());
    expect(Array.isArray(out.backends)).toBe(true);
    expect(out.backends).toEqual([]);
    // 全域欄位原樣保留 —— migration 不是「搬家」，舊欄位仍然是 default 的來源
    expect(out.apiKey).toBe("sk-legacy");
    expect(out.model).toBe("gemini-2.5-flash");
  });
});

describe("migrateBackends —— 手改過的 localStorage 不能讓清單變成地雷", () => {
  test("不是陣列一律回空陣列", () => {
    expect(migrateBackends(undefined)).toEqual([]);
    expect(migrateBackends(null)).toEqual([]);
    expect(migrateBackends("[]")).toEqual([]);
    expect(migrateBackends({ id: "x" })).toEqual([]);
  });

  test("認不得的 kind、空 id、非法 cli tool 全部丟掉", () => {
    const out = migrateBackends([
      { id: "ok", label: "", kind: "cli", tool: "grok" },
      { id: "", label: "", kind: "cli", tool: "grok" },
      { id: "weird", label: "", kind: "smoke-signal" },
      { id: "badtool", label: "", kind: "cli", tool: "rm -rf" },
      "not an object",
      null,
    ]);
    expect(out.map((b) => b.id)).toEqual(["ok"]);
  });

  test("重複 id 只留第一筆 —— 兩筆同 id 會讓解析結果取決於陣列順序", () => {
    const out = migrateBackends([cli("dup", "claude"), cli("dup", "agy")]);
    expect(out.length).toBe(1);
    expect(out[0]!.kind === "cli" && out[0]!.tool).toBe("claude");
  });

  test("api 後端缺欄位時補成空字串，不留 undefined 流進 fetch", () => {
    const out = migrateBackends([{ id: "a", kind: "api" }]);
    expect(out.length).toBe(1);
    const b = out[0]!;
    if (b.kind !== "api") throw new Error("unreachable");
    expect(b.model).toBe("");
    expect(b.apiKey).toBe("");
    expect(b.endpoint).toBe("");
    expect(b.provider).toBe("auto");
  });

  test("不認得的 provider 收斂成 auto", () => {
    const out = migrateBackends([{ id: "a", kind: "api", provider: "skynet" }]);
    const b = out[0]!;
    expect(b.kind === "api" && b.provider).toBe("auto");
  });

  test("id 前後空白會被 trim —— 「 x 」與「x」是同一個後端", () => {
    const out = migrateBackends([cli(" x "), cli("x")]);
    expect(out.length).toBe(1);
    expect(out[0]!.id).toBe("x");
  });
});

describe("backendLabel", () => {
  test("使用者填了 label 就用他的", () => {
    expect(backendLabel({ ...cli("c"), label: "我的本機 grok" })).toBe("我的本機 grok");
  });

  test("沒填 label 時 CLI 後端顯示工具名，不是空字串", () => {
    const l = backendLabel(cli("c", "agy"));
    expect(l.trim().length).toBeGreaterThan(0);
    expect(l.toLowerCase()).toContain("agy");
  });

  test("沒填 label 時 API 後端顯示得出模型", () => {
    const l = backendLabel({
      id: "a",
      label: "   ",
      kind: "api",
      provider: "openai",
      model: "gpt-5",
      endpoint: "",
      apiKey: "",
    });
    expect(l).toContain("gpt-5");
  });
});

describe("id 唯一性檢查", () => {
  const existing = [cli("alpha"), cli("beta")];

  test("空白 id 擋下來", () => {
    expect(backendIdError("   ", existing)).toBeTruthy();
  });

  test("撞到既有 id 擋下來，而且訊息說得出撞到哪一個", () => {
    const err = backendIdError("alpha", existing);
    expect(err).toBeTruthy();
    expect(err).toContain("alpha");
  });

  test("default 是保留 id，新增時不可以用", () => {
    expect(backendIdError("default", existing)).toBeTruthy();
  });

  test("改自己時用自己的 id 不算衝突", () => {
    expect(backendIdError("alpha", existing, "alpha")).toBeNull();
  });

  test("沒撞到就放行", () => {
    expect(backendIdError("gamma", existing)).toBeNull();
  });
});

describe("backendUsers —— 刪除守門要說得出是誰在用", () => {
  const emps = [agent("a1", "alpha"), agent("a2", "alpha"), agent("a3", "beta"), agent("a4")];

  test("列出所有綁著這個後端的 agent", () => {
    expect(backendUsers("alpha", emps).map((e) => e.id)).toEqual(["a1", "a2"]);
  });

  test("沒人用就是空陣列", () => {
    expect(backendUsers("gamma", emps)).toEqual([]);
  });

  test("沒設 backendId 的 agent 不算 default 的使用者 —— default 本來就不可刪", () => {
    expect(backendUsers(DEFAULT_BACKEND_ID, emps)).toEqual([]);
  });
});

describe("findBackend", () => {
  test("找得到 default", () => {
    expect(findBackend(legacy(), DEFAULT_BACKEND_ID)?.id).toBe(DEFAULT_BACKEND_ID);
  });

  test("找不到回 null", () => {
    expect(findBackend(legacy(), "ghost")).toBeNull();
  });

  test("找得到使用者自訂的那筆", () => {
    const s: BackendSettings = { ...legacy(), backends: [cli("mine")] };
    expect(findBackend(s, "mine")?.kind).toBe("cli");
  });
});

/**
 * 白名單 2026-08-26 從六個收成四個。**多一個就是多一條原生執行路徑**，
 * 所以它不該因為某次重構被順手加回去 —— 這幾條把清單本身釘住。
 */
describe("CLI 白名單", () => {
  test("就是這四個，不多不少", () => {
    expect([...CLI_TOOLS]).toEqual(["claude", "grok", "pi", "agy"]);
  });

  test("被拿掉的 gemini／opencode 現在會被收斂掉", () => {
    // 這台機器沒裝 gemini，opencode 沒被選上。留在型別裡等於留一條沒人守的路。
    expect(isCliTool("gemini")).toBe(false);
    expect(isCliTool("opencode")).toBe(false);
    expect(migrateBackends([{ id: "x", kind: "cli", tool: "opencode" }])).toEqual([]);
  });

  /**
   * `codex` 與 `hermes` 是**實測**出局的，不是偏好：兩者在最嚴格的非互動旗標下
   * 仍讀得到任意檔案（canary 原值被吐回來，`docs/BRIDGE.md` §3.1）。
   *
   * 這條釘的是「不要因為型別看起來少了兩個就順手補回去」。要加回來的門檻是
   * 新的 canary 結果，不是一個看起來更嚴格的旗標名字。
   */
  test("codex 與 hermes 因為擋不住工具而出局，前端也認不得它們", () => {
    expect(isCliTool("codex")).toBe(false);
    expect(isCliTool("hermes")).toBe(false);
    // 舊存檔裡若留著這兩種後端，收斂時整筆丟掉 —— 綁著它的 agent 依既有回退
    // 規則落回 default，而不是拿到一個原生端一定會拒絕的 tool。
    expect(
      migrateBackends([
        { id: "old-codex", kind: "cli", tool: "codex" },
        { id: "old-hermes", kind: "cli", tool: "hermes" },
        { id: "still-ok", kind: "cli", tool: "claude" },
      ]).map((b) => b.id),
    ).toEqual(["still-ok"]);
  });

  /**
   * 三份清單必須逐字相同：前端 `CLI_TOOLS`、`native.ts` 的 `AGENT_CLI_TOOLS`
   * （Rust 鏡像）、以及 Rust 的 `exec::AGENT_TOOLS`（真正的守門）。
   *
   * 前端多列一個的症狀是使用者選得到、然後被原生端回「不認識的 agent CLI」——
   * failed loud，但要等到他按下去才 loud。這條在 tsc 之外再盯一次執行期的值。
   */
  test("與 native.ts 的原生白名單逐字相同", async () => {
    const { AGENT_CLI_TOOLS } = await import("../src/lib/native");
    expect([...CLI_TOOLS]).toEqual([...AGENT_CLI_TOOLS]);
  });

  test("每個工具都有顯示名，沒有一個會顯示成 undefined", () => {
    for (const t of CLI_TOOLS) {
      const l = backendLabel({ id: t, label: "", kind: "cli", tool: t });
      expect(l).toBeTruthy();
      expect(l).not.toContain("undefined");
    }
  });
});

/**
 * `AgentFamily` 補了 `pi` / `hermes`（2026-08-26）。`AGENT_FAMILY_LABEL` 是
 * `Record<AgentFamily, string>`，漏掉會被 tsc 擋 —— 但只要有人用 `as` 繞過去
 * 就擋不住了，所以這裡再用執行期釘一次。
 */
describe("AgentFamily 標籤完整性", () => {
  test("pi 與 hermes 有自己的族系標籤，不再被歸成「其他」", () => {
    expect(AGENT_FAMILY_LABEL.pi).toBe("Pi");
    expect(AGENT_FAMILY_LABEL.hermes).toBe("Hermes");
    // 歸成 other 的代價是兩個不相干的 agent 被族系隔離閘門誤判成同族而互相擋掉
    expect(AGENT_FAMILY_LABEL.pi).not.toBe(AGENT_FAMILY_LABEL.other);
    expect(AGENT_FAMILY_LABEL.hermes).not.toBe(AGENT_FAMILY_LABEL.pi);
  });
});
