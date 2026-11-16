import { z } from "zod";
import { INTERVIEW_TYPES } from "../taxonomy";

// Structured data exchanged between agents. Keep these to features supported by
// structured outputs: objects, arrays, strings, numbers, booleans, enums.

const Confidence = z.enum(["verified", "reported", "inferred"]);

export const Source = z.object({
  url: z.string(),
  title: z.string(),
  publishedDate: z.string().describe("ISO date or 'unknown'"),
  kind: z.enum(["official", "engineering-blog", "job-posting", "candidate-report", "news", "other"]),
});
export type Source = z.infer<typeof Source>;

const Finding = z.object({
  topic: z.string(),
  statement: z.string(),
  confidence: Confidence,
  sourceUrls: z.array(z.string()),
});

export const CompanyResearch = z.object({
  companyName: z.string(),
  oneLiner: z.string().describe("One sentence (max 25 words): what the company does, for a report"),
  overview: z.string(),
  businessModel: z.string(),
  products: z.array(z.string()),
  techStack: z.array(z.object({ name: z.string(), area: z.string(), confidence: Confidence, sourceUrls: z.array(z.string()) })),
  engineeringCulture: z.array(Finding),
  values: z.array(Finding),
  hiringPhilosophy: z.array(Finding),
  teams: z.array(z.object({ name: z.string(), focus: z.string() })),
  recentDevelopments: z.array(Finding),
  engineeringBlogs: z.array(z.object({ title: z.string(), url: z.string(), date: z.string(), summary: z.string() })),
  sources: z.array(Source),
});
export type CompanyResearch = z.infer<typeof CompanyResearch>;

export const DiscoveredRole = z.object({
  title: z.string().describe("The company's own job title family, e.g. 'Software Engineer, Backend'"),
  slug: z
    .string()
    .describe(
      "Taxonomy slug when the role maps to one: software-engineer, engineering-manager, data-scientist, data-engineer, machine-learning-engineer, research-engineer, security-engineer, frontend, forward-deployed-engineer. Otherwise a kebab-case slug of the title.",
    ),
  oneLiner: z.string().describe("One sentence (max 25 words): what this role does at this company"),
  track: z
    .enum(["computer-science", "non-technical"])
    .describe("computer-science: the interview loop tests CS skills (coding, system design, ML, data, security). non-technical: HR, recruiting, admin, sales, marketing, legal, finance, operations, product or program management"),
  evidenceStrength: z.enum(["many-postings", "some-postings", "mentioned", "inferred"]),
  openPostings: z.number().describe("Approximate number of current postings found; 0 if unknown"),
  summary: z.string(),
  responsibilities: z.array(Finding),
  requiredSkills: z.array(z.object({ skill: z.string(), category: z.string(), confidence: Confidence, sourceUrls: z.array(z.string()) })),
  languages: z.array(z.string()),
  frameworksAndTools: z.array(z.string()),
  systemDesignExpectations: z.array(z.string()),
  dataAndApiExpectations: z.array(z.string()),
  infraAndCloud: z.array(z.string()),
  qualifications: z.array(Finding),
  levels: z.array(z.object({ level: z.string(), expectations: z.string(), confidence: Confidence })).describe("How expectations change by level (entry, mid, senior, staff)"),
  assessedSkills: z.array(z.string()),
  jobPostings: z.array(z.object({ title: z.string(), url: z.string(), date: z.string() })),
});
export type DiscoveredRole = z.infer<typeof DiscoveredRole>;

/** Output of the Role Research Agent: every engineering role the company hires for. */
export const RoleResearch = z.object({
  summary: z.string(),
  careersPageUrl: z.string(),
  roles: z.array(DiscoveredRole),
  sources: z.array(Source),
});
export type RoleResearch = z.infer<typeof RoleResearch>;

export const Round = z.object({
  order: z.number(),
  name: z.string().describe("The company's own name for the round"),
  type: z.enum([...INTERVIEW_TYPES, "recruiter-screen", "hiring-manager", "take-home", "other"]),
  confidence: Confidence,
  appliesToRoles: z.array(z.string()).describe("Role slugs this round applies to, or ['all']"),
  format: z.string(),
  length: z.string(),
  aiRules: z.string().describe("Whether AI tools are allowed, or 'unknown'"),
  purpose: z.string(),
  topics: z.array(z.string()),
  skillsEvaluated: z.array(z.string()),
  questionFormats: z.array(z.string()),
  preparationStrategy: z.array(z.string()),
  commonMistakes: z.array(z.string()),
  exampleQuestions: z.array(z.object({ question: z.string(), confidence: Confidence })),
  resources: z.array(z.object({ title: z.string(), url: z.string() })),
  sourceUrls: z.array(z.string()),
});
export type Round = z.infer<typeof Round>;

export const InterviewResearch = z.object({
  processSummary: z.string(),
  typeSummaries: z
    .array(z.object({ type: z.enum(INTERVIEW_TYPES), oneLiner: z.string().describe("One sentence (max 30 words): what this interview type looks like at this company") }))
    .describe("One entry per interview type found in the rounds"),
  timeline: z.string().describe("Typical end-to-end duration, or 'unknown'"),
  rounds: z.array(Round),
  hiringDecision: z.string(),
  levelDifferences: z.array(z.object({ level: z.string(), differences: z.string(), confidence: Confidence })).describe("How the loop changes by seniority"),
  generalPracticeNotes: z.array(z.string()).describe("Industry-general practices, clearly not company-confirmed"),
  lastVerified: z.string().describe("ISO date of research"),
  sources: z.array(Source),
});
export type InterviewResearch = z.infer<typeof InterviewResearch>;

export const CodingQuestion = z.object({
  id: z.string().describe("kebab-case slug"),
  title: z.string(),
  difficulty: z.enum(["easy", "medium", "hard"]),
  topic: z.enum([
    "arrays-and-strings",
    "linked-lists",
    "trees-and-graphs",
    "hash-tables",
    "recursion-and-backtracking",
    "dynamic-programming",
    "sorting-and-searching",
    "sliding-window-and-two-pointers",
    "advanced-patterns",
  ]),
  pattern: z.string(),
  appliesToRoles: z.array(z.string()).describe("Role slugs this question suits, or ['all']"),
  companyEvidence: z.enum(["reported-at-company", "similar-to-reported", "general-practice"]),
  evidenceUrls: z.array(z.string()),
  problemStatement: z.string(),
  explanation: z.string(),
  examples: z.array(z.object({ input: z.string(), output: z.string(), note: z.string() })),
  constraints: z.array(z.string()),
  approach: z.array(z.string()).describe("Step-by-step solution approach"),
  solutionLanguage: z.string(),
  solutionCode: z.string(),
  timeComplexity: z.string(),
  spaceComplexity: z.string(),
  followUps: z.array(z.string()),
  educativeUrl: z.string().describe("Matching Educative problem URL, or empty string"),
});
export type CodingQuestion = z.infer<typeof CodingQuestion>;

export const CodingResearch = z.object({
  summary: z.string(),
  emphasizedTopics: z
    .array(
      z.object({
        topic: CodingQuestion.shape.topic,
        patterns: z.array(z.string()),
        evidence: z.string(),
        confidence: Confidence,
        sourceUrls: z.array(z.string()),
      }),
    )
    .describe("Coding topics and patterns this company is found to emphasize, strongest first"),
  questions: z.array(CodingQuestion),
  sources: z.array(Source),
});
export type CodingResearch = z.infer<typeof CodingResearch>;

export const PageDraft = z.object({
  markdown: z.string().describe("Page body in Markdown, starting with a single H1"),
  sourceUrls: z.array(z.string()),
  notes: z.array(z.string()).describe("Gaps or open questions the writer could not resolve"),
});
export type PageDraft = z.infer<typeof PageDraft>;

export const InteractiveResult = z.object({
  markdown: z.string(),
  elementsAdded: z.array(z.string()),
});

export const SeoResult = z.object({
  markdown: z.string().describe("Page Markdown with improved headings and internal links"),
  title: z.string(),
  metaDescription: z.string(),
  h1: z.string(),
  primaryKeyword: z.string(),
  secondaryKeywords: z.array(z.string()),
  searchIntent: z.enum(["informational", "navigational", "commercial", "transactional"]),
  slug: z.string(),
  internalLinks: z.array(z.object({ anchor: z.string(), path: z.string() })),
  imageAltText: z.array(z.object({ image: z.string(), alt: z.string() })),
});
export type SeoResult = z.infer<typeof SeoResult>;

export const QaResult = z.object({
  markdown: z.string().describe("Corrected page Markdown"),
  corrections: z.array(z.string()),
  unresolved: z.array(z.string()).describe("Problems that could not be fixed without new research"),
  status: z.enum(["pass", "pass-with-warnings", "fail"]),
});
export type QaResult = z.infer<typeof QaResult>;
