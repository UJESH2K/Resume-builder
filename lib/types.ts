// Shape of data/resume-db.json — the single source of truth for every resume.

export type SectionKey =
  | "summary"
  | "education"
  | "experience"
  | "projects"
  | "publications"
  | "skills"
  | "awards"
  | "achievements"
  | "leadership"
  | "certifications";

export interface Bullet {
  id: string;
  text: string; // supports **bold**, __underline__, *italic*, `code`, [label](url)
  tags?: string[]; // optional: auto-select hides this bullet on variants whose tags don't match
}

export interface BaseItem {
  id: string;
  tags: string[]; // e.g. ai, sde, cloud, web3, freelance, cp
  note?: string; // private note, never printed
}

export interface Education extends BaseItem {
  institution: string;
  link?: string;
  degree: string;
  start: string;
  end: string;
  score: string; // e.g. "7.7/10 CGPA"
  location: string;
  bullets: Bullet[];
}

export interface Experience extends BaseItem {
  company: string;
  companyLink: string;
  role: string;
  kind: string; // Internship / Full-time / Freelance / Extern ...
  start: string;
  end: string;
  location: string;
  bullets: Bullet[];
}

export interface Project extends BaseItem {
  name: string;
  tech: string;
  date: string;
  codeLink: string;
  liveLink: string;
  bullets: Bullet[];
}

export interface Award extends BaseItem {
  title: string;
  link: string;
  date: string;
  subtitle: string;
  org: string;
  bullets: Bullet[];
}

export interface Publication extends BaseItem {
  title: string;
  authors: string; // put your own name in **bold** so it stands out
  venue: string; // conference, journal or workshop
  status: string; // Accepted / Under review / Published / Preprint
  date: string;
  link: string;
  linkLabel: string; // Paper / DOI / arXiv …
  bullets: Bullet[];
}

export interface SkillGroup extends BaseItem {
  category: string;
  items: string;
}

export interface LineItem extends BaseItem {
  text: string;
  link?: string;
  linkLabel?: string; // shown as the clickable word at the end of the line
}

export interface Profile {
  name: string;
  phone: string;
  email: string;
  linkedin: string;
  github: string;
  portfolio: string;
  location: string;
}

export interface VariantSection {
  key: SectionKey;
  title: string;
  enabled: boolean;
  items: string[]; // selected item ids, in print order
}

export interface Variant {
  id: string;
  name: string;
  description: string;
  targetTags: string[];
  accent: string; // hex without '#'
  fontSize: "10pt" | "11pt";
  paper: "letterpaper" | "a4paper";
  maxPages?: number; // hard ceiling; 0 = no limit. Auto-fit shrinks the resume to respect it.
  sections: VariantSection[];
  hiddenBullets: string[]; // bullet ids excluded from this variant
}

export interface Db {
  rev: number;
  profile: Profile;
  summary: LineItem[];
  education: Education[];
  experience: Experience[];
  projects: Project[];
  publications: Publication[];
  skills: SkillGroup[];
  awards: Award[];
  achievements: LineItem[];
  leadership: Award[];
  certifications: LineItem[];
  variants: Variant[];
}

export type AnyItem = Education | Experience | Project | Publication | SkillGroup | Award | LineItem;
