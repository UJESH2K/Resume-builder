/**
 * LLM providers, called **straight from the student's browser**.
 *
 * Every one of these endpoints sends permissive CORS headers, so the request goes from the
 * student's machine to the provider directly. Their API key never reaches our server, is
 * never logged, and we hold no liability for it. It is the reason this feature can be
 * "bring your own key" at all.
 *
 * Deliberately no SDKs — plain fetch keeps the bundle small and the behaviour obvious.
 */

export type ProviderId = "gemini" | "groq" | "openrouter" | "ollama" | "openai";

export interface Provider {
  id: ProviderId;
  label: string;
  /** One line a student can act on. */
  blurb: string;
  cost: "free" | "free tier" | "paid" | "local";
  /** Where to get a key. Empty for Ollama. */
  keyUrl: string;
  keyHint: string;
  /** Suggested models. The UI lets them type any model, because these names churn. */
  models: string[];
  needsKey: boolean;
  /** Overridable for Ollama (a student may run it on another port). */
  defaultBaseUrl?: string;
}

export const PROVIDERS: Provider[] = [
  {
    id: "gemini",
    label: "Google Gemini",
    blurb: "Free tier, no card needed. Easiest place to start.",
    cost: "free tier",
    keyUrl: "https://aistudio.google.com/apikey",
    keyHint: "Starts with AIza…",
    models: ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.0-flash-lite"],
    needsKey: true,
  },
  {
    id: "groq",
    label: "Groq",
    blurb: "Free and very fast. Runs open models.",
    cost: "free",
    keyUrl: "https://console.groq.com/keys",
    keyHint: "Starts with gsk_…",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-20b"],
    needsKey: true,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    blurb: "One key, many models. Anything ending in :free costs nothing.",
    cost: "free tier",
    keyUrl: "https://openrouter.ai/keys",
    keyHint: "Starts with sk-or-…",
    models: [
      "meta-llama/llama-3.3-70b-instruct:free",
      "google/gemini-2.0-flash-exp:free",
      "deepseek/deepseek-chat-v3-0324:free",
    ],
    needsKey: true,
  },
  {
    id: "ollama",
    label: "Ollama (on your own laptop)",
    blurb: "No key, no internet, nothing leaves your machine. Needs Ollama installed.",
    cost: "local",
    keyUrl: "https://ollama.com/download",
    keyHint: "",
    models: ["llama3.2", "qwen2.5", "mistral", "gemma2"],
    needsKey: false,
    defaultBaseUrl: "http://localhost:11434/v1",
  },
  {
    id: "openai",
    label: "OpenAI",
    blurb: "Paid — only worth it if you already have credit.",
    cost: "paid",
    keyUrl: "https://platform.openai.com/api-keys",
    keyHint: "Starts with sk-…",
    models: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4o"],
    needsKey: true,
  },
];

export const providerById = (id: string): Provider | undefined => PROVIDERS.find((p) => p.id === id);

export interface AskOptions {
  provider: ProviderId;
  model: string;
  apiKey: string;
  system: string;
  user: string;
  /** Ollama only. */
  baseUrl?: string;
  signal?: AbortSignal;
}

/** Thrown with a message meant to be shown to a student, not a stack trace. */
export class LlmError extends Error {}

/** Pull the human-readable complaint out of whatever error shape a provider returned. */
function explain(status: number, body: string, provider: ProviderId): string {
  let detail = "";
  try {
    const j = JSON.parse(body);
    detail = j?.error?.message ?? j?.error?.error ?? j?.message ?? j?.error ?? "";
    if (typeof detail !== "string") detail = JSON.stringify(detail);
  } catch {
    detail = body.slice(0, 300);
  }

  if (status === 401 || status === 403) {
    return `That API key was rejected. Check you copied the whole key from ${
      providerById(provider)?.keyUrl ?? "the provider"
    }.${detail ? ` (${detail})` : ""}`;
  }
  if (status === 404) {
    return `That model does not exist for this provider. Try a different model.${detail ? ` (${detail})` : ""}`;
  }
  if (status === 429) {
    return "Rate limit or quota reached. Wait a minute and try again, or switch provider.";
  }
  return detail || `Request failed with status ${status}.`;
}

/** Ask the model, returning its raw text reply. */
export async function ask(opts: AskOptions): Promise<string> {
  if (opts.provider === "gemini") return askGemini(opts);
  return askOpenAiCompatible(opts);
}

async function askGemini({ model, apiKey, system, user, signal }: AskOptions): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
    }),
  }).catch((e) => {
    throw new LlmError(networkHint(e, "gemini"));
  });

  const body = await res.text();
  if (!res.ok) throw new LlmError(explain(res.status, body, "gemini"));

  const json = JSON.parse(body);
  const blocked = json?.promptFeedback?.blockReason;
  if (blocked) throw new LlmError(`Gemini refused the request (${blocked}). Try another provider.`);

  const text = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  if (!text) throw new LlmError("Gemini returned an empty reply. Try again or switch model.");
  return text;
}

const BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  ollama: "http://localhost:11434/v1",
};

/** OpenAI, Groq, OpenRouter and Ollama all speak the same /chat/completions shape. */
async function askOpenAiCompatible({
  provider,
  model,
  apiKey,
  system,
  user,
  baseUrl,
  signal,
}: AskOptions): Promise<string> {
  const base = (baseUrl || BASE_URLS[provider] || "").replace(/\/+$/, "");
  if (!base) throw new LlmError(`No endpoint configured for ${provider}.`);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (provider === "openrouter") {
    // OpenRouter asks callers to identify themselves; it also unlocks their free tier.
    headers["X-Title"] = "Resume Studio";
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  }).catch((e) => {
    throw new LlmError(networkHint(e, provider));
  });

  const body = await res.text();
  if (!res.ok) {
    // Some local/older servers reject response_format. Retry once without it.
    if (/response_format/i.test(body)) return askWithoutJsonMode({ provider, model, apiKey, system, user, baseUrl, signal }, base, headers);
    throw new LlmError(explain(res.status, body, provider));
  }

  const json = JSON.parse(body);
  const text = json?.choices?.[0]?.message?.content ?? "";
  if (!text) throw new LlmError("The model returned an empty reply. Try again or switch model.");
  return text;
}

/** Fallback for servers without JSON mode — the prompt already demands JSON. */
async function askWithoutJsonMode(
  { model, system, user, signal, provider }: AskOptions,
  base: string,
  headers: Record<string, string>
): Promise<string> {
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new LlmError(explain(res.status, body, provider));
  const text = JSON.parse(body)?.choices?.[0]?.message?.content ?? "";
  if (!text) throw new LlmError("The model returned an empty reply.");
  return text;
}

/** A failed fetch in the browser hides the reason, so guess usefully. */
function networkHint(error: unknown, provider: ProviderId): string {
  if ((error as Error)?.name === "AbortError") return "Cancelled.";
  if (provider === "ollama") {
    return (
      "Could not reach Ollama. Check it is running (`ollama serve`), that you have pulled the " +
      "model (`ollama pull llama3.2`), and that it allows this page: set OLLAMA_ORIGINS=* and restart it."
    );
  }
  return "Could not reach the provider. Check your internet connection and try again.";
}

/**
 * Models wrap JSON in prose or code fences no matter how firmly you ask them not to,
 * so dig the object out rather than failing.
 */
export function parseJsonObject(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall through to brace matching.
  }
  const start = cleaned.indexOf("{");
  if (start === -1) throw new LlmError("The model did not return JSON. Try again or switch model.");

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(cleaned.slice(start, i + 1));
      } catch {
        break;
      }
    }
  }
  throw new LlmError("Could not read the model's reply as JSON. Try again or switch model.");
}
