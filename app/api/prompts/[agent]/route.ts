import { NextResponse } from "next/server";
import { AGENT_BY_KEY, type AgentKey, type Effort, type Provider } from "@/lib/agents/defaults";
import { restoreAgentVersion, saveAgentConfig } from "@/lib/prompts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function agentKey(raw: string): AgentKey | null {
  return raw in AGENT_BY_KEY ? (raw as AgentKey) : null;
}

/** Save prompt / provider / model / effort / enabled. The prompt is written to agents/<key>/prompt.md. */
export async function PUT(req: Request, { params }: { params: Promise<{ agent: string }> }) {
  const key = agentKey((await params).agent);
  if (!key) return NextResponse.json({ error: "Unknown agent" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { prompt?: string; provider?: Provider; model?: string; effort?: Effort; enabled?: boolean; note?: string };
  try {
    return NextResponse.json({ config: saveAgentConfig(key, body) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

/** Restore a previous version or the default prompt (written to prompt.md, recorded as a new version). */
export async function POST(req: Request, { params }: { params: Promise<{ agent: string }> }) {
  const key = agentKey((await params).agent);
  if (!key) return NextResponse.json({ error: "Unknown agent" }, { status: 404 });
  const { version } = (await req.json().catch(() => ({}))) as { version?: number | "default" };
  if (version === undefined) return NextResponse.json({ error: "version is required" }, { status: 400 });
  try {
    return NextResponse.json({ config: restoreAgentVersion(key, version) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
