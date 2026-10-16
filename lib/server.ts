import "server-only";
import { execFile } from "node:child_process";
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

let active = 0;
const waiting: (() => void)[] = [];

/** Run `fn` once a compile slot frees up. */
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
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
        { cwd: dir, env: texEnv(), timeout: 120_000, maxBuffer: 20 * 1024 * 1024, windowsHide: true },
        (err, stdout, stderr) => resolve(`${stdout}\n${stderr}${err && !stdout ? `\n${err.message}` : ""}`)
      );
    });
    try {
      const pdf = await fs.readFile(path.join(/* turbopackIgnore: true */ dir, "resume.pdf"));
      const pages = Number(/Output written on .*?\((\d+) pages?/.exec(log)?.[1] ?? 0);
      return { ok: true, pdf, pages, overflows: overflowWarnings(log), tex };
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
