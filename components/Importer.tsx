"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useAiConfig } from "@/lib/ai/config";
import {
  buildExtractPrompt,
  EXTRACT_SYSTEM,
  looksDuplicate,
  mergeIntoLibrary,
  parseExtraction,
  previewLabel,
  type Extracted,
} from "@/lib/ai/extract";
import { ask, LlmError } from "@/lib/ai/providers";
import { SECTION_DEFS } from "@/lib/sections";
import type { Bullet, SectionKey } from "@/lib/types";
import { PageHead } from "./AppShell";
import { AiSettings } from "./AiSettings";
import { useDb } from "./DbProvider";

const PLACEHOLDER = `Paste anything about yourself — the messier the better. For example:

I'm a 3rd year CSE student at Atria Institute of Technology, CGPA 8.2, graduating 2027.
I interned at a startup called Edactly for 3 months as a frontend intern, built their
dashboard in React and cut the page load time.
Projects: GradMesh, a study planner in Next.js and Postgres with Google login. WorldForge,
a map generator in Python.
I know Python, JavaScript, React, Node, Postgres, Docker and a bit of AWS.
Won 2nd place at the Atria hackathon 2025. AWS Cloud Practitioner certified.
I'm the technical lead of the GDG club on campus.`;

/**
 * Fill the library from a paste or a link.
 *
 * This is the "I do not want to fill in twelve forms" path. A model turns the prose into
 * entries; the student then ticks what is right before anything is saved. Nothing goes into
 * the library without that review — see lib/ai/extract.ts for why that matters.
 */
export function Importer() {
  const { db, update } = useDb();
  const ai = useAiConfig();

  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [gh, setGh] = useState("");
  const [ghInfo, setGhInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "fetch" | "github" | "read">("");
  const [error, setError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<Extracted | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [takeProfile, setTakeProfile] = useState(true);
  const [saved, setSaved] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);

  const duplicates = useMemo(() => {
    const out = new Set<string>();
    if (!db || !extracted) return out;
    for (const { key, items } of extracted.sections) {
      for (const item of items) if (looksDuplicate(db, key, item)) out.add(String(item.id));
    }
    return out;
  }, [db, extracted]);

  const fetchLink = async () => {
    const link = url.trim();
    if (!link) return;
    setBusy("fetch");
    setError(null);
    try {
      const r = await fetch("/api/fetch-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: link }),
      });
      const j = (await r.json()) as { text?: string; error?: string; chars?: number };
      if (!r.ok || !j.text) throw new Error(j.error ?? "Could not read that link.");
      // Append rather than replace, so a student can combine a link and their own notes.
      setText((prev) => (prev.trim() ? `${prev.trim()}\n\n${j.text}` : j.text!));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  /** Pull every public repo + README for a username and drop the text into the box. */
  const fetchGithub = async () => {
    const username = gh.trim();
    if (!username) return;
    setBusy("github");
    setError(null);
    setGhInfo(null);
    try {
      const r = await fetch("/api/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const j = (await r.json()) as {
        text?: string;
        error?: string;
        totalRepos?: number;
        used?: number;
        withReadme?: number;
      };
      if (!r.ok || !j.text) throw new Error(j.error ?? "Could not read that GitHub profile.");
      // Append, so a student can combine GitHub with their own notes about internships.
      setText((prev) => (prev.trim() ? `${prev.trim()}

${j.text}` : j.text!));
      setGhInfo(
        `Read ${j.used} of ${j.totalRepos} public repos (${j.withReadme} had a README). ` +
          `Check the text below, add anything GitHub does not know about — internships, ` +
          `college, hackathons — then turn it into entries.`
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const read = async () => {
    if (!db) return;
    if (text.trim().length < 40) {
      setError("Write or paste a bit more first — a couple of sentences at least.");
      return;
    }
    if (!ai.ready) {
      setError(`This step needs a model. Paste your ${ai.provider.label} API key below.`);
      return;
    }
    setBusy("read");
    setError(null);
    setExtracted(null);
    setSaved(null);
    abort.current = new AbortController();
    try {
      const raw = await ask({
        provider: ai.cfg.provider,
        model: ai.cfg.model.trim() || ai.provider.models[0],
        apiKey: ai.cfg.apiKey.trim(),
        baseUrl: ai.cfg.baseUrl.trim() || ai.provider.defaultBaseUrl,
        system: EXTRACT_SYSTEM,
        user: buildExtractPrompt(text),
        signal: abort.current.signal,
      });
      const found = parseExtraction(raw);
      setExtracted(found);
      // Pre-tick everything that is not already in the library.
      const next = new Set<string>();
      for (const { key, items } of found.sections) {
        for (const item of items) if (!looksDuplicate(db, key, item)) next.add(String(item.id));
      }
      setAccepted(next);
    } catch (e) {
      setError(e instanceof LlmError ? e.message : `Something went wrong: ${(e as Error).message}`);
    } finally {
      setBusy("");
      abort.current = null;
    }
  };

  const toggle = (id: string) =>
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = () => {
    if (!extracted) return;
    let added = 0;
    update((d) => {
      added = mergeIntoLibrary(d, extracted, accepted, takeProfile).added;
    });
    setSaved(added);
    setExtracted(null);
    setText("");
    setUrl("");
    setGh("");
    setGhInfo(null);
  };

  if (!db) return <div className="empty-state">Loading your library…</div>;

  return (
    <>
      <PageHead
        crumb="Library"
        title="Quick start"
        subtitle="Paste a description of yourself and let it fill your library"
      />

      <div className="import-wrap">
        <div className="panel">
          <div className="panel-head">
            <h2>1 · Tell it about yourself</h2>
          </div>
          <p className="tailor-hint">
            Write it however you like — full sentences, bullet points, a copy-paste of an old
            resume. Mention your college and course, internships, projects, skills, hackathons
            and certificates. It only uses what you actually write: it will not make up dates,
            numbers or jobs.
          </p>

          <label className="field">
            <span>About you</span>
            <textarea
              className="import-text"
              value={text}
              placeholder={PLACEHOLDER}
              spellCheck
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <p className="tailor-hint">
            {text.trim().length.toLocaleString()} characters
            {text.trim().length > 8000 && (
              <>
                {" — that is a lot to read in one go. Small free models often return broken "}
                output at this size; if it fails, pick a larger model (Groq&apos;s{" "}
                <code>openai/gpt-oss-120b</code> or Gemini <code>2.5-flash</code>), or delete
                the repositories you do not want on the resume.
              </>
            )}
          </p>

          <div className="source-row">
            <div className="source-card">
              <strong>Import everything from GitHub</strong>
              <p>
                Your public repositories and their READMEs, read in one go — the fastest way to
                fill a projects section you would otherwise retype by hand.
              </p>
              <div className="row gap-xs wrap">
                <input
                  className="grow"
                  value={gh}
                  placeholder="your GitHub username"
                  spellCheck={false}
                  autoCapitalize="off"
                  onKeyDown={(e) => e.key === "Enter" && fetchGithub()}
                  onChange={(e) => setGh(e.target.value)}
                />
                <button className="btn primary-ghost" onClick={fetchGithub} disabled={!gh.trim() || busy !== ""}>
                  {busy === "github" ? "Reading GitHub…" : "Fetch my repos"}
                </button>
              </div>
              {ghInfo && <p className="tailor-hint ok-text">{ghInfo}</p>}
            </div>

            <details className="tailor-ai">
              <summary>Or pull the text from any link</summary>
              <p className="tailor-hint">
                A portfolio site or any public page. LinkedIn blocks automated reading — for
                that, open your profile, select all, copy, and paste above.
              </p>
              <label className="field">
                <span>Link</span>
                <input
                  value={url}
                  placeholder="https://your-portfolio.com"
                  spellCheck={false}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </label>
              <button className="btn sm" onClick={fetchLink} disabled={!url.trim() || busy !== ""}>
                {busy === "fetch" ? "Reading the page…" : "Add this page's text"}
              </button>
            </details>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>2 · Read it</h2>
          </div>
          <AiSettings ai={ai} idSuffix="import" />
          <div className="row gap-xs wrap">
            <button className="btn primary" onClick={read} disabled={busy !== "" || text.trim().length < 40}>
              {busy === "read" ? "Reading…" : "Turn this into library entries"}
            </button>
            {busy === "read" && (
              <button className="btn sm ghost" onClick={() => abort.current?.abort()}>
                Cancel
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="notice err">
            <strong>Could not do that</strong>
            <p>{error}</p>
          </div>
        )}

        {saved !== null && (
          <div className="notice ok">
            <strong>Added {saved} entries to your library</strong>
            <p>
              Next: <Link href="/">pick a job role</Link> to build a resume from them, or{" "}
              <Link href="/library">open your library</Link> to check the details.
            </p>
          </div>
        )}

        {extracted && (
          <div className="panel">
            <div className="panel-head">
              <h2>3 · Check what it found</h2>
              <span className="tailor-or">
                {accepted.size} of {extracted.count} ticked
              </span>
            </div>
            <p className="tailor-hint">
              Untick anything wrong or made up. Everything you keep is marked as unverified in
              your library so you remember to check the details later. You can edit all of it
              afterwards.
            </p>

            {extracted.profile.name && (
              <label className="check">
                <input type="checkbox" checked={takeProfile} onChange={(e) => setTakeProfile(e.target.checked)} />
                <span>
                  Fill my empty contact details
                  {extracted.profile.name ? ` (name: ${extracted.profile.name})` : ""}
                </span>
              </label>
            )}

            {extracted.sections.map(({ key, items }) => (
              <div key={key} className="import-group">
                <p className="role-group-name">
                  {SECTION_DEFS[key as SectionKey]?.defaultTitle ?? key} · {items.length}
                </p>
                {items.map((item) => {
                  const id = String(item.id);
                  const bullets = (item.bullets as Bullet[] | undefined) ?? [];
                  const dup = duplicates.has(id);
                  return (
                    <label key={id} className={`import-item ${accepted.has(id) ? "on" : ""}`}>
                      <input type="checkbox" checked={accepted.has(id)} onChange={() => toggle(id)} />
                      <span className="import-body">
                        <strong>
                          {previewLabel(key as SectionKey, item) || "(untitled)"}
                          {dup && <em className="import-dup">already in your library</em>}
                        </strong>
                        {bullets.length > 0 && (
                          <ul>
                            {bullets.map((b) => (
                              <li key={b.id}>{b.text}</li>
                            ))}
                          </ul>
                        )}
                        {Array.isArray(item.tags) && (item.tags as string[]).length > 0 && (
                          <small>{(item.tags as string[]).join(" · ")}</small>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            ))}

            <div className="row gap-xs wrap import-actions">
              <button className="btn primary" onClick={save} disabled={accepted.size === 0 && !takeProfile}>
                Add {accepted.size} {accepted.size === 1 ? "entry" : "entries"} to my library
              </button>
              <button className="btn ghost" onClick={() => setExtracted(null)}>
                Discard
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
