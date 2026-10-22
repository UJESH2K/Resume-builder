"use client";

import { useMemo, useState } from "react";
import { auditResume, expectedOrder, type Check, type WeakBullet } from "@/lib/audit";
import { GRADE_LABEL, xyzGaps } from "@/lib/quantify";
import { SECTION_DEFS } from "@/lib/sections";
import type { Db, Variant } from "@/lib/types";

/**
 * The resume score, read against Google's own guidance.
 *
 * Deliberately a critic, not an author. It will tell a student that a bullet has no measure,
 * point at the entry, and show which of [X], [Y] and [Z] is missing — but it never writes the
 * replacement, because the number belongs to the student and only they know it. A tool that
 * filled the gap itself would be inventing the one thing on a resume that must be true.
 *
 * Everything here is computed from the library in the browser: no server call, no model, no
 * cost, so it updates as they type.
 */

const RING = 2 * Math.PI * 34;

function ScoreRing({ score, grade }: { score: number; grade: string }) {
  const tone = score >= 85 ? "ok" : score >= 70 ? "fit" : score >= 50 ? "warn" : "bad";
  return (
    <div className={`score-ring tone-${tone}`}>
      <svg viewBox="0 0 80 80" aria-hidden="true">
        <circle cx="40" cy="40" r="34" className="score-track" />
        <circle
          cx="40"
          cy="40"
          r="34"
          className="score-fill"
          strokeDasharray={RING}
          strokeDashoffset={RING * (1 - score / 100)}
        />
      </svg>
      <div className="score-number">
        <strong>{score}</strong>
        <span>/ 100</span>
      </div>
      <p className="score-grade">{grade.replace("-", " ")}</p>
    </div>
  );
}

function CheckRow({ check, onJump }: { check: Check; onJump?: (section: string) => void }) {
  const icon = check.severity === "pass" ? "✓" : check.severity === "warn" ? "!" : "✕";
  return (
    <li className={`check-row ${check.severity}`}>
      <span className="check-icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <strong>{check.label}</strong>
        <p className="check-detail">{check.detail}</p>
        {check.fix && <p className="check-fix">{check.fix}</p>}
        {check.section && onJump && (
          <button className="btn xs ghost" onClick={() => onJump(check.section!)}>
            Open {SECTION_DEFS[check.section].label}
          </button>
        )}
      </div>
    </li>
  );
}

function WeakBulletRow({ weak }: { weak: WeakBullet }) {
  const gaps = xyzGaps(weak.analysis);
  return (
    <li className={`weak-row grade-${weak.analysis.grade}`}>
      <div className="weak-head">
        <span className={`badge ${weak.analysis.grade === "weak" ? "bad" : "warn"}`}>
          {weak.analysis.score}
        </span>
        <span className="weak-where">
          {weak.sectionLabel} · {weak.itemLabel}
        </span>
        <span className="weak-grade">{GRADE_LABEL[weak.analysis.grade]}</span>
      </div>
      <p className="weak-text">{weak.analysis.text}</p>
      {weak.analysis.metrics.length > 0 && (
        <p className="weak-has">
          Already measured: {weak.analysis.metrics.map((m) => <code key={m}>{m}</code>)}
        </p>
      )}
      {gaps.length > 0 && (
        <ul className="weak-gaps">
          {gaps.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      )}
      {weak.analysis.issues
        .filter((i) => i.code === "weak-phrase" || i.code === "too-long" || i.code === "first-person")
        .map((i) => (
          <p key={i.code + (i.found ?? "")} className="weak-issue">
            {i.fix}
          </p>
        ))}
    </li>
  );
}

export function ScorePanel({
  db,
  variant,
  pages,
  onReorder,
}: {
  db: Db;
  variant: Variant;
  pages?: number;
  onReorder: (order: string[]) => void;
}) {
  const [showPassed, setShowPassed] = useState(false);
  const [limit, setLimit] = useState(8);

  const audit = useMemo(() => auditResume(db, variant, pages), [db, variant, pages]);
  const failing = audit.checks.filter((c) => c.severity !== "pass");
  const passing = audit.checks.filter((c) => c.severity === "pass");

  /** Reorder the variant's sections into the order Google suggests for this stage. */
  const applyOrder = () => onReorder(expectedOrder(audit.stage));

  return (
    <div className="score-panel">
      <div className="panel">
        <div className="panel-head">
          <h2>Resume score</h2>
          <span className="tailor-or">
            {audit.stage === "student" ? "student / recent graduate" : "experienced"}
          </span>
        </div>

        <div className="score-top">
          <ScoreRing score={audit.score} grade={audit.grade} />
          <div className="score-stats">
            <p>
              <strong>{audit.totals.bullets}</strong> bullets across{" "}
              <strong>{audit.totals.items}</strong> entries in{" "}
              <strong>{audit.totals.sections}</strong> sections.
            </p>
            <p>
              <strong>{audit.bullets.quantified}</strong> of{" "}
              <strong>{audit.bullets.scored}</strong> achievement bullets carry a measure —
              Google&apos;s framework asks every one of them to.
            </p>
            <p className="tailor-hint">
              Half the score is structure, half is how your bullets read against{" "}
              <em>Accomplished [X] as measured by [Y] by doing [Z]</em>. Nothing here is sent
              anywhere — it is worked out in your browser as you type.
            </p>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>
            {failing.length ? `${failing.length} things to fix` : "Everything checks out"}
          </h2>
          {audit.checks.some((c) => c.id === "section-order" && c.severity !== "pass") && (
            <button className="btn sm primary-ghost" onClick={applyOrder}>
              Apply Google order
            </button>
          )}
        </div>
        {failing.length === 0 && (
          <p className="tailor-hint">
            Every structural check passes. What is left is the writing — see the bullets below.
          </p>
        )}
        <ul className="check-list">
          {failing.map((c) => (
            <CheckRow key={c.id} check={c} />
          ))}
        </ul>
        {passing.length > 0 && (
          <>
            <button className="btn xs ghost" onClick={() => setShowPassed((s) => !s)}>
              {showPassed ? "Hide" : `Show ${passing.length} passing`}
            </button>
            {showPassed && (
              <ul className="check-list">
                {passing.map((c) => (
                  <CheckRow key={c.id} check={c} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Bullets that need a measure</h2>
          <span className="tailor-or">
            {audit.weakBullets.length} of {audit.totals.bullets}
          </span>
        </div>
        {audit.weakBullets.length === 0 ? (
          <p className="tailor-hint">
            Every bullet on this resume carries an accomplishment, a measure and a method.
          </p>
        ) : (
          <>
            <p className="tailor-hint">
              Edit these in your <strong>Library</strong>. Only add a number you can defend in an
              interview — an honest bullet with no number beats an invented one, and the
              interviewer will ask.
            </p>
            <ul className="weak-list">
              {audit.weakBullets.slice(0, limit).map((w) => (
                <WeakBulletRow key={w.bulletId} weak={w} />
              ))}
            </ul>
            {audit.weakBullets.length > limit && (
              <button className="btn sm ghost" onClick={() => setLimit((n) => n + 12)}>
                Show {Math.min(12, audit.weakBullets.length - limit)} more
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
