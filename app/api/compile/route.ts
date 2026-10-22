import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { CompileBusy, compileFitted, queueStats, slug, texFor } from "@/lib/server";
import type { Db } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * body: { db, variantId, mode: "preview" | "pdf" | "tex" }
 *
 * The client posts its in-memory library so the preview reflects unsaved edits. Nothing is
 * written to the server's disk: each student downloads their own PDF, and the only files on
 * disk are throwaway LaTeX scratch files in the temp dir, namespaced per user.
 *
 * This is the only expensive endpoint in the app — one preview is three to five pdflatex runs
 * — so it is also the only one that can take the server down. Two guards sit in front of it:
 * a per-user rate limit, so one stuck tab cannot spend the whole machine, and a bounded
 * queue in lib/server.ts that answers 503 instead of letting requests pile up invisibly.
 */

/**
 * Per-user ceiling. The Builder previews on a 1.8s debounce, so a student editing hard might
 * legitimately ask for 20 in a minute; well past that is a loop, not a person.
 */
const LIMIT_PER_MIN = Math.max(5, Number(process.env.COMPILE_RATE_PER_MIN || 30));

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const limit = rateLimit(`compile:${user.id}`, LIMIT_PER_MIN, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      {
        error:
          `That is ${limit.limit} compiles in a minute from this account. ` +
          `Pause for ${limit.retryAfter}s — your work is saved.`,
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  const { db, variantId, mode = "preview" } = (await req.json()) as {
    db: Db;
    variantId: string;
    mode?: "preview" | "pdf" | "tex";
  };

  let built;
  try {
    built = await texFor(db, variantId);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  const { variant } = built;
  const fileBase = `${slug(db.profile?.name || "resume")}_${slug(variant.name)}`;

  const maxPages = variant.maxPages ?? 2;
  let res;
  try {
    // Per-user build directory: two students compiling at the same moment must not share one.
    res = await compileFitted(db, variantId, maxPages, `${user.id}-${variantId}`);
  } catch (e) {
    if (e instanceof CompileBusy) {
      const { waiting, concurrency } = queueStats();
      return NextResponse.json(
        {
          error:
            `The resume compiler is at capacity (${waiting} waiting, ${concurrency} at a time). ` +
            `Nothing is lost — press Compile again in a few seconds.`,
          busy: true,
        },
        { status: 503, headers: { "Retry-After": "5" } }
      );
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  // the .tex download is the fitted source, so Overleaf gives the same PDF
  if (mode === "tex") {
    return new Response(res.tex, {
      headers: {
        "Content-Type": "application/x-tex; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileBase}.tex"`,
      },
    });
  }

  if (!res.ok || !res.pdf) {
    return NextResponse.json({ error: "LaTeX compile failed", log: res.log }, { status: 422 });
  }

  const fit = JSON.stringify({ label: res.fitLabel, notes: res.fitNotes, ok: res.fitOk, attempts: res.attempts });
  return new Response(new Uint8Array(res.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      ...(mode === "pdf" ? { "Content-Disposition": `attachment; filename="${fileBase}.pdf"` } : {}),
      "X-Pages": String(res.pages ?? 0),
      "X-Max-Pages": String(maxPages),
      "X-Fit": encodeURIComponent(fit),
      "X-Overflows": String(res.overflows ?? 0),
      "X-File-Name": `${fileBase}.pdf`,
      // Lets the Builder tell "server is busy" from "your resume is slow".
      "X-Queue": String(queueStats().waiting),
    },
  });
}
