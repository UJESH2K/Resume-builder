# Resume Studio — Next.js app plus a LaTeX toolchain, because compiling the PDF shells out
# to pdflatex. This is why the app cannot go on Vercel/Netlify serverless: those runtimes
# have no TeX and no long-lived process. Any host that runs a container works (Fly.io,
# Render, Railway, a plain VPS).

# ---------------------------------------------------------------- build the app
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# NEXT_PUBLIC_* values are baked into the browser bundle at build time, so they must be
# present *now*, not just at runtime. Pass them with --build-arg, or, on Hugging Face Spaces,
# set them as Space *Variables* (which arrive as build args) rather than Secrets.
# Either key name works; see lib/supabase/env.ts.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------------------------------------------------------------- runtime
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# The TeX packages the preamble actually uses: latexsym, fullpage, titlesec, marvosym,
# enumitem, hyperref, fancyhdr, babel, tabularx, fontawesome5, multicol, xcolor.
# fonts-extra is the big one (fontawesome5 + marvosym) but the resume header needs it.
# If a compile ever fails with "File `x.sty' not found", the log names the missing package.
RUN apt-get update && apt-get install -y --no-install-recommends \
      texlive-latex-base \
      texlive-latex-recommended \
      texlive-latex-extra \
      texlive-fonts-recommended \
      texlive-fonts-extra \
      texlive-lang-english \
    && rm -rf /var/lib/apt/lists/* \
    && pdflatex --version

# Run as a non-root user: student-supplied text reaches pdflatex, so give that process as
# little as possible even though escaping and openin_any=p already fence it in.
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Read at runtime by lib/server.ts, so output tracing does not pick it up automatically.
COPY --from=builder --chown=nextjs:nodejs /app/latex ./latex

# Scratch space for pdflatex (BUILD_DIR), writable by the app user.
ENV BUILD_DIR=/tmp/resume-studio-build
RUN mkdir -p $BUILD_DIR && chown nextjs:nodejs $BUILD_DIR

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
