import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { listVersions, restoreVersion } from "@/lib/library";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const unauthorised = () => NextResponse.json({ error: "Not signed in" }, { status: 401 });

/**
 * The student's own save history. A snapshot of the previous contents is written by a
 * database trigger on every save (last 30 kept), so a bad edit or a wrong "Keep mine"
 * is always recoverable.
 */
export async function GET() {
  const user = await currentUser();
  if (!user) return unauthorised();

  const supabase = await supabaseServer();
  try {
    return NextResponse.json({ versions: await listVersions(supabase, user.id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** body: { versionId } — make that snapshot current. The replaced version is itself snapshotted. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return unauthorised();

  const { versionId } = (await req.json()) as { versionId?: number };
  if (typeof versionId !== "number") {
    return NextResponse.json({ error: "Expected a versionId" }, { status: 400 });
  }

  const supabase = await supabaseServer();
  try {
    return NextResponse.json({ rev: await restoreVersion(supabase, user.id, versionId) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
