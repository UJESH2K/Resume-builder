import "server-only";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyStep, LADDER, ladderFor, stepPreamble, type FitStep } from "./fit";
import { buildTex } from "./latex";
import { normalizeVariant } from "./sections";
import type { Db } from "./types";

const ROOT = process.cwd();

/**
 * Scratch space for pdflatex. Under the OS temp dir rather than the project, because in a
 * container the app directory is read-only and this is throwaway data either way.
 */
const BUILD_DIR = process.env.BUILD_DIR || path.join(os.tmpdir(), "resume-studio-build");

/**
 * How many pdflatex processes may run at once. Each compile is CPU-bound and takes about a
 * second, and the auto-fit ladder can need several in a row, so one global queue would make
 * a classroom of students wait in line. Build directories are namespaced per user+variant,
 * so parallel runs cannot read each other's files.
 */
const CONCURRENCY = Math.max(1, Number(process.env.COMPILE_CONCURRENCY || 2));

/**
 * The queue in front of those slots, and why it is bounded.
 *
 * With a room full of students the arrival rate is bursty: every keystroke in the Builder
 * schedules a preview, and one preview is three to five pdflatex runs. An unbounded queue
 * turns that into a silent pile-up — requests sit holding sockets and memory until the
 * browser gives up, and nobody is told anything. A bounded queue with a wait deadline fails
 * loudly instead, so the route can answer "busy, try again" while the server is still healthy.
 */
const QUEUE_MAX = Math.max(CONCURRENCY, Number(process.env.COMPILE_QUEUE_MAX || 60));
const QUEUE_WAIT_MS = Math.max(2_000, Number(process.env.COMPILE_QUEUE_WAIT_MS || 25_000));

/** Thrown when the queue is full or a request waited past the deadline. The route maps it to 503. */
export class CompileBusy extends Error {
  constructor(
    public readonly queued: number,
    public readonly reason: "full" | "timeout"
  ) {
    super(
      reason === "full"
        ? `Too many resumes compiling at once (${queued} waiting).`
        : `Waited too long for a compile slot (${queued} ahead).`
    );
    this.name = "CompileBusy";
  }
}

let active = 0;
/** Waiters in arrival order. `release` resolves them; `fail` rejects on the deadline. */
const waiting: { release: () => void; fail: (e: Error) => void }[] = [];

/** What the route reports back so the UI can say "3 ahead of you" instead of just spinning. */
export const queueStats = () => ({ active, waiting: waiting.length, concurrency: CONCURRENCY, max: QUEUE_MAX });

/**
 * Run `fn` once a compile slot frees up, or give up rather than queue forever.
 *
 * A finishing job hands its slot directly to the next waiter instead of releasing it and
 * letting the waiter claim one. Those are not the same thing: between a release and the
 * waiter actually resuming there is a turn of the event loop, and a request arriving in that
 * gap would see a free slot and take it, putting two jobs in one slot. Transferring keeps
 * `active` correct at every instant, which is what makes the concurrency cap mean anything.
 */
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= CONCURRENCY) {
    if (waiting.length >= QUEUE_MAX) throw new CompileBusy(waiting.length, "full");
    // Resolving means the slot is already ours — the job that finished counted it for us.
    await new Promise<void>((resolve, reject) => {
      const entry = {
        release: () => {
          clearTimeout(timer);
          resolve();
        },
        fail: (e: Error) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      const timer = setTimeout(() => {
        // Leave the queue before rejecting: a waiter that has given up must not be handed a
        // slot afterwards, or that slot is leaked and `active` never returns to zero.
        const at = waiting.indexOf(entry);
        if (at >= 0) waiting.splice(at, 1);
        entry.fail(new CompileBusy(waiting.length, "timeout"));
      }, QUEUE_WAIT_MS);
      waiting.push(entry);
    });
  } else {
    active++;
  }

  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next.release(); // hand the slot straight over; `active` stays as it is
    else active--;
  }
}

/**
 * Finished PDFs, keyed by a hash of the exact LaTeX that produced them.
 *
 * The Builder re-previews on a timer, and the auto-fit ladder walks the same steps in the
 * same order every time, so an unchanged resume asks for byte-identical LaTeX again and
 * again. Caching that turns a repeat preview from three-to-five pdflatex runs into zero —
 * which is most of the load a room of students generates, because most of what they do is
 * look at a preview they have already compiled.
 *
 * Keyed on the LaTeX itself, so it cannot serve one student's resume to another: different
 * content is a different key. Bounded in entries rather than bytes, which is crude but
 * predictable — a resume PDF is a couple of hundred KB.
 */
/** Hard ceiling on one pdflatex run. See the call site for why it is far below the old 120s. */
const COMPILE_TIMEOUT_MS = Math.max(5_000, Number(process.env.COMPILE_TIMEOUT_MS || 30_000));

const CACHE_MAX = Math.max(0, Number(process.env.COMPILE_CACHE_MAX || 150));
const CACHE_TTL_MS = Math.max(0, Number(process.env.COMPILE_CACHE_TTL_MS || 15 * 60_000));
type Cached = { pdf: Buffer; pages: number; overflows: number; at: number };
const cache = new Map<string, Cached>();

const texKey = (tex: string) => createHash("sha256").update(tex).digest("hex");

function cacheGet(key: string): Cached | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (CACHE_TTL_MS && Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // Re-insert so iteration order is least-recently-used first.
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function cachePut(key: string, value: Cached): void {
  if (!CACHE_MAX) return;
  cache.set(key, value);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "resume";

export async function texFor(db: Db, variantId: string) {
  const variant = db.variants.find((v) => v.id === variantId);
  if (!variant) throw new Error(`Variant ${variantId} not found`);
  const preamble = await fs.readFile(path.join(ROOT, "latex", "preamble.tex"), "utf8");
  return { variant, tex: buildTex(db, normalizeVariant(db, variant), preamble) };
}

export interface FittedResult extends CompileResult {
  fitLabel: string;
  fitNotes: string[];
  fitOk: boolean; // false when even the last resort could not reach the limit
  attempts: number;
}

/**
 * Compile, and if the result is longer than `maxPages`, walk the auto-fit ladder until it fits.
 * The first attempt is the resume exactly as written, so a resume that already fits costs one run.
 */
export async function compileFitted(
  db: Db,
  variantId: string,
  maxPages: number,
  /** Scratch-directory key. Namespace it per user so two students never share a build dir. */
  jobKey: string = variantId
): Promise<FittedResult> {
  const variant = normalizeVariant(db, db.variants.find((v) => v.id === variantId)!);
  const preamble = await fs.readFile(path.join(ROOT, "latex", "preamble.tex"), "utf8");
  let attempts = 0;
  let last: (CompileResult & { pages?: number }) | null = null;
  let lastStep: FitStep = LADDER[0];
  let lastNotes: string[] = [];

  const attempt = async (step: FitStep, balance = false) => {
    const { variant: v2, notes } = applyStep(db, variant, step);
    const res = await compile(buildTex(db, v2, preamble, stepPreamble(step, balance)), jobKey);
    attempts++;
    last = res;
    lastStep = step;
    lastNotes = notes;
    return { res, notes, fits: res.ok && (!maxPages || (res.pages ?? 99) <= maxPages) };
  };

  /**
   * A resume spanning more than one page gets a second run with \flushbottom so the leftover
   * space is shared out instead of sitting in a hole at the end of page one.
   */
  const balanced = async (res: CompileResult, step: FitStep, notes: string[]): Promise<FittedResult> => {
    if ((res.pages ?? 1) > 1) {
      const b = await attempt(step, true);
      if (b.res.ok && b.res.pages === res.pages)
        return { ...b.res, fitLabel: step.label, fitNotes: notes, fitOk: true, attempts };
    }
    return { ...res, fitLabel: step.label, fitNotes: notes, fitOk: true, attempts };
  };
  const done = (res: CompileResult, step: FitStep, notes: string[], ok: boolean): FittedResult => ({
    ...res,
    fitLabel: step.label,
    fitNotes: notes,
    fitOk: ok,
    attempts,
  });

  // 1. typography only — nothing is removed from the resume
  const first = await attempt(LADDER[0]);
  if (!first.res.ok) return done(first.res, LADDER[0], first.notes, false);
  if (first.fits) return balanced(first.res, LADDER[0], first.notes);

  const over = (first.res.pages ?? 99) - maxPages;
  if (over <= 1) {
    // one page over: try the gentle steps in order so the resume changes as little as possible
    for (const step of LADDER.slice(1)) {
      const { res, notes, fits } = await attempt(step);
      if (!res.ok) return done(res, step, notes, false);
      if (fits) return balanced(res, step, notes);
    }
  } else {
    // far over: typography alone probably cannot save it, so test the strongest step first
    const strongest = LADDER[LADDER.length - 1];
    const strong = await attempt(strongest);
    if (!strong.res.ok) return done(strong.res, strongest, strong.notes, false);
    if (strong.fits) {
      // it fits — now find the mildest typography step that also fits
      let lo = 0;
      let hi = LADDER.length - 1;
      let best = { res: strong.res, step: strongest, notes: strong.notes };
      while (lo + 1 < hi) {
        const mid = Math.floor((lo + hi) / 2);
        const { res, notes, fits } = await attempt(LADDER[mid]);
        if (!res.ok) break;
        if (fits) {
          hi = mid;
          best = { res, step: LADDER[mid], notes };
        } else lo = mid;
      }
      return balanced(best.res, best.step, best.notes);
    }
  }

  // 2. hide entries: find the FEWEST that still fits (exponential probe, then binary search)
  const steps = ladderFor(db, variant).filter((s) => s.drop);
  if (steps.length) {
    const at = (i: number) => steps[i - 1];
    let lo = 0; // known not to fit
    let hi = 0; // smallest known to fit
    for (let d = 1; d <= steps.length; d = d * 2) {
      const n = Math.min(d, steps.length);
      const { res, fits } = await attempt(at(n));
      if (!res.ok) return done(res, at(n), lastNotes, false);
      if (fits) {
        hi = n;
        break;
      }
      lo = n;
    }
    if (hi) {
      let bestRes = last!;
      let bestStep = lastStep;
      let bestNotes = lastNotes;
      while (lo + 1 < hi) {
        const mid = Math.floor((lo + hi) / 2);
        const { res, notes, fits } = await attempt(at(mid));
        if (!res.ok) break;
        if (fits) {
          hi = mid;
          bestRes = res;
          bestStep = at(mid);
          bestNotes = notes;
        } else lo = mid;
      }
      return balanced(bestRes, bestStep, bestNotes);
    }
  }

  // 3. last resort: cap bullets everywhere
  for (const step of ladderFor(db, variant).filter((s) => s.hardBulletCap)) {
    const { res, notes, fits } = await attempt(step);
    if (!res.ok) return done(res, step, notes, false);
    if (fits) return balanced(res, step, notes);
  }

  // Asked for one page but it cannot be done: fall back to the gentlest version that fits two,
  // rather than handing back the most brutally trimmed attempt.
  if (maxPages === 1) {
    const two = await compileFitted(db, variantId, 2, jobKey);
    return { ...two, fitLabel: `${two.fitLabel} (1 page not possible)`, attempts: attempts + two.attempts };
  }

  return done(last ?? { ok: false, tex: "" }, lastStep, lastNotes, false);
}

export interface CompileResult {
  ok: boolean;
  pdf?: Buffer;
  pages?: number;
  overflows?: number;
  log?: string;
  tex: string;
}

export function compile(tex: string, jobDir: string): Promise<CompileResult> {
  // Checked before queueing, not inside the slot: a cache hit must not wait behind other
  // students' compiles, since serving it costs nothing.
  const key = texKey(tex);
  const hit = cacheGet(key);
  if (hit) return Promise.resolve({ ok: true, pdf: hit.pdf, pages: hit.pages, overflows: hit.overflows, tex });

  return withSlot(async () => {
    // turbopackIgnore on these: BUILD_DIR is a runtime value (temp dir), so the bundler
    // cannot resolve it and would otherwise trace the entire project into the standalone
    // output "just in case", bloating the Docker image with every source file.
    const dir = path.join(/* turbopackIgnore: true */ BUILD_DIR, slug(jobDir));
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(/* turbopackIgnore: true */ dir, "resume.tex"), tex, "utf8");
    await fs.rm(path.join(/* turbopackIgnore: true */ dir, "resume.pdf"), { force: true });
    const bin = process.env.PDFLATEX || "pdflatex";
    const log = await new Promise<string>((resolve) => {
      execFile(
        // Same reason as the path.join calls above: `bin` and `cwd` are runtime values.
        /* turbopackIgnore: true */ bin,
        ["-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "-no-shell-escape", "resume.tex"],
        // 30s, not the old 120s: a resume that has not compiled in 30 seconds is not going to,
        // and under load a stuck job holding a slot for two minutes stalls everyone behind it.
        { cwd: dir, env: texEnv(), timeout: COMPILE_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024, windowsHide: true },
        (err, stdout, stderr) => resolve(`${stdout}\n${stderr}${err && !stdout ? `\n${err.message}` : ""}`)
      );
    });
    try {
      const pdf = await fs.readFile(path.join(/* turbopackIgnore: true */ dir, "resume.pdf"));
      const pages = Number(/Output written on .*?\((\d+) pages?/.exec(log)?.[1] ?? 0);
      const overflows = overflowWarnings(log);
      cachePut(key, { pdf, pages, overflows, at: Date.now() });
      return { ok: true, pdf, pages, overflows, tex };
    } catch {
      return { ok: false, log: extractErrors(log), tex };
    }
  });
}

// MiKTeX aborts if a PATH entry points at a file (e.g. ...\python.exe) instead of a directory.
function texEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Paranoid mode: TeX may not read files outside the build dir (so no \input of the
  // server's .env) nor write anywhere else. Students' resume text reaches LaTeX directly,
  // so this is the backstop behind the escaping in lib/latex.ts.
  env.openin_any = "p";
  env.openout_any = "p";
  const key = Object.keys(env).find((k) => k.toLowerCase() === "path");
  if (key && env[key]) {
    env[key] = env[key]!.split(path.delimiter).filter((p) => p && !/\.(exe|bat|cmd)\\?$/i.test(p)).join(path.delimiter);
  }
  return env;
}

/** Overfull boxes wider than a few points usually mean a heading line spills past the margin. */
export function overflowWarnings(log: string): number {
  return [...log.matchAll(/Overfull \\hbox \(([\d.]+)pt too wide\)/g)].filter((m) => parseFloat(m[1]) > 4).length;
}

function extractErrors(log: string): string {
  const lines = log.split(/\r?\n/);
  const idx = lines.findIndex((l) => /^!|:\d+: /.test(l));
  if (idx >= 0) return lines.slice(idx, idx + 12).join("\n");
  return lines.slice(-25).join("\n");
}
