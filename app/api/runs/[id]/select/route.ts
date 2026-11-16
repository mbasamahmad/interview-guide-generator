import { NextResponse } from "next/server";
import { getRun, updateRun } from "@/lib/store";
import { isActive, runPipeline } from "@/lib/pipeline";
import { discoveredInterviewTypes } from "@/lib/pages";
import type { InterviewResearch, RoleResearch } from "@/lib/agents/schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Confirm which discovered roles and interview types get pages, then continue the run. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (run.status !== "awaiting-selection" || isActive(id)) return NextResponse.json({ error: "This run is not waiting for a selection." }, { status: 409 });

  const body = (await req.json().catch(() => ({}))) as { roles?: unknown; interviewTypes?: unknown };
  const roleSlugs = new Set(((run.artifacts.role as RoleResearch | undefined)?.roles ?? []).map((r) => r.slug));
  const typeSlugs = new Set(run.artifacts.interview ? discoveredInterviewTypes(run.artifacts.interview as InterviewResearch).map((t) => t.type) : []);
  const roles = Array.isArray(body.roles) ? [...new Set(body.roles.filter((r): r is string => typeof r === "string" && roleSlugs.has(r)))] : [];
  const interviewTypes = Array.isArray(body.interviewTypes)
    ? [...new Set(body.interviewTypes.filter((t): t is string => typeof t === "string" && typeSlugs.has(t)))]
    : [];
  if (!roles.length) return NextResponse.json({ error: "Choose at least one role." }, { status: 400 });

  updateRun(id, (r) => {
    r.selection = { roles, interviewTypes, confirmedAt: new Date().toISOString() };
    r.status = "queued";
    r.log.push(`${new Date().toISOString().slice(11, 19)} Selected ${roles.length} role(s) and ${interviewTypes.length} interview type(s)`);
  });
  void runPipeline(id);
  return NextResponse.json({ ok: true });
}
