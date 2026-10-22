// Create or refresh the shared demo account.
//
//   node scripts/demo.ts setup <source-email>   create the account, copy that library into it
//   node scripts/demo.ts refresh                re-copy from the same source, discarding edits
//   node scripts/demo.ts status                 who it is, and what is in it right now
//
// The demo account is one login handed to a room of people (see lib/demo.ts). It holds a
// COPY of someone's library, never the original: row level security gives it its own row, so
// however much a crowd edits it, the account it was copied from is untouched.
//
// Needs DEMO_EMAIL, DEMO_PASSWORD and the Supabase secret key in .env.local. The email is
// never shown to students — they sign in with DEMO_USERNAME — but it must be a real, unique
// address because Supabase authenticates on it.
//
// Refreshing discards whatever the crowd did. The previous contents are snapshotted into
// library_versions first, so even that is undoable.
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
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

const [command, sourceEmail] = process.argv.slice(2);
if (!["setup", "refresh", "status"].includes(command ?? "")) {
  die("Usage: node scripts/demo.ts <setup|refresh|status> [source-email]");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const demoEmail = (process.env.DEMO_EMAIL ?? "").trim().toLowerCase();
const demoPassword = (process.env.DEMO_PASSWORD ?? "").trim();
const demoUsername = (process.env.DEMO_USERNAME ?? "demo").trim();

if (!url || !serviceKey) die("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local first.");
if (!demoEmail) die("Set DEMO_EMAIL in .env.local — the address the demo account signs in with.");
if (command !== "status" && !demoPassword) die("Set DEMO_PASSWORD in .env.local.");

const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });

/** There is no "get user by email" admin call, so page through the list. */
async function findUser(email: string): Promise<string | undefined> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) die(`Could not list users: ${error.message}`);
    const hit = data!.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data!.users.length < 200) return undefined;
  }
  return undefined;
}

const summarise = (db: Db) =>
  (["education", "experience", "projects", "publications", "skills", "achievements", "leadership", "variants"] as const)
    .map((k) => `${(db as unknown as Record<string, unknown[]>)[k]?.length ?? 0} ${k}`)
    .join(", ");

/**
 * Strip anything personal before the copy goes into an account a room of people can read.
 *
 * The resume itself is the point of the demo, so the work stays — but a phone number and a
 * personal email address on a projector in front of sixty people is a different thing from a
 * resume, and they are not needed to show what the app does.
 */
function sanitise(db: Db): Db {
  const copy = JSON.parse(JSON.stringify(db)) as Db;
  copy.profile = {
    ...copy.profile,
    phone: "",
    email: `${demoUsername}@example.com`,
  };
  return copy;
}

const demoId = await findUser(demoEmail);

if (command === "status") {
  if (!demoId) {
    console.log(`No demo account yet for ${demoEmail}. Run: node scripts/demo.ts setup <your-email>`);
    process.exit(0);
  }
  const { data } = await admin.from("libraries").select("data, rev, updated_at").eq("user_id", demoId).maybeSingle();
  console.log(`Demo account: ${demoEmail} (username "${demoUsername}")`);
  console.log(
    data
      ? `Library rev ${data.rev}, updated ${data.updated_at}: ${summarise(data.data as Db)}.`
      : "Account exists but has no library yet — it is created on first sign-in."
  );
  const { count } = await admin
    .from("library_versions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", demoId);
  console.log(`${count ?? 0} snapshots kept, so edits made during a demo can be rolled back.`);
  process.exit(0);
}

if (command === "setup" && !sourceEmail) {
  die("Which library should the demo start from? e.g. node scripts/demo.ts setup you@example.com");
}

// --- make sure the account exists ------------------------------------------------
let userId = demoId;
if (!userId) {
  const { data, error } = await admin.auth.admin.createUser({
    email: demoEmail,
    password: demoPassword,
    // Nobody can click a link in this mailbox, so confirm it here.
    email_confirm: true,
    user_metadata: { full_name: "Demo account" },
  });
  if (error) die(`Could not create the demo account: ${error.message}`);
  userId = data!.user!.id;
  console.log(`Created the demo account ${demoEmail}.`);
} else {
  // Keep the password in step with .env.local on every run, so changing it there is enough.
  const { error } = await admin.auth.admin.updateUserById(userId, { password: demoPassword });
  if (error) die(`Could not set the demo password: ${error.message}`);
  console.log(`Demo account ${demoEmail} already exists; password set from .env.local.`);
}

// --- copy the source library in ---------------------------------------------------
const from = sourceEmail ?? process.env.DEMO_SOURCE_EMAIL;
if (!from) die("No source library. Pass one: node scripts/demo.ts refresh you@example.com");

const sourceId = await findUser(from!);
if (!sourceId) die(`No account for ${from}. Sign up in the app first.`);
if (sourceId === userId) die("The source and the demo account are the same — pick a different source.");

const { data: source, error: readError } = await admin
  .from("libraries")
  .select("data")
  .eq("user_id", sourceId!)
  .maybeSingle();
if (readError) die(`Could not read ${from}'s library: ${readError.message}`);
if (!source) die(`${from} has no library yet — open the app once as that user.`);

const { rev: _rev, ...db } = sanitise(source!.data as Db);
const { error: writeError } = await admin
  .from("libraries")
  .upsert({ user_id: userId!, data: db }, { onConflict: "user_id" });
if (writeError) die(`Could not write the demo library: ${writeError.message}`);

console.log(`Copied ${from}'s library into the demo account: ${summarise(db as Db)}.`);
console.log(`Phone number removed and the email replaced with ${demoUsername}@example.com.`);
console.log(`Students sign in as "${demoUsername}" with the password in DEMO_PASSWORD.`);
console.log(`${from}'s own account is untouched — this is a separate row.`);
