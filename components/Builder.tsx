"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyPlan, type AppliedPlan, type TailorPlan } from "@/lib/ai/tailor";
import type { JobRole } from "@/lib/roles";
import { ACCENTS, SECTION_DEFS, allTags, blankVariant, itemsOf, matchesTags, selectByTags, uid } from "@/lib/sections";
import { ScorePanel } from "./ScorePanel";
import { Tailor } from "./Tailor";
import { Welcome } from "./Welcome";
import type { AnyItem, Bullet, Db, Variant, VariantSection } from "@/lib/types";
import { PageHead } from "./AppShell";
import { useDb } from "./DbProvider";
import { Timeline } from "./Timeline";
import { TagInput } from "./TagInput";

interface Preview {
  url: string;
  pages: number;
  maxPages: number;
  overflows: number;
  fileName: string;
  fit: { label: string; notes: string[]; ok: boolean; attempts: number };
}

const LS_KEY = "resume-studio:variant";
const LS_VIEW = "resume-studio:view";

/** Sections = pick what goes on; Timeline = chronological picker; Score = the Google audit. */
type BuilderView = "sections" | "timeline" | "score";

export function Builder() {
  const { db, update } = useDb();
  const [vid, setVid] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [onlyMatching, setOnlyMatching] = useState(false);
  const [auto, setAuto] = useState(true);
  const [view, setView] = useState<BuilderView>("sections");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    if (!db || (vid && db.variants.some((v) => v.id === vid))) return;
    let saved = "";
    try {
      saved = localStorage.getItem(LS_KEY) ?? "";
    } catch {}
    setVid(db.variants.some((v) => v.id === saved) ? saved : db.variants[0]?.id ?? "");
  }, [db, vid]);

  useEffect(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("view");
      const v = fromUrl ?? localStorage.getItem(LS_VIEW);
      if (v === "timeline" || v === "sections" || v === "score") setView(v as BuilderView);
    } catch {}
  }, []);

  const pickView = (v: BuilderView) => {
    setView(v);
    try {
      localStorage.setItem(LS_VIEW, v);
    } catch {}
  };

  const pick = (id: string) => {
    setVid(id);
    try {
      localStorage.setItem(LS_KEY, id);
    } catch {}
  };

  const variant = db?.variants.find((v) => v.id === vid);
  const tags = useMemo(() => (db ? allTags(db) : []), [db]);

  const editVariant = useCallback(
    (fn: (v: Variant, d: Db) => void) =>
      update((d) => {
        const v = d.variants.find((x) => x.id === vid);
        if (v) fn(v, d);
      }),
    [update, vid]
  );

  // ---------- compile ----------
  const run = useCallback(
    async (mode: "preview" | "pdf" | "tex") => {
      if (!db || !vid) return;
      const id = ++reqId.current;
      if (mode !== "tex") setBusy(true);
      try {
        const r = await fetch("/api/compile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ db, variantId: vid, mode }),
        });
        if (!r.ok) {
          const j = (await r.json().catch(() => ({ error: `HTTP ${r.status}` }))) as {
            error?: string;
            log?: string;
            busy?: boolean;
          };
          if (id !== reqId.current) return;
          // 503 (server at capacity) and 429 (this account is compiling too often) are both
          // "wait a moment", not "your resume is broken" — so they must not read like a LaTeX
          // error, and auto-recompile has to stop or it hammers a server already in trouble.
          if (r.status === 503 || r.status === 429) {
            setAuto(false);
            setError(
              `${j.error ?? "The compiler is busy."}\n\nAuto-recompile has been paused so it is not made worse. ` +
                `Press Recompile when you are ready — nothing in your library is lost.`
            );
            return;
          }
          setError(`${j.error}\n\n${j.log ?? ""}`.trim());
          return;
        }
        const blob = await r.blob();
        if (mode === "tex" || mode === "pdf") {
          const fallback = mode === "tex" ? "resume.tex" : "resume.pdf";
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = (r.headers.get("Content-Disposition") ?? "").match(/filename="(.+)"/)?.[1] ?? fallback;
          a.click();
          URL.revokeObjectURL(a.href);
          return;
        }
        if (id !== reqId.current) return; // a newer compile superseded this one
        setError(null);
        setPreview((old) => {
          if (old) URL.revokeObjectURL(old.url);
          const fitHeader = r.headers.get("X-Fit");
          return {
            url: URL.createObjectURL(blob),
            pages: Number(r.headers.get("X-Pages") ?? 0),
            maxPages: Number(r.headers.get("X-Max-Pages") ?? 0),
            overflows: Number(r.headers.get("X-Overflows") ?? 0),
            fileName: r.headers.get("X-File-Name") ?? "resume.pdf",
            fit: fitHeader
              ? JSON.parse(decodeURIComponent(fitHeader))
              : { label: "", notes: [], ok: true, attempts: 1 },
          };
        });
      } catch (e) {
        setError(String(e));
      } finally {
        if (id === reqId.current) setBusy(false);
      }
    },
    [db, vid]
  );

  // Auto-recompile shortly after anything that affects the output changes.
  const fingerprint = useMemo(() => {
    if (!db || !vid) return "";
    const { rev: _r, variants, ...content } = db;
    return JSON.stringify([content, variants.find((v) => v.id === vid)]);
  }, [db, vid]);
  useEffect(() => {
    if (!auto || !fingerprint) return;
    // 1.8s rather than 0.9s: every tick is 3-5 pdflatex runs on a server shared by the whole
    // college, and while someone is still clicking they are not reading the preview anyway.
    const t = setTimeout(() => run("preview"), 1800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint, auto]);

  if (!db) return <div className="empty-state">Loading your library…</div>;

  /**
   * Build (or rebuild) the resume for a job role. One variant per role, reused on a second
   * run so repeated attempts do not pile up near-identical variants.
   *
   * `applyPlan` is pure, so we compute the result against the current library first, hand it
   * back to the Tailor panel to report, and persist the same value.
   */
  const buildForRole = (role: JobRole, plan: TailorPlan | null): AppliedPlan => {
    const existing = db.variants.find((v) => v.name === role.label);
    const base = existing ?? blankVariant(db, role.label);
    const applied = applyPlan(db, { ...base, name: role.label, description: role.blurb }, role, plan);
    update((d) => {
      const i = d.variants.findIndex((v) => v.id === applied.variant.id);
      if (i >= 0) d.variants[i] = applied.variant;
      else d.variants.push(applied.variant);
    });
    pick(applied.variant.id);
    return applied;
  };

  if (!variant)
    return (
      <div className="builder">
        <aside className="controls">
          <Welcome db={db} />
          <Tailor db={db} onApply={buildForRole} />
          <div className="panel">
            <p className="tailor-pitch">Or start from an empty resume and pick entries yourself.</p>
            <button
              className="btn"
              onClick={() => update((d) => void d.variants.push(blankVariant(d, "Master")))}
            >
              Create empty variant
            </button>
          </div>
        </aside>
      </div>
    );

  // ---------- variant actions ----------
  const newVariant = () => {
    const name = prompt("Name for the new variant (e.g. 'Google SDE', 'AI Intern')", "New variant");
    if (!name) return;
    const v = blankVariant(db, name);
    update((d) => void d.variants.push(v));
    pick(v.id);
  };
  const duplicate = () => {
    const name = prompt("Name for the copy", `${variant.name} (copy)`);
    if (!name) return;
    const v: Variant = { ...structuredClone(variant), id: uid("v_"), name };
    update((d) => void d.variants.splice(d.variants.findIndex((x) => x.id === vid) + 1, 0, v));
    pick(v.id);
  };
  const remove = () => {
    if (db.variants.length <= 1) return alert("Keep at least one variant.");
    if (!confirm(`Delete variant "${variant.name}"? Your library items are not affected.`)) return;
    const next = db.variants.find((v) => v.id !== vid)!;
    update((d) => void (d.variants = d.variants.filter((v) => v.id !== vid)));
    pick(next.id);
  };
  const autoSelect = () => {
    if (
      !confirm(
        variant.targetTags.length
          ? `Replace the current selection with every item tagged ${variant.targetTags.join(", ")} (or "all")?`
          : "No target tags set — this will select EVERYTHING. Continue?"
      )
    )
      return;
    update((d) => {
      const i = d.variants.findIndex((v) => v.id === vid);
      d.variants[i] = selectByTags(d, d.variants[i]);
    });
  };

  const moveSection = (idx: number, dir: -1 | 1) =>
    editVariant((v) => {
      const j = idx + dir;
      if (j < 0 || j >= v.sections.length) return;
      [v.sections[idx], v.sections[j]] = [v.sections[j], v.sections[idx]];
    });

  const hidden = new Set(variant.hiddenBullets);
  const q = filter.trim().toLowerCase();

  const skillsIdx = variant.sections.findIndex((s) => s.key === "skills");
  const expIdx = variant.sections.findIndex((s) => s.key === "experience");
  const skillsBelowExperience = skillsIdx > expIdx;
  /**
   * Reorder this variant's sections into the order the score panel recommends.
   *
   * Sections not named in the order keep their relative position at the end, so a section
   * added to the app later cannot be silently dropped from a student's resume.
   */
  const applySectionOrder = (order: string[]) =>
    editVariant((v) => {
      const rank = new Map(order.map((k, i) => [k, i]));
      v.sections.sort((a, b) => (rank.get(a.key) ?? 999) - (rank.get(b.key) ?? 999));
    });

  /** Move Skills directly above Experience — the usual fix when a resume spills onto page two. */
  const swapSkills = () =>
    editVariant((v) => {
      const [sk] = v.sections.splice(
        v.sections.findIndex((s) => s.key === "skills"),
        1
      );
      const to = v.sections.findIndex((s) => s.key === "experience");
      v.sections.splice(to < 0 ? 0 : to, 0, sk);
    });

  return (
    <>
      <PageHead
        crumb="Builder"
        title={variant.name}
        subtitle={`${variant.sections.filter((s) => s.enabled && s.items.length).length} sections · ${variant.sections.reduce(
          (n, s) => n + (s.enabled ? s.items.length : 0),
          0
        )} entries selected${preview ? ` · ${preview.pages} page${preview.pages === 1 ? "" : "s"}` : ""}`}
        actions={
          <div className="seg">
            <button className={view === "sections" ? "active" : ""} onClick={() => pickView("sections")}>
              Sections
            </button>
            <button className={view === "timeline" ? "active" : ""} onClick={() => pickView("timeline")}>
              Timeline
            </button>
            <button className={view === "score" ? "active" : ""} onClick={() => pickView("score")}>
              Score
            </button>
          </div>
        }
      />
      <div className={`builder ${view === "timeline" ? "wide" : ""}`}>
      <aside className="controls">
        <Welcome db={db} />
        <Tailor db={db} onApply={buildForRole} />

        {/* Variant picker */}
        <div className="panel">
          <div className="panel-head">
            <h2>Resume variant</h2>
            <div className="row gap-xs">
              <button className="btn sm" onClick={newVariant} title="New empty variant">
                + New
              </button>
              <button className="btn sm" onClick={duplicate} title="Duplicate this variant">
                Duplicate
              </button>
              <button className="btn sm danger-ghost" onClick={remove} title="Delete this variant">
                Delete
              </button>
            </div>
          </div>
          <div className="variant-pills">
            {db.variants.map((v) => (
              <button
                key={v.id}
                className={`pill ${v.id === vid ? "active" : ""}`}
                onClick={() => pick(v.id)}
                style={{ ["--pill" as string]: `#${v.accent}` }}
              >
                <span className="pill-dot" />
                {v.name}
              </button>
            ))}
          </div>
          <label className="field">
            <span>Name</span>
            <input value={variant.name} onChange={(e) => editVariant((v) => void (v.name = e.target.value))} />
          </label>
          <label className="field">
            <span>Target tags — what this resume is for</span>
            <TagInput
              value={variant.targetTags}
              suggestions={tags}
              onChange={(t) => editVariant((v) => void (v.targetTags = t))}
            />
          </label>
          <div className="row gap-xs wrap">
            <button className="btn sm primary-ghost" onClick={autoSelect}>
              Auto-select by tags
            </button>
            <button
              className="btn sm"
              onClick={() =>
                editVariant((v, d) =>
                  v.sections.forEach((s) => {
                    s.items = itemsOf(d, s.key).map((i) => i.id);
                    s.enabled = s.items.length > 0;
                  })
                )
              }
            >
              Select all
            </button>
            <button className="btn sm" onClick={() => editVariant((v) => v.sections.forEach((s) => (s.items = [])))}>
              Clear
            </button>
          </div>
        </div>

        {/* Style */}
        <div className="panel">
          <div className="panel-head">
            <h2>Style</h2>
          </div>
          <div className="swatches">
            {ACCENTS.map((a) => (
              <button
                key={a.hex}
                title={a.name}
                className={`swatch ${variant.accent.toUpperCase() === a.hex ? "active" : ""}`}
                style={{ background: `#${a.hex}` }}
                onClick={() => editVariant((v) => void (v.accent = a.hex))}
              />
            ))}
            <label className="swatch custom" title="Custom colour">
              <input
                type="color"
                value={`#${variant.accent}`}
                onChange={(e) => editVariant((v) => void (v.accent = e.target.value.slice(1).toUpperCase()))}
              />
            </label>
          </div>
          <div className="row gap-s">
            <label className="field inline">
              <span>Font</span>
              <select
                value={variant.fontSize}
                onChange={(e) => editVariant((v) => void (v.fontSize = e.target.value as Variant["fontSize"]))}
              >
                <option value="11pt">11pt (template)</option>
                <option value="10pt">10pt (fit more)</option>
              </select>
            </label>
            <label className="field inline">
              <span>Max pages</span>
              <select
                value={variant.maxPages ?? 2}
                onChange={(e) => editVariant((v) => void (v.maxPages = Number(e.target.value)))}
                title="Auto-fit shrinks the resume so it never goes past this"
              >
                <option value={1}>1 page (hard)</option>
                <option value={2}>2 pages (hard)</option>
                <option value={0}>No limit</option>
              </select>
            </label>
            <label className="field inline">
              <span>Paper</span>
              <select
                value={variant.paper}
                onChange={(e) => editVariant((v) => void (v.paper = e.target.value as Variant["paper"]))}
              >
                <option value="letterpaper">US Letter</option>
                <option value="a4paper">A4</option>
              </select>
            </label>
          </div>
        </div>

        {view === "score" ? (
          <ScorePanel db={db} variant={variant} pages={preview?.pages} onReorder={applySectionOrder} />
        ) : view === "timeline" ? (
          <Timeline db={db} variant={variant} editVariant={editVariant} />
        ) : (
          <>
        {/* Sections + items */}
        <div className="panel">
          <div className="panel-head">
            <h2>Content</h2>
            <label className="check sm">
              <input type="checkbox" checked={onlyMatching} onChange={(e) => setOnlyMatching(e.target.checked)} />
              only matching tags
            </label>
          </div>
          <input className="search" placeholder="Filter items…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>

        {variant.sections.map((s, idx) => (
          <SectionBlock
            key={s.key}
            db={db}
            variant={variant}
            section={s}
            index={idx}
            count={variant.sections.length}
            hidden={hidden}
            expanded={expanded}
            setExpanded={setExpanded}
            query={q}
            onlyMatching={onlyMatching}
            editVariant={editVariant}
            moveSection={moveSection}
          />
        ))}
        </>
        )}
        <div className="tips">
          <h3>Tips</h3>
          <ol>
            <li>Add anything new in the <Link href="/library">Library</Link>, tag it, then tick it here.</li>
            <li>Open an entry to switch single bullets on or off for this resume.</li>
            <li>Keep it to one page: untick projects, or drop to 10pt.</li>
            <li>On a two-page resume, put Skills above Experience so page one sells you.</li>
          </ol>
        </div>
      </aside>

      <main className="preview">
        <div className="preview-bar">
          <button className="btn primary" onClick={() => run("preview")} disabled={busy}>
            {busy ? "Compiling…" : "Recompile"}
          </button>
          <label className="check">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            Auto
          </label>
          {preview && (
            <>
              <span className={`badge ${preview.maxPages && preview.pages > preview.maxPages ? "bad" : preview.pages > 1 ? "warn" : "ok"}`}>
                {preview.pages} page{preview.pages === 1 ? "" : "s"}
                {preview.maxPages ? ` / ${preview.maxPages}` : ""}
              </span>
              {preview.fit.label && preview.fit.label !== "as written" && (
                <span
                  className={`badge ${preview.fit.ok ? "fit" : "bad"}`}
                  title={[
                    (preview.fit.ok ? "Auto-fit applied: " : "Could not fit! ") + preview.fit.label,
                    ...preview.fit.notes,
                    `${preview.fit.attempts} compile(s)`,
                  ].join("\n")}
                >
                  {preview.fit.ok ? "auto-fit: " : "overflow: "}
                  {preview.fit.label}
                </span>
              )}
              {preview.pages > 1 && skillsBelowExperience && (
                <button className="btn sm primary-ghost" onClick={swapSkills} title="Recommended on 2-page resumes">
                  Skills above Experience
                </button>
              )}
              {preview.overflows > 0 && (
                <span className="badge warn" title="A heading or line is wider than the page — shorten the tech stack line or title">
                  {preview.overflows} line overflow{preview.overflows > 1 ? "s" : ""}
                </span>
              )}
            </>
          )}
          <div className="spacer" />
          <button className="btn" onClick={() => run("tex")} title="Download the LaTeX source (opens in Overleaf)">
            .tex
          </button>
          <button className="btn primary" onClick={() => run("pdf")} disabled={busy} title="Compile and download the PDF">
            Download PDF
          </button>
        </div>
        {error && (
          <div className="notice err">
            <strong>Compile error</strong>
            <pre>{error}</pre>
          </div>
        )}
        <div className="pdf-frame">
          {preview ? (
            <iframe key={preview.url} src={`${preview.url}#toolbar=0&view=FitH`} title="Resume preview" />
          ) : (
            <div className="empty-state">{busy ? "Compiling with pdflatex…" : "Preview will appear here."}</div>
          )}
          {busy && preview && <div className="busy-overlay">Compiling…</div>}
        </div>
      </main>
      </div>
    </>
  );
}

function SectionBlock({
  db,
  variant,
  section: s,
  index,
  count,
  hidden,
  expanded,
  setExpanded,
  query,
  onlyMatching,
  editVariant,
  moveSection,
}: {
  db: Db;
  variant: Variant;
  section: VariantSection;
  index: number;
  count: number;
  hidden: Set<string>;
  expanded: Set<string>;
  setExpanded: (fn: (s: Set<string>) => Set<string>) => void;
  query: string;
  onlyMatching: boolean;
  editVariant: (fn: (v: Variant, d: Db) => void) => void;
  moveSection: (i: number, dir: -1 | 1) => void;
}) {
  const def = SECTION_DEFS[s.key];
  const all = itemsOf(db, s.key);
  const byId = new Map(all.map((i) => [i.id, i]));
  const selected = s.items.map((id) => byId.get(id)).filter(Boolean) as AnyItem[];
  const rest = all.filter((i) => !s.items.includes(i.id));
  const [open, setOpen] = useState(true);

  const visible = (i: AnyItem) => {
    if (onlyMatching && variant.targetTags.length && !matchesTags(i, variant.targetTags)) return false;
    if (!query) return true;
    return JSON.stringify(i).toLowerCase().includes(query);
  };

  const editSection = (fn: (sec: VariantSection) => void) =>
    editVariant((v) => {
      const sec = v.sections.find((x) => x.key === s.key);
      if (sec) fn(sec);
    });

  const toggleItem = (id: string) =>
    editSection((sec) => {
      sec.items = sec.items.includes(id) ? sec.items.filter((x) => x !== id) : [...sec.items, id];
      if (sec.items.length) sec.enabled = true;
    });

  const moveItem = (id: string, dir: -1 | 1) =>
    editSection((sec) => {
      const i = sec.items.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= sec.items.length) return;
      [sec.items[i], sec.items[j]] = [sec.items[j], sec.items[i]];
    });

  const toggleBullet = (bid: string) =>
    editVariant((v) => {
      v.hiddenBullets = v.hiddenBullets.includes(bid)
        ? v.hiddenBullets.filter((x) => x !== bid)
        : [...v.hiddenBullets, bid];
    });

  const row = (item: AnyItem, isSel: boolean, pos: number) => {
    const bullets = ((item as { bullets?: Bullet[] }).bullets ?? []).filter((b) => b.text.trim());
    const isOpen = expanded.has(item.id);
    const shown = bullets.filter((b) => !hidden.has(b.id)).length;
    const match = variant.targetTags.length > 0 && matchesTags(item, variant.targetTags);
    return (
      <li key={item.id} className={`item ${isSel ? "sel" : ""}`}>
        <div className="item-row">
          <input type="checkbox" checked={isSel} onChange={() => toggleItem(item.id)} />
          <button
            className="item-main"
            onClick={() =>
              bullets.length
                ? setExpanded((e) => {
                    const n = new Set(e);
                    if (n.has(item.id)) n.delete(item.id);
                    else n.add(item.id);
                    return n;
                  })
                : toggleItem(item.id)
            }
          >
            <span className="item-title">
              {match && <span className="match-dot" title="Matches this variant's tags" />}
              {def.summary(item)}
            </span>
            {def.sub(item) && <span className="item-sub">{def.sub(item)}</span>}
            <span className="item-meta">
              {item.tags.map((t) => (
                <span key={t} className={`chip xs ${variant.targetTags.includes(t) ? "hit" : ""}`}>
                  {t}
                </span>
              ))}
              {bullets.length > 0 && (
                <span className="bullet-count">
                  {isOpen ? "▾" : "▸"} {shown}/{bullets.length} bullets
                </span>
              )}
              {item.note && <span className="note-flag" title={item.note}>note</span>}
            </span>
          </button>
          {isSel && (
            <span className="order">
              <button disabled={pos === 0} onClick={() => moveItem(item.id, -1)} aria-label="Move up">
                ↑
              </button>
              <button disabled={pos === s.items.length - 1} onClick={() => moveItem(item.id, 1)} aria-label="Move down">
                ↓
              </button>
            </span>
          )}
        </div>
        {isOpen && (
          <ul className="bullets">
            {bullets.map((b) => (
              <li key={b.id}>
                <label className={hidden.has(b.id) ? "off" : ""}>
                  <input type="checkbox" checked={!hidden.has(b.id)} onChange={() => toggleBullet(b.id)} />
                  <span>
                    {b.text}
                    {b.tags?.map((t) => (
                      <span key={t} className={`chip xs ${variant.targetTags.includes(t) ? "hit" : ""}`}>
                        {t}
                      </span>
                    ))}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  };

  const selVisible = selected.filter(visible);
  const restVisible = rest.filter(visible);

  return (
    <div className={`panel section ${s.enabled ? "" : "disabled"}`}>
      <div className="section-head">
        <input
          type="checkbox"
          checked={s.enabled}
          title="Include this section"
          onChange={(e) => editSection((sec) => void (sec.enabled = e.target.checked))}
        />
        <input
          className="section-title"
          value={s.title}
          onChange={(e) => editSection((sec) => void (sec.title = e.target.value))}
          title="Section heading as printed"
        />
        <span className="count">
          {selected.length}/{all.length}
        </span>
        <span className="order">
          <button disabled={index === 0} onClick={() => moveSection(index, -1)} aria-label="Move section up">
            ↑
          </button>
          <button disabled={index === count - 1} onClick={() => moveSection(index, 1)} aria-label="Move section down">
            ↓
          </button>
        </span>
        <button className="collapse" onClick={() => setOpen(!open)} aria-label="Collapse">
          {open ? "−" : "+"}
        </button>
      </div>
      {open && (
        <>
          {all.length === 0 && (
            <p className="hint">
              Nothing in {def.label} yet — <Link href={`/library?s=${s.key}`}>add some</Link>.
            </p>
          )}
          <ul className="items">
            {selVisible.map((i) => row(i, true, s.items.indexOf(i.id)))}
            {restVisible.length > 0 && selVisible.length > 0 && <li className="divider">not included</li>}
            {restVisible.map((i) => row(i, false, -1))}
          </ul>
        </>
      )}
    </div>
  );
}
