import { NextResponse } from "next/server";
import type { Provider } from "@/lib/agents/defaults";
import { saveGlobalConfig, saveProviderDefault, type GlobalConfig } from "@/lib/providerDefaults";
import { clearAutoDefaults } from "@/lib/llm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PUT { provider, model }           set a provider's default (fallback) model; "" = automatic
 * PUT { global: { mode, provider, model, effort } }   set the global model setting
 */
export async function PUT(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { provider?: Provider; model?: string; global?: Partial<GlobalConfig> };
  try {
    if (body.global) return NextResponse.json({ global: saveGlobalConfig(body.global) });
    const defaults = saveProviderDefault(body.provider as Provider, body.model ?? "");
    clearAutoDefaults();
    return NextResponse.json({ defaults });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

