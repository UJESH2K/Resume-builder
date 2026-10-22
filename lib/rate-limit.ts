import "server-only";

/**
 * A small per-user rate limiter, held in this process's memory.
 *
 * Deliberately not backed by Redis or Postgres. The app runs as a single container (pdflatex
 * cannot run on serverless, which is why it is a container at all), so process memory is the
 * whole picture, and a round trip to the database to decide whether to do work is worse than
 * the work for something this cheap. If this ever runs on more than one instance the limits
 * become per-instance — acceptable, since they exist to stop one student's runaway tab from
 * starving a classroom, not to enforce a billing quota.
 *
 * Sliding window rather than a fixed one: a fixed window lets someone spend their whole
 * allowance in the last second of one window and again in the first second of the next.
 */

interface Window {
  /** Timestamps of the calls still inside the window, oldest first. */
  hits: number[];
  /** Last touch, used to evict students who went home. */
  seen: number;
}

const buckets = new Map<string, Window>();

/** Stop the map growing without bound across a long-running deployment. */
const SWEEP_AFTER = 10 * 60_000;
let lastSweep = Date.now();

function sweep(now: number): void {
  if (now - lastSweep < SWEEP_AFTER) return;
  lastSweep = now;
  for (const [key, w] of buckets) if (now - w.seen > SWEEP_AFTER) buckets.delete(key);
}

export interface RateVerdict {
  ok: boolean;
  /** Calls left in the current window. */
  remaining: number;
  /** Seconds until the window has room again. Zero when `ok`. */
  retryAfter: number;
  limit: number;
}

/**
 * Record one call against `key` and say whether it is allowed.
 *
 * Counts the call only when it is allowed, so a client being refused cannot push its own
 * window further out by retrying in a loop.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateVerdict {
  const now = Date.now();
  sweep(now);

  const w = buckets.get(key) ?? { hits: [], seen: now };
  w.seen = now;
  const cutoff = now - windowMs;
  while (w.hits.length && w.hits[0] <= cutoff) w.hits.shift();

  if (w.hits.length >= limit) {
    buckets.set(key, w);
    return {
      ok: false,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((w.hits[0] + windowMs - now) / 1000)),
      limit,
    };
  }

  w.hits.push(now);
  buckets.set(key, w);
  return { ok: true, remaining: limit - w.hits.length, retryAfter: 0, limit };
}
