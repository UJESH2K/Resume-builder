import type { AnyItem, Bullet, Db, SectionKey, Variant } from "./types";

export type FieldType = "text" | "textarea" | "bullets" | "tags";

export interface Field {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  half?: boolean;
}

export interface SectionDef {
  key: SectionKey;
  label: string;
  defaultTitle: string;
  fields: Field[];
  summary: (item: any) => string;
  sub: (item: any) => string;
  blank: () => any;
}

export const uid = (prefix = "") =>
  prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);

export const newBullet = (text = ""): Bullet => ({ id: uid("b_"), text });

const tagsField: Field = { key: "tags", label: "Tags (used to auto-select per role)", type: "tags" };
const noteField: Field = {
  key: "note",
  label: "Private note (never printed)",
  type: "textarea",
  placeholder: "Reminders, metrics to verify, context for later…",
};
const bulletsField: Field = { key: "bullets", label: "Bullet points", type: "bullets" };

const dates = (i: any) => [i.start, i.end].filter(Boolean).join(" – ") || i.date || "";

export const SECTION_DEFS: Record<SectionKey, SectionDef> = {
  summary: {
    key: "summary",
    label: "Summary",
    defaultTitle: "Summary",
    fields: [
      { key: "text", label: "Summary paragraph", type: "textarea" },
      tagsField,
      noteField,
    ],
    summary: (i) => (i.text ? i.text.slice(0, 70) + (i.text.length > 70 ? "…" : "") : "Empty summary"),
    sub: () => "",
    blank: () => ({ id: uid("sum_"), text: "", tags: [] }),
  },
  education: {
    key: "education",
    label: "Education",
    defaultTitle: "Education",
    fields: [
      { key: "institution", label: "Institution", type: "text" },
      { key: "link", label: "Institution link (optional)", type: "text", placeholder: "https://..." },
      { key: "degree", label: "Degree", type: "text", placeholder: "B.Tech in Computer Science & Engineering" },
      { key: "score", label: "CGPA / Score", type: "text", placeholder: "7.7/10 CGPA", half: true },
      { key: "location", label: "Location", type: "text", half: true },
      { key: "start", label: "Start", type: "text", placeholder: "2022", half: true },
      { key: "end", label: "End", type: "text", placeholder: "2026", half: true },
      bulletsField,
      tagsField,
      noteField,
    ],
    summary: (i) => i.institution || "Untitled institution",
    sub: (i) => [i.degree, i.score, dates(i)].filter(Boolean).join(" · "),
    blank: () => ({ id: uid("edu_"), institution: "", link: "", degree: "", start: "", end: "", score: "", location: "", bullets: [], tags: [] }),
  },
  experience: {
    key: "experience",
    label: "Experience",
    defaultTitle: "Work Experience",
    fields: [
      { key: "company", label: "Company / Organisation", type: "text" },
      { key: "companyLink", label: "Company link (optional)", type: "text", placeholder: "https://…" },
      { key: "role", label: "Role", type: "text", half: true },
      { key: "kind", label: "Type", type: "text", placeholder: "Internship / Full-time / Freelance", half: true },
      { key: "start", label: "Start", type: "text", placeholder: "May 2025", half: true },
      { key: "end", label: "End", type: "text", placeholder: "Present", half: true },
      { key: "location", label: "Location", type: "text", placeholder: "Remote / Bangalore" },
      bulletsField,
      tagsField,
      noteField,
    ],
    summary: (i) => [i.role, i.company].filter(Boolean).join(" @ ") || "Untitled role",
    sub: (i) => [i.kind, dates(i)].filter(Boolean).join(" · "),
    blank: () => ({ id: uid("exp_"), company: "", companyLink: "", role: "", kind: "Internship", start: "", end: "", location: "", bullets: [], tags: [] }),
  },
  projects: {
    key: "projects",
    label: "Projects",
    defaultTitle: "Projects",
    fields: [
      { key: "name", label: "Project name", type: "text", half: true },
      { key: "date", label: "Date (optional)", type: "text", placeholder: "Aug 2026", half: true },
      { key: "tech", label: "Tech stack line", type: "text", placeholder: "Python, FastAPI, PyTorch, Next.js" },
      { key: "codeLink", label: "Source code link", type: "text", half: true },
      { key: "liveLink", label: "Live / demo link", type: "text", half: true },
      bulletsField,
      tagsField,
      noteField,
    ],
    summary: (i) => i.name || "Untitled project",
    sub: (i) => i.tech,
    blank: () => ({ id: uid("proj_"), name: "", tech: "", date: "", codeLink: "", liveLink: "", bullets: [], tags: [] }),
  },
  publications: {
    key: "publications",
    label: "Publications",
    defaultTitle: "Research & Publications",
    fields: [
      { key: "title", label: "Paper title", type: "textarea" },
      { key: "authors", label: "Authors (put your own name in **bold**)", type: "text" },
      { key: "venue", label: "Conference / journal / workshop", type: "text", half: true },
      { key: "status", label: "Status", type: "text", placeholder: "Accepted / Under review / Published", half: true },
      { key: "date", label: "Date", type: "text", placeholder: "Oct 2026", half: true },
      { key: "link", label: "Link (DOI, arXiv, PDF)", type: "text", half: true },
      { key: "linkLabel", label: "Link text", type: "text", placeholder: "Paper", half: true },
      bulletsField,
      tagsField,
      noteField,
    ],
    summary: (i) => i.title || "Untitled paper",
    sub: (i) => [i.venue, i.status, i.date].filter(Boolean).join(" · "),
    blank: () => ({
      id: uid("pub_"),
      title: "",
      authors: "",
      venue: "",
      status: "",
      date: "",
      link: "",
      linkLabel: "Paper",
      bullets: [],
      tags: [],
    }),
  },
  skills: {
    key: "skills",
    label: "Skills",
    defaultTitle: "Technical Skills",
    fields: [
      { key: "category", label: "Category", type: "text", placeholder: "Languages" },
      { key: "items", label: "Items (comma separated)", type: "textarea", placeholder: "Python, C++, TypeScript" },
      tagsField,
      noteField,
    ],
    summary: (i) => i.category || "Untitled group",
    sub: (i) => i.items,
    blank: () => ({ id: uid("sk_"), category: "", items: "", tags: [] }),
  },
  awards: {
    key: "awards",
    label: "Honours & Awards",
    defaultTitle: "Honours and Awards",
    fields: [
      { key: "title", label: "Title", type: "text", half: true },
      { key: "date", label: "Date", type: "text", half: true },
      { key: "subtitle", label: "Subtitle (italic, left)", type: "text", placeholder: "Winner · Team of 4", half: true },
      { key: "org", label: "Organiser (italic, right)", type: "text", half: true },
      { key: "link", label: "Link (optional)", type: "text" },
      bulletsField,
      tagsField,
      noteField,
    ],
    summary: (i) => i.title || "Untitled award",
    sub: (i) => [i.org, i.date].filter(Boolean).join(" · "),
    blank: () => ({ id: uid("aw_"), title: "", link: "", date: "", subtitle: "", org: "", bullets: [], tags: [] }),
  },
  achievements: {
    key: "achievements",
    label: "Achievements",
    defaultTitle: "Achievements",
    fields: [
      { key: "text", label: "Achievement (one line)", type: "textarea" },
      { key: "link", label: "Link (optional)", type: "text", placeholder: "https://...", half: true },
      { key: "linkLabel", label: "Link text", type: "text", placeholder: "View", half: true },
      tagsField,
      noteField,
    ],
    summary: (i) => i.text || "Empty achievement",
    sub: () => "",
    blank: () => ({ id: uid("ach_"), text: "", link: "", linkLabel: "", tags: [] }),
  },
  leadership: {
    key: "leadership",
    label: "Leadership",
    defaultTitle: "Leadership",
    fields: [
      { key: "title", label: "Role — Organisation", type: "text", half: true },
      { key: "date", label: "Date", type: "text", half: true },
      { key: "subtitle", label: "Subtitle (italic, left)", type: "text", half: true },
      { key: "org", label: "Right-side italic text", type: "text", half: true },
      { key: "link", label: "Link (optional)", type: "text" },
      bulletsField,
      tagsField,
      noteField,
    ],
    summary: (i) => i.title || "Untitled role",
    sub: (i) => [i.org, i.date].filter(Boolean).join(" · "),
    blank: () => ({ id: uid("lead_"), title: "", link: "", date: "", subtitle: "", org: "", bullets: [], tags: [] }),
  },
  certifications: {
    key: "certifications",
    label: "Certifications",
    defaultTitle: "Certifications",
    fields: [
      { key: "text", label: "Certification (one line)", type: "textarea" },
      { key: "link", label: "Credential link (optional)", type: "text", placeholder: "https://...", half: true },
      { key: "linkLabel", label: "Link text", type: "text", placeholder: "Credential", half: true },
      tagsField,
      noteField,
    ],
    summary: (i) => i.text || "Empty certification",
    sub: () => "",
    blank: () => ({ id: uid("cert_"), text: "", link: "", linkLabel: "", tags: [] }),
  },
};

/** Industry-standard order: summary, education, experience, skills, projects, then the extras. */
export const SECTION_ORDER: SectionKey[] = [
  "summary",
  "education",
  "experience",
  "skills",
  "projects",
  "publications",
  "leadership",
  "achievements",
  "certifications",
  "awards",
];

export const ACCENTS: { name: string; hex: string }[] = [
  { name: "Navy", hex: "1F3A5F" },
  { name: "Royal", hex: "2B4C9B" },
  { name: "Teal", hex: "0F5E63" },
  { name: "Forest", hex: "22543D" },
  { name: "Plum", hex: "553C7B" },
  { name: "Charcoal", hex: "2D2D2D" },
  { name: "Template red", hex: "B6321C" },
];

export const itemsOf = (db: Db, key: SectionKey): AnyItem[] => db[key] as AnyItem[];

export function allTags(db: Db): string[] {
  const s = new Set<string>();
  for (const k of SECTION_ORDER) for (const it of itemsOf(db, k)) for (const t of it.tags ?? []) s.add(t);
  for (const v of db.variants) for (const t of v.targetTags) s.add(t);
  return [...s].sort();
}

export function blankVariant(db: Db, name = "New variant"): Variant {
  return {
    id: uid("v_"),
    name,
    description: "",
    targetTags: [],
    accent: ACCENTS[0].hex,
    fontSize: "11pt",
    paper: "letterpaper",
    maxPages: 2,
    hiddenBullets: [],
    sections: SECTION_ORDER.map((key) => ({
      key,
      title: SECTION_DEFS[key].defaultTitle,
      enabled: itemsOf(db, key).length > 0,
      items: [],
    })),
  };
}

/** Make sure a variant has an entry for every section and no dangling ids. */
export function normalizeVariant(db: Db, v: Variant): Variant {
  const present = new Set(v.sections.map((s) => s.key));
  const sections = [...v.sections];
  // A section added to the app later slots into its standard position, not onto the end.
  for (const key of SECTION_ORDER) {
    if (present.has(key)) continue;
    const blank = { key, title: SECTION_DEFS[key].defaultTitle, enabled: false, items: [] as string[] };
    const after = SECTION_ORDER.slice(0, SECTION_ORDER.indexOf(key));
    let at = sections.length;
    for (let i = 0; i < sections.length; i++)
      if (!after.includes(sections[i].key)) {
        at = i;
        break;
      }
    sections.splice(at, 0, blank);
  }
  const normalised = sections.map((s) => {
    const ids = new Set(itemsOf(db, s.key).map((i) => i.id));
    return { ...s, items: s.items.filter((id) => ids.has(id)) };
  });
  return { ...v, sections: normalised };
}

/** Items tagged "all" always match; otherwise any overlap with the variant's target tags. */
export function matchesTags(item: AnyItem, target: string[]): boolean {
  const tags = item.tags ?? [];
  if (tags.includes("all")) return true;
  return target.some((t) => tags.includes(t));
}

const bulletMatches = (b: Bullet, target: string[]) =>
  !b.tags?.length || !target.length || b.tags.includes("all") || target.some((t) => b.tags!.includes(t));

/**
 * Replace each section's selection with every item matching the variant's target tags (keeps library order),
 * and hide tagged bullets that don't match. Summary picks only the first match.
 */
export function selectByTags(db: Db, v: Variant): Variant {
  const hidden: string[] = [];
  const sections = v.sections.map((s) => {
    let matched = itemsOf(db, s.key).filter((i) => (v.targetTags.length ? matchesTags(i, v.targetTags) : true));
    if (s.key === "summary") matched = matched.slice(0, 1);
    for (const it of matched)
      for (const b of (it as { bullets?: Bullet[] }).bullets ?? []) if (!bulletMatches(b, v.targetTags)) hidden.push(b.id);
    const items = matched.map((i) => i.id);
    return { ...s, items, enabled: items.length > 0 };
  });
  return { ...v, sections, hiddenBullets: hidden };
}
