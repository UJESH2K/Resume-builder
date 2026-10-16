---
title: Resume Studio
emoji: "📄"
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 3000
pinned: false
short_description: Build a LaTeX resume from your own library of achievements
---

# Resume Studio

A resume builder for a whole college. Each student signs up, builds one **library** of their
achievements, jobs, projects and skills, then makes a **variant** per application: pick the
entries (and individual bullets) it needs, preview the real LaTeX PDF, and download it.

Accounts and libraries live in Supabase (Postgres). Row level security means a student can
only ever read or write their own library.

The PDF uses the AlgoUniversity LaTeX template, with the red swapped for a selectable accent
(navy by default).

---

## Setting it up (admin, once)

### 1. Create the Supabase project

1. Sign up at [supabase.com](https://supabase.com) and create a new project (the free tier is
   plenty — it allows 50,000 monthly active users).
2. Pick the region closest to your users (`South Asia (Mumbai)` for India).
3. Save the database password somewhere safe; you will not need it for this app, but you
   cannot see it again.

### 2. Create the tables

Open **SQL Editor → New query**, paste the whole of
[`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql), and press **Run**.
Then do the same with
[`supabase/migrations/0002_snapshot_throttle.sql`](supabase/migrations/0002_snapshot_throttle.sql)
— run them in that order.

That creates `profiles`, `libraries` and `library_versions`, turns on row level security with
self-only policies, and adds the triggers that version each save and create a profile on
sign-up.

### 3. Turn off email confirmation

**Authentication → Sign In / Providers → Email**, and switch **Confirm email** off.

Supabase's built-in mail service is rate limited to a handful of messages per hour, so with
confirmation on, a class of 30 signing up at once will silently fail. With it off, students can
sign up and start immediately. (If you later want confirmation, plug in your own SMTP provider
under **Project Settings → Auth → SMTP** first.)

### 4. Point the app at the project

Copy the template and fill in the values from **Project Settings → API**:

```bash
cp .env.local.example .env.local
```

| Variable | Where it comes from | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | **Data API** → Project URL | Not on the API Keys page — it is under Data API. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **API Keys** → Publishable key (`sb_publishable_…`) | Safe in the browser; RLS is what protects the data. Older projects call this `anon`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY` still works. |
| `SUPABASE_SECRET_KEY` | **API Keys** → Secret key (`sb_secret_…`) | Bypasses RLS. **Never** commit or expose it. Only the CLI scripts use it. Older name `SUPABASE_SERVICE_ROLE_KEY` still works. |

`.env.local` is gitignored.

### 5. Run it

Requirements: Node 20+ and a LaTeX install with `pdflatex` on PATH (MiKTeX on Windows,
TeX Live elsewhere).

```bash
npm install      # first time only
npm run dev      # http://localhost:3000
```

Before signing up, check the backend is wired correctly:

```bash
npm run check
```

That verifies the URL and both keys, that the three tables exist, that row level security really
is blocking anonymous reads and writes, that email confirmation is off, and that the sign-up
trigger fires (it creates a throwaway account and deletes it again — pass `-- --no-probe` to
skip that part). Fix anything it flags, then:

```bash
npm run dev
```

Visit the app, create an account, and you are in.

### 6. Move an existing library into an account

If you were using the old single-user `data/resume-db.json`, sign up first, then:

```bash
npm run library -- push you@example.com
```

---

## Deploying it

The app shells out to `pdflatex`, so **it cannot go on Vercel, Netlify or any serverless
host** — those have no TeX binaries. It needs a container. The included `Dockerfile` installs
the TeX packages the template needs and runs the app as a non-root user.

Note that `NEXT_PUBLIC_*` values are compiled into the browser bundle, so they must be passed
at **build** time, not just at runtime.

See **[DEPLOY.md](DEPLOY.md)** for the full walkthrough: Render, a custom domain, Hugging Face
Spaces and Google Cloud Run, plus the Supabase settings a live site needs.

### Check the container locally

```bash
docker compose up --build        # reads .env.local
```

### Fly.io

```bash
fly launch --no-deploy --copy-config          # edit `app` in fly.toml to a unique name first
fly deploy \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

`fly.toml` asks for a 2 GB shared-cpu-2x machine in Mumbai and keeps one instance warm,
because a cold start has to boot a TeX-laden image. Render and Railway work the same way:
point them at the `Dockerfile` and set the two build arguments.

Sizing: each compile is CPU-bound and takes about a second, and the auto-fit ladder may need
several in a row. `COMPILE_CONCURRENCY` (default 2) caps how many run at once — raise it only
along with CPU count. The image is large (~2 GB) because `texlive-fonts-extra` carries the
FontAwesome and Marvosym fonts the header uses.

---

## How many students can it take?

Measured, not guessed. One resume build is 3-5 `pdflatex` runs, about 4-6 seconds.

| Part | Verdict |
| --- | --- |
| Accounts and logins | Fine. Supabase's free tier allows 50,000 monthly active users. |
| Library storage | Fine. ~50KB per student; 300 students plus capped history lands well inside the 500MB free database. |
| The optional AI steps | Costs the server nothing — the browser calls the provider directly. |
| **Compiling PDFs** | **The only real limit.** |

With `COMPILE_CONCURRENCY=2`, one machine sustains roughly 20-30 resume builds per minute.

- 300 students spread over a day or a week: one machine is plenty.
- A whole class of ~30 editing at the same time: each change re-previews a couple of seconds
  later, so expect 60-120 builds a minute. That wants 3-4 machines.

Because the app keeps nothing on local disk, that is one command: `fly scale count 4`. Scale on
the number of people editing *simultaneously*, not on how many have accounts. If you need to cut
load without adding machines, untick "Auto preview" in the Builder — that is the biggest single
CPU consumer.

---

## Student workflow

1. **Sign up** at `/signup` with a name, email and password. The name is what appears on the
   resume; everything else starts empty.
2. **Quick start** (`/import`) — the fast way in, if filling forms is daunting. Paste anything
   about yourself: a few messy sentences, bullet points, or a copy-paste of an old resume. A
   model turns it into library entries (education, experience, projects, skills, awards,
   certificates), you tick the ones that are right, and they are saved to your library.
   - **Import everything from GitHub**: type a username and it reads every public repository
     and its README in one go — the fastest way to fill a projects section you would otherwise
     retype by hand. Your profile README is read too, as background for skills and awards,
     rather than as a project.
   - You can also give any **link** (a portfolio site) and it pulls the page's text in.
     LinkedIn blocks automated reading, so for that: open your profile, select all, copy, paste.
   - It only uses what you actually wrote. The prompt forbids inventing dates, numbers,
     employers, grades or metrics — if your text has no numbers, neither does the output.
   - **Nothing is saved until you tick it.** Anything already in your library is flagged as a
     duplicate and left unticked, and every imported entry is marked unverified in its private
     note so you remember to check the details.
   - This step needs an API key (see step 4) because it is the model doing the reading.
3. **Library** (`/library`): add or edit your profile, summary, education (CGPA lives here),
   experience, projects, publications, skills, achievements, leadership and certifications.
   - Tag every entry with the roles it suits: `ai`, `ml`, `llm`, `sde`, `fullstack`, `backend`,
     `cloud`, `systems`, `web3`, `freelance`…  Use `all` for things every resume needs.
   - Bullets can have their own tags too. A tagged bullet only appears on variants with a
     matching tag; an untagged bullet always appears.
   - Formatting in text: `**bold**`, `__underline__`, `*italic*`, `` `code` ``, `[label](url)`.
   - "Private note" fields are never printed. Use them for reminders.
   - **Links anywhere**: select text in any field or bullet and press **Link**, or type `[label](url)` yourself.
     Education, achievements and certifications also have their own link fields.
4. **Pick a job role** (`/`, the panel at the top): the answer to "my library is full, now
   what?". Choose from 15 roles — Software Intern, SDE, Backend, Frontend, Full-Stack,
   AI/ML, Data, Cloud/DevOps, Mobile, Web3, Security, IoT, QA, Research, Freelance — and
   press **Build without AI**. That picks the entries matching the role, orders them by how
   well they fit, trims to the role's page budget and compiles. Free, instant, no account
   with anyone else required. It makes one variant per role and reuses it if you build again.

   **Build with AI** (optional) does the same thing but lets a model make the choice. Bring
   your own key:

   | Provider | Cost | Key from |
   | --- | --- | --- |
   | Google Gemini | free tier, no card | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
   | Groq | free | [console.groq.com/keys](https://console.groq.com/keys) |
   | OpenRouter | free models (`:free`) | [openrouter.ai/keys](https://openrouter.ai/keys) |
   | Ollama | free, runs on your laptop | [ollama.com/download](https://ollama.com/download) |
| The built-in model | free, no key at all | only if the admin switched it on |
   | OpenAI | paid | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |

   Your key is used by your own browser and sent **straight to the provider**. It never
   reaches the Resume Studio server and is never stored there; tick "remember" and it stays
   in your browser's local storage on that device only. Only your library's entry text and
   tags are sent to the model — never your name, phone, email or links.

   The model can only **choose and order entries you already wrote**. It cannot write, edit
   or invent resume text: it replies with entry ids, and any id that is not in your library
   is thrown away (the panel tells you when that happened). If it answers badly or not at
   all, you still get the tag-based selection underneath, so the result is never broken.
   Using Ollama from a deployed site needs `OLLAMA_ORIGINS=*` set before `ollama serve`.
5. **Builder** (`/`): pick a variant or create one. New accounts start with Main resume,
   Internship and Everything.
   - **Auto-select by tags** fills the variant from its target tags.
   - Tick or untick entries, expand an entry to toggle single bullets, and use ↑/↓ to reorder
     entries and sections. Section titles are editable.
   - Choose the accent colour, 10/11pt and Letter/A4.
   - Sections print in the standard order: Summary, Education, Experience, Skills, Projects, then
     Publications, then Leadership / Achievements / Certifications. If a resume runs to two pages, the toolbar offers
     **Skills above Experience** in one click.
   - **Auto-fit guarantees the page limit.** Each variant has a "Max pages" setting (default 2).
     If the resume runs long, the app tightens line spacing, then font size, then caps project
     bullets, and only as a last resort hides the lowest-priority entries (extra projects first,
     never education, experience or publications) until it fits. The badge says what it did;
     hover it for the list. Nothing in your library is changed — only that resume's PDF.
   - **Pages stay balanced.** On a multi-page resume the leftover space is shared out between
     sections (`lushbottom`) instead of being dumped as one hole at the bottom of page one, so
     every page ends on the same line. The final page keeps its natural ragged bottom.
   - The preview recompiles automatically. The page-count badge warns when you pass one page,
     and the overflow badge warns when a heading runs past the margin.
   - **Timeline view** (top right toggle, or `/?view=timeline`): every dated entry on one
     chronological rail, oldest first, with a sticky year marker as you scroll. Filter by role
     (`ai`, `sde`, `web3`…) at the top — an entry tagged both `ai` and `sde` shows under both —
     then tick what belongs on this resume. "Tick all shown" takes everything currently filtered.
   - **Download PDF** compiles and downloads it; **.tex** gives the same source for Overleaf.

Your library autosaves to your account. Editing on a phone and a laptop at once is safe: the
second save is refused rather than silently overwriting, and you choose which version wins.

---

## Admin tasks

Pull a student's library out, edit the JSON, push it back (needs `SUPABASE_SERVICE_ROLE_KEY`):

```bash
npm run library -- pull student@example.com            # -> data/resume-db.json
npm run library -- pull student@example.com mine.json
npm run library -- push student@example.com            # replaces their library
```

A push replaces the whole library. The previous contents are snapshotted into
`library_versions`, so it is undoable.

---

## Files

| Path | What |
| --- | --- |
| `supabase/migrations/0001_init.sql` | The whole schema: tables, RLS policies, triggers. Run once. |
| `supabase/migrations/0002_snapshot_throttle.sql` | Caps version history so a class does not fill the free database. Run after 0001. |
| `lib/supabase/` | Browser and per-request server clients. |
| `lib/auth.ts` | `currentUser()` / `requireUser()` — the authorisation checks. |
| `lib/library.ts` | Loading, saving and versioning a student's library document. |
| `lib/starter.ts` | The (empty) library a new student is given. |
| `lib/roles.ts` | The 15 job roles: tags, page budget and what each role is read for. |
| `lib/ai/providers.ts` | Gemini / Groq / OpenRouter / Ollama / OpenAI, called from the browser. |
| `lib/ai/tailor.ts` | Library digest, the prompt, and strict validation of the model's reply. |
| `components/Tailor.tsx` | The "pick a role" panel. |
| `lib/ai/extract.ts` | Turning pasted prose into library entries, with every guard rail. |
| `lib/url-guard.ts` | Blocks private/metadata addresses for the link importer (SSRF). |
| `lib/html-text.ts` | HTML to readable text for the link importer. |
| `components/Importer.tsx` | The Quick start screen. |
| `components/Welcome.tsx` | First-run guide; ticks itself off as the student progresses. |
| `lib/github.ts` | Reading a GitHub profile into text for the importer. |
| `app/api/ai/route.ts` | The optional shared model, for students with no key of their own. |
| `proxy.ts` | Session refresh and page gating (Next 16's renamed middleware). |
| `latex/preamble.tex` | The template preamble. Edit it to change fonts, margins or spacing for every variant. |
| `lib/latex.ts` | Turns a library and a variant into LaTeX. |
| `lib/server.ts` | The `pdflatex` runner and the auto-fit ladder. |
| `Dockerfile`, `fly.toml` | Deployment, including the TeX toolchain. |
| `scripts/library.ts` | Pull/push a library as JSON (`npm run library`). |
| `scripts/seed.ts` | The original one-off import. **Do not run it against a real library** — it builds a fresh document and discards edits. |
| `data/resume-db.json` | Scratch file for pull/push only. No longer the live library. |

## Data and privacy

- Libraries hold phone numbers and email addresses. Keep this repo private, and never commit
  `.env.local`.
- Every save keeps the previous version in `library_versions` (last 30 per student), exposed
  through `/api/db/versions`, so a bad edit is recoverable.
- Row level security is the real protection. The page gate in `proxy.ts` is only a
  convenience; the database refuses cross-user access regardless.
- API keys for the optional AI step never touch the server: the browser calls the provider
  directly. Keys are stored only in that browser's local storage, and only if the student
  ticks "remember". The prompt carries entry text and tags, never name, phone, email or links.
- Student-written text is passed to `pdflatex`. It is escaped (`lib/latex.ts`), the preamble's
  paper/font/accent values are whitelisted, and TeX runs with `-no-shell-escape` plus
  `openin_any=p` (which TeX Live honours; MiKTeX ignores it, so the escaping is the real
  control). Do not route student text into LaTeX anywhere without `esc()`.
