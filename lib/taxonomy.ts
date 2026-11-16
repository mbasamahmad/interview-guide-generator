// Fixed lists from the Hub Map and Page Factory doc (reference/hub-map-and-page-factory.md → Taxonomy).
// Slugs here are the only ones that map onto /interview/... URLs.

export const INTERVIEW_TYPES = [
  "coding",
  "system-design-interview",
  "tech-screen",
  "low-level-design",
  "api-design",
  "behavioral",
  "engineering-management",
  "debugging",
  "code-review",
  "ai-assisted-coding",
  "case-study",
] as const;
export type InterviewType = (typeof INTERVIEW_TYPES)[number];

export const INTERVIEW_TYPE_LABELS: Record<InterviewType, string> = {
  coding: "Coding",
  "system-design-interview": "System design",
  "tech-screen": "Technical screen",
  "low-level-design": "Low-level / object-oriented design",
  "api-design": "API design",
  behavioral: "Behavioral",
  "engineering-management": "Engineering management",
  debugging: "Debugging",
  "code-review": "Code review",
  "ai-assisted-coding": "AI-assisted coding",
  "case-study": "Case study",
};

export const ROLES = [
  { slug: "software-engineer", label: "Software Engineer" },
  { slug: "engineering-manager", label: "Engineering Manager" },
  { slug: "product-manager", label: "Product Manager" },
  { slug: "data-scientist", label: "Data Scientist" },
  { slug: "data-engineer", label: "Data Engineer" },
  { slug: "machine-learning-engineer", label: "Machine Learning Engineer" },
  { slug: "research-engineer", label: "Research Engineer" },
  { slug: "security-engineer", label: "Security Engineer" },
  { slug: "frontend", label: "Frontend Engineer" },
  { slug: "forward-deployed-engineer", label: "Forward Deployed Engineer" },
] as const;

export const LEVELS = ["Entry-level", "Mid-level", "Senior-level", "Staff+"] as const;

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Map a free-text role to a taxonomy slug when it matches one; otherwise slugify it. */
export function roleSlug(role: string): { slug: string; inTaxonomy: boolean } {
  const s = slugify(role);
  const hit = ROLES.find(
    (r) => r.slug === s || slugify(r.label) === s || (s === "frontend-engineer" && r.slug === "frontend"),
  );
  return hit ? { slug: hit.slug, inTaxonomy: true } : { slug: s, inTaxonomy: false };
}
