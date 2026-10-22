import { analyzeBullet, summarize, type BulletAnalysis, type BulletKind, type BulletSummary } from "./quantify";
import { SECTION_DEFS } from "./sections";
import type { Bullet, Db, Education, SectionKey, Variant } from "./types";

/**
 * Whole-resume audit against the structural advice in Google's "Create Your Resume for
 * Google" deck, on top of the per-bullet X/Y/Z read in lib/quantify.ts.
 *
 * The deck's structural claims, and where each is enforced below:
 *
 *  * Section order depends on how long ago you graduated. A student or recent graduate leads
 *    with Education, then Experience, then Leadership and Awards, then an optional final
 *    section. An experienced professional inverts the first and last: Experience, Leadership
 *    and Awards, then Education. -> `expectedOrder`, `section-order`
 *  * The degree carries the most weight while graduation is recent, so it must state the
 *    degree and the month and year you finish. -> `graduation`
 *  * The header carries name, email, GitHub profile and programming languages. -> `contact`
 *  * The optional final section is where student groups, leadership positions, publications,
 *    papers, patents, conference presentations and other meaningful extracurriculars go.
 *    -> `optional-final`
 *
 * Everything here is deterministic and read-only. It reports; it never edits a library, and
 * it never writes a number into a bullet.
 */

export type Severity = "fail" | "warn" | "pass";

export interface Check {
  id: string;
  label: string;
  severity: Severity;
  /** What we found. */
  detail: string;
  /** What to do about it, when there is something to do. */
  fix?: string;
  /** Which editor section to send them to. */
  section?: SectionKey;
  /** Share of the structural half of the score this check carries. */
  weight: number;
}

/** One bullet that needs work, with enough context to jump straight to it. */
export interface WeakBullet {
  section: SectionKey;
  sectionLabel: string;
  itemId: string;
  itemLabel: string;
  bulletId: string;
  analysis: BulletAnalysis;
}

export interface Audit {
  /** 0-100: half structural checks, half the X/Y/Z quality of the bullets. */
  score: number;
  grade: "excellent" | "good" | "needs-work" | "poor";
  stage: "student" | "experienced";
  checks: Check[];
  bullets: BulletSummary;
  weakBullets: WeakBullet[];
  /** Counts the panel shows as headline numbers. */
  totals: { items: number; bullets: number; quantified: number; sections: number };
}

// ---------------------------------------------------------------- section order

/** Student / recent graduate: the degree is still the strongest signal, so it leads. */
export const GOOGLE_ORDER_STUDENT: SectionKey[] = [
  "summary",
  "education",
  "experience",
  "skills",
  "projects",
  "leadership",
  "awards",
  "publications",
  "achievements",
  "certifications",
];

/** Experienced: shipped work leads and the degree drops to the end. */
export const GOOGLE_ORDER_EXPERIENCED: SectionKey[] = [
  "summary",
  "experience",
  "skills",
  "projects",
  "leadership",
  "awards",
  "publications",
  "education",
  "achievements",
  "certifications",
];

export const expectedOrder = (stage: Audit["stage"]): SectionKey[] =>
  stage === "student" ? GOOGLE_ORDER_STUDENT : GOOGLE_ORDER_EXPERIENCED;

// ---------------------------------------------------------------- graduation

const MONTHS =
  "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december";

export interface GraduationInfo {
  /** The education entry that finishes last — the one a recruiter reads first. */
  latest: Education | null;
  /** Does the end date name a month as well as a year? */
  hasMonth: boolean;
  hasYear: boolean;
  /** Is it phrased as a future/expected date rather than a bare one? */
  saysExpected: boolean;
  /** Still studying, as far as the end date reveals. */
  ongoing: boolean;
  year: number | null;
}

/**
 * Read the end date of the most recent degree.
 *
 * Dates in this library are free text on purpose (lib/dates.ts parses them loosely), so this
 * matches shapes rather than parsing: "Expected May 2027", "May 2027", "2027", "Present".
 */
export function graduationInfo(education: Education[]): GraduationInfo {
  const yearOf = (s: string) => {
    const years = [...String(s ?? "").matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0]));
    return years.length ? Math.max(...years) : null;
  };
  const ranked = [...(education ?? [])].sort((a, b) => {
    const ay = yearOf(a.end) ?? (/(present|current|ongoing|expected)/i.test(a.end ?? "") ? 9999 : 0);
    const by = yearOf(b.end) ?? (/(present|current|ongoing|expected)/i.test(b.end ?? "") ? 9999 : 0);
    return by - ay;
  });
  const latest = ranked[0] ?? null;
  const end = String(latest?.end ?? "");
  return {
    latest,
    hasMonth: new RegExp(`\\b(?:${MONTHS})\\b`, "i").test(end),
    hasYear: /\b(19|20)\d{2}\b/.test(end),
    saysExpected: /\b(?:expected|anticipated|graduating)\b/i.test(end),
    ongoing: /\b(?:present|current|ongoing|expected|anticipated)\b/i.test(end),
    year: yearOf(end),
  };
}

// ---------------------------------------------------------------- helpers

/**
 * Which sections hold descriptive rather than accomplishment bullets.
 *
 * Education bullets are the coursework list; publication bullets are the one-line summary of
 * what the paper does. Neither should be marked down for having no metric — see BulletKind.
 */
const DESCRIPTIVE_SECTIONS = new Set<SectionKey>(["education", "publications"]);

const bulletKind = (key: SectionKey): BulletKind =>
  DESCRIPTIVE_SECTIONS.has(key) ? "descriptive" : "achievement";

/** Every bullet the variant will actually print, with the item it belongs to. */
function visibleBullets(db: Db, v: Variant) {
  const hidden = new Set(v.hiddenBullets ?? []);
  const out: { section: SectionKey; itemId: string; itemLabel: string; bullet: Bullet }[] = [];
  for (const s of v.sections) {
    if (!s.enabled) continue;
    const pool = db[s.key] as unknown as Record<string, unknown>[];
    const byId = new Map((pool ?? []).map((i) => [String(i.id), i]));
    for (const id of s.items) {
      const item = byId.get(id);
      if (!item) continue;
      const label = SECTION_DEFS[s.key]?.summary(item) ?? id;
      for (const b of (item.bullets as Bullet[] | undefined) ?? []) {
        if (!b.text?.trim() || hidden.has(b.id)) continue;
        out.push({ section: s.key, itemId: id, itemLabel: String(label), bullet: b });
      }
    }
  }
  return out;
}

const countSelected = (v: Variant, key: SectionKey) =>
  v.sections.find((s) => s.key === key && s.enabled)?.items.length ?? 0;

const pct = (n: number) => `${Math.round(n * 100)}%`;

// ---------------------------------------------------------------- the audit

/**
 * Audit one variant as it will print.
 *
 * `pages` comes from the last compile when there is one; several checks are meaningless
 * without it, so they are skipped rather than guessed at.
 */
export function auditResume(db: Db, variant: Variant, pages?: number): Audit {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  const vb = visibleBullets(db, variant);
  const bullets = summarize(vb.map((b) => ({ text: b.bullet.text, kind: bulletKind(b.section) })));
  const weakBullets: WeakBullet[] = vb
    .map((b, i) => ({
      section: b.section,
      sectionLabel: SECTION_DEFS[b.section]?.label ?? b.section,
      itemId: b.itemId,
      itemLabel: b.itemLabel,
      bulletId: b.bullet.id,
      analysis: bullets.analyses[i],
    }))
    .filter((b) => b.analysis.grade !== "strong")
    .sort((a, b) => a.analysis.score - b.analysis.score);

  // --- stage: student or experienced ---------------------------------------
  const grad = graduationInfo(db.education ?? []);
  const thisYear = new Date().getFullYear();
  // Still studying, or finished within the last three years: the degree still leads.
  const stage: Audit["stage"] =
    grad.ongoing || (grad.year !== null && grad.year >= thisYear - 3) || (db.experience ?? []).length < 2
      ? "student"
      : "experienced";

  // --- contact header ------------------------------------------------------
  const p = db.profile ?? ({} as Db["profile"]);
  const missingContact = (
    [
      ["name", p.name],
      ["email", p.email],
      ["phone", p.phone],
      ["GitHub", p.github],
      ["LinkedIn", p.linkedin],
    ] as const
  )
    .filter(([, v]) => !String(v ?? "").trim())
    .map(([k]) => k);
  add({
    id: "contact",
    label: "Contact header is complete",
    severity: missingContact.length === 0 ? "pass" : missingContact.some((m) => m === "name" || m === "email") ? "fail" : "warn",
    detail: missingContact.length ? `Missing: ${missingContact.join(", ")}.` : "Name, email, phone, GitHub and LinkedIn all present.",
    fix: missingContact.length
      ? "Google's own sample header carries name, email, GitHub profile and the languages you code in. Fill these in Library -> Profile."
      : undefined,
    weight: 8,
  });

  // --- education and graduation date ---------------------------------------
  if (!grad.latest) {
    add({
      id: "graduation",
      label: "Degree and expected graduation",
      severity: "fail",
      detail: "No education entry.",
      fix: "Add your degree. While graduation is recent it is the single most weighted line on the resume.",
      section: "education",
      weight: 12,
    });
  } else {
    const end = String(grad.latest.end ?? "").trim();
    const ok = grad.hasMonth && grad.hasYear;
    add({
      id: "graduation",
      label: "Degree states the month and year you finish",
      severity: ok ? "pass" : "fail",
      detail: ok
        ? `Reads "${end}".`
        : end
          ? `Reads "${end}" — no ${grad.hasYear ? "month" : "month or year"}.`
          : "No end date.",
      fix: ok
        ? undefined
        : grad.ongoing || !grad.hasYear
          ? 'Write it as "Expected May 2027" — a recruiter reading a recent graduate wants the month and year you are available, not "Present".'
          : 'Add the month: "May 2027" rather than "2027".',
      section: "education",
      weight: 12,
    });
    add({
      id: "degree-named",
      label: "Degree is spelled out",
      severity: String(grad.latest.degree ?? "").trim().length > 8 ? "pass" : "warn",
      detail: String(grad.latest.degree ?? "").trim() || "Degree field is empty.",
      fix: String(grad.latest.degree ?? "").trim().length > 8 ? undefined : 'Write it in full — "Bachelor of Engineering in Computer Science", not "BE CSE".',
      section: "education",
      weight: 4,
    });
  }

  // --- section order -------------------------------------------------------
  const want = expectedOrder(stage);
  const got = variant.sections.filter((s) => s.enabled && s.items.length).map((s) => s.key);
  const rank = new Map(want.map((k, i) => [k, i]));
  const outOfOrder = got.filter((k, i) => i > 0 && (rank.get(k) ?? 99) < (rank.get(got[i - 1]) ?? 99));
  add({
    id: "section-order",
    label: stage === "student" ? "Education leads (student ordering)" : "Experience leads (experienced ordering)",
    severity: outOfOrder.length === 0 ? "pass" : "warn",
    detail:
      outOfOrder.length === 0
        ? `Sections run in the order Google suggests for a ${stage === "student" ? "student or recent graduate" : "working professional"}.`
        : `Out of place: ${outOfOrder.map((k) => SECTION_DEFS[k]?.label ?? k).join(", ")}.`,
    fix:
      outOfOrder.length === 0
        ? undefined
        : stage === "student"
          ? "A recent graduate leads with Education, then Experience, then Leadership and Awards. Use “Apply Google order” to reorder."
          : "With a few years behind you, Experience leads and Education drops to the end. Use “Apply Google order” to reorder.",
    weight: 8,
  });

  // --- the optional final section -------------------------------------------
  const finalSection =
    countSelected(variant, "leadership") +
    countSelected(variant, "awards") +
    countSelected(variant, "publications") +
    countSelected(variant, "achievements");
  add({
    id: "optional-final",
    label: "Leadership, awards or publications present",
    severity: finalSection > 0 ? "pass" : "warn",
    detail: finalSection > 0 ? `${finalSection} entries across leadership, awards, publications and achievements.` : "Nothing in any of them.",
    fix:
      finalSection > 0
        ? undefined
        : "Google asks specifically for student groups — especially where you held a leadership position — plus publications, papers, patents and conference talks.",
    section: "leadership",
    weight: 6,
  });

  // --- substance -----------------------------------------------------------
  const projectCount = countSelected(variant, "projects");
  const expCount = countSelected(variant, "experience");
  add({
    id: "substance",
    label: "Enough work to show",
    severity: expCount + projectCount >= 3 ? "pass" : expCount + projectCount >= 1 ? "warn" : "fail",
    detail: `${expCount} experience, ${projectCount} project entries selected.`,
    fix: expCount + projectCount >= 3 ? undefined : "Aim for at least three entries between experience and projects.",
    section: "projects",
    weight: 8,
  });

  const skills = countSelected(variant, "skills");
  add({
    id: "skills",
    label: "Skills grouped by category",
    severity: skills >= 3 ? "pass" : skills >= 1 ? "warn" : "fail",
    detail: skills ? `${skills} skill groups.` : "No skills section.",
    fix: skills >= 3 ? undefined : "Group them — Languages, Frameworks, Cloud & DevOps, ML. A flat list of 40 words does not scan.",
    section: "skills",
    weight: 6,
  });

  // --- links ---------------------------------------------------------------
  const projItems = (db.projects ?? []).filter((x) =>
    variant.sections.find((s) => s.key === "projects")?.items.includes(x.id)
  );
  const linkless = projItems.filter((x) => !String(x.codeLink ?? "").trim() && !String(x.liveLink ?? "").trim());
  add({
    id: "project-links",
    label: "Projects are clickable",
    severity: projItems.length === 0 ? "warn" : linkless.length === 0 ? "pass" : linkless.length <= projItems.length / 2 ? "warn" : "fail",
    detail: projItems.length === 0 ? "No projects selected." : linkless.length === 0 ? "Every project has a code or demo link." : `${linkless.length} of ${projItems.length} have neither a code nor a demo link: ${linkless.slice(0, 3).map((x) => x.name).join(", ")}${linkless.length > 3 ? "…" : ""}.`,
    fix: linkless.length ? "A reviewer who can click through to working code is the strongest signal a student resume has." : undefined,
    section: "projects",
    weight: 6,
  });

  // --- bullets per entry ---------------------------------------------------
  const thinEntries: string[] = [];
  for (const key of ["experience", "projects", "leadership"] as const) {
    const sel = variant.sections.find((s) => s.key === key);
    if (!sel?.enabled) continue;
    const pool = db[key] as unknown as Record<string, unknown>[];
    for (const id of sel.items) {
      const item = (pool ?? []).find((x) => String(x.id) === id);
      if (!item) continue;
      const n = ((item.bullets as Bullet[] | undefined) ?? []).filter((b) => b.text?.trim()).length;
      if (n < 2) thinEntries.push(String(SECTION_DEFS[key]?.summary(item) ?? id));
    }
  }
  add({
    id: "bullets-per-entry",
    label: "Every entry has at least two bullets",
    severity: thinEntries.length === 0 ? "pass" : thinEntries.length <= 2 ? "warn" : "fail",
    detail: thinEntries.length === 0 ? "No one-line entries." : `Thin: ${thinEntries.slice(0, 4).join(", ")}${thinEntries.length > 4 ? ` +${thinEntries.length - 4}` : ""}.`,
    fix: thinEntries.length ? "A single-line entry wastes the heading it costs. Two or three bullets, or cut the entry." : undefined,
    weight: 6,
  });

  // --- the X/Y/Z measures --------------------------------------------------
  add({
    id: "quantified",
    label: "Bullets carry a measure [Y]",
    severity: bullets.quantifiedRatio >= 0.5 ? "pass" : bullets.quantifiedRatio >= 0.3 ? "warn" : "fail",
    detail: bullets.scored
      ? `${bullets.quantified} of ${bullets.scored} achievement bullets (${pct(bullets.quantifiedRatio)}) state a number.`
      : "No achievement bullets to read.",
    fix:
      bullets.quantifiedRatio >= 0.5
        ? undefined
        : "Target half. Count what you actually know: users, records, images, members, minutes saved, percent faster, rupees spent.",
    weight: 14,
  });
  add({
    id: "action-verbs",
    label: "Bullets open with an accomplishment verb [X]",
    severity: bullets.strongVerbRatio >= 0.8 ? "pass" : bullets.strongVerbRatio >= 0.6 ? "warn" : "fail",
    detail: bullets.scored ? `${pct(bullets.strongVerbRatio)} start with a strong verb.` : "No bullets to read.",
    fix: bullets.strongVerbRatio >= 0.8 ? undefined : "Built, Led, Cut, Shipped, Designed, Reduced — never 'Responsible for' or 'Worked on'.",
    weight: 8,
  });
  add({
    id: "method",
    label: "Bullets say how it was done [Z]",
    severity: bullets.methodRatio >= 0.6 ? "pass" : bullets.methodRatio >= 0.4 ? "warn" : "fail",
    detail: bullets.scored ? `${pct(bullets.methodRatio)} name the mechanism.` : "No bullets to read.",
    fix: bullets.methodRatio >= 0.6 ? undefined : "Finish the sentence with 'by <doing what>' — the technique is what makes the number believable.",
    weight: 6,
  });

  // --- length --------------------------------------------------------------
  if (typeof pages === "number" && pages > 0) {
    const max = variant.maxPages ?? 0;
    add({
      id: "pages",
      label: "Fits the page budget",
      severity: !max || pages <= max ? "pass" : "fail",
      detail: `${pages} page${pages === 1 ? "" : "s"}${max ? ` against a ${max}-page limit` : ""}.`,
      fix: max && pages > max ? "Auto-fit could not get there. Deselect the weakest entries rather than shrinking the type further." : undefined,
      weight: 8,
    });
  }

  // --- unverified imports ---------------------------------------------------
  let unverified = 0;
  for (const key of Object.keys(SECTION_DEFS) as SectionKey[]) {
    for (const item of (db[key] as unknown as Record<string, unknown>[]) ?? []) {
      if (String(item.note ?? "").toLowerCase().includes("unverified") || /imported on \d{4}-\d{2}-\d{2}/i.test(String(item.note ?? ""))) unverified++;
    }
  }
  if (unverified) {
    add({
      id: "unverified",
      label: "Imported entries still unchecked",
      severity: "warn",
      detail: `${unverified} entries are still marked as imported and unverified.`,
      fix: "Read them once and clear the note. Anything you cannot defend in an interview should come off the resume.",
      weight: 4,
    });
  }

  // --- score ---------------------------------------------------------------
  // Half the score is the structural checklist, half is the mean bullet quality, so a
  // perfectly structured resume full of unmeasured bullets cannot score well — which is the
  // entire point of the framework.
  const totalWeight = checks.reduce((n, c) => n + c.weight, 0);
  const earned = checks.reduce((n, c) => n + c.weight * (c.severity === "pass" ? 1 : c.severity === "warn" ? 0.5 : 0), 0);
  const structural = totalWeight ? earned / totalWeight : 0;
  const quality = bullets.count ? bullets.average / 100 : 0;
  const score = Math.round((structural * 0.5 + quality * 0.5) * 100);

  return {
    score,
    grade: score >= 85 ? "excellent" : score >= 70 ? "good" : score >= 50 ? "needs-work" : "poor",
    stage,
    checks: checks.sort((a, b) => {
      const order = { fail: 0, warn: 1, pass: 2 };
      return order[a.severity] - order[b.severity] || b.weight - a.weight;
    }),
    bullets,
    weakBullets,
    totals: {
      items: variant.sections.reduce((n, s) => n + (s.enabled ? s.items.length : 0), 0),
      bullets: bullets.count,
      quantified: bullets.quantified,
      sections: variant.sections.filter((s) => s.enabled && s.items.length).length,
    },
  };
}

/** Audit a single item's bullets — used for the inline badges in the library editor. */
export function auditItem(item: { bullets?: Bullet[] }): BulletSummary {
  return summarize((item.bullets ?? []).filter((b) => b.text?.trim()).map((b) => b.text));
}

export { analyzeBullet };
