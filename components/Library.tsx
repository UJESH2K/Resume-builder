"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { SECTION_DEFS, SECTION_ORDER, allTags, itemsOf, newBullet, uid, type Field } from "@/lib/sections";
import type { AnyItem, Bullet, Db, Profile, SectionKey } from "@/lib/types";
import { PageHead } from "./AppShell";
import { useDb } from "./DbProvider";
import { TagInput } from "./TagInput";

type Tab = "profile" | SectionKey;

const PROFILE_FIELDS: { key: keyof Profile; label: string; placeholder?: string }[] = [
  { key: "name", label: "Full name" },
  { key: "phone", label: "Phone", placeholder: "+91 98xxxxxxxx" },
  { key: "email", label: "Email" },
  { key: "linkedin", label: "LinkedIn URL" },
  { key: "github", label: "GitHub URL" },
  { key: "portfolio", label: "Portfolio URL (optional)" },
  { key: "location", label: "Location (optional)", placeholder: "Bangalore, India" },
];

export function Library() {
  const { db, update } = useDb();
  const params = useSearchParams();
  const router = useRouter();
  const tab = ((params.get("s") as Tab) || "profile") as Tab;
  const [selId, setSelId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const tags = useMemo(() => (db ? allTags(db) : []), [db]);

  if (!db) return <div className="empty-state">Loading your library…</div>;

  const setTab = (t: Tab) => {
    setSelId(null);
    setQuery("");
    router.replace(t === "profile" ? "/library" : `/library?s=${t}`);
  };

  const label = tab === "profile" ? "Profile" : SECTION_DEFS[tab].label;

  return (
    <>
      <PageHead
        crumb="Library"
        title={label}
        subtitle="Everything you have ever done, tagged once and reused in every resume."
      />
      <nav className="lib-tabs">
        <button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}>
          Profile
        </button>
        {SECTION_ORDER.map((k) => (
          <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
            {SECTION_DEFS[k].label}
            <span className="count">{itemsOf(db, k).length}</span>
          </button>
        ))}
      </nav>

      <div className={`library${tab === "profile" ? " single" : ""}`}>
        {tab === "profile" ? (
          <section className="lib-editor wide">
            <h2>Profile &amp; contact</h2>
            <p className="hint">Printed in the header of every resume.</p>
            <div className="form-grid">
              {PROFILE_FIELDS.map((f) => (
                <label key={f.key} className="field half">
                  <span>{f.label}</span>
                  <input
                    value={db.profile[f.key] ?? ""}
                    placeholder={f.placeholder}
                    onChange={(e) => update((d) => void (d.profile[f.key] = e.target.value))}
                  />
                </label>
              ))}
            </div>
            <div className="fmt-help">
              Formatting anywhere: <code>**bold**</code> <code>__underline__</code> <code>*italic*</code>{" "}
              <code>`code`</code> <code>[label](https://…)</code> — or select text and press <strong>Link</strong>.
            </div>
          </section>
        ) : (
          <SectionEditor
            key={tab}
            db={db}
            sectionKey={tab}
            selId={selId}
            setSelId={setSelId}
            query={query}
            setQuery={setQuery}
            tags={tags}
          />
        )}
      </div>
    </>
  );
}

function SectionEditor({
  db,
  sectionKey,
  selId,
  setSelId,
  query,
  setQuery,
  tags,
}: {
  db: Db;
  sectionKey: SectionKey;
  selId: string | null;
  setSelId: (id: string | null) => void;
  query: string;
  setQuery: (q: string) => void;
  tags: string[];
}) {
  const { update } = useDb();
  const def = SECTION_DEFS[sectionKey];
  const items = itemsOf(db, sectionKey);
  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((i) => JSON.stringify(i).toLowerCase().includes(q)) : items;
  const current = items.find((i) => i.id === selId) ?? null;

  const list = (d: Db) => d[sectionKey] as AnyItem[];

  const add = () => {
    const item = def.blank();
    update((d) => void list(d).unshift(item));
    setSelId(item.id);
  };

  const duplicate = (it: AnyItem) => {
    const copy = structuredClone(it) as AnyItem & { bullets?: Bullet[] };
    copy.id = uid(sectionKey.slice(0, 4) + "_");
    if (copy.bullets) copy.bullets = copy.bullets.map((b) => ({ ...b, id: uid("b_") }));
    update((d) => void list(d).splice(list(d).findIndex((x) => x.id === it.id) + 1, 0, copy));
    setSelId(copy.id);
  };

  const remove = (it: AnyItem) => {
    if (!confirm(`Delete "${def.summary(it)}" from your library? It will disappear from every variant.`)) return;
    update((d) => {
      (d[sectionKey] as AnyItem[]) = list(d).filter((x) => x.id !== it.id);
      const bulletIds = new Set(((it as { bullets?: Bullet[] }).bullets ?? []).map((b) => b.id));
      for (const v of d.variants) {
        for (const s of v.sections) s.items = s.items.filter((x) => x !== it.id);
        v.hiddenBullets = v.hiddenBullets.filter((b) => !bulletIds.has(b));
      }
    });
    setSelId(null);
  };

  const move = (id: string, dir: -1 | 1) =>
    update((d) => {
      const arr = list(d);
      const i = arr.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    });

  const edit = (fn: (item: any) => void) =>
    update((d) => {
      const it = list(d).find((x) => x.id === selId);
      if (it) fn(it);
    });

  return (
    <>
      <section className="lib-list">
        <div className="lib-list-head">
          <h2>{def.label}</h2>
          <button className="btn primary sm" onClick={add}>
            + Add
          </button>
        </div>
        <input className="search" placeholder={`Search ${def.label.toLowerCase()}…`} value={query} onChange={(e) => setQuery(e.target.value)} />
        <ul className="lib-items">
          {shown.map((it) => (
            <li key={it.id} className={it.id === selId ? "active" : ""}>
              <button className="lib-item" onClick={() => setSelId(it.id)}>
                <span className="item-title">{def.summary(it)}</span>
                {def.sub(it) && <span className="item-sub">{def.sub(it)}</span>}
                <span className="item-meta">
                  {it.tags.map((t) => (
                    <span key={t} className="chip xs">
                      {t}
                    </span>
                  ))}
                  {it.note && <span className="note-flag">note</span>}
                </span>
              </button>
              {!q && (
                <span className="order vertical">
                  <button onClick={() => move(it.id, -1)} aria-label="Move up">
                    ↑
                  </button>
                  <button onClick={() => move(it.id, 1)} aria-label="Move down">
                    ↓
                  </button>
                </span>
              )}
            </li>
          ))}
          {!shown.length && <li className="hint pad">{items.length ? "No matches." : "Nothing here yet — click + Add."}</li>}
        </ul>
      </section>

      <section className="lib-editor">
        {current ? (
          <>
            <div className="lib-list-head">
              <h2>{def.summary(current)}</h2>
              <div className="row gap-xs">
                <button className="btn sm" onClick={() => duplicate(current)}>
                  Duplicate
                </button>
                <button className="btn sm danger-ghost" onClick={() => remove(current)}>
                  Delete
                </button>
              </div>
            </div>
            <div className="form-grid">
              {def.fields.map((f) => (
                <FieldEditor key={f.key} field={f} item={current} edit={edit} tags={tags} />
              ))}
            </div>
            <VariantMembership db={db} sectionKey={sectionKey} itemId={current.id} />
          </>
        ) : (
          <div className="empty-state">Select an entry to edit it, or click + Add.</div>
        )}
      </section>
    </>
  );
}

/**
 * Wraps the current selection (or the whole value) in [label](url) markdown.
 * Works on any text input or textarea, so anything printed can become a link.
 */
function LinkButton({ target, onChange }: { target: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>; onChange: (v: string) => void }) {
  const insert = () => {
    const el = target.current;
    if (!el) return;
    const value = el.value ?? "";
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const selected = start !== end ? value.slice(start, end) : "";
    const label = selected || window.prompt("Text to show as the link", "") || "";
    if (!label.trim()) return;
    const url = window.prompt(`Link for “${label.trim()}”`, "https://");
    if (!url || url === "https://") return;
    const md = `[${label.trim()}](${url.trim()})`;
    onChange(selected ? value.slice(0, start) + md + value.slice(end) : value + (value && !value.endsWith(" ") ? " " : "") + md);
  };
  return (
    <button type="button" className="link-btn" onClick={insert} title="Select text first, then add a link">
      Link
    </button>
  );
}

function FieldEditor({
  field: f,
  item,
  edit,
  tags,
}: {
  field: Field;
  item: any;
  edit: (fn: (item: any) => void) => void;
  tags: string[];
}) {
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const cls = `field ${f.half ? "half" : "full"}`;
  const linkable = f.type === "text" || f.type === "textarea";
  const labelRow = (
    <span className="field-label">
      {f.label}
      {linkable && !/link/i.test(f.key) && <LinkButton target={ref} onChange={(v) => edit((it) => void (it[f.key] = v))} />}
    </span>
  );
  if (f.type === "tags")
    return (
      <label className={cls}>
        <span>{f.label}</span>
        <TagInput value={item.tags ?? []} suggestions={tags} onChange={(t) => edit((it) => void (it.tags = t))} />
      </label>
    );
  if (f.type === "bullets") return <BulletsEditor bullets={item.bullets ?? []} edit={edit} label={f.label} tags={tags} />;
  if (f.type === "textarea")
    return (
      <label className={cls}>
        {labelRow}
        <textarea
          ref={ref as React.RefObject<HTMLTextAreaElement>}
          rows={f.key === "note" ? 2 : 3}
          value={item[f.key] ?? ""}
          placeholder={f.placeholder}
          onChange={(e) => edit((it) => void (it[f.key] = e.target.value))}
        />
      </label>
    );
  return (
    <label className={cls}>
      {labelRow}
      <input
        ref={ref as React.RefObject<HTMLInputElement>}
        value={item[f.key] ?? ""}
        placeholder={f.placeholder}
        onChange={(e) => edit((it) => void (it[f.key] = e.target.value))}
      />
    </label>
  );
}

function BulletText({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  return (
    <div className="bullet-text">
      <textarea
        ref={ref}
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Did X using Y, resulting in Z"
      />
      <LinkButton target={ref} onChange={onChange} />
    </div>
  );
}

function BulletsEditor({
  bullets,
  edit,
  label,
  tags,
}: {
  bullets: Bullet[];
  edit: (fn: (item: any) => void) => void;
  label: string;
  tags: string[];
}) {
  const [bulk, setBulk] = useState<string | null>(null);
  const move = (i: number, dir: -1 | 1) =>
    edit((it) => {
      const j = i + dir;
      if (j < 0 || j >= it.bullets.length) return;
      [it.bullets[i], it.bullets[j]] = [it.bullets[j], it.bullets[i]];
    });
  return (
    <div className="field full">
      <span>{label}</span>
      <ol className="bullet-editor">
        {bullets.map((b, i) => (
          <li key={b.id}>
            <div className="bullet-body">
              <BulletText
                value={b.text}
                onChange={(v) => edit((it) => void (it.bullets[i].text = v))}
              />
              <TagInput
                value={b.tags ?? []}
                suggestions={tags}
                placeholder="bullet tags (optional — blank = always shown)"
                onChange={(t) => edit((it) => void (it.bullets[i].tags = t))}
              />
            </div>
            <span className="order vertical">
              <button disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                ↑
              </button>
              <button disabled={i === bullets.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                ↓
              </button>
              <button className="x" onClick={() => edit((it) => void it.bullets.splice(i, 1))} aria-label="Remove bullet">
                ×
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div className="row gap-xs">
        <button className="btn sm" onClick={() => edit((it) => void (it.bullets ??= []).push(newBullet()))}>
          + Bullet
        </button>
        <button className="btn sm ghost" onClick={() => setBulk(bulk === null ? "" : null)}>
          Paste many…
        </button>
      </div>
      {bulk !== null && (
        <div className="bulk">
          <textarea
            rows={5}
            autoFocus
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            placeholder={"One bullet per line (leading -, • or * is stripped)"}
          />
          <button
            className="btn sm primary"
            onClick={() => {
              const lines = bulk
                .split(/\r?\n/)
                .map((l) => l.replace(/^\s*([-•*]|\d+[.)])\s+/, "").trim())
                .filter(Boolean);
              edit((it) => void (it.bullets ??= []).push(...lines.map((l) => newBullet(l))));
              setBulk(null);
            }}
          >
            Add {bulk.split(/\r?\n/).filter((l) => l.trim()).length} bullets
          </button>
        </div>
      )}
    </div>
  );
}

function VariantMembership({ db, sectionKey, itemId }: { db: Db; sectionKey: SectionKey; itemId: string }) {
  const { update } = useDb();
  return (
    <div className="membership">
      <span>Included in</span>
      <div className="row gap-xs wrap">
        {db.variants.map((v) => {
          const sec = v.sections.find((s) => s.key === sectionKey);
          const on = !!sec?.items.includes(itemId);
          return (
            <button
              key={v.id}
              className={`pill ${on ? "active" : ""}`}
              style={{ ["--pill" as string]: `#${v.accent}` }}
              onClick={() =>
                update((d) => {
                  const s = d.variants.find((x) => x.id === v.id)?.sections.find((x) => x.key === sectionKey);
                  if (!s) return;
                  s.items = on ? s.items.filter((x) => x !== itemId) : [...s.items, itemId];
                  if (s.items.length) s.enabled = true;
                })
              }
            >
              <span className="pill-dot" />
              {v.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
