import { NextResponse } from "next/server";
import { getRun } from "@/lib/store";
import { isActive, resetResearch, runPipeline, RESEARCH_PARTS, type ResearchPart } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Re-run chosen research parts: {parts: ["company"|"role"|"interview"|"coding"], rewritePages: boolean}. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (isActive(id)) return NextResponse.json({ error: "This run is still in progress. Wait for it to finish or pause for your choice." }, { status: 409 });
  const body = (await req.json().catch(() => ({}))) as { parts?: unknown; rewritePages?: unknown };
  const parts = Array.isArray(body.parts) ? body.parts.filter((p): p is ResearchPart => (RESEARCH_PARTS as string[]).includes(p as string)) : [];
  if (!parts.length) return NextResponse.json({ error: "Choose at least one research part to re-run." }, { status: 400 });
  resetResearch(id, parts, body.rewritePages === true);
  void runPipeline(id);
  return NextResponse.json({ ok: true });
}
