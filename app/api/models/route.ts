import { NextResponse } from "next/server";
import { CLAUDE_MODELS, PROVIDERS, type Provider } from "@/lib/agents/defaults";
import { describeError, listModels, providerStatus } from "@/lib/llm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Models available for a provider, fetched from its API with the configured key. */
export async function GET(req: Request) {
  const provider = new URL(req.url).searchParams.get("provider") as Provider;
  if (!PROVIDERS.some((p) => p.id === provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  if (!providerStatus()[provider]) {
    return NextResponse.json({ models: provider === "anthropic" ? CLAUDE_MODELS : [], warning: `No API key set (${PROVIDERS.find((p) => p.id === provider)!.envVar}).` });
  }
  try {
    return NextResponse.json({ models: await listModels(provider) });
  } catch (err) {
    return NextResponse.json({ models: provider === "anthropic" ? CLAUDE_MODELS : [], warning: describeError(err) });
  }
}
