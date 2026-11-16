import { NextResponse } from "next/server";
import { AGENT_BY_KEY, PROVIDERS, type AgentKey, type Effort, type Provider } from "@/lib/agents/defaults";
import { describeError } from "@/lib/llm";
import { findCompany, sheetInfo } from "@/lib/companies";
import { runInteractive, runQa, runResearchAgent, runSeo, runWriter } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 1800;

/** Run one agent once with a draft prompt (not saved) on sample input. */
export async function POST(req: Request, { params }: { params: Promise<{ agent: string }> }) {
  const raw = (await params).agent;
  if (!(raw in AGENT_BY_KEY)) return NextResponse.json({ error: "Unknown agent" }, { status: 404 });
  const key = raw as AgentKey;
  const body = (await req.json().catch(() => ({}))) as { prompt?: string; provider?: Provider; model?: string; effort?: Effort; input?: string };
  if (!body.prompt?.trim() || !body.model || !body.effort || !PROVIDERS.some((p) => p.id === body.provider))
    return NextResponse.json({ error: "prompt, provider, model and effort are required" }, { status: 400 });
  const cfg = { prompt: body.prompt, provider: body.provider!, model: body.model, effort: body.effort };
  const input = body.input ?? "";
  const started = Date.now();
  try {
    let result: { data: unknown; usage: unknown; notes?: string };
    if (key === "company" || key === "role" || key === "interview" || key === "coding") {
      let parsed: { company?: string; roles?: { slug: string; title: string }[] };
      try {
        parsed = JSON.parse(input || "{}");
      } catch {
        return NextResponse.json({ error: 'Test input must be JSON like {"company":"OpenAI"} (interview and coding agents also accept "roles": [{"slug":"software-engineer","title":"Software Engineer"}])' }, { status: 400 });
      }
      if (!parsed.company) return NextResponse.json({ error: "Test input needs a company." }, { status: 400 });
      const row = await findCompany(parsed.company).catch(() => undefined); // same sheet brief as a real run
      const r = await runResearchAgent(key, cfg, parsed.company, Array.isArray(parsed.roles) ? parsed.roles : undefined, row ? sheetInfo(row) : undefined);
      result = { data: r.data, usage: r.usage, notes: r.notes };
    } else if (!input.trim()) {
      return NextResponse.json({ error: "Paste a sample page or page spec as test input." }, { status: 400 });
    } else if (key === "writer") result = await runWriter(cfg, input);
    else if (key === "interactive") result = await runInteractive(cfg, input);
    else if (key === "seo") result = await runSeo(cfg, input, "<page_spec>\nTest run: no package context.\n</page_spec>");
    else result = await runQa(cfg, input, "(No research digest in a test run: flag company-specific claims you cannot check.)");
    return NextResponse.json({ ...result, ms: Date.now() - started });
  } catch (err) {
    return NextResponse.json({ error: describeError(err) }, { status: 502 });
  }
}
