import { buildReport, isComputerScienceRole } from "@/lib/report";
import { NextResponse } from "next/server";
import { getRun, type Step, type Usage } from "@/lib/store";
import { isActive, recoverIfInterrupted } from "@/lib/pipeline";
import { estimateCost } from "@/lib/pricing";
import { addUsage, emptyUsage } from "@/lib/llm";
import { discoveredInterviewTypes } from "@/lib/pages";
import { INTERVIEW_TYPES, ROLES } from "@/lib/taxonomy";
import type { CodingResearch, InterviewResearch, RoleResearch } from "@/lib/agents/schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let run;
  try {
    recoverIfInterrupted(id);
    run = getRun(id);
  } catch {
    run = null;
  }
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  // OpenAI/Gemini steps are priced from their token counts with the current price table, so
  // older runs and later price edits are reflected. Claude steps keep the cost computed at call time.
  const steps: Step[] = run.stepOrder.map((k) => {
    const s = run.steps[k];
    if (!s.usage || !s.model || !s.provider || s.provider === "anthropic") return s;
    const cost = estimateCost({ provider: s.provider, model: s.model, ...s.usage });
    return { ...s, usage: { ...s.usage, costUsd: cost ?? 0, unpricedCalls: cost === null ? Math.max(1, s.usage.unpricedCalls ?? 1) : 0 } };
  });
  const usage = steps.reduce<Usage>((acc, s) => (s.usage ? addUsage(acc, s.usage) : acc), emptyUsage());

  const role = run.artifacts.role as RoleResearch | undefined;
  const interview = run.artifacts.interview as InterviewResearch | undefined;
  const coding = run.artifacts.coding as CodingResearch | undefined;
  const taxonomy = new Set<string>(ROLES.map((r) => r.slug));

  return NextResponse.json({
    id: run.id,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    status: run.status,
    active: isActive(run.id),
    error: run.error,
    input: run.input,
    selection: run.selection ?? null,
    previousSelection: run.previousSelection ?? null,
    // What research discovered: shown on the run page, and used to choose pages.
    discovery: {
      roles: (role?.roles ?? []).filter(isComputerScienceRole).map((r) => ({
        slug: r.slug,
        title: r.title,
        inTaxonomy: taxonomy.has(r.slug),
        evidenceStrength: r.evidenceStrength,
        openPostings: r.openPostings,
        summary: r.summary,
        languages: r.languages.slice(0, 6),
        levels: r.levels.map((l) => l.level),
      })),
      interviewTypes: interview
        ? discoveredInterviewTypes(interview).map((t) => ({ type: t.type, label: t.label, rounds: t.rounds, roles: t.roles, confidence: t.confidence }))
        : [],
      hasOtherRounds: !!interview?.rounds.some((r) => !(INTERVIEW_TYPES as readonly string[]).includes(r.type)),
      loopSummary: interview?.processSummary ?? "",
      codingTopics: (coding?.emphasizedTopics ?? []).map((t) => ({ topic: t.topic, patterns: t.patterns, confidence: t.confidence })),
      codingQuestionTopics: [...new Set((coding?.questions ?? []).map((q) => q.topic))].length,
      codingQuestions: coding?.questions.length ?? 0,
    },
    // One-line summary of the company, its CS roles and interview types, and the coding questions.
    report: buildReport(run),
    steps,
    pages: run.pages,
    files: Object.entries(run.files).map(([path, c]) => ({ path, bytes: Buffer.byteLength(c) })),
    validation: run.artifacts.validation ?? null,
    log: run.log.slice(-60),
    usage,
  });
}
