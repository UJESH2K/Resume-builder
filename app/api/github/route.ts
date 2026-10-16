import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { GithubError, isValidUsername, parseUsername, readGithubProfile } from "@/lib/github";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TIMEOUT_MS = 25_000;

/**
 * Turn a GitHub username into text describing their public work, ready for the importer.
 *
 * This is the answer to "I have built a lot and cannot face typing it all in again": one
 * username gives us every public repo plus its README, which is most of a student's project
 * section already written.
 *
 * Runs on the server so the optional shared GITHUB_TOKEN applies — the anonymous rate limit
 * is 60 requests an hour per IP and a single import costs about 15.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const username = parseUsername(((await req.json().catch(() => ({}))) as { username?: string }).username);
  if (!isValidUsername(username)) {
    return NextResponse.json({ error: "That does not look like a GitHub username." }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return NextResponse.json(await readGithubProfile(username, controller.signal));
  } catch (e) {
    if (e instanceof GithubError) return NextResponse.json({ error: e.message }, { status: e.status });
    const aborted = (e as Error)?.name === "AbortError";
    return NextResponse.json(
      { error: aborted ? "GitHub took too long to respond. Try again." : "Could not read that GitHub profile." },
      { status: 504 }
    );
  } finally {
    clearTimeout(timer);
  }
}
