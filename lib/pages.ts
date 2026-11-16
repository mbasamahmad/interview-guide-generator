import type { PlannedPage, RunInput, Selection } from "./store";
import type { CodingResearch, InterviewResearch, RoleResearch } from "./agents/schemas";
import { INTERVIEW_TYPES, INTERVIEW_TYPE_LABELS, type InterviewType } from "./taxonomy";

const TOPIC_LABELS: Record<string, string> = {
  "arrays-and-strings": "Arrays and strings",
  "linked-lists": "Linked lists",
  "trees-and-graphs": "Trees and graphs",
  "hash-tables": "Hash tables",
  "recursion-and-backtracking": "Recursion and backtracking",
  "dynamic-programming": "Dynamic programming",
  "sorting-and-searching": "Sorting and searching",
  "sliding-window-and-two-pointers": "Sliding window and two pointers",
  "advanced-patterns": "Advanced patterns",
};

export function topicLabel(t: string) {
  return TOPIC_LABELS[t] ?? t;
}

export const typeLabel = (t: string) => INTERVIEW_TYPE_LABELS[t as InterviewType] ?? t;

/** Interview types found in the research that can get their own pages, with the roles that face them. */
export function discoveredInterviewTypes(interview: InterviewResearch) {
  const out = new Map<string, { type: string; label: string; rounds: string[]; roles: Set<string>; confidence: Set<string> }>();
  for (const r of interview.rounds) {
    if (!(INTERVIEW_TYPES as readonly string[]).includes(r.type)) continue;
    const cur = out.get(r.type) ?? { type: r.type, label: typeLabel(r.type), rounds: [], roles: new Set(), confidence: new Set() };
    cur.rounds.push(r.name);
    r.appliesToRoles.forEach((x) => cur.roles.add(x));
    cur.confidence.add(r.confidence);
    out.set(r.type, cur);
  }
  return [...out.values()].map((x) => ({ ...x, roles: [...x.roles], confidence: [...x.confidence] }));
}

/**
 * Build the page list from the research and the user's selection. Landing pages follow
 * the Hub Map doc (one file per real URL). Assembly writes them as Company-Guide.md, Coding-Question.md,
 * Roles/*.md and Interview-Types/*.md. Study pages are no longer planned; older runs may still have some.
 */
export function planPages(
  input: RunInput,
  selection: Selection,
  artifacts: { interview: InterviewResearch; role: RoleResearch; coding?: CodingResearch },
): PlannedPage[] {
  const { companySlug: c, company } = input;
  const pages: PlannedPage[] = [];
  const base = `interview/companies/${c}`;
  const roles = artifacts.role.roles.filter((r) => selection.roles.includes(r.slug));
  const types = selection.interviewTypes;
  const hasCoding = !!artifacts.coding && artifacts.coding.questions.length > 0;
  const roleList = roles.map((r) => r.title).join(", ");

  // ---- Landing pages (Hub Map page model)
  pages.push({
    path: `${base}/index.md`,
    kind: "landing",
    pageType: "company",
    title: `${company} interview guide`,
    purpose: `Company page: what ${company} does and its main products, the computer science roles it hires for (${roleList}) and the interview types each one faces, then interviewing at ${company}, linking to each role, interview-type and coding-questions page.`,
    sections: [
      "At a glance",
      `About ${company}: what it does, its business and its main products`,
      `Roles ${company} hires for: each role with a one-line description, the interview types it faces and a link to its role page`,
      "Loop timeline",
      "Body sections",
      "Mapped problems and pattern chips",
      "FAQ",
      "Related pages",
    ],
    inputs: ["company", "interview", "roleIndex", "codingIndex"],
    criteria: { company: c },
    parent: "/interview/companies/",
    url: `/${base}/`,
  });
  for (const r of roles) {
    pages.push({
      path: `${base}/${r.slug}/index.md`,
      kind: "landing",
      pageType: "company-role",
      title: `${company} ${r.title} interview guide`,
      purpose: `Company × role guide for ${r.title} candidates at ${company}, at every level, including which interview types ${r.title} candidates face.`,
      sections: [
        "At a glance",
        `Interview types for this role: each interview type ${r.title} candidates face, with a one-line description and a link to its interview-type page`,
        "Loop timeline",
        "Body sections",
        "By level",
        "Mapped problems and pattern chips",
        "FAQ",
        "Related pages",
      ],
      inputs: ["company", "role", "interview", "codingIndex"],
      criteria: { company: c, role: r.slug },
      parent: `/${base}/`,
      url: `/${base}/${r.slug}/`,
    });
  }
  for (const t of types) {
    pages.push({
      path: `${base}/${t}/index.md`,
      kind: "landing",
      pageType: "company-interview-type",
      title: `${company} ${typeLabel(t).toLowerCase()} interview`,
      purpose:
        t === "coding"
          ? `Company × interview type page for ${company}'s coding round(s): format, which roles face them, what is assessed, how to prepare and common mistakes. The questions and solutions are on the coding questions page; link to it instead of repeating them.`
          : `Company × interview type page for ${company}'s ${typeLabel(t)} round(s): format, which roles face them, what is assessed, how to prepare, example questions with worked answers, and common mistakes.`,
      sections: ["At a glance", "Loop timeline", "Body sections", "Mapped problems and pattern chips", "Drills (if debugging, code review or AI-assisted coding)", "FAQ", "Related pages"],
      inputs: ["company", "interview", "roleIndex", "codingIndex"],
      criteria: { company: c, interviewType: t },
      parent: `/${base}/`,
      url: `/${base}/${t}/`,
    });
  }
  if (hasCoding) {
    pages.push({
      path: `${base}/coding-questions/index.md`,
      kind: "landing",
      pageType: "company-coding-questions",
      title: `${company} coding interview questions`,
      purpose: `Company coding questions page: the topics ${company} emphasizes, a summary table of every question, then every question in full (problem, approach, optimized solution, complexity) with its difficulty, pattern, evidence label, roles and its Educative problem where mapped.`,
      sections: ["At a glance", "Mapped problems and pattern chips (summary table)", "Questions and solutions (main section)", "FAQ", "Related pages"],
      inputs: ["interview", "codingTopics", "coding"],
      criteria: { company: c },
      parent: `/${base}/`,
      url: `/${base}/coding-questions/`,
    });
  }

  return pages;
}

/**
 * The landing page that covers the same topic as a study page (same role, same interview
 * type, or coding questions), or null. Used for canonicals and to keep titles distinct.
 */
export function landingCounterpart(page: PlannedPage, pages: PlannedPage[]): PlannedPage | null {
  if (page.kind !== "study") return null;
  const landing = pages.filter((p) => p.kind === "landing");
  if (page.criteria.role) return landing.find((p) => p.pageType === "company-role" && p.criteria.role === page.criteria.role) ?? null;
  if (page.criteria.interviewType === "coding") return landing.find((p) => p.pageType === "company-coding-questions") ?? null;
  if (page.criteria.interviewType)
    return landing.find((p) => p.pageType === "company-interview-type" && p.criteria.interviewType === page.criteria.interviewType) ?? null;
  return null;
}

/** Research digest for one page: only the artifacts it draws on, filtered by its criteria. */
export function pageDigest(page: PlannedPage, artifacts: Record<string, unknown>, selectedRoles: string[]): string {
  const parts: string[] = [];
  const applies = (list: string[], role: string) => list.includes("all") || list.includes(role) || list.length === 0;
  for (const key of page.inputs) {
    let value = artifacts[key];
    if (value === undefined) continue;
    if (key === "role") {
      const r = value as RoleResearch;
      const keep = page.criteria.role ? [page.criteria.role] : selectedRoles;
      value = { ...r, roles: r.roles.filter((x) => keep.includes(x.slug)) };
    }
    if (key === "roleIndex") {
      value = (value as { slug: string }[]).filter((x) => selectedRoles.includes(x.slug));
    }
    if (key === "interview") {
      const iv = value as InterviewResearch;
      let rounds = iv.rounds;
      if (page.criteria.role) rounds = rounds.filter((r) => applies(r.appliesToRoles, page.criteria.role));
      if (page.criteria.interviewType) rounds = rounds.filter((r) => r.type === page.criteria.interviewType);
      value = { ...iv, rounds };
    }
    if (key === "codingIndex" && page.criteria.role) {
      value = (value as { appliesToRoles: string[] }[]).filter((q) => applies(q.appliesToRoles, page.criteria.role));
    }
    if (key === "coding" && page.criteria.topic) {
      const c = value as CodingResearch;
      value = { ...c, questions: c.questions.filter((q) => q.topic === page.criteria.topic) };
    }
    parts.push(`<${key}_research>\n${JSON.stringify(value)}\n</${key}_research>`);
  }
  return parts.join("\n\n");
}

export function codingIndex(coding: CodingResearch) {
  return coding.questions.map((q) => ({
    id: q.id,
    title: q.title,
    difficulty: q.difficulty,
    topic: q.topic,
    pattern: q.pattern,
    appliesToRoles: q.appliesToRoles,
    companyEvidence: q.companyEvidence,
    evidenceUrls: q.evidenceUrls,
    educativeUrl: q.educativeUrl,
  }));
}

/** Short role list for pages that cover the whole company. */
export function roleIndex(role: RoleResearch) {
  return role.roles.map((r) => ({
    title: r.title,
    slug: r.slug,
    oneLiner: r.oneLiner,
    evidenceStrength: r.evidenceStrength,
    summary: r.summary,
    languages: r.languages,
    assessedSkills: r.assessedSkills,
    levels: r.levels,
  }));
}
