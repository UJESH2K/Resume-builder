"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Db } from "@/lib/types";

type Status = "loading" | "saved" | "dirty" | "saving" | "error" | "conflict" | "offline";

interface Ctx {
  db: Db | null;
  status: Status;
  update: (fn: (draft: Db) => void) => void;
  /** Throw away this tab's edits and take the version stored on the server. */
  reloadFromServer: () => Promise<void>;
  /** Force this tab's version over whatever the server has. */
  overwriteServer: () => Promise<void>;
}

const DbContext = createContext<Ctx | null>(null);

export function useDb() {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error("useDb outside DbProvider");
  return ctx;
}

/**
 * Holds the signed-in student's whole library in memory and autosaves it to their
 * Supabase row through /api/db.
 *
 * `rev` is a counter on that row, bumped by a database trigger on every save. The save
 * is conditional on the rev this tab last saw, so if the student has the app open on a
 * phone and a laptop, the second save gets a 409 instead of silently wiping the first.
 */
export function DbProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<Db | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const ref = useRef<Db | null>(null);
  const dirty = useRef(false);
  const saving = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const replace = (d: Db) => {
    ref.current = d;
    dirty.current = false;
    setDb(d);
    setStatus("saved");
  };

  /** null means "not signed in any more" — the caller shows a log-in prompt. */
  const fetchDb = async (): Promise<Db | null> => {
    const r = await fetch("/api/db", { cache: "no-store" });
    if (r.status === 401) return null;
    if (!r.ok) throw new Error(await r.text());
    return (await r.json()) as Db;
  };

  const save = useCallback(async (force = false) => {
    if (saving.current || !ref.current) return;
    saving.current = true;
    const snap = ref.current;
    setStatus("saving");
    try {
      const r = await fetch("/api/db", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ db: snap, force }),
      });
      if (r.status === 401) {
        setStatus("offline");
        return;
      }
      if (r.status === 409) {
        setStatus("conflict");
        return;
      }
      if (!r.ok) throw new Error(await r.text());
      const { rev } = (await r.json()) as { rev: number };
      snap.rev = rev;
      if (ref.current !== snap) ref.current.rev = rev; // edits made while saving
      dirty.current = ref.current !== snap;
      setStatus(dirty.current ? "dirty" : "saved");
    } catch {
      setStatus("error");
    } finally {
      saving.current = false;
      // Retry/flush whatever was typed while the request was in flight.
      if (dirty.current) timer.current = setTimeout(() => save(), 400);
    }
  }, []);

  const update = useCallback(
    (fn: (draft: Db) => void) => {
      if (!ref.current) return;
      const next = structuredClone(ref.current);
      fn(next);
      ref.current = next;
      dirty.current = true;
      setDb(next);
      setStatus((s) => (s === "conflict" || s === "offline" ? s : "dirty"));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => save(), 600);
    },
    [save]
  );

  const reloadFromServer = useCallback(async () => {
    const fresh = await fetchDb();
    if (fresh) replace(fresh);
    else setStatus("offline");
  }, []);

  const overwriteServer = useCallback(async () => {
    await save(true);
  }, [save]);

  useEffect(() => {
    fetchDb()
      .then((d) => (d ? replace(d) : setStatus("offline")))
      .catch(() => setStatus("error"));

    /**
     * Pick up edits made on the student's other device. Only on focus — a background
     * poll would mean every open tab hitting the database forever, which does not scale
     * to a whole college.
     */
    const check = async () => {
      if (dirty.current || saving.current || !ref.current) return;
      const fresh = await fetchDb().catch(() => null);
      if (fresh && fresh.rev !== ref.current.rev && !dirty.current) replace(fresh);
    };
    const onVis = () => document.visibilityState === "visible" && check();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVis);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);

  return (
    <DbContext.Provider value={{ db, status, update, reloadFromServer, overwriteServer }}>
      {children}
    </DbContext.Provider>
  );
}
