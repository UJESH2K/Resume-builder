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

/**
 * Enough room for the importer to emit a dozen projects with bullets. Too small and the reply
 * is cut off mid-object; providers with JSON mode then reject it outright.
 */
const MAX_OUTPUT_TOKENS = 8000;

export type ProviderId = "shared" | "gemini" | "groq" | "openrouter" | "ollama" | "openai";

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
    id: "shared",
    label: "Use the built-in model",
    blurb:
      "No key, no sign-up. Shared with everyone using this site, so there is an hourly limit " +
      "and it may be busy. Get your own free key below for no limit.",
    cost: "free",
    keyUrl: "",
    keyHint: "",
    models: [],
    needsKey: false,
  },
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
    models: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.1-8b-instant", "llama-3.3-70b-versatile"],
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

/**
 * The built-in model only exists if the deployment set a token for it, and the browser cannot
 * see server env, so the admin flags it at build time with NEXT_PUBLIC_SHARED_AI=1. Hidden by
 * default: offering an option that always errors is worse than not offering it.
 */
export const sharedAiOffered = (): boolean => process.env.NEXT_PUBLIC_SHARED_AI === "1";

export const availableProviders = (): Provider[] =>
  PROVIDERS.filter((p) => p.id !== "shared" || sharedAiOffered());

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
  if (opts.provider === "shared") return askShared(opts);
  if (opts.provider === "gemini") return askGemini(opts);
  return askOpenAiCompatible(opts);
}

/**
 * The built-in option. Goes to our own server, which holds the token — the only provider
 * where the request does not leave the browser for a third party directly.
 */
async function askShared({ system, user, signal }: AskOptions): Promise<string> {
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({ system, user }),
  }).catch((e) => {
    throw new LlmError(networkHint(e, "shared"));
  });

  const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok || !body.text) {
    throw new LlmError(body.error ?? `The built-in model failed (status ${res.status}).`);
  }
  return body.text;
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
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      },
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
  if (isBlockedLocalCall(base, provider)) throw new LlmError(networkHint(new Error("blocked"), provider, base));

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
      // Without a generous cap the reply is truncated mid-object and the provider rejects it
      // as invalid JSON — which is what "Failed to validate JSON" actually means.
      max_tokens: MAX_OUTPUT_TOKENS,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  }).catch((e) => {
    throw new LlmError(networkHint(e, provider, base));
  });

  const body = await res.text();
  if (!res.ok) {
    // Two cases worth one more attempt without JSON mode:
    //  * older/local servers that reject response_format outright;
    //  * providers that enforce JSON mode and reject a reply that did not parse. Our own
    //    parser is more forgiving (it digs the object out of prose), so plain mode often
    //    succeeds where the provider's strict validation failed.
    if (/response_format|failed to validate json|json_validate/i.test(body)) {
      return askWithoutJsonMode({ provider, model, apiKey, system, user, baseUrl, signal }, base, headers);
    }
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
      max_tokens: MAX_OUTPUT_TOKENS,
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

/**
 * True when the page is served over https but the model is on plain http at localhost.
 *
 * Browsers refuse that combination: it is mixed content, and Chrome's Private Network Access
 * rules additionally require the local server to answer a special preflight, which Ollama does
 * not. So Ollama can only be used when Resume Studio itself is running locally. Worth saying
 * plainly, because the browser reports it as an indistinguishable "failed to fetch".
 */
export function isBlockedLocalCall(baseUrl: string | undefined, provider: ProviderId): boolean {
  if (provider !== "ollama" || typeof window === "undefined") return false;
  if (window.location.protocol !== "https:") return false;
  const target = baseUrl || BASE_URLS.ollama;
  return target.startsWith("http://");
}

/**
 * Ask the provider which models this key can actually use.
 *
 * Hardcoded lists go stale — Groq in particular retires models, and a student then sees
 * "the model does not exist" with no way to find a working one. Every provider here exposes
 * a models endpoint, so the UI can offer the real list instead of our guess.
 */
export async function listModels(opts: {
  provider: ProviderId;
  apiKey: string;
  baseUrl?: string;
  signal?: AbortSignal;
}): Promise<string[]> {
  const { provider, apiKey, baseUrl, signal } = opts;
  if (provider === "shared") return [];

  if (provider === "gemini") {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
      headers: { "x-goog-api-key": apiKey },
      signal,
    }).catch(() => null);
    if (!res?.ok) throw new LlmError(res ? explain(res.status, await res.text(), provider) : "Could not reach Gemini.");
    const json = (await res.json()) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] };
    return (json.models ?? [])
      .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent"))
      .map((m) => (m.name ?? "").replace(/^models\//, ""))
      .filter(Boolean)
      .sort();
  }

  const base = (baseUrl || BASE_URLS[provider] || "").replace(/\/+$/, "");
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${base}/models`, { headers, signal }).catch(() => null);
  if (!res?.ok) throw new LlmError(res ? explain(res.status, await res.text(), provider) : networkHint(new Error(""), provider, base));
  const json = (await res.json()) as { data?: { id?: string }[] };
  return (json.data ?? []).map((m) => m.id ?? "").filter(Boolean).sort();
}

/** A failed fetch in the browser hides the reason, so guess usefully. */
function networkHint(error: unknown, provider: ProviderId, baseUrl?: string): string {
  if ((error as Error)?.name === "AbortError") return "Cancelled.";
  if (provider === "ollama") {
    if (isBlockedLocalCall(baseUrl, provider)) {
      return (
        "Your browser blocked this. Resume Studio is on https, and Ollama is on plain http on " +
        "your own machine — browsers refuse that combination, so Ollama only works when you run " +
        "Resume Studio locally (npm run dev). On this site, use a free Gemini or Groq key instead."
      );
    }
    return (
      "Could not reach Ollama. Check it is running (`ollama serve`), that you have pulled the " +
      "model (`ollama pull llama3.2`), and that it allows this page — start it with " +
      "OLLAMA_ORIGINS=* set, otherwise it rejects requests from the browser."
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
