import path from "path";
import type { PlannedPage, RunState } from "./store";
import type { CompanyResearch, InterviewResearch, RoleResearch, SeoResult, Source } from "./agents/schemas";
import type { WebSource } from "./llm";
import { landingCounterpart, typeLabel } from "./pages";
import { buildReport, reportMarkdown } from "./report";

const SITE = "https://www.educative.io";

/** YAML frontmatter; values are JSON-encoded, which is valid YAML. */
function frontmatter(obj: Record<string, unknown>): string {
  const lines = Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join("\n")}\n---\n\n`;
}

/** Bump when assembly output changes; finished runs built with an older version are rebuilt on download. */
export const PACKAGE_LAYOUT = 2;

/** Supporting files (report, sources, SEO, CMS entry, README, validation) go in this folder. */
export const EXTRAS = "Extras";

/** "Low-level / object-oriented design" → "Low-Level-Object-Oriented-Design". */
export function fileName(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9+#]+/g, " ")
      .trim()
      .split(/\s+/)
      .map((w) => (/^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w))
      .join("-") || "Untitled"
  );
}

/** Package root folder, e.g. "Goldman-Sachs". */
export function packageRoot(company: string): string {
  return fileName(company);
}

/**
 * Where each planned page goes in the ZIP:
 *   Company-Guide.md, Coding-Question.md, Roles/<Role>.md, Interview-Types/<Type>.md
 * Study pages (older runs only) go under Extras/Study-Guide/.
 */
export function outputPaths(run: Pick<RunState, "pages" | "artifacts">): Map<string, string> {
  const roles = (run.artifacts.role as RoleResearch | undefined)?.roles ?? [];
  const out = new Map<string, string>();
  const used = new Set<string>();
  const claim = (want: string) => {
    let f = want;
    for (let i = 2; used.has(f.toLowerCase()); i++) f = want.replace(/\.md$/, `-${i}.md`);
    used.add(f.toLowerCase());
    return f;
  };
  // Fixed names first, so they never get a suffix.
  const order = [...run.pages].sort((a, b) => rank(a) - rank(b));
  const hasCodingPage = run.pages.some((p) => p.pageType === "company-coding-questions");
  for (const p of order) {
    // Older runs: per-topic solution pages are merged into Coding-Question.md (see mergeSolutions).
    if (hasCodingPage && p.kind === "study" && p.criteria.topic) {
      out.set(p.path, "Coding-Question.md");
      continue;
    }
    let want: string;
    if (p.pageType === "company") want = "Company-Guide.md";
    else if (p.pageType === "company-coding-questions") want = "Coding-Question.md";
    else if (p.pageType === "company-role") {
      const title = roles.find((r) => r.slug === p.criteria.role)?.title ?? p.criteria.role ?? p.title;
      want = `Roles/${fileName(title)}.md`;
    } else if (p.pageType === "company-interview-type") want = `Interview-Types/${fileName(typeLabel(p.criteria.interviewType ?? p.title))}.md`;
    else want = `${EXTRAS}/Study-Guide/${p.path.replace(/^study-guide\//, "")}`;
    out.set(p.path, claim(want));
  }
  return out;
}
const rank = (p: PlannedPage) => (p.pageType === "company" ? 0 : p.pageType === "company-coding-questions" ? 1 : p.kind === "landing" ? 2 : 3);

/**
 * Older runs wrote each coding question's full write-up on per-topic study pages. Pull every
 * question block (from its <a id> anchor to the next question or closing section) out of those
 * pages, in research order, so Coding-Question.md holds the full problems and solutions.
 */
function mergeSolutions(body: string, topicBodies: string[], order: string[]): string {
  if (!topicBodies.length) return body;
  const blocks = new Map<string, string>();
  for (const b of topicBodies) {
    const lines = b.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const id = lines[i].match(/^<a id="([^"]+)"><\/a>\s*$/)?.[1];
      if (!id) continue;
      let j = i + 1;
      while (j < lines.length && !/^## /.test(lines[j])) j++; // the question's own H2
      let k = j + 1;
      while (k < lines.length && !/^<a id="/.test(lines[k]) && !/^## /.test(lines[k])) k++;
      // Demote one level: the question becomes H3 under "Questions and solutions".
      const block = lines.slice(i, k).join("\n").replace(/^(#{2,5}) /gm, "#$1 ").trim();
      if (!blocks.has(id)) blocks.set(id, block);
      i = k - 1;
    }
  }
  if (!blocks.size || [...blocks.keys()].every((id) => body.includes(`<a id="${id}">`))) return body;
  const ids = [...order.filter((id) => blocks.has(id)), ...[...blocks.keys()].filter((id) => !order.includes(id))];
  const section = ["## Questions and solutions", "", "Every question in full: the problem, an approach, an optimized solution and its complexity.", "", ...ids.map((id) => `${blocks.get(id)}\n`)].join("\n");
  const at = body.search(/^## (FAQ|Frequently asked|Related|Sources)\b/im);
  return at === -1 ? `${body.trim()}\n\n${section}` : `${body.slice(0, at)}${section}\n${body.slice(at)}`;
}

/** Map every way a page can be referenced (planned path, URL, output file) to its output file. */
function linkTargets(pages: PlannedPage[], out: Map<string, string>, extra: string[]): Map<string, string> {
  const m = new Map<string, string>();
  const add = (k: string, file: string) => m.set(k.replace(/\/+$/, "") || "/", file);
  for (const p of pages) {
    const file = out.get(p.path)!;
    add(`/${p.path}`, file);
    add(`/${p.path.replace(/\.md$/, "")}`, file);
    add(p.url, file);
    if (p.path.endsWith("/index.md")) add(`/${p.path.replace(/\/index\.md$/, "")}`, file);
    add(`/${file}`, file);
  }
  for (const f of extra) add(`/${f}`, f);
  return m;
}

/** Rewrite root-relative package links ("/interview/...", "/study-guide/....md") to file-relative links. */
export function rewriteInternalLinks(markdown: string, fromFile: string, targets: Map<string, string>): string {
  return markdown.replace(/\]\((\/[^)\s#]*)(#[^)\s]*)?\)/g, (whole, p: string, hash: string | undefined) => {
    const file = targets.get(p.replace(/\/+$/, "") || "/");
    if (!file) return whole;
    if (file === fromFile && hash) return `](${hash})`;
    let rel = path.posix.relative(path.posix.dirname(fromFile), file);
    if (!rel.startsWith(".")) rel = `./${rel}`;
    return `](${rel}${hash ?? ""})`;
  });
}

/** Relative link from one package file to another. */
function link(fromFile: string, toFile: string): string {
  const rel = path.posix.relative(path.posix.dirname(fromFile), toFile);
  return rel.startsWith(".") ? rel : `./${rel}`;
}

function dedupeSources(run: RunState): { url: string; title: string; date: string; kind: string; usedBy: string[] }[] {
  const out = new Map<string, { url: string; title: string; date: string; kind: string; usedBy: string[] }>();
  const add = (s: { url: string; title: string; date: string; kind: string }, by: string) => {
    if (!s.url || !/^https?:\/\//.test(s.url)) return;
    const cur = out.get(s.url);
    if (cur) {
      if (!cur.usedBy.includes(by)) cur.usedBy.push(by);
      if (cur.date === "unknown" && s.date !== "unknown") cur.date = s.date;
    } else out.set(s.url, { ...s, usedBy: [by] });
  };
  for (const key of ["company", "role", "interview", "coding"]) {
    const a = run.artifacts[key] as { sources?: Source[] } | undefined;
    for (const s of a?.sources ?? []) add({ url: s.url, title: s.title, date: s.publishedDate, kind: s.kind }, key);
    const web = run.artifacts[`${key}WebSources`] as WebSource[] | undefined;
    for (const s of web ?? []) add({ url: s.url, title: s.title, date: s.pageAge, kind: "search result" }, key);
  }
  return [...out.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/** Markdown/HTML to plain text for structured data. */
function plainText(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#|]/g, "")
    .replace(/^\s*[-+]\s+\[[ xX]\]\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Questions and answers from the page's FAQ section (collapsible items, or ### question headings). */
export function extractFaq(body: string): { question: string; answer: string }[] {
  const heading = body.match(/^(#{2,3})\s+(frequently asked questions|faqs?)\b.*$/im);
  if (!heading || heading.index === undefined) return [];
  const level = heading[1].length;
  const rest = body.slice(heading.index + heading[0].length);
  const end = rest.search(new RegExp(`^#{1,${level}}\\s`, "m"));
  const section = end >= 0 ? rest.slice(0, end) : rest;
  // A collapsible's summary is only plain text; drop it from answers.
  const answerText = (s: string) => plainText(s.replace(/<summary>[\s\S]*?<\/summary>/g, " "));
  let out: { question: string; answer: string }[] = [];
  // 1. One question per sub-heading (the answer may sit in a "Show answer" collapsible).
  const parts = section.split(new RegExp(`^#{${level + 1}}\\s+`, "m")).slice(1);
  for (const p of parts) {
    const [q, ...a] = p.split("\n");
    out.push({ question: plainText(q), answer: answerText(a.join("\n")) });
  }
  // 2. Otherwise, one question per collapsible, using its summary as the question.
  if (!out.some((x) => x.question && x.answer)) {
    out = [];
    for (const m of section.matchAll(/<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)) {
      out.push({ question: plainText(m[1]), answer: plainText(m[2]) });
    }
  }
  const generic = /^(show|view|see|reveal)?\s*(the\s+)?answer$/i;
  return out
    .filter((x) => x.question && x.answer && !generic.test(x.question))
    .map((x) => ({ question: x.question.slice(0, 300), answer: x.answer.slice(0, 1200) }));
}

/** FAQPage (from the FAQ section) and BreadcrumbList (from the URL hierarchy) JSON-LD for a landing page. */
function structuredData(page: PlannedPage, body: string, h1: string, company: string): object[] {
  const segments = page.url.split("/").filter(Boolean); // interview, companies, <company>, [<type|role|coding-questions>]
  const names = ["Interview prep", "Companies", company];
  const crumbs = segments.map((_, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: i < names.length ? names[i] : h1,
    item: `${SITE}/${segments.slice(0, i + 1).join("/")}/`,
  }));
  const out: object[] = [{ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: crumbs }];
  const faq = extractFaq(body);
  if (faq.length)
    out.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })),
    });
  return out;
}

/** Build every output file from the final page drafts and the research. */
export function assembleFiles(run: RunState): Record<string, string> {
  const { input } = run;
  const files: Record<string, string> = {};
  const root = packageRoot(input.company);
  const out = outputPaths(run);
  const companyJsonPath = `${EXTRAS}/${input.companySlug}.company.json`;
  const X = (f: string) => `${EXTRAS}/${f}`;
  const targets = linkTargets(run.pages, out, [X("README.md"), X("research-report.md"), X("sources.md"), X("seo-metadata.md"), companyJsonPath]);
  // Agents may link the old supporting-file paths; point them at Extras/.
  for (const f of ["README.md", "research-report.md", "sources.md"]) targets.set(`/${f}`, X(f));
  targets.set("/seo/seo-metadata.md", X("seo-metadata.md"));
  const interview = run.artifacts.interview as InterviewResearch | undefined;
  const company = run.artifacts.company as CompanyResearch | undefined;
  const today = new Date().toISOString().slice(0, 10);
  const seoRows: string[] = [];
  const companyName = company?.companyName ?? input.company;

  // Pass 1: metadata for every written page.
  const built: { page: PlannedPage; meta: Record<string, unknown>; body: string }[] = [];
  for (const page of run.pages) {
    const d = run.pageDrafts[page.path] ?? {};
    let body = (d.final as string | undefined) ?? (d.markdown as string | undefined);
    if (!body) continue; // missing pages are reported by validation
    if (page.kind === "study" && out.get(page.path) === "Coding-Question.md") continue; // merged below
    if (page.pageType === "company-coding-questions") {
      const topicPages = run.pages.filter((p) => p.kind === "study" && out.get(p.path) === "Coding-Question.md");
      const bodies = topicPages.map((p) => (run.pageDrafts[p.path]?.final ?? run.pageDrafts[p.path]?.markdown) as string | undefined).filter((b): b is string => !!b);
      const order = ((run.artifacts.coding as { questions?: { id: string }[] } | undefined)?.questions ?? []).map((q) => q.id);
      body = mergeSolutions(body, bodies, order);
    }
    const seo = d.seo as SeoResult | undefined;
    // The company page follows the keyword plan from the company sheet wherever the sheet has a value.
    const plan = page.pageType === "company" ? input.sheet : undefined;
    if (plan?.h1) body = /^#\s+.+$/m.test(body) ? body.replace(/^#\s+.+$/m, `# ${plan.h1}`) : `# ${plan.h1}\n\n${body}`;
    const h1 = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? page.title;
    const meta: Record<string, unknown> = {
      title: plan?.metaTitle || (seo?.title ?? page.title),
      metaDescription: plan?.metaDescription || (seo?.metaDescription ?? ""),
      h1: plan?.h1 || (seo?.h1 ?? h1),
      pageType: page.pageType,
      primaryKeyword: plan?.keyword || (seo?.primaryKeyword ?? ""),
      secondaryKeywords: plan?.secondaryKeywords.length ? [...new Set([...plan.secondaryKeywords, ...(seo?.secondaryKeywords ?? [])])] : (seo?.secondaryKeywords ?? []),
      ...(plan ? { searchVolume: plan.svLabel || null } : {}),
      searchIntent: seo?.searchIntent ?? "informational",
    };
    if (page.kind === "landing") {
      // Per-page settings from the Hub Map doc ("Settings on every Guide page").
      Object.assign(meta, {
        slug: page.url.split("/").filter(Boolean).pop(),
        url: page.url,
        parent: page.parent,
        canonical: `${SITE}${page.url}`,
        index: true,
        sitemapSegment: "interview-companies",
        ctaCriteria: page.criteria,
        lastVerified: interview?.lastVerified ?? today,
      });
    } else {
      // A study page on the same topic as a landing page points its canonical at that landing page.
      const twin = landingCounterpart(page, run.pages);
      Object.assign(meta, {
        suggestedSlug: seo?.slug ?? path.posix.basename(page.path, ".md"),
        index: false,
        ...(twin ? { canonical: `${SITE}${twin.url}`, landingPage: twin.url } : {}),
      });
    }
    Object.assign(meta, {
      lastUpdated: today,
      internalLinks: seo?.internalLinks ?? [],
      imageAltText: seo?.imageAltText ?? [],
    });
    if (page.kind === "landing") meta.structuredData = structuredData(page, body, String(meta.h1), companyName);
    meta.generatedBy = "interview-guide-generator";
    built.push({ page, meta, body });
  }

  // Pass 2: titles must be unique across the package. Study pages give way to landing pages.
  const byTitle = new Map<string, typeof built>();
  for (const b of built) {
    const t = String(b.meta.title).trim().toLowerCase();
    byTitle.set(t, [...(byTitle.get(t) ?? []), b]);
  }
  for (const group of byTitle.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => (a.page.kind === b.page.kind ? 0 : a.page.kind === "landing" ? -1 : 1));
    group.slice(1).forEach((b, i) => {
      const suffix = b.page.kind === "study" ? " – In-Depth Study Guide" : ` (${i + 2})`;
      b.meta.title = `${String(b.meta.title).replace(/\s*[–-]\s*in-depth study guide$/i, "")}${suffix}`;
    });
  }

  for (const { page, meta, body } of built) {
    const file = out.get(page.path)!;
    files[file] = frontmatter(meta) + rewriteInternalLinks(body.trim() + "\n", file, targets);
    // seo-metadata.md lives in Extras/, so its links step up one folder.
    seoRows.push(
      `| [${file}](${link(X("seo-metadata.md"), file)}) | ${String(meta.title).replace(/\|/g, "\\|")} | ${String(meta.metaDescription).replace(/\|/g, "\\|")} | ${meta.primaryKeyword} | ${meta.searchIntent} |`,
    );
  }

  // CMS entry for the Company content type (Hub Map doc → Content types).
  files[companyJsonPath] = JSON.stringify(
    {
      name: company?.companyName ?? input.company,
      slug: input.companySlug,
      logo: "",
      overview: company?.overview ?? "",
      ...(input.sheet ? { keywordPlan: input.sheet } : {}),
      rounds: (interview?.rounds ?? []).map((r) => ({
        order: r.order,
        name: r.name,
        type: r.type,
        aiRules: r.aiRules,
        format: r.format,
        length: r.length,
        confidence: r.confidence,
        sources: r.sourceUrls,
        lastVerified: interview?.lastVerified ?? today,
      })),
    },
    null,
    2,
  );

  files[X("research-report.md")] = reportMarkdown(buildReport(run), today);

  const sources = dedupeSources(run);
  files[X("sources.md")] =
    `# Sources\n\nEvery source the research agents used for this guide, as of ${today}. Dates are publication dates where the source gave one.\n\n| Source | Date | Kind | Used by |\n| --- | --- | --- | --- |\n` +
    sources
      .map((s) => `| [${s.title.replace(/\|/g, "\\|").replace(/[[\]]/g, "")}](${s.url}) | ${s.date} | ${s.kind} | ${s.usedBy.join(", ")} |`)
      .join("\n") +
    "\n";

  files[X("seo-metadata.md")] =
    `# SEO metadata\n\nPer-page metadata. The same values are in each page's frontmatter.\n\n| Page | Title | Meta description | Primary keyword | Intent |\n| --- | --- | --- | --- | --- |\n${seoRows.join("\n")}\n`;

  const written = (pred: (p: PlannedPage) => boolean) =>
    run.pages.filter((p) => pred(p) && files[out.get(p.path)!]).sort((a, b) => rank(a) - rank(b) || out.get(a.path)!.localeCompare(out.get(b.path)!));
  const item = (p: PlannedPage) => `- [${out.get(p.path)!.split("/").pop()!.replace(/\.md$/, "").replace(/-/g, " ")}](${link(X("README.md"), out.get(p.path)!)}) → \`${p.url}\``;
  const section = (title: string, ps: PlannedPage[]) => (ps.length ? [`## ${title}`, "", ...ps.map(item), ""] : []);
  const study = written((p) => p.kind === "study" && out.get(p.path) !== "Coding-Question.md");
  files[X("README.md")] = [
    `# ${input.company} interview preparation`,
    "",
    `Generated ${today}. Roles covered: ${(run.selection?.roles ?? []).join(", ") || "none"}. Interview types covered: ${(run.selection?.interviewTypes ?? []).join(", ") || "none"}. Both were discovered by research, then chosen for this package. Content covers every level from entry to staff.`,
    "",
    "## Folder layout",
    "",
    "```",
    `${root}/`,
    "├── Company-Guide.md        the company, its products, roles and interview process",
    "├── Coding-Question.md      coding questions with full solutions",
    "├── Roles/                  one page per role",
    "├── Interview-Types/        one page per interview type",
    `└── ${EXTRAS}/                 research report, sources, SEO metadata, CMS entry, validation report`,
    "```",
    "",
    "Each page maps to a live URL (shown below). Its frontmatter holds the Guide template settings (slug, parent, canonical, index flag, sitemap segment, CTA criteria, SEO fields) and `structuredData`: FAQPage and BreadcrumbList JSON-LD for the page template to output in a <script type=\"application/ld+json\"> tag.",
    "",
    ...section("Guide", written((p) => p.pageType === "company" || p.pageType === "company-coding-questions")),
    ...section("Roles", written((p) => p.pageType === "company-role")),
    ...section("Interview types", written((p) => p.pageType === "company-interview-type")),
    ...(study.length ? ["## Study guide (older run)", "", ...study.map((p) => `- [${p.title}](${link(X("README.md"), out.get(p.path)!)})`), ""] : []),
    "## Other files",
    "",
    "- [research-report.md](research-report.md): what research found: the company, its computer science roles and interview types (one line each), and the coding questions",
    `- [${companyJsonPath.split("/").pop()}](${companyJsonPath.split("/").pop()}): CMS entry for the Company content type, including interview rounds`,
    "- [sources.md](sources.md): every source used, with dates",
    "- [seo-metadata.md](seo-metadata.md): per-page SEO metadata",
    "- [validation-report.md](validation-report.md): link, structure and completeness checks",
    "",
    "## How to read confidence labels",
    "",
    "- **Verified**: stated by the company or an official job posting.",
    "- **Reported**: described by multiple recent candidate reports.",
    "- **Inferred / general practice**: typical across the industry; not confirmed for this company.",
    "",
  ].join("\n");

  // Prefix all files with the package root folder.
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [`${root}/${k}`, v]));
}
