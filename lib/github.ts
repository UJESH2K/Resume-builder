import "server-only";

/**
 * Reading a GitHub profile into text the importer can use.
 *
 * Kept out of the route handler so it can be tested without faking a signed-in request.
 */

/** How many repos we describe. Beyond this the prompt gets expensive and the tail is noise. */
const MAX_REPOS = 12;
/** Per-README budget. Enough for the intro and feature list, which is the useful part. */
const README_CHARS = 1400;
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

async function readme(fullName: string, signal: AbortSignal): Promise<string> {
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
        .slice(0, README_CHARS)
    );
  } catch {
    return "";
  }
}

export interface GithubDigest {
  text: string;
  username: string;
  totalRepos: number;
  used: number;
  withReadme: number;
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

  const chosen = [...projects].sort((a, b) => score(b) - score(a)).slice(0, MAX_REPOS);
  // READMEs in parallel — one at a time would blow the timeout on a dozen repos.
  const [readmes, profileReadme] = await Promise.all([
    Promise.all(chosen.map((r) => readme(r.full_name, signal))),
    profileRepo ? readme(profileRepo.full_name, signal) : Promise.resolve(""),
  ]);

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

  lines.push("PROJECTS (most significant first):", "");

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
  };
}
