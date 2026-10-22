import { NextResponse } from "next/server";
import { currentUser, displayName } from "@/lib/auth";
import { isDemoEmail } from "@/lib/demo";
import { LibraryConflict, loadLibrary, saveLibrary } from "@/lib/library";
import { supabaseServer } from "@/lib/supabase/server";
import type { Db } from "@/lib/types";

export const dynamic = "force-dynamic";

// A Response body can only be read once, so build a fresh one per request.
const unauthorised = () => NextResponse.json({ error: "Not signed in" }, { status: 401 });

/** The signed-in student's library, created on first call. */
export async function GET() {
  const user = await currentUser();
  if (!user) return unauthorised();

  const supabase = await supabaseServer();
  try {
    const db = await loadLibrary(supabase, user.id, displayName(user), user.email ?? "");
    return NextResponse.json(db);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/**
 * Optimistic concurrency: the client sends the rev it last saw. If the row has moved on
 * (another tab, another device), reject with 409 and the current document so the user can
 * choose. `force` skips the check and overwrites.
 */
export async function PUT(req: Request) {
  const user = await currentUser();
  if (!user) return unauthorised();

  const { db, force } = (await req.json()) as { db: Db; force?: boolean };
  if (!db || typeof db !== "object") {
    return NextResponse.json({ error: "Expected a library document" }, { status: 400 });
  }

  const supabase = await supabaseServer();
  try {
    // The shared demo account skips the rev check. Optimistic locking protects one person
    // with two tabs; on an account a roomful of people are editing at once it would reject
    // almost every save. History still records each one, so it stays undoable. See lib/demo.ts.
    const rev = await saveLibrary(supabase, user.id, db, force || isDemoEmail(user.email));
    return NextResponse.json({ rev });
  } catch (e) {
    if (e instanceof LibraryConflict) return NextResponse.json(e.current, { status: 409 });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
