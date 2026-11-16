import JSZip from "jszip";
import { AGENT_BY_KEY, type AgentKey, type Effort, type Provider } from "./agents/defaults";

export type AgentCallCfg = { provider: Provider; model: string; effort: Effort; prompt: string };
import {
  CodingResearch,
  CompanyResearch,
  InteractiveResult,
  InterviewResearch,
  PageDraft,
  QaResult,
  RoleResearch,
  SeoResult,
} from "./agents/schemas";
import { addUsage, describeError, emptyUsage, fillPrompt, research, resolveModelCfg, structured } from "./llm";
import { getAgentConfig } from "./prompts";

/** An agent's saved config with the provider/model it will actually run on (key fallback applied). */
async function agentConfig(key: AgentKey) {
  return resolveModelCfg(getAgentConfig(key));
}
import { codingIndex, discoveredInterviewTypes, landingCounterpart, pageDigest, planPages, roleIndex } from "./pages";
import { assembleFiles, EXTRAS, outputPaths, PACKAGE_LAYOUT } from "./assemble";
import { filterCsRoles } from "./report";
import { validatePackage } from "./validate";
import { getRun, updateRun, type PlannedPage, type RunState, type SheetInfo, type Usage } from "./store";

// ------------------------------------------------------------------ agent calls

const RESEARCH: Record<"company" | "role" | "interview" | "coding", { schema: typeof CompanyResearch | typeof RoleResearch | typeof InterviewResearch | typeof CodingResearch; searches: number }> = {
  company: { schema: CompanyResearch, searches: 12 },
  role: { schema: RoleResearch, searches: 10 },
  interview: { schema: InterviewResearch, searches: 15 },
  coding: { schema: CodingResearch, searches: 15 },
};

export type DiscoveredRoleRef = { slug: string; title: string };

/** Research task. Only the company is given; stage-2 agents also get the roles discovered in stage 1. */
export function researchTask(company: string, roles?: DiscoveredRoleRef[], sheet?: SheetInfo) {
  const roleText = roles?.length
    ? `\nRoles this company was found to hire for (use these slugs when you say which roles something applies to):\n${roles.map((r) => `- ${r.slug}: ${r.title}`).join("\n")}\n`
    : "";
  return `Company: ${company}\n${roleText}${sheetBrief(sheet)}\nOnly the company name is given. Discover the rest yourself according to your instructions. Be thorough and cite sources with URLs and dates.`;
}

/**
 * The company's row from the company sheet, as a research brief: the searches the guide must answer.
 * These are what readers search for, not facts about the company.
 */
export function sheetBrief(sheet?: SheetInfo): string {
  if (!sheet) return "";
  const lines = [
    sheet.keyword && `Primary search query: "${sheet.keyword}"${sheet.svLabel ? ` (${sheet.svLabel} searches a month)` : ""}`,
    sheet.secondaryKeywords.length && `Related search queries:\n${sheet.secondaryKeywords.map((k) => `- ${k}`).join("\n")}`,
    sheet.url && `Landing page URL: ${sheet.url}`,
    sheet.h1 && `Planned H1: ${sheet.h1}`,
    sheet.metaTitle && `Planned meta title: ${sheet.metaTitle}`,
    sheet.metaDescription && `Planned meta description (promises the page must keep): ${sheet.metaDescription}`,
  ].filter(Boolean);
  if (!lines.length) return "";
  return `
<search_brief>
From Educative's keyword plan for this company. These are the questions readers search for, not facts about the company.
${lines.join("\n")}
</search_brief>
Within your own area of research, find evidence that answers each query in the brief that relates to it (for example, "interview timeline" needs how long the process takes; "how to get an interview" needs how candidates get a referral or recruiter screen; "interview difficulty" needs what candidates report). Where the planned H1, meta title or description promise something (like real questions or a prep plan), make sure your findings support it. Never present a query as a fact. If you cannot find evidence for a query, say so in your notes.
`;
}

export async function runResearchAgent(key: "company" | "role" | "interview" | "coding", cfg: AgentCallCfg, company: string, roles?: DiscoveredRoleRef[], sheet?: SheetInfo) {
  const spec = RESEARCH[key];
  return research({
    cfg,
    task: researchTask(company, roles, sheet),
    schema: spec.schema,
    label: AGENT_BY_KEY[key].name,
    maxSearches: spec.searches,
  });
}

function pageListForPrompt(pages: PlannedPage[]) {
  return pages.map((p) => `- /${p.path}  (${p.kind}, ${p.title}${p.kind === "landing" ? `, URL ${p.url}` : ""})`).join("\n");
}

function selectedRoleText(run: Pick<RunState, "selection" | "artifacts">) {
  const roles = (run.artifacts.role as RoleResearch | undefined)?.roles ?? [];
  const picked = run.selection?.roles ?? [];
  return roles.filter((r) => picked.includes(r.slug)).map((r) => `${r.title} (${r.slug})`).join(", ") || "none";
}

export function writerUserMessage(run: Pick<RunState, "input" | "pages" | "artifacts" | "selection">, page: PlannedPage) {
  const extra =
    page.criteria.topic
      ? `\nFor each question: give it an H2 heading and put <a id="QUESTION_ID"></a> on the line before the heading, using the question's id from the research. Include all ten parts (problem statement, difficulty, topic and pattern, explanation, example input/output, constraints, step-by-step approach, optimized solution in a fenced code block, time and space complexity, follow-up questions). State each question's evidence label honestly.`
      : page.pageType === "company-coding-questions"
        ? `\nStart with a summary table of every question (title linked to its section with #QUESTION_ID, difficulty, pattern, evidence label). Then the main section: for each question an H3 heading with <a id="QUESTION_ID"></a> on the line before it, using the question's id from the research, followed by the problem statement, difficulty and pattern, evidence label, roles it suits, example input/output, constraints, step-by-step approach, the optimized solution in a fenced code block inside a <details> block, time and space complexity, follow-up questions, and its Educative problem link when educativeUrl is not empty. State each question's evidence label honestly.`
        : "";
  // The company page is the one the sheet's keyword plan targets.
  const sheet = page.pageType === "company" ? run.input.sheet : undefined;
  const brief = sheet
    ? `\n<search_brief>\nThis page targets these searches from Educative's keyword plan. Answer every one of them somewhere on the page (a section, an At-a-glance row or an FAQ), using the research.\nPrimary keyword: ${sheet.keyword}\nSecondary keywords: ${sheet.secondaryKeywords.join("; ") || "none"}\n${sheet.h1 ? `Use this exact H1: ${sheet.h1}\n` : ""}${sheet.metaDescription ? `The meta description promises: ${sheet.metaDescription} Make sure the page delivers each promise.\n` : ""}</search_brief>\n`
    : "";
  return `<page_spec>
Path: ${page.path}
Kind: ${page.kind === "landing" ? "Landing page (Guide template)" : "Study page"}
Page type: ${page.pageType}
Working title: ${page.title}
Purpose: ${page.purpose}
${page.sections.length ? `Guide sections to use: ${page.sections.join("; ")}` : ""}
Criteria: ${JSON.stringify(page.criteria)}
Company: ${run.input.company}
Roles in this package: ${selectedRoleText(run)}
Audience: candidates at every level (entry to staff)
</page_spec>

<package_pages>
Link to these pages with root-relative paths exactly as listed, e.g. [Coding questions](/${page.path}). Do not invent other internal paths.
${pageListForPrompt(run.pages)}
</package_pages>
${extra}${brief}

<research>
${pageDigest(page, run.artifacts, run.selection?.roles ?? [])}
</research>

Write the page now. Return the Markdown, the source URLs you cited, and any gaps you could not fill from the research.`;
}

export async function runWriter(cfg: AgentCallCfg, user: string) {
  return structured({ cfg, system: [fillPrompt(cfg.prompt)], user, schema: PageDraft, label: "Content Writing Agent" });
}

export async function runInteractive(cfg: AgentCallCfg, markdown: string) {
  return structured({
    cfg,
    system: [fillPrompt(cfg.prompt)],
    user: `<page>\n${markdown}\n</page>\n\nReturn the full enhanced page and a list of the elements you added.`,
    schema: InteractiveResult,
    label: "Interactive Content Agent",
  });
}

export async function runSeo(cfg: AgentCallCfg, markdown: string, context: string) {
  return structured({
    cfg,
    system: [fillPrompt(cfg.prompt)],
    user: `${context}\n\n<page>\n${markdown}\n</page>\n\nReturn the page's SEO metadata and the full optimized Markdown.`,
    schema: SeoResult,
    label: "SEO Optimization Agent",
  });
}

export async function runQa(cfg: AgentCallCfg, markdown: string, digest: string, packagePages = "") {
  const pagesBlock = packagePages
    ? `<package_pages>\nEvery page in this package. Internal links must point to one of these paths exactly (root-relative). Fix a link that doesn't match to the right page, or remove the link and keep its text. Do not report internal links as unresolved.\n${packagePages}\n</package_pages>\n\n`
    : "";
  return structured({
    cfg,
    system: [fillPrompt(cfg.prompt)],
    user: `${pagesBlock}<research_digest>\n${digest}\n</research_digest>\n\n<page>\n${markdown}\n</page>\n\nReturn the corrected page, your corrections, anything unresolved, and a status.`,
    schema: QaResult,
    label: "Proofreading & QA Agent",
  });
}

// ------------------------------------------------------------------ orchestration

const STAGES = ["write", "interactive", "seo", "qa"] as const;
type Stage = (typeof STAGES)[number];
const STAGE_AGENT: Record<Stage, AgentKey> = { write: "writer", interactive: "interactive", seo: "seo", qa: "qa" };

const g = globalThis as unknown as { __activeRuns?: Set<string> };
const active = (g.__activeRuns ??= new Set<string>());
export const isActive = (id: string) => active.has(id);

const PAGE_CONCURRENCY = Math.max(1, Number(process.env.PAGE_CONCURRENCY ?? 4));
const CHECK_EXTERNAL_LINKS = process.env.CHECK_EXTERNAL_LINKS !== "false";

function ensureStep(run: RunState, key: string, label: string, group: string, agent?: AgentKey) {
  if (!run.steps[key]) {
    run.steps[key] = { key, label, group, agent, status: "pending" };
    run.stepOrder.push(key);
  }
}

function log(id: string, msg: string) {
  updateRun(id, (r) => {
    r.log.push(`${new Date().toISOString().slice(11, 19)} ${msg}`);
    if (r.log.length > 500) r.log = r.log.slice(-500);
  });
}

/** Run one step: skip if already done, record timing, usage and errors. */
async function step(id: string, key: string, fn: () => Promise<{ usage?: Usage; warnings?: string[]; skipped?: boolean } | void>): Promise<boolean> {
  const s = getRun(id)!.steps[key];
  if (s.status === "done" || s.status === "skipped") return true;
  const cfg = s.agent ? await agentConfig(s.agent) : null;
  updateRun(id, (r) => {
    Object.assign(r.steps[key], { status: "running", startedAt: new Date().toISOString(), error: undefined, warnings: undefined });
    if (cfg) {
      r.steps[key].promptVersion = cfg.version;
      r.steps[key].provider = cfg.provider;
      r.steps[key].model = cfg.model;
      r.steps[key].fallbackFrom = cfg.fallbackFrom;
      r.steps[key].global = cfg.global;
    }
  });
  try {
    const res = (await fn()) || {};
    updateRun(id, (r) => {
      Object.assign(r.steps[key], {
        status: res.skipped ? "skipped" : "done",
        endedAt: new Date().toISOString(),
        usage: res.usage,
        warnings: res.warnings?.length ? res.warnings : undefined,
      });
    });
    return true;
  } catch (err) {
    const msg = describeError(err);
    updateRun(id, (r) => Object.assign(r.steps[key], { status: "failed", endedAt: new Date().toISOString(), error: msg }));
    log(id, `✗ ${getRun(id)!.steps[key].label}: ${msg}`);
    return false;
  }
}

async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

async function runPage(id: string, page: PlannedPage) {
  for (let si = 0; si < STAGES.length; si++) {
    const stage = STAGES[si];
    const key = `page:${page.path}:${stage}`;
    const ok = await step(id, key, async () => {
      const run = getRun(id)!;
      const agent = STAGE_AGENT[stage];
      const cfg = await agentConfig(agent);
      const drafts = run.pageDrafts[page.path] ?? {};
      const prevMd = si === 0 ? "" : (drafts[`md_${STAGES[si - 1]}`] as string);
      const save = (patch: Record<string, unknown>) =>
        updateRun(id, (r) => {
          r.pageDrafts[page.path] = { ...(r.pageDrafts[page.path] ?? {}), ...patch };
        });

      if (stage !== "write" && !cfg.enabled) {
        save({ [`md_${stage}`]: prevMd, ...(stage === "qa" ? { final: prevMd } : {}) });
        return { skipped: true };
      }
      if (stage === "write") {
        const { data, usage } = await runWriter(cfg, writerUserMessage(run, page));
        save({ md_write: data.markdown, write: data });
        return { usage, warnings: data.notes };
      }
      if (stage === "interactive") {
        const { data, usage } = await runInteractive(cfg, prevMd);
        save({ md_interactive: data.markdown, interactive: data });
        return { usage };
      }
      if (stage === "seo") {
        const twin = landingCounterpart(page, run.pages);
        const twinNote = twin
          ? `\nThe landing page ${twin.url} ("${twin.title}") covers the same topic and is the canonical page. Give this study page a clearly different title and meta description that present it as the in-depth study guide (for example, end the title with "In-Depth Study Guide"), and link to the landing page.`
          : "";
        const sheet = page.pageType === "company" ? run.input.sheet : undefined;
        const planNote = sheet
          ? `\nKeyword plan for this page (from Educative's company sheet; follow it):\n- primaryKeyword: ${sheet.keyword}\n- secondaryKeywords: ${sheet.secondaryKeywords.join("; ")}\n${sheet.h1 ? `- h1 (use exactly): ${sheet.h1}\n` : ""}${sheet.metaTitle ? `- title (use exactly): ${sheet.metaTitle}\n` : ""}${sheet.metaDescription ? `- metaDescription (use exactly): ${sheet.metaDescription}\n` : ""}Where the plan leaves a field blank, write it yourself around the primary keyword.`
          : "";
        const ctx = `<page_spec>\nPath: ${page.path}\nKind: ${page.kind}\nPage type: ${page.pageType}\nWorking title: ${page.title}\nURL: ${page.url}\nCriteria: ${JSON.stringify(page.criteria)}\nCompany slug: ${run.input.companySlug}; role slugs in this package: ${(run.selection?.roles ?? []).join(", ")}${twinNote}${planNote}\n</page_spec>\n\n<package_pages>\nUse root-relative links exactly as listed.\n${pageListForPrompt(run.pages)}\n</package_pages>`;
        const { data, usage } = await runSeo(cfg, prevMd, ctx);
        save({ md_seo: data.markdown, seo: data });
        return { usage };
      }
      const { data, usage } = await runQa(cfg, prevMd, pageDigest(page, run.artifacts, run.selection?.roles ?? []), pageListForPrompt(run.pages));
      save({ md_qa: data.markdown, final: data.markdown, qa: data });
      return { usage, warnings: [...data.unresolved, ...(data.status === "fail" ? ["QA marked this page as failing review."] : [])] };
    });
    if (!ok) return;
  }
}

export async function runPipeline(id: string): Promise<void> {
  if (active.has(id)) return;
  active.add(id);
  try {
    updateRun(id, (r) => {
      r.status = "running";
      r.error = undefined;
      ensureStep(r, "research:company", "Company research", "Research", "company");
      ensureStep(r, "research:role", "Role discovery", "Research", "role");
      ensureStep(r, "research:interview", "Interview loop discovery", "Research", "interview");
      ensureStep(r, "research:coding", "Coding topics and questions", "Research", "coding");
      ensureStep(r, "select", "Choose roles and interview types", "Planning");
      ensureStep(r, "plan", "Plan pages", "Planning");
    });
    log(id, "Pipeline started");

    const { company, sheet } = getRun(id)!.input;
    const researchStep = (k: "company" | "role" | "interview" | "coding", roles?: DiscoveredRoleRef[]) =>
      step(id, `research:${k}`, async () => {
        const cfg = await agentConfig(k);
        if (!cfg.enabled) return { skipped: true };
        const res = await runResearchAgent(k, cfg, company, roles, sheet);
        const { notes, webSources, usage } = res;
        let data = res.data;
        // Computer science roles only: drop HR, admin, sales, product management and other non-technical roles.
        let excluded: string[] = [];
        if (k === "role") ({ kept: data, excluded } = filterCsRoles(data as RoleResearch));
        updateRun(id, (r) => {
          if (k === "role") r.artifacts.roleExcluded = excluded;
          r.artifacts[k] = data;
          r.artifacts[`${k}Notes`] = notes;
          r.artifacts[`${k}WebSources`] = webSources;
          if (k === "coding") {
            r.artifacts.codingIndex = codingIndex(data as CodingResearch);
            r.artifacts.codingTopics = (data as CodingResearch).emphasizedTopics;
          }
          if (k === "role") r.artifacts.roleIndex = roleIndex(data as RoleResearch);
        });
        const warnings: string[] = [];
        if (k === "role" && (data as RoleResearch).roles.length === 0)
          throw new Error(`No computer science roles were found for this company${excluded.length ? ` (only non-technical roles: ${excluded.slice(0, 5).join(", ")})` : ""}. Check the company name, or retry.`);
        if (k === "role" && excluded.length) warnings.push(`Left out ${excluded.length} non-technical role(s): ${excluded.join(", ")}`);
        if (k === "interview" && (data as InterviewResearch).rounds.length === 0) warnings.push("No interview rounds found.");
        if (k === "coding" && (data as CodingResearch).questions.length === 0) warnings.push("No coding questions produced.");
        return { usage, warnings };
      });
    const failedResearch = (keys: string[]) => {
      const r = getRun(id)!;
      const failed = keys.filter((k) => r.steps[k].status === "failed");
      if (failed.length) throw new Error(`Research did not finish (${failed.map((k) => r.steps[k].label).join(", ")}). Retry the failed step.`);
    };

    // Stage 1: company and role discovery. Stage 2 needs the roles found.
    await Promise.all([researchStep("company"), researchStep("role")]);
    failedResearch(["research:company", "research:role"]);
    const roles = (getRun(id)!.artifacts.role as RoleResearch).roles.map((r) => ({ slug: r.slug, title: r.title }));
    await Promise.all([researchStep("interview", roles), researchStep("coding", roles)]);
    failedResearch(["research:interview", "research:coding"]);

    // Pause for the user to choose which roles and interview types get pages.
    if (!getRun(id)!.selection) {
      updateRun(id, (r) => {
        r.status = "awaiting-selection";
        Object.assign(r.steps.select, { status: "running", startedAt: r.steps.select.startedAt ?? new Date().toISOString() });
      });
      log(id, "Discovery done. Waiting for you to choose roles and interview types.");
      return;
    }
    updateRun(id, (r) => Object.assign(r.steps.select, { status: "done", endedAt: r.steps.select.endedAt ?? new Date().toISOString() }));
    let run = getRun(id)!;

    await step(id, "plan", async () => {
      let r = getRun(id)!;
      // Re-run research can drop a role or interview type that was chosen; keep only what still exists.
      const roleSlugs = new Set((r.artifacts.role as RoleResearch).roles.map((x) => x.slug));
      const typeSlugs = new Set(discoveredInterviewTypes(r.artifacts.interview as InterviewResearch).map((t) => t.type));
      const sel = r.selection!;
      const dropped = [...sel.roles.filter((x) => !roleSlugs.has(x)), ...sel.interviewTypes.filter((t) => !typeSlugs.has(t))];
      if (dropped.length) {
        updateRun(id, (x) => {
          x.selection = { ...sel, roles: sel.roles.filter((s) => roleSlugs.has(s)), interviewTypes: sel.interviewTypes.filter((t) => typeSlugs.has(t)) };
        });
        log(id, `No longer found by research, so dropped from the guide: ${dropped.join(", ")}`);
        r = getRun(id)!;
        if (!r.selection!.roles.length) throw new Error("None of the chosen roles were found by the new role research. Re-run role research with page rewriting to choose again.");
      }
      const pages = planPages(r.input, r.selection!, {
        interview: r.artifacts.interview as InterviewResearch,
        role: r.artifacts.role as RoleResearch,
        coding: r.artifacts.coding as CodingResearch | undefined,
      });
      updateRun(id, (x) => {
        x.pages = pages;
        // Pages no longer planned (e.g. a role that research no longer finds) lose their steps.
        const keep = new Set(pages.map((p) => p.path));
        for (const k of Object.keys(x.steps)) {
          const m = k.match(/^page:(.+):(\w+)$/);
          if (m && !keep.has(m[1])) {
            delete x.steps[k];
            delete x.pageDrafts[m[1]];
          }
        }
        x.stepOrder = x.stepOrder.filter((k) => x.steps[k]);
        // Research that was re-run: rewrite every page that draws on it.
        const changed = new Set((x.pendingRewrite ?? []).flatMap((k) => RESEARCH_INPUTS[k] ?? []));
        if (changed.size) {
          let n = 0;
          for (const p of pages)
            if (p.inputs.some((i) => changed.has(i)))
              for (const s of STAGES) {
                const st = x.steps[`page:${p.path}:${s}`];
                if (st) Object.assign(st, { status: "pending", error: undefined, warnings: undefined, startedAt: undefined, endedAt: undefined, usage: undefined }), (n += s === "write" ? 1 : 0);
              }
          x.log.push(`${new Date().toISOString().slice(11, 19)} Rewriting ${n} page(s) that use the re-run research`);
          x.pendingRewrite = undefined;
        }
        for (const p of pages)
          for (const s of STAGES) ensureStep(x, `page:${p.path}:${s}`, `${p.path} · ${s}`, `page:${p.path}`, STAGE_AGENT[s]);
        ensureStep(x, "assemble", "Assemble files", "Finalize");
        ensureStep(x, "validate", "Validate links, structure, completeness", "Finalize");
        ensureStep(x, "package", "Build ZIP", "Finalize");
      });
      log(id, `Planned ${pages.length} pages`);
    });
    run = getRun(id)!;
    if (run.steps.plan.status !== "done") throw new Error("Page planning failed.");

    await mapLimit(run.pages, PAGE_CONCURRENCY, (p) => runPage(id, p));
    run = getRun(id)!;
    const failedPages = run.pages.filter((p) => STAGES.some((s) => run.steps[`page:${p.path}:${s}`]?.status === "failed"));
    if (failedPages.length) throw new Error(`${failedPages.length} page(s) failed. Retry them to finish the guide; it was not packaged.`);

    await step(id, "assemble", async () => {
      const files = assembleFiles(getRun(id)!);
      updateRun(id, (r) => {
        r.files = files;
        r.artifacts.packageLayout = PACKAGE_LAYOUT;
      });
    });

    let validationOk = true;
    await step(id, "validate", async () => {
      const result = await validateRunFiles(id);
      if (result.errors.length) {
        validationOk = false;
        throw new Error(`${result.errors.length} problem(s) make the guide incomplete: ${result.errors.slice(0, 5).map((e) => `${e.file.split("/").slice(1).join("/")}: ${e.problem}`).join(" | ")}. Re-run those pages, then retry validation.`);
      }
      return { warnings: [`${result.brokenLinksRemoved.length} broken links removed, ${result.unverifiedLinks.length} unverified, ${result.warnings.length} warnings. See validation-report.md.`] };
    });
    if (!validationOk || getRun(id)!.steps.validate.status !== "done") throw new Error("Validation failed; the guide was not packaged.");

    await step(id, "package", async () => {
      const zip = await buildZip(getRun(id)!);
      return { warnings: [`ZIP is ${(zip.length / 1024).toFixed(0)} KB with ${Object.keys(getRun(id)!.files).length} files.`] };
    });
    if (getRun(id)!.steps.package.status !== "done") throw new Error("ZIP generation failed.");

    updateRun(id, (r) => (r.status = "done"));
    log(id, "✓ Guide complete");
  } catch (err) {
    const msg = describeError(err);
    updateRun(id, (r) => {
      r.status = "failed";
      r.error = msg;
    });
    log(id, `Stopped: ${msg}`);
  } finally {
    active.delete(id);
  }
}

/** Validate the run's assembled files (links, structure), add unresolved QA notes, and save the result. */
async function validateRunFiles(id: string) {
  const r = getRun(id)!;
  const result = await validatePackage(r.files, { checkExternal: CHECK_EXTERNAL_LINKS });
  // Unresolved QA issues go into the report too.
  const out = outputPaths(r);
  const qaIssues = r.pages.flatMap((p) => ((r.pageDrafts[p.path]?.qa as QaResult | undefined)?.unresolved ?? []).map((u) => `- \`${out.get(p.path) ?? p.path}\`: ${u}`));
  const root = Object.keys(result.files)[0].split("/")[0];
  if (qaIssues.length) result.files[`${root}/${EXTRAS}/validation-report.md`] += `\n## Unresolved QA notes (${qaIssues.length})\n\n${qaIssues.join("\n")}\n`;
  updateRun(id, (x) => {
    x.files = result.files;
    x.artifacts.validation = { errors: result.errors, warnings: result.warnings.length, linksChecked: result.linksChecked, brokenLinksRemoved: result.brokenLinksRemoved.length, unverifiedLinks: result.unverifiedLinks.length };
  });
  return result;
}

/** True when a run's files were assembled by an older version of assembly (folder layout or content). */
export function hasOldLayout(run: RunState): boolean {
  return Object.keys(run.files ?? {}).length > 0 && run.artifacts.packageLayout !== PACKAGE_LAYOUT;
}

const rebuilding = new Map<string, Promise<RunState>>();
/**
 * Rebuild a finished run's files in the current folder layout from its saved pages.
 * No AI calls; links are checked again. Used when an older run is downloaded or opened.
 */
export function rebuildPackage(id: string): Promise<RunState> {
  const cur = rebuilding.get(id);
  if (cur) return cur;
  const job = (async () => {
    updateRun(id, (r) => {
      r.files = assembleFiles(r);
      r.artifacts.packageLayout = PACKAGE_LAYOUT;
    });
    await validateRunFiles(id);
    log(id, "Package rebuilt in the current folder layout");
    return getRun(id)!;
  })().finally(() => rebuilding.delete(id));
  rebuilding.set(id, job);
  return job;
}

export async function buildZip(run: RunState): Promise<Buffer> {
  const zip = new JSZip();
  for (const [p, content] of Object.entries(run.files)) zip.file(p, content);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Page inputs (see planPages) that come from each research part. */
const RESEARCH_INPUTS: Record<string, string[]> = {
  company: ["company"],
  role: ["role", "roleIndex"],
  interview: ["interview"],
  coding: ["coding", "codingIndex", "codingTopics"],
};
export type ResearchPart = "company" | "role" | "interview" | "coding";
export const RESEARCH_PARTS: ResearchPart[] = ["company", "role", "interview", "coding"];

/** Parts that must re-run with a part: interview and coding research use the role list. */
export function withDependents(parts: ResearchPart[]): ResearchPart[] {
  const set = new Set(parts);
  if (set.has("role")) set.add("interview").add("coding");
  return RESEARCH_PARTS.filter((p) => set.has(p));
}

/**
 * Re-run chosen research parts. With rewritePages, pages that use that research are rewritten
 * afterwards; re-running roles sends the run back to choosing roles (previous choice preselected).
 * Without it, only the research (and the report in the package) is updated.
 */
export function resetResearch(id: string, parts: ResearchPart[], rewritePages: boolean) {
  const all = withDependents(parts);
  updateRun(id, (r) => {
    const reset = (k: string) => {
      const s = r.steps[k];
      if (s) Object.assign(s, { status: "pending", error: undefined, warnings: undefined, startedAt: undefined, endedAt: undefined, usage: undefined });
    };
    for (const p of all) reset(`research:${p}`);
    if (r.selection || r.steps.plan?.status === "done") {
      if (rewritePages) {
        r.pendingRewrite = [...new Set([...(r.pendingRewrite ?? []), ...all])];
        reset("plan");
        if (all.includes("role")) {
          r.previousSelection = r.selection;
          r.selection = undefined;
          reset("select");
        }
      }
      ["assemble", "validate", "package"].forEach(reset); // the package carries the research report
    } else if (r.steps.select?.status === "running") {
      reset("select"); // still choosing: discovery is redone, then the choice is offered again
    }
    r.status = "queued";
    r.error = undefined;
    r.autoResumes = 0;
    r.log.push(`${new Date().toISOString().slice(11, 19)} Re-running research: ${all.join(", ")}${rewritePages && r.pages.length ? " (pages that use it will be rewritten)" : ""}`);
  });
}

/** Reset a step (and everything downstream that depends on it) so the pipeline re-runs it. */
export function resetStep(id: string, key?: string) {
  updateRun(id, (r) => {
    const reset = (k: string) => {
      const s = r.steps[k];
      if (s) Object.assign(s, { status: "pending", error: undefined, warnings: undefined, startedAt: undefined, endedAt: undefined, usage: undefined });
    };
    const finals = ["assemble", "validate", "package"];
    if (!key) {
      for (const k of r.stepOrder) if (r.steps[k].status === "failed") reset(k);
      // A failed validation usually means a page needs redoing; validation re-runs regardless.
      finals.forEach(reset);
    } else if (key.startsWith("page:")) {
      const [, pagePath, stage] = key.match(/^page:(.+):(\w+)$/)!;
      const from = STAGES.indexOf(stage as Stage);
      STAGES.slice(from).forEach((s) => reset(`page:${pagePath}:${s}`));
      finals.forEach(reset);
    } else {
      reset(key);
      if (key !== "package") finals.slice(finals.indexOf(key) >= 0 ? finals.indexOf(key) : 0).forEach(reset);
    }
    r.status = "queued";
    r.autoResumes = 0;
  });
}

const MAX_AUTO_RESUMES = 2;

/**
 * A run marked running/queued that no live pipeline owns was cut off by a server restart
 * (dev server reload, crash, or stop). Resume it automatically: interrupted steps start
 * again and finished steps are kept. After MAX_AUTO_RESUMES it stops and asks for a retry.
 */
export function recoverIfInterrupted(id: string) {
  const run = getRun(id);
  if (!run || active.has(id) || (run.status !== "running" && run.status !== "queued")) return;
  const interrupted = run.stepOrder.filter((k) => run.steps[k].status === "running" && k !== "select");
  const names = interrupted.map((k) => run.steps[k].label).join(", ") || "the run";
  const resumes = run.autoResumes ?? 0;
  const stamp = new Date().toISOString().slice(11, 19);

  if (resumes >= MAX_AUTO_RESUMES) {
    updateRun(id, (r) => {
      for (const k of interrupted)
        Object.assign(r.steps[k], { status: "failed", endedAt: new Date().toISOString(), error: "Interrupted: the server restarted while this step was running." });
      r.status = "failed";
      r.error = `The server restarted ${resumes + 1} times during this run, so it stopped. Click Retry to continue; finished steps are kept.`;
      r.log.push(`${stamp} Server restarted during ${names}; stopped after ${resumes} automatic resumes`);
    });
    return;
  }
  updateRun(id, (r) => {
    for (const k of interrupted) Object.assign(r.steps[k], { status: "pending", startedAt: undefined, endedAt: undefined, error: undefined });
    r.autoResumes = resumes + 1;
    r.log.push(`${stamp} Server restarted during ${names}; resuming automatically (${resumes + 1}/${MAX_AUTO_RESUMES})`);
  });
  void runPipeline(id);
}

export function totalUsage(run: RunState): Usage {
  return Object.values(run.steps).reduce<Usage>((acc, s) => (s.usage ? addUsage(acc, s.usage) : acc), emptyUsage());
}
