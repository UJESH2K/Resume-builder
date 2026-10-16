import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { compileFitted, slug, texFor } from "@/lib/server";
import type { Db } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * body: { db, variantId, mode: "preview" | "pdf" | "tex" }
 *
 * The client posts its in-memory library so the preview reflects unsaved edits. Nothing is
 * written to the server's disk: each student downloads their own PDF, and the only files on
 * disk are throwaway LaTeX scratch files in the temp dir, namespaced per user.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

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
  // Per-user build directory: two students compiling at the same moment must not share one.
  const res = await compileFitted(db, variantId, maxPages, `${user.id}-${variantId}`);

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
    },
  });
}
