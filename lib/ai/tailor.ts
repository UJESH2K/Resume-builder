import type { JobRole } from "../roles";
import { summarize } from "../quantify";
import { itemsOf, normalizeVariant, SECTION_ORDER, selectByTags } from "../sections";
import type { Bullet, Db, SectionKey, Variant } from "../types";
import { LlmError, parseJsonObject } from "./providers";

/**
 * Turning a library into a role-specific resume.
 *
 * The model's job is narrow on purpose: **choose and order existing entries**. It cannot write
 * resume text, invent achievements or edit a bullet, because it only ever returns ids that we
 * check against the library. Anything it makes up is dropped. That keeps a student's resume
 * truthful even with a small free model behind it, and it keeps the deterministic parts of the
 * app (auto-fit, LaTeX) exactly as they were.
 */

// ---------------------------------------------------------------- digest

/** How much of a bullet the model sees. Enough to judge relevance, short enough to be cheap. */
const BULLET_CHARS = 180;
const LABEL_CHARS = 140;

const clip = (s: string, n: number) => {
  const flat = (s ?? "").replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};

/** A one-line description of an item, whatever section it is from. */
export function labelOf(key: SectionKey, item: Record<string, unknown>): string {
  const s = (k: string) => String(item[k] ?? "").trim();
  const dates = [s("start"), s("end")].filter(Boolean).join("–") || s("date");

  switch (key) {
    case "education":
      return clip([s("degree"), s("institution"), s("score"), dates].filter(Boolean).join(" · "), LABEL_CHARS);
    case "experience":
      return clip(
        [[s("role"), s("company")].filter(Boolean).join(" at "), s("kind"), dates].filter(Boolean).join(" · "),
        LABEL_CHARS
      );
    case "projects":
      return clip([s("name"), s("tech"), dates].filter(Boolean).join(" · "), LABEL_CHARS);
    case "publications":
      return clip([s("title"), s("venue"), s("status"), dates].filter(Boolean).join(" · "), LABEL_CHARS);
    case "skills":
      return clip(`${s("category")}: ${s("items")}`, LABEL_CHARS);
    case "awards":
    case "leadership":
      return clip([s("title"), s("subtitle"), s("org"), dates].filter(Boolean).join(" · "), LABEL_CHARS);
    default:
      // summary, achievements, certifications
      return clip(s("text"), LABEL_CHARS);
  }
}

interface DigestItem {
  id: string;
  what: string;
  tags: string[];
  bullets?: { id: string; text: string }[];
}

export interface Digest {
  sections: { key: SectionKey; count: number; items: DigestItem[] }[];
}

/** Everything the model needs to choose, and nothing else. No contact details are sent. */
export function buildDigest(db: Db): Digest {
  const sections = SECTION_ORDER.map((key) => {
    const items = itemsOf(db, key).map((item) => {
      const rec = item as unknown as Record<string, unknown>;
      const bullets = (rec.bullets as Bullet[] | undefined)?.map((b) => ({
        id: b.id,
        text: clip(b.text, BULLET_CHARS),
      }));
      const entry: DigestItem = {
        id: item.id,
        what: labelOf(key, rec),
        tags: item.tags ?? [],
      };
      if (bullets?.length) entry.bullets = bullets;
      return entry;
    });
    return { key, count: items.length, items };
  });
  return { sections: sections.filter((s) => s.count > 0) };
}

// ---------------------------------------------------------------- prompt

export const SYSTEM_PROMPT = `You are a technical recruiter helping an engineering student aim one resume at one job role.

You are given the student's complete library of entries, each with a stable id, and a target role.
Choose which entries belong on this resume, in what order, and which individual bullet points to hide.

Rules, in order of importance:
1. Only ever use ids that appear in the library. Never invent an id.
2. Never write, rewrite or summarise resume text. You are selecting, not authoring.
3. Order each section most relevant first — the top entry is what gets read.
4. Respect the page budget. Fewer, stronger entries beat a complete list.
5. Never drop education. Never drop publications when the role is research or AI/ML.
6. Hide a bullet only when it is irrelevant to this role or purely repetitive. If an entry has
   nothing left worth showing, leave it out of "items" instead of hiding all its bullets.
7. Keep every skills group that the role touches; drop groups that are clearly unrelated.

Reply with JSON only, in exactly this shape:
{
  "sections": [{ "key": "experience", "items": ["id1", "id2"] }],
  "hideBullets": ["bulletId1"],
  "notes": "one short sentence on what you prioritised"
}

Include an entry in "sections" for every section you want on the resume, using the section keys
given in the library. Omit a section entirely to leave it as it is. "hideBullets" and "notes" may
be empty.`;

export function buildUserPrompt(digest: Digest, role: JobRole, pageBudget: number): string {
  return [
    `TARGET ROLE: ${role.label}`,
    `WHAT MATTERS FOR THIS ROLE: ${role.focus}`,
    `PAGE BUDGET: ${pageBudget} page${pageBudget === 1 ? "" : "s"}.`,
    "",
    "STUDENT'S LIBRARY:",
    JSON.stringify(digest, null, 1),
  ].join("\n");
}

// ---------------------------------------------------------------- the plan

export interface TailorPlan {
  sections: { key: SectionKey; items: string[] }[];
  hideBullets: string[];
  notes: string;
}

/** Read the model's reply defensively: anything unexpected is ignored, not fatal. */
export function parsePlan(raw: string): TailorPlan {
  const obj = parseJsonObject(raw) as Record<string, unknown>;

  const sections: TailorPlan["sections"] = [];
  const rawSections = obj.sections;
  if (Array.isArray(rawSections)) {
    for (const s of rawSections) {
      const sec = s as Record<string, unknown>;
      const key = typeof sec.key === "string" ? (sec.key as SectionKey) : null;
      if (!key) continue;
      const items = Array.isArray(sec.items) ? sec.items.filter((i): i is string => typeof i === "string") : [];
      sections.push({ key, items });
    }
  } else if (rawSections && typeof rawSections === "object") {
    // Some models return an object keyed by section instead of an array.
    for (const [key, value] of Object.entries(rawSections)) {
      const items = Array.isArray(value) ? value.filter((i): i is string => typeof i === "string") : [];
      sections.push({ key: key as SectionKey, items });
    }
  }

  const hideBullets = Array.isArray(obj.hideBullets)
    ? obj.hideBullets.filter((i): i is string => typeof i === "string")
    : [];

  if (!sections.length) {
    throw new LlmError("The model did not choose any entries. Try again, or use a stronger model.");
  }

  return { sections, hideBullets, notes: typeof obj.notes === "string" ? obj.notes : "" };
}

/**
 * How many entries per section a resume of N pages can actually carry.
 *
 * Without this, broad role tags select almost the whole library and the auto-fit ladder has
 * to claw it back — measured at 9-12 pdflatex runs and ~10s for a one-page budget, ending in
 * "one bullet each", which reads terribly. Choosing well up front gets the same resume in
 * ~2 runs and leaves the bullets intact. It also cuts server CPU per student by about 4x.
 */
const CAPS: Record<number, Partial<Record<SectionKey, number>>> = {
  1: {
    summary: 1,
    education: 2,
    experience: 2,
    skills: 3,
    projects: 2,
    publications: 1,
    leadership: 1,
    achievements: 2,
    certifications: 1,
    awards: 2,
  },
  2: {
    summary: 1,
    education: 3,
    experience: 4,
    skills: 6,
    projects: 5,
    publications: 4,
    leadership: 3,
    achievements: 5,
    certifications: 4,
    awards: 4,
  },
};

/** Education is never trimmed to nothing, whatever the budget says. */
const FLOOR: Partial<Record<SectionKey, number>> = { education: 1 };

/**
 * Relevance of one item to the role: how many of its tags the role asks for.
 * `all` means "every resume needs this", so it ranks above an incidental single match.
 */
function score(tags: string[], roleTags: string[]): number {
  if (tags.includes("all")) return 100;
  return tags.filter((t) => roleTags.includes(t)).length;
}

/**
 * How well an entry is written, as a tie-breaker when trimming.
 *
 * Relevance decides first — a tagged match beats a polished irrelevance — but two entries are
 * often equally relevant, and then the one whose bullets carry measures is the better thing
 * to put on the page. This is the one place the quantification engine changes what a resume
 * contains rather than just reporting on it, and it is a reordering only: an entry is never
 * dropped for being badly written while a relevant slot is free.
 *
 * Returned on a 0-1 scale so it can only ever break a tie in the integer relevance score.
 */
function writingQuality(item: Record<string, unknown> | undefined): number {
  const bullets = ((item?.bullets as { text?: string }[] | undefined) ?? [])
    .map((b) => String(b?.text ?? ""))
    .filter(Boolean);
  if (!bullets.length) return 0;
  return summarize(bullets).average / 100;
}

/**
 * Keep the best `cap` entries per section, most relevant first.
 *
 * Ties keep the library's own order, which the student curated. When ids are already ordered
 * by a model we leave that order alone and only truncate, so the model's judgement survives.
 */
function trimToBudget(db: Db, variant: Variant, roleTags: string[], pages: number, preserveOrder: Set<SectionKey>): Variant {
  const caps = CAPS[pages];
  if (!caps) return variant; // 3+ pages: no trimming

  return {
    ...variant,
    sections: variant.sections.map((s) => {
      const cap = Math.max(caps[s.key] ?? Infinity, FLOOR[s.key] ?? 0);
      if (!Number.isFinite(cap) || s.items.length <= cap) return s;

      let ordered = s.items;
      if (!preserveOrder.has(s.key)) {
        const byId = new Map(itemsOf(db, s.key).map((i) => [i.id, i]));
        ordered = s.items
          .map((id, i) => {
            const item = byId.get(id);
            return {
              id,
              i,
              sc: score(item?.tags ?? [], roleTags),
              q: writingQuality(item as unknown as Record<string, unknown>),
            };
          })
          // Relevance, then how well it is written, then the student's own order.
          .sort((a, b) => b.sc - a.sc || b.q - a.q || a.i - b.i)
          .map((x) => x.id);
      }
      const items = ordered.slice(0, cap);
      return { ...s, items, enabled: items.length > 0 };
    }),
  };
}

export interface AppliedPlan {
  variant: Variant;
  /** What we had to ignore — surfaced so a bad model is visible rather than silent. */
  droppedIds: string[];
  unknownSections: string[];
  notes: string;
}

/**
 * Build the final variant.
 *
 * The deterministic tag selection is the floor: we start from it, then let the plan override
 * the sections it actually spoke about. So a model that returns half an answer, or an empty
 * section, still leaves the student with a sane resume rather than a blank one.
 */
export function applyPlan(db: Db, base: Variant, role: JobRole, plan: TailorPlan | null): AppliedPlan {
  const withRole: Variant = {
    ...base,
    targetTags: role.tags,
    maxPages: role.maxPages,
    accent: role.accent,
  };

  // Floor: everything matching the role's tags.
  let variant = selectByTags(db, withRole);
  const droppedIds: string[] = [];
  const unknownSections: string[] = [];
  /** Sections the model ordered itself — trimming must not re-sort those. */
  let preserveOrder = new Set<SectionKey>();

  if (plan) {
    const valid = new Map<SectionKey, Set<string>>();
    for (const s of variant.sections) valid.set(s.key, new Set(itemsOf(db, s.key).map((i) => i.id)));

    const chosen = new Map<SectionKey, string[]>();
    for (const sec of plan.sections) {
      const allowed = valid.get(sec.key);
      if (!allowed) {
        unknownSections.push(sec.key);
        continue;
      }
      const seen = new Set<string>();
      const items: string[] = [];
      for (const id of sec.items) {
        if (!allowed.has(id)) {
          droppedIds.push(id);
          continue;
        }
        if (seen.has(id)) continue;
        seen.add(id);
        items.push(id);
      }
      chosen.set(sec.key, items);
    }

    variant = {
      ...variant,
      sections: variant.sections.map((s) => {
        const items = chosen.get(s.key);
        // A section the model did not mention keeps its tag-based selection.
        if (!items) return s;
        return { ...s, items, enabled: items.length > 0 };
      }),
    };

    preserveOrder = new Set(chosen.keys());
  }

  // Fit the page budget by choosing well, rather than leaving it all to the auto-fit ladder.
  variant = trimToBudget(db, variant, role.tags, role.maxPages, preserveOrder);

  // Hide only bullets that exist AND belong to an entry that survived the trim.
  const selectable = new Set<string>();
  for (const s of variant.sections) {
    if (!s.enabled) continue;
    const byId = new Map(itemsOf(db, s.key).map((i) => [i.id, i]));
    for (const id of s.items) {
      const item = byId.get(id) as unknown as { bullets?: Bullet[] } | undefined;
      for (const b of item?.bullets ?? []) selectable.add(b.id);
    }
  }
  const wanted = plan ? plan.hideBullets : variant.hiddenBullets;
  const keep = new Set<string>();
  for (const id of wanted) {
    if (selectable.has(id)) keep.add(id);
    else if (plan) droppedIds.push(id);
  }

  // Refuse to hide every bullet of an entry — that prints a bare heading.
  for (const s of variant.sections) {
    if (!s.enabled) continue;
    const byId = new Map(itemsOf(db, s.key).map((i) => [i.id, i]));
    for (const id of s.items) {
      const bullets = (byId.get(id) as unknown as { bullets?: Bullet[] } | undefined)?.bullets ?? [];
      if (bullets.length && bullets.every((b) => keep.has(b.id))) {
        for (const b of bullets) keep.delete(b.id);
      }
    }
  }
  variant = { ...variant, hiddenBullets: [...keep] };

  return {
    variant: normalizeVariant(db, variant),
    droppedIds,
    unknownSections,
    notes: plan?.notes ?? "",
  };
}

/** Rough token estimate so the UI can warn before a tiny free model chokes on a big library. */
export const estimateTokens = (digest: Digest): number =>
  Math.ceil((SYSTEM_PROMPT.length + JSON.stringify(digest).length) / 4);
