/**
 * 真實 LLM 呼叫（瀏覽器端）
 * 支援：Gemini API、OpenAI 相容 chat/completions、Anthropic Messages
 */
import { store } from "../data/store";
import type { AISettings } from "../data/types";
import { anthropicMessagesUrl, anthropicModelsUrl, geminiBase } from "./api-url";

export type AiReady =
  | { ok: true; provider: "gemini" | "openai" | "anthropic" | "custom" }
  | { ok: false; reason: string };

import { drainSseLines } from "./sse";

export class AiError extends Error {
  constructor(
    message: string,
    public code: "not_configured" | "http" | "parse" | "empty" | "network" | "truncated" | "aborted" = "http",
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
  const chosen = s.provider ?? "auto";

  // Ollama 走 OpenAI 相容路徑且不需要付費 Key，所以它必須在 Key 檢查之前判掉。
  if (model === "local-smart" || chosen === "ollama") {
    return { ok: true, provider: "custom" };
  }

  if (!key) {
    return {
      ok: false,
      reason: "尚未設定 API Key。請至「偏好設定 → AI 模型」填入金鑰後儲存。",
    };
  }

  // 使用者講明了通路就照做。前綴推斷是猜，明示不是 —— 猜不該覆蓋知道的人。
  if (chosen !== "auto") {
    return { ok: true, provider: chosen };
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
  if (s.model === "local-smart" || s.provider === "ollama") {
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
  return "gpt-5.1";
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
  const model = s.model.startsWith("gemini") ? s.model : "gemini-2.5-flash";
  const base = geminiBase(s.endpoint);
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
  const url = anthropicMessagesUrl(s.endpoint);
  const model = s.model.startsWith("claude") ? s.model : "claude-sonnet-4-5";
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": s.apiKey.trim(),
    "anthropic-version": "2023-06-01",
    // 少了這個標頭，Anthropic 一律回 401 CORS——不是金鑰壞了
    "anthropic-dangerous-direct-browser-access": "true",
  };
  const body = (withTemp: boolean) =>
    JSON.stringify({
      model,
      // 4096 對散文夠，對「產生一份完整的領域包」遠遠不夠——實測一份含五個
      // 章節與法規引用的包會被切在半句話。而截斷的症狀不是「內容變短」，是
      // 下游解析器說「缺少 frontmatter」，完全指不到真正的原因。
      max_tokens: 16384,
      ...(withTemp ? { temperature: Math.min(1, Math.max(0, s.temperature ?? 0.7)) } : {}),
      system,
      messages: [{ role: "user", content: user }],
    });

  let res = await fetch(url, { method: "POST", headers, body: body(true) });
  let raw = await res.text();
  // 新一代模型不收 temperature（回 400 "temperature is deprecated for this model"）。
  // 直接不送會讓舊模型失去這個設定，所以是「先送、被打回再重試」。
  if (!res.ok && res.status === 400 && /temperature/i.test(raw)) {
    res = await fetch(url, { method: "POST", headers, body: body(false) });
    raw = await res.text();
  }
  if (!res.ok) throw new AiError(parseHttpError("Anthropic", res.status, raw), "http");
  let data: {
    content?: { type?: string; text?: string }[];
    stop_reason?: string;
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
  // 截斷要當場講。不講的話下游只會看到「格式不對」，然後所有人去查格式。
  if (data.stop_reason === "max_tokens") {
    throw new AiError(
      `回應超過長度上限被截斷（max_tokens ${16384}）。請把要求縮小，或分兩次產生。`,
      "truncated",
    );
  }
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

/**
 * 向端點問「你現在有哪些模型」。
 * 硬編一份模型清單一定會過期 —— 唯一不會過期的來源是供應商自己。
 * 三家的列表 API 形狀不同，但都只是一層 map。
 */
export async function listModels(): Promise<string[]> {
  const s = settings();
  const key = (s.apiKey || "").trim();
  const ready = getAiReadiness();
  if (!ready.ok) throw new AiError(ready.reason, "not_configured");

  let url = "";
  const headers: Record<string, string> = {};

  if (ready.provider === "gemini") {
    url = `${geminiBase(s.endpoint)}/models?key=${encodeURIComponent(key)}&pageSize=200`;
  } else if (ready.provider === "anthropic") {
    url = `${anthropicModelsUrl(s.endpoint)}?limit=100`;
    headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  } else {
    const isLocal = s.model === "local-smart" || /localhost|127\.0\.0\.1|11434/i.test(s.endpoint || "");
    url = `${normalizeOpenAiBase(s.endpoint, isLocal)}/models`;
    headers.Authorization = `Bearer ${key || (isLocal ? "ollama" : "")}`;
  }

  const res = await fetch(url, { headers });
  const raw = await res.text();
  if (!res.ok) throw new AiError(parseHttpError("列出模型", res.status, raw), "http");

  let data: { models?: { name?: string }[]; data?: { id?: string }[] };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new AiError("模型列表回傳無法解析", "parse");
  }
  const names = [
    ...(data.models ?? []).map((m) => (m.name ?? "").replace(/^models\//, "")),
    ...(data.data ?? []).map((m) => m.id ?? ""),
  ].filter(Boolean);
  if (!names.length) throw new AiError("端點沒有回傳任何模型", "empty");
  return Array.from(new Set(names)).sort();
}

// ── 逐字串流 ──────────────────────────────────────────────────

/**
 * 串流一次對話，逐段回吐文字。
 *
 * 為什麼要有這個：非串流版本在模型跑完之前畫面上什麼都沒有，使用者只能看著
 * 一個轉圈圈猜它是在想還是掛了。串流的價值不是比較快（總時間一樣），是
 * **證明系統在動**，而且讓人在看出方向不對時可以提早喊停。
 *
 * 三家的 SSE 形狀不同，但差異只有兩處：URL／body 要不要開串流，以及一個
 * event 裡的 delta 藏在哪個欄位。共用的 SSE 切行邏輯抽在 `pumpSse`。
 */
export async function chatCompletionStream(
  system: string,
  user: string,
  onDelta: (chunk: string, full: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const ready = getAiReadiness();
  if (!ready.ok) throw new AiError(ready.reason, "not_configured");
  const s = settings();
  try {
    if (ready.provider === "gemini") return await streamGemini(system, user, s, onDelta, signal);
    if (ready.provider === "anthropic")
      return await streamAnthropic(system, user, s, onDelta, signal);
    return await streamOpenAICompat(system, user, s, onDelta, signal);
  } catch (e) {
    if (e instanceof AiError) throw e;
    if ((e as Error)?.name === "AbortError") throw new AiError("已取消", "aborted");
    const msg = e instanceof Error ? e.message : String(e);
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
      throw new AiError(
        "網路請求失敗。若在桌面 App 內，可能是 CORS／連線被擋；請確認端點可從本機存取。",
        "network",
      );
    }
    throw new AiError(msg, "network");
  }
}

/**
 * 讀 SSE 串流並逐行餵給 `onEvent`。
 *
 * 刻意自己切行而不是用現成套件：SSE 的 chunk 邊界**不保證落在換行上**，
 * 一個 JSON 物件可能被切成兩半。緩衝到看見 `\n` 才處理是唯一正確的做法，
 * 少了它會在長回應時隨機噴 parse 錯誤 —— 而且是難重現的那種。
 */
async function pumpSse(
  res: Response,
  onEvent: (json: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) throw new AiError("這個端點不支援串流回應", "network");
  const decoder = new TextDecoder();
  let buf = "";

  for (;;) {
    if (signal?.aborted) {
      await reader.cancel().catch(() => {});
      throw new AiError("已取消", "aborted");
    }
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const { events, rest } = drainSseLines(buf);
    buf = rest;
    for (const ev of events) onEvent(ev);
  }
}

async function streamGemini(
  system: string,
  user: string,
  s: AISettings,
  onDelta: (chunk: string, full: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const model = s.model.startsWith("gemini") ? s.model : "gemini-2.5-flash";
  const base = geminiBase(s.endpoint);
  // alt=sse 才會回 SSE；少了它是一整包 JSON 陣列，串不了
  const url = `${base}/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(s.apiKey.trim())}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: Math.min(1, Math.max(0, s.temperature ?? 0.7)) },
    }),
  });
  if (!res.ok) throw new AiError(parseHttpError("Gemini", res.status, await res.text()), "http");

  let full = "";
  await pumpSse(
    res,
    (j) => {
      const d = j as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const chunk = d.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ?? "";
      if (chunk) {
        full += chunk;
        onDelta(chunk, full);
      }
    },
    signal,
  );
  if (!full.trim()) throw new AiError("Gemini 回傳空內容", "empty");
  return full.trim();
}

async function streamAnthropic(
  system: string,
  user: string,
  s: AISettings,
  onDelta: (chunk: string, full: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const url = anthropicMessagesUrl(s.endpoint);
  const model = s.model.startsWith("claude") ? s.model : "claude-sonnet-4-5";
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": s.apiKey.trim(),
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
  const body = (withTemp: boolean) =>
    JSON.stringify({
      model,
      max_tokens: 16384,
      stream: true,
      ...(withTemp ? { temperature: Math.min(1, Math.max(0, s.temperature ?? 0.7)) } : {}),
      system,
      messages: [{ role: "user", content: user }],
    });

  let res = await fetch(url, { method: "POST", headers, signal, body: body(true) });
  // 與非串流版同一個坑：新模型不收 temperature，先送再被打回重試
  if (!res.ok && res.status === 400) {
    const raw = await res.text();
    if (!/temperature/i.test(raw)) throw new AiError(parseHttpError("Anthropic", 400, raw), "http");
    res = await fetch(url, { method: "POST", headers, signal, body: body(false) });
  }
  if (!res.ok) throw new AiError(parseHttpError("Anthropic", res.status, await res.text()), "http");

  let full = "";
  await pumpSse(
    res,
    (j) => {
      const d = j as { type?: string; delta?: { type?: string; text?: string } };
      if (d.type === "content_block_delta" && d.delta?.text) {
        full += d.delta.text;
        onDelta(d.delta.text, full);
      }
    },
    signal,
  );
  if (!full.trim()) throw new AiError("Anthropic 回傳空內容", "empty");
  return full.trim();
}

async function streamOpenAICompat(
  system: string,
  user: string,
  s: AISettings,
  onDelta: (chunk: string, full: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const isLocal =
    s.model === "local-smart" || /localhost|127\.0\.0\.1|11434/i.test(s.endpoint || "");
  const base = normalizeOpenAiBase(s.endpoint, isLocal);
  const url = base.includes("/chat/completions") ? base : `${base}/chat/completions`;
  const model = resolveOpenAiModel(s);
  const key = (s.apiKey || "").trim() || (isLocal ? "ollama" : "");
  if (!key && !isLocal) throw new AiError("OpenAI 相容端點需要 API Key", "not_configured");

  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      stream: true,
      temperature: Math.min(1, Math.max(0, s.temperature ?? 0.7)),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    throw new AiError(
      parseHttpError(isLocal ? "Ollama" : "OpenAI", res.status, await res.text()),
      "http",
    );
  }

  let full = "";
  await pumpSse(
    res,
    (j) => {
      const d = j as { choices?: { delta?: { content?: string } }[] };
      const chunk = d.choices?.[0]?.delta?.content ?? "";
      if (chunk) {
        full += chunk;
        onDelta(chunk, full);
      }
    },
    signal,
  );
  if (!full.trim()) throw new AiError("回傳空內容", "empty");
  return full.trim();
}
