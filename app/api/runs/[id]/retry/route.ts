import { NextResponse } from "next/server";
import { getRun } from "@/lib/store";
import { isActive, resetStep, runPipeline } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (isActive(id)) return NextResponse.json({ error: "This run is still in progress." }, { status: 409 });
  const { stepKey } = (await req.json().catch(() => ({}))) as { stepKey?: string };
  if (stepKey && !run.steps[stepKey]) return NextResponse.json({ error: "Unknown step" }, { status: 400 });
  resetStep(id, stepKey);
  void runPipeline(id);
  return NextResponse.json({ ok: true });
}
