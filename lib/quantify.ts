/**
 * The "Accomplished [X] as measured by [Y] by doing [Z]" engine.
 *
 * Google's own resume guidance tells students to write every bullet in that form, and the
 * examples they show are a ladder: a vague claim, then the same claim with a number, then the
 * same claim with a number *and* the mechanism that produced it. Only the third reads like
 * engineering.
 *
 *   "Participated in professional development program"              -> X only
 *   "Selected as one of 200 participants for an 18-month program"   -> X + Y
 *   "Selected as one of 230 participants nationwide ... based on
 *    leadership potential and academic success"                     -> X + Y + Z
 *
 * This module is the deterministic read of that ladder. No model is involved: it is regex and
 * vocabulary, so it gives the same answer every time, costs nothing, and cannot invent a
 * metric the student did not write. That last point matters most — the worst thing this app
 * could do is put a number on a resume the student cannot defend in an interview. So the
 * engine *detects and demands* metrics; it never supplies them.
 *
 * Shared by the score panel (shows students what is missing), the audit (lib/audit.ts), and
 * the importer prompt (lib/ai/extract.ts asks for bullets in this shape to begin with).
 */

// ---------------------------------------------------------------- vocabulary

/**
 * Verbs that open an accomplishment rather than describe a duty. Grouped only for
 * readability; the check is a flat membership test on the first word.
 */
const STRONG_VERBS = new Set([
  // built / shipped
  "architected", "automated", "built", "created", "delivered", "deployed", "designed",
  "developed", "engineered", "implemented", "launched", "prototyped", "published", "released",
  "shipped", "wrote",
  // improved
  "accelerated", "boosted", "consolidated", "cut", "decreased", "doubled", "eliminated",
  "expanded", "grew", "halved", "improved", "increased", "optimised", "optimized", "reduced",
  "refactored", "saved", "scaled", "simplified", "streamlined", "strengthened", "tripled",
  "tuned", "upgraded",
  // owned / led
  "coordinated", "directed", "drove", "founded", "headed", "led", "managed", "mentored",
  "organised", "organized", "oversaw", "owned", "spearheaded", "supervised", "taught",
  "trained",
  // analysed
  "analysed", "analyzed", "benchmarked", "diagnosed", "evaluated", "identified",
  "instrumented", "investigated", "measured", "modelled", "modeled", "profiled", "quantified",
  "researched", "tested", "validated",
  // moved / integrated
  "annotated", "containerised", "containerized", "curated", "debugged", "defined", "devised",
  "documented", "fixed", "indexed", "ingested", "integrated", "labelled", "labeled",
  "migrated", "ported", "rearchitected", "rebuilt", "redesigned", "replaced", "resolved",
  "standardised", "standardized",
  // won / earned
  "achieved", "authored", "awarded", "earned", "established", "generated", "initiated",
  "introduced", "pioneered", "placed", "raised", "ranked", "secured", "selected", "won",
  // collaborated
  "advised", "briefed", "collaborated", "contributed", "hosted", "negotiated", "partnered",
  "presented", "proposed", "ran",
]);

/**
 * Present-tense forms accepted for an *ongoing* role. Resume convention is past tense for
 * finished work and present tense for a job or committee seat someone still holds, so
 * rejecting "Lead a 200-member community" would be wrong. Kept as a separate set rather than
 * doubling the list above, because these are only correct in the present-tense case.
 */
const PRESENT_VERBS = new Set([
  "analyse", "analyze", "automate", "build", "coordinate", "deliver", "deploy", "design",
  "develop", "drive", "grow", "host", "integrate", "lead", "maintain", "manage", "mentor",
  "optimise", "optimize", "organise", "organize", "own", "present", "refactor", "review",
  "run", "scale", "ship", "teach", "test", "write",
]);

/**
 * Phrases that signal a duty rather than an outcome. These are what the "before" examples in
 * Google's deck read like, and they are the most common thing on a student resume. Each
 * carries the rewrite we suggest.
 */
const WEAK_PHRASES: { pattern: RegExp; fix: string }[] = [
  { pattern: /\bresponsible for\b/i, fix: "name the thing you did: 'Built…', 'Owned…'" },
  { pattern: /\bworked on\b/i, fix: "say what changed because you worked on it" },
  { pattern: /\bhelped (?:to )?\w/i, fix: "state your own part: what did you build or decide?" },
  { pattern: /\bassisted (?:with|in)\b/i, fix: "claim the part you owned" },
  { pattern: /\b(?:participated|involved) in\b/i, fix: "what did you produce or win?" },
  { pattern: /\bwas part of\b/i, fix: "describe your contribution, not the membership" },
  { pattern: /\btasked with\b/i, fix: "lead with the verb and the result" },
  { pattern: /\bfamiliar with\b/i, fix: "move tools to the Skills section" },
  { pattern: /\bexposure to\b/i, fix: "move tools to the Skills section" },
  { pattern: /\bvarious\b/i, fix: "say how many, or name them" },
  { pattern: /\bseveral\b/i, fix: "replace with the actual number" },
  { pattern: /\bmultiple\b/i, fix: "replace with the actual number" },
  { pattern: /\betc\.?(?:\s|$)/i, fix: "drop it — a list that trails off reads as padding" },
  { pattern: /\bsuccessfully\b/i, fix: "the result already says it succeeded" },
  { pattern: /\bvery\b/i, fix: "cut the intensifier; the number carries the weight" },
  { pattern: /\bhard[- ]working\b/i, fix: "cut self-description; show the work" },
  { pattern: /\bteam player\b/i, fix: "cut it; show collaboration through what you shipped" },
  { pattern: /\bpassionate about\b/i, fix: "cut it; interest is assumed" },
  { pattern: /\bcutting[- ]edge\b/i, fix: "name the technology instead" },
  { pattern: /\bstate[- ]of[- ]the[- ]art\b/i, fix: "name the technology instead" },
  { pattern: /\bleverag(?:e|ed|ing)\b/i, fix: "'used' is clearer, or drop it and lead with the outcome" },
];

/**
 * The [Y] test: is there something a reader could verify?
 *
 * Deliberately broad about units, because student work is measured in odd things — images in
 * a dataset, members in a club, lectures taught, rupees of compute. A bare four-digit year is
 * NOT a metric (a date is not an outcome), which is why the plain-count pattern is bounded to
 * three digits and why no pattern matches a lone year.
 */
const METRIC_PATTERNS: RegExp[] = [
  /\b\d+(?:\.\d+)?\s*%/,                                      // 15%
  /\b\d+(?:\.\d+)?\s*x\b/i,                                   // 3x
  /(?:₹|Rs\.?|\$|USD|INR)\s*\d/i,                             // ₹7, $2k
  /\b\d+(?:\.\d+)?\s*(?:k|m|bn|lakh|lakhs|crore|crores)\b/i,   // 5k, 2 lakh
  // Hyphen included so "18-month programme" and "3-week sprint" count.
  /\b\d+\s*[- ]?\s*(?:ms|s|sec|secs|seconds|min|mins|minutes|hour|hours|hrs|day|days|week|weeks|month|months)\b/i,
  /\b\d+\s*(?:kb|mb|gb|tb)\b/i,
  /\b\d+\s*(?:qps|rps|rpm|req\/s)\b/i,
  /\b\d+\s*\+/,                                               // 200+
  /\bover\s+\d/i,
  /\bone of\s+\d[\d,]*/i,                                     // "one of 230 participants"
  /\btop\s+\d/i,
  /\b\d+\s*(?:st|nd|rd|th)\s+(?:place|rank|position)\b/i,
  /\b\d+(?:\.\d+)?\s*\/\s*\d+/,                               // 7.7/10
  /\b\d+\s*(?:-|–|to)\s*\d+\b/,                               // 10-20
  /\b\d{1,3}(?:,\d{3})+\b/,                                   // 5,000
  // A plain count followed by a countable noun. Bounded to three digits so "2024" cannot match.
  /\b\d{1,3}\s+(?:users?|students?|members?|people|teams?|engineers?|developers?|clients?|customers?|repos|repositories|projects?|images?|rows?|records?|files?|papers?|lectures?|sessions?|hackathons?|participants?|entries|datasets?|models?|endpoints?|services?|tables?|queries|commits?|contributors?|downloads?|installs?|stars?)\b/i,
];

/**
 * The [Z] test: does the bullet say *how*?
 *
 * "by doing" is the literal form Google suggests, but a named mechanism counts too — an
 * engineer writing "cut latency 40% by adding a Redis cache" has supplied Z either way.
 */
const METHOD_PATTERNS: RegExp[] = [
  /\bby\s+\w+ing\b/i,            // by restructuring
  /\bthrough\s+\w+ing\b/i,
  /\busing\b/i,
  /\bvia\b/i,
  /\bwith\s+(?:a|an|the)?\s*\w/i,
  /\bbased on\b/i,
  /\bby\s+(?:adding|building|writing|moving|switching|replacing|introducing)\b/i,
];

/** Bullets much past this read as a paragraph and lose the scan. About two printed lines. */
export const LONG_BULLET = 240;
/** Below this there is not enough substance for X, Y and Z to coexist. */
const SHORT_BULLET = 45;

// ---------------------------------------------------------------- bullet analysis

export type Grade = "strong" | "fair" | "weak";

export interface BulletIssue {
  /** Machine-readable, so the UI can group and a prompt can cite it. */
  code:
    | "no-verb"
    | "weak-verb"
    | "no-metric"
    | "no-method"
    | "too-long"
    | "too-short"
    | "weak-phrase"
    | "first-person";
  /** Shown to the student, phrased as the thing to do next. */
  fix: string;
  /** The offending words, where there are any. */
  found?: string;
}

/**
 * Not every bullet is an accomplishment.
 *
 * "Relevant coursework: Data Structures, Operating Systems…" and the one-line summary of a
 * paper are *descriptive* by nature, and demanding a metric there would push students to
 * invent one — the exact failure this whole module exists to prevent. Descriptive bullets are
 * still read for verbs, length and padding, but the [Y] requirement is lifted and they are
 * left out of the resume's quantified ratio.
 */
export type BulletKind = "achievement" | "descriptive";

export interface BulletAnalysis {
  text: string;
  kind: BulletKind;
  /** 0-100. */
  score: number;
  grade: Grade;
  /** The three parts of the framework. */
  hasX: boolean; // an accomplishment, led by a strong verb
  hasY: boolean; // measured by something
  hasZ: boolean; // by doing what
  /** The opening word, when it is a recognised strong verb. */
  verb: string | null;
  /** Every metric already present — shown back so students see what counted. */
  metrics: string[];
  issues: BulletIssue[];
}

/** Strip inline markup (`**bold**`, links) so the vocabulary tests see plain words. */
export function plainText(s: string): string {
  return (s ?? "")
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1")
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const firstWord = (s: string) => (/^([A-Za-z][A-Za-z-]*)/.exec(s)?.[1] ?? "").toLowerCase();

function findMetrics(s: string): string[] {
  const out: string[] = [];
  for (const re of METRIC_PATTERNS) {
    const m = re.exec(s);
    if (m) out.push(m[0].trim());
  }
  return [...new Set(out)];
}

/**
 * Read one bullet against the X/Y/Z ladder.
 *
 * The weighting is deliberate: the metric is worth more than the verb and the method put
 * together, because a measured claim is the whole point of the framework and the thing
 * students leave out. A bullet can be grammatically lovely and still score "weak".
 */
export function analyzeBullet(raw: string, kind: BulletKind = "achievement"): BulletAnalysis {
  const text = plainText(raw);

  if (!text) {
    return {
      text,
      kind,
      score: 0,
      grade: "weak",
      hasX: false,
      hasY: false,
      hasZ: false,
      verb: null,
      metrics: [],
      issues: [{ code: "too-short", fix: "Empty bullet — write it or delete it." }],
    };
  }
  const descriptive = kind === "descriptive";

  const issues: BulletIssue[] = [];
  const verbWord = firstWord(text);
  const hasVerb = STRONG_VERBS.has(verbWord) || PRESENT_VERBS.has(verbWord);
  const metrics = findMetrics(text);
  const hasMetric = metrics.length > 0;
  const hasMethod = METHOD_PATTERNS.some((re) => re.test(text));

  // Weights differ by kind: an accomplishment lives or dies on its measure, a descriptive
  // line is judged on being tight and specific instead.
  let score = 0;
  if (descriptive) {
    if (hasVerb) score += 20;
    if (hasMetric) score += 10; // a bonus here, not a requirement
    if (hasMethod) score += 20;
    if (text.length >= SHORT_BULLET && text.length <= LONG_BULLET) score += 25;
  } else {
    if (hasVerb) score += 25;
    if (hasMetric) score += 35;
    if (hasMethod) score += 20;
    if (text.length >= SHORT_BULLET && text.length <= LONG_BULLET) score += 10;
  }

  if (!hasVerb && !descriptive) {
    // "Starts with a limp verb" and "does not start with a verb at all" need different fixes:
    // one is a swap, the other is a rewrite.
    const limp = /^(?:was|were|am|is|are|had|has|have|did|worked|helped|assisted|participated|involved|responsible|tasked)\b/i.test(
      text
    );
    issues.push(
      limp
        ? {
            code: "weak-verb",
            found: verbWord,
            fix: `Open with an accomplishment verb instead of "${verbWord}" — Built, Led, Cut, Shipped, Designed.`,
          }
        : {
            code: "no-verb",
            found: verbWord || undefined,
            fix: "Start with a strong past-tense verb: Built, Led, Reduced, Designed, Shipped.",
          }
    );
  }
  if (!hasMetric && !descriptive) {
    issues.push({
      code: "no-metric",
      fix: "Add the [Y]: how much, how many, how fast, how many people. Any honest number beats none.",
    });
  }
  if (!hasMethod && !descriptive) {
    issues.push({ code: "no-method", fix: "Add the [Z]: 'by <doing what>' — the mechanism behind the result." });
  }
  if (text.length > LONG_BULLET) {
    issues.push({
      code: "too-long",
      fix: `${text.length} characters — cut to about two printed lines (${LONG_BULLET}) or split into two bullets.`,
    });
    score -= 10;
  } else if (text.length < SHORT_BULLET) {
    issues.push({ code: "too-short", fix: "Too thin to carry a result — say what changed and by how much." });
  }
  if (/\b(?:I|my|me)\b/.test(text)) {
    issues.push({ code: "first-person", fix: "Drop 'I' / 'my' — resume bullets are written without a subject." });
    score -= 5;
  }

  let clean = true;
  for (const w of WEAK_PHRASES) {
    const m = w.pattern.exec(text);
    if (!m) continue;
    clean = false;
    issues.push({ code: "weak-phrase", found: m[0].trim(), fix: `"${m[0].trim()}" — ${w.fix}` });
    score -= 6;
  }
  if (clean) score += 10;

  score = Math.max(0, Math.min(100, score));
  return {
    text,
    kind,
    score,
    grade: score >= 75 ? "strong" : score >= 45 ? "fair" : "weak",
    hasX: hasVerb,
    hasY: hasMetric,
    hasZ: hasMethod,
    verb: hasVerb ? verbWord : null,
    metrics,
    issues,
  };
}

/**
 * The scaffold shown beside a weak bullet: which of the three parts is missing, in the
 * framework's own words. Guidance for the student to fill in — never a generated sentence,
 * because we have no idea what their real numbers are.
 */
export function xyzGaps(a: BulletAnalysis): string[] {
  const gaps: string[] = [];
  if (!a.hasX) gaps.push("[X] the accomplishment — open with what you actually did");
  if (!a.hasY) gaps.push("[Y] the measure — the number that proves it happened");
  if (!a.hasZ) gaps.push("[Z] the method — 'by <doing what>'");
  return gaps;
}

export const GRADE_LABEL: Record<Grade, string> = {
  strong: "X + Y + Z",
  fair: "missing one part",
  weak: "needs a measure",
};

export interface BulletSummary {
  /** Every bullet read, descriptive ones included. */
  count: number;
  analyses: BulletAnalysis[];
  average: number;
  /** Denominator for the three ratios below: accomplishment bullets only. */
  scored: number;
  quantified: number;
  quantifiedRatio: number;
  strongVerbRatio: number;
  methodRatio: number;
  weakCount: number;
}

export interface BulletInput {
  text: string;
  kind?: BulletKind;
}

/**
 * Aggregate of many bullets, plus the share that clear each bar. Used by the resume audit.
 *
 * The X/Y/Z ratios are taken over accomplishment bullets only — a resume whose education
 * section lists coursework should not be marked down for it — while `average` covers
 * everything, because a rambling descriptive line is still a problem.
 */
export function summarize(bullets: (string | BulletInput)[]): BulletSummary {
  const analyses = bullets.map((b) =>
    typeof b === "string" ? analyzeBullet(b) : analyzeBullet(b.text, b.kind ?? "achievement")
  );
  const count = analyses.length;
  const scorable = analyses.filter((a) => a.kind === "achievement");
  const scored = scorable.length;
  const ratio = (n: number) => (scored ? n / scored : 0);
  const quantified = scorable.filter((a) => a.hasY).length;
  return {
    count,
    analyses,
    average: count ? Math.round(analyses.reduce((n, a) => n + a.score, 0) / count) : 0,
    scored,
    quantified,
    quantifiedRatio: ratio(quantified),
    strongVerbRatio: ratio(scorable.filter((a) => a.hasX).length),
    methodRatio: ratio(scorable.filter((a) => a.hasZ).length),
    weakCount: analyses.filter((a) => a.grade === "weak").length,
  };
}

/**
 * The framework written out for a model prompt. Kept here rather than in the prompt files so
 * the importer, the tailor and the UI all describe the same rules in the same words.
 */
export const XYZ_RULES = `Write every bullet in the form: Accomplished [X] as measured by [Y] by doing [Z].
- [X] opens with a strong past-tense verb (Built, Led, Cut, Shipped, Designed, Reduced).
- [Y] is the measure, and it must come from the source text. If the text states no number,
  write the bullet without one — NEVER estimate, round up or invent a metric.
- [Z] is the mechanism: "by <doing what>", or the named technology that produced the result.
Never open with "Responsible for", "Worked on", "Helped with" or "Participated in".
Keep each bullet to one or two printed lines (about 240 characters).`;
