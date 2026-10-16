"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { AuthState } from "@/app/auth/actions";

type Action = (state: AuthState, formData: FormData) => Promise<AuthState>;

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn primary auth-submit" type="submit" disabled={pending}>
      {pending ? busy : label}
    </button>
  );
}

export function AuthForm({
  mode,
  action,
  next,
}: {
  mode: "login" | "signup";
  action: Action;
  next?: string;
}) {
  const [state, formAction] = useActionState<AuthState, FormData>(action, {});
  const signup = mode === "signup";

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="logo-tile">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" />
          </span>
          <span>Resume Studio</span>
        </div>

        <h1>{signup ? "Create your account" : "Welcome back"}</h1>
        <p className="auth-sub">
          {signup
            ? "Build your own library of projects, wins and achievements, then turn it into a polished resume."
            : "Log in to your library and resumes."}
        </p>

        <form action={formAction} className="auth-form">
          {next && <input type="hidden" name="next" value={next} />}

          {signup && (
            <label className="auth-field">
              <span>Full name</span>
              <input
                name="name"
                type="text"
                autoComplete="name"
                placeholder="Your name as it should appear on the resume"
                defaultValue={state?.values?.name ?? ""}
                aria-invalid={!!state?.fields?.name}
                required
              />
              {state?.fields?.name && <small className="auth-err">{state.fields.name}</small>}
            </label>
          )}

          <label className="auth-field">
            <span>Email</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              defaultValue={state?.values?.email ?? ""}
              aria-invalid={!!state?.fields?.email}
              required
            />
            {state?.fields?.email && <small className="auth-err">{state.fields.email}</small>}
          </label>

          <label className="auth-field">
            <span>Password</span>
            <input
              name="password"
              type="password"
              autoComplete={signup ? "new-password" : "current-password"}
              placeholder={signup ? "At least 8 characters" : ""}
              aria-invalid={!!state?.fields?.password}
              required
            />
            {state?.fields?.password && <small className="auth-err">{state.fields.password}</small>}
          </label>

          {state?.error && (
            <p className="auth-alert" role="alert">
              {state.error}
            </p>
          )}

          <Submit
            label={signup ? "Create account" : "Log in"}
            busy={signup ? "Creating account…" : "Logging in…"}
          />
        </form>

        <p className="auth-switch">
          {signup ? (
            <>
              Already have an account? <Link href="/login">Log in</Link>
            </>
          ) : (
            <>
              New here? <Link href="/signup">Create an account</Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
