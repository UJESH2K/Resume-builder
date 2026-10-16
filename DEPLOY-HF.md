# Deploying to Hugging Face Spaces

Follow this top to bottom. Expect about 30 minutes, most of it waiting for the first build.

There is **nothing to deploy to an inference endpoint**: this app hosts no model. The AI
features run in each student's own browser with their own API key, so the only thing being
deployed is the Next.js server plus a LaTeX toolchain (needed because the PDF is compiled by
`pdflatex`). That is also why it cannot go on Vercel or Netlify.

---

## Before you start

**Finish the Supabase setup first** (see README "Setting it up"), then confirm it locally:

```bash
npm run check
npm run dev      # sign up at http://localhost:3000, build one resume
```

Deploying a broken backend just moves the debugging somewhere with slower feedback.

### Untrack your personal library — important

`data/resume-db.json` holds your real name, phone number and email. A free Space is **public**,
so that file must not be pushed. It is now in `.gitignore`, but git keeps tracking files it
already knows about, so run this once:

```bash
git rm --cached data/resume-db.json
```

The file stays on your disk (it is still the scratch file for `npm run library -- pull/push`);
it just stops being published. The app itself never reads it — libraries live in Supabase.

---

## 1. Create the Space

1. Go to <https://huggingface.co/new-space>.
2. **Space name:** `resume-studio` (the URL becomes `https://<your-username>-resume-studio.hf.space`).
3. **License:** your choice.
4. **SDK: Docker → Blank.** Not Gradio or Streamlit.
5. **Hardware:** CPU basic (free).
6. **Visibility:** Public (private Spaces are a paid feature).

Public only means the *code* is readable. Student data lives in Supabase behind row level
security, and no keys are in the repo.

## 2. Set the Space variables

Space → **Settings** → **Variables and secrets**. Add these as **Variables**, not Secrets.

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | your project URL, e.g. `https://abcdefghijklmnopqrst.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` |
| `APP_ORIGIN` | `https://<your-username>-resume-studio.hf.space` |
| `COMPILE_CONCURRENCY` | `2` |

Why Variables and not Secrets: `NEXT_PUBLIC_*` values are compiled into the browser bundle at
**build** time, and on Spaces only Variables are passed to the build. Both of these are meant
to be public anyway — the publishable key is safe in a browser, which is the whole point of
row level security.

**Do not put your Supabase secret key here.** The deployed app never uses it; only the local
CLI scripts (`npm run library`, `npm run check`) do. Leaving it out means a leak of the Space
cannot touch your database.

`APP_ORIGIN` is what stops the login redirect loop. Spaces terminate HTTPS at a proxy, so the
app would otherwise redirect students to an `http://` internal address — see the comment on
`absolute()` in `proxy.ts`.

## 3. Push the code

Log in to the Hugging Face CLI once (it stores a token git can use):

```bash
pip install -U "huggingface_hub[cli]"
hf auth login
```

Then add the Space as a remote and push. Use **your** username and Space name:

```bash
git remote add space https://huggingface.co/spaces/<your-username>/resume-studio
git push space main
```

If your branch is not called `main`, push it to `main` anyway: `git push space HEAD:main`.

> You have uncommitted work in this repo. Commit it first (or commit to a branch and push that
> branch to `main` on the Space). Nothing has been committed for you.

## 4. Watch the build

Open the Space → **Logs** → **Build**. The TeX install is the slow part: the image is about
2 GB and the first build usually takes **10–20 minutes**. Later builds reuse layers and are
much quicker, as long as you do not touch the `apt-get` line.

If it fails with `File 'something.sty' not found`, a TeX package is missing. The log names the
file; add the Debian package that provides it to the `apt-get install` list in the `Dockerfile`
and push again.

## 5. Point Supabase at the Space

Supabase → **Authentication** → **URL Configuration** → set **Site URL** to
`https://<your-username>-resume-studio.hf.space`.

Email/password sign-in works without this, but password-reset and any future email links use
it, so set it now while you are thinking about it.

## 6. Check it works

On the Space URL:

1. `/` should redirect you to `/login` (not to an `http://` address — if it does, `APP_ORIGIN`
   is wrong or missing).
2. Sign up with a real-looking email and password.
3. **Quick start** → paste a few sentences about yourself → add a couple of entries.
4. **Builder** → pick a job role → *Build without AI* → the PDF preview should appear within
   about 10 seconds, and **Download PDF** should give you a file.

Step 4 is the one that proves LaTeX survived the deploy. If the preview errors, open the
Space's **Container** logs — a compile failure reports the missing package by name.

---

## What to expect on the free tier

- **It sleeps.** After a stretch with no visitors the Space is paused, and the next person
  waits for a cold start of a 2 GB image. Before a class or a demo, open it yourself a few
  minutes early so it is warm.
- **2 vCPU, shared.** One resume is 3–5 `pdflatex` runs, roughly 4–6 seconds, so the Space
  sustains about 20–30 builds a minute. Fine for a trickle of students or a demo; a whole class
  editing simultaneously will queue.
- **No horizontal scaling.** Spaces cannot run several machines behind a load balancer.

When the queueing starts to hurt, move the container — the app keeps nothing on local disk, so
it is just a redeploy and every account and library stays exactly where it is in Supabase:

- **Oracle Cloud Always Free** — 4 ARM cores and 24 GB RAM, free forever, never sleeps. Build
  the image for `arm64`. Best free option for 200–300 students.
- **Fly.io** — `fly.toml` is already in this repo and tuned; `fly scale count 4` handles a
  class spike. Needs a card, roughly $5–10/month.

If you need to cut load without changing host, untick **Auto preview** in the Builder. It
re-compiles a couple of seconds after every change and is by far the biggest CPU consumer.
