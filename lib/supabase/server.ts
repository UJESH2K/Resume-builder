import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

/**
 * Per-request server client for Server Components, Server Actions and Route Handlers.
 * Never cache or share this across requests — it closes over one request's cookies.
 *
 * Writing cookies is only allowed in a Server Action or Route Handler. During a Server
 * Component render `cookies().set` throws, so the write is swallowed: proxy.ts has already
 * refreshed the session for this request, so there is nothing to lose.
 */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(SUPABASE_URL(), SUPABASE_ANON_KEY(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) store.set(name, value, options);
        } catch {
          // Server Component render — proxy.ts owns the refresh for this request.
        }
      },
    },
  });
}
