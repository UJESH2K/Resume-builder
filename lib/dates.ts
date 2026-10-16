// Dates in the library are free text ("Jan 2026", "2023", "2026 – Present", "2025 (3 months)").
// The timeline needs them sortable, so parse loosely and never throw.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const ONGOING = /present|current|ongoing|now/i;

export interface YM {
  y: number;
  m: number; // 0-11
}

export function parseYM(raw?: string): YM | null {
  if (!raw) return null;
  const t = raw.toLowerCase();
  const year = /\b(?:19|20)\d{2}\b/.exec(t);
  if (!year) return null;
  const m = MONTHS.findIndex((mon) => t.includes(mon));
  return { y: Number(year[0]), m: m < 0 ? 0 : m };
}

export const ymValue = (v: YM | null): number => (v ? v.y * 12 + v.m : 0);

export interface Span {
  start: YM | null;
  end: YM | null;
  ongoing: boolean;
  label: string;
}

/** Works for {start,end} items (education, experience) and {date} items (projects, awards, leadership, lines). */
export function spanOf(item: Record<string, unknown>): Span {
  const start = typeof item.start === "string" ? item.start : "";
  const end = typeof item.end === "string" ? item.end : "";
  const date = typeof item.date === "string" ? item.date : "";

  if (start || end) {
    return {
      start: parseYM(start),
      end: parseYM(end) ?? parseYM(start),
      ongoing: ONGOING.test(end),
      label: [start, end].filter(Boolean).join(" – "),
    };
  }
  if (date) {
    const [a, b] = date.split(/[–—]|(?<=\d)\s*-\s*(?=\w)|\bto\b/i);
    return {
      start: parseYM(a) ?? parseYM(date),
      end: parseYM(b ?? "") ?? parseYM(a) ?? parseYM(date),
      ongoing: ONGOING.test(date),
      label: date,
    };
  }
  return { start: null, end: null, ongoing: false, label: "" };
}

/** Sort by when a thing began, so an ongoing entry sits at its start year, not at "now". */
export function sortValue(span: Span): number {
  return ymValue(span.start ?? span.end);
}

export const yearOf = (span: Span): number | null => span.start?.y ?? span.end?.y ?? null;
