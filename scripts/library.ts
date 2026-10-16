// Pull a student's library out of Supabase to a JSON file, or push a JSON file back in.
//
//   node scripts/library.ts pull you@example.com                  -> data/resume-db.json
//   node scripts/library.ts pull you@example.com mine.json
//   node scripts/library.ts push you@example.com                  <- data/resume-db.json
//   node scripts/library.ts push you@example.com mine.json
//
// Why both: the app is the source of truth now, so editing data/resume-db.json by hand only
// works if you PULL first (to get what the app has) and PUSH after (to send it back).
// Pushing replaces the whole library — the previous contents are snapshotted into
// library_versions, so it is undoable.
//
// Needs the Supabase secret key in .env.local: looking a user up by email is admin-only.
// The account must exist — sign up in the app first.
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Db } from "../lib/types.ts";

/** Minimal .env.local reader so the script needs no extra flags or dependencies. */
function loadEnv(): void {
  const file = new URL("../.env.local", import.meta.url);
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    if (value && !process.env[m[1]]) process.env[m[1]] = value;
  }
}
loadEnv();

const die = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

const [command, email, jsonPath = "data/resume-db.json"] = process.argv.slice(2);

if (command !== "pull" && command !== "push") {
  die("Usage: node scripts/library.ts <pull|push> <email> [path/to/resume-db.json]");
}
if (!email) die("Which account? e.g. node scripts/library.ts pull you@example.com");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  die("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local first.");
}

const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
const target = new URL(`../${jsonPath}`, import.meta.url);

// There is no "get user by email" admin call, so page through the list.
let userId: string | undefined;
for (let page = 1; page <= 20 && !userId; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) die(`Could not list users: ${error.message}`);
  userId = data!.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
  if (data!.users.length < 200) break;
}
if (!userId) die(`No account for ${email}. Sign up in the app first, then run this again.`);

const summarise = (db: Db) =>
  (["education", "experience", "projects", "skills", "awards", "achievements", "variants"] as const)
    .map((k) => `${(db as unknown as Record<string, unknown[]>)[k]?.length ?? 0} ${k}`)
    .join(", ");

if (command === "pull") {
  const { data, error } = await admin
    .from("libraries")
    .select("data, rev")
    .eq("user_id", userId!)
    .maybeSingle();
  if (error) die(`Could not read the library: ${error.message}`);
  if (!data) die(`${email} has no library yet — open the app once to create it.`);

  writeFileSync(target, `${JSON.stringify(data!.data, null, 2)}\n`, "utf8");
  console.log(`Pulled ${email} (rev ${data!.rev}) to ${jsonPath}: ${summarise(data!.data as Db)}.`);
  console.log("Edit that file, then: node scripts/library.ts push " + email);
} else {
  if (!existsSync(target)) die(`No such file: ${jsonPath}`);

  const { rev: _rev, ...db } = JSON.parse(readFileSync(target, "utf8")) as Db;
  if (!db.profile || !Array.isArray(db.variants)) {
    die(`${jsonPath} does not look like a resume library (no profile / variants).`);
  }

  const { data: existing } = await admin
    .from("libraries")
    .select("rev")
    .eq("user_id", userId!)
    .maybeSingle();

  const { error } = await admin.from("libraries").upsert({ user_id: userId!, data: db }, { onConflict: "user_id" });
  if (error) die(`Push failed: ${error.message}`);

  console.log(
    existing
      ? `Pushed to ${email}, replacing rev ${existing.rev}: ${summarise(db as Db)}.`
      : `Created the library for ${email}: ${summarise(db as Db)}.`
  );
  if (existing) console.log("The replaced version is kept in library_versions, so this is undoable.");
}
