"use client";

import { useMemo, useState } from "react";
import { sortValue, spanOf, yearOf } from "@/lib/dates";
import { SECTION_DEFS, itemsOf, matchesTags } from "@/lib/sections";
import type { AnyItem, Bullet, Db, SectionKey, Variant } from "@/lib/types";

/** Sections that live on the timeline. Summary and Skills have no dates, so they stay in the Sections view. */
const DATED: SectionKey[] = ["education", "experience", "projects", "publications", "leadership", "achievements", "certifications", "awards"];

interface Entry {
  key: SectionKey;
  item: AnyItem;
  span: ReturnType<typeof spanOf>;
  year: number | null;
  sort: number;
}

export function Timeline({
  db,
  variant,
  editVariant,
}: {
  db: Db;
  variant: Variant;
  editVariant: (fn: (v: Variant, d: Db) => void) => void;
}) {
  const [filters, setFilters] = useState<string[]>([]);
  const [newestFirst, setNewestFirst] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = [];
    for (const key of DATED)
      for (const item of itemsOf(db, key)) {
        const span = spanOf(item as unknown as Record<string, unknown>);
        list.push({ key, item, span, year: yearOf(span), sort: sortValue(span) });
      }
    return list;
  }, [db]);

  // Tags actually present on timeline entries, so the filter bar only offers useful ones.
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries) for (const t of e.item.tags ?? []) if (t !== "all") counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  }, [entries]);

  const selectedIds = useMemo(() => {
    const map = new Map<SectionKey, Set<string>>();
    for (const s of variant.sections) map.set(s.key, new Set(s.items));
    return map;
  }, [variant]);

  const shown = entries.filter((e) => !filters.length || matchesTags(e.item, filters));
  const dated = shown.filter((e) => e.year !== null).sort((a, b) => (newestFirst ? b.sort - a.sort : a.sort - b.sort));
  const undated = shown.filter((e) => e.year === null);

  // Group consecutive entries by year so each year gets one sticky marker.
  const groups: { year: number; items: Entry[] }[] = [];
  for (const e of dated) {
    const last = groups[groups.length - 1];
    if (last && last.year === e.year) last.items.push(e);
    else groups.push({ year: e.year!, items: [e] });
  }

  const toggle = (key: SectionKey, id: string) =>
    editVariant((v) => {
      const sec = v.sections.find((s) => s.key === key);
      if (!sec) return;
      sec.items = sec.items.includes(id) ? sec.items.filter((x) => x !== id) : [...sec.items, id];
      if (sec.items.length) sec.enabled = true;
    });

  const toggleBullet = (bid: string) =>
    editVariant((v) => {
      v.hiddenBullets = v.hiddenBullets.includes(bid) ? v.hiddenBullets.filter((x) => x !== bid) : [...v.hiddenBullets, bid];
    });

  const setShown = (on: boolean) =>
    editVariant((v) => {
      for (const sec of v.sections) {
        const ids = shown.filter((e) => e.key === sec.key).map((e) => e.item.id);
        if (!ids.length) continue;
        sec.items = on ? [...new Set([...sec.items, ...ids])] : sec.items.filter((id) => !ids.includes(id));
        if (sec.items.length) sec.enabled = true;
      }
    });

  const hidden = new Set(variant.hiddenBullets);
  const selectedCount = shown.filter((e) => selectedIds.get(e.key)?.has(e.item.id)).length;

  return (
    <div className="timeline">
      <div className="tl-filters panel">
        <div className="panel-head">
          <h2>Show entries for</h2>
          <span className="count">
            {selectedCount}/{shown.length} on this resume
          </span>
        </div>
        <div className="tl-chips">
          <button className={`pill ${filters.length === 0 ? "active" : ""}`} onClick={() => setFilters([])}>
            Everything
          </button>
          {tags.map((t) => (
            <button
              key={t}
              className={`pill ${filters.includes(t) ? "active" : ""}`}
              onClick={() => setFilters((f) => (f.includes(t) ? f.filter((x) => x !== t) : [...f, t]))}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="row gap-xs wrap tl-actions">
          <button className="btn sm" onClick={() => setNewestFirst((v) => !v)}>
            {newestFirst ? "Newest first ↓" : "Oldest first ↑"}
          </button>
          <button className="btn sm" onClick={() => setShown(true)}>
            Tick all shown
          </button>
          <button className="btn sm ghost" onClick={() => setShown(false)}>
            Untick all shown
          </button>
        </div>
        {filters.length > 0 && (
          <p className="hint">
            Showing anything tagged {filters.join(" or ")} (plus entries tagged <code>all</code>). Entries with several
            tags show up under each of them.
          </p>
        )}
      </div>

      <div className="tl-rail">
        {groups.map((g) => (
          <section key={`${g.year}-${g.items[0].item.id}`} className="tl-group">
            <div className="tl-year">
              <span className="tl-year-badge">{g.year}</span>
            </div>
            {g.items.map((e) => (
              <TimelineCard
                key={e.item.id}
                entry={e}
                selected={!!selectedIds.get(e.key)?.has(e.item.id)}
                onToggle={() => toggle(e.key, e.item.id)}
                open={open.has(e.item.id)}
                onOpen={() =>
                  setOpen((s) => {
                    const n = new Set(s);
                    n.has(e.item.id) ? n.delete(e.item.id) : n.add(e.item.id);
                    return n;
                  })
                }
                hidden={hidden}
                onToggleBullet={toggleBullet}
                targetTags={variant.targetTags}
              />
            ))}
          </section>
        ))}

        {undated.length > 0 && (
          <section className="tl-group">
            <div className="tl-year">
              <span className="tl-year-badge muted">No date</span>
            </div>
            {undated.map((e) => (
              <TimelineCard
                key={e.item.id}
                entry={e}
                selected={!!selectedIds.get(e.key)?.has(e.item.id)}
                onToggle={() => toggle(e.key, e.item.id)}
                open={open.has(e.item.id)}
                onOpen={() =>
                  setOpen((s) => {
                    const n = new Set(s);
                    n.has(e.item.id) ? n.delete(e.item.id) : n.add(e.item.id);
                    return n;
                  })
                }
                hidden={hidden}
                onToggleBullet={toggleBullet}
                targetTags={variant.targetTags}
              />
            ))}
            <p className="hint">Add a date to these in the Library and they will slot into the timeline.</p>
          </section>
        )}

        {!shown.length && <div className="empty-state">Nothing matches these tags.</div>}
      </div>
    </div>
  );
}

function TimelineCard({
  entry,
  selected,
  onToggle,
  open,
  onOpen,
  hidden,
  onToggleBullet,
  targetTags,
}: {
  entry: Entry;
  selected: boolean;
  onToggle: () => void;
  open: boolean;
  onOpen: () => void;
  hidden: Set<string>;
  onToggleBullet: (id: string) => void;
  targetTags: string[];
}) {
  const def = SECTION_DEFS[entry.key];
  const bullets = ((entry.item as { bullets?: Bullet[] }).bullets ?? []).filter((b) => b.text.trim());
  const shownBullets = bullets.filter((b) => !hidden.has(b.id)).length;
  return (
    <article className={`tl-card ${selected ? "sel" : ""}`}>
      <span className="tl-dot" />
      <label className="tl-check">
        <input type="checkbox" checked={selected} onChange={onToggle} />
      </label>
      <div className="tl-body">
        <div className="tl-top">
          <span className="tl-kind">{def.label}</span>
          {entry.span.label && <span className="tl-date">{entry.span.label}</span>}
          {entry.span.ongoing && <span className="tl-now">ongoing</span>}
        </div>
        <h4>{def.summary(entry.item)}</h4>
        {def.sub(entry.item) && <p className="item-sub">{def.sub(entry.item)}</p>}
        <div className="item-meta">
          {(entry.item.tags ?? []).map((t) => (
            <span key={t} className={`chip xs ${targetTags.includes(t) ? "hit" : ""}`}>
              {t}
            </span>
          ))}
          {entry.item.note && (
            <span className="note-flag" title={entry.item.note}>
              note
            </span>
          )}
          {bullets.length > 0 && (
            <button className="bullet-count" onClick={onOpen}>
              {open ? "▾" : "▸"} {shownBullets}/{bullets.length} bullets
            </button>
          )}
        </div>
        {open && bullets.length > 0 && (
          <ul className="bullets">
            {bullets.map((b) => (
              <li key={b.id}>
                <label className={hidden.has(b.id) ? "off" : ""}>
                  <input type="checkbox" checked={!hidden.has(b.id)} onChange={() => onToggleBullet(b.id)} />
                  <span>{b.text}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
