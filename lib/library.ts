import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeVariant } from "./sections";
import { starterDb } from "./starter";
import type { Db } from "./types";

/**
 * Per-user library storage, backed by the `libraries` table.
 *
 * This replaces the old data/resume-db.json file. The document shape is unchanged, so
 * everything downstream (lib/latex.ts, lib/fit.ts, Builder, Library) is untouched.
 *
 * Row level security does the authorisation: these helpers take the *user's own* Supabase
 * client, so Postgres itself refuses to return or modify anyone else's row even if a bug
 * here passed the wrong id.
 */

export class LibraryConflict extends Error {
  constructor(public current: Db) {
    super("Library changed elsewhere");
  }
}

/** Fill in sections added to the app after this library was last saved. */
function hydrate(raw: unknown, rev: number): Db {
  const db = raw as Db;
  db.rev = rev;
  db.summary ??= [];
  db.publications ??= [];
  db.leadership ??= [];
  db.certifications ??= [];
  db.variants ??= [];
  db.variants = db.variants.map((v) => normalizeVariant(db, v));
  return db;
}

/**
 * The signed-in student's library, creating a starter one on first sign-in.
 * `rev` comes from the row, so the existing conflict detection keeps working.
 */
export async function loadLibrary(
  supabase: SupabaseClient,
  userId: string,
  fullName: string,
  email: string
): Promise<Db> {
  const { data, error } = await supabase
    .from("libraries")
    .select("data, rev")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Could not read your library: ${error.message}`);
  if (data) return hydrate(data.data, Number(data.rev));

  // First sign-in: hand them a starter library.
  const fresh = starterDb(fullName, email);
  const { rev: _rev, ...toStore } = fresh;
  const { data: created, error: insertError } = await supabase
    .from("libraries")
    .insert({ user_id: userId, data: toStore })
    .select("data, rev")
    .single();

  if (insertError) {
    // 23505 = another tab created it a moment ago. Take theirs.
    if (insertError.code === "23505") {
      const { data: existing, error: reread } = await supabase
        .from("libraries")
        .select("data, rev")
        .eq("user_id", userId)
        .single();
      if (reread) throw new Error(`Could not read your library: ${reread.message}`);
      return hydrate(existing.data, Number(existing.rev));
    }
    throw new Error(`Could not create your library: ${insertError.message}`);
  }
  return hydrate(created.data, Number(created.rev));
}

/**
 * Save, refusing to clobber a newer version.
 *
 * The update is conditional on `rev`, so if another tab (or phone) saved since this client
 * loaded, zero rows match and we raise LibraryConflict carrying the current document. The
 * database trigger bumps `rev`, stamps `updated_at` and snapshots the old contents.
 */
export async function saveLibrary(
  supabase: SupabaseClient,
  userId: string,
  db: Db,
  force = false
): Promise<number> {
  const { rev, ...toStore } = db;

  let q = supabase.from("libraries").update({ data: toStore }).eq("user_id", userId);
  if (!force) q = q.eq("rev", rev);

  const { data, error } = await q.select("rev").maybeSingle();
  if (error) throw new Error(`Could not save your library: ${error.message}`);

  if (!data) {
    // Either someone else saved first, or there is no row yet (force on a fresh account).
    const { data: current, error: reread } = await supabase
      .from("libraries")
      .select("data, rev")
      .eq("user_id", userId)
      .maybeSingle();
    if (reread) throw new Error(`Could not save your library: ${reread.message}`);
    if (!current) throw new Error("Your library does not exist yet — reload the page.");
    throw new LibraryConflict(hydrate(current.data, Number(current.rev)));
  }
  return Number(data.rev);
}

/** Snapshots taken before each save, newest first — the undo history. */
export async function listVersions(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("library_versions")
    .select("id, rev, created_at")
    .eq("user_id", userId)
    .order("id", { ascending: false })
    .limit(30);
  if (error) throw new Error(`Could not read your history: ${error.message}`);
  return data ?? [];
}

/** Restore one snapshot as the current library. Saving it snapshots what we replaced. */
export async function restoreVersion(supabase: SupabaseClient, userId: string, versionId: number): Promise<number> {
  const { data, error } = await supabase
    .from("library_versions")
    .select("data")
    .eq("user_id", userId)
    .eq("id", versionId)
    .single();
  if (error) throw new Error(`Could not read that version: ${error.message}`);
  return saveLibrary(supabase, userId, { ...(data.data as Db), rev: 0 }, true);
}
