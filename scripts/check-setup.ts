// Verify the Supabase setup end to end:  npm run check
//
// Checks the URL and both keys, that the three tables exist, that row level security is
// actually on, that email confirmation is off, and that the sign-up trigger fires.
//
// The last check creates a throwaway account and deletes it again. Pass --no-probe to skip it.
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";

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

const probe = !process.argv.includes("--no-probe");

let failures = 0;
const pass = (name: string, detail = "") => console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
const fail = (name: string, detail: string) => {
  failures++;
  console.log(`  FAIL  ${name} — ${detail}`);
};
const skip = (name: string, detail: string) => console.log(`  SKIP  ${name} — ${detail}`);

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

console.log("\nResume Studio — Supabase setup check\n");

// ---------------------------------------------------------------- env
if (!url) {
  console.log(
    "  FAIL  Project URL missing — put NEXT_PUBLIC_SUPABASE_URL in .env.local.\n" +
      "        Supabase dashboard -> Project Settings -> Data API -> Project URL.\n"
  );
  process.exit(1);
}
if (!publishable) {
  console.log("  FAIL  NEXT_PUBLIC_SUPABASE_ANON_KEY missing in .env.local\n");
  process.exit(1);
}
pass("env file read", `${url}`);

// ---------------------------------------------------------------- reachable
try {
  const res = await fetch(`${url}/auth/v1/health`, { headers: { apikey: publishable } });
  if (res.ok) pass("project reachable");
  else fail("project reachable", `auth health returned ${res.status}`);
} catch (e) {
  fail("project reachable", `${(e as Error).message}. Check the URL is exactly right.`);
  console.log("");
  process.exit(1);
}

// ---------------------------------------------------------------- auth settings
try {
  const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: publishable } });
  const s = (await res.json()) as { mailer_autoconfirm?: boolean; disable_signup?: boolean };
  if (!res.ok) fail("publishable key accepted", `settings returned ${res.status}`);
  else pass("publishable key accepted");

  if (s.disable_signup) {
    fail("sign-ups enabled", "sign-ups are disabled — Authentication -> Sign In / Providers");
  } else {
    pass("sign-ups enabled");
  }

  if (s.mailer_autoconfirm) {
    pass("email confirmation off", "students can sign in immediately");
  } else {
    fail(
      "email confirmation off",
      "it is ON. A class signing up at once will hit Supabase's mail rate limit.\n" +
        "        Authentication -> Sign In / Providers -> Email -> turn off 'Confirm email'."
    );
  }
} catch (e) {
  fail("auth settings readable", (e as Error).message);
}

// ---------------------------------------------------------------- schema + RLS
const anon = createClient(url, publishable, { auth: { persistSession: false } });

for (const table of ["profiles", "libraries", "library_versions"] as const) {
  const { error } = await anon.from(table).select("*").limit(1);
  // PGRST205 = table not found in the schema cache; 42P01 = undefined_table
  if (error && (error.code === "PGRST205" || error.code === "42P01" || /does not exist/i.test(error.message))) {
    fail(`table ${table} exists`, "run supabase/migrations/0001_init.sql in the SQL editor");
  } else if (error) {
    fail(`table ${table} exists`, `${error.code ?? ""} ${error.message}`);
  } else {
    pass(`table ${table} exists`);
  }
}

// Anonymous reads must come back empty rather than leaking other people's rows.
{
  const { data, error } = await anon.from("libraries").select("user_id").limit(5);
  if (error) {
    skip("row level security on libraries", `could not test: ${error.message}`);
  } else if ((data ?? []).length === 0) {
    pass("row level security on libraries", "anonymous reads return nothing");
  } else {
    fail(
      "row level security on libraries",
      `an anonymous caller read ${data!.length} row(s) — RLS is not protecting this table!`
    );
  }
}
{
  const { error } = await anon
    .from("libraries")
    .insert({ user_id: "00000000-0000-0000-0000-000000000000", data: {} });
  if (error) pass("anonymous writes refused", error.code ? `blocked (${error.code})` : "blocked");
  else fail("anonymous writes refused", "an anonymous caller inserted a row — check the RLS policies!");
}

// ---------------------------------------------------------------- secret key
if (!secret) {
  skip("secret key works", "SUPABASE_SECRET_KEY not set (only needed for scripts/library.ts)");
} else {
  const admin = createClient(url, secret, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error) fail("secret key works", error.message);
  else pass("secret key works", `${data.users.length ? "accounts exist" : "no accounts yet"}`);

  // ------------------------------------------------------------ sign-up trigger
  if (!probe) {
    skip("sign-up creates a profile row", "--no-probe given");
  } else {
    const email = `setup-check-${Date.now()}@example.com`;
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: `Chk-${Math.random().toString(36).slice(2)}!9`,
      email_confirm: true,
    });

    if (createError || !created.user) {
      fail("sign-up creates a profile row", `could not create a test account: ${createError?.message}`);
    } else {
      const id = created.user.id;
      try {
        const { data: profile, error: profileError } = await admin
          .from("profiles")
          .select("id, email")
          .eq("id", id)
          .maybeSingle();

        if (profileError) fail("sign-up creates a profile row", profileError.message);
        else if (profile) pass("sign-up creates a profile row", "the 0001 trigger fired");
        else
          fail(
            "sign-up creates a profile row",
            "no profiles row appeared — the on_auth_user_created trigger from 0001_init.sql is missing"
          );

        // The throttled snapshot trigger from 0002 — check the function is the new one.
        const { error: libError } = await admin.from("libraries").insert({ user_id: id, data: { probe: true } });
        if (libError) {
          fail("library row can be created", libError.message);
        } else {
          pass("library row can be created");
          const { error: updError } = await admin
            .from("libraries")
            .update({ data: { probe: 2 } })
            .eq("user_id", id);
          if (updError) fail("save trigger runs", updError.message);
          else {
            const { data: row } = await admin.from("libraries").select("rev").eq("user_id", id).maybeSingle();
            if (row && Number(row.rev) === 2) pass("save bumps rev", "optimistic locking works");
            else fail("save bumps rev", `rev is ${row?.rev ?? "?"}, expected 2 — is the update trigger installed?`);
          }
        }
      } finally {
        // Always clean up, even if a check above threw. Cascades to profiles/libraries.
        const { error: delError } = await admin.auth.admin.deleteUser(id);
        if (delError) console.log(`  NOTE  could not delete the test account ${email}: ${delError.message}`);
        else console.log(`  (test account ${email} created and deleted)`);
      }
    }
  }
}

console.log(
  failures === 0
    ? "\nAll checks passed — the backend is ready. Run `npm run dev` and sign up.\n"
    : `\n${failures} check(s) failed — see above.\n`
);
process.exit(failures === 0 ? 0 : 1);
