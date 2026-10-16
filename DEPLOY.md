# Deploying Resume Studio

One thing makes this app different from a normal Next.js site: it shells out to `pdflatex` to
build the PDF. That rules out Vercel, Netlify and anything serverless — it needs a **container**
with a LaTeX toolchain. The `Dockerfile` in this repo provides exactly that.

There is **no model to host**. The AI features run in each student's browser with their own
key, so there is no GPU, no inference endpoint and no Python anywhere.

---

## Step 1 — Supabase settings for a live site

Do this before or straight after the first deploy, or students hit confusing problems.

| Where | Setting | Value |
| --- | --- | --- |
| Authentication → Sign In / Providers → Email | **Confirm email** | **OFF** |
| Authentication → URL Configuration | **Site URL** | `https://resume-builder.ujesh.in` |
| Authentication → URL Configuration | **Redirect URLs** | add the same, plus `http://localhost:3000` for local work |

**Why Confirm email must be off:** Supabase's built-in mailer is rate limited to a handful of
messages an hour. A class of 30 signing up together will silently fail. (This is the one thing
`npm run check` currently flags on your project.)

**Why Site URL matters:** it is the address confirmation and password-reset emails send people
back to, and it defaults to `http://localhost:3000` — which is exactly the bug you hit. The app
now also passes its own `emailRedirectTo` built from `APP_ORIGIN`, so setting that (step 2)
fixes it even if the dashboard value is wrong.

---

## Step 2 — Environment variables

Set these wherever you deploy. The two `NEXT_PUBLIC_*` ones are compiled into the browser
bundle, so they must be present **at build time**, not just at runtime.

| Variable | Required | Value |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | `https://mdxhwhicpblyykotunjy.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | your `sb_publishable_…` key |
| `APP_ORIGIN` | yes in production | `https://resume-builder.ujesh.in` |
| `COMPILE_CONCURRENCY` | recommended | `2` (keep at or below the vCPU count) |
| `GITHUB_TOKEN` | recommended | a classic token with **no scopes** — it only reads public data |
| `SHARED_AI_TOKEN` + `NEXT_PUBLIC_SHARED_AI=1` | optional | switches on the no-key model option |

**Do not set `SUPABASE_SECRET_KEY` on the server.** The app never uses it; only the local CLI
scripts do. Leaving it out means a compromise of the host cannot touch your database.

**`GITHUB_TOKEN` is close to required in practice.** Without it GitHub allows 60 requests an
hour *per server IP*, and one student's import costs about 15 — so the fourth student in an
hour gets rate limited. With a token it is 5,000.

---

## Step 3 — Render (what you are on now)

Render builds the `Dockerfile` straight from the GitHub repo.

1. **New → Web Service**, connect `UJESH2K/Resume-builder`, branch `main`.
2. **Runtime: Docker.** Leave build and start commands empty — the Dockerfile handles both.
3. Add the environment variables from step 2.
4. Deploy. The first build takes **10–20 minutes**: the TeX install is about 2 GB.

### Be realistic about the free tier

Render's free web service gives **0.1 CPU and 512 MB RAM**, and sleeps after 15 minutes idle.
`pdflatex` is CPU-bound and a resume is 3–5 runs, so on 0.1 CPU a single preview can take
**30–60 seconds**, and a cold start adds a minute on top. It will work, but it will feel broken
to a student.

For a real class, the **Starter plan ($7/month, 0.5 CPU, 512 MB)** is the minimum I would put
in front of people, and even then keep `COMPILE_CONCURRENCY=2`.

If RAM becomes the problem you will see builds killed with exit code 137 — that is the OOM
killer, and the fix is a bigger instance, not a code change.

---

## Step 4 — Your domain

Use **`resume-builder.ujesh.in`**, not `resume_builder.ujesh.in`.

Underscores are not legal in hostnames (RFC 1123). Let's Encrypt will refuse to issue a
certificate for a name containing one, so the site would have no HTTPS — and without HTTPS the
Supabase auth cookies (which are `Secure`) stop working, so nobody can log in. Hyphen only.

1. Render → your service → **Settings → Custom Domains → Add** `resume-builder.ujesh.in`.
2. At your DNS provider for `ujesh.in`, add the record Render shows you:
   `CNAME  resume-builder  →  <your-service>.onrender.com`
3. Wait for DNS to propagate (minutes to an hour). Render issues the TLS certificate itself.
4. Set `APP_ORIGIN=https://resume-builder.ujesh.in` and **redeploy** — it is baked in at build.
5. Update the Supabase **Site URL** to match (step 1).

Test it by opening the domain in a private window: `/` should bounce you to `/login` over
**https**, not to an `onrender.com` address and not to `http://`.

---

## Step 5 — Check it works

On the live domain, in a private window:

1. `/` redirects to `/login` over https.
2. Sign up. You should land straight in the app, with **no confirmation email** (step 1).
3. **Quick start → Fetch my repos** with a GitHub username → text appears → *Turn this into
   library entries* → tick a few → *Add to my library*.
4. **Builder → pick a role → Build without AI** → the preview appears → **Download PDF**.

Step 4 is the one that proves LaTeX survived the deploy. If the preview errors, the container
logs name the missing TeX package.

---

## Later: Google Cloud Run

When you move to Google Cloud, **Cloud Run** is the right service — not a VM. It runs exactly
this container, scales to zero when nobody is using it, and scales out automatically when a
class arrives, which suits bursty student traffic far better than a fixed Render instance.

Its free tier (2 million requests and 180,000 vCPU-seconds a month) comfortably covers a
college, and you can give each instance 1–2 vCPU so compiles are fast.

```bash
gcloud run deploy resume-studio \
  --source . \
  --region asia-south1 \
  --cpu 2 --memory 2Gi \
  --min-instances 0 --max-instances 10 \
  --set-env-vars APP_ORIGIN=https://resume-builder.ujesh.in,COMPILE_CONCURRENCY=2 \
  --allow-unauthenticated
```

Two gotchas: pass the `NEXT_PUBLIC_*` values as **build** substitutions (they are compiled in),
and set `--min-instances 1` if cold starts on a 2 GB image annoy you — that is the only part
that costs money.

Because the app keeps nothing on local disk, moving hosts is just a redeploy. Every account and
library stays exactly where it is in Supabase.

---

## Hugging Face Spaces (free, no card)

Still a fine option for a demo. `README.md` already carries the Space metadata
(`sdk: docker`, `app_port: 3000`).

1. New Space → **Docker → Blank**, CPU basic, public.
2. Settings → **Variables** (not Secrets — only Variables reach the build) → the step 2 values.
3. `git remote add space https://huggingface.co/spaces/<user>/<name>` then `git push space main`.

Note: a free Space sleeps when idle and gives 2 shared vCPUs, and `hf upload . ` would upload
`.env.local` and `node_modules` — **push with git instead**, which respects `.gitignore`.
