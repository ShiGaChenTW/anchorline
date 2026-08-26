/**
 * Agent 後端清單 —— 解析、收斂、驗證。
 *
 * 純函式：不認得 store、不碰 DOM，所以整層可以直接在 `bun test` 裡跑。
 * `tests/agent-backend.test.ts` 刻意不 import store，那個檔如果哪天因為這裡
 * 偷偷相依 store 而在 import 階段就炸，代表這條界線破了。
 *
 * ## 兩個決定，其餘都是它們的推論
 *
 * **1. `default` 是全域設定的投影，不是清單裡存下來的一筆。**
 * 升級前全 App 只有一份 `model / provider / apiKey / endpoint`。那份設定
 * 沒有消失 —— 它現在的身分是「預設後端」。如果 migration 把它**複製**成
 * `backends[0]` 存起來，就會有兩份真相：使用者在設定頁改金鑰改到的是全域那份，
 * agent 讀的是副本那份，於是「我明明換了金鑰」卻仍然 401。這種分歧沒有任何
 * 畫面症狀，只有請求會失敗。所以 default 每次都重新推導，永不落地。
 *
 * **2. 解析永遠給得出一個後端。**
 * `resolveBackend` 不回 `null`。agent 沒設 `backendId`（升級當下全部都是）、
 * 或指到一個已經被刪掉的 id，都回退到 default。這條回退是既有使用者升級後
 * agent 還能跑的唯一理由 —— 漏掉這條，症狀是所有 agent 一起壞掉。
 */
import type { AISettings, AgentBackend, AgentCliTool, AIProvider, ApiBackend, Employee } from "../data/types";

export type { AgentBackend, AgentCliTool, ApiBackend } from "../data/types";

/** 預設後端的保留 id。使用者不可以拿去用，也不可以刪掉它 */
export const DEFAULT_BACKEND_ID = "default";

/**
 * CLI 白名單。**加一個就是多一條原生執行路徑**，不是零成本的清單維護。
 * W2 的 Rust 端有另一份；兩邊必須一致，前端擋不住的東西後端要擋得住。
 */
export const CLI_TOOLS = ["claude", "codex", "grok", "pi", "hermes", "agy"] as const;

const PROVIDERS: readonly AIProvider[] = [
  "auto",
  "gemini",
  "openai",
  "anthropic",
  "openrouter",
  "ollama",
  "custom",
];

const PROVIDER_LABEL: Record<AIProvider, string> = {
  auto: "自動",
  gemini: "Gemini",
  openai: "OpenAI",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
  ollama: "Ollama",
  custom: "自訂端點",
};

const CLI_LABEL: Record<AgentCliTool, string> = {
  claude: "Claude CLI",
  codex: "Codex CLI",
  grok: "Grok CLI",
  pi: "Pi CLI",
  hermes: "Hermes CLI",
  agy: "Agy CLI",
};

/** id 太長會塞爆設定頁的下拉，也沒有任何正當用途 */
const MAX_ID_LEN = 64;

/**
 * 推導 default 需要的欄位。
 *
 * 全部可選是刻意的 —— 這支要吃得下**任何一代**的 localStorage，包含
 * `localModelName` / `temperature` 都還不存在的那一代。`AISettings` 可直接指派進來。
 */
export type BackendSettings = {
  model?: string;
  provider?: AIProvider;
  apiKey?: string;
  endpoint?: string;
  localModelName?: string;
  temperature?: number;
  backends?: AgentBackend[];
};

/**
 * 修改一筆後端時可以動的欄位。
 *
 * 兩種 kind 的欄位攤在同一個型別裡是刻意的 —— 表單就是這個形狀。
 * `store.updateBackend` 會依目標的 `kind` **拒絕**不屬於它的欄位，
 * 而不是默默忽略：默默忽略的話 UI 接錯欄位不會有任何症狀。
 * `id` 與 `kind` 不在這裡，兩者都不可改（要換就是刪掉重建）。
 */
export type BackendPatch = {
  label?: string;
  provider?: AIProvider;
  model?: string;
  endpoint?: string;
  apiKey?: string;
  localModelName?: string;
  temperature?: number;
  tool?: AgentCliTool;
  pathOverride?: string;
};

export function isCliTool(v: unknown): v is AgentCliTool {
  return typeof v === "string" && (CLI_TOOLS as readonly string[]).includes(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function provider(v: unknown): AIProvider {
  return typeof v === "string" && (PROVIDERS as readonly string[]).includes(v)
    ? (v as AIProvider)
    : "auto";
}

/**
 * 預設後端 —— 全域 AI 設定的投影。
 *
 * 每次呼叫都重新算。這支沒有副作用也不快取，是上面決定 1 的實作。
 */
export function defaultBackendOf(s: BackendSettings): ApiBackend {
  const b: ApiBackend = {
    id: DEFAULT_BACKEND_ID,
    label: defaultLabel(provider(s.provider), str(s.model).trim()),
    kind: "api",
    provider: provider(s.provider),
    model: str(s.model),
    endpoint: str(s.endpoint),
    apiKey: str(s.apiKey),
  };
  if (typeof s.localModelName === "string") b.localModelName = s.localModelName;
  if (typeof s.temperature === "number" && Number.isFinite(s.temperature)) {
    b.temperature = s.temperature;
  }
  return b;
}

function defaultLabel(p: AIProvider, model: string): string {
  if (!model) return "預設（尚未設定模型）";
  return p === "auto" ? `預設（${model}）` : `預設（${PROVIDER_LABEL[p]}／${model}）`;
}

/**
 * 把存檔裡的 `backends` 收斂成一份可信的清單。
 *
 * 這裡吃的是 `unknown`，因為它的來源是 localStorage 與匯入的備份 —— 兩者都
 * 可以被手改。認不得的形狀一律**丟掉**而不是修補：一筆 `kind: "cli"` 但
 * `tool: "sh"` 的資料修不成有意義的東西，留著只會讓白名單形同虛設。
 *
 * `id: "default"` 也會被丟掉 —— 它是推導出來的，存檔裡出現代表那是舊格式
 * 或手改的產物，採信它就回到「兩份真相」的老問題。
 */
export function migrateBackends(raw: unknown): AgentBackend[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentBackend[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = str(r.id).trim();
    if (!id || id === DEFAULT_BACKEND_ID || id.length > MAX_ID_LEN) continue;
    if (seen.has(id)) continue;
    const label = str(r.label);
    if (r.kind === "cli") {
      if (!isCliTool(r.tool)) continue;
      const b: AgentBackend = { id, label, kind: "cli", tool: r.tool };
      if (typeof r.pathOverride === "string" && r.pathOverride.trim()) {
        b.pathOverride = r.pathOverride;
      }
      out.push(b);
      seen.add(id);
      continue;
    }
    if (r.kind === "api") {
      const b: ApiBackend = {
        id,
        label,
        kind: "api",
        provider: provider(r.provider),
        model: str(r.model),
        endpoint: str(r.endpoint),
        apiKey: str(r.apiKey),
      };
      if (typeof r.localModelName === "string") b.localModelName = r.localModelName;
      if (typeof r.temperature === "number" && Number.isFinite(r.temperature)) {
        b.temperature = r.temperature;
      }
      out.push(b);
      seen.add(id);
      continue;
    }
    // 認不得的 kind：丟掉
  }
  return out;
}

/**
 * 吃一份設定、回一份設定 —— `load()` 與 `importState()` 共用的同一支。
 *
 * 兩條路吃的是同一份資料，只有一條在把關的話，被把關的那條就是誤導。
 */
export function withMigratedBackends<T extends AISettings>(settings: T): T {
  return { ...settings, backends: migrateBackends(settings.backends) };
}

/**
 * 目前存在的所有後端，default 一定在第一筆。
 *
 * 這是清單的**唯一**讀取入口 —— UI 不要直接讀 `settings.backends`，
 * 那份不含 default。
 */
export function listBackends(s: BackendSettings): AgentBackend[] {
  return [defaultBackendOf(s), ...migrateBackends(s.backends)];
}

export function findBackend(s: BackendSettings, id: string): AgentBackend | null {
  const want = id.trim();
  return listBackends(s).find((b) => b.id === want) ?? null;
}

/**
 * 某個 agent 實際會用哪一個後端。**永遠給得出答案。**
 *
 * 三種情況都回 default：agent 不存在、沒設 `backendId`、`backendId` 指到
 * 一個已經被刪掉的後端。第二種是升級當下所有既有 agent 的狀態。
 */
export function resolveBackend(
  agentId: string,
  employees: readonly Employee[],
  s: BackendSettings,
): AgentBackend {
  const bound = employees.find((e) => e.id === agentId)?.backendId?.trim();
  if (bound) {
    const hit = findBackend(s, bound);
    if (hit) return hit;
  }
  return defaultBackendOf(s);
}

/** 顯示名。使用者填了就用他的，沒填才推導 —— 推導出來的名字不會存進資料 */
export function backendLabel(b: AgentBackend): string {
  const own = b.label.trim();
  if (own) return own;
  if (b.kind === "cli") return CLI_LABEL[b.tool];
  const model = b.model.trim() || "未設定模型";
  return b.provider === "auto" ? model : `${PROVIDER_LABEL[b.provider]}／${model}`;
}

/**
 * id 合不合法。回傳**給人看的理由**或 null。
 *
 * 回字串而不是 boolean：呼叫端一定要把理由講出來。「不能新增」而不說原因的
 * 表單，使用者只會反覆按同一個按鈕。
 */
export function backendIdError(
  id: string,
  existing: readonly AgentBackend[],
  selfId?: string,
): string | null {
  const want = id.trim();
  if (!want) return "後端 ID 不可空白";
  if (want.length > MAX_ID_LEN) return `後端 ID 不可超過 ${MAX_ID_LEN} 字`;
  if (want === DEFAULT_BACKEND_ID && selfId !== DEFAULT_BACKEND_ID) {
    return `「${DEFAULT_BACKEND_ID}」保留給預設後端，請換一個 ID`;
  }
  if (existing.some((b) => b.id === want && b.id !== selfId)) {
    return `已經有一個 ID 為「${want}」的後端`;
  }
  return null;
}

/**
 * 哪些 agent 綁著這個後端。
 *
 * 刪除守門用的 —— 擋下來時要說得出是誰在用，不然使用者得自己一隻一隻點開看。
 * 注意：沒設 `backendId` 的 agent **不算** default 的使用者。他們是回退過來的，
 * 而 default 本來就不可刪，不必靠這支擋。
 */
export function backendUsers(backendId: string, employees: readonly Employee[]): Employee[] {
  const want = backendId.trim();
  return employees.filter((e) => e.backendId?.trim() === want);
}
