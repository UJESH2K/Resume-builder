"use client";

import { useEffect, useRef, useState } from "react";
import {
  buildDigest,
  buildUserPrompt,
  estimateTokens,
  parsePlan,
  SYSTEM_PROMPT,
  type AppliedPlan,
  type TailorPlan,
} from "@/lib/ai/tailor";
import { ask, LlmError } from "@/lib/ai/providers";
import { useAiConfig } from "@/lib/ai/config";
import { JOB_ROLES, rolesByGroup, type JobRole } from "@/lib/roles";
import type { Db } from "@/lib/types";
import { AiSettings } from "./AiSettings";

const LS_ROLE = "resume-studio:role";
const LS_OPEN = "resume-studio:tailor-open";

/**
 * "I filled in my library — now what?"
 *
 * Pick a job role and get a resume built for it. Works with no AI at all (role tags drive the
 * selection); an API key just makes the choice smarter. The key is used by this component in
 * the browser and goes straight to the provider — it never reaches the Resume Studio server.
 */
export function Tailor({
  db,
  onApply,
}: {
  db: Db;
  /** Create or update the variant for this role. Returns what actually got applied. */
  onApply: (role: JobRole, plan: TailorPlan | null) => AppliedPlan;
}) {
  // Open by default — this panel is the answer to "my library is full, now what?".
  const [open, setOpen] = useState(true);
  const [roleId, setRoleId] = useState<string>("");
  const [busy, setBusy] = useState<"" | "plain" | "ai">("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(AppliedPlan & { role: string; usedAi: boolean }) | null>(null);
  const abort = useRef<AbortController | null>(null);
  const ai = useAiConfig();

  useEffect(() => {
    try {
      const r = localStorage.getItem(LS_ROLE);
      if (r && JOB_ROLES.some((x) => x.id === r)) setRoleId(r);
      // Stays collapsed for anyone who has closed it before.
      if (localStorage.getItem(LS_OPEN) === "0") setOpen(false);
    } catch {}
  }, []);

  const role = JOB_ROLES.find((r) => r.id === roleId);

  const toggle = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(LS_OPEN, next ? "1" : "0");
    } catch {}
  };

  const chooseRole = (id: string) => {
    setRoleId(id);
    setError(null);
    setResult(null);
    try {
      localStorage.setItem(LS_ROLE, id);
    } catch {}
  };

  /** No AI: the role's tags pick the entries. Instant, free, always available. */
  const buildPlain = () => {
    if (!role) return;
    setBusy("plain");
    setError(null);
    try {
      const applied = onApply(role, null);
      setResult({ ...applied, role: role.label, usedAi: false });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const buildWithAi = async () => {
    if (!role) return;
    if (!ai.ready) {
      setError(`Paste your ${ai.provider.label} API key first, or use "Build without AI".`);
      return;
    }
    setBusy("ai");
    setError(null);
    setResult(null);
    abort.current = new AbortController();

    try {
      // The digest describes the library only — no name, phone, email or links are sent.
      const digest = buildDigest(db);
      const raw = await ask({
        provider: ai.cfg.provider,
        model: ai.cfg.model.trim() || ai.provider.models[0],
        apiKey: ai.cfg.apiKey.trim(),
        baseUrl: ai.cfg.baseUrl.trim() || ai.provider.defaultBaseUrl,
        system: SYSTEM_PROMPT,
        user: buildUserPrompt(digest, role, role.maxPages),
        signal: abort.current.signal,
      });
      const plan = parsePlan(raw);
      const applied = onApply(role, plan);
      setResult({ ...applied, role: role.label, usedAi: true });
    } catch (e) {
      setError(e instanceof LlmError ? e.message : `Something went wrong: ${(e as Error).message}`);
    } finally {
      setBusy("");
      abort.current = null;
    }
  };

  const digest = buildDigest(db);
  const itemCount = digest.sections.reduce((n, s) => n + s.count, 0);
  const tokens = estimateTokens(digest);

  return (
    <div className="panel tailor">
      <div className="panel-head">
        <h2>Make a resume for a job role</h2>
        <button className="btn sm" onClick={() => toggle(!open)} aria-expanded={open}>
          {open ? "Hide" : "Start here"}
        </button>
      </div>

      {!open && (
        <p className="tailor-pitch">
          Filled in your library and not sure what to put on the resume? Pick the role you are
          applying for and this builds it for you.
        </p>
      )}

      {open && (
        <>
          {/* ---------- step 1: role ---------- */}
          <p className="tailor-step">1 · What are you applying for?</p>
          <div className="role-groups">
            {rolesByGroup().map(({ group, roles }) => (
              <div key={group} className="role-group">
                <p className="role-group-name">{group}</p>
                <div className="role-grid">
                  {roles.map((r) => (
                    <button
                      key={r.id}
                      className={`role-card ${r.id === roleId ? "active" : ""}`}
                      onClick={() => chooseRole(r.id)}
                      title={r.blurb}
                    >
                      <strong>{r.label}</strong>
                      <small>{r.blurb}</small>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* ---------- step 2: build ---------- */}
          <p className="tailor-step">2 · Build it</p>

          {itemCount === 0 ? (
            <p className="tailor-hint">
              Your library is empty. <a href="/import">Paste a description of yourself</a> to fill it
              in one go, or add entries by hand in the Library.
            </p>
          ) : (
            <>
              <div className="row gap-xs wrap">
                <button className="btn primary" onClick={buildPlain} disabled={!role || busy !== ""}>
                  {busy === "plain" ? "Building…" : "Build without AI"}
                </button>
                <span className="tailor-or">free, instant</span>
              </div>

              <details className="tailor-ai" open={!!ai.cfg.apiKey}>
                <summary>Use AI to choose better (optional)</summary>
                <AiSettings ai={ai} idSuffix="tailor" />
                <div className="row gap-xs wrap">
                  <button className="btn primary-ghost" onClick={buildWithAi} disabled={!role || busy !== ""}>
                    {busy === "ai" ? "Asking the model…" : "Build with AI"}
                  </button>
                  {busy === "ai" && (
                    <button className="btn sm ghost" onClick={() => abort.current?.abort()}>
                      Cancel
                    </button>
                  )}
                  <span className="tailor-or">~{tokens.toLocaleString()} tokens</span>
                </div>
              </details>
            </>
          )}

          {error && (
            <div className="notice err">
              <strong>Could not build it</strong>
              <p>{error}</p>
            </div>
          )}

          {result && (
            <div className="notice ok">
              <strong>
                {result.role} resume ready{result.usedAi ? " (AI-picked)" : ""}
              </strong>
              {result.notes && <p>{result.notes}</p>}
              <p>Check it in the preview, then tweak anything below. Nothing in your library changed.</p>
              {(result.droppedIds.length > 0 || result.unknownSections.length > 0) && (
                <p className="tailor-hint">
                  Ignored {result.droppedIds.length + result.unknownSections.length} thing
                  {result.droppedIds.length + result.unknownSections.length === 1 ? "" : "s"} the model made up.
                  {result.usedAi ? " A stronger model does this better." : ""}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
