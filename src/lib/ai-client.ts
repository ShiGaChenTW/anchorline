/**
 * 真實 LLM 呼叫（瀏覽器端）
 * 支援：Gemini API、OpenAI 相容 chat/completions、Anthropic Messages
 */
import { store } from "../data/store";
import type { AISettings } from "../data/types";

export type AiReady =
  | { ok: true; provider: "gemini" | "openai" | "anthropic" | "custom" }
  | { ok: false; reason: string };

export class AiError extends Error {
  constructor(
    message: string,
    public code: "not_configured" | "http" | "parse" | "empty" | "network" = "http",
  ) {
    super(message);
    this.name = "AiError";
  }
}

function settings(): AISettings {
  return store.get().settings;
}

function detectProvider(s: AISettings): AiReady["ok"] extends true
  ? AiReady
  : AiReady {
  const model = s.model;
  const key = (s.apiKey || "").trim();

  if (model === "local-smart") {
    return { ok: true, provider: "custom" };
  }

  if (!key) {
    return {
      ok: false,
      reason: "尚未設定 API Key。請至「偏好設定 → AI 模型」填入金鑰後儲存。",
    };
  }

  if (model.startsWith("gemini")) {
    return { ok: true, provider: "gemini" };
  }
  if (model.startsWith("claude")) {
    return { ok: true, provider: "anthropic" };
  }
  if (model.startsWith("gpt")) {
    return { ok: true, provider: "openai" };
  }
  return { ok: true, provider: "custom" };
}

export function getAiReadiness(): AiReady {
  const s = settings();
  // Ollama：不需付費 Key
  if (s.model === "local-smart") {
    const ep = (s.endpoint || "http://localhost:11434/v1").trim();
    if (!ep) {
      return { ok: false, reason: "請填 Ollama 端點，例如 http://localhost:11434/v1" };
    }
    return { ok: true, provider: "custom" };
  }
  return detectProvider(s) as AiReady;
}

export function isAiConfigured(): boolean {
  return getAiReadiness().ok;
}

function resolveOpenAiModel(s: AISettings): string {
  if (s.model === "local-smart") {
    return (s.localModelName || "llama3.2").trim() || "llama3.2";
  }
  if (s.model.startsWith("gpt")) return s.model;
  // 自訂端點卻選了其他 model 選項時，仍優先 localModelName（若有）
  const local = (s.localModelName || "").trim();
  if (local && /localhost|127\.0\.0\.1|11434/i.test(s.endpoint || "")) return local;
  return "gpt-4o";
}

function normalizeOpenAiBase(endpoint: string, isLocal: boolean): string {
  let base = (endpoint || (isLocal ? "http://localhost:11434/v1" : "https://api.openai.com/v1")).replace(
    /\/$/,
    "",
  );
  // Ollama 常見只填到 :11434
  if (/11434$/.test(base)) base = `${base}/v1`;
  if (!base.endsWith("/v1") && !base.includes("/chat") && !base.includes("/v1/")) {
    if (base.includes("openai.com") || isLocal) base = `${base}/v1`;
  }
  return base;
}

async function callGemini(system: string, user: string, s: AISettings): Promise<string> {
  const model = s.model.startsWith("gemini") ? s.model : "gemini-1.5-flash";
  const base = (s.endpoint || "https://generativelanguage.googleapis.com/v1beta").replace(
    /\/$/,
    "",
  );
  // 支援使用者填 v1beta 或完整 base
  const url = `${base}/models/${model}:generateContent?key=${encodeURIComponent(s.apiKey.trim())}`;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: {
      temperature: Math.min(1, Math.max(0, s.temperature ?? 0.7)),
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new AiError(parseHttpError("Gemini", res.status, raw), "http");
  }
  let data: {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string };
  };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new AiError("Gemini 回傳無法解析", "parse");
  }
  if (data.error?.message) throw new AiError(data.error.message, "http");
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ?? "";
  if (!text.trim()) throw new AiError("Gemini 回傳空內容", "empty");
  return text.trim();
}

async function callOpenAICompat(system: string, user: string, s: AISettings): Promise<string> {
  const isLocal =
    s.model === "local-smart" || /localhost|127\.0\.0\.1|11434/i.test(s.endpoint || "");
  const base = normalizeOpenAiBase(s.endpoint, isLocal);
  const url = base.includes("/chat/completions") ? base : `${base}/chat/completions`;
  const model = resolveOpenAiModel(s);
  // Ollama 可接受任意 Bearer；未填時用 ollama
  const key = (s.apiKey || "").trim() || (isLocal ? "ollama" : "");
  if (!key && !isLocal) {
    throw new AiError("OpenAI 相容端點需要 API Key", "not_configured");
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature: Math.min(1, Math.max(0, s.temperature ?? 0.7)),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new AiError(
      parseHttpError(isLocal ? "Ollama" : "OpenAI", res.status, raw) +
        (isLocal
          ? `（請確認 ollama serve 已啟動，且已 pull 模型「${model}」：ollama pull ${model}）`
          : ""),
      "http",
    );
  }
  let data: { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new AiError("OpenAI 相容端點回傳無法解析", "parse");
  }
  if (data.error?.message) throw new AiError(data.error.message, "http");
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) throw new AiError("模型回傳空內容", "empty");
  return text.trim();
}

async function callAnthropic(system: string, user: string, s: AISettings): Promise<string> {
  const base = (s.endpoint || "https://api.anthropic.com").replace(/\/$/, "");
  const url = base.includes("/messages") ? base : `${base}/v1/messages`;
  const model = s.model.startsWith("claude") ? s.model : "claude-3-5-sonnet-20241022";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": s.apiKey.trim(),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: Math.min(1, Math.max(0, s.temperature ?? 0.7)),
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new AiError(parseHttpError("Anthropic", res.status, raw), "http");
  let data: {
    content?: { type?: string; text?: string }[];
    error?: { message?: string };
  };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new AiError("Anthropic 回傳無法解析", "parse");
  }
  if (data.error?.message) throw new AiError(data.error.message, "http");
  const text = (data.content || [])
    .filter((c) => c.type === "text" || c.text)
    .map((c) => c.text || "")
    .join("");
  if (!text.trim()) throw new AiError("Anthropic 回傳空內容", "empty");
  return text.trim();
}

function parseHttpError(provider: string, status: number, raw: string): string {
  try {
    const j = JSON.parse(raw) as {
      error?: { message?: string; status?: string };
      message?: string;
    };
    const msg = j.error?.message || j.message;
    if (msg) return `${provider} 錯誤 (${status})：${msg}`;
  } catch {
    /* ignore */
  }
  const snippet = raw.replace(/\s+/g, " ").slice(0, 180);
  return `${provider} 錯誤 (${status})${snippet ? `：${snippet}` : ""}`;
}

/** 系統 + 使用者訊息 → 模型純文字回覆 */
export async function chatCompletion(system: string, user: string): Promise<string> {
  const ready = getAiReadiness();
  if (!ready.ok) throw new AiError(ready.reason, "not_configured");
  const s = settings();
  try {
    if (ready.provider === "gemini") return await callGemini(system, user, s);
    if (ready.provider === "anthropic") return await callAnthropic(system, user, s);
    return await callOpenAICompat(system, user, s);
  } catch (e) {
    if (e instanceof AiError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
      throw new AiError(
        "網路請求失敗。若在桌面 App 內，可能是 CORS／連線被擋；請確認端點可從本機存取，或改用支援的端點。",
        "network",
      );
    }
    throw new AiError(msg, "network");
  }
}

/** 嘗試從模型輸出抽出 JSON 物件 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || text.trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 偏好設定用：最小請求測通 */
export async function testAiConnection(): Promise<{ ok: true; sample: string } | { ok: false; reason: string }> {
  try {
    const out = await chatCompletion(
      "You are a connectivity probe. Reply with exactly: OK",
      "ping",
    );
    return { ok: true, sample: out.slice(0, 80) };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}
