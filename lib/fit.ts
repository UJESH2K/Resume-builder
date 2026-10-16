import type { Bullet, Db, SectionKey, Variant } from "./types";

/**
 * Auto-fit: make a resume respect a hard page limit.
 *
 * The ladder goes from harmless to lossy. Typography is squeezed first; content is only
 * removed once spacing and font size cannot buy enough room. Everything here is deterministic —
 * no model involved — so the same library always produces the same PDF.
 */
export interface FitStep {
  label: string;
  fontSize?: "10pt" | "11pt";
  linespread?: number;
  extraHeight?: number; // inches added to \textheight
  bulletCap?: number; // max bullets per entry in CAPPABLE sections
  hardBulletCap?: number; // max bullets per entry EVERYWHERE (last resort)
  drop?: number; // how many low-priority entries to hide
}

export interface FitResult {
  variant: Variant;
  step: FitStep;
  notes: string[];
}

/** Bullets here can be shortened before anything is dropped. */
const CAPPABLE: SectionKey[] = ["projects", "leadership"];

/** Entries are hidden from the end of these sections, in this order. Never education/experience/publications. */
const DROP_ORDER: { key: SectionKey; keep: number }[] = [
  { key: "projects", keep: 2 },
  { key: "certifications", keep: 0 },
  { key: "awards", keep: 0 },
  { key: "leadership", keep: 1 },
  { key: "achievements", keep: 3 },
  { key: "projects", keep: 1 }, // second pass: go below the comfortable floor
];

export const LADDER: FitStep[] = [
  { label: "as written" },
  { label: "tighter spacing", linespread: 0.98, extraHeight: 0.25 },
  { label: "tightest spacing", linespread: 0.96, extraHeight: 0.45 },
  { label: "10pt", fontSize: "10pt", linespread: 0.98, extraHeight: 0.3 },
  { label: "10pt, tightest spacing", fontSize: "10pt", linespread: 0.96, extraHeight: 0.5 },
  { label: "10pt, max 4 bullets per project", fontSize: "10pt", linespread: 0.96, extraHeight: 0.5, bulletCap: 4 },
  { label: "10pt, max 3 bullets per project", fontSize: "10pt", linespread: 0.96, extraHeight: 0.5, bulletCap: 3 },
];

/** Steps 8+ start hiding entries, then finally cap bullets everywhere. */
export function ladderFor(db: Db, variant: Variant): FitStep[] {
  const base = { fontSize: "10pt" as const, linespread: 0.96, extraHeight: 0.5, bulletCap: 3 };
  const maxDrops = countCandidates(db, variant);
  const drops = Array.from({ length: maxDrops }, (_, i) => ({
    ...base,
    drop: i + 1,
    label: `10pt, ${i + 1} ${i === 0 ? "entry" : "entries"} hidden`,
  }));
  const lastResort: FitStep[] = [
    { ...base, drop: maxDrops, hardBulletCap: 3, label: "10pt, entries hidden, max 3 bullets everywhere" },
    { ...base, drop: maxDrops, hardBulletCap: 2, label: "10pt, entries hidden, max 2 bullets everywhere" },
    { ...base, drop: maxDrops, hardBulletCap: 1, label: "10pt, entries hidden, one bullet each" },
  ];
  return [...LADDER, ...drops, ...lastResort];
}

function candidates(db: Db, variant: Variant): { key: SectionKey; id: string }[] {
  const out: { key: SectionKey; id: string }[] = [];
  const used = new Set<string>();
  for (const { key, keep } of DROP_ORDER) {
    const sec = variant.sections.find((s) => s.key === key);
    if (!sec || !sec.enabled) continue;
    const live = sec.items.filter((id) => !used.has(id));
    for (let i = live.length - 1; i >= keep; i--) {
      out.push({ key, id: live[i] });
      used.add(live[i]);
    }
  }
  return out;
}

const countCandidates = (db: Db, variant: Variant) => candidates(db, variant).length;

const bulletsOf = (item: unknown): Bullet[] => ((item as { bullets?: Bullet[] })?.bullets ?? []);

/** Produce the variant this step implies. The library itself is never modified. */
export function applyStep(db: Db, variant: Variant, step: FitStep): FitResult {
  const v: Variant = structuredClone(variant);
  const notes: string[] = [];

  if (step.drop) {
    const list = candidates(db, variant).slice(0, step.drop);
    const dropped: string[] = [];
    for (const { key, id } of list) {
      const sec = v.sections.find((s) => s.key === key);
      if (!sec) continue;
      sec.items = sec.items.filter((x) => x !== id);
      const item = (db[key] as { id: string }[]).find((i) => i.id === id) as Record<string, unknown> | undefined;
      dropped.push(String(item?.name ?? item?.title ?? item?.text ?? id).slice(0, 48));
    }
    if (dropped.length) notes.push(`hidden: ${dropped.join("; ")}`);
    for (const sec of v.sections) if (!sec.items.length) sec.enabled = false;
  }

  const cap = (keys: SectionKey[], max: number) => {
    let trimmed = 0;
    for (const sec of v.sections) {
      if (!keys.includes(sec.key)) continue;
      for (const id of sec.items) {
        const item = (db[sec.key] as { id: string }[]).find((i) => i.id === id);
        const live = bulletsOf(item).filter((b) => b.text.trim() && !v.hiddenBullets.includes(b.id));
        for (const b of live.slice(max)) {
          v.hiddenBullets.push(b.id);
          trimmed++;
        }
      }
    }
    return trimmed;
  };

  if (step.bulletCap) {
    const n = cap(CAPPABLE, step.bulletCap);
    if (n) notes.push(`${n} project bullet${n === 1 ? "" : "s"} hidden`);
  }
  if (step.hardBulletCap) {
    const all = v.sections.map((s) => s.key);
    const n = cap(all, step.hardBulletCap);
    if (n) notes.push(`${n} more bullet${n === 1 ? "" : "s"} hidden`);
  }
  if (step.fontSize) v.fontSize = step.fontSize;

  return { variant: v, step, notes };
}

/** Extra preamble lines for a step (injected just before \begin{document}). */
export function stepPreamble(step: FitStep, balance = false): string {
  const out: string[] = [];
  if (step.linespread) out.push(`\\linespread{${step.linespread}}`);
  if (step.extraHeight) out.push(`\\addtolength{\\textheight}{${step.extraHeight}in}`);
  if (balance) out.push(BALANCE);
  return out.length ? `\n% --- auto-fit (${step.label}) ---\n${out.join("\n")}\n` : "";
}

/**
 * Multi-page balance. With \raggedbottom, LaTeX pushes a section that doesn't fit onto the next
 * page and leaves all the slack in one hole at the bottom. \flushbottom spreads that slack instead,
 * mostly between sections (they get the largest stretch), so both pages end on the same line.
 * The final page keeps its natural ragged bottom.
 */
const BALANCE = [
  "\\flushbottom",
  "\\titlespacing*{\\section}{0pt}{3.5ex plus 3ex minus .2ex}{2.3ex plus 1.2ex}",
  "\\setlength{\\parskip}{0pt plus 1pt}",
].join("\n");
