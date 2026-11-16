import { NextResponse } from "next/server";
import { AGENTS, type Effort, type Provider } from "@/lib/agents/defaults";
import { saveAgentConfig } from "@/lib/prompts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Write one provider/model (and optionally effort) into every agent's config.json, as a new version each. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { provider?: Provider; model?: string; effort?: Effort | "" };
  if (!body.provider || !body.model?.trim()) return NextResponse.json({ error: "Choose a provider and model first." }, { status: 400 });
  try {
    for (const a of AGENTS) {
      saveAgentConfig(a.key, {
        provider: body.provider,
        model: body.model,
        ...(body.effort ? { effort: body.effort } : {}),
        note: `Applied to all agents: ${body.model}`,
      });
    }
    return NextResponse.json({ ok: true, updated: AGENTS.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
