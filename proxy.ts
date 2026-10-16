import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/env";

// Everything else requires a signed-in student.
const PUBLIC_PREFIXES = ["/login", "/signup", "/auth"];

const isPublic = (path: string) =>
  PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

/**
 * Runs before every page request: refreshes the Supabase session (writing the rotated
 * tokens back as cookies) and keeps signed-out visitors out of the app.
 *
 * This is an *optimistic* gate — convenience, not security. The real checks live next to
 * the data: every API route re-verifies the user, and row level security means Postgres
 * will not hand over another student's library even if this file were bypassed entirely.
 *
 * API routes are excluded (see `config.matcher`) so that an expired session there returns
 * a 401 the client can act on, instead of a redirect to an HTML login page.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL(), SUPABASE_ANON_KEY(), {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        // Rebuild the response so the refreshed tokens are visible both to the rest of
        // this request and to the browser. Dropping either half causes random logouts.
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        // no-store headers: a cached Set-Cookie would hand one student another's session.
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  // Must happen before the response is returned, or a refresh that lands late is lost.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  if (!user && !isPublic(path)) {
    // Send them back where they were headed once they are in.
    return NextResponse.redirect(absolute(request, "/login", path === "/" ? undefined : path));
  }

  if (user && (path === "/login" || path === "/signup")) {
    return NextResponse.redirect(absolute(request, "/"));
  }

  return response;
}

/**
 * Build a redirect URL that survives a reverse proxy.
 *
 * Hosted behind one (Hugging Face Spaces, Fly, nginx), TLS is terminated upstream, so
 * `request.nextUrl` can say `http://` and an internal hostname. Redirecting to that either
 * downgrades the student to http or bounces them somewhere unreachable — the classic
 * "login redirect loop" when an app goes from localhost to a real host.
 *
 * Order of preference:
 *  1. APP_ORIGIN, if set — explicit and needs no trust. Set this in production.
 *  2. the X-Forwarded-* headers the proxy added.
 *  3. whatever Next inferred (correct for local dev).
 *
 * Note on (2): a forwarded host is attacker-controllable if the app is reachable directly,
 * which would turn this into an open redirect. That is why APP_ORIGIN wins when present.
 */
function absolute(request: NextRequest, pathname: string, next?: string): URL {
  const first = (value: string | null) => value?.split(",")[0]?.trim() || "";

  let base = process.env.APP_ORIGIN?.trim() ?? "";
  if (!base) {
    const proto = first(request.headers.get("x-forwarded-proto"));
    const host = first(request.headers.get("x-forwarded-host")) || first(request.headers.get("host"));
    if (proto && host) base = `${proto}://${host}`;
  }

  const url = new URL(pathname, base || request.nextUrl.origin);
  if (next) url.searchParams.set("next", next);
  return url;
}

export const config = {
  matcher: [
    // Pages only: skip API routes (they return 401), Next internals and static files.
    "/((?!api/|_next/static|_next/image|favicon.ico|logo.png|.*\.(?:png|jpg|jpeg|svg|gif|webp|ico|pdf|tex)$).*)",
  ],
};
