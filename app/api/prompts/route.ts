import { NextResponse } from "next/server";
import { AGENTS, CLAUDE_MODELS, EFFORTS, PROVIDERS } from "@/lib/agents/defaults";
import { getAgentConfigs } from "@/lib/prompts";
import { providerDefaultModel, providerStatus, resolveModelCfg } from "@/lib/llm";
import { readGlobalConfig } from "@/lib/providerDefaults";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const configs = getAgentConfigs();
    const keys = providerStatus();
    const defaults = await Promise.all(
      PROVIDERS.map(async (p) => (keys[p.id] ? { id: p.id, ...(await providerDefaultModel(p.id)) } : { id: p.id, model: null, source: "auto" as const })),
    );
    const agents = await Promise.all(
      AGENTS.map(async (a) => {
        const config = configs.find((c) => c.key === a.key)!;
        const eff = await resolveModelCfg(config);
        return {
          key: a.key,
          name: a.name,
          description: a.description,
          usesWeb: a.usesWeb,
          canDisable: a.canDisable,
          config,
          // What the agent will actually run on now (differs when its provider has no key).
          effective: { provider: eff.provider, model: eff.model, effort: eff.effort, fallbackFrom: eff.fallbackFrom ?? null, global: !!eff.global },
        };
      }),
    );
    return NextResponse.json({
      providers: PROVIDERS.map((p) => ({ ...p, configured: keys[p.id], defaultModel: defaults.find((d) => d.id === p.id) })),
      global: readGlobalConfig(),
      efforts: EFFORTS,
      claudeModels: CLAUDE_MODELS,
      agents,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
