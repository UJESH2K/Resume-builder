import { XYZ_RULES } from "../quantify";
import { newBullet, uid } from "../sections";
import type { Bullet, Db, SectionKey } from "../types";
import { LlmError, parseJsonObject } from "./providers";

/**
 * "Paste everything about yourself and let it fill the library."
 *
 * Unlike the role tailor (which may only pick ids), this step does turn prose into entries —
 * so the guard rails are different and stricter:
 *
 *  * The model may only restructure facts present in the pasted text. The prompt forbids
 *    inventing dates, numbers, employers or metrics, and we never ask it for a "better"
 *    wording of an achievement.
 *  * We generate every id ourselves. Nothing the model says becomes an id.
 *  * Every field is clipped, every tag is checked against the known vocabulary, and every
 *    section is capped, so a runaway reply cannot bloat someone's library.
 *  * Everything imported is marked in `note` as unverified, and the student reviews and
 *    ticks each entry before it is saved.
 */

// ---------------------------------------------------------------- limits

const MAX = {
  label: 160,
  bullet: 300,
  bullets: 6,
  /**
   * Entries accepted per section per call.
   *
   * Was 12 across the board, which quietly truncated anyone with a real GitHub profile: a
   * student with 70 repositories got 12 projects and no explanation. The cap still exists —
   * a runaway reply must not be able to bloat a library — but it is now per *call*, and the
   * importer makes several calls over a chunked digest, so the ceiling on a whole import is
   * this times the number of chunks.
   */
  perSection: 25,
  skillItems: 400,
  summary: 300,
  /**
   * Text sent in one call. The importer splits anything longer into chunks of this size
   * rather than silently cutting the tail off, so this is a per-request budget and no longer
   * a limit on how much of a profile can be imported.
   */
  input: 14_000,
};

/**
 * Split a long digest into chunks the model can actually read.
 *
 * Cuts on the digest's own repo separators ("--- 7. project-name") wherever possible, so a
 * project's heading, description and README stay in one piece — a chunk that begins halfway
 * through a README is how you get an entry attributed to the wrong project. Falls back to
 * paragraph and then hard boundaries for text that has no separators, such as a plain paste.
 */
export function chunkInput(text: string, size = MAX.input): string[] {
  const clean = text.trim();
  if (clean.length <= size) return clean ? [clean] : [];

  // Prefer repo boundaries, then blank lines, then any newline.
  const boundary = /\n(?=--- \d+\. )/g.test(clean) ? /\n(?=--- \d+\. )/ : /\n\n+/;
  const parts = clean.split(boundary);

  const chunks: string[] = [];
  let current = "";
  for (const part of parts) {
    // A single part bigger than the budget (one enormous README) is cut on its own.
    if (part.length > size) {
      if (current.trim()) {
        chunks.push(current.trim());
        current = "";
      }
      for (let i = 0; i < part.length; i += size) chunks.push(part.slice(i, i + size).trim());
      continue;
    }
    if (current.length + part.length + 2 > size) {
      if (current.trim()) chunks.push(current.trim());
      current = part;
    } else {
      current = current ? `${current}\n\n${part}` : part;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

/** The tag vocabulary auto-selection understands. Anything else is dropped. */
const KNOWN_TAGS = new Set([
  "ai", "ml", "llm", "cv", "rag", "sde", "fullstack", "backend", "cloud",
  "systems", "distributed", "web3", "freelance", "data", "iot", "security",
  "mobile", "all",
]);

const str = (v: unknown, limit: number): string => {
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return "";
  const flat = v.replace(/\s+/g, " ").trim();
  return flat.length > limit ? flat.slice(0, limit - 1) + "…" : flat;
};

const tagList = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  const out = new Set<string>();
  for (const t of v) {
    if (typeof t !== "string") continue;
    const tag = t.toLowerCase().trim();
    if (KNOWN_TAGS.has(tag)) out.add(tag);
  }
  return [...out];
};

function bulletList(v: unknown): Bullet[] {
  if (!Array.isArray(v)) return [];
  const out: Bullet[] = [];
  for (const b of v.slice(0, MAX.bullets)) {
    // Accept a plain string or {text}.
    const text = str(typeof b === "string" ? b : (b as { text?: unknown })?.text, MAX.bullet);
    if (text) out.push({ ...newBullet(text), id: uid("b_") });
  }
  return out;
}

const rows = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.slice(0, MAX.perSection).filter((r) => r && typeof r === "object") as Record<string, unknown>[] : [];

/** A section's worth of text-only entries, accepting strings or {text}. */
function lineItems(v: unknown, prefix: string, note: string) {
  const list = Array.isArray(v) ? v.slice(0, MAX.perSection) : [];
  return list
    .map((raw) => {
      const rec = (typeof raw === "string" ? { text: raw } : raw) as Record<string, unknown>;
      const text = str(rec.text, MAX.summary);
      if (!text) return null;
      return {
        id: uid(prefix),
        text,
        link: str(rec.link, 300),
        tags: tagList(rec.tags),
        note,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

// ---------------------------------------------------------------- prompt

export const EXTRACT_SYSTEM = `You convert a student's own description of themselves into structured resume entries.

ABSOLUTE RULES:
1. Use ONLY facts stated in the text. If something is not stated, leave that field as "".
2. Never invent or estimate dates, numbers, percentages, company names, institutions, grades,
   team sizes or outcomes. No made-up metrics. If the text has no numbers, your output has none.
3. Do not embellish. Tidy grammar and make bullets concise, but keep the student's own claims
   and do not upgrade them (an "intern" does not become an "engineer").
4. Split distinct things into separate entries. One project per project.
5. If the text is not about a person's experience at all, return every section as an empty array.

HOW TO WRITE A BULLET — this is what separates a resume that gets read from one that does not.

${XYZ_RULES}

Rule 2 above outranks this entirely: the [Y] must be a number the text actually states. A repo
whose README says "trained on 5,000 labelled images" gives you 5,000. A repo that states no
number gives you no number, and you write the bullet without one. Never convert "a lot of
users" into "1,000+ users", never turn "fast" into a percentage, and never describe a project
as popular because it has stars unless the count is given.

Give each project and each role TWO TO FOUR bullets, not one. A single line per project wastes
the heading it costs. Draw them from different angles where the text supports it:
  - what it does and who for
  - the hard part of the build, and the technical decision behind it
  - scale, data, performance or reach — only where the text states it
  - what shipped: deployed, published, used by someone, won something

Put a thing in exactly one section.

Tag every entry using ONLY these tags (pick all that apply, or none):
ai, ml, llm, cv, rag, sde, fullstack, backend, cloud, systems, distributed, web3, freelance,
data, iot, security, mobile, all

Reply with JSON only, in exactly this shape. Every key is optional; use [] when there is nothing:
{
  "profile": { "name": "", "email": "", "phone": "", "linkedin": "", "github": "", "portfolio": "", "location": "" },
  "summary":   [{ "text": "" }],
  "education": [{ "institution": "", "degree": "", "start": "", "end": "", "score": "", "location": "", "bullets": [""], "tags": [] }],
  "experience":[{ "company": "", "role": "", "kind": "", "start": "", "end": "", "location": "", "bullets": [""], "tags": [] }],
  "projects":  [{ "name": "", "tech": "", "date": "", "codeLink": "", "liveLink": "", "bullets": [""], "tags": [] }],
  "skills":    [{ "category": "", "items": "", "tags": [] }],
  "publications":[{ "title": "", "authors": "", "venue": "", "status": "", "date": "", "bullets": [""], "tags": [] }],
  "awards":    [{ "title": "", "subtitle": "", "org": "", "date": "", "bullets": [""], "tags": [] }],
  "leadership":[{ "title": "", "subtitle": "", "org": "", "date": "", "bullets": [""], "tags": [] }],
  "achievements":  [{ "text": "", "link": "" }],
  "certifications":[{ "text": "", "link": "" }]
}

"skills" groups related technologies: category like "Languages" or "Cloud & DevOps", items a
comma-separated list. "kind" is Internship / Full-time / Freelance / Part-time.`;

export function buildExtractPrompt(text: string): string {
  const clipped = text.length > MAX.input ? text.slice(0, MAX.input) : text;
  return `TEXT THE STUDENT PASTED:\n"""\n${clipped}\n"""`;
}

// ---------------------------------------------------------------- parsing

export interface Extracted {
  profile: Partial<Db["profile"]>;
  sections: { key: SectionKey; items: Record<string, unknown>[] }[];
  /** Total entries across all sections. */
  count: number;
}

export function parseExtraction(raw: string): Extracted {
  const obj = parseJsonObject(raw) as Record<string, unknown>;
  const note = `Imported on ${new Date().toISOString().slice(0, 10)} from pasted text — check the details.`;

  const profileRaw = (obj.profile ?? {}) as Record<string, unknown>;
  const profile: Partial<Db["profile"]> = {
    name: str(profileRaw.name, 100),
    email: str(profileRaw.email, 120),
    phone: str(profileRaw.phone, 40),
    linkedin: str(profileRaw.linkedin, 300),
    github: str(profileRaw.github, 300),
    portfolio: str(profileRaw.portfolio, 300),
    location: str(profileRaw.location, 100),
  };

  const sections: Extracted["sections"] = [];
  const push = (key: SectionKey, items: Record<string, unknown>[]) => {
    if (items.length) sections.push({ key, items });
  };

  push("summary", lineItems(obj.summary, "sum_", note));

  push(
    "education",
    rows(obj.education)
      .map((r) => ({
        id: uid("edu_"),
        institution: str(r.institution, MAX.label),
        degree: str(r.degree, MAX.label),
        start: str(r.start, 40),
        end: str(r.end, 40),
        score: str(r.score, 60),
        location: str(r.location, 80),
        bullets: bulletList(r.bullets),
        tags: tagList(r.tags),
        note,
      }))
      .filter((r) => r.institution || r.degree)
  );

  push(
    "experience",
    rows(obj.experience)
      .map((r) => ({
        id: uid("exp_"),
        company: str(r.company, MAX.label),
        companyLink: "",
        role: str(r.role, MAX.label),
        kind: str(r.kind, 40),
        start: str(r.start, 40),
        end: str(r.end, 40),
        location: str(r.location, 80),
        bullets: bulletList(r.bullets),
        tags: tagList(r.tags),
        note,
      }))
      .filter((r) => r.company || r.role)
  );

  push(
    "skills",
    rows(obj.skills)
      .map((r) => ({
        id: uid("skill_"),
        category: str(r.category, 80),
        items: str(r.items, MAX.skillItems),
        tags: tagList(r.tags),
        note,
      }))
      .filter((r) => r.category && r.items)
  );

  push(
    "projects",
    rows(obj.projects)
      .map((r) => ({
        id: uid("proj_"),
        name: str(r.name, MAX.label),
        tech: str(r.tech, MAX.label),
        date: str(r.date, 40),
        codeLink: str(r.codeLink, 300),
        liveLink: str(r.liveLink, 300),
        bullets: bulletList(r.bullets),
        tags: tagList(r.tags),
        note,
      }))
      .filter((r) => r.name)
  );

  push(
    "publications",
    rows(obj.publications)
      .map((r) => ({
        id: uid("pub_"),
        title: str(r.title, MAX.label),
        authors: str(r.authors, MAX.label),
        venue: str(r.venue, MAX.label),
        status: str(r.status, 60),
        date: str(r.date, 40),
        link: "",
        linkLabel: "",
        bullets: bulletList(r.bullets),
        tags: tagList(r.tags),
        note,
      }))
      .filter((r) => r.title)
  );

  for (const key of ["leadership", "awards"] as const) {
    push(
      key,
      rows(obj[key])
        .map((r) => ({
          id: uid(key === "awards" ? "award_" : "lead_"),
          title: str(r.title, MAX.label),
          link: "",
          date: str(r.date, 40),
          subtitle: str(r.subtitle, MAX.label),
          org: str(r.org, MAX.label),
          bullets: bulletList(r.bullets),
          tags: tagList(r.tags),
          note,
        }))
        .filter((r) => r.title)
    );
  }

  push("achievements", lineItems(obj.achievements, "ach_", note));
  push("certifications", lineItems(obj.certifications, "cert_", note));

  const count = sections.reduce((n, s) => n + s.items.length, 0);
  if (count === 0 && !profile.name) {
    throw new LlmError(
      "Nothing usable came back. Try pasting more detail about your education, projects and skills."
    );
  }
  return { profile, sections, count };
}

/**
 * Fold the results of several chunk calls into one review list.
 *
 * Chunks overlap in practice — a profile README mentions projects that also have their own
 * repos, and a student's paste often repeats what GitHub already said — so entries are
 * deduplicated on the same normalised label the duplicate check uses against the library.
 * Where two chunks describe the same thing, the one with more bullets wins, since that is the
 * one that had the fuller source text.
 *
 * Profile fields take the first non-empty value seen: the earliest chunk is the highest
 * ranked repo and the student's own paste, both better sources than a tail README.
 */
export function mergeExtractions(parts: Extracted[]): Extracted {
  const profile: Partial<Db["profile"]> = {};
  for (const part of parts) {
    for (const [k, v] of Object.entries(part.profile)) {
      const key = k as keyof Db["profile"];
      if (v && !String(profile[key] ?? "").trim()) profile[key] = v as string;
    }
  }

  const bySection = new Map<SectionKey, Map<string, Record<string, unknown>>>();
  for (const part of parts) {
    for (const { key, items } of part.sections) {
      const bucket = bySection.get(key) ?? new Map<string, Record<string, unknown>>();
      for (const item of items) {
        const label = norm(previewLabel(key, item));
        // No usable label to compare on: keep it, keyed by its own id, rather than drop it.
        const dedupeKey = label || `id:${String(item.id)}`;
        const existing = bucket.get(dedupeKey);
        if (!existing) {
          bucket.set(dedupeKey, item);
          continue;
        }
        const bulletsOf = (x: Record<string, unknown>) => ((x.bullets as Bullet[] | undefined) ?? []).length;
        if (bulletsOf(item) > bulletsOf(existing)) bucket.set(dedupeKey, item);
      }
      bySection.set(key, bucket);
    }
  }

  const sections: Extracted["sections"] = [];
  for (const [key, bucket] of bySection) {
    const items = [...bucket.values()];
    if (items.length) sections.push({ key, items });
  }

  return { profile, sections, count: sections.reduce((n, s) => n + s.items.length, 0) };
}

// ---------------------------------------------------------------- merging

/** A short human label for the review list, and for spotting duplicates. */
export function previewLabel(key: SectionKey, item: Record<string, unknown>): string {
  const s = (k: string) => String(item[k] ?? "").trim();
  switch (key) {
    case "education":
      return [s("degree"), s("institution")].filter(Boolean).join(" · ");
    case "experience":
      return [s("role"), s("company")].filter(Boolean).join(" at ");
    case "projects":
      return s("name");
    case "skills":
      return `${s("category")}: ${s("items")}`;
    case "publications":
    case "awards":
    case "leadership":
      return [s("title"), s("org")].filter(Boolean).join(" · ");
    default:
      return s("text");
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Does the library already have something that looks like this? */
export function looksDuplicate(db: Db, key: SectionKey, item: Record<string, unknown>): boolean {
  const target = norm(previewLabel(key, item));
  if (!target) return false;
  const existing = db[key] as unknown as Record<string, unknown>[];
  return (existing ?? []).some((e) => {
    const label = norm(previewLabel(key, e));
    return label === target || (label.length > 8 && target.length > 8 && (label.includes(target) || target.includes(label)));
  });
}

/**
 * Append the ticked entries to the library.
 *
 * Profile fields are only filled where the student has left them blank — an import must never
 * overwrite a name or phone number they typed themselves.
 */
export function mergeIntoLibrary(
  db: Db,
  extracted: Extracted,
  accepted: Set<string>,
  takeProfile: boolean
): { added: number } {
  let added = 0;

  for (const { key, items } of extracted.sections) {
    const target = db[key] as unknown as Record<string, unknown>[];
    if (!Array.isArray(target)) continue;
    for (const item of items) {
      if (!accepted.has(String(item.id))) continue;
      target.push(item);
      added++;
    }
  }

  if (takeProfile) {
    for (const [field, value] of Object.entries(extracted.profile)) {
      const k = field as keyof Db["profile"];
      if (value && !String(db.profile[k] ?? "").trim()) db.profile[k] = value as string;
    }
  }

  return { added };
}
