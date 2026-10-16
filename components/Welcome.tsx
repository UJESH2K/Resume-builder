"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SECTION_ORDER } from "@/lib/sections";
import type { Db } from "@/lib/types";

const LS_DONE = "resume-studio:welcome-done";

/**
 * First-run guide.
 *
 * Someone arriving for the first time sees a sidebar reading "Quick start / Builder /
 * Library" and has no idea that a "library" is the thing everything else is built from.
 * This spells out the three steps and ticks them off as they happen, so the next action is
 * always obvious.
 *
 * It hides itself once the student has a library and a resume, and stays hidden after that.
 */
export function Welcome({ db }: { db: Db }) {
  /**
   * Visible by default so it is in the server-rendered HTML — this is the first thing a new
   * student needs, and having it pop in after hydration is worse than the alternative. The
   * only client-side fact is whether they dismissed it, checked on mount. Anyone who has
   * dismissed it almost certainly has a library too, so the other condition hides it anyway
   * and there is no flash in practice.
   */
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(LS_DONE) === "1") setDismissed(true);
    } catch {
      // storage blocked — showing the guide is the safe default
    }
  }, []);

  const entries = SECTION_ORDER.reduce((n, key) => n + ((db[key] as unknown[])?.length ?? 0), 0);
  const hasLibrary = entries > 0;
  // A variant the student has actually filled in, rather than the empty starters.
  const hasResume = db.variants.some((v) => v.sections.some((s) => s.enabled && s.items.length > 0));

  const close = () => {
    setDismissed(true);
    try {
      localStorage.setItem(LS_DONE, "1");
    } catch {}
  };

  // Once they have both, the guide has done its job — no need to dismiss it by hand.
  if (dismissed || (hasLibrary && hasResume)) return null;

  const steps = [
    {
      done: hasLibrary,
      title: "Fill your library",
      body: hasLibrary
        ? `${entries} ${entries === 1 ? "entry" : "entries"} saved. Add more any time.`
        : "Everything you have done — projects, internships, skills, awards — lives here once, and every resume is built from it.",
      action: hasLibrary ? null : { href: "/import", label: "Paste or import from GitHub" },
    },
    {
      done: hasResume,
      title: "Pick the job you are applying for",
      body: "Choose a role below and it selects the entries that suit it, orders them and fits them to the page.",
      action: null,
    },
    {
      done: false,
      title: "Check it and download",
      body: "The preview on the right is the real PDF. Tweak anything, then download it or the LaTeX source.",
      action: null,
    },
  ];

  return (
    <div className="panel welcome">
      <div className="panel-head">
        <h2>How this works</h2>
        <button className="btn sm ghost" onClick={close} title="Hide this guide">
          Dismiss
        </button>
      </div>
      <ol className="welcome-steps">
        {steps.map((s, i) => (
          <li key={s.title} className={s.done ? "done" : ""}>
            <span className="welcome-num" aria-hidden>
              {s.done ? "✓" : i + 1}
            </span>
            <span className="welcome-body">
              <strong>{s.title}</strong>
              <small>{s.body}</small>
              {s.action && (
                <Link className="btn sm primary" href={s.action.href}>
                  {s.action.label}
                </Link>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
