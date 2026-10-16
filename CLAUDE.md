# Resume Studio — notes for Claude

Next.js app that builds LaTeX resumes from a per-user JSON library. **Multi-user since the
Supabase migration**: students sign up with email + password, and each account owns one
library document. Built for the user's college, so treat every student's data as private.

## Where the data lives

The library is **no longer a file**. It is one `jsonb` document per user in the Supabase
`libraries` table, with the exact shape of `Db` in `lib/types.ts`. `data/resume-db.json` is
now only a scratch file for the pull/push script below.

- `rev` is a counter on the row, bumped by a database trigger on every save. The client sends
  the rev it last saw and a mismatch returns 409, so two tabs cannot silently overwrite.
- Saves snapshot the previous contents into `library_versions`, throttled to one per 5 minutes
  and capped at 10 per student (migration 0002). The throttle is deliberate: the editor
  autosaves a second after each keystroke, so without it all 30 snapshots came from the last
  two minutes of typing AND 300 students could overrun Supabase's 500MB free database.
  `/api/db/versions` lists and restores them.
- Row level security scopes every query to `auth.uid()`. Postgres refuses other users' rows.

## Adding or changing the user's own career details

The app is the source of truth, so **pull before editing and push after** — otherwise you
overwrite whatever they typed in the app since:

```
node scripts/library.ts pull <your-email>   # Supabase -> data/resume-db.json
# edit data/resume-db.json
node scripts/library.ts push <your-email>   # back into their account
```

A push replaces the whole library (the replaced version is snapshotted, so it is undoable).
Needs `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.

- NEVER run `scripts/seed.ts` against a real library — it builds a fresh document from
  scratch and throws away every edit. It is kept only as a reference for the seed data.
- Keep 2-space JSON and never add a `rev` field to the file.

## Item rules (unchanged)

- Item shapes are in `lib/types.ts`. Sections: `summary`, `education`, `experience`, `projects`,
  `skills`, `awards`, `achievements`, `leadership`, `certifications`, `publications`.
- Publications: `{id, title, authors, venue, status, date, link, linkLabel, bullets, tags}`. Put the user's own name in `**bold**` inside `authors`.
- Every item needs a unique `id` (prefix by section, e.g. `proj_<slug>`) and `tags`. Bullets are `{ id, text, tags? }`.
  Bullet ids must be unique across the whole file (`b_<something>`).
- Keep summaries to 2-3 lines (~230 chars). Links: markdown in any text, plus `link` on education and `link`/`linkLabel` on achievements/certifications.
- Tags drive auto-selection: `ai`, `ml`, `llm`, `cv`, `rag`, `sde`, `fullstack`, `backend`, `cloud`,
  `systems`, `distributed`, `web3`, `freelance`, `data`, `iot`, `security`, `mobile`; `all` = every variant.
- Text supports `**bold**`, `__underline__`, `*italic*`, `` `code` ``, `[label](url)`. Plain `&`, `%`, `#`, `_`, `~`, `₹` are escaped automatically.
- Put anything unverified in the item's `note` field (never printed). Don't invent metrics.
- New items are not automatically in existing variants. Add their id to the relevant
  `variants[].sections[].items` arrays, or tell the user to press "Auto-select by tags".

## Code map

- `lib/latex.ts`: section renderers, escaping. `latex/preamble.tex`: template with `%%PAPER%%`, `%%FONTSIZE%%`, `%%ACCENT%%`.
  Those three placeholders land in LaTeX unescaped, so `buildTex` whitelists them (`safeAccent`
  etc.) — student-supplied values reach this code, and a stray `}` would be an injection.
- `lib/supabase/{client,server,env}.ts`: browser / per-request server clients. Never share a
  server client across requests.
- `lib/auth.ts`: `currentUser()` (cached per render, verifies with the auth server) and
  `requireUser()` (redirects to /login). API routes return 401 instead of redirecting.
- `lib/library.ts`: load/save the user's document, optimistic locking, version history.
- `lib/starter.ts`: the library a new student gets — empty, but with sections and variants
  switched on so the Builder is not a blank page. Never invent achievements for them.
- `proxy.ts`: Next 16's renamed middleware. Refreshes the session and gates pages. It is an
  optimistic check only; the real checks are `requireUser()` plus row level security.
- `lib/ai/extract.ts`: the Quick start importer — pasted prose to library entries. This is the
  ONE place a model writes content, so the guards matter: the prompt forbids inventing dates,
  numbers, employers or metrics; we generate every id ourselves; every field is clipped, tags are
  checked against the known vocabulary and sections are capped (a runaway reply cannot bloat a
  library); every entry gets an unverified `note`; and nothing is saved until the student ticks
  it in the review list. Do not loosen any of that — fabricated lines on a real resume are the
  worst failure this app can have.
- `lib/ai/config.ts` + `components/AiSettings.tsx`: one saved provider/key/model, shared by the
  tailor and the importer. Keys live in the student's browser only.
- `lib/url-guard.ts`: the link importer makes the *server* fetch a URL a student typed, so this
  vets every resolved IP (and every redirect hop) against private, loopback, link-local and
  cloud-metadata ranges. `169.254.169.254` would otherwise hand out instance credentials.
  `lib/html-text.ts` then strips the page (script/style content never reaches the prompt).
- `lib/roles.ts`: the 15 job roles students pick from — tags, page budget, and `focus` (what the
  role is read for, handed to the model as guidance).
- `lib/ai/providers.ts`: Gemini / Groq / OpenRouter / Ollama / OpenAI over plain `fetch`, called
  **from the browser**. The student's API key must never be sent to or stored on our server —
  all five endpoints allow CORS, which is what makes bring-your-own-key safe here.
- `lib/ai/tailor.ts`: the library digest (entry text + tags only — never name, phone, email or
  links), the prompt, and `applyPlan`. The model may ONLY choose and order existing entry ids;
  it cannot write or edit resume text, and any id not in the library is discarded. Keep it that
  way — it is what stops a free model fabricating things onto a student's resume.
  Deterministic tag selection is the floor, so a partial or junk reply still yields a sane
  resume. `CAPS` trims to the page budget up front: without it broad role tags select almost
  the whole library and the auto-fit ladder claws it back over 9-12 pdflatex runs (~10s) ending
  in "one bullet each"; with it, 3-5 runs (~4s) with bullets intact.
- `lib/fit.ts` + `compileFitted()` in `lib/server.ts`: deterministic auto-fit ladder (spacing -> 10pt -> bullet caps -> hide low-priority entries) enforcing `variant.maxPages`. No LLM involved; keep it that way. Multi-page results get one extra compile with the BALANCE block (lushbottom + stretchable section spacing) so page one fills instead of leaving a hole.
- `lib/server.ts`: `pdflatex` runner. Scratch dirs live under the OS temp dir, namespaced per
  user+variant so two students never share one; `COMPILE_CONCURRENCY` (default 2) caps parallel
  runs. Strips PATH entries that point at files (breaks MiKTeX). Runs with `-no-shell-escape`
  and `openin_any=p` — note MiKTeX ignores `openin_any`, so that backstop only applies to the
  TeX Live in the Docker image; the escaping in `lib/latex.ts` is the real control.
- `app/(app)/*` is the signed-in app (sidebar + DbProvider); `app/login`, `app/signup` are
  outside it. Route groups, so URLs are unchanged.
- `app/api/db` (GET/PUT), `app/api/db/versions` (GET/POST), `app/api/compile` (modes: preview | pdf | tex).
  Nothing is written to the server's disk — students download their own PDFs.
- UI shell: `components/AppShell.tsx` (sidebar, breadcrumb `PageHead`, theme toggle, log out); logo at `public/logo.png`.
- `components/Timeline.tsx` + `lib/dates.ts`: chronological picker; dates are free text, parsed loosely.
- `components/Builder.tsx` (variants + preview), `components/Library.tsx` (schema-driven editor from `SECTION_DEFS` in `lib/sections.ts`).
- Check types with `npx tsc --noEmit`. Deployment lives in `Dockerfile` / `fly.toml`: the app
  needs a real container because `pdflatex` cannot run on Vercel-style serverless.

@AGENTS.md
