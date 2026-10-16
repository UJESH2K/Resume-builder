/**
 * Supabase connection details, read from the environment.
 *
 * Supabase renamed its keys: the "anon" key is now the "publishable" key (`sb_publishable_…`)
 * and "service_role" is now the "secret" key (`sb_secret_…`). Both generations work the same
 * way from the client's point of view — they go in the `apikey` header and row level security
 * does the rest — so either name is accepted here, and whichever one is set wins.
 *
 * NEXT_PUBLIC_* values are inlined into the browser bundle at build time, so they must be
 * present when `next build` runs, not just at runtime. Each one is referenced explicitly
 * rather than through a variable, because the bundler can only substitute literal lookups.
 */

function need(name: string, value: string | undefined, alternatives: string[] = []): string {
  if (value) return value;
  const names = [name, ...alternatives].join(" or ");
  throw new Error(
    `Missing ${names}. Copy .env.local.example to .env.local and fill in your Supabase details ` +
      `(Dashboard -> Project Settings: "Data API" for the URL, "API Keys" for the keys), ` +
      `then restart the dev server.`
  );
}

export const SUPABASE_URL = (): string =>
  need("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);

export const SUPABASE_ANON_KEY = (): string =>
  need(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
  );
