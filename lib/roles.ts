import { ACCENTS } from "./sections";

/**
 * The job roles a student can aim a resume at.
 *
 * `tags` map onto the library's tag vocabulary and drive the deterministic selection that
 * runs with or without an LLM. `focus` is guidance handed to the model: what someone hiring
 * for this role actually reads for. `maxPages` feeds the existing auto-fit ladder.
 */
export interface JobRole {
  id: string;
  label: string;
  group: string;
  blurb: string;
  tags: string[];
  focus: string;
  maxPages: number;
  accent: string;
}

const navy = ACCENTS[0].hex;
const royal = ACCENTS[1].hex;
const teal = ACCENTS[2].hex;
const forest = ACCENTS[3].hex;
const plum = ACCENTS[4].hex;
const charcoal = ACCENTS[5].hex;

export const JOB_ROLES: JobRole[] = [
  {
    id: "sde-intern",
    label: "Software Intern",
    group: "Starting out",
    blurb: "General internship or trainee role — the safest first resume",
    tags: ["sde", "fullstack", "backend"],
    focus:
      "An internship screener spends seconds per resume. Lead with education and the two or three " +
      "strongest build-it-yourself projects. Data structures, a real language, and evidence they can " +
      "finish something matter more than breadth or job titles they do not have yet.",
    maxPages: 1,
    accent: navy,
  },
  {
    id: "sde",
    label: "Software Engineer (SDE)",
    group: "Core engineering",
    blurb: "Generalist product engineering roles",
    tags: ["sde", "fullstack", "backend", "systems"],
    focus:
      "Prioritise shipped software, scale or complexity handled, and languages/frameworks. " +
      "Competitive programming and DSA credentials help for product companies.",
    maxPages: 1,
    accent: navy,
  },
  {
    id: "backend",
    label: "Backend Engineer",
    group: "Core engineering",
    blurb: "APIs, databases, services",
    tags: ["backend", "sde", "systems", "distributed", "cloud"],
    focus:
      "Favour APIs, databases, schema and query work, caching, queues, auth and anything about " +
      "throughput, latency or reliability. Front-end polish is close to irrelevant here.",
    maxPages: 1,
    accent: royal,
  },
  {
    id: "frontend",
    label: "Frontend Engineer",
    group: "Core engineering",
    blurb: "UI, React, design-to-code",
    tags: ["fullstack", "sde", "web3", "mobile"],
    focus:
      "Favour user-facing work: React/Next, state management, responsive layout, accessibility, " +
      "animation and anything with a live link a reviewer can click. Live demos outrank descriptions.",
    maxPages: 1,
    accent: royal,
  },
  {
    id: "fullstack",
    label: "Full-Stack Developer",
    group: "Core engineering",
    blurb: "End-to-end product work, startups",
    tags: ["fullstack", "sde", "backend", "cloud"],
    focus:
      "Favour projects the student took from idea to deployed product, where they owned both ends. " +
      "Startups read for ownership and shipping speed, not specialisation.",
    maxPages: 1,
    accent: navy,
  },
  {
    id: "ai-ml",
    label: "AI / ML Engineer",
    group: "AI and data",
    blurb: "ML, deep learning, LLM and RAG work",
    tags: ["ai", "ml", "llm", "cv", "rag", "data"],
    focus:
      "Favour models trained or fine-tuned, datasets, evaluation numbers, LLM/RAG pipelines and " +
      "published or demoed results. Publications matter a lot here — never drop them. Generic CRUD " +
      "projects should give way to anything with real modelling in it.",
    maxPages: 2,
    accent: teal,
  },
  {
    id: "data",
    label: "Data Analyst / Scientist",
    group: "AI and data",
    blurb: "Analytics, SQL, dashboards, statistics",
    tags: ["data", "ml", "ai"],
    focus:
      "Favour SQL, Python/pandas, statistics, dashboards and anything where analysis changed a " +
      "decision or surfaced an insight. Quantified outcomes beat tooling lists.",
    maxPages: 1,
    accent: teal,
  },
  {
    id: "cloud-devops",
    label: "Cloud / DevOps Engineer",
    group: "Infrastructure",
    blurb: "AWS/GCP, Docker, CI/CD, Kubernetes",
    tags: ["cloud", "systems", "distributed", "backend"],
    focus:
      "Favour deployments, containers, CI/CD, infrastructure-as-code, monitoring, uptime and cost. " +
      "Certifications (AWS, GCP, Azure) carry real weight here — keep them.",
    maxPages: 1,
    accent: forest,
  },
  {
    id: "mobile",
    label: "Mobile App Developer",
    group: "Core engineering",
    blurb: "Android, iOS, Flutter, React Native",
    tags: ["mobile", "fullstack", "sde"],
    focus:
      "Favour shipped apps, especially anything on a store with real users. Play Store or App Store " +
      "links, install counts and offline/performance work are the strongest signals.",
    maxPages: 1,
    accent: royal,
  },
  {
    id: "web3",
    label: "Blockchain / Web3",
    group: "Specialised",
    blurb: "Smart contracts, DeFi, bounties",
    tags: ["web3", "backend", "security"],
    focus:
      "Favour smart contracts, audits, testnet or mainnet deployments, hackathon and bounty wins. " +
      "Web3 hiring reads hackathon results and on-chain proof more than coursework.",
    maxPages: 1,
    accent: plum,
  },
  {
    id: "security",
    label: "Cybersecurity Analyst",
    group: "Specialised",
    blurb: "Security, pentesting, CTFs",
    tags: ["security", "systems", "backend", "cloud"],
    focus:
      "Favour CTF placements, vulnerability findings, tooling, networking and systems depth, plus " +
      "any security certification. Defensive and offensive work both count.",
    maxPages: 1,
    accent: charcoal,
  },
  {
    id: "iot-embedded",
    label: "IoT / Embedded",
    group: "Specialised",
    blurb: "Hardware, firmware, robotics",
    tags: ["iot", "systems", "data"],
    focus:
      "Favour hardware builds, microcontrollers, sensors, firmware in C/C++ and anything where a " +
      "physical thing worked. Hardware hackathons and robotics count strongly.",
    maxPages: 1,
    accent: forest,
  },
  {
    id: "qa",
    label: "QA / Test Engineer",
    group: "Core engineering",
    blurb: "Testing, automation, quality",
    tags: ["sde", "backend", "fullstack"],
    focus:
      "Favour test automation, frameworks, CI pipelines, bug-hunting and anything showing care about " +
      "correctness and edge cases.",
    maxPages: 1,
    accent: charcoal,
  },
  {
    id: "research",
    label: "Research / Higher Studies",
    group: "AI and data",
    blurb: "Research assistant roles, MS/PhD applications",
    tags: ["ai", "ml", "llm", "cv", "data", "systems"],
    focus:
      "Publications come first and must never be dropped, then research-flavoured projects, then " +
      "academic record and anything taught or mentored. Two pages are normal and expected here.",
    maxPages: 2,
    accent: teal,
  },
  {
    id: "freelance",
    label: "Freelance / Client Work",
    group: "Starting out",
    blurb: "Gigs, agencies, contract work",
    tags: ["freelance", "fullstack", "sde", "mobile"],
    focus:
      "Favour delivered client work, breadth of stack, live links and anything showing the student " +
      "can be trusted with someone else's money and deadline.",
    maxPages: 1,
    accent: forest,
  },
];

export const roleById = (id: string): JobRole | undefined => JOB_ROLES.find((r) => r.id === id);

/** Roles grouped for display, preserving the order declared above. */
export function rolesByGroup(): { group: string; roles: JobRole[] }[] {
  const out: { group: string; roles: JobRole[] }[] = [];
  for (const role of JOB_ROLES) {
    const bucket = out.find((g) => g.group === role.group);
    if (bucket) bucket.roles.push(role);
    else out.push({ group: role.group, roles: [role] });
  }
  return out;
}
