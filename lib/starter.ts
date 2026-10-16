import { ACCENTS, blankVariant, SECTION_ORDER } from "./sections";
import type { Db, Variant } from "./types";

/**
 * The library a student gets the first time they sign in.
 *
 * Deliberately empty of content — we never invent achievements for someone — but the
 * sections and variants are set up so the Builder is usable immediately instead of
 * showing a blank page with every section switched off.
 */

// Sections switched on in a fresh variant. `blankVariant` enables only sections that
// already have items, which for a brand new account is none of them.
const STARTER_SECTIONS = new Set(["education", "skills", "projects", "experience"]);

function starterVariant(db: Db, name: string, description: string, targetTags: string[], accent: string): Variant {
  const v = blankVariant(db, name);
  return {
    ...v,
    description,
    targetTags,
    accent,
    sections: v.sections.map((s) => ({ ...s, enabled: STARTER_SECTIONS.has(s.key) })),
  };
}

export function starterDb(fullName: string, email: string): Db {
  const db: Db = {
    rev: 0,
    profile: {
      name: fullName,
      phone: "",
      email,
      linkedin: "",
      github: "",
      portfolio: "",
      location: "",
    },
    summary: [],
    education: [],
    experience: [],
    projects: [],
    publications: [],
    skills: [],
    awards: [],
    achievements: [],
    leadership: [],
    certifications: [],
    variants: [],
  };

  db.variants = [
    starterVariant(db, "Main resume", "Your default, general-purpose resume", [], ACCENTS[0].hex),
    starterVariant(db, "Internship", "For internship and trainee applications", ["sde", "fullstack"], ACCENTS[1].hex),
    starterVariant(db, "Everything", "Every item in your library — trim down from here", [], ACCENTS[5].hex),
  ];

  if (SECTION_ORDER.length === 0) throw new Error("SECTION_ORDER is empty");
  return db;
}
