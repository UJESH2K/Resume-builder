import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { htmlToText } from "@/lib/html-text";
import { assertSafeUrl, UnsafeUrlError } from "@/lib/url-guard";

export const dynamic = "force-dynamic";

/**
 * Fetch a public page and hand back its readable text, so a student can import from their
 * GitHub profile or portfolio instead of typing everything out.
 *
 * This has to run on the server (a browser cannot read a cross-origin page), which makes it a
 * server-side request forgery risk: whatever URL someone types, *our* machine fetches. So:
 *
 *  * sign-in required — not an open proxy for the internet;
 *  * http/https only, no file://, no gopher://;
 *  * every resolved IP is vetted by lib/url-guard.ts (private, loopback, link-local and
 *    cloud-metadata ranges — 169.254.169.254 would otherwise hand out instance credentials);
 *  * redirects are followed by hand so each hop is re-checked — a public host can redirect
 *    to 127.0.0.1;
 *  * capped response size and timeout.
 */

const MAX_BYTES = 600_000;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;

/** Read at most MAX_BYTES, so a huge page cannot exhaust memory. */
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder("utf-8", { fatal: false }).decode(
    chunks.reduce((acc, c) => {
      const out = new Uint8Array(acc.length + c.length);
      out.set(acc);
      out.set(c, acc.length);
      return out;
    }, new Uint8Array())
  );
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { url: input } = (await req.json().catch(() => ({}))) as { url?: string };
  if (!input || typeof input !== "string") {
    return NextResponse.json({ error: "Give a link to import." }, { status: 400 });
  }

  let target: URL;
  try {
    target = await assertSafeUrl(input.trim());
  } catch (e) {
    const msg = e instanceof UnsafeUrlError ? e.message : "That link could not be used.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      res = await fetch(target, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          // Some sites serve nothing without these.
          "User-Agent": "Mozilla/5.0 (compatible; ResumeStudio/1.0; +resume-import)",
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
          "Accept-Language": "en",
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) break;
        // Re-validate every hop: a public host can redirect to a private one.
        target = await assertSafeUrl(new URL(location, target).toString());
        continue;
      }
      break;
    }

    if (!res) return NextResponse.json({ error: "That link did not respond." }, { status: 502 });

    if (!res.ok) {
      const blocked = res.status === 401 || res.status === 403 || res.status === 999;
      return NextResponse.json(
        {
          error: blocked
            ? "That site blocks automated reading (LinkedIn does this). Open the page, select all, " +
              "copy, and paste the text into the box instead."
            : `That link returned status ${res.status}.`,
        },
        { status: 422 }
      );
    }

    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/(xhtml|json)/i.test(type)) {
      return NextResponse.json(
        { error: `That link is a ${type.split(";")[0] || "file"}, not a web page. Paste the text instead.` },
        { status: 422 }
      );
    }

    const body = await readCapped(res);
    const text = /html|xhtml/i.test(type) ? htmlToText(body) : body.trim();

    if (text.length < 40) {
      return NextResponse.json(
        { error: "That page had almost no readable text — it probably needs JavaScript. Paste the text instead." },
        { status: 422 }
      );
    }

    return NextResponse.json({ text, source: target.toString(), chars: text.length });
  } catch (e) {
    const aborted = (e as Error)?.name === "AbortError";
    return NextResponse.json(
      { error: aborted ? "That link took too long to respond." : "Could not read that link." },
      { status: 504 }
    );
  } finally {
    clearTimeout(timer);
  }
}
