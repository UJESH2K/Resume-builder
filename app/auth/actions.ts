"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export interface AuthState {
  error?: string;
  fields?: { name?: string; email?: string; password?: string };
  values?: { name?: string; email?: string };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Only allow redirects back into this app, never to another site. */
function safeNext(next: FormDataEntryValue | null): string {
  const s = typeof next === "string" ? next : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/";
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const values = { name, email };

  const fields: AuthState["fields"] = {};
  if (name.length < 2) fields.name = "Please enter your full name.";
  if (!EMAIL.test(email)) fields.email = "That does not look like an email address.";
  if (password.length < 8) fields.password = "Use at least 8 characters.";
  if (Object.keys(fields).length) return { fields, values };

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: name } },
  });

  if (error) return { error: error.message, values };

  // Supabase hides whether an email is taken (to stop address harvesting) by returning a
  // user with no identities instead of an error. Translate that into something useful.
  if (data.user && data.user.identities?.length === 0) {
    return { error: "An account with this email already exists. Try logging in instead.", values };
  }

  // No session means the project still has email confirmation switched on.
  if (!data.session) {
    return {
      error:
        "Account created — check your email for the confirmation link. " +
        "(Admin: turn off 'Confirm email' in Supabase -> Authentication -> Sign In / Providers to skip this.)",
      values,
    };
  }

  revalidatePath("/", "layout");
  redirect(safeNext(formData.get("next")));
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const values = { email };

  if (!email || !password) return { error: "Enter your email and password.", values };

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    const wrong = /invalid login credentials/i.test(error.message);
    return { error: wrong ? "Wrong email or password." : error.message, values };
  }

  revalidatePath("/", "layout");
  redirect(safeNext(formData.get("next")));
}

export async function signOut(): Promise<void> {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
