import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The "no API key" option: a shared model, paid for by whoever runs this deployment.
 *
 * Every other provider is called straight from the student's browser with their own key, so
 * nothing touches this server. This one is the exception — the admin's token does the work,
 * which means it needs guarding:
 *
 *  * sign-in required, so it is not an open relay;
 *  * a per-student hourly cap, so one person cannot burn the shared quota;
 *  * prompt size capped;
 *  * the token is only ever read here and never sent to the browser.
 *
 * Turn it on by setting SHARED_AI_TOKEN (e.g. a Hugging Face token). Leave it unset and the
 * option disappears from the UI by itself.
 *
 * Defaults to Hugging Face's router, which speaks the OpenAI chat-completions shape, but
 * SHARED_AI_BASE_URL can point at any compatible endpoint (OpenRouter, Groq, your own).
 */

const DEFAULT_BASE = "https://router.huggingface.co/v1";
const DEFAULT_MODEL = "meta-llama/Llama-3.3-70B-Instruct";

/** Requests per student per hour. Generous for real use, useless for abuse. */
const HOURLY_LIMIT = Number(process.env.SHARED_AI_HOURLY_LIMIT || 12);
const MAX_PROMPT_CHARS = 60_000;

/**
 * In-memory counters. Per-instance, so with several machines the real limit is the cap times
 * the instance count — fine for its purpose, which is stopping runaway use rather than
 * precise metering. A durable counter would mean a database round trip on every call.
 */
const hits = new Map<string, { count: number; resetAt: number }>();

function overLimit(userId: string): { blocked: boolean; retryMins: number } {
  const now = Date.now();
  const entry = hits.get(userId);
  if (!entry || now > entry.resetAt) {
    hits.set(userId, { count: 1, resetAt: now + 3_600_000 });
    return { blocked: false, retryMins: 0 };
  }
  entry.count++;
  // Opportunistic cleanup so the map cannot grow forever.
  if (hits.size > 5000) for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
  return {
    blocked: entry.count > HOURLY_LIMIT,
    retryMins: Math.max(1, Math.ceil((entry.resetAt - now) / 60000)),
  };
}

export function sharedAiEnabled(): boolean {
  return Boolean(process.env.SHARED_AI_TOKEN?.trim());
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const token = process.env.SHARED_AI_TOKEN?.trim();
  if (!token) {
    return NextResponse.json(
      {
        error:
          "The shared model is not switched on for this site. Use a free Gemini or Groq key " +
          "instead — the panel has links to get one in under a minute.",
      },
      { status: 503 }
    );
  }

  const { system, user: userPrompt } = (await req.json().catch(() => ({}))) as {
    system?: string;
    user?: string;
  };
  if (!system || !userPrompt) {
    return NextResponse.json({ error: "Nothing to send to the model." }, { status: 400 });
  }
  if (system.length + userPrompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json(
      { error: "That is too much text for the shared model. Trim it, or use your own API key." },
      { status: 413 }
    );
  }

  const { blocked, retryMins } = overLimit(user.id);
  if (blocked) {
    return NextResponse.json(
      {
        error:
          `You have used the shared model ${HOURLY_LIMIT} times this hour. It is shared with ` +
          `everyone, so it resets in about ${retryMins} minute(s). A free Gemini or Groq key ` +
          `has no such limit.`,
      },
      { status: 429 }
    );
  }

  const base = (process.env.SHARED_AI_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
  const model = process.env.SHARED_AI_MODEL || DEFAULT_MODEL;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 110_000);

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    const body = await res.text();
    if (!res.ok) {
      // Never pass the upstream error through verbatim: it can name the account or the token.
      console.error(`[shared-ai] upstream ${res.status}: ${body.slice(0, 500)}`);
      const outOfCredit = res.status === 402 || /quota|credit|payment/i.test(body);
      return NextResponse.json(
        {
          error: outOfCredit
            ? "The shared model has run out of credit for now. Use a free Gemini or Groq key — " +
              "the panel links to one."
            : `The shared model is unavailable right now (status ${res.status}). Try again, or use your own key.`,
        },
        { status: 502 }
      );
    }

    const text = (JSON.parse(body)?.choices?.[0]?.message?.content ?? "") as string;
    if (!text) {
      return NextResponse.json({ error: "The shared model returned nothing. Try again." }, { status: 502 });
    }
    return NextResponse.json({ text });
  } catch (e) {
    const aborted = (e as Error)?.name === "AbortError";
    return NextResponse.json(
      { error: aborted ? "The shared model took too long. Try again." : "Could not reach the shared model." },
      { status: 504 }
    );
  } finally {
    clearTimeout(timer);
  }
}
