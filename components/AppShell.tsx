"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "@/app/auth/actions";
import { useDb } from "./DbProvider";

const NAV = [
  { href: "/import", label: "Quick start", icon: SparkIcon },
  { href: "/", label: "Builder", icon: BuilderIcon },
  { href: "/library", label: "Library", icon: LibraryIcon },
];

export function AppShell({
  children,
  userName,
  userEmail,
}: {
  children: React.ReactNode;
  userName: string;
  userEmail: string;
}) {
  const path = usePathname();
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="side-brand">
          <span className="logo-tile">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" />
          </span>
          <span className="side-brand-name">Resume Studio</span>
        </div>

        <p className="side-label">General</p>
        <nav className="side-nav">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? path === "/" : path.startsWith(href);
            return (
              <Link key={href} href={href} className={active ? "active" : ""}>
                <Icon />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="side-foot">
          <span className="avatar">{(userName || "?").trim().charAt(0).toUpperCase()}</span>
          <span className="side-user">
            <strong>{userName || "Your name"}</strong>
            <small title={userEmail}>{userEmail}</small>
          </span>
          <form action={signOut}>
            <button className="icon-btn" type="submit" title="Log out" aria-label="Log out">
              <LogoutIcon />
            </button>
          </form>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

/** Breadcrumb + title block used at the top of every page. */
export function PageHead({
  crumb,
  title,
  subtitle,
  actions,
}: {
  crumb: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  const { status, reloadFromServer, overwriteServer } = useDb();
  const STATUS: Record<string, string> = {
    loading: "Loading",
    saved: "Saved",
    dirty: "Unsaved changes",
    saving: "Saving…",
    error: "Save failed",
    conflict: "Edited somewhere else",
    offline: "Signed out",
  };
  return (
    <header className="page-head">
      <div className="crumbs">
        <span>{crumb}</span>
        <span className="sep">/</span>
        <span className="crumb-current">{title}</span>
      </div>
      <div className="page-head-row">
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="page-actions">
          {actions}
          <span className={`save-status s-${status}`} title="Autosaves to your account">
            <span className="dot" />
            {STATUS[status]}
          </span>
          {status === "conflict" && (
            <>
              <button className="btn sm" onClick={reloadFromServer} title="Discard this tab's edits">
                Load newest
              </button>
              <button className="btn sm ghost" onClick={overwriteServer} title="Overwrite with this tab's edits">
                Keep mine
              </button>
            </>
          )}
          {status === "offline" && (
            <a className="btn sm" href="/login">
              Log in again
            </a>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  useEffect(() => {
    const saved = (() => {
      try {
        return localStorage.getItem("resume-studio:theme") as "light" | "dark" | null;
      } catch {
        return null;
      }
    })();
    const initial = saved ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
  }, []);
  const flip = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("resume-studio:theme", next);
    } catch {}
  };
  return (
    <button className="icon-btn" onClick={flip} title="Toggle light / dark" aria-label="Toggle theme">
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function BuilderIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}
function LibraryIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10v16H5.5A1.5 1.5 0 0 1 4 18.5z" />
      <path d="M12 4h6.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H12z" />
    </svg>
  );
}
function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
    </svg>
  );
}
function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15" />
      <path d="M11 8l-4 4 4 4M7 12h9" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5" />
    </svg>
  );
}
function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
    </svg>
  );
}
