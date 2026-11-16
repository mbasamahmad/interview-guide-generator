import type { CodingResearch, CompanyResearch, DiscoveredRole, InterviewResearch, RoleResearch } from "./agents/schemas";
import type { RunState } from "./store";
import { discoveredInterviewTypes, topicLabel } from "./pages";

/**
 * Computer-science roles only: the guide covers interviews that test CS skills.
 * Non-technical roles (HR, recruiting, admin, sales, marketing, legal, finance, operations, product or
 * program management) are dropped even if the role agent returns them.
 */
const NON_CS_TITLE =
  /\b(recruit\w*|talent acquisition|human resources|hr|people (ops|operations|partner)|administrative|executive assistant|receptionist|office manager|sales|account (executive|manager)|business development|marketing|communications|legal|counsel|attorney|paralegal|finance|accountant|accounting|payroll|procurement|customer (support|success|service)|business operations|copywriter|designer|artist|animator|producer)\b/i;
// Product, program and project management loops are not CS interviews, even on technical teams.
const PM_TITLE = /\b(product|program|project) manag/i;
// A clear engineering signal keeps a title (e.g. "Software Engineer, Sales Platform", "Database Administrator").
const TECH_TITLE = /\b(engineer\w*|developer|scientist|research\w*|programmer|architect|sre|devops|machine learning|ml|ai|data|security|software|infrastructure|platform|database|systems? administrator)\b/i;

export function isComputerScienceRole(r: Pick<DiscoveredRole, "title" | "slug"> & { track?: string }): boolean {
  if (r.slug === "product-manager" || PM_TITLE.test(r.title)) return false;
  if (TECH_TITLE.test(r.title)) return r.track !== "non-technical" || /\b(engineer\w*|developer|scientist)\b/i.test(r.title);
  if (r.track === "non-technical") return false;
  return !NON_CS_TITLE.test(r.title);
}

/** Split role research into the CS roles kept and the titles dropped. */
export function filterCsRoles(role: RoleResearch): { kept: RoleResearch; excluded: string[] } {
  const excluded = role.roles.filter((r) => !isComputerScienceRole(r)).map((r) => r.title);
  return { kept: { ...role, roles: role.roles.filter(isComputerScienceRole) }, excluded };
}

/** First sentence of a longer text, for runs made before agents returned one-liners. */
function firstSentence(text: string | undefined, max = 220): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const m = t.match(/^(.+?[.!?])(\s|$)/);
  const s = m ? m[1] : t;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export type ResearchReport = {
  company: { name: string; oneLiner: string; timeline: string };
  roles: { title: string; slug: string; oneLiner: string; evidence: string; openPostings: number; interviewTypes: string[] }[];
  excludedRoles: string[];
  interviewTypes: { type: string; label: string; oneLiner: string; rounds: string[]; roles: string[] }[];
  codingQuestions: { title: string; difficulty: string; topic: string; pattern: string; evidence: string }[];
  ready: { company: boolean; role: boolean; interview: boolean; coding: boolean };
};

const EVIDENCE_LABEL: Record<string, string> = {
  "many-postings": "Many open postings",
  "some-postings": "Some open postings",
  mentioned: "Named on careers site",
  inferred: "Inferred",
  "reported-at-company": "Reported at company",
  "similar-to-reported": "Similar to reported",
  "general-practice": "General practice",
};
export const evidenceLabel = (e: string) => EVIDENCE_LABEL[e] ?? e;

export function buildReport(run: Pick<RunState, "input" | "artifacts">): ResearchReport {
  const company = run.artifacts.company as CompanyResearch | undefined;
  const role = run.artifacts.role as RoleResearch | undefined;
  const interview = run.artifacts.interview as InterviewResearch | undefined;
  const coding = run.artifacts.coding as CodingResearch | undefined;
  const roleTitle = (slug: string) => (slug === "all" ? "All roles" : role?.roles.find((r) => r.slug === slug)?.title ?? slug);
  // Only CS roles are listed against interview types.
  const csRole = (slug: string) => {
    if (slug === "all") return true;
    const r = role?.roles.find((x) => x.slug === slug);
    return r ? isComputerScienceRole(r) : slug !== "product-manager";
  };

  const types = interview ? discoveredInterviewTypes(interview) : [];
  // Interview types each role faces: rounds for "all" roles (or no roles named) count for every role.
  const typesFor = (slug: string) =>
    types.filter((t) => t.roles.length === 0 || t.roles.includes("all") || t.roles.includes(slug)).map((t) => t.label);
  return {
    company: {
      name: company?.companyName ?? run.input.company,
      oneLiner: company?.oneLiner || firstSentence(company?.overview),
      timeline: interview?.timeline && interview.timeline !== "unknown" ? interview.timeline : "",
    },
    roles: (role?.roles ?? []).filter(isComputerScienceRole).map((r) => ({
      title: r.title,
      slug: r.slug,
      oneLiner: r.oneLiner || firstSentence(r.summary),
      evidence: evidenceLabel(r.evidenceStrength),
      openPostings: r.openPostings,
      interviewTypes: typesFor(r.slug),
    })),
    excludedRoles: (run.artifacts.roleExcluded as string[] | undefined) ?? (role?.roles ?? []).filter((r) => !isComputerScienceRole(r)).map((r) => r.title),
    interviewTypes: types.map((t) => {
      const given = interview?.typeSummaries?.find((s) => s.type === t.type)?.oneLiner;
      const round = interview?.rounds.find((r) => r.type === t.type);
      return {
        type: t.type,
        label: t.label,
        oneLiner: given || firstSentence(round?.purpose) || firstSentence(round?.format),
        rounds: t.rounds,
        roles: [...new Set(t.roles.filter(csRole).map(roleTitle))],
      };
    }),
    codingQuestions: (coding?.questions ?? []).map((q) => ({
      title: q.title,
      difficulty: q.difficulty,
      topic: topicLabel(q.topic),
      pattern: q.pattern,
      evidence: evidenceLabel(q.companyEvidence),
    })),
    ready: { company: !!company, role: !!role, interview: !!interview, coding: !!coding },
  };
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function reportMarkdown(r: ResearchReport, date = new Date().toISOString().slice(0, 10)): string {
  const out: string[] = [
    `# ${r.company.name}: research report`,
    "",
    `Computer science roles and interviews only. Generated ${date}.`,
    "",
    "## Company",
    "",
    r.company.oneLiner || "_Company research not available._",
    ...(r.company.timeline ? ["", `**Typical interview timeline:** ${r.company.timeline}`] : []),
    "",
    `## Roles (${r.roles.length})`,
    "",
  ];
  if (r.roles.length) {
    out.push("| Role | Description | Interview types | Hiring evidence |", "| --- | --- | --- | --- |");
    for (const x of r.roles)
      out.push(`| ${cell(x.title)} | ${cell(x.oneLiner)} | ${cell(x.interviewTypes.join(", ") || "Not found")} | ${x.evidence}${x.openPostings ? ` (~${x.openPostings})` : ""} |`);
  } else out.push("_No computer science roles found._");
  if (r.excludedRoles.length) out.push("", `_Not covered (non-technical): ${r.excludedRoles.map(cell).join(", ")}._`);

  out.push("", `## Interview types (${r.interviewTypes.length})`, "");
  if (r.interviewTypes.length) {
    out.push("| Interview type | Description | Roles |", "| --- | --- | --- |");
    for (const t of r.interviewTypes) out.push(`| ${cell(t.label)} | ${cell(t.oneLiner)} | ${cell(t.roles.join(", ") || "All roles")} |`);
  } else out.push("_No interview rounds found._");

  out.push("", `## Coding questions (${r.codingQuestions.length})`, "");
  if (r.codingQuestions.length) {
    out.push("| # | Question | Difficulty | Topic | Evidence |", "| --- | --- | --- | --- | --- |");
    r.codingQuestions.forEach((q, i) => out.push(`| ${i + 1} | ${cell(q.title)} | ${q.difficulty} | ${cell(q.topic)} | ${q.evidence} |`));
  } else out.push("_No coding questions found._");
  out.push("");
  return out.join("\n");
}
