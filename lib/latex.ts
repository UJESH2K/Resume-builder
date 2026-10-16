import type { Award, Bullet, Db, Education, Experience, LineItem, Project, Publication, SkillGroup, Variant, VariantSection } from "./types";

// ---------- escaping & inline markup ----------

const ESC: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "$\\sim$",
  "^": "\\textasciicircum{}",
  "<": "\\textless{}",
  ">": "\\textgreater{}",
};

export function esc(s: string): string {
  return (s ?? "")
    .replace(/[\\&%$#_{}~^<>]/g, (c) => ESC[c])
    .replace(/[–—]/g, (c) => (c === "–" ? "--" : "---"))
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[→←×≈…·•≥≤₹]/g, (c) => SYMBOLS[c]);
}

// Unicode symbols that would otherwise fall back to bitmap (METAFONT) fonts
const SYMBOLS: Record<string, string> = {
  "→": "$\\rightarrow$",
  "←": "$\\leftarrow$",
  "×": "$\\times$",
  "≈": "$\\approx$",
  "…": "\\ldots{}",
  "·": "$\\cdot$",
  "•": "$\\bullet$",
  "≥": "$\\geq$",
  "≤": "$\\leq$",
  "₹": "Rs.\\,",
};

export function escUrl(u: string): string {
  return (u ?? "").trim().replace(/[\\%#{}]/g, (c) => "\\" + c);
}

/** `code`, **bold**, __underline__, *italic*, [label](url) to LaTeX. Everything else escaped. */
export function inline(s: string): string {
  const re = /(\x60[^\x60]+\x60|\*\*[^*]+?\*\*|__[^_]+?__|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*?\*)/g;
  let out = "";
  let last = 0;
  for (const m of (s ?? "").matchAll(re)) {
    out += esc(s.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("`")) out += `\\texttt{${esc(t.slice(1, -1))}}`;
    else if (t.startsWith("**")) out += `\\textbf{${inline(t.slice(2, -2))}}`;
    else if (t.startsWith("__")) out += `\\underline{${inline(t.slice(2, -2))}}`;
    else if (t.startsWith("[")) {
      const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t)!;
      out += `\\href{${escUrl(mm[2])}}{\\underline{${inline(mm[1])}}}`;
    } else out += `\\textit{${inline(t.slice(1, -1))}}`;
    last = m.index! + t.length;
  }
  return out + esc(s.slice(last));
}

const link = (url: string, label: string) =>
  url?.trim() ? `\\href{${escUrl(url)}}{\\underline{${label}}}` : label;

const range = (a: string, b: string) => [a, b].filter((x) => x?.trim()).map(esc).join(" -- ");

// ---------- sections ----------

// A bullet list nested inside a sub-heading list leaves a tall gap before the next heading; pull it back.
function bulletList(bullets: Bullet[], hidden: Set<string>): string {
  const vis = (bullets ?? []).filter((b) => b.text.trim() && !hidden.has(b.id));
  if (!vis.length) return "";
  return (
    "\\resumeItemListStart\n" +
    vis.map((b) => `  \\resumeItem{${inline(b.text)}}`).join("\n") +
    "\n\\resumeItemListEnd\n"
  );
}

function subheadingSection(title: string, body: string[], after: string, between = ""): string {
  if (!body.length) return "";
  return `\\section{${esc(title)}}\n\\resumeSubHeadingListStart\n${body.join(between + "\n")}\\resumeSubHeadingListEnd\n${after}\n`;
}

function renderEducation(items: Education[], title: string, hidden: Set<string>) {
  return subheadingSection(
    title,
    items.map(
      (e) =>
        `\\resumeSubheading{${link(e.link ?? "", inline(e.institution))}}{${range(e.start, e.end)}}{${inline(e.degree)}}{${inline(e.score || e.location)}}\n` +
        bulletList(e.bullets, hidden)
    ),
    "\\vspace{-8pt}"
  );
}

function renderExperience(items: Experience[], title: string, hidden: Set<string>) {
  return subheadingSection(
    title,
    items.map((e) => {
      const role = [e.role, e.kind && !e.role.toLowerCase().includes(e.kind.toLowerCase()) ? `(${e.kind})` : ""]
        .filter(Boolean)
        .join(" ");
      return (
        `\\resumeSubheading{${link(e.companyLink, inline(e.company))}}{${range(e.start, e.end)}}{${inline(role)}}{${inline(e.location)}}\n` +
        bulletList(e.bullets, hidden)
      );
    }),
    "\\vspace{-8pt}"
  );
}

function renderProjects(items: Project[], title: string, hidden: Set<string>) {
  return subheadingSection(
    title,
    items.map((p) => {
      const left = `\\textbf{${inline(p.name)}}` + (p.tech?.trim() ? ` $|$ \\emph{${inline(p.tech)}}` : "");
      // Short labels: a project heading plus a long tech line overflows the margin otherwise.
      const right = [
        p.liveLink?.trim() ? link(p.liveLink, "Demo") : "",
        p.codeLink?.trim() ? link(p.codeLink, "Code") : "",
        p.date?.trim() ? esc(p.date) : "",
      ]
        .filter(Boolean)
        .join(" $|$ ");
      return `\\resumeProjectHeading{${left}}{${right}}\n` + bulletList(p.bullets, hidden);
    }),
    "\\vspace{-8pt}",
    // single-row project headings sit lower than two-row subheadings; pull the next one up to match
    "\\vspace{-8pt}"
  );
}

function renderAwards(items: Award[], title: string, hidden: Set<string>) {
  return subheadingSection(
    title,
    items.map((a) => {
      const t = link(a.link ?? "", inline(a.title));
      const head =
        a.subtitle?.trim() || a.org?.trim()
          ? `\\resumeSubheading{${t}}{${esc(a.date)}}{${inline(a.subtitle)}}{${inline(a.org)}}`
          : `\\resumeSingleHeading{${t}}{${esc(a.date)}}`;
      return head + "\n" + bulletList(a.bullets, hidden);
    }),
    "\\vspace{-8pt}"
  );
}

/** Title + status/date on row one, authors and venue in italics on row two, as papers are normally listed. */
function renderPublications(items: Publication[], title: string, hidden: Set<string>) {
  return subheadingSection(
    title,
    items.map((p) => {
      const head = link(p.link, inline(p.title));
      const right = [p.status?.trim() ? esc(p.status) : "", p.date?.trim() ? esc(p.date) : ""].filter(Boolean).join(" $|$ ");
      const venue = [p.venue?.trim() ? inline(p.venue) : "", p.link?.trim() ? link(p.link, inline(p.linkLabel?.trim() || "Paper")) : ""]
        .filter(Boolean)
        .join(" $|$ ");
      return `\\resumePublication{${head}}{${right}}{${inline(p.authors)}}{${venue}}\n` + bulletList(p.bullets, hidden);
    }),
    "\\vspace{-8pt}"
  );
}

function renderSkills(items: SkillGroup[], title: string) {
  const lines = items.filter((s) => s.category.trim() || s.items.trim());
  if (!lines.length) return "";
  return (
    `\\section{${esc(title)}}\n\\begin{itemize}[leftmargin=0.15in, label={}]\n  \\item{\n` +
    lines.map((s) => `    \\textbf{${esc(s.category)}}{: ${inline(s.items)}}`).join(" \\\\\n") +
    "\n  }\n\\end{itemize}\n\\vspace{-12pt}\n"
  );
}

function renderLines(items: LineItem[], title: string) {
  const vis = items.filter((i) => i.text.trim());
  if (!vis.length) return "";
  return (
    `\\section{${esc(title)}}\n\\begin{itemize}[itemsep=0pt, topsep=2pt]\n` +
    vis
      .map((i) => {
        const tail = i.link?.trim() ? ` ${link(i.link, inline(i.linkLabel?.trim() || "View"))}` : "";
        return `  \\resumeItem{${inline(i.text)}${tail}}`;
      })
      .join("\n") +
    "\n\\end{itemize}\n\\vspace{-4pt}\n"
  );
}

function renderSummary(items: LineItem[], title: string) {
  const vis = items.filter((i) => i.text.trim());
  if (!vis.length) return "";
  return `\\section{${esc(title)}}\n{\\small ${vis.map((i) => inline(i.text)).join("\\par\n")}}\n\\vspace{-4pt}\n`;
}

function renderSection(db: Db, s: VariantSection, hidden: Set<string>): string {
  const byId = new Map((db[s.key] as { id: string }[]).map((i) => [i.id, i]));
  const items = s.items.map((id) => byId.get(id)).filter(Boolean) as any[];
  if (!s.enabled || !items.length) return "";
  switch (s.key) {
    case "education":
      return renderEducation(items, s.title, hidden);
    case "experience":
      return renderExperience(items, s.title, hidden);
    case "projects":
      return renderProjects(items, s.title, hidden);
    case "publications":
      return renderPublications(items, s.title, hidden);
    case "awards":
    case "leadership":
      return renderAwards(items, s.title, hidden);
    case "summary":
      return renderSummary(items, s.title);
    case "skills":
      return renderSkills(items, s.title);
    case "achievements":
    case "certifications":
      return renderLines(items, s.title);
  }
}

function renderHeader(db: Db): string {
  const p = db.profile;
  const parts: string[] = [];
  if (p.phone?.trim()) parts.push(`\\raisebox{-0.1\\height}\\faPhone\\ ${esc(p.phone)}`);
  if (p.email?.trim())
    parts.push(`\\href{mailto:${escUrl(p.email)}}{\\raisebox{-0.2\\height}\\faEnvelope\\ \\underline{${esc(p.email)}}}`);
  if (p.linkedin?.trim())
    parts.push(`\\href{${escUrl(p.linkedin)}}{\\raisebox{-0.2\\height}\\faLinkedin\\ \\underline{LinkedIn}}`);
  if (p.github?.trim()) parts.push(`\\href{${escUrl(p.github)}}{\\raisebox{-0.2\\height}\\faGithub\\ \\underline{GitHub}}`);
  if (p.portfolio?.trim())
    parts.push(`\\href{${escUrl(p.portfolio)}}{\\raisebox{-0.2\\height}\\faGlobe\\ \\underline{Portfolio}}`);
  if (p.location?.trim()) parts.push(`\\raisebox{-0.1\\height}\\faMapMarker{} ${esc(p.location)}`);
  return (
    "\\begin{center}\n" +
    `  {\\Huge \\scshape ${esc(p.name)}} \\\\ \\vspace{5pt}\n` +
    `  \\small ${parts.join(" ~\n  ")}\n` +
    "  \\vspace{-8pt}\n\\end{center}\n\\vspace{-10pt}\n"
  );
}

/**
 * The preamble placeholders land in `\documentclass[...]` and `\definecolor{...}`, where
 * nothing is escaped. These values arrive from the browser with the rest of the library, so
 * they are checked against a fixed set of shapes rather than trusted: a value like
 * `AAAAAA}\input{/etc/passwd}` would otherwise end up executing as LaTeX.
 */
const PAPERS = new Set(["letterpaper", "a4paper"]);
const FONT_SIZES = new Set(["10pt", "11pt", "12pt"]);
const safePaper = (s: string) => (PAPERS.has(s) ? s : "letterpaper");
const safeFontSize = (s: string) => (FONT_SIZES.has(s) ? s : "11pt");
const safeAccent = (s: string) => {
  const hex = (s || "").replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(hex) ? hex : "1F3A5F";
};

export function buildTex(db: Db, v: Variant, preamble: string, extraPreamble = ""): string {
  const hidden = new Set(v.hiddenBullets);
  const head = preamble
    .replace("%%PAPER%%", safePaper(v.paper))
    .replace("%%FONTSIZE%%", safeFontSize(v.fontSize))
    .replace("%%ACCENT%%", safeAccent(v.accent));
  const body = v.sections.map((s) => renderSection(db, s, hidden)).filter(Boolean).join("\n");
  return `${head}${extraPreamble}\n\\begin{document}\n\n${renderHeader(db)}\n${body}\n\\end{document}\n`;
}
