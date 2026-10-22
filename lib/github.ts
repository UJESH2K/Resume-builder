import "server-only";

/**
 * Reading a GitHub profile into text the importer can use.
 *
 * Kept out of the route handler so it can be tested without faking a signed-in request.
 */

/**
 * How many repos we describe.
 *
 * This used to be 12, chosen to keep one profile near ~15k characters so the smallest free
 * models could still read it in a single call. That was the wrong trade for someone with 70
 * repositories: the twelve-repo ceiling silently threw away most of their work, and no
 * student could tell why their resume only knew about a dozen projects.
 *
 * The importer now reads the digest in chunks (see lib/ai/extract.ts), so the single-call
 * size limit no longer sets this number. What sets it is usefulness: past about forty repos
 * a student's tail is coursework and forks, and the scoring below already ranks those last.
 */
const MAX_REPOS = Math.max(1, Number(process.env.GITHUB_MAX_REPOS || 40));

/**
 * Per-README budget, tiered.
 *
 * A README's useful part is the opening paragraph and the feature list, but for the few repos
 * that matter most it is worth reading further in — that is where the architecture notes and
 * the numbers live, and numbers are what the resume is short of. The tail of the list gets a
 * smaller slice: enough to tell what the project is, not enough to crowd out the leaders.
 */
const README_CHARS_TOP = Math.max(400, Number(process.env.GITHUB_README_CHARS || 2200));
const README_CHARS_TAIL = Math.round(README_CHARS_TOP * 0.45);
/** How many repos get the larger budget. */
const TOP_TIER = 15;

/**
 * READMEs are fetched in waves rather than all at once. GitHub applies a secondary,
 * undocumented limit to bursts of concurrent requests from one token, and forty parallel
 * fetches is squarely in that territory — it returns 403s that look like rate limiting.
 */
const FETCH_BATCH = Math.max(1, Number(process.env.GITHUB_FETCH_BATCH || 8));

const TIMEOUT_MS = 25_000;

interface Repo {
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  homepage: string | null;
  language: string | null;
  topics?: string[];
  stargazers_count: number;
  forks_count: number;
  fork: boolean;
  archived: boolean;
  created_at: string;
  pushed_at: string;
  size: number;
}

function headers(): HeadersInit {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ResumeStudio",
  };
  // Optional. Unauthenticated GitHub allows 60 requests an hour per IP, and one import costs
  // about 15 — so a shared server would run dry almost immediately. With a token it is 5,000.
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

const monthYear = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en", { month: "short", year: "numeric" });
};

/**
 * The stem of a repo name, with any "which attempt is this" suffix removed.
 *
 * Students iterate in public: gradmesh, gradmesh-v2, Gradmesh-v5, gradmesh-final. Those are
 * one project with five commits of history, not five projects, and importing them separately
 * produces a resume with the same entry three times. Keeping only the strongest of each family
 * is both a better resume and a cheaper import.
 */
function familyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-(?:v?\d+|final|latest|new|old|copy|backup|test|demo|clone|fork|rev\d*)$/g, "")
    .replace(/-+$/, "")
    .replace(/\d+$/, "")
    .replace(/-+$/, "")
    || name.toLowerCase();
}

/** Interesting first: real projects before forks, popular and substantial before trivial. */
function score(r: Repo): number {
  let n = 0;
  n += Math.min(r.stargazers_count, 50) * 4;
  n += Math.min(r.forks_count, 20) * 2;
  if (r.description) n += 8;
  if (r.homepage) n += 6;
  if (r.topics?.length) n += 4;
  if (r.language) n += 4;
  if (r.size > 500) n += 4;
  if (r.fork) n -= 40;
  if (r.archived) n -= 6;
  // Recency: anything pushed in the last two years counts for something.
  const months = (Date.now() - new Date(r.pushed_at).getTime()) / (1000 * 60 * 60 * 24 * 30);
  if (months < 24) n += Math.round((24 - months) / 3);
  return n;
}

async function readme(fullName: string, signal: AbortSignal, budget: number): Promise<string> {
  try {
    const res = await fetch(`https://api.github.com/repos/${fullName}/readme`, {
      headers: { ...(headers() as Record<string, string>), Accept: "application/vnd.github.raw" },
      signal,
    });
    if (!res.ok) return "";
    const text = await res.text();
    return (
      text
        // Badges and raw HTML are pure noise for the model.
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        // Badge rows leave behind empty links like [](https://...) once the image is gone.
        .replace(/\[\s*\]\([^)]*\)/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/[ \t]+/g, " ")
        // Stripped badge rows leave whitespace-only lines, which survive a plain blank-line
        // collapse and waste prompt budget.
        .replace(/^[ \t]+$/gm, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, budget)
    );
  } catch {
    return "";
  }
}

/** Map over `items` `FETCH_BATCH` at a time — see FETCH_BATCH for why not all at once. */
async function inBatches<T, R>(items: T[], fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += FETCH_BATCH) {
    const slice = items.slice(i, i + FETCH_BATCH);
    out.push(...(await Promise.all(slice.map((item, j) => fn(item, i + j)))));
  }
  return out;
}

export interface GithubDigest {
  text: string;
  username: string;
  totalRepos: number;
  used: number;
  withReadme: number;
  /** Repos ranked below the cut, so the student can see what was left out and why. */
  skipped: string[];
}

export class GithubError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** Normalise "@name", "https://github.com/name/repo" and "name" down to "name". */
export function parseUsername(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/^@/, "")
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/\/.*$/, "");
}

export const isValidUsername = (u: string) =>
  /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(u);

/** Fetch the profile and build the digest. Throws GithubError with a student-facing message. */
export async function readGithubProfile(username: string, signal: AbortSignal): Promise<GithubDigest> {
  const listRes = await fetch(
    `https://api.github.com/users/${username}/repos?per_page=100&type=owner&sort=pushed`,
    { headers: headers(), signal }
  );

  if (listRes.status === 404) throw new GithubError(`No GitHub user called "${username}".`, 404);
  if (listRes.status === 403 || listRes.status === 429) {
    const reset = listRes.headers.get("x-ratelimit-reset");
    const mins = reset ? Math.max(1, Math.ceil((Number(reset) * 1000 - Date.now()) / 60000)) : null;
    throw new GithubError(
      `GitHub is rate limiting this server${mins ? `; it resets in about ${mins} minute(s)` : ""}. ` +
        `The admin can raise the limit from 60 to 5,000 an hour by setting a GITHUB_TOKEN. ` +
        `In the meantime you can paste your project details in the box above.`,
      429
    );
  }
  if (!listRes.ok) throw new GithubError(`GitHub returned status ${listRes.status}.`, 502);

  const all = (await listRes.json()) as Repo[];
  if (!Array.isArray(all) || all.length === 0) {
    throw new GithubError(`"${username}" has no public repositories to read.`, 404);
  }

  // github.com/<user>/<user> is the profile README: great "about me" material, but it is not
  // a project and must not head the project list.
  const isProfileRepo = (r: Repo) => r.name.toLowerCase() === username.toLowerCase();
  const profileRepo = all.find(isProfileRepo);
  const projects = all.filter((r) => !isProfileRepo(r));

  // Collapse iteration families to their strongest member, keeping the names of the rest so
  // the digest can say "earlier iterations: …" instead of pretending they never existed.
  const families = new Map<string, Repo[]>();
  for (const r of [...projects].sort((a, b) => score(b) - score(a))) {
    const key = familyKey(r.name);
    families.set(key, [...(families.get(key) ?? []), r]);
  }
  const ranked = [...families.values()].map((group) => group[0]).sort((a, b) => score(b) - score(a));
  const supersededBy = new Map<string, string[]>();
  for (const group of families.values()) {
    if (group.length > 1) supersededBy.set(group[0].name, group.slice(1).map((r) => r.name));
  }

  const chosen = ranked.slice(0, MAX_REPOS);
  const profileReadme = profileRepo ? await readme(profileRepo.full_name, signal, README_CHARS_TOP) : "";
  const readmes = await inBatches(chosen, (r, i) =>
    readme(r.full_name, signal, i < TOP_TIER ? README_CHARS_TOP : README_CHARS_TAIL)
  );

  const languages = [...new Set(all.map((r) => r.language).filter(Boolean))] as string[];
  const topics = [...new Set(chosen.flatMap((r) => r.topics ?? []))].slice(0, 25);

  const lines: string[] = [
    `GITHUB PROFILE: https://github.com/${username}`,
    `${all.length} public repositories. Languages used across them: ${languages.join(", ") || "not stated"}.`,
    topics.length ? `Topics: ${topics.join(", ")}.` : "",
    "",
  ];

  if (profileReadme) {
    lines.push(
      "WHAT THEY SAY ABOUT THEMSELVES (from their GitHub profile page — treat as background,",
      "and as a source for skills, awards and achievements, not as a project):",
      "",
      profileReadme,
      ""
    );
  }

  lines.push(
    "PROJECTS (most significant first).",
    "Any figure that belongs on the resume must come from the text below — a dataset size, a",
    "benchmark, a user or star count, a latency. Where a repo states none, describe it without",
    "a number rather than guessing one.",
    ""
  );

  chosen.forEach((r, i) => {
    const meta = [
      r.language,
      r.stargazers_count ? `${r.stargazers_count} stars` : "",
      r.fork ? "fork of someone else's project" : "",
      r.archived ? "archived" : "",
      `created ${monthYear(r.created_at)}`,
      `last updated ${monthYear(r.pushed_at)}`,
    ]
      .filter(Boolean)
      .join(" · ");

    lines.push(`--- ${i + 1}. ${r.name}`);
    if (r.description) lines.push(`Description: ${r.description}`);
    lines.push(`Details: ${meta}`);
    const earlier = supersededBy.get(r.name);
    if (earlier?.length) {
      lines.push(
        `Earlier iterations of this same project (do NOT make separate entries for them): ${earlier.join(", ")}`
      );
    }
    lines.push(`Code: ${r.html_url}`);
    if (r.homepage) lines.push(`Live: ${r.homepage}`);
    if (r.topics?.length) lines.push(`Tags: ${r.topics.join(", ")}`);
    if (readmes[i]) lines.push(`README:
${readmes[i]}`);
    lines.push("");
  });

  const text = lines.join("\n").trim();
  return {
    text,
    username,
    totalRepos: all.length,
    used: chosen.length,
    withReadme: readmes.filter(Boolean).length,
    skipped: ranked.slice(MAX_REPOS).map((r) => r.name),
  };
}
