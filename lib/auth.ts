import "server-only";
import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";
import { supabaseServer } from "./supabase/server";

/**
 * The signed-in user, or null. `cache` memoises it for one render pass so a page, its
 * layout and its data loaders share a single call instead of hitting Supabase three times.
 *
 * Uses getUser() rather than getSession(): getSession reads the cookie and trusts it,
 * getUser verifies the token with the auth server. Anything that guards data must verify.
 */
export const currentUser = cache(async (): Promise<User | null> => {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user ?? null;
});

/** For pages: bounce to the login screen when not signed in. */
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/** The display name a student signed up with, falling back to the local part of their email. */
export function displayName(user: User): string {
  const meta = (user.user_metadata ?? {}) as { full_name?: string };
  return meta.full_name?.trim() || (user.email ?? "").split("@")[0] || "Student";
}
